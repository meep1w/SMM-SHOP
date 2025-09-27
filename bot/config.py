# -*- coding: utf-8 -*-
import os
from pathlib import Path

# .env читаем из корня проекта (/opt/smmshop/.env)
try:
    from dotenv import load_dotenv
    load_dotenv(Path(__file__).resolve().parents[1] / ".env")
except Exception:
    pass

# ── базовые пути ──────────────────────────────────────────────────────────────
BASE_DIR = Path(__file__).resolve().parent         # /bot
ROOT_DIR = BASE_DIR.parent                          # /opt/smmshop

# ── токен бота ────────────────────────────────────────────────────────────────
BOT_TOKEN = os.getenv("BOT_TOKEN", "").strip()

# ── ссылки/адреса ─────────────────────────────────────────────────────────────
# URL мини-приложения (без слэша на конце)
WEBAPP_URL = (os.getenv("WEBAPP_URL", "https://slovekinzshop.net").strip()
              .rstrip("/"))

# Бэкенд API (если переменная не задана — берём из WEBAPP_URL)
API_BASE = os.getenv("API_BASE", f"{WEBAPP_URL}/api/v1").strip().rstrip("/")

GROUP_URL       = os.getenv("GROUP_URL",       "https://t.me/slovekinzshop").strip()
PUBLIC_CHAT_URL = os.getenv("PUBLIC_CHAT_URL", "https://t.me/slovekinzchat").strip()
SCHOOL_URL      = os.getenv("SCHOOL_URL",      "https://traffschool.net/").strip()
REVIEWS_URL     = os.getenv("REVIEWS_URL",     "https://t.me/slovekinzhopfeedback").strip()

# ── картинки для сообщений ────────────────────────────────────────────────────
ASSETS_DIR        = BASE_DIR / "assets"
WELCOME_IMG = BASE_DIR / "assets" / "welcome.jpg"
MENU_IMG    = BASE_DIR / "assets" / "menu.jpg"
# Фолбэк-картинка, если локального файла нет (необязательно)
WELCOME_IMAGE_URL = os.getenv(
    "WELCOME_IMAGE_URL",
    "https://images.unsplash.com/photo-1556157382-97eda2d62296?w=1280"
).strip()

# ── тексты/алерты ─────────────────────────────────────────────────────────────
ALREADY_REGISTERED_ALERT = "Не получится пройти регистрацию: профиль уже создан."

# ── утилита: гарантировать наличие папки с ассетами ──────────────────────────
def ensure_runtime_dirs() -> None:
    ASSETS_DIR.mkdir(parents=True, exist_ok=True)
