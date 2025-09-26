# -*- coding: utf-8 -*-
from __future__ import annotations

import asyncio
import logging

from aiogram import Bot, Dispatcher, Router, F
from aiogram.enums import ParseMode
from aiogram.filters import Command, CommandStart
from aiogram.types import Message, BotCommand

from bot.config import BOT_TOKEN
# === твои роутеры ===
from bot.handlers import start as h_start
from bot.handlers import registration as h_registration
# Если есть другие модули с router — подключай по аналогии:
# from bot.handlers import menu as h_menu


async def set_commands(bot: Bot) -> None:
    commands = [
        BotCommand(command="start", description="Запуск"),
        BotCommand(command="help", description="Помощь"),
    ]
    await bot.set_my_commands(commands)


def make_fallback_router() -> Router:
    """На случай, если основной /start не сработал: простая подстраховка."""
    r = Router()

    @r.message(CommandStart())
    async def fallback_start(message: Message) -> None:
        await message.answer("Бот запущен. Если меню не появилось, напиши ещё раз /start.")

    @r.message(Command("help"))
    async def help_cmd(message: Message) -> None:
        await message.answer("Команда /help: отправь /start, чтобы открыть меню.")

    # Подстраховка если кто-то шлёт текстом "/start"
    @r.message(F.text.casefold() == "/start")
    async def fallback_start_text(message: Message) -> None:
        await fallback_start(message)

    return r


async def main() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
    )

    if not BOT_TOKEN:
        raise RuntimeError("BOT_TOKEN is empty")

    bot = Bot(BOT_TOKEN, parse_mode=ParseMode.HTML)
    dp = Dispatcher()

    # === Подключаем рабочие роутеры ===
    dp.include_router(h_start.router)
    dp.include_router(h_registration.router)
    # dp.include_router(h_menu.router)  # если есть

    # === Фоллбек-роутер в самом конце ===
    dp.include_router(make_fallback_router())

    await set_commands(bot)

    # Только нужные типы апдейтов — автоматически из подключённых хэндлеров
    allowed = dp.resolve_used_update_types()
    logging.info("Allowed updates: %s", allowed)

    await dp.start_polling(bot, allowed_updates=allowed)


if __name__ == "__main__":
    asyncio.run(main())
