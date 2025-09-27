# -*- coding: utf-8 -*-
import os, time, json, logging
from typing import Dict, Any, Optional, List
from pathlib import Path

from fastapi import FastAPI, HTTPException, Body, Request, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import httpx
from sqlalchemy.orm import Session

from .db import Base, engine, SessionLocal, User, Service, Favorite, Order, Topup, stable_seq

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

# --- env / paths ---
try:
    from dotenv import load_dotenv
    ROOT_DIR = Path(__file__).resolve().parents[1]
    load_dotenv(ROOT_DIR / ".env")
except Exception:
    ROOT_DIR = Path(__file__).resolve().parents[1]

API_BASE = os.getenv("VEXBOOST_BASE", "https://vexboost.ru/api/v2").strip()
VEX_KEY  = os.getenv("VEXBOOST_KEY", "").strip()

ALLOWED_ORIGINS = os.getenv("ALLOWED_ORIGINS", "*")
origins = [o.strip() for o in ALLOWED_ORIGINS.split(",") if o.strip()]

CURRENCY = (os.getenv("CURRENCY", "RUB") or "RUB").strip().upper()
MARKUP_MULTIPLIER = float(os.getenv("MARKUP_MULTIPLIER", "5.0"))

# CryptoBot (учтены возможные опечатки)
CRYPTOBOT_API_KEY  = os.getenv("CRYPTOBOT_API_KEY") or os.getenv("CRYPTOPBOT_API_KEY") or ""
CRYPTOBOT_BASE     = os.getenv("CRYPTOBOT_BASE") or os.getenv("CRYPTOPBOT_BASE") or "https://pay.crypt.bot/api"
CRYPTOBOT_MIN_TOPUP_USD = float(os.getenv("CRYPTOBOT_MIN_TOPUP_USD", os.getenv("CRYPTOPBOT_MIN_TOPUP_USD", "0.10")))

FX_CACHE_TTL = int(os.getenv("FX_CACHE_TTL", "600"))

NETWORKS = ["telegram", "tiktok", "instagram", "youtube", "facebook"]
DISPLAY = {
    "telegram":  {"id": "telegram",  "name": "Telegram",  "desc": "подписчики, просмотры"},
    "tiktok":    {"id": "tiktok",    "name": "TikTok",    "desc": "просмотры, фолловеры"},
    "instagram": {"id": "instagram", "name": "Instagram", "desc": "подписчики, лайки"},
    "youtube":   {"id": "youtube",   "name": "YouTube",   "desc": "просмотры, подписки"},
    "facebook":  {"id": "facebook",  "name": "Facebook",  "desc": "лайки, подписчики"},
}

