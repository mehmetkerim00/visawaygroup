# -*- coding: utf-8 -*-
"""
photos.py — готовит фотографии городов для блока стран на главной.

Что делает: берёт исходный снимок, обрезает его по центру до 480×320,
сжимает в WebP не тяжелее 22 КБ и кладёт в assets/photos/. Заодно
записывает, откуда снимок взят, в assets/flags/CREDITS.md.

Зачем так строго по весу: фотографий двенадцать, а посетители сидят
на медленном интернете. Двенадцать снимков по 22 КБ — это 264 КБ,
и они грузятся только когда до них доскроллят (loading="lazy").

Два способа работы
------------------

1. Скачать с Unsplash. Нужен бесплатный ключ разработчика:
   зарегистрируйте приложение на unsplash.com/developers, скопируйте
   Access Key и запустите:

       UNSPLASH_KEY=ваш_ключ python3 scripts/photos.py

   Что искать по каждому городу, написано в data/countries.json,
   поле "query".

2. Взять готовые файлы из папки. Годится, если снимки вы скачали руками
   или они свои собственные. Имена файлов должны совпадать с полем
   "photo" в data/countries.json (istanbul.jpg, moscow.png и так далее):

       python3 scripts/photos.py --from ~/Downloads/goroda

   При этом способе строки об авторах в CREDITS.md скрипт дописать
   не может — впишите их сами.

После запуска:  node scripts/sync-layout.js

Нужен Pillow:  pip3 install pillow
"""

import io, json, os, re, subprocess, sys, urllib.parse

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
os.chdir(ROOT)

PHOTOS = os.path.join("assets", "photos")
CREDITS = os.path.join("assets", "flags", "CREDITS.md")
DATA = os.path.join("data", "countries.json")

WIDTH, HEIGHT = 480, 320
LIMIT = 22 * 1024
SOURCE_EXT = (".jpg", ".jpeg", ".png", ".webp", ".tif", ".tiff")


def fetch(url, headers=None):
    """Качаем через curl: у системного питона на маке часто не настроен
    список корневых сертификатов, и обычный urlopen падает."""
    args = ["curl", "-sSL", "--max-time", "120", "-A", "Mozilla/5.0"]
    for key, value in (headers or {}).items():
        args += ["-H", f"{key}: {value}"]
    args.append(url)
    result = subprocess.run(args, capture_output=True)
    if result.returncode != 0 or not result.stdout:
        raise RuntimeError(f"не удалось скачать {url}: {result.stderr.decode()[:200]}")
    return result.stdout


def crop_and_encode(image):
    """Обрезка по центру до нужных пропорций, потом подбор сжатия."""
    from PIL import Image

    image = image.convert("RGB")
    target = WIDTH / HEIGHT
    width, height = image.size
    if width / height > target:
        new_width = int(height * target)
        left = (width - new_width) // 2
        image = image.crop((left, 0, left + new_width, height))
    else:
        new_height = int(width / target)
        top = (height - new_height) // 2
        image = image.crop((0, top, width, top + new_height))
    image = image.resize((WIDTH, HEIGHT), Image.LANCZOS)

    # Качество подбираем сверху вниз: берём первое, которое влезает в лимит,
    # чтобы не пережимать снимок сильнее необходимого.
    data = None
    for quality in range(85, 24, -3):
        buffer = io.BytesIO()
        image.save(buffer, "WEBP", quality=quality, method=6)
        data = buffer.getvalue()
        if len(data) <= LIMIT:
            return data, quality
    return data, quality


def write_credits(entries):
    """Список источников. Лицензия Unsplash ссылки на автора не требует,
    но при споре именно этот файл показывает, что снимки взяты законно."""
    lines = [
        "# Откуда взяты фотографии и флаги",
        "",
        "Файл нужен на случай вопросов о правах. Лицензия Unsplash разрешает",
        "коммерческое использование и не требует указывать автора, но список",
        "источников — ваше доказательство, что снимки взяты законно.",
        "",
        "## Флаги",
        "",
        "`assets/flags/*.svg` — пакет [flag-icons](https://github.com/lipis/flag-icons),",
        "лицензия MIT: разрешено использовать в коммерческих проектах.",
        "Из пакета взяты только двенадцать нужных файлов, сам пакет в проекте не хранится.",
        "",
        "## Фотографии городов",
        "",
        "`assets/photos/*.webp` — [Unsplash](https://unsplash.com/license),",
        "лицензия разрешает коммерческое использование.",
        "",
        "| Файл | Город | Автор | Снимок |",
        "|---|---|---|---|",
    ]
    for e in entries:
        author = e.get("author") or "—"
        author_link = e.get("author_link")
        photo_link = e.get("photo_link")
        author_cell = f"[{author}]({author_link})" if author_link else author
        photo_cell = f"[{e['id']}]({photo_link})" if photo_link else (e.get("id") or "—")
        lines.append(f"| `{e['slug']}.webp` | {e['city']} | {author_cell} | {photo_cell} |")
    lines.append("")
    os.makedirs(os.path.dirname(CREDITS), exist_ok=True)
    open(CREDITS, "w", encoding="utf-8").write("\n".join(lines))


