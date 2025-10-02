# server/routers/roulette.py
# -*- coding: utf-8 -*-
from __future__ import annotations

import secrets
from decimal import Decimal, ROUND_HALF_UP, getcontext
from typing import List, Sequence, Tuple

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from server.db import SessionLocal, User, now_ts

router = APIRouter(tags=["roulette"])

# ===== Настройки рулетки =====
VALUES: List[int]    = [0, 2, 4, 5, 6, 8, 10, 12, 15, 20, 30, 40, 60, 100]
WEIGHTS: List[float] = [0.20, 0.12, 0.10, 0.10, 0.09, 0.08, 0.07, 0.06, 0.06, 0.05, 0.03, 0.02, 0.01, 0.01]

CURRENCY = "RUB"
MIN_COST_RUB = Decimal("10.00")   # стоимость одного спина
AUTOSPIN_MAX = 500                # максимум спинов за одну сессию

# Денежные операции — только Decimal
getcontext().prec = 28
CENT = Decimal("0.01")
def money(x) -> Decimal:
    return (Decimal(str(x)) if not isinstance(x, Decimal) else x).quantize(CENT, rounding=ROUND_HALF_UP)


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
    cost_rub: Decimal = Field(MIN_COST_RUB, ge=0)


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
    cost_rub: Decimal = Field(MIN_COST_RUB, ge=0)


class AutoSpinResponse(BaseModel):
    ok: bool = True
    session_id: str
    count: int
    cost_rub: float
    total_cost: float
    wins: List[int]
    total_return: float
    balance_before: float
    balance_after_charge: float
    balance_final: float
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
    cost = money(payload.cost_rub or MIN_COST_RUB)
    if cost < MIN_COST_RUB:
        raise HTTPException(400, f"min_cost_is_{MIN_COST_RUB}RUB")

    win_val, win_idx = _weighted_choice(VALUES, WEIGHTS)

    s = SessionLocal()
    try:
        try:
            u = _get_user_locked(s, payload.user_id)
        except Exception:
            # Повторно без блокировки (на случай sqlite)
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

    cost = money(payload.cost_rub or MIN_COST_RUB)
    if cost < MIN_COST_RUB:
        raise HTTPException(400, f"min_cost_is_{MIN_COST_RUB}RUB")

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

        # 1) списание сразу
        bal_after_charge = money(bal_before - total_cost)

        # 2) генерируем выигрыши
        wins: List[int] = [int(_weighted_choice(VALUES, WEIGHTS)[0]) for _ in range(count)]
        total_return = money(sum(Decimal(w) for w in wins))

        # 3) начисляем суммарный выигрыш
        bal_final = money(bal_after_charge + total_return)

        u.balance = float(bal_final)
        if hasattr(u, "last_seen_at"):
            u.last_seen_at = now_ts()

        s.commit()

        return AutoSpinResponse(
            ok=True,
            session_id=secrets.token_urlsafe(10),
            count=count,
            cost_rub=float(cost),
            total_cost=float(total_cost),
            wins=wins,
            total_return=float(total_return),
            balance_before=float(bal_before),
            balance_after_charge=float(bal_after_charge),
            balance_final=float(bal_final),
            currency=CURRENCY,
        )
    except HTTPException:
        raise
    except Exception as e:
        s.rollback()
        raise HTTPException(500, f"autospin_failed: {e}")
    finally:
        s.close()
