/* Slovekiza Mini-App
 * Совместимо с данным index.html и app.css
 * - Профиль, баланс, оверлей успешного пополнения
 * - Категории / Услуги / Полная страница услуги
 * - Избранное (локально) + отправка на сервер
 * - Рефералка (линк, прогресс, статы)
 * - Детализация (Заказы / Платежи)
 */

(function () {
  // ====== Telegram WebApp ======
  const tg = (window.Telegram && window.Telegram.WebApp) || null;
  try {
    tg?.expand?.();
    tg?.ready?.();
    tg?.MainButton?.hide?.();
    tg?.BackButton?.hide?.();
    tg?.disableVerticalSwipes?.();
  } catch (_) {}

  const API_BASE = "/api/v1";

  // ====== DOM ======
  const nicknameEl = document.getElementById("nickname");
  const avatarEl   = document.getElementById("avatar");
  const userSeqEl  = document.getElementById("userSeq");
  const balanceEl  = document.getElementById("balanceValue");
  const btnTopup   = document.getElementById("btnTopup");

  const pages = {
    catalog:  document.getElementById("page-categories"),
    services: document.getElementById("page-services"),
    service:  document.getElementById("page-service"),
    favs:     document.getElementById("page-favs"),
    refs:     document.getElementById("page-refs"),
    details:  document.getElementById("page-details"),
  };

  const catsListEl       = document.getElementById("catsList");
  const servicesListEl   = document.getElementById("servicesList");
  const servicesTitleEl  = document.getElementById("servicesTitle");
  const servicesSearchEl = document.getElementById("servicesSearch");
  const btnBackToCats    = document.getElementById("btnBackToCats");

  const serviceTitleEl    = document.getElementById("serviceTitle");
  const serviceDetailsEl  = document.getElementById("serviceDetails");
  const btnBackToServices = document.getElementById("btnBackToServices");

  // ====== helpers ======
  function curSign(c){ return c==='RUB' ? ' ₽' : (c==='USD' ? ' $' : ` ${c}`); }
  function fmt(n, d=2){ return Number(n||0).toFixed(d); }
  function bust(url){
    const u = new URL(url, location.origin);
    u.searchParams.set("_", Date.now().toString());
    return u.toString();
  }
  function copy(text){
    try { navigator.clipboard?.writeText(text); }
    catch (_){
      const t=document.createElement('textarea'); t.value=text;
      document.body.appendChild(t); t.select(); document.execCommand('copy'); t.remove();
    }
  }
function fmtDate(val){
  try{
    if (val == null || val === '') return '';

    // 1) ISO-строки вида 2025-09-28T05:41:48Z
    if (typeof val === 'string' && !/^\d+(\.\d+)?$/.test(val.trim())) {
      const d = new Date(val);
      if (!isNaN(d.getTime())) {
        const dd = String(d.getDate()).padStart(2,'0');
        const mm = String(d.getMonth()+1).padStart(2,'0');
        const yy = String(d.getFullYear()).slice(-2);
        const hh = String(d.getHours()).padStart(2,'0');
        const mi = String(d.getMinutes()).padStart(2,'0');
        return `${dd}.${mm}.${yy} ${hh}:${mi}`;
      }
      return val;
    }

    // 2) Числа/строки-числа: сек или мс
    let ts = typeof val === 'number' ? val : Number(val);
    if (!Number.isFinite(ts)) return String(val);
    if (ts < 1e12) ts *= 1000; // пришло в секундах

    const dt = new Date(ts);
    const dd = String(dt.getDate()).padStart(2,'0');
    const mm = String(dt.getMonth()+1).padStart(2,'0');
    const yy = String(dt.getFullYear()).slice(-2);
    const hh = String(dt.getHours()).padStart(2,'0');
    const mi = String(dt.getMinutes()).padStart(2,'0');
    return `${dd}.${mm}.${yy} ${hh}:${mi}`;
  } catch(_) {
    return String(val);
  }
}


  // ====== Topup overlay (CSS classes из app.css) ======
  function ensureOverlay(){
    let el = document.getElementById("topupOverlay");
    if (el) return el;
    el = document.createElement("div");
    el.id = "topupOverlay";
    el.className = "overlay";
    el.innerHTML = `
      <div class="overlay__dialog">
        <div class="overlay__icon">
          <svg viewBox="0 0 24 24" fill="none"><path d="M9 16.2 4.8 12 3.4 13.4 9 19 21 7 19.6 5.6 9 16.2Z" fill="currentColor"/></svg>
        </div>
        <div class="overlay__title">Оплата прошла успешно</div>
        <div class="overlay__subtitle">Баланс пополнен. Средства доступны для заказов.</div>
        <div id="topupAmount" class="overlay__amount"></div>
        <button id="topupOkBtn" class="btn btn-primary btn-lg">Окей</button>
      </div>`;
    document.body.appendChild(el);
    el.addEventListener("click", (e)=>{ if(e.target===el) hideOverlay(); });
    el.querySelector("#topupOkBtn")?.addEventListener("click", hideOverlay);
    return el;
  }
  function showOverlay(amount, currency){
    const el = ensureOverlay();
    el.querySelector("#topupAmount").textContent = `+${fmt(amount)} ${currency||''}`.trim();
    el.classList.add("overlay--show");
    try { tg?.HapticFeedback?.notificationOccurred?.('success'); } catch(_){}
    try { navigator.vibrate?.([30,20,30]); } catch(_){}
  }
  function hideOverlay(){ document.getElementById("topupOverlay")?.classList.remove("overlay--show"); }

  // ====== profile ======
  let userId = null; try { userId = tg?.initDataUnsafe?.user?.id || null; } catch(_){}
  function urlNick(){ try{ const p=new URLSearchParams(location.search); const v=p.get('n'); return v?decodeURIComponent(v):null; }catch(_){ return null; } }
  const nickFromUrl = urlNick();

  if (nicknameEl) nicknameEl.textContent = nickFromUrl || "Гость";
  try {
    const photo = tg?.initDataUnsafe?.user?.photo_url;
    if (photo && avatarEl) avatarEl.src = photo;
  } catch (_) {}
  if (avatarEl && !avatarEl.getAttribute("src")){
    avatarEl.src='data:image/svg+xml;utf8,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 80"><rect fill="#1b1e24" width="80" height="80" rx="40"/><circle cx="40" cy="33" r="15" fill="#2a2f36"/><path d="M15 66c5-12 18-18 25-18s20 6 25 18" fill="#2a2f36"/></svg>');
  }

  function stableHashId(x){ let h=0,s=String(x||''); for(let i=0;i<s.length;i++){ h=((h<<5)-h+s.charCodeAt(i))|0; } h=Math.abs(h); return (h%100000)+1; }
  let seq = parseInt(localStorage.getItem('smm_user_seq')||'0',10) || stableHashId(userId||nickFromUrl||'guest');
  if (userSeqEl) userSeqEl.textContent = `#${seq}`;

  let currentCurrency = "RUB";
  let lastBalance = 0;

  async function fetchProfile(){
    try {
      const qp = new URLSearchParams({ user_id: String(userId||seq), consume_topup: '1' });
      if (nickFromUrl) qp.set('nick', nickFromUrl);
      const r = await fetch(bust(`${API_BASE}/user?${qp.toString()}`));
      if (!r.ok) throw 0;
      const p = await r.json();

      if (p.seq){
        seq = p.seq;
        localStorage.setItem('smm_user_seq', String(p.seq));
        if (userSeqEl) userSeqEl.textContent = `#${p.seq}`;
      }
      if (p.nick && nicknameEl) nicknameEl.textContent = p.nick;

      currentCurrency = (p.currency || 'RUB').toUpperCase();
      lastBalance = Number(p.balance || 0);
      if (balanceEl) balanceEl.textContent = `${fmt(lastBalance)}${curSign(currentCurrency)}`;

      if (p.topup_delta && Number(p.topup_delta) > 0){
        showOverlay(Number(p.topup_delta), p.topup_currency || currentCurrency);
      }
    } catch (_){
      currentCurrency = 'RUB';
      lastBalance = 0;
      if (balanceEl) balanceEl.textContent = '0.00' + curSign('RUB');
    }
  }
  fetchProfile();
  window.addEventListener('focus', fetchProfile);
  document.addEventListener('visibilitychange', ()=>{ if(!document.hidden) fetchProfile(); });

  // ====== Topup ======
  btnTopup?.addEventListener('click', async ()=>{
    try{
      const s = prompt('Сумма пополнения, USDT (мин. 0.10):', '1.00');
      if (!s) return;
      const amount = parseFloat(s);
      if (isNaN(amount) || amount < 0.10){ alert('Минимальная сумма — 0.10 USDT'); return; }
      const r = await fetch(`${API_BASE}/pay/invoice`, {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ user_id: userId||seq, amount_usd: amount }),
      });
      if (r.status === 501){ alert('Оплата через CryptoBot ещё не настроена.'); return; }
      if (!r.ok) throw new Error(await r.text());
      const j = await r.json();
      (tg?.openLink ? tg.openLink(j.pay_url) : window.open(j.pay_url, '_blank'));
    }catch(e){ alert('Ошибка создания счёта: ' + (e?.message||e)); }
  });

  // ====== Tabs / Pages ======
  function showPage(id){
    ["page-categories","page-services","page-service","page-favs","page-refs","page-details"].forEach(pid=>{
      const el = document.getElementById(pid);
      if (el) el.classList.toggle("active", pid===id);
    });
    try { window.scrollTo({top:0, behavior:'instant'}); } catch(_) {}
  }
  function pageIdByTab(tab){
    if (tab==='catalog'||tab==='categories') return "page-categories";
    if (tab==='favs'||tab==='favorites')     return "page-favs";
    if (tab==='refs'||tab==='referrals')     return "page-refs";
    if (tab==='details')                      return "page-details";
    return "page-categories";
  }
    function activateTab(btn){
        document.querySelectorAll(".tabbar .tab")
        .forEach(b => b.classList.toggle("active", b === btn));

        const tab = btn?.dataset?.tab || 'catalog';
    const id  = pageIdByTab(tab);
    showPage(id);

        if (tab === 'favs') {
     // сначала тянем с бэка, затем рисуем локально
     syncFavsFromServer().then(renderFavs);
        } else if (tab === 'refs') {
      loadRefs();
        } else if (tab === 'details') {
      loadDetails('orders'); // или currentDetailsTab, если ведёшь состояние
          }
        }

  document.querySelectorAll(".tabbar .tab").forEach(b=> b.addEventListener('click', ()=> activateTab(b)));
  // стартовая вкладка
  activateTab(document.querySelector('.tabbar .tab.active') || document.querySelector('.tabbar .tab[data-tab="catalog"]') || document.querySelector('.tabbar .tab'));

  // ====== Categories / Services ======
  let currentNetwork = null;
  let servicesAll = [];

  async function loadCategories(){
    if (!catsListEl) return;
    catsListEl.innerHTML = '';
    try{
      const r = await fetch(bust(`${API_BASE}/services`));
      const items = await r.json();
      renderCategories(items);
    }catch(_){
      renderCategories([
        {id:'telegram', name:'Telegram',  desc:'подписчики, просмотры'},
        {id:'tiktok',   name:'TikTok',    desc:'просмотры, фолловеры'},
        {id:'instagram',name:'Instagram', desc:'подписчики, лайки'},
        {id:'youtube',  name:'YouTube',   desc:'просмотры, подписки'},
        {id:'facebook', name:'Facebook',  desc:'лайки, подписчики'},
      ]);
    }
  }
  function renderCategories(items){
    catsListEl.innerHTML = '';
    items.forEach(c=>{
      const a = document.createElement('a');
      a.href = '#';
      a.className = 'cat';
      a.dataset.cat = c.id;
      a.innerHTML = `
        <div class="cat-icon"><img src="static/img/${c.id}.svg" alt=""></div>
        <div class="cat-body">
          <div class="cat-name">${c.name}</div>
          <div class="cat-desc">${c.desc || ''}${c.count ? ' • '+c.count : ''}</div>
        </div>`;
      a.addEventListener('click', e => { e.preventDefault(); openServices(c.id, c.name); });
      catsListEl.appendChild(a);
    });
  }

  async function openServices(network, title){
    currentNetwork = network;
    if (servicesTitleEl) servicesTitleEl.textContent = title || 'Услуги';
    showPage("page-services");
    renderServicesSkeleton(4);
    try{
      const r = await fetch(bust(`${API_BASE}/services/${network}`));
      const items = await r.json();
      servicesAll = Array.isArray(items) ? items : [];
      if (servicesSearchEl) servicesSearchEl.value = '';
      applyServicesFilter();
    }catch(_){
      servicesListEl.innerHTML = '<div class="empty">Не удалось загрузить услуги</div>';
    }
  }

  function renderServicesSkeleton(n){
    servicesListEl.innerHTML = '';
    for (let i=0;i<n;i++){
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

  function applyServicesFilter(){
    const q = (servicesSearchEl?.value || '').trim().toLowerCase();
    const filtered = !q ? servicesAll : servicesAll.filter(s=>{
      const hay = [s.name, s.type, s.category, s.desc, s.description].filter(Boolean).join(' ').toLowerCase();
      return hay.includes(q);
    });
    renderServices(filtered);
  }
  servicesSearchEl?.addEventListener('input', applyServicesFilter);

  function renderServices(items){
    servicesListEl.innerHTML = '';
    if (!Array.isArray(items) || !items.length){
      servicesListEl.innerHTML = '<div class="empty">Нет услуг в этой категории</div>';
      return;
    }
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
      row.addEventListener('click', ()=> openServicePage(s));
      row.querySelector('button')?.addEventListener('click', (e)=>{ e.stopPropagation(); openServicePage(s); });
      servicesListEl.appendChild(row);
    });
  }

  // ====== Favorites (local mirror + server ping) ======
  function favLoad(){ try { return JSON.parse(localStorage.getItem('smm_favs') || '[]'); } catch(_){ return []; } }
  function favSave(a){ localStorage.setItem('smm_favs', JSON.stringify(a||[])); }
  function favHas(id){ return favLoad().some(x=>x.id===id); }
  function favAdd(item){ const a=favLoad(); if (!a.some(x=>x.id===item.id)){ a.push(item); favSave(a); } }
  function favRemove(id){ favSave(favLoad().filter(x=>x.id!==id)); }
  function renderFavs(){
    const box = pages.favs?.querySelector('.fav-list');
    if (!box) return;
    const items = favLoad();
    box.innerHTML = '';
    if (!items.length){ box.innerHTML = '<div class="empty">Избранных услуг пока нет.</div>'; return; }
    items.forEach(s=>{
      const row = document.createElement('div'); row.className='service';
      row.innerHTML = `
        <div class="left">
          <div class="name">${s.name}</div>
          <div class="meta">Сервис ID: ${s.id}${s.network ? ' • '+s.network : ''}</div>
        </div>
        <div class="right"><button class="btn" data-id="${s.id}">Открыть</button></div>`;
      row.querySelector('button')?.addEventListener('click', ()=> openServicePage(s._raw || {service:s.id, name:s.name, min:s.min||1, max:s.max||100000, rate_client_1000:s.rate||0, currency:s.currency||currentCurrency}));
      box.appendChild(row);
    });
  }
