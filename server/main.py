# -*- coding: utf-8 -*-
import os, time, json, logging, re
from typing import Dict, Any, Optional, List
from pathlib import Path

from fastapi import FastAPI, HTTPException, Body, Request, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import httpx
from sqlalchemy.orm import Session
from sqlalchemy import func

from .db import (
    Base, engine, SessionLocal,
    User, Service, Favorite, Order, Topup,
    Referral, RefBonus, stable_seq
)

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

# CryptoBot
CRYPTOBOT_API_KEY  = os.getenv("CRYPTOBOT_API_KEY") or os.getenv("CRYPTOPBOT_API_KEY") or ""
CRYPTOBOT_BASE     = os.getenv("CRYPTOBOT_BASE") or os.getenv("CRYPTOPBOT_BASE") or "https://pay.crypt.bot/api"
CRYPTOBOT_MIN_TOPUP_USD = float(os.getenv("CRYPTOBOT_MIN_TOPUP_USD", os.getenv("CRYPTOPBOT_MIN_TOPUP_USD", "0.10")))

FX_CACHE_TTL = int(os.getenv("FX_CACHE_TTL", "600"))

# Для формирования реф-ссылки: https://t.me/<bot>?start=ref_<SEQ>
BOT_USERNAME = (os.getenv("BOT_USERNAME") or "slovekinzshop_bot").lstrip("@")

NETWORKS = ["telegram", "tiktok", "instagram", "youtube", "facebook"]
DISPLAY = {
    "telegram":  {"id": "telegram",  "name": "Telegram",  "desc": "подписчики, просмотры"},
    "tiktok":    {"id": "tiktok",    "name": "TikTok",    "desc": "просмотры, фолловеры"},
    "instagram": {"id": "instagram", "name": "Instagram", "desc": "подписчики, лайки"},
    "youtube":   {"id": "youtube",   "name": "YouTube",   "desc": "просмотры, подписки"},
    "facebook":  {"id": "facebook",  "name": "Facebook",  "desc": "лайки, подписчики"},
}

