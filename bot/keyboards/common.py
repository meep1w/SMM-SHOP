# -*- coding: utf-8 -*-
from aiogram.types import InlineKeyboardMarkup, InlineKeyboardButton, WebAppInfo
from bot.config import WEBAPP_URL, REVIEWS_URL

from urllib.parse import quote, urlsplit, urlunsplit, parse_qsl, urlencode


def kb_register() -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(
        inline_keyboard=[
            [InlineKeyboardButton(text="🚀 Зарегистрироваться", callback_data="register")]
        ]
    )


def _url_with_nick(base_url: str, nick: str | None) -> str:
    """
    Добавляет параметр n=<nick> к WEBAPP_URL, аккуратно сохраняя
    существующие query-параметры (например ?v=12).
    """
    if not nick:
        return base_url
    parts = urlsplit(base_url)
    qs = dict(parse_qsl(parts.query, keep_blank_values=True))
    qs["n"] = nick  # не кодируем тут — urlencode сделает это сам
    new_query = urlencode(qs, doseq=True)
    return urlunsplit((parts.scheme, parts.netloc, parts.path, new_query, parts.fragment))


def kb_main_menu(nick: str | None) -> InlineKeyboardMarkup:
    """
    Главное меню.
    Если nick передан, добавляем n=<nick> в URL мини-аппы,
    чтобы в вебке отображался ник из регистрации.
    """
    webapp_url = _url_with_nick(WEBAPP_URL, nick)

    return InlineKeyboardMarkup(
        inline_keyboard=[
            [
                InlineKeyboardButton(
                    text="🛍 Открыть магазин",
                    web_app=WebAppInfo(url=webapp_url),
                )
            ],
            [
                InlineKeyboardButton(text="👥 Реф система", callback_data="menu:ref"),
                InlineKeyboardButton(text="🎰 Рулетка", callback_data="menu:roulette"),
            ],
            [
                InlineKeyboardButton(text="ℹ️ О магазине", callback_data="menu:about"),
                InlineKeyboardButton(text="💬 Отзывы", url=REVIEWS_URL),
            ],
        ]
    )
