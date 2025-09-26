# -*- coding: utf-8 -*-
from __future__ import annotations

import html
from aiogram import Router
from aiogram.filters import CommandStart
from aiogram.types import Message
from aiogram.enums import ParseMode

from bot.keyboards.registration import kb_register
from bot.keyboards.common import kb_main_menu
from bot.storage.users import is_registered, get_nick
from bot.utils.messaging import send_photo_with_caption_and_kb
from bot.config import GROUP_URL, PUBLIC_CHAT_URL, SCHOOL_URL

router = Router()

WELCOME_CAPTION = (
    "<b>Добро пожаловать в магазин <a href=\"{group}\">Slovekiza</a>!</b>\n\n"
    "Продвигайте свои соц.сети, каналы и воронки по лучшим ценам — в любое время.\n\n"
    "Можете посетить мой <a href=\"{chat}\">открытый чат</a> "
    "или ознакомиться с моей <a href=\"{school}\">школой траффика</a>."
)

async def _show_main_menu(message: Message) -> None:
    nick = get_nick(message.from_user.id) or "друг"
    caption = (
        f"Привет, <b>{html.escape(nick)}</b>!\n"
        f"Это магазин <a href=\"{GROUP_URL}\">Slovekiza</a>.\n"
        "Продвигайте свои соц.сети, каналы и воронки по лучшим ценам — в любое время.\n\n"
        f"Можете посетить мой <a href=\"{PUBLIC_CHAT_URL}\">открытый чат</a> "
        f"или ознакомиться с моей <a href=\"{SCHOOL_URL}\">школой траффика</a>."
    )
    await send_photo_with_caption_and_kb(
        message, caption, kb_main_menu(nick), parse_mode=ParseMode.HTML
    )

async def _show_welcome(message: Message) -> None:
    await send_photo_with_caption_and_kb(
        message,
        WELCOME_CAPTION.format(group=GROUP_URL, chat=PUBLIC_CHAT_URL, school=SCHOOL_URL),
        kb_register(),
        parse_mode=ParseMode.HTML,
    )

# 1) Нормальный случай: стандартная команда /start (в т.ч. с deeplink)
@router.message(CommandStart(deep_link=True))
async def on_start_cmd(message: Message) -> None:
    if is_registered(message.from_user.id):
        await _show_main_menu(message)
    else:
        await _show_welcome(message)

# 2) Fallback: любое сообщение, начинающееся с "/start" (на случай, если CommandStart не сматчился)
@router.message(lambda m: isinstance(m.text, str) and m.text.strip().lower().startswith("/start"))
async def on_start_text(message: Message) -> None:
    if is_registered(message.from_user.id):
        await _show_main_menu(message)
    else:
        await _show_welcome(message)
