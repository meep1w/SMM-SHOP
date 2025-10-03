# bot/handlers/admin.py
# -*- coding: utf-8 -*-
import os
import asyncio
import datetime as dt
from typing import Optional, Tuple

import httpx
from aiogram import Router, types, F
from aiogram.filters import Command
from aiogram.fsm.state import StatesGroup, State
from aiogram.fsm.context import FSMContext

router = Router(name="admin")

# ===== ENV / API =====
ADMIN_IDS = {
    int(x) for x in (os.getenv("ADMIN_IDS", "").replace(" ", "").split(","))
    if x.isdigit()
}
API_BASE = (os.getenv("API_BASE", "http://127.0.0.1:8011") or "").rstrip("/")
ADMIN_TOKEN = os.getenv("ADMIN_TOKEN", "")

if not ADMIN_IDS:
    print("[admin] WARNING: ADMIN_IDS is empty – /admin будет недоступна")

def api_url(path: str) -> str:
    """Собирает URL так, чтобы /api/v1 был ровно один раз."""
    base = API_BASE.rstrip("/")
    p = path.lstrip("/")
    if not base.endswith("/api/v1"):
        p = "api/v1/" + p
    return f"{base}/{p}"

# ===== ACCESS =====
def _admin_only(m: types.Message | types.CallbackQuery) -> bool:
    user = m.from_user if isinstance(m, (types.Message, types.CallbackQuery)) else None
    return bool(user and user.id in ADMIN_IDS)

# ====== UI ======
def kb_admin_main() -> types.InlineKeyboardMarkup:
    kb = [
        [types.InlineKeyboardButton(text="📣 Рассылка",   callback_data="admin:bc")],
        [types.InlineKeyboardButton(text="📊 Статистика", callback_data="admin:stats")],
        [types.InlineKeyboardButton(text="🏷 Промокоды",  callback_data="admin:promo")],
    ]
    return types.InlineKeyboardMarkup(inline_keyboard=kb)

def kb_back_admin() -> types.InlineKeyboardMarkup:
    return types.InlineKeyboardMarkup(
        inline_keyboard=[[types.InlineKeyboardButton(text="⬅️ Назад", callback_data="admin:menu")]]
    )

# ===== Промокоды (взято из твоего файла и слегка отрефакторено) =====
class PromoWizard(StatesGroup):
    type = State()
    code = State()
    value = State()
    max_activations = State()
    per_user_limit = State()

def _kb_promo_types():
    kb = [
        [types.InlineKeyboardButton(text="Скидка % (на заказ)", callback_data="promo:discount")],
        [types.InlineKeyboardButton(text="+Баланс (USD-экв.)",   callback_data="promo:balance")],
        [types.InlineKeyboardButton(text="Наценка (персональная)", callback_data="promo:markup")],
        [types.InlineKeyboardButton(text="⬅️ Назад", callback_data="admin:menu")],
    ]
    return types.InlineKeyboardMarkup(inline_keyboard=kb)

async def _create_promo(payload: dict) -> tuple[bool, str]:
    if not ADMIN_TOKEN:
        return False, "ADMIN_TOKEN не задан в окружении бота"
    if len(ADMIN_TOKEN) < 40:
        return False, "ADMIN_TOKEN выглядит подозрительно (слишком короткий)"

    url = api_url("promo/admin/create")
    headers = {"Authorization": f"Bearer {ADMIN_TOKEN}", "Content-Type": "application/json"}

    try:
        async with httpx.AsyncClient(timeout=20.0) as c:
            r = await c.post(url, headers=headers, json=payload)
        try:
            js = r.json()
        except Exception:
            js = None

        if r.status_code == 200 and isinstance(js, dict) and js.get("ok"):
            return True, f"✅ Готово: {js}"

        if r.status_code == 403:
            return False, "❌ 403 Forbidden — проверь ADMIN_TOKEN у бота (и перезапусти бота)"
        if r.status_code == 404:
            return False, f"❌ 404 Not Found — проверь API_BASE и путь. URL: {url}"

        return False, f"❌ Ошибка API: {r.status_code} {r.text}"
    except Exception as e:
        return False, f"❌ Сеть/исключение: {e}"

# ===== Рассылка =====
class Broadcast(StatesGroup):
    waiting_text = State()
    pick_media    = State()
    waiting_photo = State()
    confirm       = State()

