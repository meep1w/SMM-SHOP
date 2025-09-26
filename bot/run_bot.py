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
# from bot.handlers import menu as h_menu  # если есть

# aiogram 3.7+ убрал parse_mode из Bot(...). Делаем кросс-версионно:
def _bot_kwargs():
    try:
        # aiogram >= 3.7.0
        from aiogram.client.default import DefaultBotProperties
        return {"default": DefaultBotProperties(parse_mode=ParseMode.HTML)}
    except Exception:
        # aiogram < 3.7.0
        return {"parse_mode": ParseMode.HTML}


async def set_commands(bot: Bot) -> None:
    commands = [
        BotCommand(command="start", description="Запуск"),
        BotCommand(command="help", description="Помощь"),
    ]
    await bot.set_my_commands(commands)


def make_fallback_router() -> Router:
    """Подстраховочный роутер на случай, если основной /start не сработал."""
    r = Router()

    @r.message(CommandStart())
    async def fallback_start(message: Message) -> None:
        await message.answer("Бот запущен. Если меню не появилось, отправь /start ещё раз.")

    @r.message(Command("help"))
    async def help_cmd(message: Message) -> None:
        await message.answer("Команда /help: отправь /start, чтобы открыть меню.")

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

    bot = Bot(BOT_TOKEN, **_bot_kwargs())
    dp = Dispatcher()

    # === Подключаем рабочие роутеры ===
    dp.include_router(h_start.router)
    dp.include_router(h_registration.router)
    # dp.include_router(h_menu.router)

    # === Фоллбек-роутер в самом конце ===
    dp.include_router(make_fallback_router())

    await set_commands(bot)

    allowed = dp.resolve_used_update_types()
    logging.info("Allowed updates: %s", allowed)

    await dp.start_polling(bot, allowed_updates=allowed)


if __name__ == "__main__":
    asyncio.run(main())
