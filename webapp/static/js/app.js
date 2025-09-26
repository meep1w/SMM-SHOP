/* Mini-App UI + топап поп-ап (надёжный, сервер даёт topup_delta) */
(function () {
  const tg = window.Telegram?.WebApp;
  try { tg?.expand?.(); tg?.ready?.(); tg?.MainButton?.hide?.(); tg?.BackButton?.hide?.(); tg?.disableVerticalSwipes?.(); } catch (_) {}

  const API_BASE = "/api/v1";

  // DOM refs
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

  // layout tweaks + overlay
  (function injectLayoutTweaks(){
    const css = `
      .tabbar { position: fixed; left: 0; right: 0; bottom: 10px !important; }
      header, .header, .app-header { margin-top: 6px !important; }

      #topupOverlay { position: fixed; inset: 0; z-index: 99999; background: rgba(10,12,16,0.92);
        display: none; align-items: center; justify-content: center; padding: 24px; backdrop-filter: blur(4px); }
      #topupOverlay[aria-hidden="false"]{ display: flex; }
      .topup-card{ width:100%; max-width:440px; background:#14171f; border-radius:20px; box-shadow:0 10px 30px rgba(0,0,0,.5);
        padding:28px; text-align:center; color:#e6e8ee; border:1px solid rgba(255,255,255,.06); }
      .topup-icon{ width:88px; height:88px; margin:0 auto 16px; border-radius:50%;
        background: radial-gradient(110px 110px at 30% 30%, #2ed47a 0%, #1a9f55 60%, #117a3f 100%);
        display:grid; place-items:center; box-shadow:0 10px 30px rgba(46,212,122,.35), inset 0 0 18px rgba(255,255,255,.15);}
      .topup-icon svg{ width:44px; height:44px; color:#fff; }
      .topup-title{ font:600 20px/1.3 Inter,system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif; margin:6px 0 8px; }
      .topup-sub{ font:400 14px/1.5 Inter,system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif; color:#a8afbd; margin-bottom:18px; }
      .topup-amount{ font:600 16px/1.4 Inter,system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif; color:#e6e8ee; margin-bottom:16px; }
      .topup-ok{ width:100%; padding:12px 16px; border-radius:14px; border:0; cursor:pointer;
        background:linear-gradient(180deg,#2b81f7 0%,#1f6cdc 100%); color:#fff; font:600 15px/1 Inter,system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;
        box-shadow:0 8px 20px rgba(43,129,247,.35); }
      .topup-ok:active{ transform: translateY(1px); }
    `;
    const s = document.createElement('style'); s.textContent = css; document.head.appendChild(s);
  })();
  let overlay = document.getElementById('topupOverlay');
  if (!overlay){
    overlay = document.createElement('div');
    overlay.id = 'topupOverlay';
    overlay.setAttribute('aria-hidden','true');
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
  const overlayAmount = document.getElementById('topupAmount');
  document.getElementById('topupOkBtn')?.addEventListener('click', ()=> overlay.setAttribute('aria-hidden','true'));
  overlay.addEventListener('click', (e)=>{ if (e.target === overlay) overlay.setAttribute('aria-hidden','true'); });

  function showTopupOverlay(delta, currency){
    try { tg?.HapticFeedback?.notificationOccurred?.('success'); } catch(_) {}
    try { navigator.vibrate?.([30,20,30]); } catch(_) {}
    overlayAmount.textContent = `+${Number(delta||0).toFixed(2)} ${currency||''}`.trim();
    overlay.setAttribute('aria-hidden','false');
  }

  // helpers / identity
  function curSign(c){ return c==='RUB'?' ₽':(c==='USD'?' $':` ${c}`); }
  let userId = null; try { userId = tg?.initDataUnsafe?.user?.id || null; } catch(_) {}
  function urlNick(){ try{const p=new URLSearchParams(location.search);const v=p.get('n');return v?decodeURIComponent(v):null;}catch(_){return null;} }
  const nickFromUrl = urlNick();
  if (nicknameEl) nicknameEl.textContent = nickFromUrl || 'Гость';
  try { const photo=tg?.initDataUnsafe?.user?.photo_url; if(photo&&avatarEl) avatarEl.src=photo; } catch(_){}
  if (avatarEl && !avatarEl.src) avatarEl.src='data:image/svg+xml;utf8,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 80"><rect fill="#1b1e24" width="80" height="80" rx="40"/><circle cx="40" cy="33" r="15" fill="#2a2f36"/><path d="M15 66c5-12 18-18 25-18s20 6 25 18" fill="#2a2f36"/></svg>');

  function stableHashId(x){let h=0,s=String(x||'');for(let i=0;i<s.length;i++){h=((h<<5)-h+s.charCodeAt(i))|0;}h=Math.abs(h);return (h%100000)+1;}
  let seq = parseInt(localStorage.getItem('smm_user_seq')||'0',10) || stableHashId(userId||nickFromUrl||'guest');
  userSeqEl && (userSeqEl.textContent = seq);

  // balance state
  let currentCurrency = 'RUB';
  let lastBalance = 0;

  // fetch profile: ТЕПЕРЬ читаем topup_delta от сервера!
  async function fetchProfile() {
    try {
      const qp = new URLSearchParams({ user_id: String(userId || seq), consume_topup: '1' });
      if (nickFromUrl) qp.set('nick', nickFromUrl);
      const r = await fetch(`${API_BASE}/user?${qp.toString()}`);
      if (!r.ok) throw 0;
      const p = await r.json();
      if (p.nick && nicknameEl) nicknameEl.textContent = p.nick;
      if (p.seq){ seq = p.seq; userSeqEl && (userSeqEl.textContent = p.seq); localStorage.setItem('smm_user_seq', String(p.seq)); }

      currentCurrency = (p.currency || 'RUB').toUpperCase();
      lastBalance = Number(p.balance || 0);
      balanceEl && (balanceEl.textContent = `${lastBalance.toFixed(2)}${curSign(currentCurrency)}`);

      // если сервер сообщил «непрочитанное» пополнение — показываем поп-ап
      if (p.topup_delta && Number(p.topup_delta) > 0) {
        showTopupOverlay(Number(p.topup_delta), (p.topup_currency || currentCurrency));
      }

      return p;
    } catch(_) {
      currentCurrency = 'RUB'; lastBalance = 0;
      balanceEl && (balanceEl.textContent = '0.00' + curSign('RUB'));
      return null;
    }
  }

  // первичный профиль
  fetchProfile();

  // подхватываем изменения при возвращении
  window.addEventListener('focus', async ()=> { await fetchProfile(); });
  document.addEventListener('visibilitychange', async ()=> { if(!document.hidden) await fetchProfile(); });

  // пополнение
  btnTopup?.addEventListener('click', async ()=>{
    try{
      const s = prompt('Сумма пополнения, USDT (мин. 0.10):', '1.00');
      if(!s) return;
      const amount = parseFloat(s);
      if (isNaN(amount) || amount < 0.10) { alert('Минимальная сумма — 0.10 USDT'); return; }
      const r = await fetch(`${API_BASE}/pay/invoice`, {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ user_id: userId || seq, amount_usd: amount }),
      });
      if (r.status === 501) { alert('Оплата через CryptoBot ещё не настроена.'); return; }
      if (!r.ok) throw new Error(await r.text());
      const j = await r.json();
      (tg?.openLink ? tg.openLink(j.pay_url) : window.open(j.pay_url, '_blank'));
      // дальше сервер отметит платеж → при следующем fetchProfile мы покажем поп-ап
    }catch(e){ alert('Ошибка создания счёта: ' + (e?.message||e)); }
  });

  // --- остальная логика каталога (без изменений по сути) ---
  function curSignTxt(){ return curSign(currentCurrency); }
  function showPage(name){
    Object.entries(pages).forEach(([k,el])=> el?.classList.toggle('active', k===name));
    document.querySelectorAll('.tabbar .tab').forEach(b=> b.classList.toggle('active', b.dataset.tab===name));
  }
  async function openServices(network, title){
    if (servicesTitle) servicesTitle.textContent = title;
    showPage('services'); renderServicesSkeleton();
    try { const r = await fetch(`${API_BASE}/services/${network}`); const items = await r.json(); renderServices(items); }
    catch { servicesListEl && (servicesListEl.innerHTML = '<div class="empty">Не удалось загрузить услуги</div>'); }
  }
  function renderServicesSkeleton(n=4){
    if (!servicesListEl) return;
    servicesListEl.innerHTML='';
    for(let i=0;i<n;i++){
      servicesListEl.insertAdjacentHTML('beforeend', `
        <div class="skeleton"><div class="skel-row">
          <div class="skel-avatar"></div><div class="skel-lines"><div class="skel-line"></div><div class="skel-line short"></div></div>
        </div></div>`);
    }
  }
  function renderServices(items){
    if (!servicesListEl) return; servicesListEl.innerHTML='';
    items.forEach(s=>{
      const row=document.createElement('div'); row.className='service';
      row.innerHTML=`<div class="left"><div class="name">${s.name}</div><div class="meta">Тип: ${s.type} • Мин: ${s.min} • Макс: ${s.max}</div></div>
      <div class="right"><div class="price">от ${Number(s.rate_client_1000).toFixed(2)}${curSign(s.currency||currentCurrency)} / 1000</div>
      <button class="btn" data-id="${s.service}">Купить</button></div>`;
      row.querySelector('button').addEventListener('click', ()=> openOrderModal(s));
      servicesListEl.appendChild(row);
    });
  }
  function openOrderModal(svc){
    if (!modal) return;
    orderTitle && (orderTitle.textContent = `Заказ: ${svc.name}`);
    inputLink && (inputLink.value=''); inputQty && (inputQty.value = Math.max(svc.min, 100));
    if (inputQty) { inputQty.min = svc.min; inputQty.max = svc.max; }
    qtyHint && (qtyHint.textContent = `(мин ${svc.min} • макс ${svc.max})`);
    currentService = svc; updatePrice(); modal.setAttribute('aria-hidden','false');
  }
  function closeOrderModal(){ modal?.setAttribute('aria-hidden','true'); currentService=null; }
  function updatePrice(){
    if(!priceInfo || !inputQty || !currentService) return;
    const q = parseInt(inputQty.value||'0',10);
    const price = Math.max(0, Number(currentService.rate_client_1000)*q/1000);
    priceInfo.textContent = `Цена: ${price.toFixed(2)}${curSignTxt()}`;
  }
  let currentService=null;
  inputQty?.addEventListener('input', updatePrice);
  btnCancelOrder?.addEventListener('click', closeOrderModal);
  btnCreateOrder?.addEventListener('click', async ()=>{
    if(!currentService) return;
    const link=(inputLink?.value||'').trim();
    const q=parseInt(inputQty?.value||'0',10);
    if(!link){ alert('Укажите ссылку'); return; }
    if(q<currentService.min||q>currentService.max){ alert(`Количество должно быть от ${currentService.min} до ${currentService.max}`); return; }
    btnCreateOrder.disabled=true; btnCreateOrder.textContent='Оформляем...';
    try{
      const r=await fetch(`${API_BASE}/order/create`,{method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({ user_id:userId||seq, service:currentService.service, link, quantity:q })});
      if(!r.ok) throw new Error(await r.text());
      const j=await r.json(); closeOrderModal(); alert(`Заказ создан!\nНомер: ${j.order_id}\nСумма: ${j.cost} ${j.currency}`);
      await fetchProfile();
    }catch(e){ alert('Не удалось создать заказ: ' + (e?.message||e)); }
    finally{ btnCreateOrder.disabled=false; btnCreateOrder.textContent='Оплатить'; }
  });

  // категории
  async function loadCategories(){
    const list=document.getElementById('catsList'); if(!list) return;
    try{ const r=await fetch(`${API_BASE}/services`); render(await r.json()); }
    catch{ render([
      {id:'telegram',name:'Telegram',desc:'подписчики, просмотры'},
      {id:'tiktok',name:'TikTok',desc:'просмотры, фолловеры'},
      {id:'instagram',name:'Instagram',desc:'подписчики, лайки'},
      {id:'youtube',name:'YouTube',desc:'просмотры, подписки'},
      {id:'facebook',name:'Facebook',desc:'лайки, подписчики'},
    ]); }
    function render(items){
      list.innerHTML='';
      items.forEach(c=>{
        const a=document.createElement('a'); a.href='#'; a.className='cat'; a.dataset.cat=c.id;
        a.innerHTML=`<div class="cat-icon"><img src="static/img/${c.id}.svg" alt=""></div>
          <div class="cat-body"><div class="cat-name">${c.name}</div><div class="cat-desc">${c.desc}${c.count?` • ${c.count}`:''}</div></div>`;
        a.addEventListener('click',e=>{e.preventDefault(); openServices(c.id,c.name);}); list.appendChild(a);
      });
    }
  }
  loadCategories();
})();
