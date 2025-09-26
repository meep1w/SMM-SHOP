# server/main.py
# -*- coding: utf-8 -*-
import os, time, re, json, hmac, hashlib
from typing import List, Dict, Any, Optional
from pathlib import Path

from fastapi import FastAPI, HTTPException, Body, Request
from fastapi.middleware.cors import CORSMiddleware
import httpx

# ── load .env ──────────────────────────────────────────────────────────────────
try:
    from dotenv import load_dotenv
    ROOT_DIR = Path(__file__).resolve().parents[1]
    load_dotenv(ROOT_DIR / ".env")
except Exception:
    ROOT_DIR = Path(__file__).resolve().parents[1]

API_BASE = "https://vexboost.ru/api/v2"
VEX_KEY = os.getenv("VEXBOOST_KEY", "").strip()

ALLOWED_ORIGINS = os.getenv("ALLOWED_ORIGINS", "*")
origins = [o.strip() for o in ALLOWED_ORIGINS.split(",") if o.strip()]

CURRENCY = os.getenv("CURRENCY", "USD").strip() or "USD"
MARKUP_MULTIPLIER = float(os.getenv("MARKUP_MULTIPLIER", "5.0"))

CRYPTOBOT_API_KEY = os.getenv("CRYPTOBOT_API_KEY", "").strip()
CRYPTOBOT_BASE = os.getenv("CRYPTOBOT_BASE", "https://pay.crypt.bot/api").strip().rstrip("/")

# Путь к базе пользователей БОТА (где хранится ник)
# Можно задать явно в .env: BOT_USERS_JSON=/opt/smmshop/bot/storage/users.json
BOT_USERS_JSON = os.getenv("BOT_USERS_JSON", "").strip()

app = FastAPI(title="SMMShop Proxy", version="0.5")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"] if origins == ["*"] else origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

_client = httpx.AsyncClient(timeout=20.0)

# ── internal storage (json) ────────────────────────────────────────────────────
DATA_DIR = ROOT_DIR / "server" / "data"
USERS_JSON  = DATA_DIR / "users.json"
ORDERS_JSON = DATA_DIR / "orders.json"
PAYLOG_JSON = DATA_DIR / "paylog.json"
DATA_DIR.mkdir(parents=True, exist_ok=True)

_users: Dict[str, Dict[str, Any]] = {}
_orders: Dict[str, Any] = {}

def _load_users():
    global _users
    try:
        _users = json.loads(USERS_JSON.read_text("utf-8"))
    except Exception:
        _users = {}

def _save_users():
    USERS_JSON.write_text(json.dumps(_users, ensure_ascii=False, indent=2), encoding="utf-8")

def _load_orders():
    global _orders
    try:
        _orders = json.loads(ORDERS_JSON.read_text("utf-8"))
    except Exception:
        _orders = {"seq": 0, "items": []}

def _save_orders():
    ORDERS_JSON.write_text(json.dumps(_orders, ensure_ascii=False, indent=2), encoding="utf-8")

def _next_order_id() -> int:
    if not _orders: _load_orders()
    _orders["seq"] = int(_orders.get("seq", 0)) + 1
    _save_orders()
    return _orders["seq"]

def _next_user_seq() -> int:
    if not _users: return 1
    try: return max(int(v.get("seq") or 0) for v in _users.values()) + 1
    except Exception: return 1

# ── BOT users nick lookup (читает базу бота) ───────────────────────────────────
# кэшируем, перезагружаем при смене mtime
_bot_users_map: Dict[str, str] = {}
_bot_users_mtime: float = 0.0
_bot_users_path: Optional[Path] = None

def _probe_bot_users_path() -> Optional[Path]:
    # 1) .env приоритет
    if BOT_USERS_JSON:
        p = Path(BOT_USERS_JSON)
        if p.exists(): return p
    # 2) распространённые варианты внутри проекта
    candidates = [
        ROOT_DIR / "bot" / "storage" / "users.json",
        ROOT_DIR / "bot" / "data"    / "users.json",
        ROOT_DIR / "bot" / "storage" / "db" / "users.json",
    ]
    for p in candidates:
        if p.exists(): return p
    return None

