# -*- coding: utf-8 -*-
"""
SQLAlchemy модели и инициализация БД для SMMShop.

- PostgreSQL по умолчанию (берётся из .env -> DATABASE_URL)
- Совместимо с SQLite для локального теста
- Автоинкременты для внутренних id через Identity()
- services.id = VEXBOOST ID (BigInteger, без автоинкремента)
- Реферальные таблицы: ref_links, ref_binds, ref_rewards
"""

import os
from pathlib import Path
from dotenv import load_dotenv

from sqlalchemy import (
    create_engine, Column, Integer, BigInteger, Text, Numeric, Boolean,
    ForeignKey, Identity, UniqueConstraint, Index
)
from sqlalchemy.orm import declarative_base, sessionmaker, Session

# Загрузка .env рядом с проектом
load_dotenv(Path(__file__).resolve().parents[1] / ".env")

# --- ENGINE / SESSION ---
DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./smmshop.sqlite3")

engine = create_engine(DATABASE_URL, pool_pre_ping=True, future=True)
SessionLocal = sessionmaker(bind=engine, expire_on_commit=False, class_=Session)
Base = declarative_base()


# --- ВСПОМОГАТЕЛЬНОЕ ---

def now_ts() -> int:
    """UNIX time (сек) как int"""
    import time
    return int(time.time())


def stable_seq(x) -> int:
    """Стабильная псевдо-последовательность из любого идентификатора (tg_id, ник и т.п.)"""
    s = str(x)
    h = 0
    for ch in s:
        h = ((h << 5) - h + ord(ch)) & 0xFFFFFFFF
    return abs(h) % 100000 + 1


# --- МОДЕЛИ ---

class User(Base):
    __tablename__ = "users"

    # Внутренний id — авто-инкремент (Identity) чтобы одинаково работало в Postgres/SQLite
    id = Column(Integer, Identity(), primary_key=True)

    # Телеграм идентификатор
    tg_id = Column(BigInteger, unique=True, nullable=False, index=True)

    # Короткий seq № для отображения (#12345)
    seq = Column(Integer, nullable=False, index=True)

    nick = Column(Text)
    currency = Column(Text, nullable=False, default="RUB")
    balance = Column(Numeric(18, 6), nullable=False, default=0)

    created_at = Column(Integer, default=now_ts, nullable=False)
    updated_at = Column(Integer, default=now_ts, nullable=False)
    last_seen_at = Column(Integer, default=now_ts, nullable=False)


class Service(Base):
    """
    Кэш услуг VEXBOOST.
    id = оригинальный VEXBOOST ID (BigInteger), не авто-инкремент.
    """
    __tablename__ = "services"

    id = Column(BigInteger, primary_key=True)  # VEXBOOST ID
    network = Column(Text, index=True)         # 'telegram' / 'tiktok' / ...
    name = Column(Text, nullable=False)
    type = Column(Text)
    min = Column(BigInteger)
    max = Column(BigInteger)
    rate_client_1000 = Column(Numeric(18, 6))  # цена за 1000 для клиента
    currency = Column(Text)                    # обычно RUB
    description = Column(Text)
    updated_at = Column(Integer, default=now_ts, nullable=False)
    active = Column(Boolean, default=True, nullable=False)


class Favorite(Base):
    """
    Избранное. Композитный первичный ключ:
    - user_id -> users.id (внутренний id)
    - service_id -> services.id (VEXBOOST id)
    """
    __tablename__ = "favorites"

    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    service_id = Column(BigInteger, ForeignKey("services.id", ondelete="CASCADE"), primary_key=True)
    created_at = Column(Integer, default=now_ts, nullable=False)


class Topup(Base):
    """
    Пополнения через провайдеров (сейчас CryptoBot).
    """
    __tablename__ = "topups"

    id = Column(Integer, Identity(), primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"))
    provider = Column(Text, nullable=False)    # 'cryptobot'
    invoice_id = Column(Text)
    amount_usd = Column(Numeric(18, 6), nullable=False)
    currency = Column(Text, nullable=False, default="USD")
    status = Column(Text, nullable=False)      # created|paid|expired|failed
    applied = Column(Boolean, nullable=False, default=False)
    pay_url = Column(Text)
    created_at = Column(Integer, default=now_ts, nullable=False)
    updated_at = Column(Integer, default=now_ts, nullable=False)


class Order(Base):
    """
    Заказы пользователя, связываем с внешним провайдером (VEXBOOST).
    """
    __tablename__ = "orders"

    id = Column(Integer, Identity(), primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"))
    service_id = Column(BigInteger)            # VEXBOOST service id
    quantity = Column(BigInteger)
    link = Column(Text)
    cost = Column(Numeric(18, 6), nullable=False)
    currency = Column(Text, nullable=False)
    status = Column(Text, nullable=False)      # Awaiting|In progress|Completed|Canceled|...
    provider_id = Column(Text)                 # VEXBOOST order id
    created_at = Column(Integer, default=now_ts, nullable=False)
    updated_at = Column(Integer, default=now_ts, nullable=False)


# === РЕФЕРАЛКИ ===

class RefLink(Base):
    """
    Реферальная ссылка — владелец и короткий код.
    Один владелец — один уникальный код.
    """
    __tablename__ = "ref_links"
    id = Column(Integer, Identity(), primary_key=True)
    owner_user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    code = Column(Text, nullable=False, unique=True, index=True)
    created_at = Column(Integer, default=now_ts, nullable=False)

    __table_args__ = (
        UniqueConstraint("owner_user_id", name="uq_ref_links_owner"),
    )


class RefBind(Base):
    """
    Факт привязки пользователя (реферала) к владельцу ссылки.
    Один user_id может быть привязан только к одному ref_owner_user_id.
    """
    __tablename__ = "ref_binds"
    id = Column(Integer, Identity(), primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, unique=True, index=True)
    ref_owner_user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    code = Column(Text, nullable=True)
    created_at = Column(Integer, default=now_ts, nullable=False)

    __table_args__ = (
        Index("ix_ref_binds_owner_user", "ref_owner_user_id"),
    )


class RefReward(Base):
    """
    Начисления реф-наград рефереру за пополнения реферала.
    topup_id сохраняем для идемпотентности.
    """
    __tablename__ = "ref_rewards"
    id = Column(Integer, Identity(), primary_key=True)
    to_user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)     # кому начислили (реферер)
    from_user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)   # чей депозит (реферал)
    topup_id = Column(Integer, ForeignKey("topups.id", ondelete="CASCADE"), nullable=False, unique=True)
    amount_credit = Column(Numeric(18, 6), nullable=False)  # сумма в валюте магазина (CURRENCY)
    currency = Column(Text, nullable=False, default="RUB")
    rate = Column(Numeric(6, 4), nullable=False)            # например 0.10 или 0.20
    created_at = Column(Integer, default=now_ts, nullable=False)


# --- УТИЛИТЫ ---

def init_db() -> None:
    """Создаёт таблицы, если их ещё нет."""
    Base.metadata.create_all(bind=engine)


def get_db() -> Session:
    """with-style генератор с SessionLocal()."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


__all__ = [
    "engine", "SessionLocal", "Base",
    "now_ts", "stable_seq",
    "User", "Service", "Favorite", "Topup", "Order",
    "RefLink", "RefBind", "RefReward",
    "init_db", "get_db",
]