def kb_bc_options(has_photo: bool) -> types.InlineKeyboardMarkup:
    row1 = []
    if not has_photo:
        row1.append(types.InlineKeyboardButton(text="🖼 Добавить картинку", callback_data="bc:addphoto"))
    row1.append(types.InlineKeyboardButton(text="🚫 Не нужно", callback_data="bc:nophoto"))
    kb = [
        row1,
        [
            types.InlineKeyboardButton(text="✅ Запустить", callback_data="bc:run"),
            types.InlineKeyboardButton(text="✖ Отмена",    callback_data="bc:cancel"),
        ],
        [types.InlineKeyboardButton(text="⬅️ Назад", callback_data="admin:menu")],
    ]
    return types.InlineKeyboardMarkup(inline_keyboard=kb)

async def _fetch_admin_users() -> list[dict]:
    url = api_url("admin/users")
    headers = {"Authorization": f"Bearer {ADMIN_TOKEN}"} if ADMIN_TOKEN else {}
    async with httpx.AsyncClient(timeout=30.0) as c:
        r = await c.get(url, headers=headers)
        r.raise_for_status()
        js = r.json()
        if not isinstance(js, list):
            return []
        return js

# ===== Статистика =====
def _fmt_ts(ts: int | None) -> str:
    if not ts:
        return "-"
    try:
        return dt.datetime.fromtimestamp(int(ts)).strftime("%Y-%m-%d %H:%M")
    except Exception:
        return str(ts)

# ================== ENTRY ==================
@router.message(Command("admin"))
async def cmd_admin(m: types.Message, state: FSMContext):
    if not _admin_only(m):
        return
    await state.clear()
    text = (
        "<b>Админ-панель</b>\n\n"
        "Выбери раздел:"
    )
    await m.answer(text, reply_markup=kb_admin_main())

@router.callback_query(F.data == "admin:menu")
async def cb_admin_menu(c: types.CallbackQuery, state: FSMContext):
    if not _admin_only(c):
        return await c.answer()
    await state.clear()
    await c.message.edit_text("<b>Админ-панель</b>\n\nВыбери раздел:", reply_markup=kb_admin_main())
    await c.answer()

# ====== Промокоды ======
@router.callback_query(F.data == "admin:promo")
async def cb_admin_promo(c: types.CallbackQuery, state: FSMContext):
    if not _admin_only(c):
        return await c.answer()
    await state.clear()
    text = (
        "Раздел <b>Промокоды</b>\n\n"
        "• Скидка % — вводится на странице заказа\n"
        "• +Баланс — активируется в профиле, сразу начисляет баланс\n"
        "• Наценка — фиксирует персональную наценку пользователю\n\n"
        "Выбери тип:"
    )
    await c.message.edit_text(text, reply_markup=_kb_promo_types())
    await c.answer()

@router.callback_query(F.data.startswith("promo:"))
async def cb_pick_type(c: types.CallbackQuery, state: FSMContext):
    if not _admin_only(c):
        return await c.answer()
    ptype = c.data.split(":", 1)[1]
    await state.set_state(PromoWizard.type)
    await state.update_data(type=ptype)
    await state.set_state(PromoWizard.code)
    await c.message.edit_text(
        f"Тип: <b>{ptype}</b>\n\nВведи код (пример: <code>WELCOME15</code>)",
        reply_markup=kb_back_admin()
    )
    await c.answer()

@router.message(PromoWizard.code)
async def step_code(m: types.Message, state: FSMContext):
    if not _admin_only(m):
        return
    code = (m.text or "").strip().upper()
    if not (2 <= len(code) <= 64):
        return await m.reply("Код должен быть 2..64 символа. Попробуй ещё раз.")
    data = await state.get_data()
    ptype = data.get("type")

    await state.update_data(code=code)
    await state.set_state(PromoWizard.value)

    if ptype == "discount":
        await m.reply("Введи скидку в процентах (например, <code>15</code> или <code>0.15</code>)")
    elif ptype == "balance":
        await m.reply("Введи сумму (USD, можно дробные, пример: <code>0.30</code>)")
    elif ptype == "markup":
        await m.reply("Введи наценку (например, <code>2</code> чтобы фиксировать x2)")
    else:
        await m.reply("Неизвестный тип. Отмена.")
        await state.clear()

