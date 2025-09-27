# -*- coding: utf-8 -*-
import html
import random
import re
from pathlib import Path

import httpx
from aiogram import Router, F
from aiogram.filters import CommandStart
from aiogram.fsm.context import FSMContext
from aiogram.types import Message, CallbackQuery, FSInputFile

from bot.config import (
    API_BASE,
    GROUP_URL,
    PUBLIC_CHAT_URL,
    SCHOOL_URL,
)
from bot.keyboards.inline import (
    kb_register, kb_ask_nick, kb_gen_choice, kb_main_menu,
)
from bot.states.registration import RegStates

router = Router()
_http = httpx.AsyncClient(timeout=20.0)

WELCOME_IMG = Path("bot/assets/welcome.jpg")
MENU_IMG = Path("bot/assets/menu.jpg")


# ---------- Вспомогательное ----------
def nice(text: str) -> str:
    return text.replace("_", r"\_")  # если где-то решишь отправить с Markdown

NICK_RX = re.compile(r"^[A-Za-z0-9_]{3,20}$")


def make_random_nick() -> str:
    left = ["Zen", "Neo", "Nova", "Sky", "Flux", "Byte", "Dark", "Lite", "Vex", "Kiza"]
    right = ["Fox", "Wolf", "Rider", "Scout", "Ops", "Edge", "Dash", "Core", "Flow", "Jet"]
    nick = f"{random.choice(left)}{random.choice(right)}{random.randint(10, 999)}"
    return nick[:20]


async def api_get_user(tg_id: int) -> dict:
    r = await _http.get(f"{API_BASE}/user", params={"user_id": tg_id, "consume_topup": 0})
    r.raise_for_status()
    return r.json()


async def api_try_set_nick(tg_id: int, nick: str) -> dict:
    # пытаемся записать ник на сервере (нельзя менять, если уже установлен)
    r = await _http.get(f"{API_BASE}/user", params={"user_id": tg_id, "nick": nick})
    if r.status_code == 409:
        # ник занят/недоступен
        return {"ok": False, "reason": "taken"}
    r.raise_for_status()
    return {"ok": True, "data": r.json()}


# ---------- Экран меню ----------
async def send_main_menu(message: Message, nick: str) -> None:
    caption = (
        f"Привет, <b>{html.escape(nick)}</b>!\n"
        f"Это магазин <a href=\"{GROUP_URL}\">Slovekizna</a>.\n"
        "Продвигайте свои соц.сети, каналы и воронки по лучшим ценам — в любое время.\n\n"
        f"Можете посетить мой <a href=\"{PUBLIC_CHAT_URL}\">открытый чат</a> "
        f"или ознакомиться с моей <a href=\"{SCHOOL_URL}\">школой траффика</a>."
    )
    if MENU_IMG.exists():
        await message.answer_photo(
            photo=FSInputFile(MENU_IMG),
            caption=caption,
            parse_mode="HTML",
            reply_markup=kb_main_menu(),
        )
    else:
        await message.answer(caption, parse_mode="HTML", reply_markup=kb_main_menu())


# ---------- /start ----------
@router.message(CommandStart())
async def on_start(message: Message, state: FSMContext):
    await state.clear()
    data = await api_get_user(message.from_user.id)
    # Если ник уже есть → сразу главное меню
    if data.get("nick"):
        await send_main_menu(message, data["nick"])
        return

    # Пользователь ещё не зарегистрирован
    caption = (
        "<b>Добро пожаловать в магазин "
        f"<a href=\"{GROUP_URL}\">Slovekinza</a>!</b>\n\n"
        "Продвигайте свои соц.сети, каналы и воронки по лучшим ценам — в любое время.\n\n"
        f"Можете посетить мой <a href=\"{PUBLIC_CHAT_URL}\">открытый чат</a> "
        f"или ознакомиться с моей <a href=\"{SCHOOL_URL}\">школой траффика</a>."
    )
    if WELCOME_IMG.exists():
        await message.answer_photo(
            photo=FSInputFile(WELCOME_IMG),
            caption=caption,
            parse_mode="HTML",
            reply_markup=kb_register(),
        )
    else:
        await message.answer(caption, parse_mode="HTML", reply_markup=kb_register())


