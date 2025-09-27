# -*- coding: utf-8 -*-
import html
import random
import string
from aiogram import Router, F
from aiogram.filters import CommandStart
from aiogram.types import Message, InlineKeyboardMarkup, InlineKeyboardButton, FSInputFile, CallbackQuery, WebAppInfo

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
import httpx

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

async def api_user_exists(user_id: int) -> bool:
    try:
        r = await _http.get(f"{API_BASE}/user/exists", params={"user_id": user_id})
        return bool(r.json().get("exists"))
    except Exception:
        # если API недоступно — показываем меню, чтобы не блокировать пользователя
        return True

@router.message(CommandStart())
async def start_cmd(m: Message):
    uid = m.from_user.id

    exists = await api_user_exists(uid)
    if not exists:
        # первый раз — экран приветствия с кнопкой регистрации
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

    # уже зарегистрирован — сразу главное меню
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

# простые обработчики пунктов меню (заглушки)
@router.callback_query(F.data == "menu:about")
async def about_cb(c: CallbackQuery):
    await c.answer()
    await c.message.answer("Мы продаём услуги продвижения по лучшим ценам. Вопросы — в чат поддержки.")

@router.callback_query(F.data == "menu:refs")
async def refs_cb(c: CallbackQuery):
    await c.answer()
    await c.message.answer("Реферальная система скоро будет доступна. Следите за новостями.")

@router.callback_query(F.data == "menu:roulette")
async def roulette_cb(c: CallbackQuery):
    await c.answer("В разработке", show_alert=True)
