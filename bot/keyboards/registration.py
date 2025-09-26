# -*- coding: utf-8 -*-
from aiogram.types import InlineKeyboardMarkup, InlineKeyboardButton

# Кнопка регистрации (нужна /start)
def kb_register() -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(
        inline_keyboard=[
            [InlineKeyboardButton(text="🚀 Зарегистрироваться", callback_data="register")]
        ]
    )

# Экран: «Сгенерировать ник»
def kb_generate() -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(
        inline_keyboard=[
            [InlineKeyboardButton(text="🎲 Сгенерировать ник", callback_data="nick:gen")]
        ]
    )

# Экран с предложенным ником
def kb_nick_suggestion(nick: str) -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(
        inline_keyboard=[
            [InlineKeyboardButton(text="✅ Использовать", callback_data=f"nick:use:{nick}")],
            [
                InlineKeyboardButton(text="🔁 Дальше", callback_data="nick:next"),
                InlineKeyboardButton(text="✖️ Отменить", callback_data="nick:cancel"),
            ],
        ]
    )