# ---------- Кнопка «Зарегистрироваться» ----------
@router.callback_query(F.data == "reg:start")
async def cb_reg_start(cq: CallbackQuery, state: FSMContext):
    user = await api_get_user(cq.from_user.id)
    if user.get("nick"):
        # защита — уже зарегистрирован
        await cq.answer("Вы уже зарегистрированы.", show_alert=True)
        return

    text = (
        "Для регистрации нужно придумать <b>уникальный никнейм</b>.\n"
        "Его нельзя будет изменить или передать.\n\n"
        "✍️ Напишите свой ник сообщением <u>или</u> нажмите «Сгенерировать ник»."
    )
    await cq.message.answer(text, parse_mode="HTML", reply_markup=kb_ask_nick())
    await state.set_state(RegStates.waiting_nick)
    await cq.answer()


# ---------- Свободный ввод ника ----------
@router.message(RegStates.waiting_nick)
async def on_nick_typed(message: Message, state: FSMContext):
    raw = (message.text or "").strip()
    if not NICK_RX.fullmatch(raw):
        await message.answer("Ник может содержать A–Z, a–z, 0–9 и _; длина от 3 до 20 символов.")
        return

    # пробуем записать ник на бэкенде
    res = await api_try_set_nick(message.from_user.id, raw)
    if not res["ok"]:
        await message.answer("Такой ник уже занят. Попробуйте другой или сгенерируйте.")
        return

    await state.clear()
    await send_main_menu(message, raw)


# ---------- Генерация ника ----------
@router.callback_query(F.data == "reg:gen")
async def cb_reg_gen(cq: CallbackQuery, state: FSMContext):
    user = await api_get_user(cq.from_user.id)
    if user.get("nick"):
        await cq.answer("Ник уже закреплён за вами.", show_alert=True)
        return

    nick = make_random_nick()
    text = f"Вариант ника: <code>{html.escape(nick)}</code>\n\nВыберите действие:"
    await cq.message.answer(text, parse_mode="HTML", reply_markup=kb_gen_choice(nick))
    await state.set_state(RegStates.waiting_nick)
    await cq.answer()


# Использовать сгенерированный
@router.callback_query(F.data.startswith("reguse:"))
async def cb_reg_use(cq: CallbackQuery, state: FSMContext):
    user = await api_get_user(cq.from_user.id)
    if user.get("nick"):
        await cq.answer("Вы уже зарегистрированы.", show_alert=True)
        return

    nick = cq.data.split(":", 1)[1].strip()
    if not NICK_RX.fullmatch(nick):
        await cq.answer("Неверный ник.", show_alert=True)
        return

    res = await api_try_set_nick(cq.from_user.id, nick)
    if not res["ok"]:
        await cq.answer("Ник уже занят. Нажмите «Дальше», чтобы сгенерировать другой.", show_alert=True)
        return

    await state.clear()
    await cq.message.answer("Готово! Ник закреплён.")
    # Главное меню
    fake_msg = cq.message  # используем контекст для отправки
    await send_main_menu(fake_msg, nick)
    await cq.answer()


# Отмена генерации (просто напоминание)
@router.callback_query(F.data == "reg:cancel")
async def cb_reg_cancel(cq: CallbackQuery, state: FSMContext):
    await cq.answer()
    await cq.message.answer(
        "Хорошо 🙂 Напишите свой ник сообщением или нажмите «Сгенерировать ник».",
        reply_markup=kb_ask_nick()
    )
    await state.set_state(RegStates.waiting_nick)


# ---------- Пункты главного меню ----------
@router.callback_query(F.data == "menu:ref")
async def cb_menu_ref(cq: CallbackQuery):
    await cq.answer()
    txt = (
        "👥 <b>Реферальная система</b>\n\n"
        "Приглашайте друзей — получайте бонусы от их покупок.\n"
        "Подробности и ваша ссылка доступны в мини-приложении в разделе «Рефералы»."
    )
    await cq.message.answer(txt, parse_mode="HTML")


@router.callback_query(F.data == "menu:about")
async def cb_menu_about(cq: CallbackQuery):
    await cq.answer()
    txt = (
        "ℹ️ <b>О магазине</b>\n\n"
        "Slovekinza — витрина услуг SMM. Автоматические заказы, честные цены, поддержка."
    )
    await cq.message.answer(txt, parse_mode="HTML")
