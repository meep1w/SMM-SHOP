#!/usr/bin/env python3
import hashlib, re, shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
INDEX = ROOT / "index.html"

ASSETS = [
    ROOT / "static/js/app.js",
    ROOT / "static/css/styles.css",
]

def sha1_short(p: Path, n=10) -> str:
    h = hashlib.sha1()
    h.update(p.read_bytes())
    return h.hexdigest()[:n]

def bust_asset(src: Path):
    if not src.exists():
        print(f"[cache-bust] skip, not found: {src}")
        return None

    h = sha1_short(src)
    stem = src.stem        # app / styles
    dst  = src.with_name(f"{stem}.{h}{src.suffix}")  # app.<hash>.js

    if not dst.exists():
        shutil.copy2(src, dst)
        print(f"[cache-bust] {src.relative_to(ROOT)} -> {dst.relative_to(ROOT)}")
    else:
        print(f"[cache-bust] already exists: {dst.relative_to(ROOT)}")

    # удалить старые app.*.js / styles.*.css
    pattern = f"{stem}.*{src.suffix}"
    for p in src.parent.glob(pattern):
        if p.name not in {src.name, dst.name} and re.match(rf"^{re.escape(stem)}\.[0-9a-f]{{6,}}{re.escape(src.suffix)}$", p.name):
            try:
                p.unlink()
                print(f"[cache-bust] removed old {p.relative_to(ROOT)}")
            except Exception as e:
                print(f"[cache-bust] warn remove {p}: {e}")

    # пропатчить index.html (src с опциональным ?v=... → dst без query)
    rel_src = src.relative_to(ROOT).as_posix()
    rel_dst = dst.relative_to(ROOT).as_posix()

    html = INDEX.read_text(encoding="utf-8")
    # матч: static/js/app.js ИЛИ static/js/app.js?v=что-угодно
    pattern = re.compile(rf"{re.escape(rel_src)}(?:\?v=[^\"'\s)<>]+)?")
    new_html = pattern.sub(rel_dst, html)
    if new_html != html:
        INDEX.write_text(new_html, encoding="utf-8")
        print(f"[cache-bust] patched {INDEX.name}: {rel_src} -> {rel_dst}")
    else:
        print(f"[cache-bust] no occurrences of {rel_src} in {INDEX.name}")

def main():
    if not INDEX.exists():
        print("[cache-bust] index.html not found — abort")
        return
    for a in ASSETS:
        bust_asset(a)

if __name__ == "__main__":
    main()
