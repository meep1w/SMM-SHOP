# server/main.py
# -*- coding: utf-8 -*-
import os, time, re, json, hmac, hashlib, logging
from typing import List, Dict, Any, Optional
from pathlib import Path

from fastapi import FastAPI, HTTPException, Body, Request
from fastapi.middleware.cors import CORSMiddleware
import httpx

# ---------- init ----------
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

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

CURRENCY = os.getenv("CURRENCY", "RUB").strip().upper() or "RUB"
MARKUP_MULTIPLIER = float(os.getenv("MARKUP_MULTIPLIER", "5.0"))

CRYPTOBOT_API_KEY = os.getenv("CRYPTOBOT_API_KEY", "").strip()
CRYPTOBOT_BASE = os.getenv("CRYPTOBOT_BASE", "https://pay.crypt.bot/api").strip().rstrip("/")
MIN_TOPUP_USD = float(os.getenv("CRYPTOBOT_MIN_TOPUP_USD", "0.10"))
FX_CACHE_TTL = int(os.getenv("FX_CACHE_TTL", "600"))

app = FastAPI(title="SMMShop API", version="0.6")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"] if origins == ["*"] else origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

_client = httpx.AsyncClient(timeout=20.0)

# ---------- storage (json) ----------
DATA_DIR = ROOT_DIR / "server" / "data"
DATA_DIR.mkdir(parents=True, exist_ok=True)
USERS_JSON  = DATA_DIR / "users.json"
ORDERS_JSON = DATA_DIR / "orders.json"
PAYLOG_JSON = DATA_DIR / "paylog.json"
CREDITS_JSON = DATA_DIR / "credited_invoices.json"

_users: Dict[str, Dict[str, Any]] = {}
_orders: Dict[str, Any] = {}
_credited: Dict[str, float] = {}  # invoice_id -> amount credited in shop currency

def _load_users():
    global _users
    try: _users = json.loads(USERS_JSON.read_text("utf-8"))
    except Exception: _users = {}

def _save_users():
    USERS_JSON.write_text(json.dumps(_users, ensure_ascii=False, indent=2), encoding="utf-8")

def _load_orders():
    global _orders
    try: _orders = json.loads(ORDERS_JSON.read_text("utf-8"))
    except Exception: _orders = {"seq": 0, "items": []}

def _save_orders():
    ORDERS_JSON.write_text(json.dumps(_orders, ensure_ascii=False, indent=2), encoding="utf-8")

def _load_credited():
    global _credited
    try: _credited = json.loads(CREDITS_JSON.read_text("utf-8"))
    except Exception: _credited = {}

def _save_credited():
    CREDITS_JSON.write_text(json.dumps(_credited, ensure_ascii=False, indent=2), encoding="utf-8")

_load_users(); _load_orders(); _load_credited()

def _next_order_id() -> int:
    _orders["seq"] = int(_orders.get("seq", 0)) + 1
    _save_orders()
    return _orders["seq"]

def _next_user_seq() -> int:
    try: return max(int(v.get("seq") or 0) for v in _users.values()) + 1
    except Exception: return 1

def get_or_create_profile(user_id: int, nick: Optional[str]=None) -> Dict[str, Any]:
    key = str(user_id)
    if key not in _users:
        _users[key] = {
            "user_id": user_id, "nick": nick or None,
            "balance": 0.0, "currency": CURRENCY,
            "seq": _next_user_seq(), "ts": int(time.time())
        }
        _save_users()
    else:
        if nick and not _users[key].get("nick"):
            _users[key]["nick"] = nick
            _save_users()
        if _users[key].get("currency") != CURRENCY:
            _users[key]["currency"] = CURRENCY
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

# ---------- FX ----------
_fx_cache: Dict[str, Dict[str, Any]] = {}

def _fx_get(key: str) -> Optional[float]:
    rec = _fx_cache.get(key)
    if rec and (time.time() - rec["ts"] < FX_CACHE_TTL):
        return float(rec["rate"])
    return None

def _fx_put(key: str, rate: float):
    _fx_cache[key] = {"rate": float(rate), "ts": time.time()}

