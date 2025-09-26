/* Mini-App bootstrap (главная: категории + внутренний баланс) */
(function () {
  const tg = window.Telegram?.WebApp;

  // Telegram WebApp init
  try {
    tg?.expand?.(); tg?.ready?.(); tg?.MainButton?.hide?.(); tg?.BackButton?.hide?.(); tg?.disableVerticalSwipes?.();
  } catch (_) {}

  // ====== CONFIG ======
  // Адрес нашего FastAPI-прокси:
  const API_BASE = "/api/v1";
  // локально (если файл открыт напрямую):
  // const API_BASE = "http://127.0.0.1:8011/api/v1";

  // Elements
  const nicknameEl = document.getElementById('nickname');
  const avatarEl   = document.getElementById('avatar');
  const userSeqEl  = document.getElementById('userSeq');
  const balanceEl  = document.getElementById('balanceValue');
  const btnTopup   = document.getElementById('btnTopup');

  // --- Nickname & Avatar ---
  let nick = null, userId = null;
  try {
    userId = tg?.initDataUnsafe?.user?.id || null;
    nick = tg?.initDataUnsafe?.user?.username
        || [tg?.initDataUnsafe?.user?.first_name, tg?.initDataUnsafe?.user?.last_name].filter(Boolean).join(' ')
        || null;
    const photo = tg?.initDataUnsafe?.user?.photo_url;
    if (photo) avatarEl.src = photo;
  } catch (_) {}

  if (!nick) nick = localStorage.getItem('smm_nick') || 'Гость';
  nicknameEl.textContent = nick;
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

  // --- User static #n ---
  function parseStartParamSeq() {
    try {
      const sp = tg?.initDataUnsafe?.start_param || '';
      const m = /^n(\d+)$/.exec(sp);
      return m ? parseInt(m[1], 10) : null;
    } catch (_) { return null; }
  }
  function stableHashId(x) { let h=0,s=String(x||''); for(let i=0;i<s.length;i++){h=((h<<5)-h+s.charCodeAt(i))|0;} h=Math.abs(h); return (h%100000)+1; }
  let seq = parseStartParamSeq()
         || parseInt(localStorage.getItem('smm_user_seq') || '0', 10)
         || stableHashId(userId || nick);
  userSeqEl.textContent = seq;
  localStorage.setItem('smm_user_seq', String(seq));

  // --- Profile & internal balance from our API ---
  async function fetchProfile() {
    try {
      const qs = new URLSearchParams({ user_id: String(userId || seq), nick: nick || '' }).toString();
      const r = await fetch(`${API_BASE}/user?${qs}`, { credentials: "omit" });
      if (!r.ok) throw new Error();
      const p = await r.json(); // {balance, currency, seq}
      // используем серверную нумерацию, если пришла
      if (p.seq) {
        userSeqEl.textContent = p.seq;
        localStorage.setItem('smm_user_seq', String(p.seq));
      }
      balanceEl.textContent = Number(p.balance || 0).toFixed(2);
    } catch (_) {
      // fallback: локальный 0.00
      balanceEl.textContent = "0.00";
    }
  }
  fetchProfile();

  // --- Topup via CryptoBot (when configured) ---
  btnTopup.addEventListener('click', async () => {
    try {
      const amountStr = prompt('Сумма пополнения, USD (мин. 1.00):', '1.00');
      if (!amountStr) return;
      const amount = parseFloat(amountStr);
      if (isNaN(amount) || amount < 1.0) {
        alert('Минимальная сумма — 1.00 USD');
        return;
      }
      const r = await fetch(`${API_BASE}/pay/invoice`, {
        method: 'POST',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ user_id: userId || seq, amount_usd: amount }),
      });
      if (r.status === 501) {
        alert('Интеграция CryptoBot ещё не настроена. Позже откроем оплату.');
        return;
      }
      if (!r.ok) throw new Error(await r.text());
      const j = await r.json();
      const url = j.pay_url;
      if (!url) throw new Error('Не получили ссылку на оплату');
      if (tg?.openLink) tg.openLink(url);
      else window.open(url, '_blank');
    } catch (e) {
      alert('Не удалось создать счёт: ' + (e?.message || e));
    }
  });

  // --- Tabs ---
  const tabs = document.querySelectorAll('.tabbar .tab');
  const pages = {
    categories: document.getElementById('page-categories'),
    favs:       document.getElementById('page-favs'),
    details:    document.getElementById('page-details'),
  };
  tabs.forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab;
      tabs.forEach(b => b.classList.toggle('active', b === btn));
      Object.entries(pages).forEach(([k, el]) => el.classList.toggle('active', k === tab));
    });
  });

  // --- Categories (5 big tiles) from our API (/services) ---
  const catsList = document.getElementById('catsList');
  const ICONS = {
    telegram:  `<svg viewBox="0 0 24 24"><path fill="currentColor" d="M21.6 2.1 2.7 9.2c-1.3.5-1.3 2.3 0 2.8l4.8 1.9 1.9 4.8c.5 1.3 2.3 1.3 2.8 0l7.1-18.9c.4-1-0.6-2-1.7-1.6zM9 15.1l-.2 3.1 2.6-2.6 4.8-7.7-7.2 5.3z"/></svg>`,
    instagram: `<svg viewBox="0 0 24 24"><path fill="currentColor" d="M7 2h10a5 5 0 0 1 5 5v10a5 5 0 0 1-5 5H7a5 5 0 0 1-5-5V7a5 5 0 0 1 5-5zm5 4a6 6 0 1 0 0 12 6 6 0 0 0 0-12zm6.5-.8a1.2 1.2 0 1 0 0 2.4 1.2 1.2 0 0 0 0-2.4zM12 8a4 4 0 1 1 0 8 4 4 0 0 1 0-8z"/></svg>`,
    youtube:   `<svg viewBox="0 0 24 24"><path fill="currentColor" d="M23 7.2a3 3 0 0 0-2.1-2.1C18.7 4.5 12 4.5 12 4.5s-6.7 0-8.9.6A3 3 0 0 0 1 7.2 31 31 0 0 0 1 12a31 31 0 0 0 .1 4.8 3 3 0 0 0 2.1 2.1c2.2.6 8.8.6 8.8.6s6.7 0 8.9-.6a3 3 0 0 0 2.1-2.1A31 31 0 0 0 23 12a31 31 0 0 0 0-4.8zM9.8 15V9л5.9 3-5.9 3z"/></svg>`,
    tiktok:    `<svg viewBox="0 0 24 24"><path fill="currentColor" d="M16.5 3c.6 2.2 2.2 3.6 4.5 3.9v3.1c-1.8 0-3.4-.6-4.5-1.6v6.7a6.8 6.8 0 1 1-6.8-6.8c.4 0 .9.1 1.3.2v3.3a3.4 3.4 0 1 0 2.4 3.2V3h3.1z"/></svg>`,
    facebook:  `<svg viewBox="0 0 24 24"><path fill="currentColor" d="M13 22v-8h3l1-4h-4V7c0-1.2.3-2 2-2h2V1h-3c-3 0-5 1.8-5 5v3H6v4h3v8h4z"/></svg>`,
  };

  async function loadCategories() {
    try {
      const r = await fetch(`${API_BASE}/services`, { credentials: "omit" });
      if (!r.ok) throw new Error();
      const items = await r.json();
      renderCategories(items);
    } catch (_) {
      renderCategories([
        {id:'telegram',name:'Telegram',desc:'подписчики, просмотры'},
        {id:'tiktok',name:'TikTok',desc:'просмотры, фолловеры'},
        {id:'instagram',name:'Instagram',desc:'подписчики, лайки'},
        {id:'youtube',name:'YouTube',desc:'просмотры, подписки'},
        {id:'facebook',name:'Facebook',desc:'лайки, подписчики'},
      ]);
    }
  }
  loadCategories();

  function renderCategories(items) {
    const catsList = document.getElementById('catsList');
    catsList.innerHTML = '';
    for (const c of items) {
      const a = document.createElement('a');
      a.href = '#';
      a.className = 'cat';
      a.dataset.cat = c.id;
      a.innerHTML = `
        <div class="cat-icon">${ICONS[c.id] || ''}</div>
        <div class="cat-body">
          <div class="cat-name">${c.name}</div>
          <div class="cat-desc">${c.desc}${c.count ? ` • ${c.count}` : ''}</div>
        </div>
      `;
      a.addEventListener('click', (e) => {
        e.preventDefault();
        openCategory(c.id, c.name);
      });
      catsList.appendChild(a);
    }
  }

  function openCategory(id, name) {
    try {
      tg?.showPopup?.({ title:'Категория', message:`Откроем услуги для: ${name}`, buttons:[{type:'ok'}] });
    } catch(_) { alert(`Категория: ${name}`); }
  }
})();