async function syncFavsFromServer(){
  try{
    const uid = userId || seq;
    const r = await fetch(`${API_BASE}/favorites?user_id=${encodeURIComponent(uid)}`);
    if(!r.ok) return;
    const arr = await r.json();
    if(!Array.isArray(arr)) return;

    // сминаем серверные в локальные (объединяем по id)
    const map = new Map(favLoad().map(x => [x.id, x]));
    arr.forEach(s => {
      map.set(s.service, {
        id: s.service,
        name: s.name,
        network: s.network,
        min: s.min, max: s.max,
        rate: s.rate_client_1000,
        currency: s.currency,
        _raw: { ...s, service: s.service },
      });
    });
    favSave(Array.from(map.values()));
  }catch(_){}
}


  // ====== Full service page ======
  function presetValues(min,max){
    const base=[100,500,1000,2500,5000,10000];
    const arr=base.filter(q=>q>=min&&q<=max);
    if (arr.length) return arr;
    const a=[]; let q=min;
    for(let i=0;i<6;i++){ a.push(q); q=Math.min(max,Math.round(q*2)); if(q===a[a.length-1]) break; }
    return a.slice(0,6);
  }
  function priceFor(q,s){ return Math.max(0, Number(s.rate_client_1000||0) * Number(q||0) / 1000); }

  function openServicePage(s){
    if (!s) return;
    const min = Number(s.min||1), max = Number(s.max||100000);
    const presets = presetValues(min,max);
    const cur = Math.max(min, Math.min(presets[0]||min, max));
    const currency = (s.currency||currentCurrency);

    if (serviceTitleEl) serviceTitleEl.textContent = s.name || 'Услуга';

    serviceDetailsEl.innerHTML = `
      <div class="svc">
        <div class="card">
          <div class="label">Количество</div>
          <div class="qty-grid" id="qtyGrid"></div>
          <div class="qty-input">
            <input id="svcQty" type="number" min="${min}" max="${max}" step="1" value="${cur}">
            <div class="chips">
              <button class="chip" id="chipMin">мин ${min}</button>
              <button class="chip" id="chipMax">макс ${max}</button>
            </div>
          </div>
        </div>

        <div class="card">
          <div class="field">
            <div class="label">Ссылка</div>
            <input id="svcLink" type="url" placeholder="https://...">
            <div class="error" id="svcLinkErr">Обязательное поле</div>
          </div>
          <button class="promo-toggle chip" id="promoToggle">У меня есть промокод</button>
          <div class="promo-wrap" id="promoWrap">
            <input id="promoInput" type="text" placeholder="Промокод">
            <button class="chip" id="promoApply">Активировать</button>
          </div>
        </div>

        <div class="card summary">
          <div class="sum-row"><span>Количество</span><b id="sumQty">${cur}</b></div>
          <div class="sum-row"><span>Цена</span><b id="sumPrice">${priceFor(cur,s).toFixed(4)}${curSign(currency)}</b></div>
          <button class="btn btn-primary btn-lg" id="svcCreate">Создать заказ</button>
        </div>

        <div class="card desc" id="svcDesc">${s.description || s.desc || s.note || s.notes || 'Описание будет добавлено позже.'}</div>

        <div class="card">
          <div class="fav-row">
            <div class="fav-left">
              <img class="heart" src="static/img/tab-favorites.svg" alt="">
              <span>Избранное</span>
            </div>
            <label class="switch">
              <input id="favToggle" type="checkbox">
              <span class="slider"></span>
            </label>
          </div>
        </div>
      </div>`;

    const qtyGrid   = document.getElementById('qtyGrid');
    const qtyInput  = document.getElementById('svcQty');
    const chipMin   = document.getElementById('chipMin');
    const chipMax   = document.getElementById('chipMax');
    const sumQty    = document.getElementById('sumQty');
    const sumPrice  = document.getElementById('sumPrice');
    const linkEl    = document.getElementById('svcLink');
    const linkErr   = document.getElementById('svcLinkErr');
    const promoToggle = document.getElementById('promoToggle');
    const promoWrap   = document.getElementById('promoWrap');
    const promoInput  = document.getElementById('promoInput');
    const promoApply  = document.getElementById('promoApply');
    const btnCreate   = document.getElementById('svcCreate');
    const favToggle   = document.getElementById('favToggle');

    qtyGrid.innerHTML = '';
    presets.forEach(q=>{
      const btn=document.createElement('button');
      btn.className='qty';
      btn.innerHTML = `<div class="num">${q.toLocaleString('ru-RU')}</div>
                       <div class="price">${priceFor(q,s).toFixed(4)}${curSign(currency)}</div>`;
      if (q===cur) btn.classList.add('active');
      btn.addEventListener('click', ()=>{
        qtyGrid.querySelectorAll('.qty').forEach(x=>x.classList.remove('active'));
        btn.classList.add('active');
        qtyInput.value = String(q);
        sumQty.textContent = q;
        sumPrice.textContent = `${priceFor(q,s).toFixed(4)}${curSign(currency)}`;
      });
      qtyGrid.appendChild(btn);
    });

    chipMin?.addEventListener('click', ()=>{
      const q=min; qtyInput.value=String(q);
      qtyGrid.querySelectorAll('.qty').forEach(x=>x.classList.remove('active'));
      sumQty.textContent=q; sumPrice.textContent=`${priceFor(q,s).toFixed(4)}${curSign(currency)}`;
    });
    chipMax?.addEventListener('click', ()=>{
      const q=max; qtyInput.value=String(q);
      qtyGrid.querySelectorAll('.qty').forEach(x=>x.classList.remove('active'));
      sumQty.textContent=q; sumPrice.textContent=`${priceFor(q,s).toFixed(4)}${curSign(currency)}`;
    });

    qtyInput?.addEventListener('input', ()=>{
      let q=parseInt(qtyInput.value||'0',10);
      if(!Number.isFinite(q)) q=min;
      q=Math.max(min, Math.min(max, q));
      sumQty.textContent=q;
      sumPrice.textContent=`${priceFor(q,s).toFixed(4)}${curSign(currency)}`;
    });

    promoToggle?.addEventListener('click', ()=> promoWrap?.classList.toggle('show'));
    promoApply?.addEventListener('click', ()=>{
      const code=(promoInput?.value||'').trim();
      if(!code){ alert('Введите промокод'); return; }
      alert('Промокод принят (визуально). Скидка будет применена при обработке заказа.');
    });

    const isFav = favHas(s.service);
    favToggle.checked = isFav;
    favToggle.addEventListener('change', ()=>{
      if (favToggle.checked){
        favAdd({ id:s.service, name:s.name, network:currentNetwork, min:s.min, max:s.max, rate:s.rate_client_1000, currency:s.currency, _raw:s });
        fetch(`${API_BASE}/favorites`, { method:'POST', headers:{'Content-Type':'application/json'},
          body: JSON.stringify({ user_id:userId||seq, service_id:s.service })
        }).catch(()=>{});
      } else {
        favRemove(s.service);
        fetch(`${API_BASE}/favorites/${s.service}?user_id=${encodeURIComponent(userId||seq)}`, { method:'DELETE' }).catch(()=>{});
      }
    });

    btnCreate?.addEventListener('click', async ()=>{
      const link=(linkEl?.value||'').trim();
      const q   = parseInt(qtyInput?.value||'0',10);
      if (!link){ linkErr?.classList.add('show'); linkEl?.focus(); return; }
      linkErr?.classList.remove('show');
      if (q<min || q>max){ alert(`Количество должно быть от ${min} до ${max}`); return; }

      btnCreate.disabled = true; btnCreate.textContent = 'Оформляем...';
      try{
        const body = { user_id:userId||seq, service:s.service, link, quantity:q };
        const promo=(promoInput?.value||'').trim(); if (promo) body.promo_code=promo;
        const r = await fetch(`${API_BASE}/order/create`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) });
        if (!r.ok) throw new Error(await r.text());
        const j = await r.json();
        alert(`Заказ создан!\nНомер: ${j.order_id}\nСумма: ${j.cost} ${j.currency}`);
        await fetchProfile();
      }catch(e){
        alert('Не удалось создать заказ: ' + (e?.message||e));
      }finally{
        btnCreate.disabled = false; btnCreate.textContent = 'Создать заказ';
      }
    });

    showPage("page-service");
    try { history.replaceState(null, '', `#service-${s.service}`); } catch(_) {}
  }

  btnBackToCats?.addEventListener('click', ()=> showPage("page-categories"));
  btnBackToServices?.addEventListener('click', ()=> showPage("page-services"));

  // стартовая загрузка категорий
  loadCategories();
  syncFavsFromServer().then(renderFavs);

  // === Рефералка ===
  async function loadRefs() {
    const tg = (window.Telegram && window.Telegram.WebApp) ? window.Telegram.WebApp : null;
    const page = document.getElementById("page-refs");
    if (!page) return;

    page.innerHTML = `
      <div class="card" style="padding:16px">
        <div class="skeleton-line" style="width:60%"></div>
        <div class="skeleton-line" style="width:90%;margin-top:10px"></div>
      </div>
    `;

    try {
      const API_BASE = (typeof window.API_BASE === "string" && window.API_BASE) ? window.API_BASE : "/api/v1";

      let uid = null;
      try { uid = tg && tg.initDataUnsafe && tg.initDataUnsafe.user && tg.initDataUnsafe.user.id; } catch (_) {}
      if (!uid && window.USER_ID) uid = window.USER_ID;

      const url = API_BASE + "/referrals/stats" + (uid ? ("?user_id=" + encodeURIComponent(uid)) : "");
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) throw new Error("HTTP " + res.status);
      const data = await res.json();

      const inviteLink = String(data.invite_link || data.link || "");
      const rate = Number(data.rate_percent != null ? data.rate_percent : 10);
      const threshold = Number(data.threshold != null ? data.threshold : 50);
      const invited = Number(data.invited_total != null ? data.invited_total : 0);
      const withDep = Number(data.invited_with_deposit != null ? data.invited_with_deposit : 0);
      const earnedRaw = (data.earned_total != null ? data.earned_total : 0);
      const earned = typeof earnedRaw === "number" ? earnedRaw.toFixed(2) : String(earnedRaw);
      const currency = String(data.earned_currency || data.currency || "₽");

      const denom = threshold > 0 ? threshold : 50;
      const prog = Math.max(0, Math.min(100, Math.round((withDep / denom) * 100)));

      page.innerHTML = `
        <div class="ref">

          <!-- HERO -->
          <div class="card ref-hero">
              <div class="ref-ico">
                  <img src="static/img/tab-referrals.svg" alt="" class="ref-ico-img">
              </div>
            <div class="ref-h1">
              Приглашайте пользователей <br> и получайте от <span class="accent">10%</span> их платежей
            </div>
            <div class="ref-h2">
              Средства автоматически поступают на ваш баланс.
              Полученные деньги вы можете тратить на <br> продвижение и испытывать удачу в рулетке.
            </div>
          </div>

          <!-- ССЫЛКА -->
          <div class="label">Ваша ссылка</div>
          <div class="card ref-linkbar" id="refLinkBar">
            <input id="refLinkInput" type="text" readonly aria-label="Ваша ссылка" />
            <button class="ref-copy" id="refCopyBtn" aria-label="Копировать">
              <svg viewBox="0 0 24 24" fill="none">
                <path d="M9 9.5A2.5 2.5 0 0 1 11.5 7H17a2 2 0 0 1 2 2v5.5A2.5 2.5 0 0 1 16.5 17H11a2 2 0 0 1-2-2V9.5Z" stroke="currentColor" stroke-width="1.6"/>
                <path d="M7 14.5A2.5 2.5 0 0 1 4.5 12V6a2 2 0 0 1 2-2H12.5A2.5 2.5 0 0 1 15 6.5" stroke="currentColor" stroke-width="1.6"/>
              </svg>
            </button>
          </div>
          <div class="ref-note">
            Пригласите 50 человек которые внесут депозит <br> и ваш процент увеличится до <span class="accent">20%</span> навсегда
          </div>

          <!-- ПРОГРЕСС -->
          <div class="card ref-progress-card">
            <div class="row between">
              <div class="muted">Прогресс до 20%</div>
            </div>
            <div class="ref-progress"><div class="ref-progress__bar" style="width:${prog}%;"></div></div>
            <div class="ref-progress-meta">
              <span>Рефералов с депозитом ${withDep} из ${threshold}</span>
            </div>
          </div>

          <!-- СТАТИСТИКА -->
          <div class="ref-h3">Статистика</div>
          <div class="ref-stats">
            <div class="ref-stat">
              <div class="sm">Приглашено</div>
              <div class="lg">${invited}</div>
            </div>
            <div class="ref-stat">
              <div class="sm">С депозитом</div>
              <div class="lg">${withDep}</div>
            </div>
            <div class="ref-stat">
              <div class="sm">Начислено</div>
              <div class="lg">${earned} ${currency}</div>
            </div>
          </div>

        </div>
      `;

      const input = document.getElementById("refLinkInput");
      if (input) input.value = inviteLink;

      const bar  = document.getElementById("refLinkBar");
      const btn  = document.getElementById("refCopyBtn");

      async function copyLink() {
        const text = (input && input.value) ? input.value : inviteLink;
        try {
          if (navigator.clipboard && navigator.clipboard.writeText) {
            await navigator.clipboard.writeText(text);
          } else {
            const ta = document.createElement("textarea");
            ta.value = text;
            document.body.appendChild(ta);
            ta.select();
            document.execCommand("copy");
            document.body.removeChild(ta);
          }
          if (tg && tg.HapticFeedback && tg.HapticFeedback.notificationOccurred) {
            tg.HapticFeedback.notificationOccurred("success");
          }
          bar && bar.classList.add("copied");
          setTimeout(() => { bar && bar.classList.remove("copied"); }, 600);
        } catch (err) {
          if (tg && tg.HapticFeedback && tg.HapticFeedback.notificationOccurred) {
            tg.HapticFeedback.notificationOccurred("error");
          }
          console.error("copy failed", err);
        }
      }

      bar && bar.addEventListener("click", copyLink);
      btn && btn.addEventListener("click", (e) => { e.stopPropagation(); copyLink(); });

    } catch (err) {
      console.error("loadRefs error:", err);
      page.innerHTML = `
        <div class="card" style="padding:16px">
          <div class="error-text">Не удалось загрузить данные рефералки. Попробуйте позже.</div>
        </div>
      `;
    }
  }

  // ====== Детализация ======

