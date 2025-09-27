/* Mini-App: обновлённый хедер, табы, кастомная модалка пополнения, success-оверлей */
(function () {
  const tg = window.Telegram?.WebApp;
  try { tg?.expand?.(); tg?.ready?.(); tg?.MainButton?.hide?.(); tg?.BackButton?.hide?.(); tg?.disableVerticalSwipes?.(); } catch (_) {}

  const API_BASE = "/api/v1";

  // === DOM
  const leftProfileArea = document.querySelector('.hdr-left');         // кликабельная зона профиля
  const avatarEl        = document.getElementById('avatar');
  const nicknameEl      = document.getElementById('nickname');
  const userSeqEl       = document.getElementById('userSeq');
  const balanceValueEl  = document.getElementById('balanceValue');
  const btnPlus         = document.getElementById('btnTopup');         // кнопка «+»

  // табы/страницы
  const tabs = document.querySelectorAll('.tabbar .tab');
  const pages = {
    categories: document.getElementById('page-categories'),
    favs:       document.getElementById('page-favs'),
    details:    document.getElementById('page-details'),
    services:   document.getElementById('page-services'),
  };

  // список/заголовок услуг
  const servicesListEl = document.getElementById('servicesList');
  const servicesTitle  = document.getElementById('servicesTitle');
  const btnBackToCats  = document.getElementById('btnBackToCats');

  // модалка пополнения
  const payModal          = document.getElementById('payModal');
  const payAmountInput    = document.getElementById('payAmount');
  const payCancelBtn      = document.getElementById('payCancel');
  const payCreateBtn      = document.getElementById('payCreate');

  // success overlay
  const topupOverlay  = document.getElementById('topupOverlay');
  const topupAmountEl = document.getElementById('topupAmount');
  const topupOk       = document.getElementById('topupOkBtn');

  // === Helper
  function curSign(c){ return c === 'RUB' ? ' ₽' : (c === 'USD' ? ' $' : ` ${c}`); }
  function showPage(name){
    Object.entries(pages).forEach(([k,el])=> el?.classList.toggle('active', k===name));
    tabs.forEach(t => t.classList.toggle('active', t.dataset.tab === name));
    window.scrollTo({top:0, behavior:'instant'});
  }
  function showTopupOverlay(amount, currency){
    try { tg?.HapticFeedback?.notificationOccurred?.('success'); } catch(_) {}
    try { navigator.vibrate?.([30,20,30]); } catch(_) {}
    if (topupAmountEl) topupAmountEl.textContent = `+${Number(amount||0).toFixed(2)} ${currency||''}`.trim();
    topupOverlay?.setAttribute('aria-hidden','false');
  }

  // === User init
  let userId = null;
  try { userId = tg?.initDataUnsafe?.user?.id || null; } catch (_) {}
  const urlNick = (()=>{ try{ const n=new URLSearchParams(location.search).get('n'); return n?decodeURIComponent(n):null }catch(_){return null} })();

  if (urlNick && nicknameEl) nicknameEl.textContent = urlNick;
  try { const photo = tg?.initDataUnsafe?.user?.photo_url; if (photo && avatarEl) avatarEl.src = photo; } catch (_) {}

  function stableHashId(x){let h=0,s=String(x||'');for(let i=0;i<s.length;i++){h=((h<<5)-h+s.charCodeAt(i))|0;}h=Math.abs(h);return (h%100000)+1;}
  let seq = parseInt(localStorage.getItem('smm_user_seq')||'0',10) || stableHashId(userId||urlNick||'guest');
  if (userSeqEl) userSeqEl.textContent = `#${seq}`;

  let currentCurrency = 'RUB';
  let lastBalance = 0;

  async function fetchProfile(consumeTopup = true){
    try{
      const qs = new URLSearchParams({ user_id: String(userId || seq) });
      if (urlNick) qs.set('nick', urlNick);
      if (consumeTopup) qs.set('consume_topup','1');
      const r = await fetch(`${API_BASE}/user?${qs.toString()}`);
      if(!r.ok) throw 0;
      const p = await r.json();

      if (p.nick && nicknameEl) nicknameEl.textContent = p.nick;
      if (p.seq){ seq = p.seq; userSeqEl && (userSeqEl.textContent = `#${p.seq}`); localStorage.setItem('smm_user_seq', String(p.seq)); }

      currentCurrency = (p.currency || 'RUB').toUpperCase();
      lastBalance = Number(p.balance || 0);
      balanceValueEl && (balanceValueEl.textContent = `${lastBalance.toFixed(2)}${curSign(currentCurrency)}`);

      if (p.topup_delta && Number(p.topup_delta) > 0) {
        showTopupOverlay(Number(p.topup_delta), (p.topup_currency || currentCurrency));
      }
    }catch(_){
      currentCurrency = 'RUB'; lastBalance = 0;
      balanceValueEl && (balanceValueEl.textContent = '0.00' + curSign('RUB'));
    }
  }

  // первичная загрузка и refresh при возврате
  fetchProfile();
  window.addEventListener('focus', ()=> fetchProfile(true));
  document.addEventListener('visibilitychange', ()=>{ if(!document.hidden) fetchProfile(true); });

  // === Категории / услуги
  const ICONS = {
    telegram:'<img src="static/img/telegram.svg" alt="">',
    tiktok:'<img src="static/img/tiktok.svg" alt="">',
    instagram:'<img src="static/img/instagram.svg" alt="">',
    youtube:'<img src="static/img/youtube.svg" alt="">',
    facebook:'<img src="static/img/facebook.svg" alt="">',
  };

  async function loadCategories(){
    const list = document.getElementById('catsList');
    if (!list) return;
    try{
      const r = await fetch(`${API_BASE}/services`);
      const items = await r.json();
      render(items);
    }catch(_){
      render([
        {id:'telegram',name:'Telegram',desc:'подписчики, просмотры', count:318},
        {id:'tiktok',name:'TikTok',desc:'просмотры, фолловеры', count:38},
        {id:'instagram',name:'Instagram',desc:'подписчики, лайки', count:19},
        {id:'youtube',name:'YouTube',desc:'просмотры, подписки', count:56},
        {id:'facebook',name:'Facebook',desc:'лайки, подписчики', count:18},
      ]);
    }
    function render(items){
      list.innerHTML='';
      items.forEach(c=>{
        const a=document.createElement('a');
        a.href='#'; a.className='cat'; a.dataset.cat=c.id;
        a.innerHTML = `
          <div class="cat-icon">${ICONS[c.id]||''}</div>
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

  async function openServices(network, title){
    servicesTitle && (servicesTitle.textContent = title);
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

  // === Заказ (заглушка, как раньше)
  const orderModal  = document.getElementById('orderModal');
  const orderTitle  = document.getElementById('orderTitle');
  const inputLink   = document.getElementById('inputLink');
  const inputQty    = document.getElementById('inputQty');
  const qtyHint     = document.getElementById('qtyHint');
  const priceInfo   = document.getElementById('priceInfo');
  const btnCancelOrder = document.getElementById('btnCancelOrder');
  const btnCreateOrder = document.getElementById('btnCreateOrder');
  let currentService = null;

  function openOrderModal(svc){
    if (!orderModal) return;
    currentService = svc;
    orderTitle && (orderTitle.textContent = `Заказ: ${svc.name}`);
    inputLink && (inputLink.value = '');
    if (inputQty){ inputQty.value = Math.max(svc.min, 100); inputQty.min = svc.min; inputQty.max = svc.max; }
    qtyHint && (qtyHint.textContent = `(мин ${svc.min} • макс ${svc.max})`);
    updateOrderPrice();
    orderModal.setAttribute('aria-hidden','false');
  }
  function closeOrderModal(){ orderModal?.setAttribute('aria-hidden','true'); currentService = null; }
  function updateOrderPrice(){
    if(!priceInfo || !inputQty || !currentService) return;
    const q = parseInt(inputQty.value||'0',10);
    const price = Math.max(0, Number(currentService.rate_client_1000)*q/1000);
    priceInfo.textContent = `Цена: ${price.toFixed(2)}${curSign(currentCurrency)}`;
  }
  inputQty?.addEventListener('input', updateOrderPrice);
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

  // === Навигация (табы) — фикс
  tabs.forEach(btn=>{
    btn.addEventListener('click', ()=>{
      const tab = btn.dataset.tab;
      showPage(tab);
    });
  });
  btnBackToCats?.addEventListener('click', ()=> showPage('categories'));

  // === Профиль (клик по левой части хедера)
  leftProfileArea?.addEventListener('click', ()=>{
    // здесь позже откроем страницу профиля
    alert('Профиль скоро добавим 😉');
  });

  // === Пополнение — кастомная модалка
  function openPayModal(){
    payAmountInput && (payAmountInput.value = '1.00');
    payModal?.setAttribute('aria-hidden','false');
  }
  function closePayModal(){ payModal?.setAttribute('aria-hidden','true'); }
  btnPlus?.addEventListener('click', openPayModal);
  payCancelBtn?.addEventListener('click', closePayModal);
  payCreateBtn?.addEventListener('click', async ()=>{
    const amount = parseFloat(payAmountInput?.value||'0');
    if (isNaN(amount) || amount < 0.10){ alert('Минимальная сумма — 0.10 USDT'); return; }
    try{
      const r = await fetch(`${API_BASE}/pay/invoice`, {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ user_id: userId || seq, amount_usd: amount }),
      });
      if (r.status === 501) { alert('Оплата через CryptoBot ещё не настроена.'); return; }
      if (!r.ok) throw new Error(await r.text());
      const j = await r.json();
      closePayModal();
      (tg?.openLink ? tg.openLink(j.pay_url) : window.open(j.pay_url,'_blank'));
    }catch(e){
      alert('Ошибка создания счёта: ' + (e?.message||e));
    }
  });

  // === Success overlay
  topupOk?.addEventListener('click', ()=> topupOverlay?.setAttribute('aria-hidden','true'));
  topupOverlay?.addEventListener('click', (e)=>{ if(e.target===topupOverlay) topupOverlay.setAttribute('aria-hidden','true'); });

})();
