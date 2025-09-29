#!/usr/bin/env python3
import hashlib, re, shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

# Ищем index.html: сначала webapp/index.html, потом index.html в корне
CANDIDATES = [
    ROOT / "webapp" / "index.html",
    ROOT / "index.html",
]
INDEX = next((p for p in CANDIDATES if p.exists()), None)
if INDEX is None:
    print("[cache-bust] index.html not found (tried webapp/index.html and index.html)")
    raise SystemExit(0)

BASE = INDEX.parent  # корень фронта (обычно webapp/)
STATIC_DIR = BASE / "static"

PRIORITY_JS  = ["app.js", "app.min.js", "main.js", "bundle.js", "index.js"]
PRIORITY_CSS = ["styles.css", "style.css", "main.css", "index.css"]

def sha1_short(p: Path, n=10) -> str:
    h = hashlib.sha1()
    h.update(p.read_bytes())
    return h.hexdigest()[:n]

def pick_from_index(html: str, kind: str) -> str | None:
    # Считываем относительные пути из index.html (от BASE)
    if kind == "css":
        m = re.search(r'href=["\']([^"\']*static/[^"\']+\.css)(?:\?[^"\']*)?["\']', html, re.I)
        return m.group(1) if m else None
    m = re.search(r'src=["\']([^"\']*static/[^"\']+\.js)(?:\?[^"\']*)?["\']', html, re.I)
    return m.group(1) if m else None

def pick_from_fs(kind: str) -> str | None:
    base = STATIC_DIR / ("js" if kind == "js" else "css")
    if not base.exists():
        return None
    files = sorted(base.glob("*.js" if kind == "js" else "*.css"))
    if not files:
        return None
    priolist = PRIORITY_JS if kind == "js" else PRIORITY_CSS
    for name in priolist:
        p = base / name
        if p.exists():
            return p.relative_to(BASE).as_posix()
    files.sort(key=lambda p: p.stat().st_size, reverse=True)
    return files[0].relative_to(BASE).as_posix()

def make_hashed(src_rel: str) -> tuple[str, str] | None:
    src = BASE / src_rel
    if not src.exists():
        print(f"[cache-bust] not found: {src_rel}")
        return None
    h = sha1_short(src)
    dst = src.with_name(f"{src.stem}.{h}{src.suffix}")
    if not dst.exists():
        shutil.copy2(src, dst)
        print(f"[cache-bust] {src_rel} -> {dst.relative_to(BASE).as_posix()}")
    else:
        print(f"[cache-bust] already exists: {dst.relative_to(BASE).as_posix()}")

    # чистим старые app.*.js / styles.*.css
    pat = re.compile(rf"^{re.escape(src.stem)}\.[0-9a-f]{{6,}}{re.escape(src.suffix)}$")
    for p in src.parent.glob(f"{src.stem}.*{src.suffix}"):
        if p.name not in {src.name, dst.name} and pat.match(p.name):
            try:
                p.unlink()
                print(f"[cache-bust] removed old {p.relative_to(BASE).as_posix()}")
            except Exception as e:
                print(f"[cache-bust] warn remove {p}: {e}")
    return (src_rel, dst.relative_to(BASE).as_posix())

def patch_index(index_path: Path, replacements: list[tuple[str, str]]):
    html = index_path.read_text(encoding="utf-8")
    patched = html
    for src_rel, dst_rel in replacements:
        pat = re.compile(rf"{re.escape(src_rel)}(?:\?v=[^\"'\s)<>]+)?")
        patched = pat.sub(dst_rel, patched)
    if patched != html:
        index_path.write_text(patched, encoding="utf-8")
        print(f"[cache-bust] patched {index_path.relative_to(ROOT).as_posix()}")
    else:
        print(f"[cache-bust] nothing to patch in {index_path.name}")

def main():
    html = INDEX.read_text(encoding="utf-8")

    # 1) пробуем вытащить пути из index.html
    css_rel = pick_from_index(html, "css")
    js_rel  = pick_from_index(html, "js")

    # 2) если не нашли (был динамический инжект) — берём из FS
    if not css_rel:
        css_rel = pick_from_fs("css")
    if not js_rel:
        js_rel = pick_from_fs("js")

    targets = []
    if js_rel:  targets.append(js_rel)
    if css_rel: targets.append(css_rel)
    if not targets:
        print("[cache-bust] no assets discovered (check webapp/static/** and index.html)")
        return

    replacements = []
    for rel in targets:
        res = make_hashed(rel)
        if res:
            replacements.append(res)

    if replacements:
        patch_index(INDEX, replacements)

if __name__ == "__main__":
    main()
