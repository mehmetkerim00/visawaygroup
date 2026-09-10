#!/usr/bin/env node
/*
 * sync-layout.js — раскладывает общие куски вёрстки и контактные данные
 * по всем страницам сайта на всех трёх языках.
 *
 * Как пользоваться:
 *     node scripts/sync-layout.js            — разложить по всем страницам
 *     node scripts/sync-layout.js --check    — только проверить, ничего не менять
 *
 * ЧТО ОН ДЕЛАЕТ
 *
 * 1. Метки-комментарии. В каждой странице есть парные метки:
 *        <!-- header:start nav="wizalar" -->
 *        ...сюда кладётся содержимое partials/header.html...
 *        <!-- header:end -->
 *    Всё между ними перезаписывается, сами метки остаются.
 *
 * 2. Языки. Язык страницы определяется по её пути:
 *        wizalar.html            → tk (туркменский, основной)
 *        ru/wizalar.html         → ru
 *        en/wizalar.html         → en
 *    Для языка берётся partials/имя.<язык>.html, а если такого файла нет —
 *    общий partials/имя.html. Значки общие для всех языков.
 *
 * 3. Контакты. Внутри партиалов пишутся плейсхолдеры {{phone}}, {{email}},
 *    {{address}} — скрипт подставляет значения из data/site.json.
 *    Телефон подставляется в двух формах:
 *        {{phone}}      — как показывать:  +993 12 34-56-78
 *        {{phoneHref}}  — для ссылки:      tel:+99312345678
 *    Поля, которые надо переводить (адрес, часы работы, языки обслуживания),
 *    лежат в site.json с разбивкой по языкам — скрипт сам берёт нужный.
 *
 * 4. Списки. Внутри партиала можно повторить кусок для каждого элемента
 *    массива из site.json:
 *        <!-- for:messengers -->  ...{{label}}, {{value}}...  <!-- endfor -->
 *
 * 5. Переключатель языков ведёт на ТУ ЖЕ страницу в другом языке.
 *    Соответствие вычисляется по зеркальной структуре папок. Если перевода
 *    нет, ссылка честно ведёт на главную того языка.
 *
 * 6. Ссылки hreflang в <head>. Между метками <!-- hreflang:start --> и
 *    <!-- hreflang:end --> скрипт сам расставляет canonical и hreflang
 *    на все три версии страницы плюс x-default на туркменскую.
 *
 * 7. Относительные пути. В партиалах пути пишутся так, как будто страница
 *    лежит в корне. Для вложенных папок скрипт сам подставит ../
 *
 * 8. Контакты в обычном тексте:
 *        <span data-site="phone">...</span>       — подставит текст
 *        <a data-site-href="mapUrl" href="...">   — подставит адрес ссылки
 *
 * Никаких сторонних библиотек: только то, что есть в Node из коробки.
 */

"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const PARTIALS_DIR = path.join(ROOT, "partials");
const SITE_FILE = path.join(ROOT, "data", "site.json");
let CHECK_ONLY = process.argv.includes("--check");

/* Список языков и разбор путей — в общей библиотеке scripts/lib-site.js,
   чтобы у sync-layout.js и build-seo.js они не разошлись. */
const LIB = require("./lib-site.js");
const LANGS = LIB.LANGS;
const LANG_DIR = LIB.LANG_DIR;
const DEFAULT_LANG = LIB.DEFAULT_LANG;
const TODO = LIB.TODO;

/* Папки, в которые заглядывать не надо. Список общий для всех скриптов. */
const SKIP_DIRS = LIB.SKIP_DIRS;


const warnings = [];
const errors = [];
const todoFields = [];
function warn(m) { if (!warnings.includes(m)) warnings.push(m); }
function err(m) { if (!errors.includes(m)) errors.push(m); }
function fail(m) { console.error("ОШИБКА: " + m); process.exit(1); }
function isTodo(v) { return typeof v === "string" && v.indexOf(TODO) !== -1; }


/* ==================================================================== */
/* Язык и зеркальные пути                                               */
/* ==================================================================== */

/* "ru/wizalar/is-wizasy.html" -> "ru" ;  "wizalar.html" -> "tk" */
function langOf(rel) {
  const first = rel.split("/")[0];
  for (const l of LANGS) if (LANG_DIR[l] && first === LANG_DIR[l]) return l;
  return DEFAULT_LANG;
}

/* "ru/wizalar/is-wizasy.html" -> "wizalar/is-wizasy.html" (путь без языка) */
function stripLang(rel) {
  const l = langOf(rel);
  return LANG_DIR[l] ? rel.slice(LANG_DIR[l].length + 1) : rel;
}

/* ("wizalar/is-wizasy.html", "ru") -> "ru/wizalar/is-wizasy.html" */
function joinLang(bare, lang) {
  return LANG_DIR[lang] ? LANG_DIR[lang] + "/" + bare : bare;
}

