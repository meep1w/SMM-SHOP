# -*- coding: utf-8 -*-
from __future__ import annotations

import html
from pathlib import Path
from typing import Optional

from aiogram.enums import ParseMode
from aiogram.types import Message, InlineKeyboardMarkup
from aiogram.types.input_file import FSInputFile


# Оборачивает текст в <code>...</code> с экранированием
def code(text: str) -> str:
    return f"<code>{html.escape(str(text))}</code>"


async def send_photo_with_caption_and_kb(
    msg: Message,
    caption: str,
    kb: Optional[InlineKeyboardMarkup] = None,
    parse_mode: ParseMode | str = ParseMode.HTML,
    photo_path: Optional[str] = None,
) -> None:
    """
    Надёжно отправляет 1 сообщением: картинка + текст + кнопки.
    Если не удалось отправить фото (файл не найден и т.п.) — делает graceful fallback на текст.
    """
    # 1) ищем картинку (по умолчанию bot/assets/welcome.jpg или welcome.png)
    photo_candidates = []
    if photo_path:
        photo_candidates.append(Path(photo_path))
    else:
        base = Path(__file__).resolve().parents[2] / "bot" / "assets"
        photo_candidates += [
            base / "welcome.jpg",
            base / "welcome.png",
        ]

    # 2) пробуем отправить фото
    for p in photo_candidates:
        try:
            if p.exists() and p.is_file():
                await msg.answer_photo(
                    photo=FSInputFile(str(p)),
                    caption=caption,
                    reply_markup=kb,
                    parse_mode=parse_mode,
                )
                return
        except Exception:
            # продолжим попытки/фоллбек ниже
            break

    # 3) если фото не нашли/не отправили — отправляем текст
    try:
        await msg.answer(
            text=caption,
            reply_markup=kb,
            parse_mode=parse_mode,
            disable_web_page_preview=True,
        )
    except Exception:
        # крайний случай: без parse_mode/кнопок
        await msg.answer(text=caption, disable_web_page_preview=True)