def _extract_nicks(obj) -> Dict[str, str]:
    """
    Пытаемся вытащить user_id → nick из произвольной структуры JSON.
    Ищем поля: nick / nickname; user_id / id / uid / tg_id.
    """
    out: Dict[str, str] = {}
    def visit(x):
        if isinstance(x, dict):
            # возможная запись
            uid = x.get("user_id") or x.get("id") or x.get("uid") or x.get("tg_id")
            nk  = x.get("nick") or x.get("nickname")
            if uid and nk:
                try:
                    out[str(int(uid))] = str(nk)
                except Exception:
                    pass
            for v in x.values(): visit(v)
        elif isinstance(x, list):
            for v in x: visit(v)
    visit(obj)
    return out

def _refresh_bot_users_cache():
    global _bot_users_map, _bot_users_mtime, _bot_users_path
    if _bot_users_path is None:
        _bot_users_path = _probe_bot_users_path()
        if _bot_users_path is None:
            return
    try:
        mt = _bot_users_path.stat().st_mtime
        if mt <= _bot_users_mtime:
            return
        data = json.loads(_bot_users_path.read_text("utf-8"))
        _bot_users_map = _extract_nicks(data)
        _bot_users_mtime = mt
    except Exception:
        # не падаем, просто оставляем пустой кэш
        _bot_users_map = {}

def _get_bot_nick(user_id: int) -> Optional[str]:
    _refresh_bot_users_cache()
    return _bot_users_map.get(str(user_id))

# ── users helpers ──────────────────────────────────────────────────────────────
def get_or_create_profile(user_id: int, nick: Optional[str]=None) -> Dict[str, Any]:
    if not _users: _load_users()
    key = str(user_id)

    # ник из БОТА — приоритет
    bot_nick = _get_bot_nick(user_id)
    prefer_nick = bot_nick or (nick or None)

    if key not in _users:
        _users[key] = {
            "user_id": user_id,
            "nick": prefer_nick,
            "balance": 0.0,
            "currency": CURRENCY,
            "seq": _next_user_seq(),
            "ts": int(time.time())
        }
        _save_users()
    else:
        # если в профиле ещё нет ника — записываем найденный (из бота) или переданный
        if prefer_nick and not _users[key].get("nick"):
            _users[key]["nick"] = prefer_nick
            _save_users()
    return _users[key]

def credit_user(user_id: int, amount: float):
    p = get_or_create_profile(user_id)
    p["balance"] = round(float(p.get("balance", 0.0)) + float(amount), 2)
    _save_users()
    return p

def debit_user(user_id: int, amount: float):
    p = get_or_create_profile(user_id)
    cur = float(p.get("balance", 0.0))
    new = round(cur - float(amount), 2)
    if new < -1e-6:
        raise HTTPException(400, "Недостаточно средств")
    p["balance"] = new
    _save_users()
    return p

# ── cache ──────────────────────────────────────────────────────────────────────
_cache: Dict[str, Dict[str, Any]] = {}
def _get_cache(key: str, ttl_sec: int):
    rec = _cache.get(key)
    if rec and (time.time() - rec["ts"] < ttl_sec):
        return rec["data"]
    return None
def _set_cache(key: str, data: Any):
    _cache[key] = {"data": data, "ts": time.time()}

# ── grouping utils ─────────────────────────────────────────────────────────────
NETWORKS = ["telegram","tiktok","instagram","youtube","facebook"]
NETWORK_KEYWORDS = {
    "telegram":  [r"\btelegram\b", r"\btg\b"],
    "tiktok":    [r"\btik\s*tok\b", r"\btiktok\b"],
    "instagram": [r"\binstagram\b", r"\binsta\b", r"\big\b"],
    "youtube":   [r"\byou\s*tube\b", r"\byt\b"],
    "facebook":  [r"\bfacebook\b", r"\bfb\b", r"\bmeta\b"],
}
DISPLAY = {
    "telegram":  {"id":"telegram",  "name":"Telegram",  "desc":"подписчики, просмотры"},
    "tiktok":    {"id":"tiktok",    "name":"TikTok",    "desc":"просмотры, фолловеры"},
    "instagram": {"id":"instagram", "name":"Instagram", "desc":"подписчики, лайки"},
    "youtube":   {"id":"youtube",   "name":"YouTube",   "desc":"просмотры, подписки"},
    "facebook":  {"id":"facebook",  "name":"Facebook",  "desc":"лайки, подписчики"},
}
def detect_network(name: str, category: str) -> Optional[str]:
    txt = f"{name} {category}".lower()
    for net, patterns in NETWORK_KEYWORDS.items():
        for p in patterns:
            if re.search(p, txt):
                return net
    return None

