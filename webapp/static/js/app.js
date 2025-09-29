/* Slovekiza Mini-App
 * - Стабильная идентификация пользователя (не уходит в "Гость")
 * - Профиль, баланс, оверлей успешного пополнения (consume_topup)
 * - Категории / Услуги / Страница услуги (поддержка "Повторить")
 * - Избранное (локально) + синк с сервером
 * - Рефералка (линк, прогресс, статы)
 * - Детализация (Заказы / Платежи) + модалки
 * - Реф-начисления как платежи (иконка method=ref_bonus/type=referral)
 * - Скрытие таббара при открытой клавиатуре (body.kb-open)
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
  const sleep = (ms)=> new Promise(r=>setTimeout(r, ms));
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
      let ts = typeof val === 'number' ? val : Number(val);
      if (!Number.isFinite(ts)) return String(val);
      if (ts < 1e12) ts *= 1000;
      const dt = new Date(ts);
      const dd = String(dt.getDate()).padStart(2,'0');
      const mm = String(dt.getMonth()+1).padStart(2,'0');
      const yy = String(dt.getFullYear()).slice(-2);
      const hh = String(dt.getHours()).padStart(2,'0');
      const mi = String(dt.getMinutes()).padStart(2,'0');
      return `${dd}.${mm}.${yy} ${hh}:${mi}`;
    } catch(_) { return String(val); }
  }

  function stableHashId(x){ let h=0,s=String(x||''); for(let i=0;i<s.length;i++){ h=((h<<5)-h+s.charCodeAt(i))|0; } h=Math.abs(h); return (h%100000)+1; }

  // --- user identity (избегаем "Гость" при оплате) ---
  const UID = {
    tgId: null,          // Telegram user id, если есть
    localSeq: null,      // локальный фоллбек (анон)
    serverSeq: null,     // seq от бэка (красивый #)
    async init() {
      // локальный фоллбек сразу
      const saved = parseInt(localStorage.getItem('smm_user_seq')||'0',10);
      this.localSeq = Number.isFinite(saved) && saved>0 ? saved : stableHashId('anon:'+Math.random());
      // на всякий ждем initDataUnsafe (до ~800мс)
      for (let i=0;i<10;i++){
        try { this.tgId = tg?.initDataUnsafe?.user?.id || null; } catch(_) {}
        if (this.tgId) break;
        await sleep(80);
      }
      return this.id();
    },
    id() {
      // ВАЖНО: если есть Telegram ID, ВСЕГДА шлем его.
      // Фоллбек в localSeq только когда tgId нет вообще (открыли в браузере).
      return this.tgId || this.serverSeq || this.localSeq;
    },
    setServerSeq(n){
      if (!n) return;
      this.serverSeq = Number(n) || null;
      if (this.serverSeq) {
        localStorage.setItem('smm_user_seq', String(this.serverSeq));
      }
    }
  };

  // ===== Avatar & nickname (ранний пререндер) =====
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

  // — сеть из текста + путь к иконке
  function netFromText(name, category){
    const t = `${name || ""} ${category || ""}`.toLowerCase();
    if (t.includes('telegram') || t.includes(' tg ')) return 'telegram';
    if (t.includes('tiktok')   || t.includes('tik tok')) return 'tiktok';
    if (t.includes('instagram')|| t.includes(' insta') || t.includes(' ig ')) return 'instagram';
    if (t.includes('youtube')  || t.includes(' yt '))   return 'youtube';
    if (t.includes('facebook') || t.includes(' fb '))   return 'facebook';
    return 'generic';
  }
  function netIcon(net){ return `static/img/${net}.svg`; }

  // --- modal helpers ---
  function ensureModal(){
    let m = document.getElementById('appModal');
    if (m) return m;
    m = document.createElement('div');
    m.className = 'modal'; m.id = 'appModal'; m.setAttribute('aria-hidden','true');
    m.innerHTML = `
      <div class="modal-backdrop"></div>
      <div class="modal-card" role="dialog" aria-modal="true"><div class="modal-content"></div></div>`;
    document.body.appendChild(m);
    m.querySelector('.modal-backdrop').addEventListener('click', closeModal);
    return m;
  }
  function openModal(html){
    const m = ensureModal();
    m.querySelector('.modal-content').innerHTML = html;
    m.setAttribute('aria-hidden','false');
  }
  function closeModal(){
    const m = document.getElementById('appModal');
    if (m) m.setAttribute('aria-hidden','true');
  }

  // ====== Topup overlay ======
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

  // ====== profile / identity ======
  let currentCurrency = "RUB";
  let lastBalance = 0;

  // единый способ получить корректный uid перед любым API-вызовом
  async function uidForApi(){
    // дождемся первичной инициализации
    await UID.init();
    // если tgId все еще нет — дадим маленькую паузу (часто initData появляется через 1-2 тика)
    if (!UID.tgId) { for (let i=0;i<6;i++){ try{ UID.tgId = tg?.initDataUnsafe?.user?.id || null; }catch(_){} if (UID.tgId) break; await sleep(60); } }
    return UID.id();
  }

  // хранить последний профиль
  let lastProfile = null;

  async function fetchProfile(){
    try {
      const uid = await uidForApi();
      const qp = new URLSearchParams({ user_id: String(UID.tgId || uid), consume_topup: '1' });
      const r = await fetch(bust(`${API_BASE}/user?${qp.toString()}`));
      if (!r.ok) throw 0;
      const p = await r.json();
      lastProfile = p;

      if (p.seq){
        UID.setServerSeq(p.seq);
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

      const uid = await uidForApi(); // КЛЮЧЕВОЕ: не уходим в localSeq, если есть tgId
      const r = await fetch(`${API_BASE}/pay/invoice`, {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ user_id: UID.tgId || uid, amount_usd: amount }),
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
    if (tab==='details')                     return "page-details";
    return "page-categories";
  }
  function activateTab(btn){
    document.querySelectorAll(".tabbar .tab")
      .forEach(b => b.classList.toggle("active", b === btn));

    const tab = btn?.dataset?.tab || 'catalog';
    const id  = pageIdByTab(tab);
    showPage(id);

    if (tab === 'favs') {
      syncFavsFromServer().then(renderFavs);
    } else if (tab === 'refs') {
      loadRefs();
    } else if (tab === 'details') {
      loadDetails('orders');
    }
  }
  document.querySelectorAll(".tabbar .tab").forEach(b=> b.addEventListener('click', ()=> activateTab(b)));
  activateTab(document.querySelector('.tabbar .tab.active')
           || document.querySelector('.tabbar .tab[data-tab="catalog"]')
           || document.querySelector('.tabbar .tab'));

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

  // ====== Favorites ======
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
      const uid = await uidForApi();
      const r = await fetch(`${API_BASE}/favorites?user_id=${encodeURIComponent(UID.tgId || uid)}`);
      if(!r.ok) return;
      const arr = await r.json();
      if(!Array.isArray(arr)) return;

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

  async function fetchServiceById(serviceId, netHint){
    if (Array.isArray(servicesAll) && servicesAll.length){
      const found = servicesAll.find(s => Number(s.service) === Number(serviceId));
      if (found) return found;
    }
    const net = netHint || currentNetwork || 'telegram';
    try{
      const r = await fetch(bust(`${API_BASE}/services/${net}`));
      const arr = r.ok ? await r.json() : [];
      return arr.find(s => Number(s.service) === Number(serviceId)) || null;
    }catch(_){ return null; }
  }
  async function findServiceByName(net, name){
    const lower = String(name||'').toLowerCase();
    if (Array.isArray(servicesAll) && servicesAll.length && net===currentNetwork){
      const f = servicesAll.find(s => String(s.name||'').toLowerCase() === lower);
      if (f) return f;
    }
    try{
      const r = await fetch(bust(`${API_BASE}/services/${net}`));
      const arr = r.ok ? await r.json() : [];
      return arr.find(s => String(s.name||'').toLowerCase() === lower) || null;
    }catch(_){ return null; }
  }

  function openServicePage(s, opts={}){
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
        uidForApi().then(uid=>{
          fetch(`${API_BASE}/favorites`, { method:'POST', headers:{'Content-Type':'application/json'},
            body: JSON.stringify({ user_id: UID.tgId || uid, service_id:s.service })
          }).catch(()=>{});
        });
      } else {
        favRemove(s.service);
        uidForApi().then(uid=>{
          fetch(`${API_BASE}/favorites/${s.service}?user_id=${encodeURIComponent(UID.tgId || uid)}`, { method:'DELETE' }).catch(()=>{});
        });
      }
    });

    // Prefill из opts (для "Повторить заказ")
    const presetQty  = Number(opts.qty || 0);
    const presetLink = String(opts.link || '');
    if (presetLink && linkEl) linkEl.value = presetLink;
    if (presetQty && qtyInput){
      const q = Math.max(min, Math.min(max, presetQty));
      qtyInput.value = String(q);
      sumQty.textContent = q;
      sumPrice.textContent = `${priceFor(q,s).toFixed(4)}${curSign(currency)}`;
      qtyGrid?.querySelectorAll('.qty').forEach(btn=>{
        const num = parseInt(btn.querySelector('.num')?.textContent.replace(/\s/g,'')||'0',10);
        btn.classList.toggle('active', num === q);
      });
    }

    btnCreate?.addEventListener('click', async ()=>{
      const link=(linkEl?.value||'').trim();
      const q   = parseInt(qtyInput?.value||'0',10);
      if (!link){ linkErr?.classList.add('show'); linkEl?.focus(); return; }
      linkErr?.classList.remove('show');
      if (q<min || q>max){ alert(`Количество должно быть от ${min} до ${max}`); return; }

      btnCreate.disabled = true; btnCreate.textContent = 'Оформляем...';
      try{
        const uid = await uidForApi();
        const body = { user_id: UID.tgId || uid, service:s.service, link, quantity:q };
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

  // стартовая загрузка
  loadCategories();
  syncFavsFromServer().then(renderFavs);

  // === Рефералка ===
  async function loadRefs() {
    const page = document.getElementById("page-refs");
    if (!page) return;

    page.innerHTML = `
      <div class="card" style="padding:16px">
        <div class="skeleton-line" style="width:60%"></div>
        <div class="skeleton-line" style="width:90%;margin-top:10px"></div>
      </div>
    `;

    try {
      const uid = await uidForApi();
      const url = `${API_BASE}/referrals/stats?user_id=${encodeURIComponent(UID.tgId || uid)}`;
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) throw new Error("HTTP " + res.status);
      const data = await res.json();

      const inviteLink = String(data.invite_link || data.link || "");
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

          <div class="card ref-progress-card">
            <div class="row between">
              <div class="muted">Прогресс до 20%</div>
            </div>
            <div class="ref-progress"><div class="ref-progress__bar" style="width:${prog}%;"></div></div>
            <div class="ref-progress-meta">
              <span>Рефералов с депозитом ${withDep} из ${threshold}</span>
            </div>
          </div>

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
          if (navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(text);
          } else {
            const ta = document.createElement("textarea");
            ta.value = text;
            document.body.appendChild(ta);
            ta.select();
            document.execCommand("copy");
            document.body.removeChild(ta);
          }
          tg?.HapticFeedback?.notificationOccurred?.("success");
          bar?.classList.add("copied");
          setTimeout(() => bar?.classList.remove("copied"), 600);
        } catch (err) {
          tg?.HapticFeedback?.notificationOccurred?.("error");
          console.error("copy failed", err);
        }
      }
      bar?.addEventListener("click", copyLink);
      btn?.addEventListener("click", (e) => { e.stopPropagation(); copyLink(); });

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

  function paymentIcon(p){
    const m = String(p.method || p.type || '').toLowerCase();
    if (m.includes('ref')) return 'static/img/ref_bonus.svg'; // ты добавишь иконку
    return `static/img/${m || 'cryptobot'}.svg`;
  }

  async function loadDetails(defaultTab = "orders") {
    const page = document.getElementById("page-details");
    if (!page) return;
    const uid = await uidForApi();

    let ORDERS_CACHE = null;
    let PAYMENTS_CACHE = null;

    page.innerHTML = `
      <div class="details-head details-head--center">
        <div class="seg seg--accent" id="detailsSeg">
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
        if (filter === "failed")     return ["failed","canceled","cancelled","failed"].includes(s);
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
        const net = netFromText(o.service, o.category);
        const ico = netIcon(net);
        return `
          <div class="order" data-id="${o.id}">
            <div class="order__ico"><img src="${ico}" class="order__ico-img" alt=""></div>
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

      list.querySelectorAll('.order').forEach(card=>{
        const id = Number(card.dataset.id);
        const o = ORDERS_CACHE.find(x => Number(x.id) === id);
        if (!o) return;
        card.addEventListener('click', ()=> showOrderModal(o));
      });
    }

    async function renderOrders(filter = "all") {
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

      if (Array.isArray(ORDERS_CACHE)) {
        renderOrdersFromCache(filter);
        return;
      }

      list.innerHTML = `<div class="skeleton" style="height:60px"></div><div class="skeleton" style="height:60px"></div>`;
      try {
        const q = new URLSearchParams({ user_id:String(UID.tgId || uid) });
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
        // Реф-начисления считаем завершёнными и помечаем иконкой
        const meth = String(p.method || p.type || '').toLowerCase();
        const st  = meth.includes('ref') ? {label:'Завершён', cls:'badge--completed'} : stInfo(p.status);
        const sum = `${(p.amount ?? 0)} ${(p.currency || "₽")}`;
        const prov = meth || "cryptobot";
        const sub = `${prov} • ${fmtDate(p.created_at)} • #${p.id}`;
        const ico = paymentIcon(p);
        return `
          <div class="pay" data-id="${p.id}">
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

      list.querySelectorAll('.pay').forEach(card=>{
        const id = Number(card.dataset.id);
        const p = PAYMENTS_CACHE.find(x => Number(x.id) === id);
        if (p) card.addEventListener('click', ()=> showPaymentModal(p));
      });
    }

    async function renderPayments() {
      filtersWrap.innerHTML = "";
      if (Array.isArray(PAYMENTS_CACHE)) {
        renderPaymentsFromCache();
        return;
      }
      list.innerHTML = `<div class="skeleton" style="height:60px"></div>`;
      try {
        const q = new URLSearchParams({ user_id:String(UID.tgId || uid), refresh:"1" });
        const r = await fetch(bust(`${API_BASE}/payments?${q.toString()}`), { credentials:"include" });
        PAYMENTS_CACHE = r.ok ? await r.json() : [];
      } catch { PAYMENTS_CACHE = []; }
      renderPaymentsFromCache();
    }

    function showOrderModal(o){
      const st = stInfo(o.status);
      const net = netFromText(o.service, o.category);
      const ico = netIcon(net);
      const sum = `${(o.price ?? 0)} ${(o.currency || "₽")}`;
      const linkHtml = o.link ? `<a href="${o.link}" target="_blank" rel="noopener">${o.link}</a>` : '—';

      openModal(`
        <h3>Заказ #${o.id}</h3>
        <div class="modal-row">
          <div style="display:flex; gap:10px; align-items:center">
            <div class="order__ico"><img src="${ico}" class="order__ico-img" alt=""></div>
            <div>
              <div style="font-weight:700">${o.service || 'Услуга'}</div>
              <div class="muted">${o.category || ''}</div>
            </div>
            <span class="badge ${st.cls}" style="margin-left:auto">${st.label}</span>
          </div>
        </div>
        <div class="modal-row"><div class="muted">Создан</div><div>${fmtDate(o.created_at)}</div></div>
        <div class="modal-row"><div class="muted">Количество</div><div>${o.quantity}</div></div>
        <div class="modal-row"><div class="muted">Сумма</div><div>${sum}</div></div>
        <div class="modal-row"><div class="muted">Ссылка</div><div style="word-break:break-all">${linkHtml}</div></div>
        ${o.provider_id ? `<div class="modal-row"><div class="muted">Поставщик</div><div>#${o.provider_id}</div></div>` : ''}

        <div class="modal-actions">
          <button class="btn btn-secondary" id="orderClose">Закрыть</button>
          <button class="btn btn-primary" id="orderRepeat">Повторить заказ</button>
        </div>
      `);

      document.getElementById('orderClose')?.addEventListener('click', closeModal);
      document.getElementById('orderRepeat')?.addEventListener('click', async ()=>{
        let svc = o.service_id ? await fetchServiceById(o.service_id, net) : null;
        if (!svc) svc = await findServiceByName(net, o.service);
        if (!svc){ alert('Не удалось найти услугу для повтора'); return; }
        closeModal();
        openServicePage(svc, { link: o.link, qty: o.quantity });
      });
    }

    function showPaymentModal(p){
      const meth = String(p.method || p.type || '').toLowerCase();
      const st = meth.includes('ref') ? {label:'Завершён', cls:'badge--completed'} : stInfo(p.status);
      const prov = meth || "cryptobot";
      const ico = paymentIcon(p);
      const sum = `${(p.amount ?? 0)} ${(p.currency || "₽")}`;

      openModal(`
        <h3>Платёж #${p.id}</h3>
        <div class="modal-row">
          <div style="display:flex; gap:10px; align-items:center">
            <div class="pay__ico"><img src="${ico}" class="pay__ico-img" alt=""></div>
            <div>
              <div style="font-weight:700">${sum}</div>
              <div class="muted">${prov}</div>
            </div>
            <span class="badge ${st.cls}" style="margin-left:auto">${st.label}</span>
          </div>
        </div>
        <div class="modal-row"><div class="muted">Создан</div><div>${fmtDate(p.created_at)}</div></div>
        ${p.invoice_id ? `<div class="modal-row"><div class="muted">Invoice ID</div><div>#${p.invoice_id}</div></div>`:''}
        ${p.amount_usd != null ? `<div class="modal-row"><div class="muted">Сумма (USD)</div><div>${p.amount_usd}</div></div>`:''}
        ${p.pay_url ? `<div class="modal-row"><a class="btn btn-primary" href="${p.pay_url}" target="_blank" rel="noopener">Открыть ссылку оплаты</a></div>`:''}
        <div class="modal-actions">
          <button class="btn btn-secondary" id="payClose">Закрыть</button>
        </div>
      `);
      document.getElementById('payClose')?.addEventListener('click', closeModal);
    }

    async function switchTab(tab) {
      seg.querySelectorAll(".seg__btn").forEach(b=>b.classList.toggle("seg__btn--active", b.dataset.tab===tab));
      if (tab === "orders") await renderOrders("all"); else await renderPayments();
    }

    await switchTab(defaultTab);
    seg.querySelectorAll(".seg__btn").forEach(btn => btn.addEventListener("click", () => switchTab(btn.dataset.tab)));
  }

  // ====== Keyboard inset -> CSS var --kb + hide tabbar ======
  (function keyboardLift(){
    const root=document.documentElement;
    function applyKbInset(px){
      const v = px>40 ? px : 0;
      root.style.setProperty('--kb', v+'px');
      document.body.classList.toggle('kb-open', v>40); // <- добавь в CSS: .kb-open .tabbar{display:none}
    }
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