# --- app ---
app = FastAPI(title="SMMShop API", version="2.1")
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins or ["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# глобальный HTTP клиент
_client = httpx.AsyncClient(timeout=30.0)

# --- FX cache ---
_fx_cache: Dict[str, Dict[str, Any]] = {}


def _fx_get(k: str) -> Optional[float]:
    obj = _fx_cache.get(k)
    if not obj:
        return None
    if time.time() - obj.get("t", 0) > FX_CACHE_TTL:
        return None
    return float(obj.get("v", 0))


def _fx_put(k: str, v: float) -> None:
    _fx_cache[k] = {"v": float(v), "t": time.time()}


async def fx_usd_rub() -> float:
    cached = _fx_get("USD_RUB")
    if cached:
        return cached

    for url in (
        "https://api.exchangerate.host/latest?base=USD&symbols=RUB",
        "https://open.er-api.com/v6/latest/USD",
    ):
        try:
            r = await _client.get(url)
            data = r.json()
            v = float(data["rates"]["RUB"])
            if v > 0:
                _fx_put("USD_RUB", v)
                return v
        except Exception:
            continue

    # запасной вариант
    _fx_put("USD_RUB", 100.0)
    return 100.0


def client_rate_view_per_1k(base_usd_per_1k: float, fx: float) -> float:
    usd_client = float(base_usd_per_1k) * MARKUP_MULTIPLIER
    if CURRENCY == "RUB":
        return usd_client * fx
    return usd_client


def db() -> Session:
    return SessionLocal()


def ensure_user(db: Session, tg_id: int, nick: Optional[str] = None) -> User:
    u = db.query(User).filter(User.tg_id == tg_id).one_or_none()
    if u:
        if nick and not u.nick:
            u.nick = nick
        u.last_seen_at = int(time.time())
        db.commit()
        return u

    u = User(
        tg_id=tg_id,
        seq=stable_seq(tg_id),
        nick=nick,
        currency=CURRENCY,
        balance=0.0,
        last_seen_at=int(time.time()),
    )
    db.add(u)
    db.commit()
    db.refresh(u)

    # дефолтные избранные
    for sid in (2127, 2453, 2454):
        db.merge(Favorite(user_id=u.id, service_id=sid))
    db.commit()
    return u


# --- схемы ---
class UserOut(BaseModel):
    seq: int
    nick: Optional[str] = None
    currency: str = CURRENCY
    balance: float = 0.0
    topup_delta: float = 0.0
    topup_currency: str = "USD"


class CreateOrderIn(BaseModel):
    user_id: int
    service: int
    link: str
    quantity: int
    promo_code: Optional[str] = None


class RegisterIn(BaseModel):
    user_id: int
    nick: str


# --- VEXBOOST ----
async def vex_services_raw() -> List[Dict[str, Any]]:
    if not VEX_KEY:
        raise HTTPException(500, "VEXBOOST_KEY not set")
    url = f"{API_BASE}?action=services&key={VEX_KEY}"
    r = await _client.get(url)
    r.raise_for_status()
    data = r.json()
    if not isinstance(data, list):
        raise HTTPException(502, "Unexpected services payload")
    return data


def _detect_network(name: str, category: str) -> Optional[str]:
    t = f"{name} {category}".lower()
    if "telegram" in t or "tg " in t:
        return "telegram"
    if "tiktok" in t or "tik tok" in t:
        return "tiktok"
    if "instagram" in t or "insta" in t or "ig " in t:
        return "instagram"
    if "youtube" in t or "you tube" in t or "yt " in t:
        return "youtube"
    if "facebook" in t or "fb " in t or "meta" in t:
        return "facebook"
    return None


async def sync_services_into_db():
    raw = await vex_services_raw()
    fx = await fx_usd_rub()
    with db() as s:
        for it in raw:
            sid = int(it.get("service"))
            name = it.get("name") or f"Service {sid}"
            type_ = it.get("type")
            cat = it.get("category") or ""
            min_ = int(it.get("min") or 0)
            max_ = int(it.get("max") or 0)
            base_rate_usd = float(it.get("rate") or 0.0)
            rate_view = client_rate_view_per_1k(base_rate_usd, fx)
            net = _detect_network(name, cat) or "telegram"

            obj = s.get(Service, sid)
            if not obj:
                obj = Service(
                    id=sid,
                    network=net,
                    name=name,
                    type=type_,
                    min=min_,
                    max=max_,
                    rate_client_1000=rate_view,
                    currency=CURRENCY,
                    description=cat,
                    active=True,
                )
                s.add(obj)
            else:
                obj.network = net
                obj.name = name
                obj.type = type_
                obj.min = min_
                obj.max = max_
                obj.rate_client_1000 = rate_view
                obj.currency = CURRENCY
                obj.description = cat
                obj.active = True
        s.commit()


# --- lifecycle ---
@app.on_event("startup")
async def _startup():
    try:
        Base.metadata.create_all(bind=engine)
        await sync_services_into_db()
    except Exception as e:
        logging.exception("Startup sync failed: %s", e)


@app.on_event("shutdown")
async def _shutdown():
    try:
        await _client.aclose()
    except Exception:
        pass


# --- endpoints ---
@app.get("/api/v1/ping")
async def ping():
    return {"ok": True}


# Проверка наличия пользователя (без автосоздания)
@app.get("/api/v1/user/exists")
async def api_user_exists(user_id: int = Query(...)):
    with db() as s:
        exists = s.query(User.id).filter(User.tg_id == user_id).first() is not None
        return {"exists": exists}


# Профиль: можно выключить автосоздание
@app.get("/api/v1/user", response_model=UserOut)
async def api_user(
    user_id: int = Query(...),
    consume_topup: int = 0,
    nick: Optional[str] = None,
    autocreate: int = 1,  # 1 — как раньше; 0 — без создания (вернёт 404)
):
    with db() as s:
        u = s.query(User).filter(User.tg_id == user_id).one_or_none()
        if not u:
            if not autocreate:
                raise HTTPException(404, "user_not_found")
            u = ensure_user(s, user_id, nick=nick)
        else:
            if nick and not u.nick:
                u.nick = nick
                s.commit()

        delta = 0.0
        if consume_topup:
            pays = (
                s.query(Topup)
                .filter(Topup.user_id == u.id, Topup.status == "paid", Topup.applied == False)  # noqa: E712
                .all()
            )
            for t in pays:
                delta += float(t.amount_usd or 0.0)
                t.applied = True
            if delta > 0:
                add = delta if CURRENCY == "USD" else (delta * (await fx_usd_rub()))
                u.balance = float(u.balance or 0.0) + round(add, 2)
            s.commit()
        return UserOut(
            seq=u.seq,
            nick=u.nick,
            currency=u.currency,
            balance=float(u.balance or 0.0),
            topup_delta=round(delta, 6),
            topup_currency="USD",
        )


# Регистрация (ник должен быть уникальным)
@app.post("/api/v1/register")
async def api_register(body: RegisterIn):
    nick = (body.nick or "").strip()
    if not (3 <= len(nick) <= 32):
        raise HTTPException(400, "Ник должен быть от 3 до 32 символов")
    with db() as s:
        if s.query(User.id).filter(User.nick == nick).first():
            raise HTTPException(409, "Ник уже занят")
        u = s.query(User).filter(User.tg_id == body.user_id).one_or_none()
        if not u:
            u = ensure_user(s, body.user_id, nick=nick)
        else:
            if u.nick:
                raise HTTPException(409, "Профиль уже создан")
            u.nick = nick
            s.commit()
        return {"ok": True, "seq": u.seq, "nick": u.nick}


@app.get("/api/v1/services")
async def api_services():
    with db() as s:
        groups = {k: {**DISPLAY[k], "count": 0} for k in DISPLAY}
        for it in s.query(Service).filter(Service.active == True).all():  # noqa: E712
            if it.network in groups:
                groups[it.network]["count"] += 1
        return [groups[k] for k in ["telegram", "tiktok", "instagram", "youtube", "facebook"]]


@app.get("/api/v1/services/{network}")
async def api_services_by_network(network: str):
    if network not in NETWORKS:
        raise HTTPException(404, "Unknown network")
    with db() as s:
        items = (
            s.query(Service)
            .filter(Service.network == network, Service.active == True)  # noqa: E712
            .order_by(Service.id.asc())
            .all()
        )
        return [
            {
                "service": it.id,
                "network": it.network,
                "name": it.name,
                "type": it.type,
                "min": it.min,
                "max": it.max,
                "rate_client_1000": float(it.rate_client_1000 or 0.0),
                "currency": it.currency or CURRENCY,
                "description": it.description or "",
            }
            for it in items
        ]


# ---- Favorites ----
@app.get("/api/v1/favorites")
async def fav_list(user_id: int = Query(...)):
    with db() as s:
        u = ensure_user(s, user_id)
        rows = (
            s.query(Service)
            .join(Favorite, Favorite.service_id == Service.id)
            .filter(Favorite.user_id == u.id)
            .all()
        )
        return [
            {
                "service": it.id,
                "network": it.network,
                "name": it.name,
                "type": it.type,
                "min": it.min,
                "max": it.max,
                "rate_client_1000": float(it.rate_client_1000 or 0.0),
                "currency": it.currency or CURRENCY,
                "description": it.description or "",
            }
            for it in rows
        ]


class FavIn(BaseModel):
    user_id: int
    service_id: int


@app.post("/api/v1/favorites", status_code=204)
async def fav_add(body: FavIn):
    with db() as s:
        u = ensure_user(s, body.user_id)
        s.merge(Favorite(user_id=u.id, service_id=int(body.service_id)))
        s.commit()


@app.delete("/api/v1/favorites/{service_id}", status_code=204)
async def fav_del(service_id: int, user_id: int = Query(...)):
    with db() as s:
        u = ensure_user(s, user_id)
        s.query(Favorite).filter(Favorite.user_id == u.id, Favorite.service_id == service_id).delete()
        s.commit()


# ---- Order create ----
@app.post("/api/v1/order/create")
async def api_order_create(body: CreateOrderIn):
    with db() as s:
        u = ensure_user(s, body.user_id)
        svc = s.get(Service, int(body.service))
        if not svc:
            raise HTTPException(404, "service not found")

        if body.quantity < (svc.min or 0) or body.quantity > (svc.max or 0):
            raise HTTPException(400, f"Количество должно быть от {svc.min} до {svc.max}")

        cost = round(float(svc.rate_client_1000 or 0.0) * body.quantity / 1000.0, 2)
        if float(u.balance or 0.0) < cost:
            raise HTTPException(402, "Недостаточно средств")

        # VEXBOOST create order
        try:
            qp = httpx.QueryParams({
                "action": "add",
                "service": svc.id,
                "link": body.link,
                "quantity": int(body.quantity),
                "key": VEX_KEY
            })
            url = f"{API_BASE}?{qp}"
            r = await _client.get(url)
            supplier_order = int(r.json().get("order"))
        except Exception as e:
            raise HTTPException(502, f"Supplier error: {e}")

        u.balance = float(u.balance or 0.0) - cost
        o = Order(
            user_id=u.id,
            service_id=svc.id,
            quantity=int(body.quantity),
            link=body.link,
            cost=cost,
            currency=svc.currency or CURRENCY,
            status="Awaiting",
            provider_id=str(supplier_order),
        )
        s.add(o)
        s.commit()
        s.refresh(o)
        return {"order_id": o.id, "cost": cost, "currency": o.currency, "status": o.status}


# ---- Invoice create ----
@app.post("/api/v1/pay/invoice")
async def api_pay_invoice(payload: Dict[str, Any] = Body(...)):
    if not CRYPTOBOT_API_KEY:
        return {"error": "CryptoBot not configured"}, 501

    amount = float(payload.get("amount_usd") or 0.0)
    if amount < CRYPTOBOT_MIN_TOPUP_USD:
        raise HTTPException(400, f"Минимальная сумма — {CRYPTOBOT_MIN_TOPUP_USD} USDT")

    user_id = int(payload.get("user_id") or 0)
    if user_id <= 0:
        raise HTTPException(400, "user_id required")

    link = f"{CRYPTOBOT_BASE}/createInvoice"
    headers = {"Content-Type": "application/json", "Crypto-Pay-API-Token": CRYPTOBOT_API_KEY}
    body = {"asset": "USDT", "amount": round(amount, 2), "payload": str(user_id), "description": "SMMShop topup"}

    async with httpx.AsyncClient(timeout=15.0) as c:
        r = await c.post(link, headers=headers, json=body)
        js = r.json()

    if isinstance(js.get("result"), dict) and js["result"].get("pay_url"):
        pay_url = js["result"]["pay_url"]
        invoice_id = js["result"].get("invoice_id", "")
    elif isinstance(js.get("invoice"), dict) and js["invoice"].get("pay_url"):
        pay_url = js["invoice"]["pay_url"]
        invoice_id = js["invoice"].get("invoice_id", "")
    else:
        raise HTTPException(502, f"CryptoBot error: {js}")

    with db() as s:
        u = ensure_user(s, user_id)
        t = Topup(
            user_id=u.id,
            provider="cryptobot",
            invoice_id=str(invoice_id),
            amount_usd=amount,
            currency="USD",
            status="created",
            applied=False,
            pay_url=pay_url,
        )
        s.add(t)
        s.commit()

    return {"pay_url": pay_url}


# ---- Webhook ----
def _extract_invoice(data: Dict[str, Any]) -> Dict[str, Any]:
    if isinstance(data.get("invoice"), dict):
        inv = data["invoice"]
    elif isinstance(data.get("result"), dict) and isinstance(data["result"].get("invoice"), dict):
        inv = data["result"]["invoice"]
    elif isinstance(data.get("result"), dict):
        inv = data["result"]
    elif isinstance(data.get("payload"), dict) and ("status" in data["payload"]):
        inv = data["payload"]
    else:
        inv = {}

    return {
        "invoice_id": inv.get("invoice_id") or inv.get("id") or "",
        "status": str(inv.get("status") or "").lower(),
        "amount": inv.get("amount") or inv.get("paid_amount") or 0,
        "asset": (inv.get("asset") or "USDT").upper(),
        "payload": inv.get("payload") or data.get("payload") or "",
    }


@app.post("/api/v1/cryptobot/webhook")
async def cryptobot_webhook(request: Request):
    raw = await request.body()
    try:
        data = json.loads(raw.decode("utf-8"))
    except Exception:
        data = {}

    inv = _extract_invoice(data)
    if inv["status"] not in ("paid", "finished", "success"):
        return {"ok": True}

    try:
        user_id = int(inv.get("payload") or 0)
    except Exception:
        return {"ok": True}

    amount = float(inv.get("amount") or 0.0)

    with db() as s:
        u = ensure_user(s, user_id)
        t = Topup(
            user_id=u.id,
            provider="cryptobot",
            invoice_id=str(inv.get("invoice_id", "")),
            amount_usd=amount,
            currency="USD",
            status="paid",
            applied=False,
            pay_url=None,
        )
        s.add(t)
        s.commit()

    return {"ok": True}