/* Относительный путь от одной страницы к другой */
function relLink(fromRel, toRel) {
  const fromDir = path.posix.dirname(fromRel.split(path.sep).join("/"));
  const rel = path.posix.relative(fromDir === "." ? "" : fromDir, toRel);
  return rel || path.posix.basename(toRel);
}


/* ==================================================================== */
/* Контактные данные                                                    */
/* ==================================================================== */

function loadSite() {
  if (!fs.existsSync(SITE_FILE)) fail("Нет файла data/site.json.");
  try {
    return JSON.parse(fs.readFileSync(SITE_FILE, "utf8"));
  } catch (e) {
    fail("data/site.json не читается — скорее всего, лишняя или пропущенная запятая.\n" + e.message);
  }
}

/* Значение может быть общим ("текст") или языковым ({tk:…, ru:…, en:…}) */
function pick(value, lang) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    if (Object.prototype.hasOwnProperty.call(value, lang)) return value[lang];
  }
  return value;
}

function telHref(phone) {
  if (!phone || isTodo(phone.tel || "")) return "#";
  const digits = String(phone.tel).replace(/[^\d+]/g, "");
  return digits ? "tel:" + digits : "#";
}

function flatten(obj, prefix, out, lang) {
  for (const key of Object.keys(obj)) {
    if (key.startsWith("_")) continue;
    let value = obj[key];
    const name = prefix ? prefix + "." + key : key;

    if (value && typeof value === "object" && !Array.isArray(value)) {
      /* Языковой словарь — берём нужный язык и кладём как обычное значение */
      if (LANGS.some(l => Object.prototype.hasOwnProperty.call(value, l))) {
        value = pick(value, lang);
        if (Array.isArray(value)) continue;
        out[name] = String(value == null ? "" : value);
        continue;
      }
      flatten(value, name, out, lang);
    } else if (!Array.isArray(value)) {
      out[name] = String(value);
    }
  }
}

function buildValues(site, lang) {
  const v = {};
  flatten(site, "", v, lang);

  const a = pick(site.address, lang) || {};
  const parts = [];
  if (a.city) parts.push(lang === "tk" ? a.city + " ş." : a.city);
  if (a.street) parts.push(a.street);
  if (a.office) parts.push(a.office);
  v.address = parts.join(", ");
  v.landmark = a.landmark || "";
  v.mapUrl = isTodo(site.address.mapUrl || "") ? "#" : (site.address.mapUrl || "#");

  const phones = site.phones || [];
  v.phone = phones[0] ? phones[0].display : "";
  v.phoneHref = telHref(phones[0]);
  v.phone2 = phones[1] ? phones[1].display : "";
  v.phone2Href = phones[1] ? telHref(phones[1]) : "#";

  v.email = site.email || "";
  v.emailHref = isTodo(v.email) ? "#" : "mailto:" + v.email;

  const hours = pick(site.hours, lang) || [];
  v.hoursHtml = hours.map(h => h.days + ": " + h.time).join("<br>");
  v.hoursText = hours.map(h => h.days + ": " + h.time).join(" · ");

  v.serviceLanguages = (pick(site.serviceLanguages, lang) || []).join(", ");
  v.name = site.name;
  v.nameFull = site.name + (pick(site.nameSuffix, lang) || "");
  v.tagline = pick(site.tagline, lang) || "";
  v.siteUrl = isTodo(site.domain || "") ? "" : "https://" + site.domain + "/";

  return v;
}

function collectTodo(site) {
  const seen = new Set();
  const add = (p, val) => { if (isTodo(val) && !seen.has(p)) { seen.add(p); todoFields.push(p + ": " + val); } };
  const walk = (obj, prefix) => {
    for (const key of Object.keys(obj)) {
      if (key.startsWith("_")) continue;
      const val = obj[key];
      const name = prefix ? prefix + "." + key : key;
      if (Array.isArray(val)) val.forEach((it, i) => {
        if (it && typeof it === "object") walk(it, `${name}[${i}]`); else add(`${name}[${i}]`, it);
      });
      else if (val && typeof val === "object") walk(val, name);
      else add(name, val);
    }
  };
  walk(site, "");
}

function decorateItem(item, list, lang) {
  const out = {};
  for (const k of Object.keys(item)) {
    const val = pick(item[k], lang);
    out[k] = String(val == null ? "" : val);
  }
  if (list === "phones") out.href = telHref(item);
  if (list === "messengers" || list === "social") {
    const linkable = out.url && !isTodo(out.url);
    out.valueHtml = linkable ? `<a href="${out.url}">${out.value}</a>` : out.value;
    out.hasNote = out.note ? "" : "hidden";
    out.formUrlSafe = out.formUrl && !isTodo(out.formUrl) ? out.formUrl : "";
  }
  return out;
}


