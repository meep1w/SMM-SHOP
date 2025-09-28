# -*- coding: utf-8 -*-
import html
from typing import Optional

from aiogram import Router
from aiogram.filters import CommandStart
from aiogram.types import (
    Message, InlineKeyboardMarkup, InlineKeyboardButton,
    FSInputFile, CallbackQuery, WebAppInfo
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

# ---------------- UI ----------------

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

# ---------------- API helpers ----------------

async def api_get_user(user_id: int) -> Optional[dict]:
    """Вернёт профиль БЕЗ автосоздания или None, если его нет."""
    try:
        r = await _http.get(f"{API_BASE}/user", params={"user_id": user_id, "autocreate": 0})
        if r.status_code == 200:
            return r.json()
    except Exception:
        pass
    return None

def extract_start_payload(text: Optional[str]) -> str:
    if not text:
        return ""
    parts = text.split(maxsplit=1)
    return (parts[1] or "").strip() if len(parts) > 1 else ""

def try_extract_ref_code(payload: str) -> Optional[str]:
    if not payload:
        return None
    p = payload.strip().lower()
    if not p.startswith("ref_"):
        return None
    code = p[4:].strip()
    import re
    code = re.sub(r"[^a-z0-9_-]", "", code)
    return code or None

async def bind_ref_silently(user_id: int, code: str) -> None:
    """Тихая привязка реф-кода: не отправляем пользователю никаких сообщений."""
    try:
        await _http.post(f"{API_BASE}/referrals/bind", json={"user_id": user_id, "code": code})
    except Exception:
        pass

# ---------------- Handlers ----------------

@router.message(CommandStart())
async def start_cmd(m: Message):
    uid = m.from_user.id

    # 1) Если пришли по диплинку /start ref_xxx — привязываем код ТИХО
    payload = extract_start_payload(m.text)
    code = try_extract_ref_code(payload)
    if code:
        await bind_ref_silently(uid, code)

    # 2) Проверяем профиль без автосоздания
    u = api_get_user.__wrapped__  # silence linter in some editors
    u = await api_get_user(uid)

    # 3) Если профиля нет ИЛИ ник не задан — показываем привет и регистрацию
    if (u is None) or not u.get("nick"):
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

    # 4) Иначе — главное меню (без лишних уведомлений про реф-код)
    await send_main_menu(m)

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

# ------ простые заглушки меню ------

from aiogram import F as _F  # если уже был импорт F — можешь оставить как было
@router.callback_query(_F.data == "menu:about")
async def about_cb(c: CallbackQuery):
    await c.answer()
    await c.message.answer("Мы продаём услуги продвижения по лучшим ценам. Вопросы — в чат поддержки.")

@router.callback_query(_F.data == "menu:refs")
async def refs_cb(c: CallbackQuery):
    await c.answer()
    await c.message.answer("Реферальная статистика доступна в мини-апп (вкладка «Рефералы»).")

@router.callback_query(_F.data == "menu:roulette")
async def roulette_cb(c: CallbackQuery):
    await c.answer("В разработке", show_alert=True)