def load_existing_credits():
    """Строки об авторах из прошлого запуска, чтобы не потерять их,
    когда часть снимков обновляют вручную."""
    known = {}
    if not os.path.exists(CREDITS):
        return known
    for line in open(CREDITS, encoding="utf-8"):
        m = re.match(r"\|\s*`([^`]+)\.webp`\s*\|([^|]*)\|([^|]*)\|([^|]*)\|", line)
        if m:
            known[m.group(1)] = m.group(3).strip()
    return known


def from_unsplash(countries, key):
    from PIL import Image

    entries = []
    for c in countries:
        query = c.get("query") or c["city"]
        url = ("https://api.unsplash.com/search/photos?per_page=5&orientation=landscape&query="
               + urllib.parse.quote(query))
        found = json.loads(fetch(url, {"Authorization": f"Client-ID {key}",
                                       "Accept-Version": "v1"}))
        results = found.get("results") or []
        if not results:
            print(f"  {c['photo']:14} ничего не нашлось по запросу «{query}»")
            continue
        photo = results[0]
        raw = photo["urls"]["raw"] + "&w=1400&fm=jpg&q=85"
        image = Image.open(io.BytesIO(fetch(raw)))
        data, quality = crop_and_encode(image)

        os.makedirs(PHOTOS, exist_ok=True)
        open(os.path.join(PHOTOS, c["photo"] + ".webp"), "wb").write(data)
        entries.append({
            "slug": c["photo"], "city": c["city"], "id": photo["id"],
            "author": photo["user"]["name"],
            "author_link": photo["user"]["links"]["html"],
            "photo_link": photo["links"]["html"],
        })
        mark = "" if len(data) <= LIMIT else "  ПРЕВЫШЕН ЛИМИТ"
        print(f"  {c['photo']:14} {len(data)/1024:5.1f} КБ  качество {quality}"
              f"  © {photo['user']['name']}{mark}")
    return entries


def from_folder(countries, folder):
    from PIL import Image

    folder = os.path.expanduser(folder)
    if not os.path.isdir(folder):
        sys.exit(f"ОШИБКА: нет папки {folder}")

    known = load_existing_credits()
    entries = []
    for c in countries:
        source = None
        for ext in SOURCE_EXT:
            candidate = os.path.join(folder, c["photo"] + ext)
            if os.path.exists(candidate):
                source = candidate
                break
        if not source:
            print(f"  {c['photo']:14} файла нет в папке — пропущен")
            continue

        data, quality = crop_and_encode(Image.open(source))
        os.makedirs(PHOTOS, exist_ok=True)
        open(os.path.join(PHOTOS, c["photo"] + ".webp"), "wb").write(data)
        entries.append({"slug": c["photo"], "city": c["city"],
                        "author": known.get(c["photo"], ""), "id": ""})
        mark = "" if len(data) <= LIMIT else "  ПРЕВЫШЕН ЛИМИТ"
        print(f"  {c['photo']:14} {len(data)/1024:5.1f} КБ  качество {quality}"
              f"  из {os.path.basename(source)}{mark}")
    return entries


def main():
    try:
        import PIL  # noqa: F401
    except ImportError:
        sys.exit("Нужен Pillow:  pip3 install pillow")

    data = json.load(open(DATA, encoding="utf-8"))
    countries = [
        {"photo": c["photo"], "query": c.get("query"), "city": c["city"]["ru"]}
        for c in data["countries"] if c.get("photo")
    ]

    if "--from" in sys.argv:
        folder = sys.argv[sys.argv.index("--from") + 1]
        print(f"Беру готовые снимки из {folder}\n")
        entries = from_folder(countries, folder)
    else:
        key = os.environ.get("UNSPLASH_KEY", "").strip()
        if not key:
            sys.exit(
                "Не задан ключ Unsplash.\n\n"
                "  Бесплатный ключ: unsplash.com/developers → New Application → Access Key.\n"
                "  Потом:  UNSPLASH_KEY=ваш_ключ python3 scripts/photos.py\n\n"
                "  Если снимки уже скачаны руками:\n"
                "          python3 scripts/photos.py --from путь/к/папке"
            )
        print("Скачиваю с Unsplash\n")
        entries = from_unsplash(countries, key)

    if not entries:
        sys.exit("\nНи одной фотографии не получилось — CREDITS.md не тронут.")

    write_credits(entries)
    total = sum(os.path.getsize(os.path.join(PHOTOS, e["slug"] + ".webp")) for e in entries)
    print(f"\nГотово: {len(entries)} шт., вместе {total/1024:.0f} КБ")
    print(f"Источники записаны в {CREDITS}")
    print("Теперь: node scripts/sync-layout.js")


main()
