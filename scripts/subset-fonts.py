# -*- coding: utf-8 -*-
"""
subset-fonts.py — оставляет в файлах шрифта только те символы, которые
на сайте действительно используются.

Зачем: полный набор «расширенной латиницы» весит 85 КБ, а сайту из него нужны
всего несколько букв (ş ň ž). На медленном интернете это лишние две секунды.

Запускать нужно, только если вы добавили текст с новыми символами —
например, начали писать на ещё одном языке. Обычная правка текстов
пересборки не требует: в набор заранее включены все буквы туркменского,
русского и английского алфавитов.

    python3 scripts/subset-fonts.py           — пересобрать
    python3 scripts/subset-fonts.py --check   — только проверить, всё ли влезает

Нужен fontTools:  pip3 install fonttools brotli
Исходные полные шрифты лежат в assets/fonts/full/ — не удаляйте их,
иначе пересобрать будет не из чего.
"""

import os, re, sys, glob, shutil

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
os.chdir(ROOT)
FONTS = os.path.join("assets", "fonts")
FULL = os.path.join(FONTS, "full")
SUBSETS = ["latin", "latin-ext", "cyrillic"]
CHECK = "--check" in sys.argv

# --- Алфавиты, которые держим всегда, даже если сейчас какой-то буквы нет ---
TURKMEN = "aäbçdeéfghijžklmnňoöprsştuüwyýz"
RUSSIAN = "абвгдеёжзийклмнопрстуфхцчшщъыьэюя"
LATIN = "abcdefghijklmnopqrstuvwxyz"
ALWAYS = set()
for alphabet in (TURKMEN, RUSSIAN, LATIN):
    ALWAYS |= set(alphabet) | set(alphabet.upper())
ALWAYS |= set("0123456789")
ALWAYS |= set(" !\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~")
ALWAYS |= set("«»—–…„“”‘’·№€₼$₽™©®°±×÷≈≠→←↑↓•§¶†‡")

ENTITIES = {"&mdash;": "—", "&ndash;": "–", "&laquo;": "«", "&raquo;": "»",
            "&middot;": "·", "&nbsp;": " ", "&copy;": "©", "&amp;": "&",
            "&quot;": '"', "&lt;": "<", "&gt;": ">", "&#39;": "'"}


def pages():
    out = []
    for pat in ("*.html", "*/*.html", "*/*/*.html"):
        for f in glob.glob(pat):
            parts = f.split(os.sep)
            if parts[0] in ("partials", "scripts", "assets", "css", "js", "data"):
                continue
            out.append(f)
    return sorted(set(out))


def content_chars():
    """Символы, которые реально встречаются в текстах сайта."""
    chars = set()
    for f in pages() + glob.glob("partials/*.html") + glob.glob("data/*.json"):
        s = open(f, encoding="utf-8").read()
        s = re.sub(r"<(script|style)\b[\s\S]*?</\1>", " ", s)
        for k, v in ENTITIES.items():
            s = s.replace(k, v)
        chars |= set(s)
    # служебные символы разметки в шрифте не нужны
    return {c for c in chars if c.isprintable() or c.isspace()}


def used_chars():
    """То, что есть на сайте, плюс полные алфавиты — на случай будущих правок."""
    return content_chars() | ALWAYS


def ensure_originals():
    """Первый запуск: прячем полные шрифты в full/, чтобы было из чего пересобирать."""
    os.makedirs(FULL, exist_ok=True)
    for name in SUBSETS:
        src = os.path.join(FONTS, f"inter-{name}.woff2")
        dst = os.path.join(FULL, f"inter-{name}.woff2")
        if not os.path.exists(dst):
            if not os.path.exists(src):
                sys.exit(f"ОШИБКА: нет ни {src}, ни {dst}")
            shutil.copy2(src, dst)


def main():
    try:
        from fontTools import subset
        from fontTools.ttLib import TTFont
    except ImportError:
        sys.exit("Нужен fontTools:  pip3 install fonttools brotli")

    ensure_originals()
    chars = used_chars()
    print(f"Символов на сайте (с запасом на алфавиты): {len(chars)}\n")

    missing_total = []
    before_total = after_total = 0

    for name in SUBSETS:
        full_path = os.path.join(FULL, f"inter-{name}.woff2")
        out_path = os.path.join(FONTS, f"inter-{name}.woff2")

        font = TTFont(full_path)
        cmap = set(font.getBestCmap().keys())
        font.close()

        # какие из нужных символов есть в этом файле
        wanted = {c for c in chars if ord(c) in cmap}
        if not wanted:
            print(f"  {name:10} ни один символ не нужен — файл оставлен как есть")
            continue

        options = subset.Options()
        options.layout_features = ["*"]
        options.name_IDs = ["*"]
        options.notdef_outline = True
        options.recalc_bounds = True
        options.flavor = "woff2"
        options.desubroutinize = False

        font = subset.load_font(full_path, options)
        subsetter = subset.Subsetter(options=options)
        subsetter.populate(unicodes=[ord(c) for c in wanted])
        subsetter.subset(font)

        before = os.path.getsize(full_path)
        if CHECK:
            print(f"  {name:10} символов {len(wanted):4}  (проверка, файл не менялся)")
            font.close()
            continue
        subset.save_font(font, out_path, options)
        font.close()

        after = os.path.getsize(out_path)
        before_total += before
        after_total += after
        print(f"  {name:10} символов {len(wanted):4}   "
              f"{before/1024:6.1f} → {after/1024:5.1f} КБ  (−{(1-after/before)*100:.0f}%)")

    # проверка: каждый символ сайта должен где-то найтись
    have = set()
    for name in SUBSETS:
        f = TTFont(os.path.join(FONTS, f"inter-{name}.woff2"))
        have |= set(f.getBestCmap().keys())
        f.close()
    # предупреждаем только о том, что реально встречается в текстах:
    # символы из «запасных» алфавитов, которых нет в самом Inter, роли не играют
    on_site = content_chars()
    missing_total = sorted(c for c in on_site if ord(c) not in have and not c.isspace())
    if missing_total:
        print("\n⚠  На сайте есть символы, которых нет в шрифте:",
              " ".join(missing_total[:40]))
        print("   Они отрисуются запасным системным шрифтом.")
        print("   Если символы нужны — запустите: python3 scripts/subset-fonts.py")

    if not CHECK and before_total:
        print(f"\nИтого шрифты: {before_total/1024:.0f} → {after_total/1024:.0f} КБ "
              f"(экономия {(before_total-after_total)/1024:.0f} КБ)")


main()
