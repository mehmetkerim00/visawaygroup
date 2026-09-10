# -*- coding: utf-8 -*-
"""
photos.py — готовит фотографии городов для блока стран на главной.

Что делает: берёт исходный снимок, обрезает по центру до 480×320, приводит
к общему виду, сжимает в WebP не тяжелее 22 КБ и кладёт в assets/photos/.
Заодно переписывает assets/photos/CREDITS.md.

Зачем так строго по весу: снимков двенадцать, а посетители сидят на медленном
интернете. Двенадцать по 22 КБ — это 264 КБ, и грузятся они только когда
до них доскроллят (loading="lazy").

Про общую обработку
-------------------
Снимки сделаны разными людьми и разной техникой. Если положить их в сетку
как есть, набор рассыпается: один синее, другой желтее, третий вялый.
Поэтому ко всем двенадцати применяются ОДИНАКОВЫЕ поправки — чуть меньше
насыщенности, чуть больше контраста, лёгкая общая теплота. Индивидуально
ничего не подгоняется: смысл именно в том, что обработка одна на всех.
Это выравнивание, а не фильтр — здания и небо остаются естественными.

Три способа работы
------------------

1. Скачать с Викисклада по списку из data/photos.json — так собран
   нынешний набор:

       python3 scripts/photos.py --commons

2. Скачать с Unsplash. Нужен бесплатный ключ разработчика
   (unsplash.com/developers → New Application → Access Key):

       UNSPLASH_KEY=ваш_ключ python3 scripts/photos.py --unsplash

   Что искать по каждому городу — в data/countries.json, поле "query".

3. Взять готовые файлы из папки. Имена должны совпадать с полем "photo"
   в data/countries.json (istanbul.jpg, moscow.png и так далее):

       python3 scripts/photos.py --from ~/Downloads/goroda

   При этом способе строки об авторах скрипт дописать не может —
   впишите их в data/photos.json сами.

После запуска:  node scripts/sync-layout.js

Нужен Pillow:  pip3 install pillow
"""

import io, json, os, re, subprocess, sys, urllib.parse

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
os.chdir(ROOT)

PHOTOS = os.path.join("assets", "photos")
CREDITS = os.path.join("assets", "photos", "CREDITS.md")
COUNTRIES = os.path.join("data", "countries.json")
SOURCES = os.path.join("data", "photos.json")

WIDTH, HEIGHT = 480, 320
LIMIT = 22 * 1024
SOURCE_EXT = (".jpg", ".jpeg", ".png", ".webp", ".tif", ".tiff")

# --- Общая обработка. Одни и те же числа для всех двенадцати снимков. -------
# Меняете — меняйте осторожно и сразу для всех: разнобой хуже, чем
# не самая удачная, но одинаковая обработка.
SATURATION = 0.88   # чуть спокойнее цвет
CONTRAST   = 1.08   # чуть плотнее тени
WARM_RED   = 1.03   # общая теплота: красного немного больше…
WARM_BLUE  = 0.97   # …синего немного меньше

COMMONS_API = "https://commons.wikimedia.org/w/api.php"
AGENT = "VisaWayGroup-site-build/1.0 (kerimdev7@gmail.com)"


def fetch(url, headers=None):
    """Качаем через curl: у системного питона на маке часто не настроен
    список корневых сертификатов, и обычный urlopen падает."""
    args = ["curl", "-sSL", "--max-time", "120", "-A", AGENT]
    for key, value in (headers or {}).items():
        args += ["-H", f"{key}: {value}"]
    args.append(url)
    result = subprocess.run(args, capture_output=True)
    if result.returncode != 0 or not result.stdout:
        raise RuntimeError(f"не удалось скачать {url}: {result.stderr.decode()[:200]}")
    return result.stdout


def grade(image):
    """Общая обработка: одинаковая для всех снимков набора."""
    from PIL import Image, ImageEnhance

    image = ImageEnhance.Contrast(image).enhance(CONTRAST)
    image = ImageEnhance.Color(image).enhance(SATURATION)
    red, green, blue = image.split()
    red = red.point(lambda v: min(255, int(v * WARM_RED)))
    blue = blue.point(lambda v: min(255, int(v * WARM_BLUE)))
    return Image.merge("RGB", (red, green, blue))


def crop_and_encode(image):
    """Обрезка по центру, общая обработка, потом подбор сжатия."""
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
    image = grade(image.resize((WIDTH, HEIGHT), Image.LANCZOS))

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


def sources():
    if not os.path.exists(SOURCES):
        return None
    return json.load(open(SOURCES, encoding="utf-8"))


