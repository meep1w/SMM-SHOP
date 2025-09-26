# server/main.py
# -*- coding: utf-8 -*-
import os, time, re, json, hmac, hashlib
from typing import List, Dict, Any, Optional
from pathlib import Path

from fastapi import FastAPI, HTTPException, Body, Request
from fastapi.middleware.cors import CORSMiddleware
import httpx

# load .env
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

CRYPTOBOT_API_KEY = os.getenv("CRYPTOBOT_API_KEY", "").strip()  # для API и подписи вебхука
CRYPTOBOT_BASE = os.getenv("CRYPTOBOT_BASE", "https://pay.crypt.bot/api").strip().rstrip("/")

app = FastAPI(title="SMMShop Proxy", version="0.3")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"] if origins == ["*"] else origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

_client = httpx.AsyncClient(timeout=20.0)

# ===== internal storage (json) =====
DATA_DIR = ROOT_DIR / "server" / "data"
USERS_JSON = DATA_DIR / "users.json"
PAYLOG_JSON = DATA_DIR / "paylog.json"
DATA_DIR.mkdir(parents=True, exist_ok=True)

_users: Dict[str, Dict[str, Any]] = {}
def _load_users():
    global _users
    try:
        with open(USERS_JSON, "r", encoding="utf-8") as f:
            _users = json.load(f) or {}
    except Exception:
        _users = {}
def _save_users():
    with open(USERS_JSON, "w", encoding="utf-8") as f:
        json.dump(_users, f, ensure_ascii=False, indent=2)
def _next_seq() -> int:
    if not _users: return 1
    try: return max(int(v.get("seq") or 0) for v in _users.values()) + 1
    except Exception: return 1
def get_or_create_profile(user_id: int, nick: Optional[str]=None) -> Dict[str, Any]:
    if not _users: _load_users()
    key = str(user_id)
    if key not in _users:
        _users[key] = {
            "user_id": user_id, "nick": nick or None,
            "balance": 0.0, "currency": CURRENCY,
            "seq": _next_seq(), "ts": int(time.time())
        }
        _save_users()
    else:
        if nick and not _users[key].get("nick"):
            _users[key]["nick"] = nick
            _save_users()
    return _users[key]
def credit_user(user_id: int, amount: float):
    p = get_or_create_profile(user_id)
    p["balance"] = round(float(p.get("balance", 0.0)) + float(amount), 2)
    _save_users()
    return p

# simple cache
_cache: Dict[str, Dict[str, Any]] = {}
def _get_cache(key: str, ttl_sec: int):
    rec = _cache.get(key)
    if rec and (time.time() - rec["ts"] < ttl_sec):
        return rec["data"]
    return None
def _set_cache(key: str, data: Any):
    _cache[key] = {"data": data, "ts": time.time()}

# grouping utils
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

# VEX services
async def vex_services() -> List[Dict[str, Any]]:
    if not VEX_KEY: raise HTTPException(500, "VEXBOOST_KEY is not configured")
    url = f"{API_BASE}?action=services&key={VEX_KEY}"
    r = await _client.get(url)
    if r.status_code != 200: raise HTTPException(502, "Upstream error (services)")
    try: data = r.json()
    except Exception: raise HTTPException(502, "Bad JSON from upstream")
    if not isinstance(data, list): raise HTTPException(502, "Unexpected response format")
    return data

# ===== routes =====
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

# ---- CryptoBot webhook ----
def _hmac_ok(raw_body: bytes, token: str, signature: str) -> bool:
    """
    Попытка верификации подписи (если CryptoBot её присылает).
    Схема может отличаться — уточним после включения вебхука.
    """
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

    # Логируем событие
    try:
        log = []
        if PAYLOG_JSON.exists():
            log = json.loads(PAYLOG_JSON.read_text("utf-8")) or []
        log.append({"ts": int(time.time()), "ok": True, "sig": bool(sig), "data": data})
        PAYLOG_JSON.write_text(json.dumps(log, ensure_ascii=False, indent=2), encoding="utf-8")
    except Exception:
        pass

    # Если есть ключ — попытаемся проверить подпись (best-effort)
    if CRYPTOBOT_API_KEY and sig and not _hmac_ok(raw, CRYPTOBOT_API_KEY, sig):
        raise HTTPException(400, "bad signature")

    # Универсальный парсер: вытаскиваем amount, валюту и payload
    def read(path, default=None):
        cur = data
        for k in path:
            if isinstance(cur, dict) and k in cur: cur = cur[k]
            else: return default
        return cur

    payload_s = read(["payload"]) or read(["result","payload"]) or read(["invoice","payload"]) or ""
    amount = read(["amount"]) or read(["result","amount"]) or read(["invoice","amount"]) or 0
    asset  = read(["asset"])  or read(["result","asset"])  or read(["invoice","asset"])  or "USDT"

    try:
        payload = json.loads(payload_s) if isinstance(payload_s, str) else (payload_s or {})
    except Exception:
        payload = {}

    user_id = int(payload.get("user_id") or 0)
    if not user_id:
        return {"ok": True, "skip": "no user_id in payload"}

    # считаем, что USDT≈USD
    amount_usd = float(amount or 0)
    if amount_usd > 0:
        credit_user(user_id, amount_usd)

    return {"ok": True, "credited": amount_usd, "user_id": user_id}
