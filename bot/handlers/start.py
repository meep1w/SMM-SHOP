# -*- coding: utf-8 -*-
import html
import httpx
from aiogram import Router
from aiogram.filters import CommandStart
from aiogram.types import (
    Message, CallbackQuery, InlineKeyboardMarkup, InlineKeyboardButton,
    FSInputFile, WebAppInfo,
)

from bot.config import (
    API_BASE, WEBAPP_URL, GROUP_URL, PUBLIC_CHAT_URL, SCHOOL_URL, REVIEWS_URL,
    WELCOME_IMG, MENU_IMG,
)
from .registration import *  # если нужно, но главное — import send_main_menu ниже
from .start import send_main_menu as _send_main_menu  # если у тебя в другом файле — поправь импорт
# Если send_main_menu в этом же файле — оставь как есть, ниже я его тоже даю.

router = Router()
_http = httpx.AsyncClient(timeout=15.0)

def kb_welcome() -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text="Зарегистрироваться", callback_data="reg:start")]
    ])

def kb_main() -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text="🛍 Открыть магазин", web_app=WebAppInfo(url=WEBAPP_URL))],
        [
            InlineKeyboardButton(text="👥 Реф система", callback_data="menu:refs"),
            InlineKeyboardButton(text="🎰 Рулетка",     callback_data="menu:roulette"),
        ],
        [
            InlineKeyboardButton(text="ℹ️ О магазине", callback_data="menu:about"),
            InlineKeyboardButton(text="💬 Отзывы",     url=REVIEWS_URL or PUBLIC_CHAT_URL or GROUP_URL),
        ],
    ])

async def api_get_user(user_id: int):
    """Вернёт dict пользователя без автосоздания или None (404)."""
    try:
        r = await _http.get(f"{API_BASE}/user", params={"user_id": user_id, "autocreate": 0})
        if r.status_code == 200:
            return r.json()
    except Exception:
        pass
    return None

async def bind_if_ref_code(user_id: int, payload: str) -> bool:
    """Тихо применяем реф-код, если пришли по ссылке /start ref_xxx."""
    if not payload or not payload.startswith("ref_"):
        return False
    code = payload[4:].strip().lower()
    if not code:
        return False
    try:
        r = await _http.post(f"{API_BASE}/referrals/bind", json={"user_id": user_id, "code": code})
        # 200 — привязали, 409 — уже привязан/некорректен — всё равно идём дальше без сообщений
        return r.status_code in (200, 409)
    except Exception:
        return False

@router.message(CommandStart())
async def start_cmd(m: Message):
    uid = m.from_user.id
    payload = (m.text.split(" ", 1)[1] if m.text and " " in m.text else "")

    # 1) Привязываем код тихо (без лишних сообщений)
    await bind_if_ref_code(uid, payload)

    # 2) Проверяем профиль без автосоздания
    u = await api_get_user(uid)

    # 3) Если юзера нет ИЛИ у него нет ника — показываем регистрацию
    if (u is None) or (not u.get("nick")):
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
        return

    # 4) Иначе сразу главное меню
    await send_main_menu(m)

# Если у тебя send_main_menu не в этом файле — используй импорт выше и удали это.
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
