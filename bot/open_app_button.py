# -*- coding: utf-8 -*-
import os
from aiogram import Router, types
from aiogram.filters import CommandStart, Command
from aiogram.types import InlineKeyboardMarkup, InlineKeyboardButton, WebAppInfo, ReplyKeyboardRemove

router = Router(name="open_app")

WEBAPP_URL = os.getenv("WEBAPP_URL", "https://slovekinzshop.net").rstrip("/")

# Inline-кнопка, которая открывает мини-апп СРАЗУ на весь экран
open_app_kb = InlineKeyboardMarkup(inline_keyboard=[[
    InlineKeyboardButton(
        text="Открыть магазин",
        web_app=WebAppInfo(url=WEBAPP_URL)
    )
]])

@router.message(CommandStart())
async def start(m: types.Message):
    # убираем старую reply-клавиатуру, если была
    await m.answer("Готово, открываю мини-апп 👇", reply_markup=ReplyKeyboardRemove())
    # отправляем inline-кнопку (full-screen)
    await m.answer("Жми кнопку:", reply_markup=open_app_kb)

# дублирующая команда, если нужно вызвать в любой момент
@router.message(Command("app"))
async def cmd_app(m: types.Message):
    await m.answer("Открыть мини-апп:", reply_markup=open_app_kb)
