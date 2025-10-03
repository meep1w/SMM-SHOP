/* Slovekiza Mini-App — промокоды + профиль + персональная наценка
 * + Рулетка (фикс-колесо + авто-спин с предоплатой и ПОСПИНОВЫМ начислением)
 * - Профиль/баланс/наценка, ввод промокодов
 * - Скидочный промокод на странице услуги
 * - Категории / Услуги / Страница услуги
 * - Избранное (локально) + синк с сервером
 * - Рефералка, Детализация
 * - Скрытие таббара при открытой клавиатуре
 */
(function () {
  console.log('app.js ready (promos + profile + roulette autospin per-spin credit)');

  // ====== Telegram WebApp ======
  const tg = window.Telegram?.WebApp || null;
  try {
    tg?.ready?.();
    tg?.expand?.();
    tg?.disableVerticalSwipes?.();
    tg?.MainButton?.hide?.();
    tg?.BackButton?.hide?.();
    const HEADER_COLOR = '#0e1013';
    const BG_COLOR     = '#0e1013';
    tg?.setHeaderColor?.(HEADER_COLOR);
    tg?.setBackgroundColor?.(BG_COLOR);
    tg?.onEvent?.('themeChanged', () => {
      tg?.setHeaderColor?.(HEADER_COLOR);
      tg?.setBackgroundColor?.(BG_COLOR);
    });
  } catch (_) {}

  // Версия (для кэша картинок)
  window.WEBAPP_VERSION = window.WEBAPP_VERSION || '2025-10-02-04';

  // Добавляем ?v=... на <img src="static/...">, где ещё нет
  (function bumpStaticImages() {
    const v = encodeURIComponent(window.WEBAPP_VERSION);
    document.querySelectorAll('img[src^="static/"]:not([src*="?v="])')
      .forEach(img => {
        try {
          const url = new URL(img.getAttribute('src'), location.origin);
          if (!url.searchParams.has('v')) {
            url.searchParams.set('v', v);
            img.setAttribute('src', url.pathname + '?' + url.searchParams.toString());
          }
        } catch (_) {}
      });
  })();

  const API_BASE = "/api/v1";

  // ===== Roulette config/state =====
  const ROULETTE = {
    VALUES:  [0,2,4,5,6,8,10,12,15,20,30,40,60,100],
    SPIN_MS: 3400,
    IMG_DIR: 'static/img/tickets'
  };
  const ROULETTE_COST_RUB = 10; // отображение (сервер всё равно применяет свою константу)

  let rouletteState = {
    spinning: false,
    strip: null,
    wheel: null,
    centerOffset: 0,
    cardStep: 0,
    indexBase: 0,
    currentIndex: 0
  };

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
    profile:  null,
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
  function bust(url){ const u = new URL(url, location.origin); u.searchParams.set("_", Date.now().toString()); return u.toString(); }
  function fmtDate(val){
    try{
      if (val == null || val === '') return '';
      if (typeof val === 'string' && !/^\d+(\.\d+)?$/.test(val.trim())) {
        const d = new Date(val); if (isNaN(d.getTime())) return val;
        const dd = String(d.getDate()).padStart(2,'0');
        const mm = String(d.getMonth()+1).padStart(2,'0');
        const yy = String(d.getFullYear()).slice(-2);
        const hh = String(d.getHours()).padStart(2,'0');
        const mi = String(d.getMinutes()).padStart(2,'0');
        return `${dd}.${mm}.${yy} ${hh}:${mi}`;
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
  function openModal(html){ const m = ensureModal(); m.querySelector('.modal-content').innerHTML = html; m.setAttribute('aria-hidden','false'); }
  function closeModal(){ const m = document.getElementById('appModal'); if (m) m.setAttribute('aria-hidden','true'); }

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

  const nicknameElExists = !!nicknameEl;
  if (nicknameElExists) nicknameEl.textContent = nickFromUrl || "Гость";
  try { const photo = tg?.initDataUnsafe?.user?.photo_url; if (photo && avatarEl) avatarEl.src = photo; } catch (_) {}
  if (avatarEl && !avatarEl.getAttribute("src")){
    avatarEl.src='data:image/svg+xml;utf8,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 80"><rect fill="#1b1e24" width="80" height="80" rx="40"/><circle cx="40" cy="33" r="15" fill="#2a2f36"/><path d="M15 66c5-12 18-18 25-18s20 6 25 18" fill="#2a2f36"/></svg>');
  }

  function stableHashId(x){ let h=0,s=String(x||''); for(let i=0;i<s.length;i++){ h=((h<<5)-h+s.charCodeAt(i))|0; } h=Math.abs(h); return (h%100000)+1; }
  let seq = parseInt(localStorage.getItem('smm_user_seq')||'0',10) || stableHashId(userId||nickFromUrl||'guest');
  if (userSeqEl) userSeqEl.textContent = `#${seq}`;

  let currentCurrency = "RUB";
  let lastBalance = 0;
  let userMarkup = null;

  function setBalanceUI(val){
    lastBalance = Number(val || 0);
    if (balanceEl) balanceEl.textContent = `${fmt(lastBalance)}${curSign(currentCurrency)}`;
    const rb = document.getElementById('rbBalance');
    if (rb) rb.textContent = `${fmt(lastBalance)} RUB`;
  }

  async function fetchProfile(){
    try {
      const qp = new URLSearchParams({ user_id: String(userId||seq), consume_topup: '1' });
      if (nickFromUrl) qp.set('nick', nickFromUrl);
      const r = await fetch(bust(`${API_BASE}/user?${qp.toString()}`));
      if (!r.ok) throw 0;
      const p = await r.json();

      if (p.seq){ seq = p.seq; localStorage.setItem('smm_user_seq', String(p.seq)); if (userSeqEl) userSeqEl.textContent = `#${p.seq}`; }
      if (p.nick && nicknameEl) nicknameEl.textContent = p.nick;

      currentCurrency = (p.currency || 'RUB').toUpperCase();
      setBalanceUI(Number(p.balance || 0));

      userMarkup = (p.markup != null ? Number(p.markup) : null);
      updateProfilePageView();

      if (p.topup_delta && Number(p.topup_delta) > 0){
        showOverlay(Number(p.topup_delta), p.topup_currency || currentCurrency);
      }
    } catch (_){
      currentCurrency = 'RUB'; setBalanceUI(0);
    }
  }
  fetchProfile();
  window.addEventListener('focus', fetchProfile);
  document.addEventListener('visibilitychange', ()=>{ if(!document.hidden) fetchProfile(); });

  // ====== make Profile page ======
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
        <div class="muted" style="margin-top:6px">• Код на скидку вводится на странице оформления услуги.</div>
      </div>

      <div class="card" style="padding:16px">
        <button id="openRoulette" class="btn btn-primary" style="display:flex; gap:8px; align-items:center">
          <img src="static/img/roulette1.svg" alt="" style="width:18px;height:18px">
          <span>Открыть рулетку</span>
        </button>
      </div>`;
    document.getElementById('appMain')?.appendChild(wrap);
    pages.profile = wrap;

    wrap.querySelector('#btnBackFromProfile')?.addEventListener('click', ()=> showPage('page-categories'));
    wrap.querySelector('#profilePromoApply')?.addEventListener('click', onProfilePromoApply);
    wrap.querySelector('#openRoulette')?.addEventListener('click', openRoulette);
    return wrap;
  }

  function updateProfilePageView() {
    setBalanceUI(lastBalance);
    const p = pages.profile || document.getElementById('page-profile');
    if (p) {
      const a  = p.querySelector('#profAvatar')  || document.getElementById('profAvatar');
      const nk = p.querySelector('#profNick')    || document.getElementById('profNick');
      const ps = p.querySelector('#profSeq')     || document.getElementById('profSeq');
      const pb = p.querySelector('#profBalance') || document.getElementById('profBalance');
      const pm = p.querySelector('#profMarkup')  || document.getElementById('profMarkup');
      if (a && avatarEl?.src) a.src = avatarEl.src;
      if (nk) nk.textContent = nicknameEl?.textContent || '—';
      if (ps) ps.textContent = `#${seq}`;
      if (pb) pb.textContent = `${fmt(lastBalance)}${curSign(currentCurrency)}`;
      if (pm) {
        const hasPersonal = (typeof userMarkup === 'number') && (userMarkup > 0.01);
        pm.textContent = hasPersonal ? `${Number(userMarkup).toFixed(3).replace(/\.?0+$/,'')}×` : 'По умолчанию';
      }
    }
    try {
      if (document.getElementById('page-roulette')) updateRouletteBar();
    } catch (_) {}
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

  // ===== Стили рулетки и авто-спина =====
  function ensureRouletteStyles() {
    if (document.getElementById('rouletteStyles')) return;
    const st = document.createElement('style');
    st.id = 'rouletteStyles';
    st.textContent = `
      body.roulette-open .app-header{ display:none !important; }
      body.roulette-open .tabbar{ display:none !important; }
      body.roulette-open .subheader,
      body.roulette-open .details-head{ display:none !important; }

      body.roulette-open .app-main{
        padding: 16px 16px calc(env(safe-area-inset-bottom) + 140px);
        min-height: 100dvh;
      }

      #page-roulette .rbar{
        position: fixed; left: 16px; right: 16px;
        bottom: calc(env(safe-area-inset-bottom) + 16px);
        background: linear-gradient(180deg,#15181d,#111419);
        border: 1px solid var(--stroke);
        border-radius: 16px;
        box-shadow: 0 12px 28px rgba(0,0,0,.28);
        padding: 16px;
      }
      #page-roulette .rbar__top{ display:flex; align-items:center; gap:12px; margin-bottom:12px; }
      #page-roulette .rbar__ico{
        width:44px; height:44px; border-radius:12px; flex:0 0 auto;
        display:grid; place-items:center; overflow:hidden;
        background: linear-gradient(180deg,#1a1e24,#14181e);
      }
      #page-roulette .rbar__ico img{ width:100%; height:100%; object-fit:cover; display:block; border-radius:50%; }
      #page-roulette .rbar__title{ font-weight:700; font-size:15px; }
      #page-roulette .rbar__subbtn{ display:inline-block; margin-top:2px; font-size:12px; color:#ff7f7f; cursor:pointer; }
      #page-roulette .rbar__right{ margin-left:auto; text-align:right; }
      #page-roulette .rbar__bal{ font-weight:700; font-size:15px; }
      #page-roulette .rbar__bal-sub{ color:var(--muted); font-size:12px; }

      #page-roulette .rbar__actions{
        display:grid; grid-template-columns:1fr 1fr; gap:12px; margin-top:6px;
      }
      #page-roulette .rbtn{
        appearance:none; border:1px solid var(--stroke);
        border-radius:14px; padding:14px 16px; cursor:pointer; font-weight:700;
        background: var(--surface-2); color: var(--text);
      }
      #page-roulette .rbtn--primary{
        border:0;
        background: linear-gradient(180deg,#ff6b6b 0%, #ff3e3e 100%); color:#fff;
      }

      #page-roulette{
        --wheel-h: 520px;
        --ticket-h: 150px;
        --ticket-gap: 18px;
      }

      #page-roulette .wheel-pad{
        height: var(--wheel-h);
        min-height: var(--wheel-h);
        border: 1px dashed rgba(255,255,255,.12);
        border-radius: 16px;
        display: grid; place-items: center;
        color: var(--muted);
        margin-bottom: 16px;
      }
      #page-roulette .wheel{ position:relative; width:100%; height:100%; overflow:hidden; }
      #page-roulette .strip{
        position:absolute; left:50%; top:0;
        display:flex; flex-direction:column; gap: var(--ticket-gap);
        transform: translate3d(-50%, 0, 0);
        will-change: transform;
        padding: 12px 0;
      }
      #page-roulette .ticket{ flex:0 0 auto; }
      #page-roulette .ticket img{
        display:block;
        height: var(--ticket-h);
        width: auto;
        border-radius: 14px;
        box-shadow: 0 6px 16px rgba(0,0,0,.22);
      }
      #page-roulette .marker{
        position:absolute; left:8%; right:8%; top:50%;
        height:2px; transform:translateY(-1px);
        background: rgba(255,255,255,.35);
        pointer-events:none;
      }
    `;
    document.head.appendChild(st);
  }

  // ===== Рулетка: страница и построение =====
  function ensureRoulettePage() {
    let p = document.getElementById('page-roulette');
    if (p) return p;

    p = document.createElement('section');
    p.id = 'page-roulette';
    p.className = 'page';
    p.innerHTML = `
      <div class="wheel-pad">
        <div class="wheel" id="rouletteWheel">
          <div class="strip" id="rouletteStrip"></div>
          <div class="marker"></div>
        </div>
      </div>

      <div class="rbar">
        <div class="rbar__top">
          <div class="rbar__ico"><img src="static/img/iconrub.svg" alt=""></div>
          <div class="rbar__titlewrap">
            <div class="rbar__title">Рубль</div>
            <div class="rbar__subbtn" id="rbTopup">Пополнить &gt;</div>
          </div>
          <div class="rbar__right">
            <div class="rbar__bal" id="rbBalance">0.00 RUB</div>
            <div class="rbar__bal-sub">ваш баланс</div>
          </div>
        </div>

        <div class="rbar__actions">
          <button class="rbtn" id="rbAuto">Авто-спин</button>
          <button class="rbtn rbtn--primary" id="rbSpin">Крутить за ${ROULETTE_COST_RUB}₽</button>
        </div>
      </div>
    `;
    document.getElementById('appMain')?.appendChild(p);

    initRouletteUI(p);

    p.querySelector('#rbTopup')?.addEventListener('click', onTopupClick);
    p.querySelector('#rbSpin')?.addEventListener('click', ()=> spinRoulette());
    p.querySelector('#rbAuto')?.addEventListener('click', openAutospinModal);

    return p;
  }

  async function onTopupClick(){
    try {
      const s = prompt('Сумма пополнения, USDT (мин. 0.10):', '1.00');
      if (!s) return;
      const amount = parseFloat(s);
      if (isNaN(amount) || amount < 0.10) { alert('Минимальная сумма — 0.10 USDT'); return; }
      const r = await fetch(`${API_BASE}/pay/invoice`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: userId || seq, amount_usd: amount }),
      });
      if (r.status === 501) { alert('Оплата через CryptoBot ещё не настроена.'); return; }
      if (!r.ok) throw new Error(await r.text());
      const j = await r.json();
      const url = j.mini_app_url || j.pay_url;
      if (!url) { alert('Не удалось получить ссылку на оплату'); return; }
      if (tg?.openTelegramLink) tg.openTelegramLink(url);
      else if (tg?.openLink)    tg.openLink(url);
      else                      location.href = url;
    } catch (e) {
      alert('Ошибка создания счёта: ' + (e?.message||e));
    }
  }

  // ===== ИНИЦИАЛИЗАЦИЯ РУЛЕТКИ =====
  function initRouletteUI(root){
    const wheel = root.querySelector('#rouletteWheel');
    const strip = root.querySelector('#rouletteStrip');
    rouletteState.wheel = wheel;
    rouletteState.strip = strip;

    const vq = window.WEBAPP_VERSION ? `?v=${encodeURIComponent(window.WEBAPP_VERSION)}` : '';
    const card = val =>
      `<div class="ticket" data-win="${val}">
         <img src="${ROULETTE.IMG_DIR}/ticket-${val}.svg${vq}" alt="${val}">
       </div>`;

    const oneCol = ROULETTE.VALUES.map(card).join('');
    strip.innerHTML = new Array(40).fill(oneCol).join('');

    const cs = getComputedStyle(root);
    const TICKET_H = parseFloat(cs.getPropertyValue('--ticket-h')) || 150;
    const GAP      = parseFloat(cs.getPropertyValue('--ticket-gap')) || 18;
    const WHEEL_H  = parseFloat(cs.getPropertyValue('--wheel-h')) || wheel.getBoundingClientRect().height;

    rouletteState.cardStep     = TICKET_H + GAP;
    rouletteState.centerOffset = (WHEEL_H/2) - (TICKET_H/2);
    rouletteState.indexBase    = ROULETTE.VALUES.length * 20;
    rouletteState.currentIndex = rouletteState.indexBase;

    const y0 = - (rouletteState.indexBase * rouletteState.cardStep - rouletteState.centerOffset);
    strip.style.transform = `translate3d(-50%, ${Math.round(y0)}px, 0)`;
  }

  function recenterToValue(val) {
    const s = rouletteState.strip;
    if (!s) return;
    const idxInCycle = ROULETTE.VALUES.indexOf(Number(val));
    if (idxInCycle < 0) return;

    const newIdx = rouletteState.indexBase + idxInCycle;
    const y = - (newIdx * rouletteState.cardStep - rouletteState.centerOffset);

    s.style.transition = 'none';
    s.style.transform = `translate3d(-50%, ${Math.round(y)}px, 0)`;
    // eslint-disable-next-line no-unused-expressions
    s.offsetHeight;
    s.style.transition = '';
    rouletteState.currentIndex = newIdx;
  }

  function ensureHeadroom() {
    const s = rouletteState.strip;
    if (!s) return;
    const total = s.children.length;
    const cur   = getCurrentIndex();
    const needAhead = ROULETTE.VALUES.length * 6;

    if (total - cur < needAhead) {
      const curVal = Number(s.children[cur]?.dataset?.win || ROULETTE.VALUES[0]);
      recenterToValue(curVal);
    }
  }

  function getCurrentIndex(){
    return typeof rouletteState.currentIndex === 'number'
      ? rouletteState.currentIndex
      : rouletteState.indexBase;
  }
  function findNextIndexOfValue(winVal){
    const s = rouletteState.strip;
    const N = ROULETTE.VALUES.length;
    const cur = getCurrentIndex();
    const minIdx = cur + N * 3;
    const total = s.children.length;

    for (let i = minIdx; i < total; i++){
      const v = Number(s.children[i]?.dataset?.win || NaN);
      if (v === Number(winVal)) return i;
    }
    return minIdx;
  }
  function animateToIndex(targetIdx, duration, done){
    const s = rouletteState.strip;
    const y = - (targetIdx * rouletteState.cardStep - rouletteState.centerOffset);

    s.style.transition = `transform ${duration}ms cubic-bezier(.15,.9,.25,1)`;
    requestAnimationFrame(()=> {
      s.style.transform = `translate3d(-50%, ${Math.round(y)}px, 0)`;
    });

    const onEnd = () => {
      s.removeEventListener('transitionend', onEnd);
      s.style.transition = '';
      rouletteState.currentIndex = targetIdx;
      rouletteState.spinning = false;
      const btn = document.getElementById('rbSpin'); if (btn) btn.disabled = false;
      done && done();
    };
    s.addEventListener('transitionend', onEnd);
    setTimeout(onEnd, duration + 120);
  }

  function updateRouletteBar() { setBalanceUI(lastBalance); }

  function openRoulette() {
    ensureRouletteStyles();
    ensureRoulettePage();
    updateRouletteBar();
    showPage('page-roulette');
    document.body.classList.add('roulette-open');
    try {
      tg?.BackButton?.show?.();
      tg?.BackButton?.offClick?.(closeRoulette);
      tg?.BackButton?.onClick?.(closeRoulette);
    } catch (_) {}
  }

  function closeRoulette() {
    document.body.classList.remove('roulette-open');
    showPage('page-profile');
    try {
      tg?.BackButton?.offClick?.(closeRoulette);
      tg?.BackButton?.hide?.();
    } catch (_) {}
  }

  // ====== ОДИНОЧНЫЙ СПИН
  async function spinRoulette(opts = {}){
    if (rouletteState.spinning) return;

    const {
      forceWin = null,   // если задано — анимируем локально без запроса
      localOnly = false, // true — использовать только анимацию (без списаний/зачислений)
      onFinish  = null,
    } = opts;

    const btn = document.getElementById('rbSpin');
    btn && (btn.disabled = true);
    rouletteState.spinning = true;

    try {
      let winVal, finalBalance = null;

      if (localOnly && forceWin != null) {
        winVal = Number(forceWin);
      } else if (forceWin != null) {
        winVal = Number(forceWin);
      } else {
        // обычный спин — сервер сам спишет и зачислит
        const r = await fetch('/api/v1/roulette/spin', {
          method: 'POST',
          headers: {'Content-Type':'application/json'},
          body: JSON.stringify({ user_id: userId || seq })
        });
        if (!r.ok) {
          const msg = await r.text();
          throw new Error(msg || 'HTTP '+r.status);
        }
        const result = await r.json();
        winVal = Number(result.win);
        finalBalance = Number(result.balance);
      }

      ensureHeadroom();

      const targetIdx = findNextIndexOfValue(winVal);
      animateToIndex(targetIdx, ROULETTE.SPIN_MS, () => {
        if (finalBalance != null) setBalanceUI(finalBalance);
        recenterToValue(winVal);
        try { tg?.HapticFeedback?.impactOccurred?.('medium'); } catch(_){}
        onFinish && onFinish();
      });
    } catch (e) {
      rouletteState.spinning = false;
      btn && (btn.disabled = false);
      alert('Не удалось выполнить спин: ' + (e?.message || e));
    }
  }

  // ====== АВТО-СПИН С ПРЕДОПЛАТОЙ И ПОСПИНОВЫМ ЗАЧИСЛЕНИЕМ ======
  const AUTOSPIN_MAX = 500;
  let autoSpinState = { active:false, remaining:0, sessionId:null };

  function openAutospinModal(){
    const curDefault = 25;
    openModal(`
      <div class="asm">
        <h3>Авто-спин</h3>
        <div class="sub">Рулетка крутится автоматически</div>
        <div class="row">
          <div class="label">Количество спинов</div>
          <div class="inp">
            <input id="asCount" type="number" min="1" max="${AUTOSPIN_MAX}" step="1" value="${curDefault}">
            <div class="max" id="asMax">Макс</div>
          </div>
        </div>
        <input id="asSlider" class="slider" type="range" min="25" max="${AUTOSPIN_MAX}" step="25" value="${curDefault}">
        <div class="actions">
          <button id="asCancel" class="btnx">Закрыть</button>
          <button id="asRun" class="btnp">Запустить</button>
        </div>
      </div>
    `);

    const inp = document.getElementById('asCount');
    const sld = document.getElementById('asSlider');
    const btnMax = document.getElementById('asMax');
    const btnRun = document.getElementById('asRun');
    const btnCancel = document.getElementById('asCancel');

    const nearest25 = n => Math.max(25, Math.min(AUTOSPIN_MAX, Math.round(n/25)*25));
    const clamp = n => Math.max(1, Math.min(AUTOSPIN_MAX, Math.floor(n)));

    function setFill(val){
      const min = Number(sld.min), max = Number(sld.max);
      const p = Math.max(0, Math.min(100, ((val - min) / (max - min)) * 100));
      sld.style.setProperty('--as-fill', p + '%');
    }
    setFill(Number(sld.value));

    function parsedCountFromInput(){
      const raw = inp.value.trim();
      if (raw === '') return null;
      const n = Math.floor(Number(raw));
      if (!Number.isFinite(n)) return null;
      return clamp(n);
    }

    inp.addEventListener('input', ()=>{
      const c = parsedCountFromInput();
      if (c == null) { setFill(Number(sld.min)); return; }
      sld.value = String(nearest25(c));
      setFill(Number(sld.value));
    });

    sld.addEventListener('input', ()=>{
      const v = Number(sld.value);
      setFill(v);
      inp.value = String(v);
    });

    btnMax.addEventListener('click', ()=>{
      inp.value = String(AUTOSPIN_MAX);
      sld.value = String(AUTOSPIN_MAX);
      setFill(AUTOSPIN_MAX);
    });
    btnCancel.addEventListener('click', closeModal);
    inp.addEventListener('keydown', e=>{ if(e.key==='Enter') btnRun.click(); });

    btnRun.addEventListener('click', async ()=>{
      const c = parsedCountFromInput();
      const count = c == null ? Number(sld.value) : c;
      inp.value = String(count);
      await startAutoSpin(count);
    });
  }

  async function tryPrepayAutoSpin(count){
    try{
      const r = await fetch(`${API_BASE}/roulette/autospin`, {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ user_id: userId || seq, count })
      });
      if (r.status === 404) {
        alert('На сервере не настроен автоспин. Обновите бэкенд (endpoint /api/v1/roulette/autospin).');
        return null;
      }
      if (!r.ok) throw new Error(await r.text());
      const js = await r.json();
      if (js.balance_after_charge != null) setBalanceUI(js.balance_after_charge);
      return { sessionId: js.session_id, count: js.count };
    }catch(e){
      console.warn('autospin prepay error:', e);
      alert('Не удалось выполнить предоплату авто-спина: ' + (e?.message||e));
      return null;
    }
  }

  async function startAutoSpin(count){
    if (autoSpinState.active || rouletteState.spinning) return;
    if (count < 1) { alert('Укажите количество спинов'); return; }

    const total = count * ROULETTE_COST_RUB;
    if (lastBalance + 1e-9 < total){
      alert(`Недостаточно средств. Требуется ${fmt(total)} ₽, на балансе ${fmt(lastBalance)} ₽.`);
      return;
    }

    const pre = await tryPrepayAutoSpin(count);
    if (!pre) return;

    autoSpinState = { active:true, remaining:pre.count, sessionId: pre.sessionId };

    document.getElementById('rbSpin')?.setAttribute('disabled','true');
    document.getElementById('rbAuto')?.setAttribute('disabled','true');
    closeModal();
    runNextAutoSpin();
  }

  async function runNextAutoSpin(){
    if (!autoSpinState.active) return;
    if (autoSpinState.remaining <= 0){
      autoSpinState.active = false;
      document.getElementById('rbSpin')?.removeAttribute('disabled');
      document.getElementById('rbAuto')?.removeAttribute('disabled');
      fetchProfile(); // окончательная синхронизация
      return;
    }

    // 1) Получаем следующий выигрыш и сразу же сервер его зачисляет
    let next;
    try{
      const r = await fetch(`${API_BASE}/roulette/autospin/next`, {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ user_id: userId || seq, session_id: autoSpinState.sessionId })
      });
      if (!r.ok) {
        const txt = await r.text();
        throw new Error(txt || ('HTTP '+r.status));
      }
      next = await r.json();
    } catch (e){
      console.warn('autospin next error:', e);
      // аварийное завершение сессии
      autoSpinState.active = false;
      document.getElementById('rbSpin')?.removeAttribute('disabled');
      document.getElementById('rbAuto')?.removeAttribute('disabled');
      await fetchProfile();
      alert('Авто-спин прерван: ' + (e?.message||e));
      return;
    }

    const win = Number(next.win);
    const balanceAfter = Number(next.balance);

    // 2) Анимация под конкретный win (без серверных списаний — они уже учтены)
    spinRoulette({
      forceWin: win,
      localOnly: true,
      onFinish: () => {
        setBalanceUI(balanceAfter);
        autoSpinState.remaining -= 1;
        if (autoSpinState.active) setTimeout(runNextAutoSpin, 350);
      }
    });
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
      const r = await fetch(bust(`${API_BASE}/services`));
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
        <div class="left"><div class="name">${s.name}</div><div class="meta">Сервис ID: ${s.id}${s.network ? ' • '+s.network : ''}</div></div>
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
          id: s.service, name: s.name, network: s.network,
          min: s.min, max: s.max, rate: s.rate_client_1000, currency: s.currency,
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

    let discountCode = '';
    let discountPct  = 0;
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
            <button id="promoToggle" class="linklike" style="padding:0; background:none; border:0; color:#7aa7ff; text-align:left">У вас есть промокод?</button>
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
    promoToggle?.addEventListener('click', ()=>{ promoOpen = !promoOpen; setPromoUI(); if (promoOpen) promoInput?.focus(); });

    promoApply?.addEventListener('click', async ()=>{
      const code = (promoInput?.value||'').trim();
      if (!code){ alert('Введите промокод'); promoInput?.focus(); return; }
      try{
        promoApply.disabled = true; promoApply.textContent = 'Проверка...';
        const r = await fetch(bust(`${API_BASE}/promo/check?user_id=${encodeURIComponent(userId||seq)}&code=${encodeURIComponent(code)}`));
        const js = await r.json().catch(()=> ({}));
        if (!r.ok){ const msg = (js && js.detail) ? js.detail : 'Код недействителен'; alert(msg); return; }
        const pct = Number(js.percent||0);
        discountPct  = (pct>1 ? pct/100 : pct);
        discountCode = code;
        promoOpen    = false;
        setPromoUI();
        recalc();
      }catch(e){
        alert('Ошибка проверки промокода: ' + (e?.message||e));
      }finally{
        promoApply.disabled = false; promoApply.textContent = 'Активировать';
      }
    });

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

  // === Рефералка / Детализация — (без изменений в этой задаче) ===
  async function loadRefs(){ /* ... как было ... */ }
  async function loadDetails(defaultTab = "orders"){ /* ... как было ... */ }

  // ====== Topup (кнопка в шапке) ======
  btnTopup?.addEventListener('click', onTopupClick);

  // ====== Keyboard inset -> hide tabbar ======
  (function keyboardLift(){
    const root=document.documentElement;
    const tabbar = document.querySelector('.tabbar');

    function applyKbInset(px){
      if (document.body.classList.contains('roulette-open')) return;
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

  window.addEventListener('error', e => console.error('JS error:', e.message, e.filename, e.lineno));

  profileBtn?.addEventListener('click', ()=>{
    ensureProfilePage();
    updateProfilePageView();
    showPage('page-profile');
  });

})();
