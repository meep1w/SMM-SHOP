# -*- coding: utf-8 -*-
"""
Заменяет JSON-хранилище на Postgres.
Использует ту же переменную DATABASE_URL, что и сервер.
"""
import os, time
from typing import Optional
from sqlalchemy.orm import Session
from server.db import SessionLocal, User, stable_seq

def _db() -> Session:
    return SessionLocal()

def is_registered(user_id: int) -> bool:
    with _db() as s:
        u = s.query(User).filter(User.tg_id==user_id).one_or_none()
        return bool(u and u.nick)

def get_nick(user_id: int) -> Optional[str]:
    with _db() as s:
        u = s.query(User).filter(User.tg_id==user_id).one_or_none()
        return u.nick if u and u.nick else None

def set_registered(user_id: int, nick: str) -> None:
    ts = int(time.time())
    with _db() as s:
        u = s.query(User).filter(User.tg_id==user_id).one_or_none()
        if not u:
            u = User(tg_id=user_id, seq=stable_seq(user_id), nick=nick, currency=os.getenv("CURRENCY","RUB"), balance=0.0,
                     created_at=ts, updated_at=ts, last_seen_at=ts)
            s.add(u); s.commit()
        else:
            u.nick = nick; u.updated_at = ts; u.last_seen_at = ts; s.commit()
