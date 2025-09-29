#!/usr/bin/env python3
import hashlib, re, shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
INDEX = ROOT / "index.html"

PRIORITY_JS  = ["app.js", "app.min.js", "main.js", "bundle.js", "index.js"]
PRIORITY_CSS = ["styles.css", "style.css", "main.css", "index.css"]

def sha1_short(p: Path, n=10) -> str:
    h = hashlib.sha1()
    h.update(p.read_bytes())
    return h.hexdigest()[:n]

def pick_from_index(html: str, kind: str) -> str | None:
    # kind: "js"|"css"
    if kind == "css":
        # <link rel="stylesheet" href="static/css/styles.css?v=...">
        m = re.search(r'href=["\']([^"\']*static/[^"\']+\.css)(?:\?[^"\']*)?["\']', html, re.I)
        return m.group(1) if m else None
    # kind == "js"
    m = re.search(r'src=["\']([^"\']*static/[^"\']+\.js)(?:\?[^"\']*)?["\']', html, re.I)
    return m.group(1) if m else None

def pick_from_fs(kind: str) -> str | None:
    # выбираем лучший кандидат из файловой системы
    base = ROOT / "static" / ("js" if kind == "js" else "css")
    if not base.exists():
        return None
    files = sorted([p for p in base.glob("*.js" if kind == "js" else "*.css")])
    if not files:
        return None
    priolist = PRIORITY_JS if kind == "js" else PRIORITY_CSS
    # сначала по приоритетным именам
    for name in priolist:
        p = base / name
        if p.exists():
            return p.relative_to(ROOT).as_posix()
    # иначе самый «крупный» (часто это бандл)
    files.sort(key=lambda p: p.stat().st_size, reverse=True)
    return files[0].relative_to(ROOT).as_posix()

def make_hashed(src_rel: str) -> tuple[str, str] | None:
    src = ROOT / src_rel
    if not src.exists():
        print(f"[cache-bust] not found in project: {src_rel}")
        return None
    h = sha1_short(src)
    dst = src.with_name(f"{src.stem}.{h}{src.suffix}")
    if not dst.exists():
        shutil.copy2(src, dst)
        print(f"[cache-bust] {src_rel} -> {dst.relative_to(ROOT).as_posix()}")
    else:
        print(f"[cache-bust] already exists: {dst.relative_to(ROOT).as_posix()}")

    # удалить старые версии app.*.js / styles.*.css
    pat = re.compile(rf"^{re.escape(src.stem)}\.[0-9a-f]{{6,}}{re.escape(src.suffix)}$")
    for p in src.parent.glob(f"{src.stem}.*{src.suffix}"):
        if p.name not in {src.name, dst.name} and pat.match(p.name):
            try:
                p.unlink()
                print(f"[cache-bust] removed old {p.relative_to(ROOT).as_posix()}")
            except Exception as e:
                print(f"[cache-bust] warn remove {p}: {e}")

    return (src_rel, dst.relative_to(ROOT).as_posix())

def patch_index(index_path: Path, replacements: list[tuple[str, str]]):
    html = index_path.read_text(encoding="utf-8")
    patched = html
    for src_rel, dst_rel in replacements:
        # подменяем и варианты с ?v=...
        pat = re.compile(rf"{re.escape(src_rel)}(?:\?v=[^\"'\s)<>]+)?")
        patched = pat.sub(dst_rel, patched)
    if patched != html:
        index_path.write_text(patched, encoding="utf-8")
        print(f"[cache-bust] patched {index_path.name}")
    else:
        print(f"[cache-bust] nothing to patch in {index_path.name}")

def main():
    if not INDEX.exists():
        print("[cache-bust] index.html not found — abort")
        return

    html = INDEX.read_text(encoding="utf-8")

    # 1) вытащить пути из index.html
    css_rel = pick_from_index(html, "css")
    js_rel  = pick_from_index(html, "js")

    # 2) если не нашли (например, динамический инжект) — подобрать из FS
    if not css_rel:
        css_rel = pick_from_fs("css")
    if not js_rel:
        js_rel = pick_from_fs("js")

    # Проверка
    targets = []
    if js_rel:  targets.append(("js",  js_rel))
    if css_rel: targets.append(("css", css_rel))

    if not targets:
        print("[cache-bust] no assets discovered (check static/css and static/js and index.html)")
        return

    # 3) для каждого — сделать hashed и собрать замены
    replacements = []
    for _, rel in targets:
        res = make_hashed(rel)
        if res:
            replacements.append(res)

    # 4) пропатчить index.html
    if replacements:
        patch_index(INDEX, replacements)

if __name__ == "__main__":
    main()