/* === statuses view map === */
const STATUS_MAP = {
  processing:   { label: "В обработке", cls: "badge--processing" },
  "in progress":{ label: "В обработке", cls: "badge--processing" },
  awaiting:     { label: "В обработке", cls: "badge--processing" },
  pending:      { label: "В обработке", cls: "badge--processing" },

  completed:    { label: "Завершён",    cls: "badge--completed"  },

  canceled:     { label: "Отменён",     cls: "badge--failed"     },
  cancelled:    { label: "Отменён",     cls: "badge--failed"     },
  failed:       { label: "Отменён",     cls: "badge--failed"     },
};
const stInfo = code => STATUS_MAP[String(code||"").toLowerCase()] || { label:String(code||"—"), cls:"badge--processing" };



  async function apiFetchOrders(uid, status) {
    const q = new URLSearchParams({ user_id: String(uid) });
    if (status && status !== "all") q.set("status", status);
    const r = await fetch(bust(`${API_BASE}/orders?${q.toString()}`), { credentials: "include" });
    if (!r.ok) throw new Error("orders HTTP " + r.status);
    return r.json();
  }
  async function apiFetchPayments(uid, status) {
    const q = new URLSearchParams({ user_id: String(uid) });
    if (status && status !== "all") q.set("status", status);
    const r = await fetch(bust(`${API_BASE}/payments?${q.toString()}`), { credentials: "include" });
    if (!r.ok) throw new Error("payments HTTP " + r.status);
    return r.json();
  }

