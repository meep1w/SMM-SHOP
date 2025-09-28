# -*- coding: utf-8 -*-
import html
from typing import Optional

from aiogram import Router, F
from aiogram.filters import CommandStart
from aiogram.types import (
    Message, InlineKeyboardMarkup, InlineKeyboardButton,
    FSInputFile, CallbackQuery, WebAppInfo
)
import httpx

from bot.config import (
    API_BASE,
    WEBAPP_URL,
    GROUP_URL,
    PUBLIC_CHAT_URL,
    SCHOOL_URL,
    REVIEWS_URL,
    WELCOME_IMG,
    MENU_IMG,
)

router = Router()
_http = httpx.AsyncClient(timeout=15.0)

# ---------------- UI ----------------

def kb_welcome() -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text="Зарегистрироваться", callback_data="reg:start")]
    ])

def kb_main() -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text="🛍 Открыть магазин", web_app=WebAppInfo(url=WEBAPP_URL))],
        [
            InlineKeyboardButton(text="👥 Реф система", callback_data="menu:refs"),
            InlineKeyboardButton(text="🎰 Рулетка",     callback_data="menu:roulette"),
        ],
        [
            InlineKeyboardButton(text="ℹ️ О магазине", callback_data="menu:about"),
            InlineKeyboardButton(text="💬 Отзывы",     url=REVIEWS_URL or PUBLIC_CHAT_URL or GROUP_URL),
        ],
    ])

# ---------------- API helpers ----------------

async def api_user_exists(user_id: int) -> bool:
    try:
        r = await _http.get(f"{API_BASE}/user/exists", params={"user_id": user_id})
        return bool(r.json().get("exists"))
    except Exception:
        # если API недоступно — показываем меню, чтобы не блокировать пользователя
        return True

async def api_bind_ref(user_id: int, code: str) -> dict:
    """
    POST /api/v1/referrals/bind  -> { ok, already? }
    """
    try:
        r = await _http.post(f"{API_BASE}/referrals/bind", json={"user_id": user_id, "code": code})
        # 200 OK: {"ok": True} или {"ok": True, "already": True}
        if r.status_code == 200:
            return r.json() or {"ok": True}
        # 4xx: код не найден / self_ref / и т.д.
        try:
            msg = r.json()
        except Exception:
            msg = {"error": r.text}
        return {"ok": False, "status": r.status_code, **(msg if isinstance(msg, dict) else {})}
    except Exception as e:
        return {"ok": False, "error": str(e)}

def extract_start_payload(text: Optional[str]) -> str:
    """
    Возвращает payload из /start: "ref_xxx" либо пустую строку.
    """
    if not text:
        return ""
    parts = text.split(maxsplit=1)
    if len(parts) < 2:
        return ""
    return (parts[1] or "").strip()

def try_extract_ref_code(payload: str) -> Optional[str]:
    """
    Принимает 'ref_abc123' -> 'abc123', иначе None.
    """
    if not payload:
        return None
    p = payload.strip().lower()
    if not p.startswith("ref_"):
        return None
    code = p[4:].strip()
    # оставляем только безопасные символы (буквы/цифры/нижнее подчёркивание/дефис)
    import re
    code = re.sub(r"[^a-z0-9_-]", "", code)
    return code or None

# ---------------- Handlers ----------------

@router.message(CommandStart())
async def start_cmd(m: Message):
    uid = m.from_user.id

    # 1) диплинк: /start ref_xxx -> привязка
    payload = extract_start_payload(m.text)
    ref_code = try_extract_ref_code(payload)
    ref_notice: Optional[str] = None
    if ref_code:
        res = await api_bind_ref(uid, ref_code)
        if res.get("ok"):
            if res.get("already"):
                ref_notice = "⚠️ Реферальный код уже привязан к вашему профилю."
            else:
                ref_notice = "✅ Реферальный код применён. Бонус будет начисляться с каждого депозита."
        else:
            # аккуратно отобразим причину
            err = (
                res.get("error")
                or res.get("detail")
                or res.get("message")
                or ("Код не применён" + (f" (HTTP {res.get('status')})" if res.get("status") else ""))
            )
            ref_notice = f"❌ {err}"

    # 2) есть ли пользователь в БД
    exists = await api_user_exists(uid)
    if not exists:
        # экран приветствия + (если был реф-код) — комментарий
        caption = (
            "<b>Добро пожаловать в магазин "
            f"<a href=\"{html.escape(GROUP_URL or PUBLIC_CHAT_URL or '#')}\">Slovekiza</a>!</b>\n\n"
            "Продвигайте свои соц.сети, каналы и воронки по лучшим ценам — в любое время.\n\n"
            f"Можете посетить мой <a href=\"{html.escape(PUBLIC_CHAT_URL or GROUP_URL or '#')}\">открытый чат</a> "
            f"или ознакомиться с моей <a href=\"{html.escape(SCHOOL_URL or '#')}\">школой траффика</a>."
        )
        photo = FSInputFile(WELCOME_IMG) if WELCOME_IMG.exists() else None
        if photo:
            msg = await m.answer_photo(photo, caption=caption, reply_markup=kb_welcome())
        else:
            msg = await m.answer(caption, reply_markup=kb_welcome())
        if ref_notice:
            await m.answer(ref_notice)
        return

    # 3) зарегистрирован — главное меню (+ уведомление о реф-коде, если было)
    await send_main_menu(m)
    if ref_notice:
        await m.answer(ref_notice)

async def send_main_menu(m: Message | CallbackQuery, nick: str | None = None):
    text = (
        f"Привет{',' if nick else ''} <b>{html.escape(nick) if nick else m.from_user.full_name}</b>!\n"
        f"Это магазин <a href=\"{html.escape(GROUP_URL or '#')}\">Slovekizna</a>.\n"
        "Продвигайте свои соц.сети, каналы и воронки по лучшим ценам — в любое время.\n\n"
        f"Можете посетить мой <a href=\"{html.escape(PUBLIC_CHAT_URL or GROUP_URL or '#')}\">открытый чат</a> "
        f"или ознакомиться с моей <a href=\"{html.escape(SCHOOL_URL or '#')}\">школой траффика</a>."
    )
    photo = FSInputFile(MENU_IMG) if MENU_IMG.exists() else None
    if isinstance(m, CallbackQuery):
        if photo:
            await m.message.answer_photo(photo, caption=text, reply_markup=kb_main())
        else:
            await m.message.answer(text, reply_markup=kb_main())
        await m.answer()
    else:
        if photo:
            await m.answer_photo(photo, caption=text, reply_markup=kb_main())
        else:
            await m.answer(text, reply_markup=kb_main())

# ------ simple menu placeholders ------

@router.callback_query(F.data == "menu:about")
async def about_cb(c: CallbackQuery):
    await c.answer()
    await c.message.answer("Мы продаём услуги продвижения по лучшим ценам. Вопросы — в чат поддержки.")

@router.callback_query(F.data == "menu:refs")
async def refs_cb(c: CallbackQuery):
    await c.answer()
    await c.message.answer("Реферальная статистика доступна в мини-апп (вкладка «Рефералы»).")

@router.callback_query(F.data == "menu:roulette")
async def roulette_cb(c: CallbackQuery):
    await c.answer("В разработке", show_alert=True)
