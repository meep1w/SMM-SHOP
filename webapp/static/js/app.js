/* Mini-App UI + надёжный поп-ап пополнения (server-driven) + обновлённый header/nav + подпись под категориями */
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

  // ==== Обновление визуала: скруглённый header и новый таббар + подпись под категориями ====
  (function injectPolish(){
    const css = `
      /* общий фон */
      body { background: #0f1319; }

      /* аккуратный скруглённый header-контейнер */
      header, .header, .app-header {
        background: linear-gradient(180deg, #121821 0%, #0f141b 100%);
        border: 1px solid rgba(255,255,255,0.06);
        border-radius: 18px;
        padding: 10px 12px;
        margin: 14px 16px 10px;
        box-shadow: 0 10px 24px rgba(0,0,0,.20), inset 0 0 0 1px rgba(255,255,255,.02);
      }

      /* блок баланса остаётся компактным */
      .balance-wrap, #balanceWrap {
        display: inline-flex; align-items: center; gap: 8px;
        background: rgba(255,255,255,0.04);
        border: 1px solid rgba(255,255,255,0.06);
        border-radius: 14px;
        padding: 6px 8px 6px 10px;
      }
      #balanceValue { font: 700 14px/1 Inter, system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif; color: #e9eef8; }
      #btnTopup {
        display:inline-grid; place-items:center; width:28px; height:28px; border-radius:10px; border:1px solid rgba(255,255,255,.08);
        background: radial-gradient(120% 120% at 100% 0%, #1e2836 0%, #111822 60%);
      }
      #btnTopup svg, #btnTopup i { pointer-events: none; }

      /* таббар: спокойный, скруглённый, с мягкой активной подсветкой */
      .tabbar {
        position: fixed; left: 16px; right: 16px; bottom: 12px;
        height: 62px;
        background: linear-gradient(180deg, #121821 0%, #0f141b 100%);
        border: 1px solid rgba(255,255,255,0.06);
        border-radius: 16px;
        display: grid; grid-template-columns: repeat(3, 1fr);
        gap: 4px; padding: 8px;
        box-shadow: 0 12px 28px rgba(0,0,0,.28), inset 0 0 0 1px rgba(255,255,255,.02);
      }
      .tabbar .tab {
        display: flex; align-items: center; justify-content: center;
        flex-direction: column; gap: 4px;
        color: #aeb6c6; text-decoration: none;
        border-radius: 12px;
        transition: background .15s ease, color .15s ease, transform .1s ease;
        font: 500 12px/1 Inter, system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif;
      }
      .tabbar .tab .icon { width: 18px; height: 18px; opacity: .9; }
      .tabbar .tab.active {
        color: #eef2fa;
        background: radial-gradient(180px 60px at 50% 120%, rgba(64,125,255,.14) 0%, rgba(64,125,255,0) 70%);
      }
      .tabbar .tab:active { transform: translateY(1px); }
      .tabbar .tab .label { margin-top: 1px; }

      /* список категорий — карточки как были; добавим подпись ниже */
      #catsList { padding-bottom: 54px; }
      #catsList::after {
        content: "Скоро добавим ещё категорий";
        display: block;
        text-align: center;
        color: #9aa3b2;
        font: 500 13px/1.4 Inter, system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif;
        opacity: .85;
        padding: 18px 8px 12px;
      }
    `;
    const style = document.createElement('style');
    style.id = 'polishStyles';
    style.textContent = css;
    document.head.appendChild(style);
  })();

  // ==== Overlay для «Оплата прошла успешно» ====
  (function mountTopupOverlay(){
    if (document.getElementById('topupOverlay')) return;
    const overlay = document.createElement('div');
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
    const css = `
      #topupOverlay{position:fixed;inset:0;z-index:99999;background:rgba(10,12,16,.92);display:none;align-items:center;justify-content:center;padding:24px;backdrop-filter:blur(4px);}
      #topupOverlay[aria-hidden="false"]{display:flex;}
      .topup-card{width:100%;max-width:440px;background:#14171f;border-radius:20px;box-shadow:0 10px 30px rgba(0,0,0,.5);padding:28px;text-align:center;color:#e6e8ee;border:1px solid rgba(255,255,255,.06);}
      .topup-icon{width:88px;height:88px;margin:0 auto 16px;border-radius:50%;background:radial-gradient(110px 110px at 30% 30%,#2ed47a 0%,#1a9f55 60%,#117a3f 100%);display:grid;place-items:center;box-shadow:0 10px 30px rgba(46,212,122,.35), inset 0 0 18px rgba(255,255,255,.15);}
      .topup-icon svg{width:44px;height:44px;color:#fff;}
      .topup-title{font:600 20px/1.3 Inter,system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;margin:6px 0 8px;}
      .topup-sub{font:400 14px/1.5 Inter,system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#a8afbd;margin-bottom:18px;}
      .topup-amount{font:600 16px/1.4 Inter,system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#e6e8ee;margin-bottom:16px;}
      .topup-ok{width:100%;padding:12px 16px;border-radius:14px;border:0;cursor:pointer;background:linear-gradient(180deg,#2b81f7 0%,#1f6cdc 100%);color:#fff;font:600 15px/1 Inter,system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;box-shadow:0 8px 20px rgba(43,129,247,.35);}
      .topup-ok:active{transform:translateY(1px);}
    `;
    const s = document.createElement('style'); s.textContent = css; document.head.appendChild(s);
    document.body.appendChild(overlay);
    document.getElementById('topupOkBtn')?.addEventListener('click', ()=> overlay.setAttribute('aria-hidden','true'));
    overlay.addEventListener('click',(e)=>{ if(e.target===overlay) overlay.setAttribute('aria-hidden','true'); });
  })();

  function showTopupOverlay(amount, currency){
    const overlay = document.getElementById('topupOverlay');
    const out = document.getElementById('topupAmount');
    try { tg?.HapticFeedback?.notificationOccurred?.('success'); } catch(_) {}
    try { navigator.vibrate?.([30,20,30]); } catch(_) {}
    out.textContent = `+${Number(amount||0).toFixed(2)} ${currency||''}`.trim();
    overlay.setAttribute('aria-hidden','false');
  }

  // ==== Tabs (если есть) ====
  const tabs = document.querySelectorAll('.tabbar .tab');
  tabs.forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab;
      tabs.forEach(b => b.classList.toggle('active', b === btn));
      Object.entries(pages).forEach(([k, el]) => el?.classList.toggle('active', k === tab));
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
    avatarEl.src = 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 80"><rect fill="#1b1e24" width="80" height="80" rx="40"/><circle cx="40" cy="33" r="15" fill="#2a2f36"/><path d="M15 66c5-12 18-18 25-18s20 6 25 18" fill="#2a2f36"/></svg>');
  }

  function curSign(c){ return c === 'RUB' ? ' ₽' : (c === 'USD' ? ' $' : ` ${c}`); }
  function stableHashId(x){let h=0,s=String(x||'');for(let i=0;i<s.length;i++){h=((h<<5)-h+s.charCodeAt(i))|0;}h=Math.abs(h);return (h%100000)+1;}
  let seq = parseInt(localStorage.getItem('smm_user_seq')||'0',10) || stableHashId(userId||urlNick||'guest');
  if (userSeqEl) userSeqEl.textContent = seq;

  // ==== Баланс/профиль ====
  let currentCurrency = 'RUB';
  let lastBalance = 0;

  async function fetchProfile() {
    try {
      const qp = new URLSearchParams({ user_id: String(userId || seq), consume_topup: '1' });
      if (urlNick) qp.set('nick', urlNick);
      const r = await fetch(`${API_BASE}/user?${qp.toString()}`);
      if (!r.ok) throw 0;
      const p = await r.json();

      if (p.nick && nicknameEl) nicknameEl.textContent = p.nick;
      if (p.seq){ seq = p.seq; userSeqEl && (userSeqEl.textContent = p.seq); localStorage.setItem('smm_user_seq', String(p.seq)); }

      currentCurrency = (p.currency || 'RUB').toUpperCase();
      lastBalance = Number(p.balance || 0);
      balanceEl && (balanceEl.textContent = `${lastBalance.toFixed(2)}${curSign(currentCurrency)}`);

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

  // первичная загрузка
  fetchProfile();

  // возвращаемся в мини-аппу — подтягиваем профиль
  window.addEventListener('focus', async ()=> { await fetchProfile(); });
  document.addEventListener('visibilitychange', async ()=> { if(!document.hidden) await fetchProfile(); });

  // Пополнение (min 0.10 USDT)
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
      // сервер отметит платеж и вернёт topup_delta при следующем fetchProfile()
    } catch(e){ alert('Ошибка создания счёта: ' + (e?.message||e)); }
  });

  // ===== Каталог/услуги (как прежде) =====
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
      render(items);
    }catch(_){
      render([
        {id:'telegram',name:'Telegram',desc:'подписчики, просмотры'},
        {id:'tiktok',name:'TikTok',desc:'просмотры, фолловеры'},
        {id:'instagram',name:'Instagram',desc:'подписчики, лайки'},
        {id:'youtube',name:'YouTube',desc:'просмотры, подписки'},
        {id:'facebook',name:'Facebook',desc:'лайки, подписчики'},
      ]);
    }
    function render(items){
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
      // подпись «скоро ещё»
      // (на случай старых стилей, если ::after не применится)
      if (!document.getElementById('catsNote')) {
        const note = document.createElement('div');
        note.id = 'catsNote';
        note.style.cssText = 'text-align:center;color:#9aa3b2;font:500 13px/1.4 Inter,system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;opacity:.85;padding:18px 8px 12px;';
        note.textContent = 'Скоро добавим ещё категорий';
        list.parentElement?.appendChild(note);
      }
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
    updatePrice(); currentService = svc;
    modal.setAttribute('aria-hidden','false');
  }
  function closeOrderModal(){ modal?.setAttribute('aria-hidden','true'); currentService = null; }
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
