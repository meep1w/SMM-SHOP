# -*- coding: utf-8 -*-
from aiogram.fsm.state import StatesGroup, State

class RegStates(StatesGroup):
    waiting_for_nick = State()
    # FSM data:
    #   suggest_msg_id: int | None
    #   last_suggested_nick: str | None
