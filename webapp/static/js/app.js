/* Mini-App: категории → список услуг → заказ за внутренний баланс (RUB/USDT-aware) */
(function () {
  const tg = window.Telegram?.WebApp;

  try { tg?.expand?.(); tg?.ready?.(); tg?.MainButton?.hide?.(); tg?.BackButton?.hide?.(); tg?.disableVerticalSwipes?.(); } catch (_) {}

  const API_BASE = "/api/v1";

  const nicknameEl = document.getElementById('nickname');
  const avatarEl   = document.getElementById('avatar');
  const userSeqEl  = document.getElementById('userSeq');
  const balanceEl  = document.getElementById('balanceValue');
  const btnTopup   = document.getElementById('btnTopup');

  const pages = {
    categories: document.getElementById('page-categories'),
    services:   document.getElementById('page-services'),
    favs:       document.getElementById('page-favs'),
    details:    document.getElementById('page-details'),
  };
  const catsList = document.getElementById('catsList');
  const servicesList = document.getElementById('servicesList');
  const servicesTitle = document.getElementById('servicesTitle');
  const btnBackToCats = document.getElementById('btnBackToCats');

  const modal = document.getElementById('orderModal');
  const orderTitle = document.getElementById('orderTitle');
  const inputLink = document.getElementById('inputLink');
  const inputQty  = document.getElementById('inputQty');
  const qtyHint   = document.getElementById('qtyHint');
  const priceInfo = document.getElementById('priceInfo');
  const btnCancelOrder = document.getElementById('btnCancelOrder');
  const btnCreateOrder = document.getElementById('btnCreateOrder');

  // Telegram user id (для привязки)
  let userId = null;
  try { userId = tg?.initDataUnsafe?.user?.id || null; } catch (_) {}

  // Ник из URL (?n=...)
  function getQueryNick() {
    try {
      const qs = new URLSearchParams(window.location.search);
      const n = qs.get('n');
      return n ? decodeURIComponent(n) : null;
    } catch (_) { return null; }
  }
  const urlNick = getQueryNick();
  nicknameEl.textContent = urlNick || 'Гость';

  // Аватар
  try { const photo = tg?.initDataUnsafe?.user?.photo_url; if (photo) avatarEl.src = photo; } catch (_) {}
  if (!avatarEl.src) {
    avatarEl.src = 'data:image/svg+xml;utf8,' + encodeURIComponent(`
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 80">
        <defs><linearGradient id="g" x1="0" x2="1" y1="0" y2="1">
          <stop stop-color="#23262d" offset="0"/><stop stop-color="#1b1e24" offset="1"/>
        </linearGradient></defs>
        <rect fill="url(#g)" width="80" height="80" rx="40"/>
        <circle cx="40" cy="33" r="15" fill="#2a2f36"/>
        <path d="M15 66c5-12 18-18 25-18s20 6 25 18" fill="#2a2f36"/>
      </svg>`);
  }

  // helper: символ валюты
  function curSign(c){ return c === 'RUB' ? ' ₽' : (c === 'USD' ? ' $' : ` ${c}`); }

  // стабильный #
  function stableHashId(x){let h=0,s=String(x||'');for(let i=0;i<s.length;i++){h=((h<<5)-h+s.charCodeAt(i))|0;}h=Math.abs(h);return (h%100000)+1;}
  let seq = parseInt(localStorage.getItem('smm_user_seq')||'0',10) || stableHashId(userId||urlNick||'guest');
  userSeqEl.textContent = seq;

  // профиль / валюта / баланс
  let currentCurrency = 'RUB';
  let lastBalance = 0;     // числом, для сравнения при авто-рефреше
  let topupTimer = null;   // сторожок после инвойса
  let topupTries = 0;

  function setBalanceView(value, currency){
    currentCurrency = (currency || 'RUB').toUpperCase();
    lastBalance = Number(value || 0);
    balanceEl.textContent = `${lastBalance.toFixed(2)}${curSign(currentCurrency)}`;
  }

  async function fetchProfile(){
    try{
      const params = new URLSearchParams({ user_id: String(userId || seq) });
      if (urlNick) params.set('nick', urlNick);
      const r = await fetch(`${API_BASE}/user?${params.toString()}`);
      if(!r.ok) throw 0;
      const p = await r.json(); // {nick, balance, currency, seq}
      if (p.nick) nicknameEl.textContent = p.nick;
      if (p.seq){ seq = p.seq; userSeqEl.textContent = p.seq; localStorage.setItem('smm_user_seq', String(p.seq)); }
      setBalanceView(p.balance || 0, p.currency || 'RUB');
    }catch(_){
      setBalanceView(0, 'RUB');
    }
  }
  fetchProfile();

  // автообновление при возврате в мини-аппу
  window.addEventListener('focus', () => { fetchProfile(); });

  // сторожок пополнения — опрос профиля после открытия инвойса
  function startTopupWatcher(){
    if (topupTimer) { clearTimeout(topupTimer); topupTimer = null; }
    topupTries = 0;
    const tick = async () => {
      topupTries += 1;
      const before = lastBalance;
      await fetchProfile();
      if (lastBalance > before + 1e-6) {
        try { tg?.HapticFeedback?.notificationOccurred?.('success'); } catch(_) {}
        try { alert('Баланс пополнен ✅'); } catch(_) {}
        return;
      }
      if (topupTries < 24) { // ~2 минуты по 5 сек
        topupTimer = setTimeout(tick, 5000);
      }
    };
    topupTimer = setTimeout(tick, 5000);
  }

  // Пополнение — min 0.10 USDT
  btnTopup.addEventListener('click', async () => {
    try {
      const amountStr = prompt('Сумма пополнения, USDT (мин. 0.10):', '1.00');
      if (!amountStr) return;
      const amount = parseFloat(amountStr);
      if (isNaN(amount) || amount < 0.10) { alert('Минимальная сумма — 0.10 USDT'); return; }
      const r = await fetch(`${API_BASE}/pay/invoice`, {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ user_id: userId || seq, amount_usd: amount }),
      });
      if (r.status === 501) { alert('Оплата через CryptoBot ещё не настроена.'); return; }
      if (!r.ok) throw new Error(await r.text());
      const j = await r.json();
      (tg?.openLink ? tg.openLink(j.pay_url) : window.open(j.pay_url,'_blank'));
      // запустим сторожок: вернёшься из CryptoBot — баланс обновится
      startTopupWatcher();
    } catch(e){ alert('Ошибка создания счёта: ' + (e?.message||e)); }
  });

  // Tabs
  const tabs = document.querySelectorAll('.tabbar .tab');
  tabs.forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab;
      tabs.forEach(b => b.classList.toggle('active', b === btn));
      Object.entries(pages).forEach(([k, el]) => el.classList.toggle('active', k === tab));
    });
  });

  // Категории
  async function loadCategories(){
    try{
      const r = await fetch(`${API_BASE}/services`);
      const items = await r.json();
      renderCategories(items);
    }catch(_){
      renderCategories([
        {id:'telegram',name:'Telegram',desc:'подписчики, просмотры'},
        {id:'tiktok',name:'TikTok',desc:'просмотры, фолловеры'},
        {id:'instagram',name:'Instagram',desc:'подписчики, лайки'},
        {id:'youtube',name:'YouTube',desc:'просмотры, подписки'},
        {id:'facebook',name:'Facebook',desc:'лайки, подписчики'},
      ]);
    }
  }
  function renderCategories(items){
    const list = document.getElementById('catsList');
    list.innerHTML='';
    items.forEach(c=>{
      const a=document.createElement('a');
      a.href='#'; a.className='cat'; a.dataset.cat=c.id;
      a.innerHTML = `
        <div class="cat-icon"><img src="static/img/${c.id}.svg" alt=""></div>
        <div class="cat-body">
          <div class="cat-name">${c.name}</div>
          <div class="cat-desc">${c.desc}${c.count?` • ${c.count}`:''}</div>
        </div>`;
      a.addEventListener('click',e=>{e.preventDefault(); openServices(c.id,c.name);});
      list.appendChild(a);
    });
  }
  loadCategories();

  // Услуги
  const servicesListEl = document.getElementById('servicesList');
  let currentNetwork = null;
  let currentService = null;

  document.getElementById('btnBackToCats').addEventListener('click', ()=>{ showPage('categories'); });

  function showPage(name){
    Object.entries(pages).forEach(([k,el])=> el.classList.toggle('active', k===name));
    document.querySelectorAll('.tabbar .tab').forEach(b=> b.classList.toggle('active', b.dataset.tab===name));
  }

  function renderServicesSkeleton(rows=4){
    servicesListEl.innerHTML='';
    for(let i=0;i<rows;i++){
      servicesListEl.insertAdjacentHTML('beforeend', `
        <div class="skeleton">
          <div class="skel-row">
            <div class="skel-avatar"></div>
            <div class="skel-lines">
              <div class="skel-line"></div>
              <div class="skel-line short"></div>
            </div>
          </div>
        </div>
      `);
    }
  }

  async function openServices(network, title){
    currentNetwork = network;
    servicesTitle.textContent = title;
    showPage('services');
    renderServicesSkeleton(4);
    try{
      const r = await fetch(`${API_BASE}/services/${network}`);
      if(!r.ok) throw 0;
      const items = await r.json();
      renderServices(items);
    }catch(_){
      servicesListEl.innerHTML = '<div class="empty">Не удалось загрузить услуги</div>';
    }
  }

  function renderServices(items){
    servicesListEl.innerHTML = '';
    items.forEach(s=>{
      const row = document.createElement('div');
      row.className = 'service';
      const sign = curSign((s.currency||currentCurrency).toUpperCase());
      row.innerHTML = `
        <div class="left">
          <div class="name">${s.name}</div>
          <div class="meta">Тип: ${s.type} • Мин: ${s.min} • Макс: ${s.max}</div>
        </div>
        <div class="right">
          <div class="price">от ${Number(s.rate_client_1000).toFixed(2)}${sign} / 1000</div>
          <button class="btn" data-id="${s.service}">Купить</button>
        </div>`;
      row.querySelector('button').addEventListener('click', ()=> openOrderModal(s));
      servicesListEl.appendChild(row);
    });
  }

  // Оформление заказа
  function openOrderModal(svc){
    currentService = svc;
    orderTitle.textContent = `Заказ: ${svc.name}`;
    inputLink.value = '';
    inputQty.value = Math.max( svc.min, 100 );
    inputQty.min = svc.min; inputQty.max = svc.max;
    qtyHint.textContent = `(мин ${svc.min} • макс ${svc.max})`;
    updatePrice();
    modal.setAttribute('aria-hidden','false');
  }
  function closeOrderModal(){ modal.setAttribute('aria-hidden','true'); currentService = null; }
  function updatePrice(){
    if(!currentService) return;
    const q = parseInt(inputQty.value||'0',10);
    const price = Math.max(0, Number(currentService.rate_client_1000)*q/1000);
    const sign = curSign(currentCurrency);
    priceInfo.textContent = `Цена: ${price.toFixed(2)}${sign}`;
  }
  inputQty.addEventListener('input', updatePrice);
  btnCancelOrder.addEventListener('click', closeOrderModal);

  btnCreateOrder.addEventListener('click', async ()=>{
    if(!currentService) return;
    const link = (inputLink.value||'').trim();
    const q = parseInt(inputQty.value||'0',10);
    if(!link){ alert('Укажите ссылку'); return; }
    if(q < currentService.min || q > currentService.max){ alert(`Количество должно быть от ${currentService.min} до ${currentService.max}`); return; }

    btnCreateOrder.disabled = true; btnCreateOrder.textContent = 'Оформляем...';
    try{
      const r = await fetch(`${API_BASE}/order/create`, {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ user_id: userId || seq, service: currentService.service, link, quantity: q }),
      });
      if(!r.ok) throw new Error(await r.text());
      const j = await r.json();
      closeOrderModal();
      alert(`Заказ создан!\nНомер: ${j.order_id}\nСумма: ${j.cost} ${j.currency}`);
      await fetchProfile();
    }catch(e){
      alert('Не удалось создать заказ: ' + (e?.message||e));
    }finally{
      btnCreateOrder.disabled = false; btnCreateOrder.textContent = 'Оплатить';
    }
  });

  // init tabs
  function initTabs(){
    const tabs = document.querySelectorAll('.tabbar .tab');
    tabs.forEach(b=> b.addEventListener('click', ()=>{ showPage(b.dataset.tab); }));
  }
  initTabs();
})();
