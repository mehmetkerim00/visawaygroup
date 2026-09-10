# -*- coding: utf-8 -*-
"""
font-fallback.py — считает поправки для запасного шрифта заголовков.

Зачем это нужно
---------------
Заголовочный Unbounded не предзагружается: на медленном интернете каждая
предзагрузка отбирает канал у таблиц стилей, без которых страница не рисуется
вовсе. Значит, первые доли секунды заголовки набраны системным шрифтом.

Unbounded примерно на треть шире любого системного. Без поправок заголовок
в момент подмены менял число строк и толкал вниз всё, что под ним, — это и
есть «прыгающая вёрстка», за которую поисковики штрафуют (метрика CLS).

Что делает скрипт
-----------------
Берёт все заголовки h1 и h2 сайта, считает среднюю ширину знака в Unbounded
и в каждом запасном шрифте — с учётом того, как часто каждый знак в этих
заголовках встречается, — и делит одну на другую. Получается size-adjust:
насколько растянуть системный шрифт, чтобы строка вышла той же длины.
Высоту строки навязываем через ascent-override и descent-override.

    python3 scripts/font-fallback.py

Скрипт ничего не меняет сам: он печатает готовые правила @font-face.
Вставьте их в css/base.css вместо старых.

Запускать нужно, только если поменяли заголовочный шрифт или сильно
переписали заголовки. Обычная правка текста на числа не влияет.

Нужен fontTools:  pip3 install fonttools
"""

import os, re, sys, glob, json
from collections import Counter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
os.chdir(ROOT)

# Полный исходник заголовочного шрифта. Урезанный из assets/fonts/ не годится:
# в нём те же метрики, но пусть скрипт смотрит на первоисточник.
def parts(family):
    return [os.path.join("assets", "fonts", "full", f"{family}-{part}.woff2")
            for part in ("latin", "latin-ext", "cyrillic")]

# Два семейства, у каждого свой запасной набор.
#   Unbounded — только заголовки h1 и h2, поэтому и считаем по заголовкам;
#   Inter     — весь остальной текст, считаем по всему тексту страниц.
# Считать надо именно по своему тексту: у заголовков и у абзацев разный
# набор букв, а от него зависит средняя ширина знака.
FAMILIES = [
    ("Unbounded", "Unbounded fallback", parts("unbounded"), "headings"),
    ("Inter",     "Inter fallback",     parts("inter"),     "body"),
]

# Вертикальные метрики Unbounded в единицах шрифта. Скрипт читает их сам,
# здесь только для справки: ascender 995, descender −245, upm 1000.

# Запасные шрифты по платформам. Порядок важен: в CSS браузер берёт первую
# строку, шрифт которой на устройстве нашёлся.
#
#   path      — файл, если он есть на этой машине (тогда меряем точно);
#   capsize   — иначе средняя ширина знака из @capsizecss/metrics,
#               приведённая к нашей шкале калибровкой по Arial;
#   asc/desc/gap/upm — вертикальные метрики шрифта.
FALLBACKS = [
    ("Segoe",     "Segoe UI",       'local("Segoe UI")',
     dict(capsize=908, asc=2210, desc=-514, gap=0, upm=2048, where="Windows")),
    ("Helvetica", "Helvetica Neue", 'local("Helvetica Neue")',
     dict(path="/System/Library/Fonts/HelveticaNeue.ttc",
          asc=952, desc=-213, gap=28, upm=1000, where="macOS и iOS")),
    ("Roboto",    "Roboto",         'local("Roboto")',
     dict(capsize=911, asc=1900, desc=-500, gap=0, upm=2048, where="Android")),
    ("Arial",     "Arial",          'local("Arial"), local("Liberation Sans")',
     dict(path="/System/Library/Fonts/Supplemental/Arial.ttf",
          capsize=913, asc=1854, desc=-434, gap=67, upm=2048,
          where="всё остальное, включая Linux")),
]

ENTITIES = {"&mdash;": "—", "&ndash;": "–", "&laquo;": "«", "&raquo;": "»",
            "&nbsp;": " ", "&amp;": "&", "&#39;": "'"}


def text_frequencies(scope):
    """Сколько раз каждый знак встречается в тексте сайта.
    scope="headings" — только заголовки h1 и h2, scope="body" — всё остальное."""
    freq = Counter()
    files = glob.glob("*.html") + glob.glob("*/*.html") + glob.glob("*/*/*.html")
    for f in files:
        # Партиалы пропускаем: их содержимое уже разложено по страницам,
        # а заголовки колонок подвала набраны не Unbounded, а Inter.
        if f.split(os.sep)[0] in ("scripts", "assets", "css", "js", "data",
                                  "backups", "partials"):
            continue
        s = open(f, encoding="utf-8").read()
        if scope == "headings":
            chunks = [m.group(1) for m in re.finditer(r"<h[12]\b[^>]*>([\s\S]*?)</h[12]>", s)]
        else:
            # Весь видимый текст: выбрасываем служебные блоки и сами теги,
            # заголовки h1/h2 тоже — их набирает другой шрифт.
            body = re.sub(r"<(script|style|svg)\b[\s\S]*?</\1>", " ", s)
            body = re.sub(r"<!--[\s\S]*?-->", " ", body)
            body = re.sub(r"<h[12]\b[^>]*>[\s\S]*?</h[12]>", " ", body)
            chunks = [body]
        for chunk in chunks:
            text = re.sub(r"<[^>]*>", " ", chunk)
            for k, v in ENTITIES.items():
                text = text.replace(k, v)
            freq.update(re.sub(r"\s+", " ", text).strip())
    return freq


