# server/routers/roulette.py
# -*- coding: utf-8 -*-
from __future__ import annotations

import os
import time
import math
import secrets
import random
from typing import List, Optional, Dict

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, conint, confloat

from server.db import SessionLocal, User, now_ts  # модели/сессия уже есть в проекте


router = APIRouter(prefix="/api/v1/roulette", tags=["roulette"])

# ===== Конфигурация рулетки =====
# Номиналы билетов (должны совпадать с картинками ticket-<val>.svg)
TICKET_VALUES: List[int] = [0, 2, 4, 5, 6, 8, 10, 12, 15, 20, 30, 40, 60, 100]

# Вероятности (чем меньше номинал — тем чаще). Можно переопределить через ENV ROULETTE_WEIGHTS
# Формат ENV: "0.40,0.20,0.12,0.07,0.05,0.04,0.035,0.02,0.015,0.01,0.006,0.004,0.003,0.002"
DEFAULT_WEIGHTS: List[float] = [
    0.40, 0.20, 0.12, 0.07, 0.05, 0.04, 0.035, 0.02, 0.015, 0.01, 0.006, 0.004, 0.003, 0.002
]

def _weights_from_env() -> List[float]:
    raw = (os.getenv("ROULETTE_WEIGHTS") or "").strip()
    if not raw:
        return DEFAULT_WEIGHTS[:]
    try:
        if raw.startswith("["):
            import json
            arr = json.loads(raw)
        else:
            arr = [float(x) for x in raw.split(",")]
        if len(arr) == len(TICKET_VALUES) and all((x >= 0 for x in arr)) and sum(arr) > 0:
            s = float(sum(arr))
            return [x / s for x in arr]
    except Exception:
        pass
    return DEFAULT_WEIGHTS[:]

WEIGHTS: List[float] = _weights_from_env()

# Стоимость одного спина и лимит автоспина
SPIN_COST_RUB_DEFAULT: float = float(os.getenv("ROULETTE_COST_RUB", "10"))
AUTOSPIN_MAX: int = int(os.getenv("ROULETTE_MAX_SPINS", "500"))

# ===== Утилиты =====
def db():
    return SessionLocal()

def _find_user(sess, uid: int) -> Optional[User]:
    # tg_id -> seq fallback
    u = sess.query(User).filter(User.tg_id == uid).order_by(User.id.desc()).first()
    if u:
        return u
    return sess.query(User).filter(User.seq == uid).order_by(User.id.desc()).first()

def _rng(seed: Optional[int], user_id: int) -> random.Random:
    seed_final = (
        (seed or 0)
        ^ int(time.time_ns())
        ^ secrets.randbits(64)
        ^ (user_id & 0xFFFFFFFF)
    )
    return random.Random(seed_final)

def _choose_value(rnd: random.Random) -> int:
    # weighted choice
    r = rnd.random()
    acc = 0.0
    for val, w in zip(TICKET_VALUES, WEIGHTS):
        acc += w
        if r <= acc:
            return val
    return TICKET_VALUES[-1]

# ===== Модели =====
class SpinIn(BaseModel):
    user_id: int
    cost_rub: confloat(gt=0) = SPIN_COST_RUB_DEFAULT
    seed: Optional[int] = None

class SpinOut(BaseModel):
    win: int
    balance: float

class AutoSpinIn(BaseModel):
    user_id: int
    count: conint(ge=1, le=AUTOSPIN_MAX) = 25
    cost_rub: confloat(gt=0) = SPIN_COST_RUB_DEFAULT
    seed: Optional[int] = None

class AutoSpinOut(BaseModel):
    ok: bool
    session_id: str
    count: int
    cost_rub: float
    total_cost: float
    wins: List[int]
    total_return: float
    balance_before: float
    balance_after_charge: float
    balance_final: float


# ===== Эндпоинты =====
@router.post("/spin", response_model=SpinOut)
def spin(body: SpinIn):
    """
    Одиночный спин: проверяем баланс, списываем cost_rub, генерим выигрыш, начисляем,
    возвращаем новый баланс.
    """
    with db() as s:
        u = _find_user(s, body.user_id)
        if not u:
            raise HTTPException(404, "user_not_found")

        cost = float(body.cost_rub)
        bal = float(u.balance or 0.0)
        if bal + 1e-9 < cost:
            raise HTTPException(402, "Недостаточно средств")

        rnd = _rng(body.seed, body.user_id)
        win = int(_choose_value(rnd))

        new_balance = bal - cost + win
        u.balance = float(round(new_balance, 2))
        s.commit()
        return SpinOut(win=win, balance=float(u.balance))


@router.post("/autospin", response_model=AutoSpinOut)
def autospin(body: AutoSpinIn):
    """
    Предоплаченный автоспин:
      1) Сразу списывает total_cost = count * cost_rub.
      2) Генерирует список выигрышей (wins[]).
      3) Начисляет суммарный выигрыш на баланс.
      4) Возвращает план (wins) и промежуточные/финальные балансы, чтобы фронт
         мог сначала показать списание, а затем визуально «доотыгрывать» до final.
    """
    if body.count < 1 or body.count > AUTOSPIN_MAX:
        raise HTTPException(400, f"count must be 1..{AUTOSPIN_MAX}")

    with db() as s:
        u = _find_user(s, body.user_id)
        if not u:
            raise HTTPException(404, "user_not_found")

        cost = float(body.cost_rub)
        total_cost = round(cost * int(body.count), 2)

        bal_before = float(u.balance or 0.0)
        if bal_before + 1e-9 < total_cost:
            raise HTTPException(402, "Недостаточно средств")

        # списание сразу
        bal_after_charge = bal_before - total_cost

        # генерим выигрыши
        rnd = _rng(body.seed, body.user_id)
        wins: List[int] = [int(_choose_value(rnd)) for _ in range(int(body.count))]
        total_return = float(sum(wins))

        # финальный баланс после всех спинов
        bal_final = bal_after_charge + total_return

        # фиксируем в БД итог сразу, чтобы серверный баланс и фронт совпали к концу анимации
        u.balance = float(round(bal_final, 2))
        s.commit()

        return AutoSpinOut(
            ok=True,
            session_id=secrets.token_urlsafe(10),
            count=int(body.count),
            cost_rub=float(cost),
            total_cost=float(total_cost),
            wins=wins,
            total_return=float(total_return),
            balance_before=float(round(bal_before, 2)),
            balance_after_charge=float(round(bal_after_charge, 2)),
            balance_final=float(round(bal_final, 2)),
        )
