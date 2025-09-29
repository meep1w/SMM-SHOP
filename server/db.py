# server/db.py
# -*- coding: utf-8 -*-
import os, time, hashlib
from typing import Optional

from sqlalchemy import (
    create_engine, Column, Integer, BigInteger, String, Text, Boolean, Float,
    ForeignKey, Index
)
from sqlalchemy.orm import declarative_base, relationship, sessionmaker

# ---- engine / session ----
DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:////tmp/smmshop.db")

engine = create_engine(
    DATABASE_URL,
    pool_pre_ping=True,
    future=True,
)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, future=True)

Base = declarative_base()

# ---- helpers ----
def now_ts() -> int:
    return int(time.time())

def stable_seq(x: int | str) -> int:
    """
    Стабильный короткий идентификатор из tg_id (или строки).
    """
    s = str(x).encode("utf-8")
    h = hashlib.sha1(s).hexdigest()
    # 1..99999
    return (int(h[:8], 16) % 99999) + 1


# ===================== MODELS =====================

class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True)
    tg_id = Column(BigInteger, index=True, nullable=False)   # Telegram user id
    seq = Column(Integer, index=True, nullable=False)        # стабильный короткий id
    nick = Column(String(64), unique=True, nullable=True)
    currency = Column(String(8), default="RUB")
    balance = Column(Float, default=0.0)
    last_seen_at = Column(Integer, default=now_ts)

    # персональная наценка (если NULL — используется дефолт из ENV)
    markup_override = Column(Float, nullable=True)

    __table_args__ = (
        Index("ix_users_tg_latest", "tg_id", "id"),
    )

class Service(Base):
    __tablename__ = "services"

    id = Column(Integer, primary_key=True)  # id поставщика
    network = Column(String(32), index=True, nullable=False) # telegram/tiktok/...
    name = Column(String(255), nullable=False)
    type = Column(String(64), nullable=True)
    min = Column(Integer, default=0)
    max = Column(Integer, default=0)
    rate_client_1000 = Column(Float, default=0.0)  # клиентская цена за 1000 (под дефолтную наценку)
    currency = Column(String(8), default="RUB")
    description = Column(Text, nullable=True)
    active = Column(Boolean, default=True)

class Favorite(Base):
    __tablename__ = "favorites"

    user_id = Column(Integer, ForeignKey("users.id"), primary_key=True)
    service_id = Column(Integer, ForeignKey("services.id"), primary_key=True)

class Order(Base):
    __tablename__ = "orders"

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), index=True, nullable=False)
    service_id = Column(Integer, ForeignKey("services.id"), index=True, nullable=False)

    quantity = Column(Integer, nullable=False)
    link = Column(Text, nullable=False)
    cost = Column(Float, nullable=False)
    currency = Column(String(8), default="RUB")

    status = Column(String(64), default="Awaiting")   # сырой статус поставщика
    provider_id = Column(String(64), nullable=True)   # id заказа у поставщика

    created_at = Column(Integer, default=now_ts)
    updated_at = Column(Integer, default=now_ts)

class Topup(Base):
    __tablename__ = "topups"

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), index=True, nullable=False)

    provider = Column(String(32), default="cryptobot")   # cryptobot / promo / ...
    invoice_id = Column(String(128), nullable=True)

    amount_usd = Column(Float, default=0.0)  # сумма в USD (базовая)
    currency = Column(String(8), default="USD")

    status = Column(String(32), default="created")  # created/pending/paid/failed
    applied = Column(Boolean, default=False)        # списано в баланс пользователя
    pay_url = Column(Text, nullable=True)

    created_at = Column(Integer, default=now_ts)

class RefLink(Base):
    __tablename__ = "ref_links"

    id = Column(Integer, primary_key=True)
    owner_user_id = Column(Integer, ForeignKey("users.id"), index=True, nullable=False)
    code = Column(String(32), unique=True, index=True, nullable=False)
    created_at = Column(Integer, default=now_ts)

class RefBind(Base):
    __tablename__ = "ref_binds"

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), index=True, nullable=False)
    ref_owner_user_id = Column(Integer, ForeignKey("users.id"), index=True, nullable=False)
    code = Column(String(32), nullable=False)
    created_at = Column(Integer, default=now_ts)

class RefReward(Base):
    __tablename__ = "ref_rewards"

    id = Column(Integer, primary_key=True)
    to_user_id = Column(Integer, ForeignKey("users.id"), index=True, nullable=False)
    from_user_id = Column(Integer, ForeignKey("users.id"), index=True, nullable=False)
    topup_id = Column(Integer, ForeignKey("topups.id"), nullable=True)

    amount_credit = Column(Float, default=0.0)   # в валюте магазина
    currency = Column(String(8), default="RUB")
    rate = Column(Float, default=0.10)           # 0.10 = 10%

    created_at = Column(Integer, default=now_ts)


# ------ Promo system ------

class PromoCode(Base):
    __tablename__ = "promo_codes"

    id = Column(Integer, primary_key=True)
    code = Column(String(64), unique=True, index=True, nullable=False)

    # 'markup' | 'balance' | 'discount'
    type = Column(String(16), nullable=False)

    # type=markup: установить наценку (например 2.0)
    markup_value = Column(Float, nullable=True)

    # type=balance: начислить USD
    balance_usd = Column(Float, nullable=True)

    # type=discount: скидка 0..1 (0.15 = 15%)
    discount_percent = Column(Float, nullable=True)

    # ограничения
    max_activations = Column(Integer, default=1)  # 0 — без лимита
    per_user_limit = Column(Integer, default=1)   # 0 — без лимита
    valid_from = Column(Integer, nullable=True)   # unixtime
    expires_at = Column(Integer, nullable=True)   # unixtime
    is_active = Column(Boolean, default=True)
    notes = Column(String(255), nullable=True)

    created_at = Column(Integer, default=now_ts)

    activations = relationship("PromoActivation", backref="promo", lazy="dynamic")

Index("ix_promo_codes_code_ci", PromoCode.code)

class PromoActivation(Base):
    __tablename__ = "promo_activations"

    id = Column(Integer, primary_key=True)
    code_id = Column(Integer, ForeignKey("promo_codes.id"), index=True, nullable=False)
    user_id = Column(Integer, ForeignKey("users.id"), index=True, nullable=False)
    order_id = Column(Integer, ForeignKey("orders.id"), nullable=True)

    amount_credit = Column(Float, nullable=True)     # сколько зачислили (в валюте магазина)
    discount_applied = Column(Float, nullable=True)  # скидка на заказ (в валюте заказа)

    created_at = Column(Integer, default=now_ts)
