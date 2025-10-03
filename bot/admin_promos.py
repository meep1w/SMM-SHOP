# -*- coding: utf-8 -*-
import os
import math
import asyncio
from typing import Optional, List, Dict, Any

import httpx
from aiogram import Router, types, F
from aiogram.filters import Command
from aiogram.fsm.state import StatesGroup, State
from aiogram.fsm.context import FSMContext

router = Router(name="admin")

# ===== ENV =====
ADMIN_IDS = {
    int(x) for x in (os.getenv("ADMIN_IDS", "").replace(" ", "").split(","))
    if x.isdigit()
}
API_BASE = os.getenv("API_BASE", "http://127.0.0.1:8011").rstrip("/")
ADMIN_TOKEN = os.getenv("ADMIN_TOKEN", "")

if not ADMIN_IDS:
    print("[admin] WARNING: ADMIN_IDS is empty – /admin будет недоступна")

# ===== helpers common =====
def _admin_only(m: types.Message | types.CallbackQuery) -> bool:
    user = m.from_user if isinstance(m, (types.Message, types.CallbackQuery)) else None
    return bool(user and user.id in ADMIN_IDS)

def api_url(path: str) -> str:
    base = API_BASE.rstrip("/")
    p = path.lstrip("/")
    if not base.endswith("/api/v1"):
        p = "api/v1/" + p
    return f"{base}/{p}"

def _auth_headers() -> Dict[str, str]:
    return {
        "Authorization": f"Bearer {ADMIN_TOKEN}",
        "Content-Type": "application/json",
    }

# =========================
# ====== ПРОМОКОДЫ ========
# =========================
class PromoWizard(StatesGroup):
    type = State()
    code = State()
    value = State()
    max_activations = State()
    per_user_limit = State()

