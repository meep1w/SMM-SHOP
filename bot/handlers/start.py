# -*- coding: utf-8 -*-
from __future__ import annotations

import html
from aiogram import Router
from aiogram.filters import CommandStart
from aiogram.types import Message
from aiogram.enums import ParseMode

from bot.keyboards.common import kb_register
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


@router.message(CommandStart())
async def on_start(message: Message) -> None:
    user_id = message.from_user.id

    if is_registered(user_id):
        # Уже зарегистрирован → сразу главное меню
        nick = get_nick(user_id) or "друг"
        caption = (
            f"Привет, <b>{html.escape(nick)}</b>!\n"
            f"Это магазин <a href=\"{GROUP_URL}\">Slovekiza</a>.\n"
            "Продвигайте свои соц.сети, каналы и воронки по лучшим ценам — в любое время.\n\n"
            f"Можете посетить мой <a href=\"{PUBLIC_CHAT_URL}\">открытый чат</a> "
            f"или ознакомиться с моей <a href=\"{SCHOOL_URL}\">школой траффика</a>."
        )
        await send_photo_with_caption_and_kb(
            message,
            caption,
            kb_main_menu(nick),
            parse_mode=ParseMode.HTML,
        )
        return

    # Не зарегистрирован → привет и кнопка «Зарегистрироваться»
    await send_photo_with_caption_and_kb(
        message,
        WELCOME_CAPTION.format(group=GROUP_URL, chat=PUBLIC_CHAT_URL, school=SCHOOL_URL),
        kb_register(),
        parse_mode=ParseMode.HTML,
    )
