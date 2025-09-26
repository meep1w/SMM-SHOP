# -*- coding: utf-8 -*-
import json
import time
from typing import Dict, Any, Optional

from bot.config import USERS_JSON, ensure_runtime_dirs

_users_cache: Dict[str, Dict[str, Any]] = {}

def _load() -> None:
    """Загрузка users.json в память."""
    global _users_cache
    ensure_runtime_dirs()
    try:
        with open(USERS_JSON, "r", encoding="utf-8") as f:
            _users_cache = json.load(f) or {}
    except Exception:
        _users_cache = {}

def _save() -> None:
    """Сохранение кеша в users.json."""
    ensure_runtime_dirs()
    with open(USERS_JSON, "w", encoding="utf-8") as f:
        json.dump(_users_cache, f, ensure_ascii=False, indent=2)

def is_registered(user_id: int) -> bool:
    """Проверка, зарегистрирован ли пользователь."""
    if not _users_cache:
        _load()
    return str(user_id) in _users_cache

def get_nick(user_id: int) -> Optional[str]:
    """Получить ник пользователя, если есть."""
    if not _users_cache:
        _load()
    rec = _users_cache.get(str(user_id))
    return (rec or {}).get("nick")

def set_registered(user_id: int, nick: str) -> None:
    """Отметить пользователя как зарегистрированного и сохранить ник."""
    if not _users_cache:
        _load()
    _users_cache[str(user_id)] = {"nick": nick, "ts": int(time.time())}
    _save()
