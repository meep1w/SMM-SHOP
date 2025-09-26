# -*- coding: utf-8 -*-
from aiogram.types import InlineKeyboardMarkup, InlineKeyboardButton

def kb_generate() -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text="🎲 Сгенерировать ник", callback_data="nick:gen")],
    ])

def kb_nick_suggestion(nick: str) -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text="✅ Использовать", callback_data=f"nick:use:{nick}")],
        [
            InlineKeyboardButton(text="➡️ Дальше", callback_data="nick:next"),
            InlineKeyboardButton(text="↩️ Отменить", callback_data="nick:cancel"),
        ],
    ])
