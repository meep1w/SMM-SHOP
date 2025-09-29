# -*- coding: utf-8 -*-
import os, time, json, logging
from typing import Dict, Any, Optional, List, Tuple, Set
from pathlib import Path

from fastapi import FastAPI, HTTPException, Body, Request, Query, Header
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import httpx
from sqlalchemy.orm import Session
from sqlalchemy import func, distinct

from .db import (
    Base, engine, SessionLocal,
    User, Service, Favorite, Order, Topup,
    RefLink, RefBind, RefReward,
    PromoCode, PromoActivation,
    stable_seq, now_ts,
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

ADMIN_TOKEN = (os.getenv("ADMIN_TOKEN", "") or "").strip()

# CryptoBot (учтены возможные опечатки)
CRYPTOBOT_API_KEY  = os.getenv("CRYPTOBOT_API_KEY") or os.getenv("CRYPTOPBOT_API_KEY") or ""
CRYPTOBOT_BASE     = os.getenv("CRYPTOBOT_BASE") or os.getenv("CRYPTOPBOT_BASE") or "https://pay.crypt.bot/api"
CRYPTOBOT_MIN_TOPUP_USD = float(os.getenv("CRYPTOBOT_MIN_TOPUP_USD", os.getenv("CRYPTOPBOT_MIN_TOPUP_USD", "0.10")))

# Referral
BOT_USERNAME = (os.getenv("BOT_USERNAME", "slovekinzshop_bot") or "slovekinzshop_bot").lstrip("@")
REF_BASE_RATE = float(os.getenv("REF_BASE_RATE", "0.10"))   # 10%
REF_TIER_RATE = float(os.getenv("REF_TIER_RATE", "0.20"))   # 20%
REF_TIER_THRESHOLD = int(os.getenv("REF_TIER_THRESHOLD", "50"))

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
app = FastAPI(title="SMMShop API", version="2.3")
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins or ["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- no-cache middleware (отключаем кэш для всех /api/*) ---
@app.middleware("http")
async def _no_cache_middleware(request: Request, call_next):
    resp = await call_next(request)
    if request.url.path.startswith("/api/"):
        resp.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0, private"
        resp.headers["Pragma"] = "no-cache"
        resp.headers["Expires"] = "0"
    return resp

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


def db() -> Session:
    return SessionLocal()


# ========== Pricing helpers (персональная наценка) ==========
def user_markup(u: Optional[User]) -> float:
    """
    Возвращает персональную наценку пользователя, если задана,
    иначе дефолт из ENV.
    """
    try:
        m = float(getattr(u, "markup_override", None) or 0.0)
        if m > 0:
            return m
    except Exception:
        pass
    return MARKUP_MULTIPLIER


async def rate_per_1k_for_user(svc: Service, u: Optional[User]) -> float:
    """
    Возвращает клиентскую цену за 1000 с учётом персональной наценки.
    В БД хранится цена под дефолтной наценкой. Восстанавливаем base_usd и
    применяем персональную.
    """
    current_view = float(svc.rate_client_1000 or 0.0)
    if current_view <= 0:
        return 0.0
    mul = user_markup(u)

    if CURRENCY == "USD":
        # rate_client_1000 = base * MARKUP_MULTIPLIER
        base_usd = current_view / max(MARKUP_MULTIPLIER, 1e-9)
        return base_usd * mul
    else:
        fx = await fx_usd_rub()
        # rate_client_1000(RUB) = base * MARKUP_MULTIPLIER * fx
        base_usd = current_view / max(MARKUP_MULTIPLIER * fx, 1e-9)
        return base_usd * mul * fx


# ===== ensure_user() =====
def ensure_user(s: Session, tg_id: int, nick: Optional[str] = None) -> User:
    # robust: без one_or_none()
    u = (
        s.query(User)
        .filter(User.tg_id == tg_id)
        .order_by(User.id.desc())
        .first()
    )
    if u:
        if nick and not u.nick:
            u.nick = nick
        u.last_seen_at = now_ts()
        s.commit()

        # дефолтные избранные
        fav_cnt = s.query(Favorite).filter(Favorite.user_id == u.id).count()
        if fav_cnt == 0:
            for sid in (2127, 2453, 2454):
                s.merge(Favorite(user_id=u.id, service_id=sid))
            s.commit()
        return u

    # создаём
    u = User(
        tg_id=tg_id,
        seq=stable_seq(tg_id),
        nick=nick,
        currency=CURRENCY,
        balance=0.0,
        last_seen_at=now_ts(),
    )
    s.add(u)
    s.commit()
    s.refresh(u)

    for sid in (2127, 2453, 2454):
        s.merge(Favorite(user_id=u.id, service_id=sid))
    s.commit()
    return u


# --- схемы ---
class UserOut(BaseModel):
    seq: int
    nick: Optional[str] = None
    currency: str = CURRENCY
    balance: float = 0.0
    topup_delta: float = 0.0
    topup_currency: str = "USD"
    markup: Optional[float] = None     # персональная наценка пользователя (если есть)


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
    code: str


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
    if "telegram" in t or " tg " in t or t.startswith("tg "):
        return "telegram"
    if "tiktok" in t or "tik tok" in t:
        return "tiktok"
    if "instagram" in t or " insta" in t or " ig " in t:
        return "instagram"
    if "youtube" in t or "you tube" in t or " yt " in t:
        return "youtube"
    if "facebook" in t or " fb " in t or " meta " in t:
        return "facebook"

    # всё прочее скрываем из каталога
    if "twitter" in t or "x.com" in t or " x " in t or "tweet" in t or "retweet" in t:
        return None
    return None


def client_rate_view_per_1k(base_usd_per_1k: float, fx: float) -> float:
    usd_client = float(base_usd_per_1k) * MARKUP_MULTIPLIER
    if CURRENCY == "RUB":
        return usd_client * fx
    return usd_client


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
            net = _detect_network(name, cat)
            is_active = True
            if not net:
                net = "other"
                is_active = False

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
                    active=is_active,
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
                obj.active = is_active
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


# --- helpers (ref) ---
def _ensure_ref_link(s: Session, u: User) -> RefLink:
    rl = s.query(RefLink).filter(RefLink.owner_user_id == u.id).one_or_none()
    if rl:
        return rl
    import secrets
    for _ in range(10):
        code = secrets.token_urlsafe(4).replace("_", "").replace("-", "")[:8].lower()
        exists = s.query(RefLink.id).filter(RefLink.code == code).first()
        if not exists:
            rl = RefLink(owner_user_id=u.id, code=code, created_at=now_ts())
            s.add(rl)
            s.commit()
            s.refresh(rl)
            return rl
    raise HTTPException(500, "cannot_generate_ref_code")


def _current_rate_for_owner(s: Session, owner_user_id: int) -> float:
    # сколько рефералов с депозитом у владельца
    sub = (
        s.query(distinct(Topup.user_id))
        .join(RefBind, RefBind.user_id == Topup.user_id)
        .filter(RefBind.ref_owner_user_id == owner_user_id, Topup.status == "paid")
        .subquery()
    )
    cnt = s.query(func.count()).select_from(sub).scalar() or 0
    return REF_TIER_RATE if cnt >= REF_TIER_THRESHOLD else REF_BASE_RATE


# ============== PROMO: helpers & endpoints ==============
def _norm_code(code: Optional[str]) -> str:
    return (code or "").strip().upper()


def _promo_active(pc: PromoCode) -> bool:
    if not pc.is_active:
        return False
    now = now_ts()
    if pc.valid_from and now < int(pc.valid_from):
        return False
    if pc.expires_at and now > int(pc.expires_at):
        return False
    return True


def _promo_counters(s: Session, pc: PromoCode, user_id: int) -> Tuple[int, int]:
    total = s.query(func.count(PromoActivation.id)).filter(PromoActivation.code_id == pc.id).scalar() or 0
    per_user = (
        s.query(func.count(PromoActivation.id))
        .filter(PromoActivation.code_id == pc.id, PromoActivation.user_id == user_id)
        .scalar()
        or 0
    )
    return total, per_user


def _promo_can_use(s: Session, pc: PromoCode, user_id: int) -> Tuple[bool, str]:
    if not _promo_active(pc):
        return False, "promo_not_active"
    total, per_user = _promo_counters(s, pc, user_id)
    if (pc.max_activations or 0) > 0 and total >= int(pc.max_activations or 0):
        return False, "promo_limit_reached"
    if (pc.per_user_limit or 0) > 0 and per_user >= int(pc.per_user_limit or 0):
        return False, "promo_user_limit_reached"
    return True, ""


async def _apply_markup_promo(s: Session, u: User, pc: PromoCode) -> Dict[str, Any]:
    if pc.type != "markup" or not pc.markup_value or pc.markup_value <= 0:
        raise HTTPException(400, "invalid_promo_type")
    ok, reason = _promo_can_use(s, pc, u.id)
    if not ok:
        raise HTTPException(409, reason)
    u.markup_override = float(pc.markup_value)
    s.add(PromoActivation(code_id=pc.id, user_id=u.id, amount_credit=None, discount_applied=None, created_at=now_ts()))
    s.commit()
    return {"ok": True, "kind": "markup", "markup": u.markup_override}


async def _apply_balance_promo(s: Session, u: User, pc: PromoCode) -> Dict[str, Any]:
    if pc.type != "balance" or not pc.balance_usd or pc.balance_usd <= 0:
        raise HTTPException(400, "invalid_promo_type")
    ok, reason = _promo_can_use(s, pc, u.id)
    if not ok:
        raise HTTPException(409, reason)

    usd = float(pc.balance_usd or 0.0)
    if CURRENCY == "USD":
        add = round(usd, 2)
    else:
        fx = await fx_usd_rub()
        add = round(usd * fx, 2)

    # кредитуем сразу (без ожидания consume_topup)
    u.balance = float(u.balance or 0.0) + add
    t = Topup(
        user_id=u.id,
        provider="promo",
        invoice_id=str(pc.code),
        amount_usd=usd,
        currency="USD",
        status="paid",
        applied=True,
        pay_url=None,
        created_at=now_ts(),
    )
    s.add(t)
    s.add(PromoActivation(code_id=pc.id, user_id=u.id, amount_credit=add, discount_applied=None, created_at=now_ts()))
    s.commit()
    return {"ok": True, "kind": "balance", "added": add, "currency": CURRENCY}


def _check_discount_promo(s: Session, u: User, pc: PromoCode) -> Dict[str, Any]:
    if pc.type != "discount" or pc.discount_percent is None or pc.discount_percent <= 0:
        raise HTTPException(400, "invalid_promo_type")
    ok, reason = _promo_can_use(s, pc, u.id)
    if not ok:
        raise HTTPException(409, reason)
    pct = float(pc.discount_percent)
    if pct >= 1.0:
        pct = pct / 100.0  # на случай ввода "15" вместо "0.15"
    pct = max(0.0, min(0.95, pct))  # защитим от 100%
    return {"ok": True, "kind": "discount", "percent": pct}


class PromoApplyIn(BaseModel):
    user_id: int
    code: str


@app.post("/api/v1/promo/apply")
async def promo_apply(body: PromoApplyIn):
    """
    Применение промокода в профиле.
    Поддерживает:
      - type=markup  — навсегда: устанавливает персональную наценку пользователю
      - type=balance — одноразово: начисляет баланс (в USD-эквив., конвертируем в валюту магазина)
    Для скидок используйте /promo/check и передачу promo_code в /order/create.
    """
    code = _norm_code(body.code)
    if not code:
        raise HTTPException(400, "empty_code")

    with db() as s:
        u = ensure_user(s, body.user_id)
        pc = s.query(PromoCode).filter(func.upper(PromoCode.code) == code).one_or_none()
        if not pc:
            raise HTTPException(404, "promo_not_found")

        if pc.type == "markup":
            return await _apply_markup_promo(s, u, pc)
        elif pc.type == "balance":
            return await _apply_balance_promo(s, u, pc)
        elif pc.type == "discount":
            # сообщаем, что этот ввод — на странице заказа
            data = _check_discount_promo(s, u, pc)
            data["hint"] = "use_in_order"
            return data
        else:
            raise HTTPException(400, "unknown_promo_type")


@app.get("/api/v1/promo/check")
async def promo_check(user_id: int = Query(...), code: str = Query(...)):
    """
    Проверка скидочного промокода перед оформлением заказа.
    Возвращает percent (0..1).
    """
    code = _norm_code(code)
    if not code:
        raise HTTPException(400, "empty_code")
    with db() as s:
        u = ensure_user(s, user_id)
        pc = s.query(PromoCode).filter(func.upper(PromoCode.code) == code).one_or_none()
        if not pc:
            raise HTTPException(404, "promo_not_found")
        if pc.type != "discount":
            raise HTTPException(400, "not_discount_code")
        return _check_discount_promo(s, u, pc)


# ---- Admin create promo ----
class PromoAdminCreateIn(BaseModel):
    code: str
    type: str  # markup | balance | discount
    markup_value: Optional[float] = None
    balance_usd: Optional[float] = None
    discount_percent: Optional[float] = None
    max_activations: int = 1
    per_user_limit: int = 1
    valid_from: Optional[int] = None
    expires_at: Optional[int] = None
    is_active: bool = True
    notes: Optional[str] = None


@app.post("/api/v1/promo/admin/create")
async def promo_admin_create(
    body: PromoAdminCreateIn,
    authorization: Optional[str] = Header(None)
):
    if not ADMIN_TOKEN:
        raise HTTPException(403, "admin_token_not_set")
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(401, "missing_bearer")
    token = authorization.split(" ", 1)[1].strip()
    if token != ADMIN_TOKEN:
        raise HTTPException(403, "forbidden")

    code = _norm_code(body.code)
    if not code:
        raise HTTPException(400, "empty_code")

    if body.type not in ("markup", "balance", "discount"):
        raise HTTPException(400, "invalid_type")

    with db() as s:
        exists = s.query(PromoCode.id).filter(func.upper(PromoCode.code) == code).first()
        if exists:
            raise HTTPException(409, "code_exists")
        pc = PromoCode(
            code=code,
            type=body.type,
            markup_value=body.markup_value if body.type == "markup" else None,
            balance_usd=body.balance_usd if body.type == "balance" else None,
            discount_percent=body.discount_percent if body.type == "discount" else None,
            max_activations=int(body.max_activations or 0),
            per_user_limit=int(body.per_user_limit or 0),
            valid_from=body.valid_from,
            expires_at=body.expires_at,
            is_active=bool(body.is_active),
            notes=body.notes,
            created_at=now_ts(),
        )
        s.add(pc)
        s.commit()
        s.refresh(pc)
        return {"ok": True, "id": pc.id, "code": pc.code, "type": pc.type}


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
        # robust lookup: tg_id -> seq
        u = (
            s.query(User)
            .filter(User.tg_id == user_id)
            .order_by(User.id.desc())
            .first()
        )
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
            if pays:
                # курс для конвертации в валюту магазина
                fx = await fx_usd_rub()
                for t in pays:
                    usd = float(t.amount_usd or 0.0)
                    add = usd if CURRENCY == "USD" else (usd * fx)
                    add = round(add, 2)
                    delta += usd
                    t.applied = True
                    u.balance = float(u.balance or 0.0) + add

                    # реферальная награда (если есть привязка)
                    rb = s.query(RefBind).filter(RefBind.user_id == u.id).one_or_none()
                    if rb:
                        owner = s.get(User, rb.ref_owner_user_id)
                        if owner:
                            rate = _current_rate_for_owner(s, owner.id)
                            reward_amount = usd if CURRENCY == "USD" else (usd * fx)
                            reward_amount = round(reward_amount * rate, 2)

                            # защита от дублей на тот же topup
                            exists = s.query(RefReward.id).filter(RefReward.topup_id == t.id).first()
                            if not exists and reward_amount > 0:
                                owner.balance = float(owner.balance or 0.0) + reward_amount
                                rr = RefReward(
                                    to_user_id=owner.id,
                                    from_user_id=u.id,
                                    topup_id=t.id,
                                    amount_credit=reward_amount,
                                    currency=CURRENCY,
                                    rate=rate,
                                    created_at=now_ts(),
                                )
                                s.add(rr)
                s.commit()

        return UserOut(
            seq=u.seq,
            nick=u.nick,
            currency=u.currency,
            balance=float(u.balance or 0.0),
            topup_delta=round(delta, 6),
            topup_currency="USD",
            markup=float(u.markup_override) if u.markup_override else None,
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
        u = (
            s.query(User)
            .filter(User.tg_id == body.user_id)
            .order_by(User.id.desc())
            .first()
        )
        if not u:
            u = ensure_user(s, body.user_id, nick=nick)
        else:
            if u.nick:
                raise HTTPException(409, "Профиль уже создан")
            u.nick = nick
            s.commit()
        return {"ok": True, "seq": u.seq, "nick": u.nick}


# Привязка по реф.коду (бот может вызывать при /start ref_xxx)
@app.post("/api/v1/referrals/bind")
async def api_referrals_bind(body: RefBindIn):
    code = (body.code or "").strip().lower()
    if not code:
        raise HTTPException(400, "empty_code")
    with db() as s:
        u = ensure_user(s, body.user_id)
        # уже привязан — игнор
        bound = s.query(RefBind).filter(RefBind.user_id == u.id).one_or_none()
        if bound:
            return {"ok": True, "already": True}

        rl = s.query(RefLink).filter(RefLink.code == code).one_or_none()
        if not rl:
            raise HTTPException(404, "code_not_found")

        if rl.owner_user_id == u.id:
            raise HTTPException(400, "self_ref_forbidden")

        rb = RefBind(user_id=u.id, ref_owner_user_id=rl.owner_user_id, code=code, created_at=now_ts())
        s.add(rb)
        s.commit()
        return {"ok": True}


# Реф. статистика
@app.get("/api/v1/referrals/stats")
async def api_referrals_stats(user_id: int = Query(...)):
    with db() as s:
        # tg_id -> seq
        u = (
            s.query(User)
            .filter(User.tg_id == user_id)
            .order_by(User.id.desc())
            .first()
        )
        if not u:
            u = s.query(User).filter(User.seq == user_id).order_by(User.id.desc()).first()
        if not u:
            # создадим минимальный профиль, чтобы отдать ссылку
            u = ensure_user(s, tg_id=user_id)

        rl = _ensure_ref_link(s, u)

        # приглашено всего
        invited_total = s.query(func.count(RefBind.id)).filter(RefBind.ref_owner_user_id == u.id).scalar() or 0

        # рефералов с депозитом (distinct по user_id в paid topups)
        sub = (
            s.query(distinct(Topup.user_id))
            .join(RefBind, RefBind.user_id == Topup.user_id)
            .filter(RefBind.ref_owner_user_id == u.id, Topup.status == "paid")
            .subquery()
        )
        invited_with_deposit = s.query(func.count()).select_from(sub).scalar() or 0

        # начислено всего
        earned_total = s.query(func.coalesce(func.sum(RefReward.amount_credit), 0.0))\
                        .filter(RefReward.to_user_id == u.id).scalar() or 0.0

        # последниe 20 бонусов
        rewards = (
            s.query(RefReward)
            .filter(RefReward.to_user_id == u.id)
            .order_by(RefReward.id.desc())
            .limit(20).all()
        )

        # текущая ставка по порогу
        rate = REF_TIER_RATE if invited_with_deposit >= REF_TIER_THRESHOLD else REF_BASE_RATE
        rate_percent = int(round(rate * 100))
        currency = u.currency or CURRENCY

        invite_link = f"https://t.me/{BOT_USERNAME}?start=ref_{rl.code}"

        return {
            "invite_link": invite_link,
            "rate": rate,
            "rate_percent": rate_percent,
            "tier": "tier20" if rate >= REF_TIER_RATE else "base",
            "invited_total": invited_total,
            "invited_with_deposit": invited_with_deposit,
            "earned_total": round(float(earned_total), 2),
            "earned_currency": currency,
            "threshold": REF_TIER_THRESHOLD,
            "next_tier_target": REF_TIER_THRESHOLD,
            "next_tier_remaining": max(0, REF_TIER_THRESHOLD - invited_with_deposit),
            "last_bonuses": [
                {
                    "id": r.id,
                    "from_seq": s.query(User.seq).filter(User.id == r.from_user_id).scalar() or 0,
                    "amount_credit": float(r.amount_credit or 0),
                    "currency": r.currency or currency,
                    "rate": int(round(float(r.rate or 0) * 100)),
                    "ts": int(r.created_at or now_ts()),
                }
                for r in rewards
            ],
        }


@app.get("/api/v1/services")
async def api_services(user_id: Optional[int] = Query(None)):
    """
    Если передан user_id — возвращаем цены с учётом персональной наценки.
    Иначе — как в базе (под дефолтную наценку).
    """
    with db() as s:
        u: Optional[User] = None
        if user_id:
            u = (
                s.query(User)
                .filter(User.tg_id == user_id)
                .order_by(User.id.desc())
                .first()
            ) or s.query(User).filter(User.seq == user_id).order_by(User.id.desc()).first()

        groups = {k: {**DISPLAY[k], "count": 0} for k in DISPLAY}
        for it in s.query(Service).filter(Service.active == True).all():  # noqa: E712
            if it.network in groups:
                groups[it.network]["count"] += 1
        # просто выдаём счётчик по сетям
        return [groups[k] for k in ["telegram", "tiktok", "instagram", "youtube", "facebook"]]


@app.get("/api/v1/services/{network}")
async def api_services_by_network(network: str, user_id: Optional[int] = Query(None)):
    """
    Возвращает список услуг сети. Если user_id задан — цена с учётом персональной наценки.
    """
    if network not in NETWORKS:
        raise HTTPException(404, "Unknown network")
    with db() as s:
        u: Optional[User] = None
        if user_id:
            u = (
                s.query(User)
                .filter(User.tg_id == user_id)
                .order_by(User.id.desc())
                .first()
            ) or s.query(User).filter(User.seq == user_id).order_by(User.id.desc()).first()

        items = (
            s.query(Service)
            .filter(Service.network == network, Service.active == True)  # noqa: E712
            .order_by(Service.id.asc())
            .all()
        )

        # если есть пользователь — пересчитываем rate_client_1000 под его наценку
        out = []
        if u is not None:
            import asyncio
            fx = None
            if CURRENCY == "RUB":
                fx = asyncio.get_event_loop().run_until_complete(fx_usd_rub())
            for it in items:
                # вручную повтор расчёта без ожидания (чтобы не делать await много раз)
                current_view = float(it.rate_client_1000 or 0.0)
                mul = user_markup(u)
                if CURRENCY == "USD":
                    base_usd = current_view / max(MARKUP_MULTIPLIER, 1e-9)
                    new_rate = base_usd * mul
                else:
                    base_usd = current_view / max(MARKUP_MULTIPLIER * (fx or 1.0), 1e-9)
                    new_rate = base_usd * mul * (fx or 1.0)

                out.append({
                    "service": it.id,
                    "network": it.network,
                    "name": it.name,
                    "type": it.type,
                    "min": it.min,
                    "max": it.max,
                    "rate_client_1000": float(round(new_rate, 4)),
                    "currency": it.currency or CURRENCY,
                    "description": it.description or "",
                })
        else:
            out = [
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
        return out


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

        # цена с учётом персональной наценки
        rate = await rate_per_1k_for_user(svc, u)
        base_cost = float(round(rate * body.quantity / 1000.0, 2))

        # скидочный промокод (если передан)
        discount_applied = 0.0
        promo_row: Optional[PromoCode] = None
        if body.promo_code:
            code = _norm_code(body.promo_code)
            if code:
                pc = s.query(PromoCode).filter(func.upper(PromoCode.code) == code).one_or_none()
                if not pc:
                    raise HTTPException(404, "promo_not_found")
                if pc.type != "discount":
                    raise HTTPException(400, "promo_not_discount")
                chk = _check_discount_promo(s, u, pc)
                pct = float(chk["percent"])
                discount_applied = round(base_cost * pct, 2)
                promo_row = pc

        cost = max(0.0, round(base_cost - discount_applied, 2))

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

        # списываем баланс
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

        # фиксируем активацию скидочного промокода, если был
        if promo_row and discount_applied > 0:
            s.add(PromoActivation(
                code_id=promo_row.id,
                user_id=u.id,
                order_id=o.id,
                amount_credit=None,
                discount_applied=discount_applied,
                created_at=now_ts(),
            ))
            s.commit()

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


# ===== helpers: status normalize/synonyms (для детализации) =====
def _order_status_norm(s: Optional[str]) -> str:
    t = (s or "").strip().lower().replace("_", " ")
    if t in ("awaiting", "in progress", "processing"):
        return "processing"
    if t in ("completed", "finished", "success", "done"):
        return "completed"
    if t in ("canceled", "cancelled", "failed", "error"):
        return "failed"
    if t in ("pending",):
        return "pending"
    return t or "processing"

_ORDER_STATUS_SYNONYMS = {
    "processing": ["awaiting", "in progress", "processing"],
    "completed":  ["completed", "finished", "success", "done"],
    "failed":     ["canceled", "cancelled", "failed", "error"],
    "pending":    ["pending"],
}

def _pay_status_norm(s: Optional[str]) -> str:
    t = (s or "").strip().lower()
    if t in ("created", "pending"):
        return "pending"
    if t in ("paid", "finished", "success"):
        return "completed"
    if t in ("failed", "canceled", "cancelled", "expired", "error"):
        return "failed"
    return t or "pending"

_PAY_STATUS_SYNONYMS = {
    "pending":  ["created", "pending"],
    "completed":["paid", "finished", "success"],
    "failed":   ["failed", "canceled", "cancelled", "expired", "error"],
}

# ===== VEXBOOST: проверка статуса заказа и массовое обновление =====
async def vex_order_status(provider_order_id: str | int) -> Optional[str]:
    """
    Возвращает сырой статус от поставщика (In progress / Completed / Canceled ...)
    или None, если не удалось.
    """
    if not VEX_KEY:
        return None
    try:
        qp = httpx.QueryParams({"action": "status", "key": VEX_KEY, "order": str(provider_order_id)})
        url = f"{API_BASE}?{qp}"
        r = await _client.get(url)
        r.raise_for_status()
        js = r.json()
        st = (js.get("status") or js.get("order_status") or js.get("state") or "").strip()
        return st or None
    except Exception as e:
        logging.warning("vex_order_status fail for %s: %s", provider_order_id, e)
        return None


async def refresh_orders_for_user(s: Session, u: User, limit: int = 40) -> int:
    """
    Обновляет статусы последних НЕфинальных заказов пользователя из VEXBOOST.
    Возвращает кол-во обновлённых строк.
    """
    NON_FINAL = ("Awaiting", "In progress", "Processing", "Pending")
    q = (
        s.query(Order)
        .filter(Order.user_id == u.id)
        .filter(func.lower(Order.status).in_([x.lower() for x in NON_FINAL]))
        .order_by(Order.id.desc())
        .limit(limit)
    )
    rows = q.all()
    updated = 0
    for o in rows:
        if not o.provider_id:
            continue
        st_raw = await vex_order_status(o.provider_id)
        if not st_raw:
            continue
        new_norm = _order_status_norm(st_raw)
        old_norm = _order_status_norm(o.status)
        if new_norm != old_norm or st_raw != (o.status or ""):
            o.status = st_raw  # храним сырой статус от поставщика
            o.updated_at = now_ts()
            updated += 1
    if updated:
        s.commit()
    return updated


# ===== Orders list =====
@app.get("/api/v1/orders")
async def api_orders(
    user_id: int = Query(...),
    status: Optional[str] = None,  # processing/completed/failed/pending
    limit: int = 50,
    offset: int = 0,
    refresh: int = 0,              # 1 = обновить статусы перед выдачей
):

    limit = max(1, min(200, int(limit)))
    offset = max(0, int(offset))
    with db() as s:
        # robust lookup
        u = (
            s.query(User)
            .filter(User.tg_id == user_id)
            .order_by(User.id.desc())
            .first()
        )
        if not u:
            u = s.query(User).filter(User.seq == user_id).order_by(User.id.desc()).first()
        if not u:
            raise HTTPException(404, "user_not_found")

        if refresh:
            try:
                await refresh_orders_for_user(s, u, limit=40)
            except Exception as e:
                logging.warning("orders refresh failed: %s", e)

        q = (
            s.query(Order, Service)
            .join(Service, Service.id == Order.service_id)
            .filter(Order.user_id == u.id)
        )
        if status:
            key = _order_status_norm(status)
            syns = _ORDER_STATUS_SYNONYMS.get(key, [key])
            q = q.filter(func.lower(Order.status).in_(syns))

        rows = q.order_by(Order.id.desc()).limit(limit).offset(offset).all()
        out = []
        for o, svc in rows:
            out.append({
                "id": o.id,
                "created_at": int(getattr(o, "created_at", None) or now_ts()),
                "service": svc.name,
                "category": svc.description or "",
                "quantity": int(o.quantity or 0),
                "price": float(o.cost or 0.0),
                "currency": o.currency or CURRENCY,
                "status": _order_status_norm(o.status),
                "provider_id": getattr(o, "provider_id", None),
            })
        return out


# ===== Payments (topups + referral rewards) =====
@app.get("/api/v1/payments")
async def api_payments(
    user_id: int = Query(...),
    status: Optional[str] = None,  # pending/completed/failed
    limit: int = 50,
    offset: int = 0,
):
    """
    Возвращает объединённый список:
      • Topups (обычные пополнения)
      • RefReward (реферальные начисления) как method='ref', status='completed'
      • Topups с provider='promo' (балансовые промокоды)
    Сортировано по времени (desc). Всегда массив, не null.
    """
    limit = max(1, min(200, int(limit)))
    offset = max(0, int(offset))

    with db() as s:
        # robust lookup: tg_id -> seq
        u = s.query(User).filter(User.tg_id == user_id).order_by(User.id.desc()).first()
        if not u:
            u = s.query(User).filter(User.seq == user_id).order_by(User.id.desc()).first()
        if not u:
            raise HTTPException(404, "user_not_found")

        # нормализация статуса
        status_set: Optional[Set[str]] = None
        if status:
            key = _pay_status_norm(status)
            status_set = set(_PAY_STATUS_SYNONYMS.get(key, [key]))

        # --- Topups
        q_top = s.query(Topup).filter(Topup.user_id == u.id)
        if status_set:
            q_top = q_top.filter(func.lower(Topup.status).in_(status_set))
        topups = q_top.all()

        # --- Ref rewards (всегда считаем completed)
        rewards: List[RefReward] = []
        if not status_set or ("completed" in status_set):
            rewards = s.query(RefReward).filter(RefReward.to_user_id == u.id).all()

    fx = await fx_usd_rub()

    items: List[Dict[str, Any]] = []

    # map topups
    for t in topups:
        usd = float(t.amount_usd or 0.0)
        if CURRENCY == "USD":
            amount = round(usd, 2); currency = "USD"
        else:
            amount = round(usd * fx, 2); currency = CURRENCY
        created = int(getattr(t, "created_at", None) or now_ts())
        items.append({
            "id": int(t.id),
            "created_at": created,
            "amount": amount,
            "amount_usd": round(usd, 2),
            "currency": currency,
            "method": t.provider or "cryptobot",
            "status": _pay_status_norm(t.status),
            "invoice_id": t.invoice_id,
            "pay_url": getattr(t, "pay_url", None),
        })

    # map referral rewards
    for r in rewards:
        created = int(getattr(r, "created_at", None) or now_ts())
        amount = round(float(r.amount_credit or 0.0), 2)
        currency = r.currency or CURRENCY
        # нормализуем amount_usd
        if CURRENCY == "USD":
            amount_usd = amount
        else:
            amount_usd = round(amount / (fx or 1.0), 2) if (fx or 0) > 0 else None

        items.append({
            "id": int(r.id),
            "created_at": created,
            "amount": amount,
            "amount_usd": amount_usd,
            "currency": currency,
            "method": "ref",
            "status": "completed",
            "invoice_id": None,
            "pay_url": None,
        })

    # сортировка и пагинация
    items.sort(key=lambda x: x["created_at"], reverse=True)
    return items[offset: offset + limit]
