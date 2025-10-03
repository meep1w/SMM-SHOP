# bot/handlers/registration.py
# -*- coding: utf-8 -*-
import html
import random
import string
from typing import Tuple, Optional

from aiogram import Router, F
from aiogram.types import CallbackQuery, Message, InlineKeyboardMarkup, InlineKeyboardButton
from aiogram.fsm.state import StatesGroup, State
from aiogram.fsm.context import FSMContext
import httpx

from bot.config import API_BASE
from .start import send_main_menu, api_fetch_user  # используем готовый helper

router = Router()
_http = httpx.AsyncClient(timeout=15.0)

# ====== FSM ======
class RegStates(StatesGroup):
    waiting_nick = State()

# ====== Keyboards ======
def kb_nick_prompt() -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text="🎲 Сгенерировать ник", callback_data="reg:gen")]
    ])

def kb_gen(nick: str) -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text="✅ Использовать", callback_data=f"reg:use:{nick}")],
        [
            InlineKeyboardButton(text="⏭ Дальше",  callback_data="reg:next"),
            InlineKeyboardButton(text="✖ Отменить", callback_data="reg:cancel"),
        ],
    ])

# ====== Helpers ======
ALLOWED_CHARS = set("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-.")
def sanitize_nick(raw: str) -> str:
    n = (raw or "").strip().replace(" ", "_")
    n = "".join(ch for ch in n if ch in ALLOWED_CHARS)
    # сервер требует 3..32 — жёстко режем сверху
    return n[:32]

def make_random_nick() -> str:
    base = random.choice(["CTR", "Click", "Ops", "Flow", "Lead", "Vibe", "Nova", "Rider", "Drago"])
    suffix = "".join(random.choices(string.ascii_uppercase + string.digits, k=2))
    num = random.randint(10, 99)
    return f"{base}_{suffix}{num}"

async def has_nick(user_id: int) -> bool:
    """
    Возвращает True, если у пользователя уже есть ник (а значит регистрация не нужна).
    Одновременно «греет» профиль (autocreate=1).
    """
    try:
        u = await api_fetch_user(user_id, autocreate=1)
        return bool(u and u.get("nick"))
    except Exception:
        # на сетевых ошибках не блокируем регистрацию
        return False

async def api_register(user_id: int, nick: str) -> Tuple[bool, str]:
    """
    True,''                       -> регистрация ок
    True,'exists'                 -> профиль уже создан (с ником) — считаем успехом
    False,'taken'                 -> ник занят
    False,<user-friendly message> -> любая другая ошибка
    """
    try:
        r = await _http.post(f"{API_BASE}/register", json={"user_id": user_id, "nick": nick})
        if r.status_code == 200:
            return True, ""
        if r.status_code == 409:
            try:
                detail = (r.json().get("detail") or "").strip()
            except Exception:
                detail = ""
            if detail == "Профиль уже создан":
                return True, "exists"
            if detail == "Ник уже занят":
                return False, "taken"
            return False, (detail or "Ошибка регистрации. Повторите попытку.")
        if r.status_code == 400:
            try:
                detail = r.json().get("detail")
            except Exception:
                detail = None
            return False, (detail or "Некорректный ник.")
        return False, "Ошибка регистрации. Попробуйте позже."
    except Exception:
        return False, "Сервер недоступен. Повторите попытку позже."

# ====== Handlers ======
@router.callback_query(F.data == "reg:start")
async def reg_start(c: CallbackQuery, state: FSMContext):
    await c.answer()
    # важное изменение: проверяем НАЛИЧИЕ НИКА, а не «профиль существует»
    if await has_nick(c.from_user.id):
        await c.message.answer("Профиль уже создан — открываю магазин.")
        await send_main_menu(c)
        return

    await state.set_state(RegStates.waiting_nick)
    text = (
        "Для регистрации нужно придумать <b>уникальный никнейм</b>.\n"
        "Его нельзя будет изменить или передать.\n\n"
        "✍️ Напишите свой ник сообщением <u>или</u> нажмите «Сгенерировать ник»."
    )
    await c.message.answer(text, reply_markup=kb_nick_prompt())