/* ==================================================================== */
/* Партиалы и страницы                                                  */
/* ==================================================================== */

function loadPartials() {
  if (!fs.existsSync(PARTIALS_DIR)) fail("Нет папки partials/.");
  const partials = new Map();
  for (const file of fs.readdirSync(PARTIALS_DIR)) {
    if (!file.endsWith(".html")) continue;
    partials.set(file.replace(/\.html$/, ""),
      fs.readFileSync(path.join(PARTIALS_DIR, file), "utf8").replace(/\s+$/, ""));
  }
  if (partials.size === 0) fail("В папке partials/ нет ни одного .html файла.");
  return partials;
}

/* Ищем partials/имя.<язык>.html, иначе общий partials/имя.html */
function resolvePartial(partials, name, lang) {
  const localized = `${name}.${lang}`;
  if (partials.has(localized)) return partials.get(localized);
  if (partials.has(name)) return partials.get(name);
  return null;
}

function findPages(dir, found = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      findPages(full, found);
    } else if (entry.name.endsWith(".html")) {
      found.push(full);
    }
  }
  return found;
}


/* ==================================================================== */
/* Преобразования                                                       */
/* ==================================================================== */

const LEAVE_ALONE = /^(#|\/|\{\{|[a-z][a-z0-9+.-]*:|\/\/)/i;

/* Общие файлы: лежат в корне и одинаковы для всех языков */
const SHARED_ROOT = /^(assets|css|js|data)\/|^(manifest\.webmanifest|sitemap\.xml|robots\.txt)$/;

/*
 * Пути в партиалах пишутся так, как будто страница лежит в корне:
 *   href="wizalar.html"  src="assets/logo-horizontal.svg"
 *
 * Дальше они расходятся:
 *   • общие файлы (assets, css, js) одни на весь сайт — до них надо
 *     подняться в корень;
 *   • ссылки на страницы должны вести на страницу ТОГО ЖЕ языка,
 *     то есть на ru/wizalar.html, а не на wizalar.html.
 *
 * Раньше здесь ко всему без разбора приписывалось ../ до корня, и меню
 * на русской странице уводило на туркменскую версию.
 */
function fixPaths(html, relPosix, lang, prefix) {
  return html.replace(/\s(href|src)="([^"]*)"/g, (whole, attr, value) => {
    if (value === "" || LEAVE_ALONE.test(value) || value.startsWith("../")) return whole;

    if (SHARED_ROOT.test(value)) {
      return prefix ? ` ${attr}="${prefix}${value}"` : whole;
    }

    /* ссылка на страницу — переводим её в папку текущего языка */
    const hash = value.indexOf("#");
    const bare = hash === -1 ? value : value.slice(0, hash);
    const tail = hash === -1 ? "" : value.slice(hash);
    const target = joinLang(bare, lang);
    return ` ${attr}="${relLink(relPosix, target)}${tail}"`;
  });
}

/* <!-- if:mapUrl --> ... <!-- endif -->
   Блок остаётся, только если значение непустое. Так пустые поля в site.json
   не оставляют на странице дыр: заголовков без содержимого, пустых строк
   и ссылок в никуда. Работает и с обычными полями, и со списками. */
function expandConditions(html, site, values) {
  return html.replace(
    /* Имя поля обязано начинаться с буквы: иначе примером синтаксиса
       в обычном комментарии можно случайно вырезать половину партиала. */
    /[ \t]*<!--\s*if:([a-zA-Z][\w.]*)\s*-->\n?([\s\S]*?)[ \t]*<!--\s*endif\s*-->\n?/g,
    (whole, key, body) => {
      let filled;
      if (Array.isArray(site[key])) {
        filled = site[key].length > 0;
      } else {
        const value = values[key];
        filled = typeof value === "string" && value.trim() !== "" &&
                 !isTodo(value) && value !== "#";
      }
      return filled ? body : "";
    }
  );
}

function expandLoops(html, site, lang) {
  return html.replace(
    /[ \t]*<!--\s*for:([\w.]+)\s*-->\n?([\s\S]*?)[ \t]*<!--\s*endfor\s*-->\n?/g,
    (whole, listName, body) => {
      const list = site[listName];
      if (!Array.isArray(list)) {
        warn(`в site.json нет списка "${listName}" — блок for:${listName} пропущен`);
        return "";
      }
      return list.map(item => substitute(body, decorateItem(item, listName, lang), true)).join("");
    }
  );
}

function substitute(html, values, quiet) {
  return html.replace(/\{\{([\w.]+)\}\}/g, (whole, key) => {
    if (Object.prototype.hasOwnProperty.call(values, key)) return values[key];
    if (!quiet) warn(`неизвестный плейсхолдер {{${key}}} — такого поля нет в data/site.json`);
    return whole;
  });
}

