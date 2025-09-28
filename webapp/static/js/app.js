/* Slovekiza Mini-App (robust DOM version)
 * - tolerant to missing/mismatched ids/classes in HTML
 * - creates missing containers on the fly
 * - keeps all features: profile, categories/services, service page, favorites, topup, referrals
 */
(function () {
  // ===== helpers =====
  const tg = (window.Telegram && window.Telegram.WebApp) || null;
  try { tg?.expand?.(); tg?.ready?.(); tg?.MainButton?.hide?.(); tg?.BackButton?.hide?.(); tg?.disableVerticalSwipes?.(); } catch (_) {}

  const API_BASE = "/api/v1";

  const qs  = (sel, root=document) => root.querySelector(sel);
  const qsa = (sel, root=document) => Array.from(root.querySelectorAll(sel));

  function byIds(ids){ for (const id of ids) { const el = document.getElementById(id); if (el) return el; } return null; }
  function bySelList(list){ for (const sel of list){ const el = qs(sel); if (el) return el; } return null; }
  function ensure(parent, tag, attrs={}, className=""){
    if (!parent) return null;
    const el = document.createElement(tag);
    Object.entries(attrs).forEach(([k,v])=> el.setAttribute(k, v));
    if (className) el.className = className;
    parent.appendChild(el);
    return el;
  }

  function curSign(c){ return c==='RUB'?' ₽':(c==='USD'?' $':` ${c}`); }
  function fmt(n,d=2){ return Number(n||0).toFixed(d); }
  function copy(text){
    try{ navigator.clipboard?.writeText(text); }catch(_){
      const t=document.createElement('textarea'); t.value=text; document.body.appendChild(t); t.select(); document.execCommand('copy'); t.remove();
    }
  }
  function bust(url){
    const u = new URL(url, location.origin);
    u.searchParams.set('_', Date.now().toString());
    return u.toString();
  }

  // ===== header DOM (robust lookups) =====
  const nicknameEl  = byIds(['nickname']) || bySelList(['.nick', '[data-nickname]']);
  const avatarEl    = byIds(['avatar'])   || bySelList(['.avatar', 'img[alt="avatar"]']);
  const userSeqEl   = byIds(['userSeq'])  || bySelList(['.nick-sub [data-seq]', '[data-user-seq]']);
  const balanceEl   = byIds(['balanceValue']) || bySelList(['.balance-value', '[data-balance]']);
  const btnTopup    = byIds(['btnTopup'])     || bySelList(['.btn-plus', '[data-topup]']);

  // ===== pages (accept several ids) =====
  function findPage(anyIds){
    for (const id of anyIds){ const el = document.getElementById(id); if (el) return el; }
    return null;
  }
  const pages = {
    catalog:  findPage(['page-categories','page-catalog','pageCatalog']) || ensure(qs('.app-main')||document.body, 'div', {id:'page-categories'}, 'page'),
    services: findPage(['page-services','pageServices'])                 || ensure(qs('.app-main')||document.body, 'div', {id:'page-services'}, 'page'),
    favs:     findPage(['page-favs','pageFavorites'])                    || ensure(qs('.app-main')||document.body, 'div', {id:'page-favs'}, 'page'),
    refs:     findPage(['page-refs','pageReferrals'])                    || ensure(qs('.app-main')||document.body, 'div', {id:'page-refs'}, 'page'),
    details:  findPage(['page-details','pageDetails'])                   || ensure(qs('.app-main')||document.body, 'div', {id:'page-details'}, 'page'),
    service:  findPage(['page-service','pageService'])                   || ensure(qs('.app-main')||document.body, 'div', {id:'page-service'}, 'page'),
  };

  // containers inside pages
  let catsListEl     = byIds(['catsList','categoriesList']) || bySelList(['#page-categories .cats-list']);
  if (!catsListEl && pages.catalog) catsListEl = ensure(pages.catalog, 'div', {id:'catsList'}, 'cats-list');

  const servicesTitle   = byIds(['servicesTitle']) || bySelList(['#page-services .subheader-title']);
  const btnBackToCats   = byIds(['btnBackToCats']) || bySelList(['#page-services .back']);
  let servicesListEl    = byIds(['servicesList'])  || bySelList(['#page-services .services-list']);
  if (!servicesListEl && pages.services) servicesListEl = ensure(pages.services, 'div', {id:'servicesList'}, 'services-list');

  const servicesSearchEl  = byIds(['servicesSearch']) || bySelList(['#page-services input[type="search"]', '#page-services .search input']);
  const serviceTitleEl    = byIds(['serviceTitle'])   || bySelList(['#page-service .subheader-title']);
  const btnBackToServices = byIds(['btnBackToServices']) || bySelList(['#page-service .back']);
  const serviceDetailsEl  = byIds(['serviceDetails']) || bySelList(['#page-service .service-details']) || ensure(pages.service, 'div', {id:'serviceDetails'}, 'service-details');

  // ===== topup overlay =====
  function showTopupOverlay(delta, currency){
    const id='topupOverlay';
    let overlay = document.getElementById(id);
    if (!overlay){
      overlay = document.createElement('div');
      overlay.id = id;
      overlay.setAttribute('aria-hidden','true');
      overlay.style.cssText='position:fixed;inset:0;z-index:9999;background:rgba(10,12,16,.92);display:none;align-items:center;justify-content:center;padding:24px;backdrop-filter:blur(4px)';
      overlay.innerHTML = `
        <div style="width:min(440px,92vw);background:#14171f;border-radius:20px;box-shadow:0 10px 30px rgba(0,0,0,.5);padding:28px;text-align:center;color:#e6e8ee;border:1px solid rgba(255,255,255,.06)">
          <div style="width:88px;height:88px;margin:0 auto 16px;border-radius:50%;background:radial-gradient(110px 110px at 30% 30%,#2ed47a 0%,#1a9f55 60%,#117a3f 100%);display:grid;place-items:center;box-shadow:0 10px 30px rgba(46,212,122,.35),inset 0 0 18px rgba(255,255,255,.15)">
            <svg viewBox="0 0 24 24" fill="none" style="width:44px;height:44px;color:#fff"><path d="M9 16.2 4.8 12 3.4 13.4 9 19 21 7 19.6 5.6 9 16.2Z" fill="currentColor"/></svg>
          </div>
          <div style="font:600 20px/1.3 Inter,system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;margin:6px 0 8px">Оплата прошла успешно</div>
          <div style="font:400 14px/1.5 Inter,system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#a8afbd;margin-bottom:18px">Баланс пополнен.</div>
          <div id="topupAmount" style="font:600 16px/1.4 Inter,system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;margin-bottom:16px"></div>
          <button id="topupOkBtn" style="width:100%;padding:12px 16px;border-radius:14px;border:0;cursor:pointer;background:linear-gradient(180deg,#2b81f7 0%,#1f6cdc 100%);color:#fff;font:600 15px/1 Inter,system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;box-shadow:0 8px 20px rgba(43,129,247,.35)">Окей</button>
        </div>`;
      document.body.appendChild(overlay);
      overlay.addEventListener('click', e => { if (e.target === overlay) overlay.setAttribute('aria-hidden','true'); });
      overlay.querySelector('#topupOkBtn')?.addEventListener('click', ()=> overlay.setAttribute('aria-hidden','true'));
    }
    try { tg?.HapticFeedback?.notificationOccurred?.('success'); } catch(_){}
    try { navigator.vibrate?.([30,20,30]); } catch(_){}
    overlay.querySelector('#topupAmount').textContent = `+${Number(delta||0).toFixed(2)} ${currency||''}`.trim();
    overlay.setAttribute('aria-hidden','false');
    overlay.style.display='flex';
  }

  // ===== profile =====
  let userId = null; try { userId = tg?.initDataUnsafe?.user?.id || null; } catch(_) {}
  function urlNick(){ try{ const p=new URLSearchParams(location.search); const v=p.get('n'); return v?decodeURIComponent(v):null; }catch(_){ return null; } }
  const nickFromUrl = urlNick();

  if (nicknameEl) nicknameEl.textContent = nickFromUrl || 'Гость';
  try {
    const photo = tg?.initDataUnsafe?.user?.photo_url;
    if (photo && avatarEl) avatarEl.src = photo;
  } catch(_){}
  if (avatarEl && !avatarEl.getAttribute('src')) {
    avatarEl.src='data:image/svg+xml;utf8,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 80"><rect fill="#1b1e24" width="80" height="80" rx="40"/><circle cx="40" cy="33" r="15" fill="#2a2f36"/><path d="M15 66c5-12 18-18 25-18s20 6 25 18" fill="#2a2f36"/></svg>');
  }
  function stableHashId(x){ let h=0,s=String(x||''); for(let i=0;i<s.length;i++){ h=((h<<5)-h+s.charCodeAt(i))|0; } h=Math.abs(h); return (h%100000)+1; }
  let seq = parseInt(localStorage.getItem('smm_user_seq')||'0',10) || stableHashId(userId||nickFromUrl||'guest');
  if (userSeqEl) userSeqEl.textContent = `#${seq}`;

  let currentCurrency = 'RUB';
  let lastBalance = 0;

  async function fetchProfile(){
    try{
      const qp = new URLSearchParams({ user_id:String(userId||seq), consume_topup:'1' });
      if (nickFromUrl) qp.set('nick', nickFromUrl);
      const r = await fetch(bust(`${API_BASE}/user?${qp.toString()}`));
      if (!r.ok) throw 0;
      const p = await r.json();

      if (p.nick && nicknameEl) nicknameEl.textContent = p.nick;
      if (p.seq){
        seq = p.seq;
        if (userSeqEl) userSeqEl.textContent = `#${p.seq}`;
        localStorage.setItem('smm_user_seq', String(p.seq));
      }

      currentCurrency = (p.currency||'RUB').toUpperCase();
      lastBalance = Number(p.balance||0);
      if (balanceEl) balanceEl.textContent = `${lastBalance.toFixed(2)}${curSign(currentCurrency)}`;

      if (p.topup_delta && Number(p.topup_delta) > 0){
        showTopupOverlay(Number(p.topup_delta), p.topup_currency || currentCurrency);
      }
      return p;
    }catch(_){
      currentCurrency='RUB'; lastBalance=0;
      if (balanceEl) balanceEl.textContent = '0.00' + curSign('RUB');
      return null;
    }
  }
  fetchProfile();
  window.addEventListener('focus', fetchProfile);
  document.addEventListener('visibilitychange', ()=>{ if(!document.hidden) fetchProfile(); });

  // ===== topup =====
  btnTopup?.addEventListener('click', async ()=>{
    try{
      const s = prompt('Сумма пополнения, USDT (мин. 0.10):','1.00');
      if(!s) return;
      const amount = parseFloat(s);
      if (isNaN(amount) || amount < 0.10){ alert('Минимальная сумма — 0.10 USDT'); return; }
      const r = await fetch(`${API_BASE}/pay/invoice`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ user_id: userId||seq, amount_usd: amount }) });
      if (r.status === 501){ alert('Оплата через CryptoBot ещё не настроена.'); return; }
      if (!r.ok) throw new Error(await r.text());
      const j = await r.json();
      (tg?.openLink ? tg.openLink(j.pay_url) : window.open(j.pay_url,'_blank'));
    }catch(e){ alert('Ошибка создания счёта: ' + (e?.message||e)); }
  });

  // ===== tabbar / pages =====
  function allPageIds(){ return ['page-categories','page-services','page-favs','page-refs','page-details','page-service']; }
  function showPageById(id){
    allPageIds().forEach(pid => document.getElementById(pid)?.classList.remove('active'));
    document.getElementById(id)?.classList.add('active');
    try{ window.scrollTo({top:0, behavior:'instant'}); }catch(_){}
  }
  function pageIdByTabName(name){
    if (name==='catalog'||name==='categories') return 'page-categories';
    if (name==='favs'||name==='favorites')     return 'page-favs';
    if (name==='refs'||name==='referrals')     return 'page-refs';
    if (name==='details')                      return 'page-details';
    if (name==='services')                     return 'page-services';
    if (name==='service')                      return 'page-service';
    return 'page-categories';
  }
  function showPageByTabName(name){ showPageById(pageIdByTabName(name)); if (name==='favs') renderFavs(); if (name==='refs') loadRefs(); }
  function activateTab(btn){
    qsa('.tabbar .tab').forEach(b=>b.classList.toggle('active', b===btn));
    showPageByTabName(btn?.dataset?.tab || 'catalog');
  }
  qsa('.tabbar .tab').forEach(btn=> btn.addEventListener('click', ()=> activateTab(btn)));
  (qs('.tabbar .tab[data-tab="catalog"]') || qs('.tabbar .tab[data-tab="categories"]') || qs('.tabbar .tab')) ? activateTab(qs('.tabbar .tab[data-tab="catalog"]') || qs('.tabbar .tab[data-tab="categories"]') || qs('.tabbar .tab')) : showPageByTabName('catalog');

  // ===== categories / services =====
  let currentNetwork = null;
  let servicesAll = [];

  async function loadCategories(){
    if (!pages.catalog) return;
    try{
      const r = await fetch(bust(`${API_BASE}/services`));
      const items = await r.json();
      renderCategories(items);
    }catch{
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
    if (!catsListEl){ catsListEl = ensure(pages.catalog, 'div', {id:'catsList'}, 'cats-list'); }
    catsListEl.innerHTML='';
    items.forEach(c=>{
      const a = document.createElement('a');
      a.href='#'; a.className='cat'; a.dataset.cat=c.id;
      a.innerHTML = `
        <div class="cat-icon"><img src="static/img/${c.id}.svg" alt=""></div>
        <div class="cat-body">
          <div class="cat-name">${c.name}</div>
          <div class="cat-desc">${(c.desc||'')+(c.count?(' • '+c.count):'')}</div>
        </div>`;
      a.addEventListener('click', e => { e.preventDefault(); openServices(c.id, c.name); });
      catsListEl.appendChild(a);
    });
  }

  async function openServices(network, title){
    currentNetwork = network;
    if (servicesTitle) servicesTitle.textContent = title || 'Услуги';
    showPageByTabName('services');
    renderServicesSkeleton(4);
    try{
      const r = await fetch(bust(`${API_BASE}/services/${network}`));
      const items = await r.json();
      servicesAll = Array.isArray(items) ? items : [];
      if (servicesSearchEl) servicesSearchEl.value='';
      applyServicesFilter();
    }catch{ servicesListEl.innerHTML = '<div class="empty">Не удалось загрузить услуги</div>'; }
  }

  function renderServicesSkeleton(n){
    servicesListEl.innerHTML='';
    for (let i=0;i<n;i++){
      servicesListEl.insertAdjacentHTML('beforeend', `
        <div class="skeleton">
          <div class="skel-row"><div class="skel-avatar"></div><div class="skel-lines"><div class="skel-line"></div><div class="skel-line short"></div></div></div>
        </div>`);
    }
  }

  function applyServicesFilter(){
    const q = (servicesSearchEl?.value||'').trim().toLowerCase();
    const filtered = !q ? servicesAll : servicesAll.filter(s=>{
      const hay = [s.name, s.type, s.category, s.desc, s.description].filter(Boolean).join(' ').toLowerCase();
      return hay.includes(q);
    });
    renderServices(filtered);
  }
  servicesSearchEl?.addEventListener('input', applyServicesFilter);

  function renderServices(items){
    servicesListEl.innerHTML='';
    if (!Array.isArray(items) || !items.length){ servicesListEl.innerHTML='<div class="empty">Нет услуг в этой категории</div>'; return; }
    items.forEach(s=>{
      const row = document.createElement('div'); row.className='service';
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
      row.querySelector('button').addEventListener('click', (e)=>{ e.stopPropagation(); openServicePage(s); });
      servicesListEl.appendChild(row);
    });
  }

  // ===== favorites (local mirror) =====
  function favLoad(){ try { return JSON.parse(localStorage.getItem('smm_favs')||'[]'); } catch(_){ return []; } }
  function favSave(arr){ localStorage.setItem('smm_favs', JSON.stringify(arr||[])); }
  function favHas(id){ return favLoad().some(x=>x.id===id); }
  function favAdd(item){ const a=favLoad(); if(!a.some(x=>x.id===item.id)){ a.push(item); favSave(a); } }
  function favRemove(id){ favSave(favLoad().filter(x=>x.id!==id)); }
  function renderFavs(){
    const box = pages.favs?.querySelector('.fav-list') || ensure(pages.favs,'div',{},'fav-list');
    const items = favLoad();
    box.innerHTML='';
    if (!items.length){ box.innerHTML='<div class="empty">Избранных услуг пока нет.</div>'; return; }
    items.forEach(s=>{
      const row = document.createElement('div'); row.className='service';
      row.innerHTML = `
        <div class="left">
          <div class="name">${s.name}</div>
          <div class="meta">Сервис ID: ${s.id}${s.network ? ' • '+s.network : ''}</div>
        </div>
        <div class="right"><button class="btn" data-id="${s.id}">Открыть</button></div>`;
      row.querySelector('button').addEventListener('click', ()=> openServicePage(s._raw || {service:s.id, name:s.name, min:s.min||1, max:s.max||100000, rate_client_1000:s.rate||0, currency:s.currency||currentCurrency}));
      box.appendChild(row);
    });
  }

  // ===== full service page =====
  function presetValues(min,max){ const base=[100,500,1000,2500,5000,10000]; const arr=base.filter(q=>q>=min&&q<=max); if(arr.length) return arr; const a=[]; let q=min; for(let i=0;i<6;i++){ a.push(q); q=Math.min(max,Math.round(q*2)); if(q===a[a.length-1]) break; } return a.slice(0,6); }
  function priceFor(q,s){ return Math.max(0, Number(s.rate_client_1000||0) * Number(q||0) / 1000); }

  function openServicePage(s){
    if (!s) return;
    const min=Number(s.min||1), max=Number(s.max||100000);
    const presets=presetValues(min,max);
    const cur=Math.max(min, Math.min(presets[0]||min, max));
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
          <button class="promo-toggle" id="promoToggle">У меня есть промокод</button>
          <div class="promo-wrap" id="promoWrap">
            <input id="promoInput" type="text" placeholder="Промокод">
            <button class="chip" id="promoApply">Активировать</button>
          </div>
        </div>

        <div class="card summary">
          <div class="sum-row"><span>Количество</span><b id="sumQty">${cur}</b></div>
          <div class="sum-row"><span>Цена</span><b id="sumPrice">${priceFor(cur,s).toFixed(4)}${curSign(currency)}</b></div>
          <button class="btn-primary" id="svcCreate">Создать заказ</button>
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

    const qtyGrid   = byIds(['qtyGrid']) || qs('#qtyGrid');
    const qtyInput  = byIds(['svcQty'])   || qs('#svcQty');
    const chipMin   = byIds(['chipMin'])  || qs('#chipMin');
    const chipMax   = byIds(['chipMax'])  || qs('#chipMax');
    const sumQty    = byIds(['sumQty'])   || qs('#sumQty');
    const sumPrice  = byIds(['sumPrice']) || qs('#sumPrice');
    const linkEl    = byIds(['svcLink'])  || qs('#svcLink');
    const linkErr   = byIds(['svcLinkErr']) || qs('#svcLinkErr');
    const promoToggle = byIds(['promoToggle']) || qs('#promoToggle');
    const promoWrap   = byIds(['promoWrap'])   || qs('#promoWrap');
    const promoInput  = byIds(['promoInput'])  || qs('#promoInput');
    const promoApply  = byIds(['promoApply'])  || qs('#promoApply');
    const btnCreate   = byIds(['svcCreate'])   || qs('#svcCreate');
    const favToggle   = byIds(['favToggle'])   || qs('#favToggle');

    qtyGrid.innerHTML='';
    presets.forEach(q=>{
      const btn=document.createElement('button'); btn.className='qty';
      btn.innerHTML = `<div class="num">${q.toLocaleString('ru-RU')}</div><div class="price">${priceFor(q,s).toFixed(4)}${curSign(currency)}</div>`;
      if (q===cur) btn.classList.add('active');
      btn.addEventListener('click', ()=>{
        qsa('.qty', qtyGrid).forEach(x=>x.classList.remove('active'));
        btn.classList.add('active');
        qtyInput.value=String(q);
        sumQty.textContent=q;
        sumPrice.textContent=`${priceFor(q,s).toFixed(4)}${curSign(currency)}`;
      });
      qtyGrid.appendChild(btn);
    });

    chipMin?.addEventListener('click', ()=>{ const q=min; qtyInput.value=String(q); qsa('.qty',qtyGrid).forEach(x=>x.classList.remove('active')); sumQty.textContent=q; sumPrice.textContent=`${priceFor(q,s).toFixed(4)}${curSign(currency)}`; });
    chipMax?.addEventListener('click', ()=>{ const q=max; qtyInput.value=String(q); qsa('.qty',qtyGrid).forEach(x=>x.classList.remove('active')); sumQty.textContent=q; sumPrice.textContent=`${priceFor(q,s).toFixed(4)}${curSign(currency)}`; });

    qtyInput?.addEventListener('input', ()=>{
      let q=parseInt(qtyInput.value||'0',10); if(!Number.isFinite(q)) q=min; q=Math.max(min, Math.min(max, q));
      sumQty.textContent=q; sumPrice.textContent=`${priceFor(q,s).toFixed(4)}${curSign(currency)}`;
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
        fetch(`${API_BASE}/favorites`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ user_id:userId||seq, service_id:s.service }) }).catch(()=>{});
      } else {
        favRemove(s.service);
        fetch(`${API_BASE}/favorites/${s.service}?user_id=${encodeURIComponent(userId||seq)}`, { method:'DELETE' }).catch(()=>{});
      }
    });

    btnCreate?.addEventListener('click', async ()=>{
      const link=(linkEl?.value||'').trim();
      const q   = parseInt(qtyInput?.value||'0',10);
      if(!link){ linkErr?.classList.add('show'); linkEl?.focus(); return; }
      linkErr?.classList.remove('show');
      if (q<min || q>max){ alert(`Количество должно быть от ${min} до ${max}`); return; }

      btnCreate.disabled=true; btnCreate.textContent='Оформляем...';
      try{
        const body={ user_id:userId||seq, service:s.service, link, quantity:q };
        const promo=(promoInput?.value||'').trim(); if (promo) body.promo_code=promo;
        const r=await fetch(`${API_BASE}/order/create`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) });
        if(!r.ok) throw new Error(await r.text());
        const j=await r.json();
        alert(`Заказ создан!\nНомер: ${j.order_id}\nСумма: ${j.cost} ${j.currency}`);
        await fetchProfile();
      }catch(e){ alert('Не удалось создать заказ: ' + (e?.message||e)); }
      finally{ btnCreate.disabled=false; btnCreate.textContent='Создать заказ'; }
    });

    showPageByTabName('service');
    try{ history.replaceState(null,'',`#service-${s.service}`); }catch(_){}
  }

  btnBackToCats?.addEventListener('click', ()=> showPageByTabName('catalog'));
  btnBackToServices?.addEventListener('click', ()=> showPageByTabName('services'));

  // ===== start =====
  loadCategories();

  // ===== referrals =====
  async function loadRefs(){
    const box = pages.refs;
    if (!box) return;
    box.innerHTML = '<div class="empty">Загрузка…</div>';
    try{
      const r = await fetch(bust(`${API_BASE}/referrals/stats?user_id=${encodeURIComponent(userId||seq)}`));
      if (!r.ok) throw 0;
      const s = await r.json();

      const prog = Math.min(100, Math.round(100 * (s.invited_with_deposit||0) / (s.threshold||50)));
      const link = s.link || s.invite_link || '';
      const rate = s.rate_percent || 10;

      box.innerHTML = `
        <div class="card">
          <div class="label">Ваша реферальная ссылка</div>
          <div class="copy-row">
            <input id="refLink" type="text" value="${link}" readonly>
            <button class="btn" id="btnCopyLink">Копировать</button>
            <button class="btn" id="btnShareLink">Поделиться</button>
          </div>
          <div class="hint">За каждое пополнение вашего рефера вы получаете <b>${rate}%</b> автоматически на баланс.<br>
          При ${s.threshold} рефералах с депозитом ставка повышается до <b>20%</b>.</div>
        </div>

        <div class="card">
          <div class="label">Прогресс до 20%</div>
          <div class="progress"><div class="bar" style="width:${prog}%"></div></div>
          <div class="muted">Рефералов с депозитом: <b>${s.invited_with_deposit}</b> из <b>${s.threshold}</b></div>
        </div>

        <div class="card">
          <div class="stat-grid">
            <div><div class="sm">Всего приглашено</div><div class="lg">${s.invited_total}</div></div>
            <div><div class="sm">С депозитом</div><div class="lg">${s.invited_with_deposit}</div></div>
            <div><div class="sm">Начислено</div><div class="lg">${fmt(s.earned_total)}${curSign(s.currency||currentCurrency)}</div></div>
          </div>
        </div>

        <div class="card">
          <div class="label">Последние начисления</div>
          <div class="bonus-list" id="bonusList"></div>
        </div>`;

      // tiny CSS additions injected if not in external CSS
      if (!document.getElementById('refs-extra-css')){
        const st=document.createElement('style'); st.id='refs-extra-css'; st.textContent=`
          .copy-row{display:grid;grid-template-columns:1fr auto auto;gap:8px}
          .copy-row input{width:100%;background:#0f1319;border:1px solid #2a2f36;border-radius:12px;padding:10px 12px;color:#e6e8ee}
          .progress{height:10px;background:#0f1319;border:1px solid #2a2f36;border-radius:999px;overflow:hidden}
          .progress .bar{height:100%;background:linear-gradient(90deg,#2b81f7,#00d084)}
          .stat-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;text-align:center}
          .stat-grid .sm{color:#9aa3b2;font-size:12px;margin-bottom:6px}
          .stat-grid .lg{font-weight:700;font-size:18px}
          .bonus-row{display:flex;align-items:center;justify-content:space-between;padding:10px 12px;border:1px solid #2a2f36;border-radius:12px;margin-top:8px;background:#0f1319}
          .bonus-row .left{color:#cfd5e1} .bonus-row .right{font-weight:600}`; document.head.appendChild(st);
      }

      const list = byIds(['bonusList']) || qs('#bonusList');
      list.innerHTML='';
      if (!Array.isArray(s.last_bonuses) || !s.last_bonuses.length){
        list.innerHTML = '<div class="empty">Пока нет начислений.</div>';
      } else {
        s.last_bonuses.forEach(b=>{
          const el=document.createElement('div'); el.className='bonus-row';
          const dt=new Date((b.ts||0)*1000).toLocaleString('ru-RU');
          el.innerHTML = `<div class="left">#${b.from_seq} • ${dt} • ${b.rate}%</div>
                          <div class="right">+${fmt(b.amount_credit)}${curSign(b.currency||currentCurrency)}</div>`;
          list.appendChild(el);
        });
      }

      byIds(['btnCopyLink'])?.addEventListener('click', ()=>{ copy(link); try{ tg?.HapticFeedback?.impactOccurred?.('light'); }catch(_){ } });
      byIds(['btnShareLink'])?.addEventListener('click', ()=>{ if (tg?.openLink) tg.openLink(link); else window.open(link,'_blank'); });

    }catch(_){
      box.innerHTML = '<div class="empty">Не удалось загрузить рефералку.</div>';
    }
  }

  // ===== keyboard inset handler =====
  (function keyboardLift(){
    const root=document.documentElement;
    function applyKbInset(px){ const v=px>40?px:0; root.style.setProperty('--kb', v+'px'); }
    if (window.visualViewport){
      const vv=window.visualViewport;
      const handler=()=>{ const inset=Math.max(0, window.innerHeight - vv.height - vv.offsetTop); applyKbInset(inset); };
      vv.addEventListener('resize', handler); vv.addEventListener('scroll', handler); handler();
    }
    try{
      tg?.onEvent?.('viewportChanged', (e)=>{
        const vh=(e&&(e.height||e.viewportHeight)) || tg?.viewportHeight || tg?.viewport?.height;
        if (!vh) return; const inset=Math.max(0, window.innerHeight - vh); applyKbInset(inset);
      });
    }catch(_){}
  })();

})();
