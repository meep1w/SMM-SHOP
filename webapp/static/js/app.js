/* Slovekiza Mini-App — промокоды + профиль + персональная наценка
 * - Профиль: отображение ника/SEQ/баланса/наценки, ввод промокодов (навсегда/баланс)
 * - Скидочный промокод на странице услуги (check + учёт в расчёте и заказе)
 * - Категории / Услуги / Страница услуги
 * - Избранное (локально) + синк с сервером
 * - Рефералка (линк, прогресс, статы)
 * - Детализация (Заказы / Платежи + реф-начисления) + модалки
 * - Скрытие таббара при открытой клавиатуре
 */

(function () {
  console.log('app.js ready (promos + profile)');

  // ====== Telegram WebApp ======
const tg = window.Telegram?.WebApp || null;

try {
  // корректная инициализация
  tg?.ready?.();
  tg?.expand?.();                 // растянуть на максимум
  tg?.disableVerticalSwipes?.();  // запрет pull-to-dismiss (свайп вниз)

  // скрываем стандартные кнопки, если вдруг активны
  tg?.MainButton?.hide?.();
  tg?.BackButton?.hide?.();

  // фирменные цвета шапки/фона (подставь свои при желании)
  const HEADER_COLOR = '#0e1013';
  const BG_COLOR     = '#0e1013';
  tg?.setHeaderColor?.(HEADER_COLOR);
  tg?.setBackgroundColor?.(BG_COLOR);

  // при смене темы в ТГ повторно задаём свои цвета
  tg?.onEvent?.('themeChanged', () => {
    tg?.setHeaderColor?.(HEADER_COLOR);
    tg?.setBackgroundColor?.(BG_COLOR);
  });
} catch (_) {}

// Глобальная версия (подставь из .env в index.html)
window.WEBAPP_VERSION = window.WEBAPP_VERSION || '2025-10-01-01';

// Добавляем ?v=... ко всем <img src="static/...">, если нет
(function bumpStaticImages() {
  const v = encodeURIComponent(window.WEBAPP_VERSION);
  document.querySelectorAll('img[src^="static/"]:not([src*="?v="])')
    .forEach(img => {
      const url = new URL(img.getAttribute('src'), location.origin);
      if (!url.searchParams.has('v')) {
        url.searchParams.set('v', v);
        img.setAttribute('src', url.pathname + '?' + url.searchParams.toString());
      }
    });
})();

  const API_BASE = "/api/v1";

  // ====== DOM ======
  const nicknameEl = document.getElementById("nickname");
  const avatarEl   = document.getElementById("avatar");
  const userSeqEl  = document.getElementById("userSeq");
  const balanceEl  = document.getElementById("balanceValue");
  const btnTopup   = document.getElementById("btnTopup");
  const profileBtn = document.getElementById("profileBtn");

  const pages = {
    catalog:  document.getElementById("page-categories"),
    services: document.getElementById("page-services"),
    service:  document.getElementById("page-service"),
    favs:     document.getElementById("page-favs"),
    refs:     document.getElementById("page-refs"),
    details:  document.getElementById("page-details"),
    profile:  null, // создадим динамически
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
  let userMarkup = null; // персональная наценка, если назначена

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

      userMarkup = (p.markup != null ? Number(p.markup) : null);
      updateProfilePageView();

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

  // ====== make Profile page (динамически) ======
  function ensureProfilePage() {
    if (pages.profile) return pages.profile;
    const wrap = document.createElement('section');
    wrap.id = 'page-profile';
    wrap.className = 'page';
    wrap.innerHTML = `
      <div class="subheader">
        <button class="back" id="btnBackFromProfile" aria-label="Назад">←</button>
        <h2 class="subheader-title">Профиль</h2>
      </div>

      <div class="card" style="padding:16px">
        <div style="display:flex; gap:12px; align-items:center;">
          <img id="profAvatar" class="avatar" style="width:48px;height:48px;border-radius:999px" alt="">
          <div>
            <div style="font-weight:700" id="profNick">—</div>
            <div class="muted">ID <span id="profSeq">#—</span></div>
          </div>
          <div style="margin-left:auto; text-align:right">
            <div class="muted" style="font-size:12px">Баланс</div>
            <div id="profBalance" style="font-weight:700">—</div>
          </div>
        </div>
      </div>

      <div class="card" style="padding:16px">
        <div class="label">Персональная наценка</div>
        <div id="profMarkup">—</div>
        <div class="muted" style="margin-top:6px">Можно снизить с помощью промокода</div>
      </div>

      <div class="card" style="padding:16px">
        <div class="label">Промокод (навсегда / на баланс)</div>
        <div class="promo-wrap" style="display:flex; gap:8px; align-items:center">
          <input id="profilePromoInput" type="text" placeholder="Введите код" style="flex:1; min-width:0;">
          <button class="btn" id="profilePromoApply">Активировать</button>
        </div>
        <div class="muted" style="margin-top:6px">
          • Код на скидку вводится на странице оформления услуги.
        </div>
      </div>

      <div class="card" style="padding:16px">
          <button id="openRoulette"
              class="btn btn-primary"
                style="display:flex; gap:8px; align-items:center">
                <img src="static/img/roulette.svg" alt="" style="width:18px;height:18px">
              <span>Открыть рулетку</span>
          </button>
      </div>`;
    document.getElementById('appMain')?.appendChild(wrap);
    pages.profile = wrap;

    // binds
    wrap.querySelector('#btnBackFromProfile')?.addEventListener('click', ()=> showPage('page-categories'));
    wrap.querySelector('#profilePromoApply')?.addEventListener('click', onProfilePromoApply);
    wrap.querySelector('#openRoulette')?.addEventListener('click', openRoulette);

    return wrap;
  }


  function updateProfilePageView() {
    const p = pages.profile || document.getElementById('page-profile');
    if (!p) return;
    // основной хедер
    const a = document.getElementById('profAvatar');
    if (a && avatarEl?.src) a.src = avatarEl.src;
    const nick = document.getElementById('profNick');
    if (nick) nick.textContent = nicknameEl?.textContent || '—';
    const ps = document.getElementById('profSeq');
    if (ps) ps.textContent = `#${seq}`;
    const pb = document.getElementById('profBalance');
    if (pb) pb.textContent = `${fmt(lastBalance)}${curSign(currentCurrency)}`;

    const pm = document.getElementById('profMarkup');
    if (pm) {
      const hasPersonal = (typeof userMarkup === 'number') && (userMarkup > 0.01);
      pm.textContent = hasPersonal
        ? `${Number(userMarkup).toFixed(3).replace(/\.?0+$/,'')}×`
        : 'По умолчанию';
    }
  }

  async function onProfilePromoApply(){
    const input = document.getElementById('profilePromoInput');
    const code = (input?.value || '').trim();
    if (!code){ alert('Введите промокод'); return; }
    try{
      const r = await fetch(`${API_BASE}/promo/apply`, {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ user_id: userId || seq, code })
      });
      const js = await r.json().catch(()=> ({}));
      if (!r.ok){
        const msg = typeof js === 'object' && js && js.detail ? js.detail : String(js||'Ошибка');
        alert('Не удалось применить промокод: ' + msg);
        return;
      }
      if (js.kind === 'markup'){
        userMarkup = Number(js.markup || userMarkup);
        alert('Персональная наценка обновлена!');
        await fetchProfile();
      } else if (js.kind === 'balance'){
        alert(`Начисление по промокоду: +${js.added} ${js.currency || ''}`);
        await fetchProfile();
      } else if (js.kind === 'discount' || js.hint === 'use_in_order'){
        alert('Этот код — скидочный. Введите его на странице оформления заказа.');
      } else {
        alert('Промокод применён.');
        await fetchProfile();
      }
      if (input) input.value = '';
    }catch(e){
      alert('Ошибка: ' + (e?.message||e));
    }
  }

  // Вызов профиля
  profileBtn?.addEventListener('click', ()=>{
    ensureProfilePage();
    updateProfilePageView();
    showPage('page-profile');
  });

   function ensureRoulettePage() {
  let p = document.getElementById('page-roulette');
  if (p) return p;
  p = document.createElement('section');
  p.id = 'page-roulette';
  p.className = 'page';
  // пустая заглушка; контент сверстаем позже
  p.innerHTML = `<div style="min-height:100vh"></div>`;
  document.getElementById('appMain')?.appendChild(p);
  return p;
}

function openRoulette() {
  ensureRoulettePage();

  // скрыть таббар целиком
  const tabbar = document.querySelector('.tabbar');
  if (tabbar) tabbar.style.display = 'none';

  showPage('page-roulette');

  // системная кнопка Назад от Telegram
  try {
    tg?.BackButton?.show?.();
    tg?.BackButton?.offClick?.(closeRoulette); // на всякий
    tg?.BackButton?.onClick?.(closeRoulette);
  } catch (_) {}
}

function closeRoulette() {
  showPage('page-profile');

  const tabbar = document.querySelector('.tabbar');
  if (tabbar) tabbar.style.display = 'grid';

  try {
    tg?.BackButton?.offClick?.(closeRoulette);
    tg?.BackButton?.hide?.();
  } catch (_) {}
}

  // ====== Tabs / Pages ======
  function showPage(id){
    ["page-categories","page-services","page-service","page-favs","page-refs","page-details","page-profile","page-roulette"]
  .forEach(pid => {

      const el = document.getElementById(pid);
      if (!el) return;
      el.classList.toggle("active", pid===id);
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
      loadDetails('payments');
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
      const r = await fetch(bust(`${API_BASE}/services`)); // тут счётчики; user_id не обязателен
      const items = await r.json();
      renderCategories(items);
    }catch(_){
      renderCategories([
        {id:'telegram', name:'Telegram',  desc:'подписчики, просмотры', count:319},
        {id:'tiktok',   name:'TikTok',    desc:'просмотры, фолловеры', count:37},
        {id:'instagram',name:'Instagram', desc:'подписчики, лайки', count:19},
        {id:'youtube',  name:'YouTube',   desc:'просмотры, подписки', count:56},
        {id:'facebook', name:'Facebook',  desc:'лайки, подписчики', count:18},
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
      const uid = userId || seq;
      const r = await fetch(bust(`${API_BASE}/services/${network}?user_id=${encodeURIComponent(uid)}`));
      if (!r.ok) throw new Error('HTTP '+r.status);
      const items = await r.json().catch(()=>[]);
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

  // ====== Favorites (local mirror + server sync) ======
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
  function priceFor(q,rate1000){ return Math.max(0, Number(rate1000||0) * Number(q||0) / 1000); }

  async function fetchServiceById(serviceId, netHint){
    if (Array.isArray(servicesAll) && servicesAll.length){
      const found = servicesAll.find(s => Number(s.service) === Number(serviceId));
      if (found) return found;
    }
    const net = netHint || currentNetwork || 'telegram';
    try{
      const uid = userId || seq;
      const r = await fetch(bust(`${API_BASE}/services/${net}?user_id=${encodeURIComponent(uid)}`));
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
      const uid = userId || seq;
      const r = await fetch(bust(`${API_BASE}/services/${net}?user_id=${encodeURIComponent(uid)}`));
      const arr = r.ok ? await r.json() : [];
      return arr.find(s => String(s.name||'').toLowerCase() === lower) || null;
    }catch(_){ return null; }
  }

  function openServicePage(s, opts={}){
    if (!s) return;
    const min = Number(s.min||1), max = Number(s.max||100000);
    const presets = presetValues(min,max);
    const currency = (s.currency||currentCurrency);

    // скидочный промокод состояние
    let discountCode = '';
    let discountPct  = 0;  // 0..1
    let qtyCurrent   = Math.max(min, Math.min(presets[0]||min, max));
    const rate1000   = Number(s.rate_client_1000 || 0);

    if (serviceTitleEl) serviceTitleEl.textContent = s.name || 'Услуга';

    serviceDetailsEl.innerHTML = `
      <div class="svc">
        <div class="card">
          <div class="label">Количество</div>
          <div class="qty-grid" id="qtyGrid"></div>
          <div class="qty-input">
            <input id="svcQty" type="number" min="${min}" max="${max}" step="1" value="${qtyCurrent}">
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

          <div class="promo-section">
            <button id="promoToggle" class="linklike" style="padding:0; background:none; border:0; color:#7aa7ff; text-align:left">
              У вас есть промокод?
            </button>

            <div id="promoBlock" class="promo-wrap" style="display:none; gap:8px; margin-top:8px; align-items:center">
              <input id="promoInput" type="text" placeholder="Введите промокод" style="flex:1; min-width:0;">
              <button class="chip" id="promoApply">Активировать</button>
            </div>

            <div class="muted" id="promoHint" style="display:none">Скидка применится к сумме заказа</div>
          </div>
        </div>

        <div class="card summary">
          <div class="sum-row"><span>Количество</span><b id="sumQty">${qtyCurrent}</b></div>
          <div class="sum-row"><span>Цена</span><b id="sumPrice">—</b></div>
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

    // promo dom
    const promoToggle = document.getElementById('promoToggle');
    const promoBlock  = document.getElementById('promoBlock');
    const promoInput  = document.getElementById('promoInput');
    const promoApply  = document.getElementById('promoApply');
    const promoHint   = document.getElementById('promoHint');

    function recalc(){
      const base = priceFor(qtyCurrent, rate1000);
      const disc = Math.round(base * discountPct * 100) / 100;
      const total = Math.max(0, Math.round((base - disc) * 100) / 100);
      sumQty.textContent = qtyCurrent;
      sumPrice.textContent = `${total.toFixed(4)}${curSign(currency)}${disc>0 ? ` (−${disc.toFixed(2)})` : ''}`;
    }

    qtyGrid.innerHTML = '';
    presets.forEach(q=>{
      const btn=document.createElement('button');
      btn.className='qty';
      btn.innerHTML = `<div class="num">${q.toLocaleString('ru-RU')}</div>
                       <div class="price">${priceFor(q,rate1000).toFixed(4)}${curSign(currency)}</div>`;
      if (q===qtyCurrent) btn.classList.add('active');
      btn.addEventListener('click', ()=>{
        qtyGrid.querySelectorAll('.qty').forEach(x=>x.classList.remove('active'));
        btn.classList.add('active');
        qtyCurrent = q;
        qtyInput.value = String(q);
        recalc();
      });
      qtyGrid.appendChild(btn);
    });

    chipMin?.addEventListener('click', ()=>{
      qtyCurrent=min; qtyInput.value=String(min);
      qtyGrid.querySelectorAll('.qty').forEach(x=>x.classList.remove('active'));
      recalc();
    });
    chipMax?.addEventListener('click', ()=>{
      qtyCurrent=max; qtyInput.value=String(max);
      qtyGrid.querySelectorAll('.qty').forEach(x=>x.classList.remove('active'));
      recalc();
    });

    qtyInput?.addEventListener('input', ()=>{
      let q=parseInt(qtyInput.value||'0',10);
      if(!Number.isFinite(q)) q=min;
      qtyCurrent=Math.max(min, Math.min(max, q));
      recalc();
    });

    // Prefill из opts (для "Повторить заказ")
    const presetQty  = Number(opts.qty || 0);
    const presetLink = String(opts.link || '');
    if (presetLink && linkEl) linkEl.value = presetLink;
    if (presetQty && qtyInput){
      const q = Math.max(min, Math.min(max, presetQty));
      qtyCurrent = q;
      qtyInput.value = String(q);
      qtyGrid?.querySelectorAll('.qty').forEach(bt=>{
        const num = parseInt(bt.querySelector('.num')?.textContent.replace(/\s/g,'')||'0',10);
        bt.classList.toggle('active', num === q);
      });
    }

    // ========= ПРОМО UI (ссылка -> раскрывающийся блок) =========
    let promoOpen = false;
    function setPromoUI(){
      if (!promoBlock || !promoToggle || !promoHint) return;
      promoBlock.style.display = promoOpen ? 'flex' : 'none';
      if (discountPct > 0){
        promoToggle.textContent = `Промокод применён: −${Math.round(discountPct*100)}% (изменить)`;
        promoHint.style.display = 'block';
        promoHint.textContent = `Скидка активна: −${Math.round(discountPct*100)}%`;
      } else {
        promoToggle.textContent = 'У вас есть промокод?';
        promoHint.style.display = 'none';
      }
    }
    promoToggle?.addEventListener('click', ()=>{
      promoOpen = !promoOpen;
      setPromoUI();
      if (promoOpen) promoInput?.focus();
    });

    // Скидочный промокод: валидация против API
    promoApply?.addEventListener('click', async ()=>{
      const code = (promoInput?.value||'').trim();
      if (!code){ alert('Введите промокод'); promoInput?.focus(); return; }
      try{
        promoApply.disabled = true; promoApply.textContent = 'Проверка...';
        const r = await fetch(bust(`${API_BASE}/promo/check?user_id=${encodeURIComponent(userId||seq)}&code=${encodeURIComponent(code)}`));
        const js = await r.json().catch(()=> ({}));
        if (!r.ok){
          const msg = (js && js.detail) ? js.detail : 'Код недействителен';
          alert(msg); return;
        }
        const pct = Number(js.percent||0);
        discountPct  = (pct>1 ? pct/100 : pct);
        discountCode = code;
        promoOpen    = false;        // сворачиваем после успешной активации
        setPromoUI();
        recalc();
      }catch(e){
        alert('Ошибка проверки промокода: ' + (e?.message||e));
      }finally{
        promoApply.disabled = false; promoApply.textContent = 'Активировать';
      }
    });

    // Избранное
    const favToggle = document.getElementById('favToggle');
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

    // Создать заказ
    const btnCreate = document.getElementById('svcCreate');
    btnCreate?.addEventListener('click', async ()=>{
      const link=(linkEl?.value||'').trim();
      if (!link){ linkErr?.classList.add('show'); linkEl?.focus(); return; }
      linkErr?.classList.remove('show');
      if (qtyCurrent<min || qtyCurrent>max){ alert(`Количество должно быть от ${min} до ${max}`); return; }

      btnCreate.disabled = true; btnCreate.textContent = 'Оформляем...';
      try{
        const body = { user_id:userId||seq, service:s.service, link, quantity:qtyCurrent };
        if (discountCode) body.promo_code = discountCode;
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
    recalc();
    setPromoUI();
    try { history.replaceState(null, '', `#service-${s.service}`); } catch(_) {}
  }

  btnBackToCats?.addEventListener('click', ()=> showPage("page-categories"));
  btnBackToServices?.addEventListener('click', ()=> showPage("page-services"));

  // стартовая загрузка
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
      const API_BASE_L = (typeof window.API_BASE === "string" && window.API_BASE) ? window.API_BASE : "/api/v1";
      let uid = null;
      try { uid = tg && tg.initDataUnsafe && tg.initDataUnsafe.user && tg.initDataUnsafe.user.id; } catch (_) {}
      if (!uid && window.USER_ID) uid = window.USER_ID;

      const url = API_BASE_L + "/referrals/stats" + (uid ? ("?user_id=" + encodeURIComponent(uid)) : "");
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) throw new Error("HTTP " + res.status);
      const data = await res.json();

      const inviteLink = String(data.invite_link || data.link || "");
      const threshold = Number(data.threshold != null ? data.threshold : 50);
      const invited   = Number(data.invited_total != null ? data.invited_total : 0);
      const withDep   = Number(data.invited_with_deposit != null ? data.invited_with_deposit : 0);
      const earnedRaw = (data.earned_total != null ? data.earned_total : 0);
      const earned    = typeof earnedRaw === "number" ? earnedRaw.toFixed(2) : String(earnedRaw);
      const currency  = String(data.earned_currency || data.currency || "₽");

      const denom = threshold > 0 ? threshold : 50;
      const prog = Math.max(0, Math.min(100, Math.round((withDep / denom) * 100)));

      page.innerHTML = `
        <div class="ref">
          <div class="card ref-hero">
            <div class="ref-ico">
              <img src="static/img/tab-referrals.svg?v=2025-09-30-1" alt="" class="ref-ico-img">
            </div>
            <div class="ref-h1">
              Приглашайте пользователей <br> и получайте <span class="accent">10%</span> от их платежей
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

  async function loadDetails(defaultTab = "orders") {
  const page = document.getElementById("page-details");
  if (!page) return;
  const uid = (tg?.initDataUnsafe?.user?.id) || (window.USER_ID) || seq;

  let ORDERS_CACHE = null;
  let PAYMENTS_CACHE = null;
  let ORDERS_POLL = null; // автообновление статусов заказов

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

  // ---------- Orders ----------
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
      const id = String(card.dataset.id);
      const o = ORDERS_CACHE.find(x => String(x.id) === id);
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
      startOrdersPoll(filter);
      return;
    }

    list.innerHTML = `<div class="skeleton" style="height:60px"></div><div class="skeleton" style="height:60px"></div>`;
    try {
      const q = new URLSearchParams({ user_id:String(uid), refresh:'1' });
      const r = await fetch(bust(`${API_BASE}/orders?${q.toString()}`), { credentials:"include" });
      ORDERS_CACHE = r.ok ? await r.json() : [];
    } catch { ORDERS_CACHE = []; }

    renderOrdersFromCache(filter);
    startOrdersPoll(filter);
  }

  // ----- Автообновление заказов -----
  function hasProcessingOrders() {
    return (ORDERS_CACHE || []).some(
      o => /^(processing|in progress|awaiting|pending)$/i.test(String(o.status))
    );
  }
  function stopOrdersPoll() {
    if (ORDERS_POLL) { clearInterval(ORDERS_POLL); ORDERS_POLL = null; }
  }
  async function tickOrdersPoll(filter) {
    try {
      const q = new URLSearchParams({ user_id:String(uid), refresh:'1' });
      const r = await fetch(bust(`${API_BASE}/orders?${q.toString()}`), { credentials:"include" });
      if (r.ok) ORDERS_CACHE = await r.json();
      renderOrdersFromCache(filter);
      if (!hasProcessingOrders()) stopOrdersPoll();
    } catch (_) {}
  }
  function startOrdersPoll(filter) {
    stopOrdersPoll();
    if (!hasProcessingOrders()) return;
    ORDERS_POLL = setInterval(() => {
      const active = document.getElementById("page-details")?.classList.contains("active");
      if (!active) return stopOrdersPoll();
      tickOrdersPoll(filter);
    }, 5000);
  }

  // ---------- Payments (topups + ref + promo) ----------
  function nDate(x){
    if (x == null) return 0;
    if (typeof x === 'number') return x < 1e12 ? x*1000 : x;
    if (/^\d+$/.test(String(x))) { const n = Number(x); return n<1e12 ? n*1000 : n; }
    const t = +new Date(x); return Number.isFinite(t) ? t : 0;
  }

  // Нормализация под единый вид
  function normTopup(p){
    const method = (p.method || p.provider || 'cryptobot') + '';
    const currency = p.currency || 'RUB';
    const created = p.created_at ?? p.createdAt ?? p.time ?? p.ts;
    const status = p.applied ? 'completed' : (p.status || 'processing');
    const amount = (p.amount != null ? p.amount
                 : (p.amount_rub != null ? p.amount_rub
                 : (p.amount_usd != null ? p.amount_usd : 0)));
    return {
      id: p.id, user_id: p.user_id,
      method, status,
      amount, currency,
      created_at: created,
      invoice_id: p.invoice_id, pay_url: p.pay_url,
      _source: p._source || 'topup'
    };
  }

  async function fetchPaymentsUnion() {
    if (Array.isArray(PAYMENTS_CACHE)) return PAYMENTS_CACHE;
    let arr = [];
    try {
      const q = new URLSearchParams({ user_id:String(uid), refresh:"1" });
      const r = await fetch(bust(`${API_BASE}/payments?${q.toString()}`), { credentials:"include" });
      arr = (r.ok ? await r.json().catch(()=>[]) : []);
    } catch {}
    PAYMENTS_CACHE = Array.isArray(arr) ? arr.map(normTopup).sort((a,b)=> nDate(b.created_at) - nDate(a.created_at)) : [];
    return PAYMENTS_CACHE;
  }

  function renderPaymentsFromCache() {
    if (!Array.isArray(PAYMENTS_CACHE) || !PAYMENTS_CACHE.length) {
      list.innerHTML = `<div class="empty">Платежей пока нет</div>`;
      return;
    }
    list.innerHTML = PAYMENTS_CACHE.map(p=>{
      const st  = stInfo(p.status);
      const sum = `${(p.amount ?? 0)} ${(p.currency || "₽")}`;
      const prov = String(p.method || "cryptobot").toLowerCase(); // 'cryptobot' | 'ref' | 'promo' | ...
      const sub = `${prov} • ${fmtDate(p.created_at)} • #${p.id}`;
      const ico = prov === 'ref' ? 'static/img/referral.svg' : `static/img/${prov}.svg`;
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
      const id = String(card.dataset.id);
      const p = PAYMENTS_CACHE.find(x => String(x.id) === id);
      if (p) card.addEventListener('click', ()=> showPaymentModal(p));
    });
  }

  async function renderPayments() {
    filtersWrap.innerHTML = "";
    list.innerHTML = `<div class="skeleton" style="height:60px"></div>`;
    await fetchPaymentsUnion();
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
    const st = stInfo(p.status);
    const prov = String(p.method || "cryptobot").toLowerCase();
    const ico = prov === 'ref' ? 'static/img/referral.svg' : `static/img/${prov}.svg`;
    const sum = `${(p.amount ?? 0)} ${(p.currency || "₽")}`;

    const extraRows = [];
    extraRows.push(`<div class="modal-row"><div class="muted">Создан</div><div>${fmtDate(p.created_at)}</div></div>`);
    if (prov === 'cryptobot' || prov === 'qiwi' || prov === 'card' || prov === 'promo') {
      if (p.invoice_id) extraRows.push(`<div class="modal-row"><div class="muted">Invoice ID</div><div>#${p.invoice_id}</div></div>`);
      if (p.amount_usd != null) extraRows.push(`<div class="modal-row"><div class="muted">Сумма (USD)</div><div>${p.amount_usd}</div></div>`);
      if (p.pay_url) extraRows.push(`<div class="modal-row"><a class="btn btn-primary" href="${p.pay_url}" target="_blank" rel="noopener">Открыть ссылку оплаты</a></div>`);
    } else if (prov === 'ref') {
      if (p.from_user_id) extraRows.push(`<div class="modal-row"><div class="muted">От пользователя</div><div>#${p.from_user_id}</div></div>`);
      if (p.invoice_id)   extraRows.push(`<div class="modal-row"><div class="muted">Топап</div><div>#${p.invoice_id}</div></div>`);
    }

    openModal(`
      <h3>${prov === 'ref' ? 'Реферальное начисление' : 'Платёж'} #${p.id}</h3>
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
      ${extraRows.join("")}
      <div class="modal-actions">
        <button class="btn btn-secondary" id="payClose">Закрыть</button>
      </div>
    `);
    document.getElementById('payClose')?.addEventListener('click', closeModal);
  }

  async function switchTab(tab) {
    seg.querySelectorAll(".seg__btn")
      .forEach(b=>b.classList.toggle("seg__btn--active", b.dataset.tab===tab));

    if (tab === "orders") {
      await renderOrders("all");
    } else {
      stopOrdersPoll();
      await renderPayments();
    }
  }

  await switchTab(defaultTab);
  seg.querySelectorAll(".seg__btn").forEach(btn =>
    btn.addEventListener("click", () => switchTab(btn.dataset.tab))
  );
}


  // ====== Topup ======
  // ====== Topup ======
btnTopup?.addEventListener('click', async () => {
  try {
    const s = prompt('Сумма пополнения, USDT (мин. 0.10):', '1.00');
    if (!s) return;

    const amount = parseFloat(s);
    if (isNaN(amount) || amount < 0.10) {
      alert('Минимальная сумма — 0.10 USDT');
      return;
    }

    const r = await fetch(`${API_BASE}/pay/invoice`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: userId || seq, amount_usd: amount }),
    });

    if (r.status === 501) { alert('Оплата через CryptoBot ещё не настроена.'); return; }
    if (!r.ok) throw new Error(await r.text());

    const j = await r.json();
    const url = j.mini_app_url || j.pay_url; // <— сначала mini_app_url

    if (!url) { alert('Не удалось получить ссылку на оплату'); return; }

    // внутри Telegram лучше так — без подтверждающих попапов
    if (tg?.openTelegramLink) tg.openTelegramLink(url);
    else if (tg?.openLink)    tg.openLink(url);
    else                      window.location.href = url;

  } catch (e) {
    alert('Ошибка создания счёта: ' + (e?.message || e));
  }
});



  // ====== Keyboard inset -> hide tabbar ======
  (function keyboardLift(){
    const root=document.documentElement;
    const tabbar = document.querySelector('.tabbar');

    function applyKbInset(px){
      const v = px>40 ? px : 0;
      root.style.setProperty('--kb', v+'px');
      const open = v > 40;
      document.body.classList.toggle('kb-open', open);
      if (tabbar) tabbar.style.display = open ? 'none' : 'grid';
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

  // Глобальный лог ошибок
  window.addEventListener('error', e => console.error('JS error:', e.message, e.filename, e.lineno));
})();