def write_credits():
    """Список источников. Для CC-BY и CC-BY-SA указание автора обязательно,
    а для CC-BY-SA обязательна ещё и пометка, что изменённая версия
    распространяется под той же лицензией."""
    data = sources()
    if not data:
        print("  data/photos.json нет — CREDITS.md не тронут")
        return

    notice = data["notice"]
    lines = [
        "# Откуда взяты фотографии и флаги",
        "",
        "Файл нужен на случай вопросов о правах. Для снимков под CC-BY и CC-BY-SA",
        "указание автора — требование лицензии, а не вежливость. Тот же список",
        "открыт посетителям на странице `suratlar.html`.",
        "",
        "Собирается скриптом: `python3 scripts/photos.py`. Правьте не этот файл,",
        "а `data/photos.json`.",
        "",
        "## Флаги",
        "",
        "`assets/flags/*.svg` — пакет [flag-icons](https://github.com/lipis/flag-icons),",
        "лицензия MIT: разрешено использовать в коммерческих проектах.",
        "Из пакета взяты только двенадцать нужных файлов, сам пакет в проекте не хранится.",
        "",
        "## Фотографии городов",
        "",
        "Все — [Викисклад](https://commons.wikimedia.org/), лицензии CC0, CC-BY и CC-BY-SA.",
        "Файлов с условиями «некоммерческое использование» и «без производных» в наборе нет:",
        "они нам запрещены.",
        "",
        f"Обработка одна на все снимки: {notice['modified']['ru']}",
        "",
    ]
    for p in data["photos"]:
        path = os.path.join(PHOTOS, p["photo"] + ".webp")
        size = f"{os.path.getsize(path)/1024:.1f} КБ" if os.path.exists(path) else "файла нет"
        lines.append(f"### {p['city']['ru']} — `{p['photo']}.webp` ({size})")
        lines.append("")
        lines.append(f"- Автор: **{p['author']}**")
        licence = f"[{p['licence']}]({p['licenceUrl']})" if p.get("licenceUrl") else p["licence"]
        lines.append(f"- Лицензия: {licence}")
        lines.append(f"- Страница описания: <{p['page']}>")
        note = notice["modified"]["ru"]
        if p.get("shareAlike"):
            note += " " + notice["shareAlike"]["ru"]
        lines.append(f"- {note}")
        lines.append("")

    os.makedirs(os.path.dirname(CREDITS), exist_ok=True)
    open(CREDITS, "w", encoding="utf-8").write("\n".join(lines))


def cities():
    """Города из data/countries.json — по ним же названы файлы."""
    data = json.load(open(COUNTRIES, encoding="utf-8"))
    return [{"photo": c["photo"], "query": c.get("query"), "city": c["city"]["ru"]}
            for c in data["countries"] if c.get("photo")]


def save(slug, data, quality, note):
    os.makedirs(PHOTOS, exist_ok=True)
    open(os.path.join(PHOTOS, slug + ".webp"), "wb").write(data)
    mark = "" if len(data) <= LIMIT else "  ПРЕВЫШЕН ЛИМИТ"
    print(f"  {slug:14} {len(data)/1024:5.1f} КБ  качество {quality}  {note}{mark}")


def from_commons():
    from PIL import Image

    data = sources()
    if not data:
        sys.exit(f"ОШИБКА: нет {SOURCES} — из чего скачивать, неизвестно")

    titles = [p["file"] for p in data["photos"]]
    args = ["curl", "-sS", "--max-time", "90", "-G", COMMONS_API, "-A", AGENT]
    for key, value in (("action", "query"), ("format", "json"), ("prop", "imageinfo"),
                       ("iiprop", "url"), ("iiurlwidth", "1400"),
                       ("titles", "|".join("File:" + t for t in titles))):
        args += ["--data-urlencode", f"{key}={value}"]
    answer = json.loads(subprocess.run(args, capture_output=True).stdout)
    by_title = {}
    for page in answer["query"]["pages"].values():
        info = (page.get("imageinfo") or [{}])[0]
        by_title[page["title"][5:]] = info.get("thumburl") or info.get("url")

    done = 0
    for p in data["photos"]:
        url = by_title.get(p["file"])
        if not url:
            print(f"  {p['photo']:14} не нашёлся на Викискладе: {p['file']}")
            continue
        image = Image.open(io.BytesIO(fetch(url)))
        payload, quality = crop_and_encode(image)
        save(p["photo"], payload, quality, f"© {p['author']}")
        done += 1
    return done


def from_unsplash():
    from PIL import Image

    key = os.environ.get("UNSPLASH_KEY", "").strip()
    if not key:
        sys.exit("Не задан ключ: UNSPLASH_KEY=ваш_ключ python3 scripts/photos.py --unsplash")

    done = 0
    for c in cities():
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
        image = Image.open(io.BytesIO(fetch(photo["urls"]["raw"] + "&w=1400&fm=jpg&q=85")))
        payload, quality = crop_and_encode(image)
        save(c["photo"], payload, quality, f"© {photo['user']['name']}")
        done += 1
    print("\n⚠  Данные об авторах впишите в data/photos.json вручную.")
    return done


def from_folder(folder):
    from PIL import Image

    folder = os.path.expanduser(folder)
    if not os.path.isdir(folder):
        sys.exit(f"ОШИБКА: нет папки {folder}")

    done = 0
    for c in cities():
        source = None
        for ext in SOURCE_EXT:
            candidate = os.path.join(folder, c["photo"] + ext)
            if os.path.exists(candidate):
                source = candidate
                break
        if not source:
            print(f"  {c['photo']:14} файла нет в папке — пропущен")
            continue
        payload, quality = crop_and_encode(Image.open(source))
        save(c["photo"], payload, quality, f"из {os.path.basename(source)}")
        done += 1
    return done


def main():
    try:
        import PIL  # noqa: F401
    except ImportError:
        sys.exit("Нужен Pillow:  pip3 install pillow")

    if "--from" in sys.argv:
        folder = sys.argv[sys.argv.index("--from") + 1]
        print(f"Беру готовые снимки из {folder}\n")
        done = from_folder(folder)
    elif "--unsplash" in sys.argv:
        print("Скачиваю с Unsplash\n")
        done = from_unsplash()
    else:
        print("Скачиваю с Викисклада по списку из data/photos.json\n")
        done = from_commons()

    if not done:
        sys.exit("\nНи одной фотографии не получилось.")

    write_credits()
    total = sum(os.path.getsize(os.path.join(PHOTOS, f))
                for f in os.listdir(PHOTOS) if f.endswith(".webp"))
    print(f"\nГотово: {done} шт., вместе {total/1024:.0f} КБ")
    print(f"Источники записаны в {CREDITS}")
    print("Теперь: node scripts/sync-layout.js")


main()
