# -*- coding: utf-8 -*-
from aiogram.fsm.state import StatesGroup, State


class RegStates(StatesGroup):
    waiting_nick = State()