async def fx_usd_rub() -> float:
    if CURRENCY != "RUB":
        return 1.0
    cached = _fx_get("USD_RUB")
    if cached: return cached
    for url in [
        "https://api.exchangerate.host/latest?base=USD&symbols=RUB",
        "https://open.er-api.com/v6/latest/USD",
    ]:
        try:
            r = await _client.get(url)
            j = r.json()
            rate = float(j["rates"]["RUB"])
            if rate > 0:
                _fx_put("USD_RUB", rate)
                return rate
        except Exception:
            pass
    rate = 100.0
    _fx_put("USD_RUB", rate)
    return rate

# ---------- VEX services ----------
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
    for net, pats in NETWORK_KEYWORDS.items():
        for p in pats:
            if re.search(p, txt):
                return net
    return None

async def vex_services() -> List[Dict[str, Any]]:
    if not VEX_KEY: raise HTTPException(500, "VEXBOOST_KEY is not configured")
    r = await _client.get(f"{API_BASE}?action=services&key={VEX_KEY}")
    if r.status_code != 200: raise HTTPException(502, "Upstream error (services)")
    try: data = r.json()
    except Exception: raise HTTPException(502, "Bad JSON from upstream")
    if not isinstance(data, list): raise HTTPException(502, "Unexpected response format")
    return data

def client_rate_usd_per_1k(rate_supplier_1000: float) -> float:
    return round(float(rate_supplier_1000) * MARKUP_MULTIPLIER + 1e-9, 2)

# ---------- caching ----------
_cache: Dict[str, Dict[str, Any]] = {}

def _get_cache(key: str, ttl_sec: int):
    rec = _cache.get(key)
    if rec and (time.time() - rec["ts"] < ttl_sec):
        return rec["data"]
    return None

def _set_cache(key: str, data: Any):
    _cache[key] = {"data": data, "ts": time.time()}

# ---------- routes ----------
@app.get("/api/v1/ping")
async def ping(): return {"ok": True}