@router.callback_query(F.data == "reg:gen")
async def reg_gen(c: CallbackQuery, state: FSMContext):
    await c.answer()
    if await has_nick(c.from_user.id):
        await c.answer("У тебя уже есть профиль.", show_alert=True)
        await send_main_menu(c)
        return
    if not await state.get_state():
        await c.answer("Начни регистрацию заново.", show_alert=True)
        return
    nick = make_random_nick()
    await state.update_data(suggest=nick)
    await c.message.answer(
        f"Вариант ника: <b>{html.escape(nick)}</b>\n\nВыберите действие:",
        reply_markup=kb_gen(nick)
    )

@router.callback_query(F.data == "reg:next")
async def reg_next(c: CallbackQuery, state: FSMContext):
    await c.answer()
    if await has_nick(c.from_user.id):
        await c.answer("Профиль уже создан.", show_alert=True)
        await send_main_menu(c)
        return
    if not await state.get_state():
        await c.answer("Начни регистрацию заново.", show_alert=True)
        return
    nick = make_random_nick()
    await state.update_data(suggest=nick)
    await c.message.answer(
        f"Вариант ника: <b>{html.escape(nick)}</b>\n\nВыберите действие:",
        reply_markup=kb_gen(nick)
    )

@router.callback_query(F.data == "reg:cancel")
async def reg_cancel(c: CallbackQuery, state: FSMContext):
    await c.answer()
    if await has_nick(c.from_user.id):
        await c.answer("Профиль уже создан.", show_alert=True)
        await send_main_menu(c)
        return
    if not await state.get_state():
        await c.answer("Начни регистрацию заново.", show_alert=True)
        return
    await c.message.answer("Окей. Напиши свой ник или снова нажми «Сгенерировать ник».")
    # остаёмся в состоянии waiting_nick

@router.callback_query(F.data.startswith("reg:use:"))
async def reg_use(c: CallbackQuery, state: FSMContext):
    await c.answer()
    if await has_nick(c.from_user.id):
        await c.answer("Профиль уже создан.", show_alert=True)
        await send_main_menu(c)
        return
    if not await state.get_state():
        await c.answer("Начни регистрацию заново.", show_alert=True)
        return

    raw = c.data.split("reg:use:", 1)[1]
    nick = sanitize_nick(raw)
    if len(nick) < 3:
        await c.message.answer("Ник должен быть от 3 до 32 символов. Попробуй другой вариант.")
        return

    ok, reason = await api_register(c.from_user.id, nick)
    if not ok:
        if reason == "taken":
            await c.message.answer(
                "Такой ник уже занят. Введите другой или нажмите «Сгенерировать ник».",
                reply_markup=kb_nick_prompt()
            )
        else:
            await c.message.answer(reason)
        return

    await state.clear()
    await send_main_menu(c, nick=nick)

@router.message(RegStates.waiting_nick, F.text.as_("t"))
async def reg_text_nick(m: Message, state: FSMContext, t: str):
    if await has_nick(m.from_user.id):
        await state.clear()
        await m.answer("Профиль уже создан — открываю магазин.")
        await send_main_menu(m)
        return

    nick = sanitize_nick(t)
    if len(nick) < 3:
        await m.answer(
            "Ник слишком короткий. Минимум 3 символа.\n"
            "Или нажми «Сгенерировать ник».",
            reply_markup=kb_nick_prompt()
        )
        return

    ok, reason = await api_register(m.from_user.id, nick)
    if not ok:
        if reason == "taken":
            await m.answer(
                "Такой ник уже занят. Попробуй другой ник или нажми «Сгенерировать ник».",
                reply_markup=kb_nick_prompt()
            )
        else:
            await m.answer(reason)
        return

    await state.clear()
    await send_main_menu(m, nick=nick)