# ── VEX services ───────────────────────────────────────────────────────────────
async def vex_services() -> List[Dict[str, Any]]:
    if not VEX_KEY: raise HTTPException(500, "VEXBOOST_KEY is not configured")
    url = f"{API_BASE}?action=services&key={VEX_KEY}"
    r = await _client.get(url)
    if r.status_code != 200: raise HTTPException(502, "Upstream error (services)")
    try: data = r.json()
    except Exception: raise HTTPException(502, "Bad JSON from upstream")
    if not isinstance(data, list): raise HTTPException(502, "Unexpected response format")
    return data

def client_rate(rate_per_1k: float) -> float:
    return round(float(rate_per_1k) * MARKUP_MULTIPLIER + 1e-9, 2)

# ── routes ─────────────────────────────────────────────────────────────────────
@app.get("/api/v1/ping")
async def ping(): return {"ok": True}

@app.get("/api/v1/user")
async def api_user(user_id: int, nick: Optional[str] = None):
    """
    Возвращает/создаёт профиль в магазине.
    Ник берём из БОТА, если есть. Параметр `nick` используется
    только как запасной вариант, если в базе бота ника нет.
    """
    return get_or_create_profile(user_id, nick=nick)

@app.get("/api/v1/services")
async def api_services():
    cached = _get_cache("services_grouped", ttl_sec=600)
    if cached: return cached
    raw = await vex_services()
    groups: Dict[str, Dict[str, Any]] = {k: {**DISPLAY[k], "count": 0} for k in DISPLAY}
    for s in raw:
        net = detect_network(str(s.get("name","")), str(s.get("category","")))
        if net in groups: groups[net]["count"] += 1
    result = [groups[k] for k in ["telegram","tiktok","instagram","youtube","facebook"]]
    _set_cache("services_grouped", result)
    return result

@app.get("/api/v1/services/{network}")
async def api_services_by_network(network: str):
    if network not in NETWORKS:
        raise HTTPException(404, "Unknown network")
    cache_key = f"services_{network}"
    cached = _get_cache(cache_key, ttl_sec=300)
    if cached: return cached

    raw = await vex_services()
    items = []
    for s in raw:
        net = detect_network(str(s.get("name","")), str(s.get("category","")))
        if net != network: continue
        try:
            rate_v = float(s.get("rate", 0.0))
        except Exception:
            rate_v = 0.0
        items.append({
            "service": int(s.get("service")),
            "name": str(s.get("name","")),
            "type": str(s.get("type","")),
            "min": int(s.get("min", 0)),
            "max": int(s.get("max", 0)),
            "refill": bool(s.get("refill", False)),
            "cancel": bool(s.get("cancel", False)),
            "rate_supplier_1000": rate_v,
            "rate_client_1000": client_rate(rate_v),
        })
    items.sort(key=lambda x: (x["rate_client_1000"], x["min"]))
    _set_cache(cache_key, items)
    return items

@app.post("/api/v1/order/create")
async def create_order(payload: Dict[str, Any] = Body(...)):
    user_id = int(payload.get("user_id") or 0)
    service_id = int(payload.get("service") or 0)
    link = (payload.get("link") or "").strip()
    quantity = int(payload.get("quantity") or 0)
    if user_id <= 0 or service_id <= 0 or not link or quantity <= 0:
        raise HTTPException(400, "Bad payload")

    services_all = await vex_services()
    service_obj = next((s for s in services_all if int(s.get("service")) == service_id), None)
    if not service_obj:
        raise HTTPException(404, "Service not found")

    min_q = int(service_obj.get("min", 0))
    max_q = int(service_obj.get("max", 0))
    if quantity < min_q or quantity > max_q:
        raise HTTPException(400, f"Количество должно быть от {min_q} до {max_q}")

    try:
        base = float(service_obj.get("rate") or 0.0)
    except Exception:
        base = 0.0
    rate_client_1000 = client_rate(base)
    cost = round(rate_client_1000 * quantity / 1000.0 + 1e-9, 2)
    if cost <= 0:
        raise HTTPException(400, "Неверная цена для услуги")

    try:
        debit_user(user_id, cost)
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(400, "Недостаточно средств")

    try:
        qp = httpx.QueryParams({"u": link})
        url = f"{API_BASE}?action=add&service={service_id}&link={qp['u']}&quantity={quantity}&key={VEX_KEY}"
        r = await _client.get(url)
        j = r.json()
        supplier_order = int(j.get("order"))
    except Exception as e:
        credit_user(user_id, cost)
        raise HTTPException(502, f"Supplier error: {e}")

    if not _orders: _load_orders()
    oid = _next_order_id()
    _orders["items"].append({
        "id": oid,
        "user_id": user_id,
        "service": service_id,
        "link": link,
        "quantity": quantity,
        "cost": cost,
        "currency": CURRENCY,
        "supplier_order": supplier_order,
        "status": "Awaiting",
        "ts": int(time.time()),
    })
    _save_orders()

    return {"order_id": oid, "supplier_order": supplier_order, "cost": cost, "currency": CURRENCY, "status": "Awaiting"}