#!/usr/bin/env python3
import hashlib, re, shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
INDEX = ROOT / "index.html"

PRIORITY_JS  = ["app.js", "app.min.js", "main.js", "bundle.js", "index.js"]
PRIORITY_CSS = ["styles.css", "style.css", "main.css", "index.css"]

def sha1_short(p: Path, n=10) -> str:
    h = hashlib.sha1()
    h.update(p.read_bytes())
    return h.hexdigest()[:n]

def pick_from_index(html: str, kind: str) -> str | None:
    # kind: "js"|"css"
    if kind == "css":
        # <link rel="stylesheet" href="static/css/styles.css?v=...">
        m = re.search(r'href=["\']([^"\']*static/[^"\']+\.css)(?:\?[^"\']*)?["\']', html, re.I)
        return m.group(1) if m else None
    # kind == "js"
    m = re.search(r'src=["\']([^"\']*static/[^"\']+\.js)(?:\?[^"\']*)?["\']', html, re.I)
    return m.group(1) if m else None

def pick_from_fs(kind: str) -> str | None:
    # выбираем лучший кандидат из файловой системы
    base = ROOT / "static" / ("js" if kind == "js" else "css")
    if not base.exists():
        return None
    files = sorted([p for p in base.glob("*.js" if kind == "js" else "*.css")])
    if not files:
        return None
    priolist = PRIORITY_JS if kind == "js" else PRIORITY_CSS
    # сначала по приоритетным именам
    for name in priolist:
        p = base / name
        if p.exists():
            return p.relative_to(ROOT).as_posix()
    # иначе самый «крупный» (часто это бандл)
    files.sort(key=lambda p: p.stat().st_size, reverse=True)
    return files[0].relative_to(ROOT).as_posix()

def make_hashed(src_rel: str) -> tuple[str, str] | None:
    src = ROOT / src_rel
    if not src.exists():
        print(f"[cache-bust] not found in project: {src_rel}")
        return None
    h = sha1_short(src)
    dst = src.with_name(f"{src.stem}.{h}{src.suffix}")
    if not dst.exists():
        shutil.copy2(src, dst)
        print(f"[cache-bust] {src_rel} -> {dst.relative_to(ROOT).as_posix()}")
    else:
        print(f"[cache-bust] already exists: {dst.relative_to(ROOT).as_posix()}")

    # удалить старые версии app.*.js / styles.*.css
    pat = re.compile(rf"^{re.escape(src.stem)}\.[0-9a-f]{{6,}}{re.escape(src.suffix)}$")
    for p in src.parent.glob(f"{src.stem}.*{src.suffix}"):
        if p.name not in {src.name, dst.name} and pat.match(p.name):
            try:
                p.unlink()
                print(f"[cache-bust] removed old {p.relative_to(ROOT).as_posix()}")
            except Exception as e:
                print(f"[cache-bust] warn remove {p}: {e}")

    return (src_rel, dst.relative_to(ROOT).as_posix())

def patch_index(index_path: Path, replacements: list[tuple[str, str]]):
    html = index_path.read_text(encoding="utf-8")
    patched = html
    for src_rel, dst_rel in replacements:
        # подменяем и варианты с ?v=...
        pat = re.compile(rf"{re.escape(src_rel)}(?:\?v=[^\"'\s)<>]+)?")
        patched = pat.sub(dst_rel, patched)
    if patched != html:
        index_path.write_text(patched, encoding="utf-8")
        print(f"[cache-bust] patched {index_path.name}")
    else:
        print(f"[cache-bust] nothing to patch in {index_path.name}")

def main():
    if not INDEX.exists():
        print("[cache-bust] index.html not found — abort")
        return

    html = INDEX.read_text(encoding="utf-8")

    # 1) вытащить пути из index.html
    css_rel = pick_from_index(html, "css")
    js_rel  = pick_from_index(html, "js")

    # 2) если не нашли (например, динамический инжект) — подобрать из FS
    if not css_rel:
        css_rel = pick_from_fs("css")
    if not js_rel:
        js_rel = pick_from_fs("js")

    # Проверка
    targets = []
    if js_rel:  targets.append(("js",  js_rel))
    if css_rel: targets.append(("css", css_rel))

    if not targets:
        print("[cache-bust] no assets discovered (check static/css and static/js and index.html)")
        return

    # 3) для каждого — сделать hashed и собрать замены
    replacements = []
    for _, rel in targets:
        res = make_hashed(rel)
        if res:
            replacements.append(res)

    # 4) пропатчить index.html
    if replacements:
        patch_index(INDEX, replacements)

if __name__ == "__main__":
    main()
