# -*- coding: utf-8 -*-
from typing import Optional
import html

from aiogram import Router, F
from aiogram.types import CallbackQuery, Message
from aiogram.fsm.context import FSMContext
from aiogram.enums import ParseMode

from bot.states.registration import RegStates
from bot.keyboards.registration import kb_generate, kb_nick_suggestion
from bot.keyboards.main_menu import kb_main_menu  # ⬅️ импорт из main_menu.py
from bot.storage.users import is_registered, set_registered, get_nick
from bot.utils import nickgen
from bot.utils.messaging import send_photo_with_caption_and_kb, code
from bot.config import GROUP_URL, PUBLIC_CHAT_URL, SCHOOL_URL, ALREADY_REGISTERED_ALERT

router = Router()


async def _delete_suggest_msg(cb: CallbackQuery, state: FSMContext):
    data = await state.get_data()
    msg_id = data.get("suggest_msg_id")
    if msg_id:
        try:
            await cb.message.bot.delete_message(chat_id=cb.message.chat.id, message_id=msg_id)
        except Exception:
            pass
        await state.update_data(suggest_msg_id=None, last_suggested_nick=None)


@router.callback_query(F.data == "register")
async def on_register(cb: CallbackQuery, state: FSMContext):
    if is_registered(cb.from_user.id):
        # Уже зарегистрирован → алерт и ничего не делаем
        await cb.answer(ALREADY_REGISTERED_ALERT, show_alert=True)
        return

    await state.set_state(RegStates.waiting_for_nick)
    await state.update_data(last_suggested_nick=None, suggest_msg_id=None)
    text = (
        "Для регистрации нужно придумать <b>уникальный никнейм</b>.\n"
        "Его нельзя будет изменить или передать.\n\n"
        "✍️ Напишите свой ник сообщением <u>или</u> нажмите «Сгенерировать ник»."
    )
    await cb.message.answer(text, parse_mode=ParseMode.HTML, reply_markup=kb_generate())
    await cb.answer()


@router.callback_query(F.data == "nick:gen")
async def on_gen_nick(cb: CallbackQuery, state: FSMContext):
    if is_registered(cb.from_user.id):
        await cb.answer(ALREADY_REGISTERED_ALERT, show_alert=True)
        return

    data = await state.get_data()
    nick = nickgen.generate()
    txt = f"Вариант ника: {code(nick)}\n\nВыберите действие:"

    suggest_id: Optional[int] = data.get("suggest_msg_id")
    if suggest_id and cb.message.message_id == suggest_id:
        try:
            await cb.message.edit_text(txt, parse_mode=ParseMode.HTML, reply_markup=kb_nick_suggestion(nick))
        except Exception:
            sent = await cb.message.answer(txt, parse_mode=ParseMode.HTML, reply_markup=kb_nick_suggestion(nick))
            await state.update_data(suggest_msg_id=sent.message_id)
    else:
        sent = await cb.message.answer(txt, parse_mode=ParseMode.HTML, reply_markup=kb_nick_suggestion(nick))
        await state.update_data(suggest_msg_id=sent.message_id)

    await state.update_data(last_suggested_nick=nick)
    await cb.answer()


@router.callback_query(F.data == "nick:next")
async def on_next_suggestion(cb: CallbackQuery, state: FSMContext):
    if is_registered(cb.from_user.id):
        await cb.answer(ALREADY_REGISTERED_ALERT, show_alert=True)
        return

    nick = nickgen.generate()
    txt = f"Вариант ника: {code(nick)}\n\nВыберите действие:"
    try:
        await cb.message.edit_text(txt, parse_mode=ParseMode.HTML, reply_markup=kb_nick_suggestion(nick))
    except Exception:
        sent = await cb.message.answer(txt, parse_mode=ParseMode.HTML, reply_markup=kb_nick_suggestion(nick))
        await state.update_data(suggest_msg_id=sent.message_id)
    await state.update_data(last_suggested_nick=nick)
    await cb.answer()


@router.callback_query(F.data == "nick:cancel")
async def on_cancel_nick(cb: CallbackQuery, state: FSMContext):
    if is_registered(cb.from_user.id):
        await cb.answer(ALREADY_REGISTERED_ALERT, show_alert=True)
        return
    await _delete_suggest_msg(cb, state)
    txt = (
        "Хорошо! Можете <b>написать свой ник</b> сообщением\n"
        "или нажать «Сгенерировать ник»."
    )
    await cb.message.answer(txt, parse_mode=ParseMode.HTML, reply_markup=kb_generate())
    await cb.answer("Отменено")


@router.callback_query(F.data.startswith("nick:use:"))
async def on_use_nick(cb: CallbackQuery, state: FSMContext):
    if is_registered(cb.from_user.id):
        await cb.answer(ALREADY_REGISTERED_ALERT, show_alert=True)
        return

    _, _, nick = cb.data.partition("nick:use:")
    nick = (nick or "").strip()

    await _delete_suggest_msg(cb, state)
    await complete_registration(cb.message, state, nick)
    await cb.answer("Ник установлен")


@router.message(RegStates.waiting_for_nick)
async def on_text_nick(message: Message, state: FSMContext):
    if is_registered(message.from_user.id):
        await message.answer("Профиль уже создан — открываю меню.")
        await open_main_menu(message)
        return

    nick = (message.text or "").strip()
    if not (3 <= len(nick) <= 30):
        await message.answer("Ник должен быть от 3 до 30 символов. Повторите или сгенерируйте.")
        return

    await complete_registration(message, state, nick)


async def complete_registration(msg_owner: Message, state: FSMContext, nick: str):
    set_registered(msg_owner.from_user.id, nick)
    await state.clear()
    await open_main_menu(msg_owner)


async def open_main_menu(msg: Message):
    nick = get_nick(msg.from_user.id) or "друг"
    caption = (
        f"Привет, <b>{html.escape(nick)}</b>!\n"
        f"Это магазин <a href=\"{GROUP_URL}\">Slovekiza</a>.\n"
        "Продвигайте свои соц.сети, каналы и воронки по лучшим ценам — в любое время.\n\n"
        f"Можете посетить мой <a href=\"{PUBLIC_CHAT_URL}\">открытый чат</a> "
        f"или ознакомиться с моей <a href=\"{SCHOOL_URL}\">школой траффика</a>."
    )
    # ⬇️ передаём ник, чтобы мини-аппа показывала именно зарегистрированный ник
    await send_photo_with_caption_and_kb(msg, caption, kb_main_menu(nick))
