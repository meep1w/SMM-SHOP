# -*- coding: utf-8 -*-
import asyncio
import logging

from aiogram import Bot, Dispatcher
from aiogram.client.default import DefaultBotProperties
from aiogram.enums import ParseMode

# Импортируй токен оттуда, где он у тебя лежит
# Если у тебя config в bot/config.py:
from bot.config import BOT_TOKEN
# Если в bot/utils/config.py, то используй:
# from bot.utils.config import BOT_TOKEN

# Роутеры
from bot.handlers.start import router as start_router
from bot.handlers.registration import router as reg_router


async def main() -> None:
    logging.basicConfig(level=logging.INFO)

    # aiogram 3.7+: parse_mode задаётся через default
    bot = Bot(
        token=BOT_TOKEN,
        default=DefaultBotProperties(parse_mode=ParseMode.HTML),
    )

    dp = Dispatcher()
    dp.include_router(start_router)
    dp.include_router(reg_router)

    # Чистим «зависшие» апдейты и запускаем поллинг
    await bot.delete_webhook(drop_pending_updates=True)
    await dp.start_polling(bot)


if __name__ == "__main__":
    asyncio.run(main())