@router.message(PromoWizard.value)
async def step_value(m: types.Message, state: FSMContext):
    if not _admin_only(m):
        return
    raw = (m.text or "").replace(",", ".").strip()
    try:
        val = float(raw)
    except Exception:
        return await m.reply("Нужно число. Попробуй ещё раз.")

    data = await state.get_data()
    ptype = data.get("type")

    if ptype == "discount":
        pct = val / 100.0 if val >= 1.0 else val
        if not (0.0 < pct < 1.0):
            return await m.reply("Процент должен быть в диапазоне (0..100).")
        await state.update_data(value=pct)
    elif ptype == "balance":
        if val <= 0:
            return await m.reply("Сумма должна быть > 0.")
        await state.update_data(value=round(val, 4))
    elif ptype == "markup":
        if val <= 0:
            return await m.reply("Наценка должна быть > 0.")
        await state.update_data(value=round(val, 6))
    else:
        await m.reply("Неизвестный тип. Отмена.")
        return await state.clear()

    await state.set_state(PromoWizard.max_activations)
    await m.reply("Макс. активаций (число, 0 = без лимита). Пример: <code>10</code>")

@router.message(PromoWizard.max_activations)
async def step_max(m: types.Message, state: FSMContext):
    if not _admin_only(m):
        return
    try:
        max_act = int((m.text or "0").strip());  assert max_act >= 0
    except Exception:
        return await m.reply("Нужно неотрицательное целое. Повтори.")
    await state.update_data(max_activations=max_act)
    await state.set_state(PromoWizard.per_user_limit)
    await m.reply("Лимит на пользователя (целое ≥ 1). Пример: <code>1</code>")

@router.message(PromoWizard.per_user_limit)
async def step_per_user(m: types.Message, state: FSMContext):
    if not _admin_only(m):
        return
    try:
        per_user = int((m.text or "1").strip());  assert per_user > 0
    except Exception:
        return await m.reply("Нужно целое ≥ 1. Повтори.")

    data = await state.get_data()
    ptype = data["type"]
    code = data["code"]
    value = data["value"]
    max_act = data["max_activations"]

    payload = {
        "code": code,
        "type": ptype,
        "max_activations": int(max_act),
        "per_user_limit": int(per_user),
        "is_active": True,
    }
    if ptype == "discount":
        payload["discount_percent"] = float(value)
    elif ptype == "balance":
        payload["balance_usd"] = float(value)
    elif ptype == "markup":
        payload["markup_value"] = float(value)

    ok, msg = await _create_promo(payload)
    await m.reply(msg, disable_web_page_preview=True, reply_markup=kb_back_admin())
    await state.clear()

# ====== Рассылка ======
@router.callback_query(F.data == "admin:bc")
async def bc_start(c: types.CallbackQuery, state: FSMContext):
    if not _admin_only(c):
        return await c.answer()
    await state.clear()
    await state.set_state(Broadcast.waiting_text)
    await c.message.edit_text(
        "Отправь <b>текст рассылки</b> одним сообщением (HTML поддерживается).",
        reply_markup=kb_back_admin()
    )
    await c.answer()

@router.message(Broadcast.waiting_text)
async def bc_got_text(m: types.Message, state: FSMContext):
    if not _admin_only(m):
        return
    text = m.html_text or m.text or ""
    if not text.strip():
        return await m.reply("Сообщение пустое. Пришли текст ещё раз.")
    await state.update_data(text=text, photo_id=None)
    await state.set_state(Broadcast.pick_media)
    await m.reply(
        "Добавить картинку к рассылке?",
        reply_markup=kb_bc_options(has_photo=False)
    )

@router.callback_query(F.data == "bc:addphoto")
async def bc_add_photo(c: types.CallbackQuery, state: FSMContext):
    if not _admin_only(c):
        return await c.answer()
    await state.set_state(Broadcast.waiting_photo)
    await c.message.edit_text("Пришли <b>фото</b> одним сообщением (как изображение).", reply_markup=kb_back_admin())
    await c.answer()

@router.message(Broadcast.waiting_photo, F.photo)
async def bc_got_photo(m: types.Message, state: FSMContext):
    if not _admin_only(m):
        return
    file_id = m.photo[-1].file_id
    await state.update_data(photo_id=file_id)
    await state.set_state(Broadcast.confirm)
    await m.reply("Фото добавлено. Запускаем?", reply_markup=kb_bc_options(has_photo=True))

@router.callback_query(F.data == "bc:nophoto")
async def bc_no_photo(c: types.CallbackQuery, state: FSMContext):
    if not _admin_only(c):
        return await c.answer()
    data = await state.get_data()
    if not data.get("text"):
        await c.answer("Нет текста — пришли текст рассылки.", show_alert=True)
        return
    await state.set_state(Broadcast.confirm)
    await c.message.edit_text("Окей, без картинки. Запускаем?", reply_markup=kb_bc_options(has_photo=False))
    await c.answer()

