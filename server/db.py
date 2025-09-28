# -*- coding: utf-8 -*-
"""
SQLAlchemy модели и инициализация БД для SMMShop.

- PostgreSQL по умолчанию (берётся из .env -> DATABASE_URL)
- Совместимо с SQLite для локального теста
- Автоинкременты через Identity() для внутренних id
- services.id = VEXBOOST ID (BigInteger, без автоинкремента)
"""

import os
from pathlib import Path
from dotenv import load_dotenv

from sqlalchemy import (
    create_engine, Column, Integer, BigInteger, Text, Numeric, Boolean,
    ForeignKey, Identity
)
from sqlalchemy.orm import declarative_base, sessionmaker, Session

# .env на уровень выше server/
load_dotenv(Path(__file__).resolve().parents[1] / ".env")

# --- ENGINE / SESSION ---
DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./smmshop.sqlite3")

engine = create_engine(DATABASE_URL, pool_pre_ping=True, future=True)
SessionLocal = sessionmaker(bind=engine, expire_on_commit=False, class_=Session)
Base = declarative_base()


# --- HELPERS ---

def now_ts() -> int:
    import time
    return int(time.time())


def stable_seq(x) -> int:
    """Стабильный короткий #id для юзера."""
    s = str(x)
    h = 0
    for ch in s:
        h = ((h << 5) - h + ord(ch)) & 0xFFFFFFFF
    return abs(h) % 100000 + 1


# --- MODELS ---

class User(Base):
    __tablename__ = "users"

    # внутренний id
    id = Column(Integer, Identity(), primary_key=True)

    # Telegram user id
    tg_id = Column(BigInteger, unique=True, nullable=False, index=True)

    # короткий номер для UI (#12345)
    seq = Column(Integer, nullable=False, index=True)

    nick = Column(Text)
    currency = Column(Text, nullable=False, default="RUB")
    balance = Column(Numeric(18, 6), nullable=False, default=0)

    created_at = Column(Integer, default=now_ts, nullable=False)
    updated_at = Column(Integer, default=now_ts, nullable=False)
    last_seen_at = Column(Integer, default=now_ts, nullable=False)


class Service(Base):
    """
    Кэш услуг от VEXBOOST.
    id = оригинальный VEXBOOST ID (BigInteger), НЕ автоинкремент.
    """
    __tablename__ = "services"

    id = Column(BigInteger, primary_key=True)       # VEXBOOST ID
    network = Column(Text, index=True)              # telegram/tiktok/...
    name = Column(Text, nullable=False)
    type = Column(Text)
    min = Column(BigInteger)
    max = Column(BigInteger)
    rate_client_1000 = Column(Numeric(18, 6))       # клиентская цена за 1000
    currency = Column(Text)                         # обычно RUB
    description = Column(Text)
    updated_at = Column(Integer, default=now_ts, nullable=False)
    active = Column(Boolean, default=True, nullable=False)


class Favorite(Base):
    """
    Избранное. Композитный PK: (user_id, service_id)
    user_id -> users.id (внутренний Integer id)
    service_id -> services.id (VEXBOOST BigInteger id)
    """
    __tablename__ = "favorites"

    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    service_id = Column(BigInteger, ForeignKey("services.id", ondelete="CASCADE"), primary_key=True)
    created_at = Column(Integer, default=now_ts, nullable=False)


class Topup(Base):
    """Пополнения (CryptoBot и т.п.)"""
    __tablename__ = "topups"

    id = Column(Integer, Identity(), primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"))
    provider = Column(Text, nullable=False)         # 'cryptobot'
    invoice_id = Column(Text)
    amount_usd = Column(Numeric(18, 6), nullable=False)
    currency = Column(Text, nullable=False, default="USD")
    status = Column(Text, nullable=False)           # created|paid|expired|failed
    applied = Column(Boolean, nullable=False, default=False)
    pay_url = Column(Text)
    created_at = Column(Integer, default=now_ts, nullable=False)
    updated_at = Column(Integer, default=now_ts, nullable=False)


class Order(Base):
    """Заказы."""
    __tablename__ = "orders"

    id = Column(Integer, Identity(), primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"))
    service_id = Column(BigInteger)                 # VEXBOOST service id
    quantity = Column(BigInteger)
    link = Column(Text)
    cost = Column(Numeric(18, 6), nullable=False)
    currency = Column(Text, nullable=False)
    status = Column(Text, nullable=False)           # Awaiting|In progress|Completed|...
    provider_id = Column(Text)                      # VEXBOOST order id
    created_at = Column(Integer, default=now_ts, nullable=False)
    updated_at = Column(Integer, default=now_ts, nullable=False)


# --- UTIL ---

def init_db() -> None:
    Base.metadata.create_all(bind=engine)


def get_db() -> Session:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


__all__ = [
    "engine", "SessionLocal", "Base",
    "now_ts", "stable_seq",
    "User", "Service", "Favorite", "Topup", "Order",
    "init_db", "get_db",
]
