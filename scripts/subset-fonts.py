# -*- coding: utf-8 -*-
"""
subset-fonts.py — оставляет в файлах шрифта только те символы, которые
на сайте действительно используются.

Зачем: полный набор «расширенной латиницы» весит 85 КБ, а сайту из него нужны
всего несколько букв (ş ň ž). На медленном интернете это лишние две секунды.

Семейств два:
  Inter      — весь текст сайта;
  Unbounded  — только заголовки h1 и h2 (ось веса заранее обрезана до 600–700,
               других начертаний заголовкам не нужно).

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

# Семейства шрифтов: имя файла без диапазона → как называется в CSS.
# Добавите третье — допишите строку, остальное подхватится само.
FAMILIES = {"inter": "Inter", "unbounded": "Unbounded"}

# Какие возможности OpenType оставляем в шрифте.
# Полный набор («*») тянет за собой альтернативные начертания и стилистические
# наборы, которых на сайте нет: у Unbounded это 11 КБ из 27. Оставляем только
# то, что действительно работает при обычном наборе текста:
#   kern, mark, mkmk — межбуквенные расстояния и посадка диакритики (ä, ň, ş);
#   ccmp, locl       — сборка составных букв и локальные формы;
#   liga, rlig, calt — обычные и обязательные лигатуры, контекстные подстановки.
LAYOUT_FEATURES = ["kern", "mark", "mkmk", "ccmp", "locl", "liga", "rlig", "calt"]

# Насколько «толстым» бывает шрифт. Оба семейства переменные: в них плавно
# лежат все веса подряд, и каждый лишний стоит места. Сайту нужны только
# перечисленные, остальное вырезаем — Inter от этого худеет на треть.
#   Inter:     400 обычный, 500 средний, 600 полужирный, 700 жирный;
#   Unbounded: 600 и 700, других заголовкам не нужно.
# Меняете здесь — поменяйте font-weight в @font-face в css/base.css.
WEIGHT_RANGE = {"inter": (400, 700), "unbounded": (600, 700)}
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
    for family in FAMILIES:
        for name in SUBSETS:
            src = os.path.join(FONTS, f"{family}-{name}.woff2")
            dst = os.path.join(FULL, f"{family}-{name}.woff2")
            if not os.path.exists(dst):
                if not os.path.exists(src):
                    sys.exit(f"ОШИБКА: нет ни {src}, ни {dst}")
                shutil.copy2(src, dst)


def heading_chars():
    """Символы, которые встречаются только в заголовках h1 и h2.
    Акцидентным шрифтом набраны именно они — остального ему знать не нужно."""
    chars = set()
    for f in pages() + glob.glob("partials/*.html"):
        s = open(f, encoding="utf-8").read()
        for m in re.finditer(r"<h[12]\b[^>]*>([\s\S]*?)</h[12]>", s):
            t = re.sub(r"<[^>]*>", " ", m.group(1))
            for k, v in ENTITIES.items():
                t = t.replace(k, v)
            chars |= set(t)
    return {c for c in chars if c.isprintable() or c.isspace()}


def build(family, chars, report):
    """Собирает три файла одного семейства и возвращает (было, стало) в байтах."""
    from fontTools import subset
    from fontTools.ttLib import TTFont
    from fontTools.varLib import instancer

    before_total = after_total = 0
    for name in SUBSETS:
        full_path = os.path.join(FULL, f"{family}-{name}.woff2")
        out_path = os.path.join(FONTS, f"{family}-{name}.woff2")

        font = TTFont(full_path)
        cmap = set(font.getBestCmap().keys())
        font.close()

        wanted = {c for c in chars if ord(c) in cmap}
        if not wanted:
            report.append(f"  {name:10} ни один символ не нужен — файл оставлен как есть")
            continue

        options = subset.Options()
        options.layout_features = list(LAYOUT_FEATURES)
        options.name_IDs = ["*"]
        options.notdef_outline = True
        options.recalc_bounds = True
        options.flavor = "woff2"
        options.desubroutinize = False

        # Сначала обрезаем ось веса, потом уже буквы: так в файл не попадут
        # заготовки для начертаний, которых на сайте нет.
        cut_path = os.path.join(FONTS, f".{family}-{name}.tmp.woff2")
        cut = TTFont(full_path)
        cut = instancer.instantiateVariableFont(
            cut, {"wght": WEIGHT_RANGE[family]}, updateFontNames=False)
        cut.flavor = "woff2"
        cut.save(cut_path)
        cut.close()

        font = subset.load_font(cut_path, options)
        subsetter = subset.Subsetter(options=options)
        subsetter.populate(unicodes=[ord(c) for c in wanted])
        subsetter.subset(font)

        before = os.path.getsize(full_path)
        if CHECK:
            report.append(f"  {name:10} символов {len(wanted):4}  (проверка, файл не менялся)")
            font.close()
            os.remove(cut_path)
            continue
        subset.save_font(font, out_path, options)
        font.close()
        os.remove(cut_path)

        after = os.path.getsize(out_path)
        before_total += before
        after_total += after
        report.append(f"  {name:10} символов {len(wanted):4}   "
                      f"{before/1024:6.1f} → {after/1024:5.1f} КБ  (−{(1-after/before)*100:.0f}%)")
    return before_total, after_total


def coverage(family, needed):
    """Каждый символ, который реально стоит на странице, должен где-то найтись."""
    from fontTools.ttLib import TTFont
    have = set()
    for name in SUBSETS:
        f = TTFont(os.path.join(FONTS, f"{family}-{name}.woff2"))
        have |= set(f.getBestCmap().keys())
        f.close()
    missing = sorted(c for c in needed if ord(c) not in have and not c.isspace())
    if missing:
        print(f"\n⚠  {FAMILIES[family]}: на сайте есть символы, которых нет в шрифте:",
              " ".join(missing[:40]))
        print("   Они отрисуются запасным системным шрифтом.")


def main():
    try:
        from fontTools import subset  # noqa: F401
    except ImportError:
        sys.exit("Нужен fontTools:  pip3 install fonttools brotli")

    ensure_originals()

    # Inter набирает весь сайт, Unbounded — только заголовки.
    # Но в обоих держим полные алфавиты: иначе правка текста потребует пересборки.
    needed = {"inter": content_chars(), "unbounded": heading_chars()}
    chars = {f: needed[f] | ALWAYS for f in FAMILIES}

    print(f"Символов на сайте (с запасом на алфавиты): {len(chars['inter'])}\n")

    before_total = after_total = 0
    for family, title in FAMILIES.items():
        report = []
        b, a = build(family, chars[family], report)
        print(f"{title}:")
        for line in report:
            print(line)
        print()
        before_total += b
        after_total += a

    if CHECK:
        return

    for family in FAMILIES:
        coverage(family, needed[family])

    if before_total:
        print(f"Итого шрифты: {before_total/1024:.0f} → {after_total/1024:.0f} КБ "
              f"(экономия {(before_total-after_total)/1024:.0f} КБ)")


main()