# --- app ---
app = FastAPI(title="SMMShop API", version="2.2")
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins or ["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

_client = httpx.AsyncClient(timeout=30.0)

# --- FX cache ---
_fx_cache: Dict[str, Dict[str, Any]] = {}
def _fx_get(k: str) -> Optional[float]:
    obj = _fx_cache.get(k)
    if not obj: return None
    if time.time() - obj.get("t", 0) > FX_CACHE_TTL: return None
    return float(obj.get("v", 0))
def _fx_put(k: str, v: float) -> None:
    _fx_cache[k] = {"v": float(v), "t": time.time()}
async def fx_usd_rub() -> float:
    cached = _fx_get("USD_RUB")
    if cached: return cached
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
    _fx_put("USD_RUB", 100.0); return 100.0

def client_rate_view_per_1k(base_usd_per_1k: float, fx: float) -> float:
    usd_client = float(base_usd_per_1k) * MARKUP_MULTIPLIER
    return usd_client * fx if CURRENCY == "RUB" else usd_client

def db() -> Session: return SessionLocal()

def ensure_user(db: Session, tg_id: int, nick: Optional[str]=None) -> User:
    u = db.query(User).filter(User.tg_id==tg_id).one_or_none()
    if u:
        if nick and not u.nick: u.nick = nick
        u.last_seen_at = int(time.time()); db.commit(); return u
    u = User(tg_id=tg_id, seq=stable_seq(tg_id), nick=nick, currency=CURRENCY,
             balance=0.0, last_seen_at=int(time.time()))
    db.add(u); db.commit(); db.refresh(u)
    for sid in (2127, 2453, 2454): db.merge(Favorite(user_id=u.id, service_id=sid))
    db.commit(); return u

# ---- helpers (referral) ----
REF_THRESHOLD = 50  # после 50 депозитных рефов ставка 20%

def ref_rate_for(session: Session, inviter_id: int) -> int:
    q = session.query(func.count(func.distinct(Referral.user_id)))\
        .join(Topup, Topup.user_id == Referral.user_id)\
        .filter(Referral.parent_id == inviter_id, Topup.status == "paid")
    cnt = int(q.scalar() or 0)
    return 20 if cnt >= REF_THRESHOLD else 10

def ref_link_for(user: User) -> str:
    return f"https://t.me/{BOT_USERNAME}?start=ref_{user.seq}"

# --- schemas ---
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

class RefBindIn(BaseModel):
    user_id: int
    code: str  # "ref_12345" / "ref12345" / "12345"

# --- VEXBOOST sync ---
async def vex_services_raw() -> List[Dict[str, Any]]:
    if not VEX_KEY: raise HTTPException(500, "VEXBOOST_KEY not set")
    url = f"{API_BASE}?action=services&key={VEX_KEY}"
    r = await _client.get(url); r.raise_for_status()
    data = r.json()
    if not isinstance(data, list): raise HTTPException(502, "Unexpected services payload")
    return data

def _detect_network(name: str, category: str) -> Optional[str]:
    t = f"{name} {category}".lower()
    if "telegram" in t or "tg " in t: return "telegram"
    if "tiktok" in t or "tik tok" in t: return "tiktok"
    if "instagram" in t or "insta" in t or "ig " in t: return "instagram"
    if "youtube" in t or "you tube" in t or "yt " in t: return "youtube"
    if "facebook" in t or "fb " in t or "meta" in t: return "facebook"
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
                s.add(Service(
                    id=sid, network=net, name=name, type=type_,
                    min=min_, max=max_,
                    rate_client_1000=rate_view, currency=CURRENCY,
                    description=cat, active=True
                ))
            else:
                obj.network = net; obj.name = name; obj.type = type_
                obj.min = min_; obj.max = max_; obj.rate_client_1000 = rate_view
                obj.currency = CURRENCY; obj.description = cat; obj.active = True
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
    try: await _client.aclose()
    except Exception: pass

# --- misc ---
@app.get("/api/v1/ping")
async def ping(): return {"ok": True}

# ===== USERS / REGISTER =====
@app.get("/api/v1/user/exists")
async def api_user_exists(user_id: int = Query(...)):
    with db() as s:
        u = s.query(User).filter(User.tg_id == user_id).one_or_none()
        if not u: raise HTTPException(404, "not_found")
        return {"exists": True, "has_nick": bool(u.nick), "nick": u.nick, "seq": u.seq}

@app.get("/api/v1/user", response_model=UserOut)
async def api_user(user_id: int = Query(...), consume_topup: int = 0,
                   nick: Optional[str] = None, autocreate: int = 1):
    with db() as s:
        u = s.query(User).filter(User.tg_id == user_id).one_or_none()
        if not u:
            if not autocreate: raise HTTPException(404, "user_not_found")
            u = ensure_user(s, user_id, nick=nick)
        else:
            if nick and not u.nick: u.nick = nick; s.commit()

        delta = 0.0
        if consume_topup:
            pays = s.query(Topup).filter(
                Topup.user_id == u.id, Topup.status=="paid", Topup.applied==False
            ).all()
            for t in pays:
                delta += float(t.amount_usd or 0.0)
                t.applied = True
            if delta > 0:
                add = delta if CURRENCY=="USD" else (delta * (await fx_usd_rub()))
                u.balance = float(u.balance or 0.0) + round(add, 2)
            s.commit()
        return UserOut(seq=u.seq, nick=u.nick, currency=u.currency,
                       balance=float(u.balance or 0.0),
                       topup_delta=round(delta, 6), topup_currency="USD")

NICK_RE = re.compile(r"^[A-Za-z0-9_]{3,24}$")
def _validate_nick(n: str) -> str:
    n = (n or "").strip()
    if not NICK_RE.fullmatch(n):
        raise HTTPException(400, "Ник 3–24 символа: латиница, цифры, _")
    return n

@app.post("/api/v1/register")
async def api_register(body: RegisterIn):
    nick = _validate_nick(body.nick)
    with db() as s:
        taken = s.query(User.id).filter(func.lower(User.nick) == nick.lower()).first()
        if taken: raise HTTPException(409, "Ник уже занят")

        u = s.query(User).filter(User.tg_id == body.user_id).one_or_none()
        if not u:
            u = User(tg_id=body.user_id, seq=stable_seq(body.user_id),
                     nick=None, currency=CURRENCY, balance=0.0,
                     last_seen_at=int(time.time()))
            s.add(u); s.commit(); s.refresh(u)
            for sid in (2127, 2453, 2454): s.merge(Favorite(user_id=u.id, service_id=sid))
        if u.nick: raise HTTPException(409, "Профиль уже создан")

        u.nick = nick; u.updated_at = int(time.time()); s.commit()
        return {"ok": True, "seq": u.seq, "nick": u.nick}

# ===== REFERRALS =====

@app.post("/api/v1/referrals/bind")
async def api_ref_bind(body: RefBindIn):
    """Привязка реферала по коду вида ref_12345 / 12345 (SEQ пригласившего)."""
    m = re.search(r"(\d+)$", body.code or "")
    if not m: raise HTTPException(400, "bad_code")
    seq = int(m.group(1))

    with db() as s:
        invited = ensure_user(s, body.user_id)
        # уже привязан — ничего не делаем
        existing = s.query(Referral).filter(Referral.user_id == invited.id).one_or_none()
        if existing: return {"ok": True, "already": True}

        inviter = s.query(User).filter(User.seq == seq).one_or_none()
        if not inviter or inviter.id == invited.id:
            raise HTTPException(404, "inviter_not_found")

        s.add(Referral(user_id=invited.id, parent_id=inviter.id))
        s.commit()
        return {"ok": True, "inviter_seq": inviter.seq, "inviter_nick": inviter.nick}

@app.get("/api/v1/referrals/stats")
async def api_ref_stats(user_id: int = Query(...)):
    with db() as s:
        u = ensure_user(s, user_id)
        link = ref_link_for(u)
        rate = ref_rate_for(s, u.id)

        total = int(s.query(func.count(Referral.user_id)).filter(Referral.parent_id==u.id).scalar() or 0)
        with_deposit = int(
            s.query(func.count(func.distinct(Referral.user_id)))
             .join(Topup, Topup.user_id == Referral.user_id)
             .filter(Referral.parent_id==u.id, Topup.status=="paid")
             .scalar() or 0
        )
        earned_rows = s.query(func.coalesce(func.sum(RefBonus.amount_credit), 0.0))\
                       .filter(RefBonus.ref_user_id == u.id).one()
        earned_total = float(earned_rows[0] or 0.0)

        last = s.query(RefBonus, User.seq)\
                .join(User, User.id == RefBonus.invited_user_id)\
                .filter(RefBonus.ref_user_id == u.id)\
                .order_by(RefBonus.id.desc()).limit(10).all()

        last_view = [{
            "from_seq": seq,
            "rate": rb.rate_percent,
            "amount_credit": float(rb.amount_credit or 0.0),
            "currency": rb.currency,
            "amount_usd": float(rb.amount_usd or 0.0),
            "ts": rb.created_at
        } for rb, seq in last]

        return {
            "user_seq": u.seq,
            "link": link,
            "rate_percent": rate,
            "threshold": REF_THRESHOLD,
            "invited_total": total,
            "invited_with_deposit": with_deposit,
            "earned_total": round(earned_total, 2),
            "currency": CURRENCY,
            "last_bonuses": last_view,
        }

# ===== SERVICES =====
@app.get("/api/v1/services")
async def api_services():
    with db() as s:
        groups = {k: {**DISPLAY[k], "count": 0} for k in DISPLAY}
        for it in s.query(Service).filter(Service.active==True).all():  # noqa: E712
            if it.network in groups: groups[it.network]["count"] += 1
        return [groups[k] for k in ["telegram","tiktok","instagram","youtube","facebook"]]

@app.get("/api/v1/services/{network}")
async def api_services_by_network(network: str):
    if network not in NETWORKS: raise HTTPException(404, "Unknown network")
    with db() as s:
        items = (s.query(Service)
                 .filter(Service.network==network, Service.active==True)  # noqa: E712
                 .order_by(Service.id.asc()).all())
        return [{
            "service": it.id, "network": it.network, "name": it.name, "type": it.type,
            "min": it.min, "max": it.max, "rate_client_1000": float(it.rate_client_1000 or 0.0),
            "currency": it.currency or CURRENCY, "description": it.description or ""
        } for it in items]

# ===== FAVORITES =====
@app.get("/api/v1/favorites")
async def fav_list(user_id: int = Query(...)):
    with db() as s:
        u = ensure_user(s, user_id)
        rows = (s.query(Service).join(Favorite, Favorite.service_id==Service.id)
                .filter(Favorite.user_id==u.id).all())
        return [{
            "service": it.id, "network": it.network, "name": it.name, "type": it.type,
            "min": it.min, "max": it.max, "rate_client_1000": float(it.rate_client_1000 or 0.0),
            "currency": it.currency or CURRENCY, "description": it.description or ""
        } for it in rows]

class FavIn(BaseModel):
    user_id: int; service_id: int

@app.post("/api/v1/favorites", status_code=204)
async def fav_add(body: FavIn):
    with db() as s:
        u = ensure_user(s, body.user_id)
        s.merge(Favorite(user_id=u.id, service_id=int(body.service_id))); s.commit()

@app.delete("/api/v1/favorites/{service_id}", status_code=204)
async def fav_del(service_id: int, user_id: int = Query(...)):
    with db() as s:
        u = ensure_user(s, user_id)
        s.query(Favorite).filter(Favorite.user_id==u.id, Favorite.service_id==service_id).delete(); s.commit()

# ===== ORDER =====
@app.post("/api/v1/order/create")
async def api_order_create(body: CreateOrderIn):
    with db() as s:
        u = ensure_user(s, body.user_id)
        svc = s.get(Service, int(body.service))
        if not svc: raise HTTPException(404, "service not found")
        if body.quantity < (svc.min or 0) or body.quantity > (svc.max or 0):
            raise HTTPException(400, f"Количество должно быть от {svc.min} до {svc.max}")
        cost = round(float(svc.rate_client_1000 or 0.0) * body.quantity / 1000.0, 2)
        if float(u.balance or 0.0) < cost: raise HTTPException(402, "Недостаточно средств")

        try:
            qp = httpx.QueryParams({
                "action":"add","service":svc.id,"link":body.link,"quantity":int(body.quantity),"key":VEX_KEY
            }); url = f"{API_BASE}?{qp}"
            r = await _client.get(url); supplier_order = int(r.json().get("order"))
        except Exception as e:
            raise HTTPException(502, f"Supplier error: {e}")

        u.balance = float(u.balance or 0.0) - cost
        o = Order(user_id=u.id, service_id=svc.id, quantity=int(body.quantity),
                  link=body.link, cost=cost, currency=svc.currency or CURRENCY,
                  status="Awaiting", provider_id=str(supplier_order))
        s.add(o); s.commit(); s.refresh(o)
        return {"order_id": o.id, "cost": cost, "currency": o.currency, "status": o.status}

# ===== PAYMENTS =====
@app.post("/api/v1/pay/invoice")
async def api_pay_invoice(payload: Dict[str, Any] = Body(...)):
    if not CRYPTOBOT_API_KEY: return {"error":"CryptoBot not configured"}, 501
    amount = float(payload.get("amount_usd") or 0.0)
    if amount < CRYPTOBOT_MIN_TOPUP_USD:
        raise HTTPException(400, f"Минимальная сумма — {CRYPTOBOT_MIN_TOPUP_USD} USDT")
    user_id = int(payload.get("user_id") or 0)
    if user_id <= 0: raise HTTPException(400, "user_id required")

    link = f"{CRYPTOBOT_BASE}/createInvoice"
    headers = {"Content-Type":"application/json","Crypto-Pay-API-Token":CRYPTOBOT_API_KEY}
    body = {"asset":"USDT","amount":round(amount,2),"payload":str(user_id),"description":"SMMShop topup"}
    async with httpx.AsyncClient(timeout=15.0) as c:
        r = await c.post(link, headers=headers, json=body); js = r.json()

    if isinstance(js.get("result"), dict) and js["result"].get("pay_url"):
        pay_url = js["result"]["pay_url"]; invoice_id = js["result"].get("invoice_id","")
    elif isinstance(js.get("invoice"), dict) and js["invoice"].get("pay_url"):
        pay_url = js["invoice"]["pay_url"]; invoice_id = js["invoice"].get("invoice_id","")
    else:
        raise HTTPException(502, f"CryptoBot error: {js}")

    with db() as s:
        u = ensure_user(s, user_id)
        t = Topup(user_id=u.id, provider="cryptobot", invoice_id=str(invoice_id),
                  amount_usd=amount, currency="USD", status="created",
                  applied=False, pay_url=pay_url)
        s.add(t); s.commit()
    return {"pay_url": pay_url}

def _extract_invoice(data: Dict[str, Any]) -> Dict[str, Any]:
    if isinstance(data.get("invoice"), dict): inv = data["invoice"]
    elif isinstance(data.get("result"), dict) and isinstance(data["result"].get("invoice"), dict): inv = data["result"]["invoice"]
    elif isinstance(data.get("result"), dict): inv = data["result"]
    elif isinstance(data.get("payload"), dict) and ("status" in data["payload"]): inv = data["payload"]
    else: inv = {}
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
    try: data = json.loads(raw.decode("utf-8"))
    except Exception: data = {}
    inv = _extract_invoice(data)
    if inv["status"] not in ("paid","finished","success"): return {"ok": True}

    try: user_id = int(inv.get("payload") or 0)
    except Exception: return {"ok": True}
    amount = float(inv.get("amount") or 0.0)

    with db() as s:
        u = ensure_user(s, user_id)

        # защита от дублей по invoice_id
        if inv.get("invoice_id"):
            exists = s.query(Topup.id).filter(
                Topup.invoice_id == str(inv["invoice_id"]), Topup.status == "paid"
            ).first()
            if exists: return {"ok": True}

        t = Topup(user_id=u.id, provider="cryptobot",
                  invoice_id=str(inv.get("invoice_id","")),
                  amount_usd=amount, currency="USD",
                  status="paid", applied=False, pay_url=None)
        s.add(t); s.commit(); s.refresh(t)

        # начисление реф-бонуса
        ref = s.query(Referral).filter(Referral.user_id == u.id).one_or_none()
        if ref:
            rate = ref_rate_for(s, ref.parent_id)  # 10% / 20%
            usd_bonus = amount * (rate / 100.0)
            if CURRENCY == "USD":
                credit = usd_bonus
            else:
                credit = usd_bonus * (await fx_usd_rub())

            # не задваивать
            if not s.query(RefBonus.id).filter(RefBonus.topup_id == t.id).first():
                s.add(RefBonus(
                    topup_id=t.id,
                    ref_user_id=ref.parent_id,
                    invited_user_id=u.id,
                    rate_percent=rate,
                    amount_usd=usd_bonus,
                    amount_credit=credit,
                    currency=CURRENCY
                ))
                # зачисляем на баланс пригласившему
                parent = s.get(User, ref.parent_id)
                parent.balance = float(parent.balance or 0.0) + float(credit)
                s.commit()

    return {"ok": True}
