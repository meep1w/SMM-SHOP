# -*- coding: utf-8 -*-
import os
import httpx
from aiogram import Router, types, F
from aiogram.filters import Command
from aiogram.fsm.state import StatesGroup, State
from aiogram.fsm.context import FSMContext

router = Router(name="admin_promos")

# ENV
ADMIN_IDS = {
    int(x) for x in (os.getenv("ADMIN_IDS", "").replace(" ", "").split(","))
    if x.isdigit()
}
API_BASE = os.getenv("API_BASE", "http://127.0.0.1:8011").rstrip("/")
ADMIN_TOKEN = os.getenv("ADMIN_TOKEN", "")

if not ADMIN_IDS:
    # чтобы не молча “проглатывалось”
    print("[admin_promos] WARNING: ADMIN_IDS is empty – /admin будет недоступна")

# ==== FSM ====
class PromoWizard(StatesGroup):
    type = State()
    code = State()
    value = State()
    max_activations = State()
    per_user_limit = State()

# ==== helpers ====
def _admin_only(m: types.Message | types.CallbackQuery) -> bool:
    user = m.from_user if isinstance(m, (types.Message, types.CallbackQuery)) else None
    return bool(user and user.id in ADMIN_IDS)

def _kb_types():
    kb = [
        [types.InlineKeyboardButton(text="Скидка % (на заказ)", callback_data="promo:discount")],
        [types.InlineKeyboardButton(text="+Баланс (USD-экв.)", callback_data="promo:balance")],
        [types.InlineKeyboardButton(text="Наценка (персональная)", callback_data="promo:markup")],
    ]
    return types.InlineKeyboardMarkup(inline_keyboard=kb)

async def _create_promo(payload: dict) -> tuple[bool, str]:
    if not ADMIN_TOKEN:
        return False, "ADMIN_TOKEN не задан в окружении бота"
    url = f"{API_BASE}/api/v1/promo/admin/create"
    headers = {"Authorization": f"Bearer {ADMIN_TOKEN}", "Content-Type": "application/json"}
    try:
        async with httpx.AsyncClient(timeout=20.0) as c:
            r = await c.post(url, headers=headers, json=payload)
        if r.status_code == 200 and r.json().get("ok"):
            js = r.json()
            return True, f"✅ Готово: {js}"
        return False, f"❌ Ошибка API: {r.status_code} {r.text}"
    except Exception as e:
        return False, f"❌ Сеть/исключение: {e}"

# ==== entry ====
@router.message(Command("admin"))
async def cmd_admin(m: types.Message, state: FSMContext):
    if not _admin_only(m):
        return
    await state.clear()
    text = (
        "Админ меню промокодов:\n"
        "• Скидка % — вводится на странице заказа\n"
        "• +Баланс — активируется в профиле, сразу начисляет баланс\n"
        "• Наценка — фиксирует персональную наценку пользователю\n\n"
        "Выбери тип:"
    )
    await m.answer(text, reply_markup=_kb_types())

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
        # 15 => 0.15; 0.15 => 0.15
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
