# -*- coding: utf-8 -*-
import asyncio
from aiogram import Bot, Dispatcher
from aiogram.enums import ParseMode
from aiogram.fsm.storage.memory import MemoryStorage

from bot.config import BOT_TOKEN  # если у тебя иначе – подставь свой импорт

# РОУТЕРЫ
from bot.handlers import start, registration

async def main():
    bot = Bot(token=BOT_TOKEN, parse_mode=ParseMode.HTML)
    dp = Dispatcher(storage=MemoryStorage())

    # ВАЖНО: порядок не критичен, но оба роутера должны быть подключены
    dp.include_router(start.router)
    dp.include_router(registration.router)

    print("Bot polling started...")
    await dp.start_polling(bot)

if __name__ == "__main__":
    asyncio.run(main())
