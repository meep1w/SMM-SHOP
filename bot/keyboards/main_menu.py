# -*- coding: utf-8 -*-
"""
Шим-обёртка: даёт те же импорты, что и bot.keyboards.main_menu,
но под капотом использует твой bot.keyboards.common.
Так не придётся переписывать существующие хэндлеры.
"""

from .common import kb_main_menu, kb_register  # реэкспорт

__all__ = ["kb_main_menu", "kb_register"]