def widths_of(paths):
    """Ширина каждого знака в долях кегля. На вход — один файл или несколько
    (у Unbounded три: латиница, расширенная латиница, кириллица)."""
    from fontTools.ttLib import TTFont
    out = {}
    for path in ([paths] if isinstance(paths, str) else paths):
        font = TTFont(path, fontNumber=0)
        upm = font["head"].unitsPerEm
        cmap = font.getBestCmap()
        hmtx = font["hmtx"]
        for code, glyph in cmap.items():
            out.setdefault(chr(code), hmtx[glyph][0] / upm)
        font.close()
    return out


def compare(display, fallback, freq):
    """Средние ширины знака у двух шрифтов, считанные по одному и тому же
    набору знаков: сравнивать можно только то, что есть в обоих."""
    common = [(c, n) for c, n in freq.items() if c in display and c in fallback]
    total = sum(n for _, n in common)
    if not total:
        sys.exit("ОШИБКА: у шрифтов нет общих знаков из заголовков")
    a = sum(display[c] * n for c, n in common) / total
    b = sum(fallback[c] * n for c, n in common) / total
    return a, b, total / sum(freq.values())


def vertical_metrics(path):
    from fontTools.ttLib import TTFont
    font = TTFont(path if isinstance(path, str) else path[0])
    upm = font["head"].unitsPerEm
    os2, hhea = font["OS/2"], font["hhea"]
    # Браузер берёт метрики OS/2 typo, если у шрифта поднят флаг USE_TYPO_METRICS,
    # иначе — hhea. Считаем так же, чтобы совпало с тем, что нарисует браузер.
    if os2.fsSelection & (1 << 7):
        asc, desc, gap = os2.sTypoAscender, os2.sTypoDescender, os2.sTypoLineGap
    else:
        asc, desc, gap = hhea.ascender, hhea.descender, hhea.lineGap
    font.close()
    return asc, abs(desc), gap, upm


def main():
    try:
        import fontTools  # noqa: F401
    except ImportError:
        sys.exit("Нужен fontTools:  pip3 install fonttools brotli")

    arial = next(d for _, _, _, d in FALLBACKS if d.get("where", "").startswith("всё"))

    all_rules = []
    for title, css_prefix, files, scope in FAMILIES:
        missing = [p for p in files if not os.path.exists(p)]
        if missing:
            sys.exit(f"ОШИБКА: нет {', '.join(missing)}\n"
                     "Полные исходники шрифтов лежат в assets/fonts/full/ и в репозиторий "
                     "не попадают — возьмите их с той машины, где собирали шрифты.")

        freq = text_frequencies(scope)
        if not freq:
            sys.exit(f"ОШИБКА: не нашлось текста для {title}")

        display = widths_of(files)
        asc, desc, gap, upm = vertical_metrics(files)

        where = "заголовкам h1 и h2" if scope == "headings" else "остальному тексту"
        print(f"\n{title}: считаем по {where} — "
              f"{len(freq)} различных знаков, {sum(freq.values())} всего")
        print(f"  ascender {asc}, descender −{desc}, кегль {upm}\n")

        # Шкала capsize отличается от нашей: калибруем её по Arial,
        # который измерен обоими способами.
        _, arial_measured, _ = compare(display, widths_of(arial["path"]), freq)
        scale = arial_measured / (arial["capsize"] / arial["upm"])

        print(f"  {'запасной шрифт':18}{'size-adjust':>12}{'ascent':>9}{'descent':>9}{'line-gap':>10}")
        for key, name, src, d in FALLBACKS:
            if d.get("path") and os.path.exists(d["path"]):
                display_avg, avg, cover = compare(display, widths_of(d["path"]), freq)
                source = f"измерен, общих знаков {cover*100:.0f}%"
            else:
                # Файла шрифта на этой машине нет — берём его среднюю ширину
                # из @capsizecss/metrics, приведя её к нашей шкале.
                display_avg = sum(display[c] * n for c, n in freq.items() if c in display)
                display_avg /= sum(n for c, n in freq.items() if c in display)
                avg = d["capsize"] / d["upm"] * scale
                source = "по @capsizecss/metrics"

            size_adjust = display_avg / avg
            all_rules.append((css_prefix, key, d["where"],
                              src, size_adjust * 100,
                              (asc / upm) / size_adjust * 100,
                              (desc / upm) / size_adjust * 100,
                              (gap / upm) / size_adjust * 100))
            print(f"    {name:16}{size_adjust*100:10.2f}%{(asc/upm)/size_adjust*100:8.2f}%"
                  f"{(desc/upm)/size_adjust*100:8.2f}%{(gap/upm)/size_adjust*100:9.2f}%"
                  f"   ({source})")

    print("\n" + "─" * 72)
    print("Вставьте это в css/base.css вместо прежних правил:\n")
    for prefix, key, where, src, sa, a, dsc, g in all_rules:
        print(f'@font-face {{\n'
              f'  font-family: "{prefix} {key}";   /* {where} */\n'
              f'  src: {src};\n'
              f'  size-adjust: {sa:.2f}%;\n'
              f'  ascent-override: {a:.2f}%;\n'
              f'  descent-override: {dsc:.2f}%;\n'
              f'  line-gap-override: {g:.2f}%;\n'
              f'}}\n')


main()