/* ===== Детализация (Orders/Payments) — кэш и мгновенная фильтрация ===== */
async function loadDetails(defaultTab = "orders") {
  const page = document.getElementById("page-details");
  if (!page) return;
  const uid = (tg?.initDataUnsafe?.user?.id) || (window.USER_ID) || seq;

  // локальные кэши (живут, пока не уйдём со страницы)
  let ORDERS_CACHE = null;   // массив заказов или null, если не загружали
  let PAYMENTS_CACHE = null; // массив платежей или null

  page.innerHTML = `
    <div class="details-head details-head--center">
      <div class="seg" id="detailsSeg">
        <button class="seg__btn ${defaultTab==="orders"?"seg__btn--active":""}" data-tab="orders">Заказы</button>
        <button class="seg__btn ${defaultTab==="payments"?"seg__btn--active":""}" data-tab="payments">Платежи</button>
      </div>
    </div>
    <div id="detailsFilters"></div>
    <div class="list" id="detailsList">
      <div class="skeleton" style="height:60px"></div>
      <div class="skeleton" style="height:60px"></div>
    </div>
  `;

  const seg = document.getElementById("detailsSeg");
  const filtersWrap = document.getElementById("detailsFilters");
  const list = document.getElementById("detailsList");

  function renderOrdersFromCache(filter = "all") {
    if (!Array.isArray(ORDERS_CACHE) || !ORDERS_CACHE.length) {
      list.innerHTML = `<div class="empty">Заказы не найдены</div>`;
      return;
    }
    const norm = s => String(s||"").toLowerCase();
    const items = ORDERS_CACHE.filter(o => {
      if (filter === "all") return true;
      const s = norm(o.status);
      if (filter === "processing") return ["processing","in progress","awaiting","pending"].includes(s);
      if (filter === "completed")  return s === "completed";
      if (filter === "failed")     return ["failed","canceled","cancelled"].includes(s);
      return true;
    });

    if (!items.length) {
      list.innerHTML = `<div class="empty">По этому фильтру ничего нет</div>`;
      return;
    }

    list.innerHTML = items.map(o => {
      const st = stInfo(o.status);
      const title = o.service || "Услуга";
      const cat = o.category ? `${o.category} • ` : "";
      const sum = `${(o.price ?? 0)} ${(o.currency || "₽")}`;
      return `
        <div class="order">
          <div class="order__avatar">${(o.category || o.service || "?").slice(0,1).toUpperCase()}</div>
          <div class="order__body">
            <div class="order__head">
              <div class="order__title">${title}</div>
              <span class="badge ${st.cls}">${st.label}</span>
            </div>
            <div class="order__meta">${cat}Количество: ${o.quantity} • ${fmtDate(o.created_at)}</div>
            <div class="order__foot">
              <div class="order__sum">${sum}</div>
              <div class="order__id">#${o.id}</div>
            </div>
          </div>
        </div>
      `;
    }).join("");
  }

  async function renderOrders(filter = "all") {
    // чипсы (гориз. скролл) — и сразу навешиваем обработчики
    filtersWrap.innerHTML = `
      <div class="filters">
        <button class="filter ${filter==="all"?"active":""}" data-f="all">Все</button>
        <button class="filter ${filter==="processing"?"active":""}" data-f="processing">В обработке</button>
        <button class="filter ${filter==="completed"?"active":""}" data-f="completed">Завершён</button>
        <button class="filter ${filter==="failed"?"active":""}" data-f="failed">Отменённые</button>
      </div>
    `;
    filtersWrap.querySelectorAll(".filter").forEach(b => {
      b.addEventListener("click", () => {
        filtersWrap.querySelectorAll(".filter").forEach(x=>x.classList.toggle("active", x===b));
        renderOrdersFromCache(b.dataset.f);
      });
    });

    // если уже есть кэш — только перерисовываем
    if (Array.isArray(ORDERS_CACHE)) {
      renderOrdersFromCache(filter);
      return;
    }

    // иначе грузим один раз
    list.innerHTML = `<div class="skeleton" style="height:60px"></div><div class="skeleton" style="height:60px"></div>`;
    try {
      const q = new URLSearchParams({ user_id:String(uid) });
      const r = await fetch(bust(`${API_BASE}/orders?${q.toString()}`), { credentials:"include" });
      ORDERS_CACHE = r.ok ? await r.json() : [];
    } catch { ORDERS_CACHE = []; }

    renderOrdersFromCache(filter);
  }

  function renderPaymentsFromCache() {
    if (!Array.isArray(PAYMENTS_CACHE) || !PAYMENTS_CACHE.length) {
      list.innerHTML = `<div class="empty">Платежей пока нет</div>`;
      return;
    }
    list.innerHTML = PAYMENTS_CACHE.map(p=>{
      const st  = stInfo(p.status);
      const sum = `${(p.amount ?? 0)} ${(p.currency || "₽")}`;
      const prov = String(p.method || "cryptobot").toLowerCase();
      const sub = `${prov} • ${fmtDate(p.created_at)} • #${p.id}`;
      const ico = `static/img/${prov}.svg`; // cryptobot.svg положить в static/img
      return `
        <div class="pay">
          <div class="pay__ico"><img src="${ico}" alt="${prov}" class="pay__ico-img"></div>
          <div class="pay__body">
            <div class="pay__top">
              <div class="pay__sum">${sum}</div>
              <span class="badge ${st.cls}">${st.label}</span>
            </div>
            <div class="pay__sub">${sub}</div>
          </div>
        </div>
      `;
    }).join("");
  }

  async function renderPayments() {
    filtersWrap.innerHTML = "";
    if (Array.isArray(PAYMENTS_CACHE)) {
      renderPaymentsFromCache();
      return;
    }
    list.innerHTML = `<div class="skeleton" style="height:60px"></div>`;
    try {
      const q = new URLSearchParams({ user_id:String(uid) });
      const r = await fetch(bust(`${API_BASE}/payments?${q.toString()}`), { credentials:"include" });
      PAYMENTS_CACHE = r.ok ? await r.json() : [];
    } catch { PAYMENTS_CACHE = []; }
    renderPaymentsFromCache();
  }

  async function switchTab(tab) {
    seg.querySelectorAll(".seg__btn").forEach(b=>b.classList.toggle("seg__btn--active", b.dataset.tab===tab));
    if (tab === "orders") await renderOrders("all"); else await renderPayments();
  }

  await switchTab(defaultTab);
  seg.querySelectorAll(".seg__btn").forEach(btn => btn.addEventListener("click", () => switchTab(btn.dataset.tab)));
}


  // ====== Keyboard inset -> CSS var --kb ======
  (function keyboardLift(){
    const root=document.documentElement;
    function applyKbInset(px){ const v = px>40 ? px : 0; root.style.setProperty('--kb', v+'px'); }
    if (window.visualViewport){
      const vv=window.visualViewport;
      const handler=()=>{ const inset=Math.max(0, window.innerHeight - vv.height - vv.offsetTop); applyKbInset(inset); };
      vv.addEventListener('resize', handler);
      vv.addEventListener('scroll', handler);
      handler();
    }
    try{
      tg?.onEvent?.('viewportChanged', (e)=>{
        const vh=(e&&(e.height||e.viewportHeight)) || tg?.viewportHeight || tg?.viewport?.height;
        if (!vh) return; const inset=Math.max(0, window.innerHeight - vh); applyKbInset(inset);
      });
    }catch(_){}
  })();
})();
