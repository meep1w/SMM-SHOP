# -*- coding: utf-8 -*-
"""
Запуск:  python -m bot.run_bot
(или python bot/run_bot.py — тоже сработает)
"""
import asyncio
import sys
from pathlib import Path

# гарантируем импорт пакета bot при прямом запуске файла
THIS_DIR = Path(__file__).resolve().parent
ROOT_DIR = THIS_DIR.parent
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from aiogram import Bot, Dispatcher
from aiogram.fsm.storage.memory import MemoryStorage

from bot.config import BOT_TOKEN, ensure_runtime_dirs
from bot.handlers import start as h_start
from bot.handlers import registration as h_reg
from bot.handlers import menu as h_menu

async def main():
    if not BOT_TOKEN:
        raise RuntimeError("Укажи BOT_TOKEN в .env")

    ensure_runtime_dirs()

    bot = Bot(BOT_TOKEN)
    dp = Dispatcher(storage=MemoryStorage())

    dp.include_router(h_start.router)
    dp.include_router(h_reg.router)
    dp.include_router(h_menu.router)

    print("Bot is running...")
    await dp.start_polling(bot)

if __name__ == "__main__":
    try:
        asyncio.run(main())
    except (KeyboardInterrupt, SystemExit):
        print("Bot stopped")
