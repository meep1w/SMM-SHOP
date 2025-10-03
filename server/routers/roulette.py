# server/routers/roulette.py
# -*- coding: utf-8 -*-
from __future__ import annotations

import time
import secrets
from decimal import Decimal, ROUND_HALF_UP, getcontext
from typing import Dict, List, Sequence, Tuple

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from server.db import SessionLocal, User, now_ts

router = APIRouter(tags=["roulette"])

# ===== Настройки рулетки =====
VALUES: List[int]    = [0, 2, 4, 5, 6, 8, 10, 12, 15, 20, 30, 40, 60, 100]
WEIGHTS: List[float] = [0.20, 0.12, 0.10, 0.10, 0.09, 0.08, 0.07, 0.06, 0.06, 0.05, 0.03, 0.02, 0.01, 0.01]

CURRENCY = "RUB"
MIN_COST_RUB = Decimal("10.00")   # стоимость одного спина (фикс)
AUTOSPIN_MAX = 500                # максимум спинов за одну сессию

# Денежные операции — только Decimal
getcontext().prec = 28
CENT = Decimal("0.01")
def money(x) -> Decimal:
    return (Decimal(str(x)) if not isinstance(x, Decimal) else x).quantize(CENT, rounding=ROUND_HALF_UP)

# ===== In-memory сессии автоспина =====
_SESSIONS: Dict[str, Dict] = {}
SESSION_TTL_SEC = 30 * 60  # 30 минут

def _save_session(sess_id: str, data: Dict) -> None:
    data["ts"] = int(time.time())
    _SESSIONS[sess_id] = data

def _get_session(sess_id: str) -> Dict | None:
    s = _SESSIONS.get(sess_id)
    if not s:
        return None
    if int(time.time()) - int(s.get("ts", 0)) > SESSION_TTL_SEC:
        _SESSIONS.pop(sess_id, None)
        return None
    return s

def _close_session(sess_id: str) -> None:
    _SESSIONS.pop(sess_id, None)

# ===== Утилиты =====
def _normalize_weights(weights: Sequence[float]) -> List[float]:
    s = float(sum(w for w in weights if w > 0))
    if s <= 0:
        n = len(weights)
        return [1.0 / n] * n
    return [max(0.0, float(w)) / s for w in weights]

def _weighted_choice(values: Sequence[int], weights: Sequence[float]) -> Tuple[int, int]:
    ws = _normalize_weights(weights)
    cum = []
    acc = 0.0
    for w in ws:
        acc += w
        cum.append(acc)
    cum[-1] = 1.0

    r = secrets.randbelow(10**12) / 10**12
    for i, t in enumerate(cum):
        if r < t:
            return int(values[i]), i
    return int(values[-1]), len(values) - 1

def _get_user_locked(s, user_id: int) -> User:
    """Сначала ищем по tg_id, если нет — по seq. Без OR, чтобы не схватить «чужую» запись."""
    u = (
        s.query(User)
        .filter(User.tg_id == user_id)
        .order_by(User.id.desc())
        .with_for_update()
        .first()
    )
    if not u:
        u = (
            s.query(User)
            .filter(User.seq == user_id)
            .order_by(User.id.desc())
            .with_for_update()
            .first()
        )
    if not u:
        raise HTTPException(404, "user_not_found")
    return u

# ===== Схемы =====
class SpinRequest(BaseModel):
    user_id: int
    # Игнорируем входящее значение стоимости — цена фиксирована сервером
    cost_rub: Decimal | None = None

class SpinResponse(BaseModel):
    ok: bool = True
    win: int
    index: int
    values: List[int]
    balance: float
    currency: str = CURRENCY

class AutoSpinRequest(BaseModel):
    user_id: int
    count: int = Field(25, ge=1, le=AUTOSPIN_MAX)
    # Игнорируем входящую стоимость, чтобы не было манипуляций
    cost_rub: Decimal | None = None

class AutoSpinResponse(BaseModel):
    ok: bool = True
    session_id: str
    count: int
    cost_rub: float
    total_cost: float
    balance_before: float
    balance_after_charge: float
    currency: str = CURRENCY

class AutoSpinNextRequest(BaseModel):
    user_id: int
    session_id: str

class AutoSpinNextResponse(BaseModel):
    ok: bool = True
    win: int
    remaining: int
    balance: float
    currency: str = CURRENCY

class ConfigResponse(BaseModel):
    values: List[int]
    weights: List[float]
    currency: str = CURRENCY
    cost_rub: float = float(MIN_COST_RUB)

# ===== Endpoints =====
@router.get("/roulette/config", response_model=ConfigResponse)
async def roulette_config() -> ConfigResponse:
    return ConfigResponse(
        values=list(VALUES),
        weights=_normalize_weights(WEIGHTS),
        cost_rub=float(MIN_COST_RUB),
    )

