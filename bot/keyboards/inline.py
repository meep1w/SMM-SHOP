# -*- coding: utf-8 -*-
from aiogram.types import InlineKeyboardMarkup, InlineKeyboardButton, WebAppInfo
from bot.config import WEBAPP_URL, REVIEWS_URL


def kb_register() -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text="Зарегистрироваться", callback_data="reg:start")]
    ])


def kb_ask_nick() -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text="Сгенерировать ник", callback_data="reg:gen")]
    ])


def kb_gen_choice(nick: str) -> InlineKeyboardMarkup:
    # В callback_data помещаем ник (он короткий, укладывается в лимит Телеграма 64 байта)
    return InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text="✅ Использовать", callback_data=f"reguse:{nick}")],
        [InlineKeyboardButton(text="➡️ Дальше", callback_data="reg:gen")],
        [InlineKeyboardButton(text="❌ Отменить", callback_data="reg:cancel")],
    ])


def kb_main_menu() -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text="🛍 Открыть магазин",
                              web_app=WebAppInfo(url=WEBAPP_URL))],
        [
            InlineKeyboardButton(text="👥 Реф система", callback_data="menu:ref"),
            InlineKeyboardButton(text="🎰 Рулетка",
                                 web_app=WebAppInfo(url=f"{WEBAPP_URL}#roulette")),
        ],
        [
            InlineKeyboardButton(text="ℹ️ О магазине", callback_data="menu:about"),
            InlineKeyboardButton(text="💬 Отзывы", url=REVIEWS_URL),
        ],
    ])
