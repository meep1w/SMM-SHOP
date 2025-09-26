# -*- coding: utf-8 -*-
from aiogram import Router, F
from aiogram.types import CallbackQuery
from aiogram.enums import ParseMode

router = Router()

@router.callback_query(F.data == "menu:ref")
async def on_ref(cb: CallbackQuery):
    text = (
        "👥 <b>Реферальная система</b>\n\n"
        "• Давайте друзьям вашу реф-ссылку и получайте % от их заказов.\n"
        "• Выплаты — автоматически на ваш баланс в боте.\n"
        "• Детали и ваша ссылка появятся здесь позже."
    )
    await cb.message.answer(text, parse_mode=ParseMode.HTML)
    await cb.answer()

@router.callback_query(F.data == "menu:about")
async def on_about(cb: CallbackQuery):
    text = (
        "ℹ️ <b>О магазине</b>\n\n"
        "Slovekiza — SMM-магазин с лучшими ценами и качеством. Работаем 24/7.\n"
        "• Telegram, Instagram, YouTube, TikTok и др.\n"
        "• Автоматические заказы, быстрые статусы, поддержка.\n"
        "• Интеграция с VEXBOOST. Скоро — личный кабинет в мини-аппе."
    )
    await cb.message.answer(text, parse_mode=ParseMode.HTML)
    await cb.answer()

@router.callback_query(F.data == "menu:roulette")
async def on_roulette(cb: CallbackQuery):
    await cb.answer("Страница «Рулетка» в разработке. Вернёмся позже ✨", show_alert=True)