@router.post("/roulette/spin", response_model=SpinResponse)
async def roulette_spin(payload: SpinRequest) -> SpinResponse:
    # Цена за спин — всегда фикс из константы
    cost = MIN_COST_RUB

    win_val, win_idx = _weighted_choice(VALUES, WEIGHTS)

    s = SessionLocal()
    try:
        try:
            u = _get_user_locked(s, payload.user_id)
        except Exception:
            # фолбэк для sqlite (без блокировки)
            u = (
                s.query(User)
                .filter((User.tg_id == payload.user_id) | (User.seq == payload.user_id))
                .order_by(User.id.desc())
                .first()
            )
            if not u:
                raise HTTPException(404, "user_not_found")

        bal = money(u.balance or 0)
        if bal < cost:
            raise HTTPException(402, "Недостаточно средств")

        new_balance = money(bal - cost + Decimal(win_val))
        u.balance = float(new_balance)
        if hasattr(u, "last_seen_at"):
            u.last_seen_at = now_ts()

        s.commit()

        return SpinResponse(
            ok=True,
            win=int(win_val),
            index=int(win_idx),
            values=list(VALUES),
            balance=float(new_balance),
            currency=CURRENCY,
        )
    except HTTPException:
        raise
    except Exception as e:
        s.rollback()
        raise HTTPException(500, f"spin_failed: {e}")
    finally:
        s.close()

@router.post("/roulette/autospin", response_model=AutoSpinResponse)
async def roulette_autospin(payload: AutoSpinRequest) -> AutoSpinResponse:
    count = int(payload.count)
    if count < 1 or count > AUTOSPIN_MAX:
        raise HTTPException(400, f"count_must_be_1..{AUTOSPIN_MAX}")

    # фиксированная цена
    cost = MIN_COST_RUB
    total_cost = money(cost * count)

    s = SessionLocal()
    try:
        try:
            u = _get_user_locked(s, payload.user_id)
        except Exception:
            u = (
                s.query(User)
                .filter((User.tg_id == payload.user_id) | (User.seq == payload.user_id))
                .order_by(User.id.desc())
                .first()
            )
            if not u:
                raise HTTPException(404, "user_not_found")

        bal_before = money(u.balance or 0)
        if bal_before < total_cost:
            raise HTTPException(402, "Недостаточно средств")

        # 1) Списание всей суммы сразу (предоплата)
        bal_after_charge = money(bal_before - total_cost)

        # 2) Генерируем список выигрышей (план)
        wins: List[int] = [int(_weighted_choice(VALUES, WEIGHTS)[0]) for _ in range(count)]

        # 3) Баланс пока НЕ пополняем на сумму выигрышей — это будет по одному спину через /autospin/next
        u.balance = float(bal_after_charge)
        if hasattr(u, "last_seen_at"):
            u.last_seen_at = now_ts()
        s.commit()

        # 4) Регистрируем сессию
        sess_id = secrets.token_urlsafe(10)
        _save_session(sess_id, {
            "user_id": int(payload.user_id),
            "wins": wins,
            "idx": 0,  # следующий к выдаче
        })

        return AutoSpinResponse(
            ok=True,
            session_id=sess_id,
            count=count,
            cost_rub=float(cost),
            total_cost=float(total_cost),
            balance_before=float(bal_before),
            balance_after_charge=float(bal_after_charge),
            currency=CURRENCY,
        )
    except HTTPException:
        raise
    except Exception as e:
        s.rollback()
        raise HTTPException(500, f"autospin_failed: {e}")
    finally:
        s.close()

@router.post("/roulette/autospin/next", response_model=AutoSpinNextResponse)
async def roulette_autospin_next(payload: AutoSpinNextRequest) -> AutoSpinNextResponse:
    sess = _get_session(payload.session_id)
    if not sess or sess.get("user_id") != int(payload.user_id):
        raise HTTPException(404, "autospin_session_not_found")

    wins: List[int] = list(sess.get("wins") or [])
    idx: int = int(sess.get("idx") or 0)

    if idx >= len(wins):
        _close_session(payload.session_id)
        raise HTTPException(410, "autospin_finished")

    win_val = int(wins[idx])
    sess["idx"] = idx + 1
    _save_session(payload.session_id, sess)

    # Начисляем выигрыш за ЭТОТ спин
    s = SessionLocal()
    try:
        try:
            u = _get_user_locked(s, payload.user_id)
        except Exception:
            u = (
                s.query(User)
                .filter((User.tg_id == payload.user_id) | (User.seq == payload.user_id))
                .order_by(User.id.desc())
                .first()
            )
            if not u:
                raise HTTPException(404, "user_not_found")

        bal = money(u.balance or 0)
        new_balance = money(bal + Decimal(win_val))
        u.balance = float(new_balance)
        if hasattr(u, "last_seen_at"):
            u.last_seen_at = now_ts()
        s.commit()

        remaining = max(0, len(wins) - (idx + 1))
        if remaining == 0:
            _close_session(payload.session_id)

        return AutoSpinNextResponse(
            ok=True,
            win=win_val,
            remaining=remaining,
            balance=float(new_balance),
            currency=CURRENCY,
        )
    except HTTPException:
        raise
    except Exception as e:
        s.rollback()
        raise HTTPException(500, f"autospin_next_failed: {e}")
    finally:
        s.close()