# ── CryptoBot invoice + webhook ────────────────────────────────────────────────
@app.post("/api/v1/pay/invoice")
async def create_invoice(payload: Dict[str, Any] = Body(...)):
    user_id = int(payload.get("user_id") or 0)
    amount_usd = float(payload.get("amount_usd") or 0)
    if user_id <= 0: raise HTTPException(400, "user_id is required")
    if amount_usd < 1.0: raise HTTPException(400, "Minimum top-up is 1.0 USD")
    if not CRYPTOBOT_API_KEY:
        raise HTTPException(501, "CryptoBot integration is not configured")

    url = f"{CRYPTOBOT_BASE}/createInvoice"
    headers = {"Crypto-Pay-API-Token": CRYPTOBOT_API_KEY}
    data = {
        "asset": "USDT",
        "amount": round(amount_usd, 2),
        "description": "Пополнение баланса Slovekiza",
        "payload": json.dumps({"user_id": user_id, "type": "topup"}),
        "allow_comments": False,
        "allow_anonymous": True,
    }
    r = await _client.post(url, headers=headers, data=data)
    j = r.json()
    pay_url = (j.get("result") or {}).get("pay_url")
    if not pay_url:
        raise HTTPException(502, f"Unexpected CryptoBot response: {j}")
    return {"pay_url": pay_url}

def _hmac_ok(raw_body: bytes, token: str, signature: str) -> bool:
    try:
        mac = hmac.new(token.encode(), raw_body, hashlib.sha256).hexdigest()
        return hmac.compare_digest(mac, (signature or "").lower())
    except Exception:
        return False

@app.post("/api/v1/cryptobot/webhook")
async def cryptobot_webhook(request: Request):
    raw = await request.body()
    sig = request.headers.get("X-Crypto-Pay-Signature") or ""
    try:
        data = json.loads(raw.decode("utf-8"))
    except Exception:
        data = {}

    try:
        log = []
        if PAYLOG_JSON.exists():
            log = json.loads(PAYLOG_JSON.read_text("utf-8")) or []
        log.append({"ts": int(time.time()), "ok": True, "sig": bool(sig), "data": data})
        PAYLOG_JSON.write_text(json.dumps(log, ensure_ascii=False, indent=2), encoding="utf-8")
    except Exception:
        pass

    if CRYPTOBOT_API_KEY and sig and not _hmac_ok(raw, CRYPTOBOT_API_KEY, sig):
        raise HTTPException(400, "bad signature")

    def read(path, default=None):
        cur = data
        for k in path:
            if isinstance(cur, dict) and k in cur: cur = cur[k]
            else: return default
        return cur

    payload_s = read(["payload"]) or read(["result","payload"]) or read(["invoice","payload"]) or ""
    amount = read(["amount"]) or read(["result","amount"]) or read(["invoice","amount"]) or 0

    try:
        payload = json.loads(payload_s) if isinstance(payload_s, str) else (payload_s or {})
    except Exception:
        payload = {}

    user_id = int(payload.get("user_id") or 0)
    if not user_id: return {"ok": True, "skip": "no user_id"}

    amount_usd = float(amount or 0)
    if amount_usd > 0: credit_user(user_id, amount_usd)
    return {"ok": True, "credited": amount_usd, "user_id": user_id}
