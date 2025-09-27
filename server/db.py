# -*- coding: utf-8 -*-
import os, time, math
from sqlalchemy import create_engine, Column, BigInteger, Integer, Text, Numeric, Boolean, DateTime, ForeignKey, func
from sqlalchemy.orm import declarative_base, sessionmaker
from pathlib import Path
from dotenv import load_dotenv
load_dotenv(Path(__file__).resolve().parents[1] / ".env")

DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./smmshop.sqlite3")

engine = create_engine(DATABASE_URL, pool_pre_ping=True, future=True)
SessionLocal = sessionmaker(bind=engine, expire_on_commit=False)
Base = declarative_base()

def now_ts() -> int:
    import time; return int(time.time())

def stable_seq(x) -> int:
    s = str(x); h = 0
    for ch in s: h = ((h << 5) - h + ord(ch)) & 0xFFFFFFFF
    return abs(h) % 100000 + 1

class User(Base):
    __tablename__ = "users"
    id = Column(BigInteger, primary_key=True, autoincrement=True)
    tg_id = Column(BigInteger, unique=True, nullable=False, index=True)
    seq = Column(Integer, nullable=False)
    nick = Column(Text)
    currency = Column(Text, nullable=False, default="RUB")
    balance = Column(Numeric(18,6), nullable=False, default=0)
    created_at = Column(Integer, default=now_ts)
    updated_at = Column(Integer, default=now_ts)
    last_seen_at = Column(Integer, default=now_ts)

class Service(Base):
    __tablename__ = "services"
    id = Column(BigInteger, primary_key=True)   # VEXBOOST ID
    network = Column(Text, index=True)
    name = Column(Text, nullable=False)
    type = Column(Text)
    min = Column(BigInteger)
    max = Column(BigInteger)
    rate_client_1000 = Column(Numeric(18,6))
    currency = Column(Text)
    description = Column(Text)
    updated_at = Column(Integer, default=now_ts)
    active = Column(Boolean, default=True, nullable=False)

class Favorite(Base):
    __tablename__ = "favorites"
    user_id = Column(BigInteger, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    service_id = Column(BigInteger, ForeignKey("services.id", ondelete="SET NULL"), primary_key=True)
    created_at = Column(Integer, default=now_ts)

class Topup(Base):
    __tablename__ = "topups"
    id = Column(BigInteger, primary_key=True, autoincrement=True)
    user_id = Column(BigInteger, ForeignKey("users.id", ondelete="CASCADE"))
    provider = Column(Text, nullable=False)    # 'cryptobot'
    invoice_id = Column(Text)
    amount_usd = Column(Numeric(18,6), nullable=False)
    currency = Column(Text, nullable=False, default="USD")
    status = Column(Text, nullable=False)      # created|paid|expired|failed
    applied = Column(Boolean, nullable=False, default=False)
    pay_url = Column(Text)
    created_at = Column(Integer, default=now_ts)
    updated_at = Column(Integer, default=now_ts)

class Order(Base):
    __tablename__ = "orders"
    id = Column(BigInteger, primary_key=True, autoincrement=True)
    user_id = Column(BigInteger, ForeignKey("users.id", ondelete="CASCADE"))
    service_id = Column(BigInteger)
    quantity = Column(BigInteger)
    link = Column(Text)
    cost = Column(Numeric(18,6), nullable=False)
    currency = Column(Text, nullable=False)
    status = Column(Text, nullable=False)      # Awaiting|In progress|Completed|...
    provider_id = Column(Text)                 # VEXBOOST order id
    created_at = Column(Integer, default=now_ts)
    updated_at = Column(Integer, default=now_ts)
