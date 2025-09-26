/* Mini-App: категории → список услуг → заказ за внутренний баланс (RUB/USDT-aware) */
(function () {
  const tg = window.Telegram?.WebApp;
  try { tg?.expand?.(); tg?.ready?.(); tg?.MainButton?.hide?.(); tg?.BackButton?.hide?.(); tg?.disableVerticalSwipes?.(); } catch (_) {}

  const API_BASE = "/api/v1";

  // ==== DOM ====
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
  const servicesListEl = document.getElementById('servicesList');
  const servicesTitle  = document.getElementById('servicesTitle');

  const modal = document.getElementById('orderModal');
  const orderTitle = document.getElementById('orderTitle');
  const inputLink  = document.getElementById('inputLink');
  const inputQty   = document.getElementById('inputQty');
  const qtyHint    = document.getElementById('qtyHint');
  const priceInfo  = document.getElementById('priceInfo');
  const btnCancelOrder = document.getElementById('btnCancelOrder');
  const btnCreateOrder = document.getElementById('btnCreateOrder');

  // ==== Layout tweaks (опускаем хедер, поднимаем таббар) + оверлей ====
  (function injectLayoutTweaks(){
    const css = `
      .tabbar { position: fixed; left: 0; right: 0; bottom: 10px !important; }
      header, .header, .app-header { margin-top: 6px !important; }

      #topupOverlay {
        position: fixed; inset: 0; z-index: 99999; background: rgba(10,12,16,0.92);
        display: none; align-items: center; justify-content: center; padding: 24px;
        backdrop-filter: blur(4px);
      }
      #topupOverlay[aria-hidden="false"]{ display: flex; }
      .topup-card {
        width: 100%; max-width: 440px; background: #14171f; border-radius: 20px;
        box-shadow: 0 10px 30px rgba(0,0,0,0.5); padding: 28px; text-align: center;
        color: #e6e8ee; border: 1px solid rgba(255,255,255,0.06);
      }
      .topup-icon {
        width: 88px; height: 88px; margin: 0 auto 16px auto; border-radius: 50%;
        background: radialGradient(#2ed47a,#1a9f55,#117a3f);
        background: radial-gradient(110px 110px at 30% 30%, #2ed47a 0%, #1a9f55 60%, #117a3f 100%);
        display: grid; place-items: center; box-shadow: 0 10px 30px rgba(46,212,122,0.35), inset 0 0 18px rgba(255,255,255,0.15);
      }
      .topup-icon svg { width: 44px; height: 44px; color: #fff; }
      .topup-title { font: 600 20px/1.3 Inter, system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif; margin: 6px 0 8px; }
      .topup-sub { font: 400 14px/1.5 Inter, system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif; color: #a8afbd; margin-bottom: 18px; }
      .topup-amount { font: 600 16px/1.4 Inter, system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif; color: #e6e8ee; margin-bottom: 16px; }
      .topup-ok {
        width: 100%; padding: 12px 16px; border-radius: 14px; border: 0; cursor: pointer;
        background: linear-gradient(180deg, #2b81f7 0%, #1f6cdc 100%); color: #fff;
        font: 600 15px/1 Inter, system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif;
        box-shadow: 0 8px 20px rgba(43,129,247,0.35);
      }
      .topup-ok:active { transform: translateY(1px); }
    `;
    const style = document.createElement('style');
    style.id = 'layoutTweaks';
    style.textContent = css;
    document.head.appendChild(style);
  })();

  let overlay, overlayAmount;
  (function ensureOverlay(){
    overlay = document.getElementById('topupOverlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'topupOverlay';
      overlay.setAttribute('aria-hidden', 'true');
      overlay.innerHTML = `
        <div class="topup-card" role="dialog" aria-modal="true" aria-labelledby="topupTitle">
          <div class="topup-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none">
              <path d="M9.00001 16.2L4.80001 12L3.40001 13.4L9.00001 19L21 7.00001L19.6 5.60001L9.00001 16.2Z" fill="currentColor"/>
            </svg>
          </div>
          <div id="topupTitle" class="topup-title">Оплата прошла успешно</div>
          <div class="topup-sub">Баланс пополнен. Средства уже доступны для оформления заказов.</div>
          <div class="topup-amount" id="topupAmount"></div>
          <button type="button" class="topup-ok" id="topupOkBtn">Окей</button>
        </div>`;
      document.body.appendChild(overlay);
    }
    overlayAmount = document.getElementById('topupAmount');
    const okBtn = document.getElementById('topupOkBtn');
    okBtn?.addEventListener('click', hideTopupOverlay);
    overlay.addEventListener('click', (e)=>{ if (e.target === overlay) hideTopupOverlay(); });
  })();

  function showTopupOverlay(amount, currency){
    try { tg?.HapticFeedback?.notificationOccurred?.('success'); } catch(_) {}
    try { if (navigator.vibrate) navigator.vibrate([30, 20, 30]); } catch(_) {}
    const val = (typeof amount === 'number' ? amount : parseFloat(amount||'0')) || 0;
    overlayAmount.textContent = `+${val.toFixed(2)} ${currency || ''}`.trim();
    overlay.setAttribute('aria-hidden','false');
  }
  function hideTopupOverlay(){ overlay.setAttribute('aria-hidden','true'); }

  // ==== Tabs (если есть) ====
  const tabs = document.querySelectorAll('.tabbar .tab');
  tabs.forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab;
      tabs.forEach(b => b.classList.toggle('active', b === btn));
      Object.entries(pages).forEach(([k, el]) => el.classList.toggle('active', k === tab));
    });
  });

  // ==== Идентификация ====
  let userId = null;
  try { userId = tg?.initDataUnsafe?.user?.id || null; } catch (_) {}

  function getQueryNick() {
    try { const qs = new URLSearchParams(window.location.search); const n = qs.get('n'); return n ? decodeURIComponent(n) : null; }
    catch (_) { return null; }
  }
  const urlNick = getQueryNick();
  if (nicknameEl) nicknameEl.textContent = urlNick || 'Гость';

  try { const photo = tg?.initDataUnsafe?.user?.photo_url; if (photo && avatarEl) avatarEl.src = photo; } catch (_) {}
  if (avatarEl && !avatarEl.src) {
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

  function curSign(c){ return c === 'RUB' ? ' ₽' : (c === 'USD' ? ' $' : ` ${c}`); }
  function stableHashId(x){let h=0,s=String(x||'');for(let i=0;i<s.length;i++){h=((h<<5)-h+s.charCodeAt(i))|0;}h=Math.abs(h);return (h%100000)+1;}
  let seq = parseInt(localStorage.getItem('smm_user_seq')||'0',10) || stableHashId(userId||urlNick||'guest');
  if (userSeqEl) userSeqEl.textContent = seq;

  // ==== Профиль / баланс ====
  let currentCurrency = 'RUB';
  let lastBalance = 0;            // последний известный баланс
  let lastPopupTs = 0;            // анти-спам для оверлея
  let topupTimer = null;          // сторожок после открытия инвойса
  let topupTries = 0;

  function setBalanceView(value, currency){
    currentCurrency = (currency || 'RUB').toUpperCase();
    const num = Number(value||0);
    balanceEl && (balanceEl.textContent = `${num.toFixed(2)}${curSign(currentCurrency)}`);
    const prev = lastBalance;
    lastBalance = num;
    return { grew: num > prev + 1e-6, delta: Math.max(0, num - prev) };
  }

  async function fetchProfile(){
    try{
      const params = new URLSearchParams({ user_id: String(userId || seq) });
      if (urlNick) params.set('nick', urlNick);
      const r = await fetch(`${API_BASE}/user?${params.toString()}`);
      if(!r.ok) throw 0;
      const p = await r.json(); // {nick, balance, currency, seq}
      if (p.nick && nicknameEl) nicknameEl.textContent = p.nick;
      if (p.seq){ seq = p.seq; userSeqEl && (userSeqEl.textContent = p.seq); localStorage.setItem('smm_user_seq', String(p.seq)); }
      const cmp = setBalanceView(p.balance || 0, p.currency || 'RUB');
      return { profile: p, ...cmp };
    }catch(_){
      const cmp = setBalanceView(0, 'RUB');
      return { profile: null, ...cmp };
    }
  }
  // первичная загрузка
  fetchProfile();

  function maybePopup(delta, currency){
    const now = Date.now();
    if (delta > 0.009 && now - lastPopupTs > 1200) {
      lastPopupTs = now;
      showTopupOverlay(delta, currency || currentCurrency);
    }
  }

  // Возврат в мини-аппу: и focus, и visibilitychange (надёжнее в Telegram)
  window.addEventListener('focus', async () => {
    const { delta, profile } = await fetchProfile();
    maybePopup(delta, profile?.currency);
  });
  document.addEventListener('visibilitychange', async () => {
    if (!document.hidden) {
      const { delta, profile } = await fetchProfile();
      maybePopup(delta, profile?.currency);
    }
  });

  // Сторожок после открытия инвойса
  function startTopupWatcher(){
    if (topupTimer) { clearTimeout(topupTimer); topupTimer = null; }
    topupTries = 0;
    const tick = async () => {
      topupTries += 1;
      const before = lastBalance;
      const { profile } = await fetchProfile();
      const delta = Math.max(0, lastBalance - before);
      if (delta > 0.009) {
        maybePopup(delta, profile?.currency);
        return;
      }
      if (topupTries < 24) { // ~2 минуты по 5 сек
        topupTimer = setTimeout(tick, 5000);
      }
    };
    topupTimer = setTimeout(tick, 5000);
  }

  // Пополнение — min 0.10 USDT
  btnTopup?.addEventListener('click', async () => {
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
      startTopupWatcher();
    } catch(e){ alert('Ошибка создания счёта: ' + (e?.message||e)); }
  });

  // ==== Навигация категорий/услуг (без изменений в логике) ====
  function showPage(name){
    Object.entries(pages).forEach(([k,el])=> el?.classList.toggle('active', k===name));
    document.querySelectorAll('.tabbar .tab').forEach(b=> b.classList.toggle('active', b.dataset.tab===name));
  }

  async function loadCategories(){
    const list = document.getElementById('catsList');
    if (!list) return;
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
    function renderCategories(items){
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
  }
  loadCategories();

  async function openServices(network, title){
    if (servicesTitle) servicesTitle.textContent = title;
    showPage('services');
    renderServicesSkeleton(4);
    try{
      const r = await fetch(`${API_BASE}/services/${network}`);
      if(!r.ok) throw 0;
      const items = await r.json();
      renderServices(items);
    }catch(_){
      servicesListEl && (servicesListEl.innerHTML = '<div class="empty">Не удалось загрузить услуги</div>');
    }
  }

  function renderServicesSkeleton(rows=4){
    if (!servicesListEl) return;
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
        </div>`);
    }
  }

  function renderServices(items){
    if (!servicesListEl) return;
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

  function openOrderModal(svc){
    if (!modal) return;
    if (orderTitle) orderTitle.textContent = `Заказ: ${svc.name}`;
    if (inputLink) inputLink.value = '';
    if (inputQty) { inputQty.value = Math.max( svc.min, 100 ); inputQty.min = svc.min; inputQty.max = svc.max; }
    if (qtyHint) qtyHint.textContent = `(мин ${svc.min} • макс ${svc.max})`;
    updatePrice();
    modal.setAttribute('aria-hidden','false');
  }
  function closeOrderModal(){ modal?.setAttribute('aria-hidden','true'); }
  function updatePrice(){
    if(!priceInfo || !inputQty || !currentService) return;
    const q = parseInt(inputQty.value||'0',10);
    const price = Math.max(0, Number(currentService.rate_client_1000)*q/1000);
    priceInfo.textContent = `Цена: ${price.toFixed(2)}${curSign(currentCurrency)}`;
  }
  let currentService = null;
  inputQty?.addEventListener('input', updatePrice);
  btnCancelOrder?.addEventListener('click', closeOrderModal);
  btnCreateOrder?.addEventListener('click', async ()=>{
    if(!currentService) return;
    const link = (inputLink?.value||'').trim();
    const q = parseInt(inputQty?.value||'0',10);
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
})();