@app.get("/api/v1/user")
async def api_user(user_id: int, nick: Optional[str] = None):
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
    cache_key = f"services_{network}_{CURRENCY}"
    cached = _get_cache(cache_key, ttl_sec=300)
    if cached: return cached

    raw = await vex_services()
    fx = await fx_usd_rub()
    items = []
    for s in raw:
        net = detect_network(str(s.get("name","")), str(s.get("category","")))
        if net != network: continue
        try:
            rate_sup = float(s.get("rate", 0.0))
        except Exception:
            rate_sup = 0.0
        rate_client_usd = client_rate_usd_per_1k(rate_sup)
        rate_view = rate_client_usd * (fx if CURRENCY == "RUB" else 1.0)
        items.append({
            "service": int(s.get("service")),
            "name": str(s.get("name","")),
            "type": str(s.get("type","")),
            "min": int(s.get("min", 0)),
            "max": int(s.get("max", 0)),
            "refill": bool(s.get("refill", False)),
            "cancel": bool(s.get("cancel", False)),
            "rate_client_1000": round(rate_view, 2),
            "currency": CURRENCY,
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
    service_obj = None
    for s in services_all:
        if int(s.get("service")) == service_id:
            service_obj = s; break
    if not service_obj:
        raise HTTPException(404, "Service not found")

    min_q = int(service_obj.get("min", 0))
    max_q = int(service_obj.get("max", 0))
    if quantity < min_q or quantity > max_q:
        raise HTTPException(400, f"Количество должно быть от {min_q} до {max_q}")

    try:
        base_usd = float(service_obj.get("rate") or 0.0)
    except Exception:
        base_usd = 0.0
    fx = await fx_usd_rub()
    rate_client_usd = client_rate_usd_per_1k(base_usd)
    rate_view = rate_client_usd * (fx if CURRENCY == "RUB" else 1.0)
    cost = round(rate_view * quantity / 1000.0 + 1e-9, 2)
    if cost <= 0:
        raise HTTPException(400, "Неверная цена для услуги")

    debit_user(user_id, cost)

    try:
        url = f"{API_BASE}?action=add&service={service_id}&link={httpx.QueryParams({'u':link})['u']}&quantity={quantity}&key={VEX_KEY}"
        r = await _client.get(url)
        j = r.json()
        supplier_order = int(j.get("order"))
    except Exception as e:
        credit_user(user_id, cost)
        raise HTTPException(502, f"Supplier error: {e}")

    oid = _next_order_id()
    _orders["items"].append({
        "id": oid, "user_id": user_id, "service": service_id,
        "link": link, "quantity": quantity,
        "cost": cost, "currency": CURRENCY,
        "supplier_order": supplier_order, "status": "Awaiting",
        "ts": int(time.time()),
    })
    _save_orders()

    return {"order_id": oid, "supplier_order": supplier_order, "cost": cost, "currency": CURRENCY, "status": "Awaiting"}

# ---------- payments ----------
@app.post("/api/v1/pay/invoice")
async def create_invoice(payload: Dict[str, Any] = Body(...)):
    user_id = int(payload.get("user_id") or 0)
    amount_usd = float(payload.get("amount_usd") or 0)
    if user_id <= 0: raise HTTPException(400, "user_id is required")
    if amount_usd < MIN_TOPUP_USD: raise HTTPException(400, f"Minimum top-up is {MIN_TOPUP_USD:.2f} USD")
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

def _log_pay(payload: Dict[str, Any]):
    try:
        log = []
        if PAYLOG_JSON.exists():
            log = json.loads(PAYLOG_JSON.read_text("utf-8")) or []
        log.append(payload)
        PAYLOG_JSON.write_text(json.dumps(log, ensure_ascii=False, indent=2), encoding="utf-8")
    except Exception:
        pass

@app.post("/api/v1/cryptobot/webhook")
async def cryptobot_webhook(request: Request):
    raw = await request.body()
    sig = request.headers.get("X-Crypto-Pay-Signature") or ""
    try:
        data = json.loads(raw.decode("utf-8"))
    except Exception:
        data = {}

    # логируем всё подряд
    _log_pay({"ts": int(time.time()), "headers": {"sig": bool(sig)}, "data": data})

    # проверка подписи (если заголовок присутствует)
    if sig and CRYPTOBOT_API_KEY and not _hmac_ok(raw, CRYPTOBOT_API_KEY, sig):
        raise HTTPException(400, "bad signature")

    # ожидаемый формат: update_type=invoice_paid, invoice.status=paid
    inv = (data.get("invoice")
           or (data.get("result") or {}).get("invoice")
           or data.get("result")
           or {})
    status = str(inv.get("status") or data.get("status") or "").lower()
    update_type = str(data.get("update_type") or "").lower()

    if update_type and update_type != "invoice_paid":
        return {"ok": True, "skip": f"update_type={update_type}"}
    if status and status not in ("paid", "finished", "completed"):
        return {"ok": True, "skip": f"status={status}"}

    invoice_id = str(inv.get("invoice_id") or inv.get("id") or "")
    payload_s = inv.get("payload") or data.get("payload") or ""
    amount = float(inv.get("amount") or data.get("amount") or 0)
    asset = str(inv.get("asset") or data.get("asset") or "USDT").upper()

    try:
        payload = json.loads(payload_s) if isinstance(payload_s, str) else (payload_s or {})
    except Exception:
        payload = {}
    user_id = int(payload.get("user_id") or 0)

    if not user_id or amount <= 0:
        return {"ok": True, "skip": "no user_id or zero amount"}

    # идемпотентность
    if invoice_id:
        if invoice_id in _credited:
            return {"ok": True, "already": True, "invoice_id": invoice_id}
    # конвертация в валюту витрины
    if CURRENCY == "RUB":
        fx = await fx_usd_rub()
        credited = round(amount * fx, 2)
    else:
        credited = round(amount, 2)

    profile = credit_user(user_id, credited)

    if invoice_id:
        _credited[invoice_id] = credited
        _save_credited()

    logging.info(f"Credited {credited} {CURRENCY} to user {user_id} (invoice {invoice_id})")
    return {"ok": True, "credited": credited, "currency": CURRENCY, "user_id": user_id, "invoice_id": invoice_id}
