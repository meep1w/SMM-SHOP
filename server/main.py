# server/main.py
# -*- coding: utf-8 -*-
import os, time, re, json
from typing import List, Dict, Any, Optional
from pathlib import Path

from fastapi import FastAPI, HTTPException, Body
from fastapi.middleware.cors import CORSMiddleware
import httpx

# --- load .env from project root ---
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

app = FastAPI(title="SMMShop Proxy", version="0.2")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"] if origins == ["*"] else origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

_client = httpx.AsyncClient(timeout=20.0)

# ===== simple file storage for internal balances =====
DATA_DIR = ROOT_DIR / "server" / "data"
USERS_JSON = DATA_DIR / "users.json"
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
    if not _users:
        return 1
    try:
        return max(int(v.get("seq") or 0) for v in _users.values()) + 1
    except Exception:
        return 1

def get_or_create_profile(user_id: int, nick: Optional[str]=None) -> Dict[str, Any]:
    if not _users:
        _load_users()
    key = str(user_id)
    if key not in _users:
        _users[key] = {
            "user_id": user_id,
            "nick": nick or None,
            "balance": 0.0,
            "currency": CURRENCY,
            "seq": _next_seq(),
            "ts": int(time.time()),
        }
        _save_users()
    else:
        # при первом заходе можем обновить ник (не обязательно)
        if nick and not _users[key].get("nick"):
            _users[key]["nick"] = nick
            _save_users()
    return _users[key]

def credit_user(user_id: int, amount: float):
    p = get_or_create_profile(user_id)
    p["balance"] = round(float(p.get("balance", 0.0)) + float(amount), 2)
    _save_users()
    return p

# ===== caching for VEX services/balance =====
_cache: Dict[str, Dict[str, Any]] = {}
def _get_cache(key: str, ttl_sec: int):
    rec = _cache.get(key)
    if rec and (time.time() - rec["ts"] < ttl_sec):
        return rec["data"]
    return None
def _set_cache(key: str, data: Any):
    _cache[key] = {"data": data, "ts": time.time()}

# ===== utils for grouping categories =====
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

# ===== VEXBOOST calls =====
async def vex_services() -> List[Dict[str, Any]]:
    if not VEX_KEY:
        raise HTTPException(500, "VEXBOOST_KEY is not configured")
    url = f"{API_BASE}?action=services&key={VEX_KEY}"
    resp = await _client.get(url)
    if resp.status_code != 200:
        raise HTTPException(502, "Upstream error (services)")
    try:
        data = resp.json()
    except Exception:
        raise HTTPException(502, "Bad JSON from upstream")
    if not isinstance(data, list):
        raise HTTPException(502, "Unexpected response format")
    return data

# ===== API =====
@app.get("/api/v1/ping")
async def ping():
    return {"ok": True}

# -- внутренний профиль (баланс магазина)
@app.get("/api/v1/user")
async def api_user(user_id: int, nick: Optional[str] = None):
    """
    Возвращает/создаёт профиль в нашем магазине: { user_id, nick?, balance, currency, seq }.
    """
    profile = get_or_create_profile(user_id, nick=nick)
    return profile

# -- группы категорий из VEXBOOST (для главной страницы)
@app.get("/api/v1/services")
async def api_services():
    cached = _get_cache("services_grouped", ttl_sec=600)
    if cached:
        return cached

    raw = await vex_services()
    groups: Dict[str, Dict[str, Any]] = {k: {**DISPLAY[k], "count": 0} for k in DISPLAY}

    for s in raw:
        net = detect_network(str(s.get("name","")), str(s.get("category","")))
        if net in groups:
            groups[net]["count"] += 1

    result = [groups[k] for k in ["telegram","tiktok","instagram","youtube","facebook"]]
    _set_cache("services_grouped", result)
    return result

# -- заготовка: создание инвойса в CryptoBot (включается при наличии ключа)
@app.post("/api/v1/pay/invoice")
async def create_invoice(payload: Dict[str, Any] = Body(...)):
    """
    payload: { user_id:int, amount_usd:float }
    min amount_usd = 1.0
    Возвращает { pay_url } при включённом CRYPTOBOT_API_KEY, иначе 501.
    """
    user_id = int(payload.get("user_id") or 0)
    amount_usd = float(payload.get("amount_usd") or 0)

    if user_id <= 0:
        raise HTTPException(400, "user_id is required")
    if amount_usd < 1.0:
        raise HTTPException(400, "Minimum top-up is 1.0 USD")

    # на будущее: сохраним ожидаемую оплату (omitted)

    if not CRYPTOBOT_API_KEY:
        # пока просто сообщаем, что не сконфигурировано
        raise HTTPException(501, "CryptoBot integration is not configured")

    # -- Если ключ указан, создаём инвойс (минимальный запрос) --
    # Документация Crypto Pay API: POST /createInvoice (headers: "Crypto-Pay-API-Token": <key>)
    # Параметры могут отличаться — здесь примерный вызов. Отладим вместе, когда подключим ключ.
    url = f"{CRYPTOBOT_BASE}/createInvoice"
    headers = {"Crypto-Pay-API-Token": CRYPTOBOT_API_KEY}
    data = {
        "asset": "USDT",            # можно выбрать TON/USDT/USDC и т.д.
        "amount": round(amount_usd, 2),
        "description": "Пополнение баланса Slovekiza",
        "payload": json.dumps({"user_id": user_id, "type": "topup"}),
        "allow_comments": False,
        "allow_anonymous": True,
    }
    r = await _client.post(url, headers=headers, data=data)
    try:
        j = r.json()
    except Exception:
        raise HTTPException(502, "Bad response from CryptoBot")

    # ожидаем вид: {"ok":true,"result":{"pay_url":"https://..."}}
    pay_url = (j.get("result") or {}).get("pay_url")
    if not pay_url:
        raise HTTPException(502, f"Unexpected CryptoBot response: {j}")
    return {"pay_url": pay_url}
