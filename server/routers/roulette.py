# server/routers/roulette.py
# -*- coding: utf-8 -*-
from __future__ import annotations

import math
import secrets
from typing import List, Sequence, Tuple, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from server.db import SessionLocal, User, now_ts

router = APIRouter(tags=["roulette"])

# ===== Настройки рулетки =====
# Номиналы (должны соответствовать ticket-<val>.svg)
VALUES: List[int]    = [0, 2, 4, 5, 6, 8, 10, 12, 15, 20, 30, 40, 60, 100]
# Веса выпадения (сумма нормализуется до 1.0)
WEIGHTS: List[float] = [0.20, 0.12, 0.10, 0.10, 0.09, 0.08, 0.07, 0.06, 0.06, 0.05, 0.03, 0.02, 0.01, 0.01]

CURRENCY = "RUB"
MIN_COST_RUB = 10.0              # стоимость одного спина
AUTOSPIN_MAX = 500               # максимум автоспинов за одну сессию


# ===== Внутренние утилиты =====
def _normalize_weights(weights: Sequence[float]) -> List[float]:
    s = float(sum(w for w in weights if w > 0))
    if s <= 0:
        n = len(weights)
        return [1.0 / n] * n
    return [max(0.0, float(w)) / s for w in weights]


def _weighted_choice(values: Sequence[int], weights: Sequence[float]) -> Tuple[int, int]:
    """
    Возвращает (value, index) по весам.
    Используем cryptographically secure RNG (secrets) + кумулятивные веса.
    """
    ws = _normalize_weights(weights)
    cum = []
    acc = 0.0
    for w in ws:
        acc += w
        cum.append(acc)
    # из-за накопления погрешностей гарантируем последний = 1.0
    cum[-1] = 1.0

    r = secrets.randbelow(10**12) / 10**12  # [0,1)
    for i, t in enumerate(cum):
        if r < t:
            return int(values[i]), i
    return int(values[-1]), len(values) - 1


def _load_user(session, user_id: int) -> User:
    """
    Ищем по tg_id, затем по seq (чтобы работало и с гостевыми ID),
    берём всегда последний профиль.
    """
    u = (
        session.query(User)
        .filter(User.tg_id == user_id)
        .order_by(User.id.desc())
        .first()
    )
    if not u:
        u = (
            session.query(User)
            .filter(User.seq == user_id)
            .order_by(User.id.desc())
            .first()
        )
    if not u:
        raise HTTPException(404, "user_not_found")
    return u


# ===== Pydantic-схемы =====
class SpinRequest(BaseModel):
    user_id: int = Field(..., description="Telegram user id или seq")
    cost_rub: float = Field(MIN_COST_RUB, ge=0.0, description="Стоимость спина в RUB")


class SpinResponse(BaseModel):
    ok: bool = True
    win: int = Field(..., description="Выпавшее значение (в рублях)")
    index: int = Field(..., description="Индекс значения в VALUES")
    values: List[int] = Field(..., description="Список возможных значений")
    balance: float = Field(..., description="Новый баланс пользователя")
    currency: str = Field(CURRENCY, description="Валюта баланса")


class AutoSpinRequest(BaseModel):
    user_id: int = Field(..., description="Telegram user id или seq")
    count: int = Field(25, ge=1, le=AUTOSPIN_MAX, description=f"Кол-во спинов (1..{AUTOSPIN_MAX})")
    cost_rub: float = Field(MIN_COST_RUB, ge=0.0, description="Стоимость одного спина в RUB")


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
    cost_rub: float = MIN_COST_RUB


# ===== endpoints =====
@router.get("/roulette/config", response_model=ConfigResponse)
async def roulette_config() -> ConfigResponse:
    return ConfigResponse(
        values=list(VALUES),
        weights=_normalize_weights(WEIGHTS),
        cost_rub=MIN_COST_RUB,
    )


@router.post("/roulette/spin", response_model=SpinResponse)
async def roulette_spin(payload: SpinRequest) -> SpinResponse:
    """
    Списывает стоимость спина и начисляет выпавший приз в одной транзакции.
    """
    cost = float(payload.cost_rub or 0.0)
    if cost < MIN_COST_RUB - 1e-9:
        raise HTTPException(400, f"min_cost_is_{MIN_COST_RUB}RUB")

    win_val, win_idx = _weighted_choice(VALUES, WEIGHTS)

    s = SessionLocal()
    try:
        # Пытаемся заблокировать строку пользователя (в SQLite игнорируется)
        try:
            u = (
                s.query(User)
                .filter((User.tg_id == payload.user_id) | (User.seq == payload.user_id))
                .order_by(User.id.desc())
                .with_for_update()
                .first()
            )
        except Exception:
            u = _load_user(s, payload.user_id)

        if not u:
            raise HTTPException(404, "user_not_found")

        bal = float(u.balance or 0.0)
        if bal + 1e-9 < cost:
            raise HTTPException(402, "Недостаточно средств")

        new_balance = bal - cost + float(win_val)
        new_balance = round(new_balance + 1e-9, 2)

        u.balance = new_balance
        if hasattr(u, "last_seen_at"):
            u.last_seen_at = now_ts()

        s.commit()

        return SpinResponse(
            ok=True,
            win=int(win_val),
            index=int(win_idx),
            values=list(VALUES),
            balance=new_balance,
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
    """
    Предоплата автоспина:
      1) Сразу списывает total_cost = count * cost_rub.
      2) Генерирует список выигрышей (wins[]).
      3) Начисляет суммарный выигрыш на баланс.
      4) Возвращает план для фронта и финальные балансы.
    """
    count = int(payload.count)
    if count < 1 or count > AUTOSPIN_MAX:
        raise HTTPException(400, f"count_must_be_1..{AUTOSPIN_MAX}")

    cost = float(payload.cost_rub or 0.0)
    if cost < MIN_COST_RUB - 1e-9:
        raise HTTPException(400, f"min_cost_is_{MIN_COST_RUB}RUB")

    total_cost = round(cost * count, 2)

    s = SessionLocal()
    try:
        try:
            u = (
                s.query(User)
                .filter((User.tg_id == payload.user_id) | (User.seq == payload.user_id))
                .order_by(User.id.desc())
                .with_for_update()
                .first()
            )
        except Exception:
            u = _load_user(s, payload.user_id)

        if not u:
            raise HTTPException(404, "user_not_found")

        bal_before = float(u.balance or 0.0)
        if bal_before + 1e-9 < total_cost:
            raise HTTPException(402, "Недостаточно средств")

        # 1) списание сразу
        bal_after_charge = round(bal_before - total_cost + 1e-9, 2)

        # 2) генерируем выигрыши
        wins: List[int] = [int(_weighted_choice(VALUES, WEIGHTS)[0]) for _ in range(count)]
        total_return = float(sum(wins))

        # 3) начисляем суммарный выигрыш
        bal_final = round(bal_after_charge + total_return + 1e-9, 2)
        u.balance = bal_final
        if hasattr(u, "last_seen_at"):
            u.last_seen_at = now_ts()

        s.commit()

        return AutoSpinResponse(
            ok=True,
            session_id=secrets.token_urlsafe(10),
            count=count,
            cost_rub=round(cost, 2),
            total_cost=total_cost,
            wins=wins,
            total_return=round(total_return, 2),
            balance_before=round(bal_before, 2),
            balance_after_charge=bal_after_charge,
            balance_final=bal_final,
            currency=CURRENCY,
        )
    except HTTPException:
        raise
    except Exception as e:
        s.rollback()
        raise HTTPException(500, f"autospin_failed: {e}")
    finally:
        s.close()
