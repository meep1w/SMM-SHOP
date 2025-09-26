# -*- coding: utf-8 -*-
import random
import string

ARBITRAGE_PREFIX = [
    "Arb", "CPA", "ROI", "Click", "Lead", "Offer", "Bid", "Geo", "Flow",
    "Pixel", "Cortex", "Funnel", "Track", "Traffic", "Boost", "Cap", "UTM",
    "CTR", "CR", "LTV", "Spy", "Warm", "Split",
]
ARBITRAGE_SUFFIX = [
    "Master", "Hunter", "Wizard", "King", "Shark", "Pro", "Agent", "Guru",
    "Pilot", "Fox", "Tiger", "Ninja", "Rider", "Core", "Prime", "Craft",
    "Flow", "Scale", "Labs", "Ops", "Rocket",
]

def generate() -> str:
    pref = random.choice(ARBITRAGE_PREFIX)
    suf  = random.choice(ARBITRAGE_SUFFIX)
    tail = "".join(random.choices(string.digits, k=random.choice([2, 3])))
    sep  = random.choice(["", "_"])
    return f"{pref}{sep}{suf}{tail}"