@router.callback_query(F.data == "bc:cancel")
async def bc_cancel(c: types.CallbackQuery, state: FSMContext):
    if not _admin_only(c):
        return await c.answer()
    await state.clear()
    await c.message.edit_text("Рассылка отменена.", reply_markup=kb_back_admin())
    await c.answer()

@router.callback_query(F.data == "bc:run")
async def bc_run(c: types.CallbackQuery, state: FSMContext):
    if not _admin_only(c):
        return await c.answer()
    data = await state.get_data()
    text = (data.get("text") or "").strip()
    photo_id = data.get("photo_id")
    if not text:
        await c.answer("Сначала пришли текст.", show_alert=True)
        return

    # подтянем список пользователей
    try:
        users = await _fetch_admin_users()
    except Exception as e:
        await c.message.edit_text(f"Не удалось получить список пользователей: {e}", reply_markup=kb_back_admin())
        return await c.answer()

    total = len(users)
    if total == 0:
        await c.message.edit_text("Похоже, база пуста (эндпоинт admin/users вернул 0).", reply_markup=kb_back_admin())
        return await c.answer()

    await c.message.edit_text(f"Запускаю рассылку по {total} пользователям…")

    sent = 0
    failed = 0
    bot = c.bot

    for u in users:
        uid = u.get("tg_id")
        if not uid:
            failed += 1
            continue
        try:
            if photo_id:
                await bot.send_photo(uid, photo_id, caption=text, parse_mode="HTML")
            else:
                await bot.send_message(uid, text, parse_mode="HTML", disable_web_page_preview=True)
            sent += 1
        except Exception:
            failed += 1
        # без кд, как просил; если захочешь щадящий режим — раскомментируй:
        # await asyncio.sleep(0.03)

    await state.clear()
    await c.message.edit_text(
        f"Рассылка завершена.\n\n"
        f"✅ Успешно: <b>{sent}</b>\n"
        f"❌ Ошибок: <b>{failed}</b>\n"
        f"📬 Всего: <b>{total}</b>",
        reply_markup=kb_back_admin()
    )
    await c.answer()

# ====== Статистика ======
@router.callback_query(F.data == "admin:stats")
async def admin_stats(c: types.CallbackQuery, state: FSMContext):
    if not _admin_only(c):
        return await c.answer()
    try:
        users = await _fetch_admin_users()
    except Exception as e:
        await c.message.edit_text(f"Не удалось получить пользователей: {e}", reply_markup=kb_back_admin())
        return await c.answer()

    total = len(users)
    with_nick = sum(1 for x in users if x.get("nick"))
    paid_topups_users = sum(1 for x in users if int(x.get("topups_paid") or 0) > 0)
    orders_users = sum(1 for x in users if int(x.get("orders") or 0) > 0)

    head = (
        f"<b>Статистика</b>\n"
        f"Всего пользователей: <b>{total}</b>\n"
        f"С ником: <b>{with_nick}</b>\n"
        f"Депозиты (≥1): <b>{paid_topups_users}</b>\n"
        f"Заказы (≥1): <b>{orders_users}</b>\n\n"
        f"Последние 20 пользователей:\n"
        "<code>tg_id      | nick         | bal   | cur | orders | topups_paid | refs | last_seen</code>\n"
    )

    # отсортируем по last_seen_at убыв.
    users_sorted = sorted(users, key=lambda x: int(x.get("last_seen_at") or 0), reverse=True)[:20]
    lines = []
    for u in users_sorted:
        line = (
            f"<code>"
            f"{str(u.get('tg_id')).ljust(10)}| "
            f"{(u.get('nick') or '-').ljust(12)[:12]} | "
            f"{str(round(float(u.get('balance') or 0.0), 2)).rjust(6)} | "
            f"{(u.get('currency') or 'RUB')[:3].ljust(3)} | "
            f"{str(u.get('orders') or 0).rjust(6)} | "
            f"{str(u.get('topups_paid') or 0).rjust(11)} | "
            f"{str(u.get('refs') or 0).rjust(4)} | "
            f"{_fmt_ts(u.get('last_seen_at'))}"
            f"</code>"
        )
        lines.append(line)

    text = head + ("\n".join(lines) if lines else "— нет данных —")
    await c.message.edit_text(text, reply_markup=kb_back_admin(), disable_web_page_preview=True)
    await c.answer()
