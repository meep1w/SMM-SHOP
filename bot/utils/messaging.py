# -*- coding: utf-8 -*-
import html
from typing import Optional

from aiogram.enums import ParseMode
from aiogram.types import Message, InlineKeyboardMarkup, FSInputFile

from bot.config import WELCOME_IMG_LOCAL, WELCOME_IMAGE_URL

async def send_photo_with_caption_and_kb(
    target: Message,
    caption: str,
    keyboard: Optional[InlineKeyboardMarkup] = None,
):
    # Сначала локальный файл, потом URL, потом текст
    try:
        if WELCOME_IMG_LOCAL.exists():
            return await target.answer_photo(
                photo=FSInputFile(str(WELCOME_IMG_LOCAL)),
                caption=caption,
                parse_mode=ParseMode.HTML,
                reply_markup=keyboard,
            )
    except Exception:
        pass
    try:
        return await target.answer_photo(
            photo=WELCOME_IMAGE_URL,
            caption=caption,
            parse_mode=ParseMode.HTML,
            reply_markup=keyboard,
        )
    except Exception:
        return await target.answer(
            caption, parse_mode=ParseMode.HTML, reply_markup=keyboard
        )

def code(s: str) -> str:
    return f"<code>{html.escape(s)}</code>"
