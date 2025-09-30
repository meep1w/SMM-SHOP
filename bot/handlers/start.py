# bot/handlers/start.py
# -*- coding: utf-8 -*-
import html
import re
from typing import Optional

from aiogram import Router
from aiogram.filters import CommandStart
from aiogram.types import (
    Message,
    CallbackQuery,
    InlineKeyboardMarkup,
    InlineKeyboardButton,
    FSInputFile,
    WebAppInfo,
)
import httpx

from bot.config import (
    API_BASE,
    WEBAPP_URL,
    GROUP_URL,
    PUBLIC_CHAT_URL,
    SCHOOL_URL,
    REVIEWS_URL,
    WELCOME_IMG,
    MENU_IMG,
)

router = Router()
_http = httpx.AsyncClient(timeout=15.0)

# ---------- UI ----------
def kb_welcome() -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text="Зарегистрироваться", callback_data="reg:start")]
    ])

def kb_main() -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text="🛍 Открыть магазин", web_app=WebAppInfo(url=WEBAPP_URL))],
        [InlineKeyboardButton(text="👥 Реф система", callback_data="menu:refs"),
         InlineKeyboardButton(text="🎰 Рулетка",     callback_data="menu:roulette")],
        [InlineKeyboardButton(text="ℹ️ О магазине", callback_data="menu:about"),
         InlineKeyboardButton(text="💬 Отзывы",     url=REVIEWS_URL or PUBLIC_CHAT_URL or GROUP_URL)],
    ])

# ---------- API helpers ----------
async def api_fetch_user(user_id: int, autocreate: int = 1) -> Optional[dict]:
    """Пробуем получить профиль (по возможности создаём)."""
    try:
        r = await _http.get(f"{API_BASE}/user", params={"user_id": user_id, "autocreate": autocreate})
        return r.json() if r.status_code == 200 else None
    except Exception:
        return None

async def api_user_exists(user_id: int) -> bool:
    try:
        r = await _http.get(f"{API_BASE}/user/exists", params={"user_id": user_id})
        return bool(r.status_code == 200 and r.json().get("exists"))
    except Exception:
        return False

async def bind_ref_silently(user_id: int, code: str) -> None:
    try:
        await _http.post(f"{API_BASE}/referrals/bind", json={"user_id": user_id, "code": code})
    except Exception:
        pass

# ---------- utils ----------
def extract_ref_code(text: Optional[str]) -> Optional[str]:
    if not text:
        return None
    parts = text.split(maxsplit=1)
    if len(parts) < 2:
        return None
    payload = parts[1].strip().lower()
    if not payload.startswith("ref_"):
        return None
    code = re.sub(r"[^a-z0-9_-]", "", payload[4:])
    return code or None

# ---------- handlers ----------
@router.message(CommandStart())
async def start_cmd(m: Message):
    uid = m.from_user.id

    # тихо биндим реф-код из /start ref_xxx
    code = extract_ref_code(m.text)
    if code:
        await bind_ref_silently(uid, code)

    # 1) основной путь — пробуем получить/создать профиль
    u = await api_fetch_user(uid, autocreate=1)

    # 2) если профиль есть и ник задан — сразу в меню
    if u and u.get("nick"):
        await send_main_menu(m)
        return

    # 3) если профиль есть, но без ника — показываем регистрацию
    if u is not None and not u.get("nick"):
        caption = (
            "<b>Добро пожаловать в магазин "
            f"<a href=\"{html.escape(GROUP_URL or PUBLIC_CHAT_URL or '#')}\">Slovekiza</a>!</b>\n\n"
            "Для продолжения зарегистрируй никнейм. Его нельзя будет изменить или передать."
        )
        photo = FSInputFile(WELCOME_IMG) if WELCOME_IMG.exists() else None
        if photo:
            await m.answer_photo(photo, caption=caption, reply_markup=kb_welcome())
        else:
            await m.answer(caption, reply_markup=kb_welcome())
        return

    # 4) запасной путь — API не ответил: проверим exists и не будем ломать UX
    if await api_user_exists(uid):
        await send_main_menu(m)
        return

    # 5) совсем новый пользователь — показываем привет и регистрацию
    caption = (
        "<b>Добро пожаловать в магазин "
        f"<a href=\"{html.escape(GROUP_URL or PUBLIC_CHAT_URL or '#')}\">Slovekiza</a>!</b>\n\n"
        "Продвигайте свои соц.сети, каналы и воронки по лучшим ценам — в любое время.\n\n"
        f"Можете посетить мой <a href=\"{html.escape(PUBLIC_CHAT_URL or GROUP_URL or '#')}\">открытый чат</a> "
        f"или ознакомиться с моей <a href=\"{html.escape(SCHOOL_URL or '#')}\">школой траффика</a>."
    )
    photo = FSInputFile(WELCOME_IMG) if WELCOME_IMG.exists() else None
    if photo:
        await m.answer_photo(photo, caption=caption, reply_markup=kb_welcome())
    else:
        await m.answer(caption, reply_markup=kb_welcome())

async def send_main_menu(m: Message | CallbackQuery, nick: str | None = None):
    text = (
        f"Привет{',' if nick else ''} <b>{html.escape(nick) if nick else m.from_user.full_name}</b>!\n"
        f"Это магазин <a href=\"{html.escape(GROUP_URL or '#')}\">Slovekizna</a>.\n"
        "Продвигайте свои соц.сети, каналы и воронки по лучшим ценам — в любое время.\n\n"
        f"Можете посетить мой <a href=\"{html.escape(PUBLIC_CHAT_URL or GROUP_URL or '#')}\">открытый чат</a> "
        f"или ознакомиться с моей <a href=\"{html.escape(SCHOOL_URL or '#')}\">школой траффика</a>."
    )
    photo = FSInputFile(MENU_IMG) if MENU_IMG.exists() else None
    if isinstance(m, CallbackQuery):
        if photo:
            await m.message.answer_photo(photo, caption=text, reply_markup=kb_main())
        else:
            await m.message.answer(text, reply_markup=kb_main())
        await m.answer()
    else:
        if photo:
            await m.answer_photo(photo, caption=text, reply_markup=kb_main())
        else:
            await m.answer(text, reply_markup=kb_main())