def _kb_promo_types():
    kb = [
        [types.InlineKeyboardButton(text="Скидка % (на заказ)", callback_data="promo:discount")],
        [types.InlineKeyboardButton(text="+Баланс (USD-экв.)", callback_data="promo:balance")],
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
    try:
        async with httpx.AsyncClient(timeout=20.0) as c:
            r = await c.post(url, headers=_auth_headers(), json=payload)
        try:
            js = r.json()
        except Exception:
            js = None

        if r.status_code == 200 and isinstance(js, dict) and js.get("ok"):
            return True, f"✅ Готово: {js}"

        if r.status_code == 403:
            return False, "❌ 403 Forbidden — проверь ADMIN_TOKEN у бота (и перезапусти)"
        if r.status_code == 404:
            return False, f"❌ 404 Not Found — проверь API_BASE. URL: {url}"

        return False, f"❌ Ошибка API: {r.status_code} {r.text}"
    except Exception as e:
        return False, f"❌ Сеть/исключение: {e}"

@router.callback_query(F.data == "admin:promos")
async def open_promos(c: types.CallbackQuery, state: FSMContext):
    if not _admin_only(c):
        return await c.answer()
    await state.clear()
    text = (
        "Админ панель → Промокоды\n\n"
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
    await c.message.edit_text(f"Тип: <b>{ptype}</b>\n\nВведи код (пример: <code>WELCOME15</code>)")
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
        max_act = int((m.text or "0").strip())
        if max_act < 0:
            raise ValueError
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
        per_user = int((m.text or "1").strip())
        if per_user <= 0:
            raise ValueError
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
    await m.reply(msg, disable_web_page_preview=True)
    await state.clear()

# =========================
# ====== РАССЫЛКА =========
# =========================
class BroadcastWizard(StatesGroup):
    text = State()
    choose_media = State()
    photo = State()
    confirm = State()

def _kb_broadcast_menu():
    return types.InlineKeyboardMarkup(inline_keyboard=[
        [types.InlineKeyboardButton(text="📣 Рассылка", callback_data="admin:broadcast:start")],
        [types.InlineKeyboardButton(text="⬅️ Назад", callback_data="admin:menu")],
    ])

def _kb_broadcast_choose():
    return types.InlineKeyboardMarkup(inline_keyboard=[
        [types.InlineKeyboardButton(text="🖼 Добавить картинку", callback_data="bc:add_photo")],
        [types.InlineKeyboardButton(text="🚀 Нет, запуск", callback_data="bc:no_photo")],
        [types.InlineKeyboardButton(text="⬅️ Отмена", callback_data="admin:menu")],
    ])

def _kb_broadcast_confirm():
    return types.InlineKeyboardMarkup(inline_keyboard=[
        [types.InlineKeyboardButton(text="✅ Запустить", callback_data="bc:go")],
        [types.InlineKeyboardButton(text="⬅️ Назад", callback_data="admin:menu")],
    ])

async def _fetch_all_user_ids() -> List[int]:
    """
    Тянем из API список пользователей по страницам.
    Требуется эндпоинт /api/v1/admin/users (см. ниже в пункте 2).
    """
    out: List[int] = []
    limit = 500
    offset = 0
    async with httpx.AsyncClient(timeout=30.0) as c:
        while True:
            r = await c.get(api_url("admin/users"), headers=_auth_headers(), params={"limit": limit, "offset": offset})
            if r.status_code != 200:
                break
            js = r.json() or {}
            items = js.get("items") or []
            for it in items:
                uid = int(it.get("tg_id") or 0)
                if uid > 0:
                    out.append(uid)
            total = int(js.get("total") or 0)
            offset += limit
            if offset >= total or not items:
                break
    return out

@router.callback_query(F.data == "admin:broadcast")
async def open_broadcast(c: types.CallbackQuery, state: FSMContext):
    if not _admin_only(c):
        return await c.answer()
    await state.clear()
    await c.message.edit_text(
        "Админ панель → Рассылка\n\nНажми «Рассылка», затем отправь текст.",
        reply_markup=_kb_broadcast_menu()
    )
    await c.answer()

@router.callback_query(F.data == "admin:broadcast:start")
async def bc_start(c: types.CallbackQuery, state: FSMContext):
    if not _admin_only(c):
        return await c.answer()
    await state.set_state(BroadcastWizard.text)
    await c.message.edit_text("Отправь текст рассылки одним сообщением (HTML поддерживается).")
    await c.answer()

@router.message(BroadcastWizard.text)
async def bc_text(m: types.Message, state: FSMContext):
    if not _admin_only(m):
        return
    text = (m.html_text or m.text or "").strip()
    if not text:
        return await m.reply("Пусто. Пришли текст ещё раз.")
    await state.update_data(text=text, photo_id=None)
    await state.set_state(BroadcastWizard.choose_media)
    await m.reply("Добавить медиа к рассылке?", reply_markup=_kb_broadcast_choose())

@router.callback_query(F.data == "bc:add_photo")
async def bc_need_photo(c: types.CallbackQuery, state: FSMContext):
    if not _admin_only(c):
        return await c.answer()
    await state.set_state(BroadcastWizard.photo)
    await c.message.edit_text("Пришли фотографию (одно изображение).")
    await c.answer()

@router.message(BroadcastWizard.photo, F.photo)
async def bc_got_photo(m: types.Message, state: FSMContext):
    if not _admin_only(m):
        return
    file_id = m.photo[-1].file_id
    await state.update_data(photo_id=file_id)
    await state.set_state(BroadcastWizard.confirm)
    await m.reply("Готово. Запускаем?", reply_markup=_kb_broadcast_confirm())

@router.callback_query(F.data == "bc:no_photo")
async def bc_no_photo(c: types.CallbackQuery, state: FSMContext):
    if not _admin_only(c):
        return await c.answer()
    await state.set_state(BroadcastWizard.confirm)
    await c.message.edit_text("Ок, без медиа. Запускаем?", reply_markup=_kb_broadcast_confirm())
    await c.answer()

@router.callback_query(F.data == "bc:go")
async def bc_go(c: types.CallbackQuery, state: FSMContext):
    if not _admin_only(c):
        return await c.answer()
    data = await state.get_data()
    text = data.get("text") or ""
    photo_id = data.get("photo_id")

    users = await _fetch_all_user_ids()
    total = len(users)
    if total == 0:
        await c.message.edit_text("Похоже, база пуста (эндпоинт admin/users вернул 0).")
        return await c.answer()

    ok = 0
    fail = 0

    await c.message.edit_text(f"Старт рассылки: {total} пользователей…")

    # Внимание: у Telegram есть лимиты. Отправляем «пакетами», но без искусственного КД.
    for uid in users:
        try:
            if photo_id:
                await c.bot.send_photo(uid, photo=photo_id, caption=text, parse_mode="HTML")
            else:
                await c.bot.send_message(uid, text, parse_mode="HTML", disable_web_page_preview=True)
            ok += 1
        except Exception:
            fail += 1

    await state.clear()
    await c.message.edit_text(f"Готово.\nУспешно: {ok}\nОшибок: {fail}")
    await c.answer()

# =========================
# ====== СТАТИСТИКА ======
# =========================
class StatsWizard(StatesGroup):
    user_id = State()

def _kb_stats():
    return types.InlineKeyboardMarkup(inline_keyboard=[
        [types.InlineKeyboardButton(text="🔎 Посмотреть пользователя", callback_data="stats:request")],
        [types.InlineKeyboardButton(text="⬅️ Назад", callback_data="admin:menu")],
    ])

@router.callback_query(F.data == "admin:stats")
async def open_stats(c: types.CallbackQuery, state: FSMContext):
    if not _admin_only(c):
        return await c.answer()
    await state.clear()
    await c.message.edit_text(
        "Админ панель → Статистика\n\nНажми «Посмотреть пользователя», затем отправь TG ID (или seq).",
        reply_markup=_kb_stats()
    )
    await c.answer()

@router.callback_query(F.data == "stats:request")
async def stats_request(c: types.CallbackQuery, state: FSMContext):
    if not _admin_only(c):
        return await c.answer()
    await state.set_state(StatsWizard.user_id)
    await c.message.edit_text("Пришли <b>TG ID</b> (или seq) пользователя. Автосоздания не будет.")
    await c.answer()

async def _api_get(path: str, params: dict | None = None) -> Optional[dict]:
    try:
        async with httpx.AsyncClient(timeout=20.0) as c:
            r = await c.get(api_url(path), params=params)
        return r.json() if r.status_code == 200 else None
    except Exception:
        return None

@router.message(StatsWizard.user_id)
async def stats_user(m: types.Message, state: FSMContext):
    if not _admin_only(m):
        return
    try:
        uid = int((m.text or "").strip())
    except Exception:
        return await m.reply("Нужно число — TG ID или seq.")

    # профиль
    u = await _api_get("user", {"user_id": uid, "autocreate": 0})
    if not u:
        return await m.reply("Не найден (или API недоступно).")

    # реф. статистика
    ref = await _api_get("referrals/stats", {"user_id": uid}) or {}
    # платежи — считаем оплаченные депозиты
    pays = await _api_get("payments", {"user_id": uid, "status": "completed"}) or []
    deposits = [p for p in pays if (p.get("method") != "ref" and p.get("status") == "completed")]
    dep_cnt = len(deposits)
    dep_sum = sum(float(p.get("amount_usd") or 0.0) for p in deposits)

    text = (
        "<b>Карточка пользователя</b>\n"
        "────────────────────\n"
        f"TG ID / seq: <code>{uid}</code> / <code>{u.get('seq')}</code>\n"
        f"Ник: <b>{u.get('nick') or '—'}</b>\n"
        f"Баланс: <b>{u.get('balance')} {u.get('currency')}</b>\n"
        f"Депозитов (paid): <b>{dep_cnt}</b> на <b>{round(dep_sum, 2)} USD</b>\n"
        f"Рефералов всего: <b>{ref.get('invited_total', 0)}</b>\n"
        f"Рефералов с депозитом: <b>{ref.get('invited_with_deposit', 0)}</b>\n"
        f"Текущая ставка: <b>{ref.get('rate_percent', 10)}%</b>\n"
        f"Сумма реф. бонусов: <b>{ref.get('earned_total', 0)} {ref.get('earned_currency', u.get('currency'))}</b>\n"
    )
    await m.reply(text, disable_web_page_preview=True)
    await state.clear()

# =========================
# ====== МЕНЮ /admin ======
# =========================
def _kb_admin_menu():
    return types.InlineKeyboardMarkup(inline_keyboard=[
        [types.InlineKeyboardButton(text="🎟 Промокоды", callback_data="admin:promos")],
        [types.InlineKeyboardButton(text="📣 Рассылка",  callback_data="admin:broadcast")],
        [types.InlineKeyboardButton(text="📊 Статистика", callback_data="admin:stats")],
    ])

@router.message(Command("admin"))
async def cmd_admin(m: types.Message, state: FSMContext):
    if not _admin_only(m):
        return
    await state.clear()
    await m.answer("Админ панель", reply_markup=_kb_admin_menu())

@router.callback_query(F.data == "admin:menu")
async def back_to_menu(c: types.CallbackQuery, state: FSMContext):
    if not _admin_only(c):
        return await c.answer()
    await state.clear()
    await c.message.edit_text("Админ панель", reply_markup=_kb_admin_menu())
    await c.answer()