function markActiveNav(html, navKey) {
  if (!navKey) return html;
  let matched = false;
  const out = html.replace(/<a([^>]*\sdata-nav-key="([^"]*)"[^>]*)>/g, (whole, attrs, key) => {
    if (key !== navKey) return whole;
    matched = true;
    return `<a${attrs} aria-current="page">`;
  });
  if (!matched) warn(`в шапке нет ссылки с data-nav-key="${navKey}"`);
  return out;
}

function fillDataSite(html, values) {
  html = html.replace(
    /(<(\w+)[^>]*\sdata-site="([\w.]+)"[^>]*>)((?:[^<]|<(?!\/\2>))*)(<\/\2>)/g,
    (whole, open, tag, key, _old, close) => {
      if (!Object.prototype.hasOwnProperty.call(values, key)) {
        warn(`data-site="${key}" — такого поля нет в data/site.json`);
        return whole;
      }
      return open + values[key] + close;
    }
  );
  html = html.replace(
    /<(\w+)([^>]*\sdata-site-href="([\w.]+)"[^>]*)>/g,
    (whole, tag, attrs, key) => {
      if (!Object.prototype.hasOwnProperty.call(values, key)) {
        warn(`data-site-href="${key}" — такого поля нет в data/site.json`);
        return whole;
      }
      const withHref = /\shref="[^"]*"/.test(attrs)
        ? attrs.replace(/\shref="[^"]*"/, ` href="${values[key]}"`)
        : `${attrs} href="${values[key]}"`;
      return `<${tag}${withHref}>`;
    }
  );
  return html;
}


/* ==================================================================== */
/* Переключатель языков и hreflang                                      */
/* ==================================================================== */

/* Для каждого языка: ссылка на ту же страницу, а если её нет — на главную */
function languageTargets(rel, existing) {
  const bare = stripLang(rel.split(path.sep).join("/"));
  const out = {};
  for (const l of LANGS) {
    const mirror = joinLang(bare, l);
    const home = joinLang("index.html", l);
    const target = existing.has(mirror) ? mirror : home;
    if (!existing.has(mirror) && bare !== "index.html") {
      warn(`нет перевода: ${mirror} — переключатель ведёт на ${home}`);
    }
    out[l] = target;
  }
  return out;
}

function buildLangValues(rel, existing) {
  const relPosix = rel.split(path.sep).join("/");
  const lang = langOf(relPosix);
  const targets = languageTargets(relPosix, existing);
  const v = {};
  for (const l of LANGS) {
    v[l + "Url"] = relLink(relPosix, targets[l]);
    v[l + "Current"] = (l === lang) ? ' aria-current="true"' : "";
  }
  return { values: v, targets: targets, lang: lang };
}

/* ==================================================================== */
/* Блок стран на главной                                                */
/* ==================================================================== */

/* Строится из data/countries.json: и сетка карточек, и кнопки фильтра.
   Правят только этот файл — разметку трогать не нужно.

   Фотография вставляется, только если файл действительно лежит
   в assets/photos/. Нет файла — карточка соберётся без него и вёрстка
   не поедет; появится файл — следующий запуск скрипта его подхватит. */

let countriesData = null;

function loadCountries() {
  if (countriesData) return countriesData;
  const file = path.join(ROOT, "data", "countries.json");
  if (!fs.existsSync(file)) {
    err("нет data/countries.json — блок стран собрать не из чего");
    return null;
  }
  countriesData = JSON.parse(fs.readFileSync(file, "utf8"));
  return countriesData;
}

