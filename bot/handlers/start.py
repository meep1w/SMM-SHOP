# -*- coding: utf-8 -*-
import html
from aiogram import Router
from aiogram.filters import CommandStart
from aiogram.types import Message

from bot.storage.users import is_registered, get_nick
from bot.keyboards.common import kb_register, kb_main_menu
from bot.utils.messaging import send_photo_with_caption_and_kb
from bot.config import GROUP_URL, PUBLIC_CHAT_URL, SCHOOL_URL

router = Router()

@router.message(CommandStart())
async def cmd_start(message: Message):
    if is_registered(message.from_user.id):
        nick = get_nick(message.from_user.id) or "друг"
        caption = (
            f"Привет, <b>{html.escape(nick)}</b>!\n"
            f"Это магазин <a href=\"{GROUP_URL}\">Slovekiza</a>.\n"
            "Продвигайте свои соц.сети, каналы и воронки по лучшим ценам — в любое время.\n\n"
            f"Можете посетить мой <a href=\"{PUBLIC_CHAT_URL}\">открытый чат</a> "
            f"или ознакомиться с моей <a href=\"{SCHOOL_URL}\">школой траффика</a>."
        )
        await send_photo_with_caption_and_kb(message, caption, kb_main_menu())
        return

    caption = (
        "<b>Добро пожаловать!</b>\n"
        "Это магазин продвижения соцсетей и воронок. Лучшие цены, быстро и удобно.\n\n"
        "Нажмите «Зарегистрироваться», чтобы продолжить."
    )
    await send_photo_with_caption_and_kb(message, caption, kb_register())
