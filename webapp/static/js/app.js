/* Slovekiza Mini-App
 * - Хедер/баланс/инвойсы CryptoBot
 * - Вкладки (каталог/избранное/рефералы/детализация)
 * - Категории → список услуг с ПОИСКОМ в шапке страницы
 * - Клик по услуге открывает ОТДЕЛЬНУЮ СТРАНИЦУ оформления заказа (не модалку)
 * - Поп-ап «Оплата прошла успешно» по флагу topup_delta от сервера
 */
(function () {
  "use strict";

  /* ================== Telegram bootstrap ================== */
  const tg = window.Telegram?.WebApp;
  try {
    tg?.expand?.();
    tg?.ready?.();
    tg?.MainButton?.hide?.();
    tg?.BackButton?.hide?.();
    tg?.disableVerticalSwipes?.();
  } catch (_) {}

  const API_BASE = "/api/v1";

  /* ================== DOM refs ================== */
  const appMain      = document.getElementById("appMain");

  const nicknameEl   = document.getElementById("nickname");
  const avatarEl     = document.getElementById("avatar");
  const userSeqEl    = document.getElementById("userSeq");
  const balanceEl    = document.getElementById("balanceValue");
  const btnTopup     = document.getElementById("btnTopup");

  const pages = {
    catalog:  document.getElementById("page-categories"),
    services: document.getElementById("page-services"),
    favs:     document.getElementById("page-favs"),
    refs:     document.getElementById("page-refs"),
    details:  document.getElementById("page-details"),
  };

  // services page header
  const servicesPage   = pages.services;
  const servicesTitle  = document.getElementById("servicesTitle");
  const btnBackToCats  = document.getElementById("btnBackToCats");
  const servicesListEl = document.getElementById("servicesList");
  const catsListEl     = document.getElementById("catsList");

  /* ================== Utils ================== */
  function curSign(c){ return c==='RUB'?' ₽':(c==='USD'?' $':` ${c}`); }
  function debounce(fn, ms=250){ let t; return (...a)=>{ clearTimeout(t); t=setTimeout(()=>fn(...a), ms); }; }

  /* ================== Topup overlay ================== */
  (function injectOverlayCSS(){
    const css = `
      #topupOverlay{position:fixed;inset:0;z-index:99999;background:rgba(10,12,16,.92);
        display:none;align-items:center;justify-content:center;padding:24px;backdrop-filter:blur(4px)}
      #topupOverlay[aria-hidden="false"]{display:flex}
      .topup-card{width:min(440px,92vw);background:#14171f;border-radius:20px;box-shadow:0 10px 30px rgba(0,0,0,.5);
        padding:28px;text-align:center;color:#e6e8ee;border:1px solid rgba(255,255,255,.06)}
      .topup-icon{width:88px;height:88px;margin:0 auto 16px;border-radius:50%;
        background:radial-gradient(110px 110px at 30% 30%,#2ed47a 0%,#1a9f55 60%,#117a3f 100%);
        display:grid;place-items:center;box-shadow:0 10px 30px rgba(46,212,122,.35),inset 0 0 18px rgba(255,255,255,.15)}
      .topup-icon svg{width:44px;height:44px;color:#fff}
      .topup-title{font:600 20px/1.3 Inter,system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;margin:6px 0 8px}
      .topup-sub{font:400 14px/1.5 Inter,system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#a8afbd;margin-bottom:18px}
      .topup-amount{font:600 16px/1.4 Inter,system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;margin-bottom:16px}
      .topup-ok{width:100%;padding:12px 16px;border-radius:14px;border:0;cursor:pointer;
        background:linear-gradient(180deg,#2b81f7 0%,#1f6cdc 100%);color:#fff;font:600 15px/1 Inter,system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;
        box-shadow:0 8px 20px rgba(43,129,247,.35)}
      .topup-ok:active{transform:translateY(1px)}
    `;
    const s=document.createElement("style"); s.textContent=css; document.head.appendChild(s);
  })();
  let overlay = document.getElementById("topupOverlay");
  if (!overlay){
    overlay = document.createElement("div");
    overlay.id = "topupOverlay";
    overlay.setAttribute("aria-hidden","true");
    overlay.innerHTML = `
      <div class="topup-card" role="dialog" aria-modal="true" aria-labelledby="topupTitle">
        <div class="topup-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none"><path d="M9 16.2 4.8 12 3.4 13.4 9 19 21 7 19.6 5.6 9 16.2Z" fill="currentColor"/></svg>
        </div>
        <div id="topupTitle" class="topup-title">Оплата прошла успешно</div>
        <div class="topup-sub">Баланс пополнен. Средства уже доступны для оформления заказов.</div>
        <div class="topup-amount" id="topupAmount"></div>
        <button type="button" class="topup-ok" id="topupOkBtn">Окей</button>
      </div>`;
    document.body.appendChild(overlay);
  }
  const overlayAmount = document.getElementById("topupAmount");
  document.getElementById("topupOkBtn")?.addEventListener("click", ()=> overlay.setAttribute("aria-hidden","true"));
  overlay.addEventListener("click", e => { if (e.target === overlay) overlay.setAttribute("aria-hidden","true"); });
  function showTopupOverlay(delta, currency){
    try { tg?.HapticFeedback?.notificationOccurred?.('success'); } catch(_) {}
    try { navigator.vibrate?.([30,20,30]); } catch(_) {}
    overlayAmount.textContent = `+${Number(delta||0).toFixed(2)} ${currency||''}`.trim();
    overlay.setAttribute("aria-hidden","false");
  }

  /* ================== Profile / balance ================== */
  function urlNick(){ try{const p=new URLSearchParams(location.search);const v=p.get('n');return v?decodeURIComponent(v):null;}catch(_){return null;} }
  const nickFromUrl = urlNick();
  if (nicknameEl) nicknameEl.textContent = nickFromUrl || "Гость";

  let userId = null; try { userId = tg?.initDataUnsafe?.user?.id || null; } catch(_){}
  if (avatarEl) {
    const photo = tg?.initDataUnsafe?.user?.photo_url;
    if (photo) avatarEl.src = photo;
    if (!avatarEl.src) {
      avatarEl.src='data:image/svg+xml;utf8,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 80"><rect fill="#1b1e24" width="80" height="80" rx="40"/><circle cx="40" cy="33" r="15" fill="#2a2f36"/><path d="M15 66c5-12 18-18 25-18s20 6 25 18" fill="#2a2f36"/></svg>');
    }
  }
  function stableHashId(x){let h=0,s=String(x||'');for(let i=0;i<s.length;i++){h=((h<<5)-h+s.charCodeAt(i))|0;}h=Math.abs(h);return (h%100000)+1;}
  let seq = parseInt(localStorage.getItem('smm_user_seq')||'0',10) || stableHashId(userId||nickFromUrl||'guest');
  if (userSeqEl) userSeqEl.textContent = `#${seq}`;

  let currentCurrency = "RUB";
  let lastBalance = 0;

  async function fetchProfile() {
    try {
      const qp = new URLSearchParams({ user_id: String(userId || seq), consume_topup: "1" });
      if (nickFromUrl) qp.set("nick", nickFromUrl);
      const r = await fetch(`${API_BASE}/user?${qp.toString()}`);
      if (!r.ok) throw 0;
      const p = await r.json();

      if (p.nick && nicknameEl) nicknameEl.textContent = p.nick;
      if (p.seq){
        seq = p.seq;
        userSeqEl && (userSeqEl.textContent = `#${p.seq}`);
        localStorage.setItem("smm_user_seq", String(p.seq));
      }

      currentCurrency = (p.currency || "RUB").toUpperCase();
      lastBalance = Number(p.balance || 0);
      if (balanceEl) balanceEl.textContent = `${lastBalance.toFixed(2)}${curSign(currentCurrency)}`;

      if (p.topup_delta && Number(p.topup_delta) > 0) {
        showTopupOverlay(Number(p.topup_delta), (p.topup_currency || currentCurrency));
      }
      return p;
    } catch(_){
      currentCurrency = "RUB";
      lastBalance = 0;
      if (balanceEl) balanceEl.textContent = "0.00" + curSign("RUB");
      return null;
    }
  }
  fetchProfile();
  window.addEventListener("focus", fetchProfile);
  document.addEventListener("visibilitychange", ()=>{ if(!document.hidden) fetchProfile(); });

  btnTopup?.addEventListener("click", async ()=>{
    try{
      const s = prompt("Сумма пополнения, USDT (мин. 0.10):", "1.00");
      if(!s) return;
      const amount = parseFloat(s);
      if (isNaN(amount) || amount < 0.10) { alert("Минимальная сумма — 0.10 USDT"); return; }
      const r = await fetch(`${API_BASE}/pay/invoice`, {
        method:"POST", headers:{ "Content-Type":"application/json" },
        body: JSON.stringify({ user_id: userId || seq, amount_usd: amount }),
      });
      if (r.status === 501) { alert("Оплата через CryptoBot ещё не настроена."); return; }
      if (!r.ok) throw new Error(await r.text());
      const j = await r.json();
      (tg?.openLink ? tg.openLink(j.pay_url) : window.open(j.pay_url, "_blank"));
    }catch(e){ alert("Ошибка создания счёта: " + (e?.message||e)); }
  });

  /* ================== Tabs (simple) ================== */
  function showPage(name){
    const idByName = {
      catalog: "page-categories",
      services: "page-services",
      favs: "page-favs",
      refs: "page-refs",
      details: "page-details",
      order: "page-order",
    };
    const target = idByName[name] || "page-categories";
    Object.values(idByName).forEach(id=>{
      const el = document.getElementById(id);
      if (!el) return;
      el.classList.toggle("active", id===target);
    });
    // highlight tab button
    document.querySelectorAll(".tabbar .tab").forEach(b=>{
      b.classList.toggle("active", b.dataset.tab === name || (name==='catalog' && b.dataset.tab==='catalog'));
    });
    try { window.scrollTo({top:0, behavior:"instant"}); } catch(_){}
  }
  document.querySelectorAll(".tabbar .tab").forEach(btn=>{
    btn.addEventListener("click", ()=> showPage(btn.dataset.tab));
  });
  // стартовая вкладка
  showPage("catalog");

  /* ================== Categories ================== */
  async function loadCategories(){
    if (!catsListEl) return;
    try{
      const r = await fetch(`${API_BASE}/services`);
      const items = await r.json();
      renderCategories(items);
    }catch{
      renderCategories([
        {id:"telegram",  name:"Telegram",  desc:"подписчики, просмотры"},
        {id:"tiktok",    name:"TikTok",    desc:"просмотры, фолловеры"},
        {id:"instagram", name:"Instagram", desc:"подписчики, лайки"},
        {id:"youtube",   name:"YouTube",   desc:"просмотры, подписки"},
        {id:"facebook",  name:"Facebook",  desc:"лайки, подписчики"},
      ]);
    }
  }
  function renderCategories(items){
    catsListEl.innerHTML = "";
    items.forEach(c=>{
      const a = document.createElement("a");
      a.href = "#";
      a.className = "cat";
      a.dataset.cat = c.id;
      a.innerHTML = `
        <div class="cat-icon"><img src="static/img/${c.id}.svg" alt=""></div>
        <div class="cat-body">
          <div class="cat-name">${c.name}</div>
          <div class="cat-desc">${c.desc || ""}${c.count ? " • "+c.count : ""}</div>
        </div>`;
      a.addEventListener("click", e => { e.preventDefault(); openServices(c.id, c.name); });
      catsListEl.appendChild(a);
    });
  }
  loadCategories();

  /* ================== Services page + search ================== */
  let currentNetwork = null;
  let allServices = [];
  let serviceSearchEl = null;

  function ensureServicesSearch(){
    if (serviceSearchEl) return serviceSearchEl;
    // создаём инпут справа от заголовка (внутри .subheader)
    const bar = servicesPage?.querySelector(".subheader");
    if (!bar) return null;

    serviceSearchEl = document.createElement("input");
    serviceSearchEl.type = "search";
    serviceSearchEl.placeholder = "Поиск по услугам…";
    serviceSearchEl.autocomplete = "off";
    serviceSearchEl.className = "svc-search"; // стилизуй в CSS при желании

    // вставим справа
    bar.appendChild(serviceSearchEl);
    // обработчик с debounce
    serviceSearchEl.addEventListener("input", debounce(()=>{
      const q = (serviceSearchEl.value || "").trim().toLowerCase();
      const filtered = !q ? allServices : allServices.filter(s=>{
        const text = `${s.name} ${s.type||""}`.toLowerCase();
        return text.includes(q);
      });
      renderServices(filtered);
    }, 180));

    return serviceSearchEl;
  }

  async function openServices(network, title){
    currentNetwork = network;
    servicesTitle && (servicesTitle.textContent = title || "Услуги");
    ensureServicesSearch();
    showPage("services");
    renderServicesSkeleton(5);
    try{
      const r = await fetch(`${API_BASE}/services/${network}`);
      allServices = await r.json();
      renderServices(allServices);
    }catch{
      servicesListEl.innerHTML = '<div class="empty">Не удалось загрузить услуги</div>';
    }
  }

  function renderServicesSkeleton(n=4){
    servicesListEl.innerHTML='';
    for(let i=0;i<n;i++){
      servicesListEl.insertAdjacentHTML('beforeend', `
        <div class="skeleton">
          <div class="skel-row">
            <div class="skel-avatar"></div>
            <div class="skel-lines">
              <div class="skel-line"></div>
              <div class="skel-line short"></div>
            </div>
          </div>
        </div>`);
    }
  }

  function renderServices(items){
    servicesListEl.innerHTML = '';
    items.forEach(s=>{
      const row = document.createElement('div');
      row.className = 'service';
      row.innerHTML = `
        <div class="left">
          <div class="name">${s.name}</div>
          <div class="meta">Тип: ${s.type} • Мин: ${s.min} • Макс: ${s.max}</div>
        </div>
        <div class="right">
          <div class="price">от ${Number(s.rate_client_1000).toFixed(2)}${curSign(s.currency||currentCurrency)} / 1000</div>
          <button class="btn" data-id="${s.service}">Купить</button>
        </div>`;
      // вся карточка кликабельная → страница заказа
      row.addEventListener('click', ()=> openOrderPage(s));
      // кнопка «Купить» не мешает
      row.querySelector('button')?.addEventListener('click', (e)=>{ e.stopPropagation(); openOrderPage(s); });
      servicesListEl.appendChild(row);
    });
  }

  btnBackToCats?.addEventListener("click", ()=> showPage("catalog"));

  /* ================== Order PAGE (not modal) ================== */
  let orderPageEl   = null;
  let orderQtyEl    = null;
  let orderLinkEl   = null;
  let orderPriceEl  = null;
  let orderFavEl    = null;
  let orderBtnEl    = null;
  let orderTitleEl  = null;

  let currentService = null;

  function ensureOrderPage(){
    if (orderPageEl) return orderPageEl;

    orderPageEl = document.createElement("section");
    orderPageEl.id = "page-order";
    orderPageEl.className = "page";

    orderPageEl.innerHTML = `
      <div class="subheader">
        <button class="back" id="btnBackToServices">←</button>
        <h2 class="subheader-title" id="orderSvcTitle">Оформление</h2>
      </div>

      <div class="order-wrap" style="display:flex;flex-direction:column;gap:12px">
        <div class="order-presets" id="orderPresets" style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px"></div>

        <div class="modal-row">
          <label>Количество</label>
          <input id="orderQty" type="number" min="1" step="1" value="100">
          <div id="orderMinMax" class="modal-info"></div>
        </div>

        <div class="modal-row">
          <label>Ссылка</label>
          <input id="orderLink" type="url" placeholder="https://..." autocomplete="off">
        </div>

        <label style="display:flex;align-items:center;gap:10px">
          <input id="orderFav" type="checkbox">
          <span>Избранное</span>
        </label>

        <div id="orderPrice" class="modal-info">Цена: —</div>

        <div class="modal-actions" style="justify-content:stretch">
          <button class="btn secondary" id="orderCancel" style="flex:1">Назад</button>
          <button class="btn primary"   id="orderCreate" style="flex:1">Создать заказ</button>
        </div>
      </div>
    `;

    appMain.appendChild(orderPageEl);
    pages.order = orderPageEl;

    // refs
    orderQtyEl   = orderPageEl.querySelector("#orderQty");
    orderLinkEl  = orderPageEl.querySelector("#orderLink");
    orderPriceEl = orderPageEl.querySelector("#orderPrice");
    orderFavEl   = orderPageEl.querySelector("#orderFav");
    orderBtnEl   = orderPageEl.querySelector("#orderCreate");
    orderTitleEl = orderPageEl.querySelector("#orderSvcTitle");

    // back
    orderPageEl.querySelector("#btnBackToServices")?.addEventListener("click", ()=> showPage("services"));
    orderPageEl.querySelector("#orderCancel")?.addEventListener("click", ()=> showPage("services"));

    // qty change
    orderQtyEl?.addEventListener("input", updateOrderPrice);

    // create handler
    orderBtnEl?.addEventListener("click", createOrder);

    return orderPageEl;
  }

  function presetsFromRange(min, max){
    // пытаемся подобрать 6 адекватных пресетов
    const base = [100, 500, 1000, 2500, 5000, 10000];
    const arr = [];
    base.forEach(v => { if (v>=min && v<=max) arr.push(v); });
    if (!arr.length) { arr.push(min); }
    return arr.slice(0,6);
  }

  function renderPresets(min, max){
    const wrap = orderPageEl.querySelector("#orderPresets");
    wrap.innerHTML = "";
    presetsFromRange(min,max).forEach(v=>{
      const b = document.createElement("button");
      b.className = "btn secondary";
      b.textContent = String(v);
      b.addEventListener("click", ()=>{
        orderQtyEl.value = String(v);
        updateOrderPrice();
      });
      wrap.appendChild(b);
    });
    const mm = orderPageEl.querySelector("#orderMinMax");
    mm.textContent = `мин ${min} • макс ${max}`;
  }

  function updateOrderPrice(){
    if (!currentService || !orderQtyEl || !orderPriceEl) return;
    let q = parseInt(orderQtyEl.value||"0",10);
    if (Number.isFinite(currentService.min)) q = Math.max(q, currentService.min);
    if (Number.isFinite(currentService.max)) q = Math.min(q, currentService.max);
    orderQtyEl.value = String(q);

    const price = Math.max(0, Number(currentService.rate_client_1000) * q / 1000);
    orderPriceEl.textContent = `Цена: ${price.toFixed(2)}${curSign(currentService.currency||currentCurrency)}`;
  }

  function loadFavs(){
    try { return JSON.parse(localStorage.getItem("smm_favs")||"[]"); } catch(_) { return []; }
  }
  function saveFavs(list){
    try { localStorage.setItem("smm_favs", JSON.stringify(list)); } catch(_){}
  }

  function openOrderPage(svc){
    ensureOrderPage();
    currentService = svc;

    orderTitleEl && (orderTitleEl.textContent = svc.name);
    orderLinkEl && (orderLinkEl.value = "");
    orderQtyEl  && (orderQtyEl.value  = String(Math.max(svc.min||1, 100)));
    renderPresets(Number(svc.min||1), Number(svc.max||orderQtyEl.value||1));

    // избранное (локально)
    const favs = loadFavs();
    orderFavEl && (orderFavEl.checked = favs.includes(svc.service));
    orderFavEl?.addEventListener("change", ()=>{
      const list = new Set(loadFavs());
      if (orderFavEl.checked) list.add(svc.service); else list.delete(svc.service);
      saveFavs([...list]);
    }, { once:true });

    updateOrderPrice();
    showPage("order");
  }

  async function createOrder(){
    if(!currentService) return;
    const link = (orderLinkEl?.value||"").trim();
    const q    = parseInt(orderQtyEl?.value||"0",10);
    if (!link){ alert("Укажите ссылку"); return; }
    if (q < currentService.min || q > currentService.max){
      alert(`Количество должно быть от ${currentService.min} до ${currentService.max}`);
      return;
    }

    orderBtnEl.disabled = true; orderBtnEl.textContent = "Оформляем...";
    try{
      const r = await fetch(`${API_BASE}/order/create`,{
        method:"POST",
        headers:{ "Content-Type":"application/json" },
        body: JSON.stringify({ user_id: userId || seq, service: currentService.service, link, quantity: q })
      });
      if (!r.ok) throw new Error(await r.text());
      const j = await r.json();
      alert(`Заказ создан!\nНомер: ${j.order_id}\nСумма: ${j.cost} ${j.currency}`);
      await fetchProfile();
      showPage("services");
    }catch(e){
      alert("Не удалось создать заказ: " + (e?.message||e));
    }finally{
      orderBtnEl.disabled = false; orderBtnEl.textContent = "Создать заказ";
    }
  }

})();