function escapeAttr(text) {
  return String(text).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

function countriesBlock(lang, prefix, indent, relPosix) {
  const data = loadCountries();
  if (!data) return `${indent}<!-- блок стран не собран -->`;

  const pick = (obj) => (obj && (obj[lang] || obj[DEFAULT_LANG])) || "";
  const L = data.labels || {};
  const i = indent;
  const out = [];

  out.push(`${i}<div class="countries" data-countries data-reveal>`);

  /* Кнопки фильтра. Без скриптов они бесполезны, поэтому спрятаны стилями
     до тех пор, пока у <html> не появится класс js. */
  out.push(`${i}  <div class="countries__filter" role="group" aria-label="${escapeAttr(pick(L.filter))}">`);
  for (const region of data.regions) {
    const first = region.key === "all";
    out.push(`${i}    <button class="chip" type="button" data-region="${region.key}"` +
             ` aria-pressed="${first ? "true" : "false"}">${pick(region)}</button>`);
  }
  out.push(`${i}  </div>`);

  out.push(`${i}  <ul class="countries__grid" data-countries-grid>`);
  for (const c of data.countries) {
    const country = pick(c.country);
    const city = pick(c.city);
    const alt = pick(L.photoOf).replace("{{city}}", city);
    const photoFile = c.photo ? path.join(ROOT, "assets", "photos", c.photo + ".webp") : null;
    const hasPhoto = photoFile && fs.existsSync(photoFile);

    out.push(`${i}    <li class="country" data-region="${c.region}">`);
    out.push(`${i}      <div class="country__photo">`);
    if (hasPhoto) {
      /* width и height обязательны: браузер резервирует место под картинку
         заранее, и страница не дёргается, когда фотография догрузится. */
      out.push(`${i}        <img src="${prefix}assets/photos/${c.photo}.webp"` +
               ` alt="${escapeAttr(alt)}" width="480" height="320"` +
               ` loading="lazy" decoding="async">`);
    }
    out.push(`${i}      </div>`);
    out.push(`${i}      <div class="country__label">`);
    out.push(`${i}        <img class="country__flag" src="${prefix}assets/flags/${c.flag}.svg"` +
             ` alt="" width="24" height="18" loading="lazy" decoding="async">`);
    out.push(`${i}        <span class="country__name">${country}</span>`);
    out.push(`${i}        <span class="country__city">${city}</span>`);
    out.push(`${i}      </div>`);
    out.push(`${i}    </li>`);
  }
  out.push(`${i}  </ul>`);

  /* Сообщение на случай, если фильтр не нашёл ни одной страны.
     Показывает его скрипт, поэтому в разметке оно скрыто. */
  out.push(`${i}  <p class="countries__empty" data-countries-empty hidden>${pick(L.empty)}</p>`);

  out.push(`${i}  <p class="countries__more">`);
  out.push(`${i}    <span>${pick(L.more)}</span>`);
  const contacts = relLink(relPosix, joinLang("habarlasmak.html", lang));
  out.push(`${i}    <a href="${contacts}">${pick(L.moreCta)}</a>`);
  out.push(`${i}  </p>`);
  out.push(`${i}</div>`);

  return out.join("\n");
}


/* ==================================================================== */
/* Предзагрузка шрифтов                                                 */
/* ==================================================================== */

/* Шрифты не предзагружаются вовсе — и это замер, а не экономия ради экономии.
   На 400 Кбит/с предзагрузка отбирает канал у таблиц стилей, без которых
   страница не рисуется:

     без предзагрузки   — первый текст через 1,7 с;
     один файл          — 2,0 с, срок на пределе;
     четыре файла       — 2,6 с, срок сорван.

   Пока шрифты едут, текст набран системным, подтянутым к их метрикам
   (см. @font-face в css/base.css): ни строка, ни высота при подмене
   не меняются, вёрстка не прыгает.

   Блок оставлен на случай, если предзагрузка всё же понадобится:
   допишите сюда строку — и она появится на всех страницах нужного языка.

   Замерять после правок:  node scripts/serve.js  и  node scripts/measure-speed.js  */

function fontsBlock(lang, prefix, indent) {
  return `${indent}<!-- Шрифты не предзагружаем: см. scripts/sync-layout.js, fontsBlock -->`;
}


function bootBlock(indent) {
  return `${indent}<script>document.documentElement.classList.add("js");</script>`;
}

function hreflangBlock(rel, existing, siteUrl, indent) {
  const relPosix = rel.split(path.sep).join("/");
  const lang = langOf(relPosix);
  const targets = languageTargets(relPosix, existing);
  const abs = p => siteUrl ? siteUrl + p : relLink(relPosix, p);

  const lines = [];
  lines.push(`${indent}<link rel="canonical" href="${abs(relPosix)}">`);
  for (const l of LANGS) {
    lines.push(`${indent}<link rel="alternate" hreflang="${l}" href="${abs(targets[l])}">`);
  }
  lines.push(`${indent}<link rel="alternate" hreflang="x-default" href="${abs(targets[DEFAULT_LANG])}">`);
  if (!siteUrl) {
    lines.push(`${indent}<!-- Адреса относительные: домен ещё не вписан в data/site.json.`);
    lines.push(`${indent}     Поисковики предпочитают полные адреса — впишите домен и запустите скрипт снова. -->`);
  }
  /* Проверка: файлы, на которые ссылаемся, должны существовать */
  for (const l of LANGS) {
    if (!existing.has(targets[l])) err(`${relPosix}: hreflang="${l}" ведёт на несуществующий ${targets[l]}`);
  }
  return { html: lines.join("\n"), lang: lang };
}


/* ==================================================================== */
/* Сборка страницы                                                      */
/* ==================================================================== */

const MARKER = /([ \t]*)<!--\s*([a-zA-Z][\w-]*):start([^>]*?)-->([\s\S]*?)<!--\s*\2:end\s*-->/g;

function parseAttrs(raw) {
  const attrs = {};
  for (const m of raw.matchAll(/([\w-]+)="([^"]*)"/g)) attrs[m[1]] = m[2];
  return attrs;
}

function syncFile(file, partials, site, valuesByLang, existing) {
  const original = fs.readFileSync(file, "utf8");
  const relative = path.relative(ROOT, file);
  const relPosix = relative.split(path.sep).join("/");
  const depth = relPosix.split("/").length - 1;
  const prefix = "../".repeat(depth);

  const lang = langOf(relPosix);
  const values = valuesByLang[lang];
  const langInfo = buildLangValues(relative, existing);

  let blocks = 0;

  let updated = original.replace(MARKER, (whole, indent, name, rawAttrs) => {
    /* Микроразметку заполняет build-seo.js — партиала для неё нет */
    if (name === "jsonld") return whole;

    /* Сетка стран и фильтр — из data/countries.json */
    if (name === "countries") {
      blocks++;
      return `${indent}<!-- countries:start -->\n${countriesBlock(lang, prefix, indent, relPosix)}\n${indent}<!-- countries:end -->`;
    }

    /* Строка, которая должна отработать до первой отрисовки */
    if (name === "boot") {
      blocks++;
      return `${indent}<!-- boot:start -->\n${bootBlock(indent)}\n${indent}<!-- boot:end -->`;
    }

    /* Список шрифтов зависит только от языка страницы — партиал не нужен */
    if (name === "fonts") {
      blocks++;
      return `${indent}<!-- fonts:start -->\n${fontsBlock(lang, prefix, indent)}\n${indent}<!-- fonts:end -->`;
    }

    /* hreflang собирается скриптом, файла-партиала для него нет */
    if (name === "hreflang") {
      blocks++;
      const b = hreflangBlock(relative, existing, values.siteUrl, indent);
      return `${indent}<!-- hreflang:start -->\n${b.html}\n${indent}<!-- hreflang:end -->`;
    }

    const body0 = resolvePartial(partials, name, lang);
    if (body0 === null) {
      warn(`${relPosix}: метка "${name}" есть, а файла partials/${name}.html нет`);
      return whole;
    }
    blocks++;
    const attrs = parseAttrs(rawAttrs);

    let body = body0;
    body = fixPaths(body, relPosix, lang, prefix);
    /* В условиях <!-- if:… --> видны и поля site.json, и атрибуты самой метки:
       так одна и та же шапка знает, лежит ли под ней тёмный первый экран. */
    body = expandConditions(body, site, Object.assign({}, values, attrs));
    body = expandLoops(body, site, lang);
    body = substitute(body, Object.assign({}, values, langInfo.values, attrs));
    body = markActiveNav(body, attrs.nav);

    const attrText = rawAttrs.trim() ? " " + rawAttrs.trim() : "";
    return `${indent}<!-- ${name}:start${attrText} -->\n${body}\n${indent}<!-- ${name}:end -->`;
  });

  updated = fillDataSite(updated, values);

  return { relative: relPosix, lang, blocks, changed: updated !== original, updated };
}


/* ==================================================================== */
/* Проверки языковой чётности и остатков перевода                       */
/* ==================================================================== */

/* Буквы, которые есть в туркменском, но не в русском и английском */
const TK_LETTERS = /[äöüýňşžçÄÖÜÝŇŞŽÇ]/;

/* Что разрешено оставлять нетронутым: название компании, город, страна,
   а также названия, которые так и пишутся в русском и английском. */
const ALLOWED = [
  "VisaWay Group", "VisaWay", "Group",
  "Aşgabat", "Türkmenistan", "türkmen", "Türkmen", "Türkiye"
];

function checkParity(existing) {
  const bares = new Set();
  for (const rel of existing) bares.add(stripLang(rel));
  for (const bare of [...bares].sort()) {
    for (const l of LANGS) {
      const want = joinLang(bare, l);
      if (!existing.has(want)) err(`страница есть не на всех языках: нет ${want} (есть ${bare})`);
    }
  }
}

/* Названия и слова, которые одинаковы во всех языках */
const BRAND = new Set([
  "visaway", "group", "aşgabat", "türkmenistan", "türkiye",
  "whatsapp", "telegram", "instagram", "portfolio", "visawaygroup",
  "belarus",      /* пишется одинаково по-туркменски и по-английски */
  "javascript"    /* название технологии, не переводится */
]);

/* Значения из site.json намеренно одинаковы на всех языках: почта, телефон,
   юридическое название, номер лицензии, адреса мессенджеров. Их нельзя
   принимать за непереведённый текст, иначе проверка будет ругаться вечно. */
let sharedValuesCache = null;
function sharedValues(site) {
  if (sharedValuesCache) return sharedValuesCache;
  const out = [];
  const walk = (value) => {
    if (typeof value === "string") {
      if (value.trim().length >= 3) out.push(value.trim());
    } else if (Array.isArray(value)) {
      value.forEach(walk);
    } else if (value && typeof value === "object") {
      for (const key of Object.keys(value)) if (!key.startsWith("_")) walk(value[key]);
    }
  };
  walk(site);

  /* Названия стран и городов тоже одинаковы во многих языках: Berlin,
     Almaty, Minsk, Kuala Lumpur пишутся так и по-туркменски, и по-английски.
     Без этого проверка перевода считала бы их непереведённым текстом. */
  const countriesFile = path.join(ROOT, "data", "countries.json");
  if (fs.existsSync(countriesFile)) {
    try {
      walk(JSON.parse(fs.readFileSync(countriesFile, "utf8")));
    } catch (e) {
      warn(`data/countries.json не читается: ${e.message}`);
    }
  }

  /* сначала длинные, чтобы вырезать целые фразы, а не их куски */
  sharedValuesCache = out.sort((a, b) => b.length - a.length);
  return sharedValuesCache;
}

/* Видимый текст страницы без разметки, комментариев и общих данных */
function visibleText(file, site) {
  let s = fs.readFileSync(file, "utf8");
  s = s.replace(/<!--[\s\S]*?-->/g, " ");
  s = s.replace(/<(script|style|svg)\b[\s\S]*?<\/\1>/g, " ");
  s = s.replace(/<[^>]+>/g, " ");
  s = s.replace(/ЗАПОЛНИТЬ:?[^\n<]{0,40}/g, " ");
  s = s.replace(/&[a-z]+;/gi, " ");        /* &mdash; &laquo; и подобные — не слова */
  if (site) for (const value of sharedValues(site)) s = s.split(value).join(" ");
  return s;
}

/* Длинные латинские слова — по ним сравниваем перевод с оригиналом */
function longLatinWords(text) {
  const out = new Set();
  for (const w of text.split(/[^A-Za-zÄÖÜÝŇŞŽÇäöüýňşžç]+/)) {
    if (w.length >= 5 && !BRAND.has(w.toLowerCase())) out.add(w.toLowerCase());
  }
  return out;
}

/* Сравниваем переведённую страницу с туркменским оригиналом: если длинное
   слово встречается в обеих, скорее всего кусок забыли перевести.
   Так ловятся и фразы без характерных букв — например «Wizalar we hyzmatlar». */
function checkAgainstSource(file, relPosix, lang, existing, site) {
  if (lang === DEFAULT_LANG) return;          /* оригинал сам с собой не сравниваем */
  const bare = stripLang(relPosix);
  if (!existing.has(bare)) return;
  const src = longLatinWords(visibleText(path.join(ROOT, bare), site));
  const dst = longLatinWords(visibleText(file, site));
  const shared = [...dst].filter(w => src.has(w));
  if (shared.length) {
    err(`${relPosix}: похоже, текст не переведён — те же слова, что в оригинале: ` +
        shared.slice(0, 6).join(", ") + (shared.length > 6 ? ` и ещё ${shared.length - 6}` : ""));
  }
}

function checkUntranslated(file, relPosix, lang, site) {
  if (lang === DEFAULT_LANG) return;
  let s = fs.readFileSync(file, "utf8");
  /* Убираем то, что переводить не надо */
  s = s.replace(/<!--[\s\S]*?-->/g, "");
  s = s.replace(/<(script|style|svg)\b[\s\S]*?<\/\1>/g, "");
  s = s.replace(/<[^>]+>/g, " ");
  /* Сначала вырезаем целые значения из site.json, потом отдельные названия:
     иначе название компании удалится первым и разорвёт длинную строку
     вроде VisaWay Group. */
  if (site) for (const value of sharedValues(site)) s = s.split(value).join(" ");
  for (const a of ALLOWED) s = s.split(a).join(" ");

  const hits = [];
  for (const word of s.split(/\s+/)) {
    if (!word || !TK_LETTERS.test(word)) continue;
    if (hits.includes(word)) continue;
    hits.push(word);
  }
  /* Незаполненные данные из site.json (ЗАПОЛНИТЬ: telefon и т. п.)
     показываются на всех языках одинаково — это не ошибка перевода. */
  if (s.indexOf(TODO) !== -1) {
    const todoWords = new Set();
    for (const m of s.matchAll(/ЗАПОЛНИТЬ:?\s*([^\n<]{0,40})/g)) {
      for (const w of m[1].split(/\s+/)) if (w) todoWords.add(w);
    }
    for (let i = hits.length - 1; i >= 0; i--) if (todoWords.has(hits[i])) hits.splice(i, 1);
  }
  if (hits.length) {
    err(`${relPosix}: похоже, остался непереведённый текст — ${hits.slice(0, 6).join(", ")}` +
        (hits.length > 6 ? ` и ещё ${hits.length - 6}` : ""));
  }
}


/* ==================================================================== */

function run(options = {}) {
  CHECK_ONLY = !!options.check;
  const quiet = !!options.quiet;
  const say = (...a) => { if (!quiet) console.log(...a); };
  warnings.length = 0; errors.length = 0; todoFields.length = 0;
  sharedValuesCache = null;

  const site = loadSite();
  collectTodo(site);
  const valuesByLang = {};
  for (const l of LANGS) valuesByLang[l] = buildValues(site, l);

  const partials = loadPartials();
  const pages = findPages(ROOT).sort();
  if (pages.length === 0) fail("Не найдено ни одной html-страницы.");

  const existing = new Set(pages.map(p => path.relative(ROOT, p).split(path.sep).join("/")));

  const byLang = {};
  for (const l of LANGS) byLang[l] = 0;
  for (const rel of existing) byLang[langOf(rel)]++;

  say(
    `Партиалы: ${[...partials.keys()].sort().join(", ")}\n` +
    `Контакты: data/site.json\n` +
    `Страниц: ${pages.length}  (tk: ${byLang.tk}, ru: ${byLang.ru}, en: ${byLang.en})\n`
  );

  let changedCount = 0, noMarkers = 0;

  for (const file of pages) {
    const res = syncFile(file, partials, site, valuesByLang, existing);
    if (CHECK_ONLY) {
      checkUntranslated(file, res.relative, res.lang, site);
      checkAgainstSource(file, res.relative, res.lang, existing, site);
    }

    if (res.blocks === 0) {
      noMarkers++;
      say(`  —  ${res.relative}  (меток нет, не трогаю)`);
    } else if (!res.changed) {
      say(`  =  ${res.relative}  [${res.lang}]  ${res.blocks} бл. — совпадает`);
    } else {
      changedCount++;
      if (CHECK_ONLY) {
        say(`  !  ${res.relative}  [${res.lang}]  ${res.blocks} бл. — ОТЛИЧАЕТСЯ`);
      } else {
        fs.writeFileSync(file, res.updated, "utf8");
        say(`  ✓  ${res.relative}  [${res.lang}]  ${res.blocks} бл. — обновлено`);
      }
    }
  }

  if (CHECK_ONLY) checkParity(existing);

  /* Поисковая часть: sitemap, robots и микроразметка */
  const seo = require("./build-seo.js").run({ check: CHECK_ONLY });
  say("\nПоиск:");
  say(`  микроразметка ${CHECK_ONLY ? "отличается на" : "обновлена на"} страницах: ${seo.changed}`);
  say(`  sitemap.xml: ${seo.sitemapStale ? (CHECK_ONLY ? "устарел" : "обновлён") : "актуален"}`);
  say(`  robots.txt:  ${seo.robotsStale ? (CHECK_ONLY ? "устарел" : "обновлён") : "актуален"}`);
  for (const n of seo.notes) say("  • " + n);
  for (const p of seo.problems) err(p);

  if (warnings.length) {
    say("\nПредупреждения:");
    for (const w of warnings) say("  • " + w);
  }

  if (errors.length) {
    say(`\n✖  ОШИБКИ — ${errors.length} шт.`);
    for (const e of errors) say("   • " + e);
  }

  if (todoFields.length) {
    say(`\n⚠  НЕЗАПОЛНЕННЫЕ ДАННЫЕ — ${todoFields.length} шт.`);
    say("   Пока они не заменены, на сайте вместо контактов видно слово ЗАПОЛНИТЬ.\n");
    for (const t of todoFields) say("     site.json → " + t);
  }

  const result = {
    pages: pages.length,
    changed: changedCount,
    warnings: warnings.slice(),
    errors: errors.slice(),
    todoFields: todoFields.slice(),
    seo
  };

  say("");
  if (CHECK_ONLY) {
    let bad = false;
    if (changedCount > 0) {
      say(`Проверка: ${changedCount} стр. отличается от партиалов.`);
      say("Чтобы обновить, запустите:  node scripts/sync-layout.js");
      bad = true;
    }
    if (errors.length) {
      say(`Проверка: найдено ошибок — ${errors.length}. Публиковать рано.`);
      bad = true;
    }
    if (!bad) {
      say(todoFields.length
        ? "Проверка: вёрстка и языки в порядке, но контакты ещё не заполнены (список выше)."
        : "Проверка: всё в порядке.");
    }
    result.ok = !bad;
  } else {
    say(changedCount === 0
      ? "Готово. Всё и так было актуально."
      : `Готово. Обновлено страниц: ${changedCount}.`);
    if (noMarkers) say(`Без меток осталось файлов: ${noMarkers}.`);
    result.ok = errors.length === 0;
  }
  return result;
}

function main() {
  const r = run({ check: process.argv.includes("--check") });
  if (process.argv.includes("--check") && !r.ok) process.exitCode = 1;
}

if (require.main === module) main();
module.exports = { run };

