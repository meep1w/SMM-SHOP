/* Slovekiza Mini-App
 * Совместимо с данным index.html и app.css
 * - Профиль, баланс, оверлей успешного пополнения
 * - Категории / Услуги / Полная страница услуги
 * - Избранное (локально) + отправка на сервер
 * - Рефералка (линк, прогресс, статы, последние начисления)
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
    document.querySelectorAll(".tabbar .tab").forEach(b=> b.classList.toggle("active", b===btn));
    const tab = btn?.dataset?.tab || 'catalog';
    const id  = pageIdByTab(tab);
    showPage(id);
    if (tab==='favs') renderFavs();
    if (tab==='refs') loadRefs();
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

  // ====== Referrals ======
 async function loadRefs(){
  const box = pages.refs;
  if (!box) return;
  box.innerHTML = '<div class="empty">Загрузка…</div>';
  try{
    const uid = encodeURIComponent(userId || seq);
    const r = await fetch(`${API_BASE}/referrals/stats?user_id=${uid}`, {cache:'no-store'});
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const s = await r.json();

    const progMax = Number(s.threshold ?? 50) || 50;
    const withDep = Number(s.invited_with_deposit ?? 0) || 0;
    const prog = Math.min(100, Math.round(100 * withDep / progMax));
    const link = s.invite_link || s.link || '';   // ← ключевое
    const rate = Number(s.rate_percent ?? 10) || 10;

    box.innerHTML = `
      <div class="card">
        <div class="label">Ваша реферальная ссылка</div>
        <div class="copy-row">
          <input id="refLink" type="text" value="${link}" readonly>
          <button class="btn" id="btnCopyLink">Копировать</button>
          <button class="btn" id="btnShareLink">Поделиться</button>
        </div>
        <div class="hint">За каждое пополнение вашего рефера вы получаете <b>${rate}%</b> на баланс.<br>
        При ${progMax} рефералах с депозитом ставка повышается до <b>20%</b>.</div>
      </div>

      <div class="card">
        <div class="label">Прогресс до 20%</div>
        <div class="progress"><div class="bar" style="width:${prog}%"></div></div>
        <div class="muted">Рефералов с депозитом: <b>${withDep}</b> из <b>${progMax}</b></div>
      </div>

      <div class="card">
        <div class="stat-grid">
          <div><div class="sm">Всего приглашено</div><div class="lg">${Number(s.invited_total||0)}</div></div>
          <div><div class="sm">С депозитом</div><div class="lg">${withDep}</div></div>
          <div><div class="sm">Начислено</div><div class="lg">${fmt(s.earned_total)}${curSign(s.earned_currency||currentCurrency)}</div></div>
        </div>
      </div>

      <div class="card">
        <div class="label">Последние начисления</div>
        <div class="bonus-list" id="bonusList"></div>
      </div>
    `;

    // bonuses
    const list = document.getElementById('bonusList');
    list.innerHTML = '';
    const bonuses = Array.isArray(s.last_bonuses) ? s.last_bonuses : [];
    if (!bonuses.length){
      list.innerHTML = '<div class="empty">Пока нет начислений.</div>';
    } else {
      bonuses.forEach(b=>{
        const el = document.createElement('div');
        el.className = 'bonus-row';
        const dt = new Date((b.ts||0)*1000).toLocaleString('ru-RU');
        el.innerHTML = `<div class="left">#${b.from_seq} • ${dt} • ${b.rate}%</div>
                        <div class="right">+${fmt(b.amount_credit)}${curSign(b.currency||currentCurrency)}</div>`;
        list.appendChild(el);
      });
    }

    // copy/share
    document.getElementById('btnCopyLink')?.addEventListener('click', ()=>{
      copy(link); try{ tg?.HapticFeedback?.impactOccurred?.('light'); }catch(_){}
    });
    document.getElementById('btnShareLink')?.addEventListener('click', ()=>{
      if (tg?.openLink && link) tg.openLink(link); else if (link) window.open(link,'_blank');
    });

  }catch(e){
    console.error('refs load failed:', e);
    box.innerHTML = `<div class="empty">Не удалось загрузить рефералку${e?.message ? ` (${e.message})` : ''}.</div>`;
  }
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
