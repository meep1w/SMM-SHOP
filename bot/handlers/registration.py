# -*- coding: utf-8 -*-
import html
import random
import string
from typing import Tuple

from aiogram import Router, F
from aiogram.types import CallbackQuery, Message, InlineKeyboardMarkup, InlineKeyboardButton
from aiogram.fsm.state import StatesGroup, State
from aiogram.fsm.context import FSMContext
import httpx

from bot.config import API_BASE
from .start import send_main_menu  # показываем главное меню после успеха

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
    return n[:32]

def make_random_nick() -> str:
    base = random.choice(["CTR","Click","Ops","Flow","Lead","Vibe","Nova","Rider","Drago"])
    suffix = "".join(random.choices(string.ascii_uppercase + string.digits, k=2))
    num = random.randint(10, 99)
    return f"{base}_{suffix}{num}"

async def api_register(user_id: int, nick: str) -> Tuple[bool, str]:
    try:
        r = await _http.post(f"{API_BASE}/register", json={"user_id": user_id, "nick": nick})
        if r.status_code == 200:
            return True, ""
        if r.status_code == 409:
            return False, "Ник уже занят или профиль уже создан."
        if r.status_code == 400:
            try:
                detail = r.json().get("detail")
            except Exception:
                detail = None
            return False, detail or "Некорректный ник."
        return False, "Ошибка регистрации. Попробуйте другой ник."
    except Exception:
        return False, "Сервер недоступен. Повторите попытку позже."

async def api_profile_ping(user_id: int) -> None:
    # прогреваем/создаём профиль на стороне API (на будущее)
    try:
        await _http.get(f"{API_BASE}/user", params={"user_id": user_id, "autocreate": 1})
    except Exception:
        pass

# ====== Handlers ======
@router.callback_query(F.data == "reg:start")
async def reg_start(c: CallbackQuery, state: FSMContext):
    await c.answer()
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
    if not await state.get_state():
        await c.answer("У тебя уже есть профиль.", show_alert=True)
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
    if not await state.get_state():
        await c.answer("Профиль уже создан.", show_alert=True)
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
    if not await state.get_state():
        await c.answer("Профиль уже создан.", show_alert=True)
        return
    await c.message.answer("Окей. Напиши свой ник или снова нажми «Сгенерировать ник».")
    # остаёмся в состоянии waiting_nick

@router.callback_query(F.data.startswith("reg:use:"))
async def reg_use(c: CallbackQuery, state: FSMContext):
    await c.answer()
    if not await state.get_state():
        await c.answer("Профиль уже создан.", show_alert=True)
        return
    raw = c.data.split("reg:use:", 1)[1]
    nick = sanitize_nick(raw)
    if len(nick) < 3:
        await c.message.answer("Ник должен быть от 3 до 32 символов. Попробуй другой вариант.")
        return
    ok, err = await api_register(c.from_user.id, nick)
    if not ok:
        await c.message.answer(err)
        return
    await state.clear()
    await api_profile_ping(c.from_user.id)
    await send_main_menu(c, nick=nick)

@router.message(RegStates.waiting_nick, F.text.as_("t"))
async def reg_text_nick(m: Message, state: FSMContext, t: str):
    nick = sanitize_nick(t)
    if len(nick) < 3:
        await m.answer(
            "Ник слишком короткий. Минимум 3 символа.\n"
            "Или нажми «Сгенерировать ник».",
            reply_markup=kb_nick_prompt()
        )
        return
    ok, err = await api_register(m.from_user.id, nick)
    if not ok:
        await m.answer(err + "\n\nПопробуй другой ник или нажми «Сгенерировать ник».",
                       reply_markup=kb_nick_prompt())
        return
    await state.clear()
    await api_profile_ping(m.from_user.id)
    await send_main_menu(m, nick=nick)
