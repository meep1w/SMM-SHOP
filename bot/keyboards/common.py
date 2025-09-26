# -*- coding: utf-8 -*-
from aiogram.types import InlineKeyboardMarkup, InlineKeyboardButton, WebAppInfo
from bot.config import WEBAPP_URL, REVIEWS_URL

def kb_register() -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text="🚀 Зарегистрироваться", callback_data="register")]
    ])

def kb_main_menu() -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text="🛍 Открыть магазин", web_app=WebAppInfo(url=WEBAPP_URL))],
        [
            InlineKeyboardButton(text="👥 Реф система", callback_data="menu:ref"),
            InlineKeyboardButton(text="🎰 Рулетка", callback_data="menu:roulette"),
        ],
        [
            InlineKeyboardButton(text="ℹ️ О магазине", callback_data="menu:about"),
            InlineKeyboardButton(text="💬 Отзывы", url=REVIEWS_URL),
        ],
    ])
