# -*- coding: utf-8 -*-
import os
from pathlib import Path

try:
    from dotenv import load_dotenv
    load_dotenv()
except Exception:
    pass

BASE_DIR = Path(__file__).resolve().parent
ROOT_DIR = BASE_DIR.parent

BOT_TOKEN = os.getenv("BOT_TOKEN", "").strip()

WEBAPP_URL      = os.getenv("WEBAPP_URL", "https://meep1w.github.io/cortes-mini-app/").strip()
GROUP_URL       = os.getenv("GROUP_URL", "https://t.me/slovekiza_group").strip()
PUBLIC_CHAT_URL = os.getenv("PUBLIC_CHAT_URL", "https://t.me/slovekiza_chat").strip()
SCHOOL_URL      = os.getenv("SCHOOL_URL", "https://t.me/slovekiza_school").strip()
REVIEWS_URL     = os.getenv("REVIEWS_URL", "https://t.me/slovekiza_reviews").strip()

WELCOME_IMG_LOCAL = BASE_DIR / "assets" / "welcome.jpg"
WELCOME_IMAGE_URL = os.getenv(
    "WELCOME_IMAGE_URL",
    "https://images.unsplash.com/photo-1556157382-97eda2d62296?w=1280"
).strip()

DATA_DIR   = BASE_DIR / "data"
USERS_JSON = DATA_DIR / "users.json"

ALREADY_REGISTERED_ALERT = "Не получится пройти регистрацию: профиль уже создан."

def ensure_runtime_dirs():
    DATA_DIR.mkdir(parents=True, exist_ok=True)
