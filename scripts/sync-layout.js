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
const crypto = require("crypto");
const requirements = require("./requirements");

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
/* Список источников фотографий                                         */
/* ==================================================================== */

/* Собирается из data/photos.json — тот же файл, из которого скрипт
   photos.py пишет assets/photos/CREDITS.md. Указание автора и лицензии
   для CC-BY и CC-BY-SA — требование лицензии, а не вежливость, поэтому
   список должен быть открыт посетителям, а не только владельцу. */

let photoData = null;

function loadPhotos() {
  if (photoData) return photoData;
  const file = path.join(ROOT, "data", "photos.json");
  if (!fs.existsSync(file)) {
    warn("нет data/photos.json — список источников фотографий пуст");
    return null;
  }
  photoData = JSON.parse(fs.readFileSync(file, "utf8"));
  return photoData;
}

function photosBlock(lang, prefix, indent) {
  const data = loadPhotos();
  if (!data) return `${indent}<!-- список источников не собран -->`;

  const pick = (obj) => (obj && (obj[lang] || obj[DEFAULT_LANG])) || "";
  const notice = data.notice || {};
  const i = indent;
  const out = [];

  out.push(`${i}<ul class="credits" data-reveal-group>`);
  for (const p of data.photos) {
    const city = pick(p.city);
    /* Для CC-BY-SA обязательна ещё и пометка про «те же права» */
    let note = pick(notice.modified);
    if (p.shareAlike) note += " " + pick(notice.shareAlike);

    out.push(`${i}  <li class="credit">`);
    /* Превью в списке источников показывается квадратиком 96×64 и нужно
       только чтобы опознать снимок. Поэтому здесь отдельный мелкий файл
       на 5–6 КБ, а не карточный на 22: двенадцать таких делали служебную
       страницу самой тяжёлой на сайте. Если мелкого файла нет, берём
       обычный — страница соберётся, просто будет тяжелее. */
    const smallFile = path.join(ROOT, "assets", "photos", p.photo + "@sm.webp");
    const small = fs.existsSync(smallFile);
    out.push(`${i}    <img class="credit__thumb"` +
             ` src="${prefix}assets/photos/${p.photo}${small ? "@sm" : ""}.webp"` +
             ` alt="" width="${small ? 192 : 480}" height="${small ? 128 : 320}"` +
             ` loading="lazy" decoding="async">`);
    out.push(`${i}    <div class="credit__body">`);
    out.push(`${i}      <p class="credit__city">${city}</p>`);
    out.push(`${i}      <p class="credit__author">${escapeAttr(p.author)}</p>`);
    out.push(`${i}      <p class="credit__licence">`);
    if (p.licenceUrl) {
      out.push(`${i}        <a href="${p.licenceUrl}" rel="license nofollow noopener" target="_blank">${p.licence}</a>`);
    } else {
      out.push(`${i}        ${p.licence}`);
    }
    out.push(`${i}        <a class="credit__source" href="${p.page}" rel="nofollow noopener" target="_blank">Wikimedia Commons</a>`);
    out.push(`${i}      </p>`);
    out.push(`${i}      <p class="credit__note">${note}</p>`);
    out.push(`${i}    </div>`);
    out.push(`${i}  </li>`);
  }
  out.push(`${i}</ul>`);
  return out.join("\n");
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

  /* Лента прокручивается пальцем, поэтому у неё должен быть способ
     прокрутки и с клавиатуры: tabindex делает её точкой фокуса,
     и стрелки начинают листать карточки. */
  out.push(`${i}  <ul class="countries__grid" data-countries-grid` +
           ` tabindex="0" role="group" aria-label="${escapeAttr(pick(L.list))}">`);
  for (const c of data.countries) {
    const country = pick(c.country);
    const city = pick(c.city);
    const alt = pick(L.photoOf).replace("{{city}}", city);
    const photoFile = c.photo ? path.join(ROOT, "assets", "photos", c.photo + ".webp") : null;
    const hasPhoto = photoFile && fs.existsSync(photoFile);

    out.push(`${i}    <li class="country" data-region="${c.region}">`);
    out.push(`${i}      <div class="country__photo">`);
    if (hasPhoto) {
      const big = path.join(ROOT, "assets", "photos", c.photo + "@2x.webp");
      /* Второй файл — только для широких экранов. На телефоне карточка вдвое
         уже, и 480 точек ей хватает даже при удвоенной плотности; тащить
         туда файл вчетверо тяжелее на медленном интернете нельзя.
         Поэтому крупный вариант отдаётся через source с условием по ширине,
         а телефон всегда получает лёгкий img. */
      out.push(`${i}        <picture>`);
      if (fs.existsSync(big)) {
        out.push(`${i}          <source media="(min-width: 64em)"` +
                 ` srcset="${prefix}assets/photos/${c.photo}.webp 480w,` +
                 ` ${prefix}assets/photos/${c.photo}@2x.webp 960w"` +
                 ` sizes="300px">`);
      }
      /* width и height обязательны: браузер резервирует место под картинку
         заранее, и страница не дёргается, когда фотография догрузится. */
      out.push(`${i}          <img src="${prefix}assets/photos/${c.photo}.webp"` +
               ` alt="${escapeAttr(alt)}" width="480" height="320"` +
               ` loading="lazy" decoding="async">`);
      out.push(`${i}        </picture>`);
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


/* ==================================================================== */
/* Экран загрузки                                                       */
/* ==================================================================== */

/* Знак нарисован прямо в разметке: отдельный файл пришлось бы ждать,
   а заставка должна появиться раньше всего остального. Контуры настоящие,
   те же, что в assets/logo-mark.svg.

   Показывается заставка ТОЛЬКО когда строка в <head> поставила <html>
   класс is-splash. Нет скриптов — нет класса — заставки нет вовсе,
   и содержимое при этом ничем не закрыто.                              */
function splashBlock(indent) {
  /* Знак целиком — из assets/logo-header.svg, все очертания кривыми.
     Надпись тоже кривыми, а не текстом: заставка живёт первые 700 мс,
     когда фирменный шрифт ещё не загружен, и набранная шрифтом надпись
     показалась бы системным. Кривые не зависят ни от чего.

     Стили заставки лежат не в css/base.css, а прямо в <head> — см.
     splashCss(). Файл стилей браузер может держать в кэше со старого
     захода, и тогда разметка осталась бы без оформления: чёрный квадрат
     посреди белого экрана. Внутри одного документа такое невозможно. */
  const i = indent;
  return [
    `${i}<div class="splash" aria-hidden="true">`,
    `${i}  <svg class="splash__logo" viewBox="0 0 690 140"`,
    `${i}       xmlns="http://www.w3.org/2000/svg" focusable="false">`,
    `${i}    <defs>`,
    `${i}      <!-- Точки на дуге даёт неподвижная маска, а прорисовывается`,
    `${i}           сама дуга: у неё stroke-dasharray остаётся свободен. -->`,
    `${i}      <mask id="splash-dots" maskUnits="userSpaceOnUse" x="0" y="0" width="690" height="140">`,
    `${i}        <path d="M36.08 102.96 Q 70.00 116.53 95.22 100.08" fill="none" stroke="#FFFFFF"`,
    `${i}              stroke-width="2.23" stroke-dasharray="1 5.82" stroke-linecap="round"/>`,
    `${i}      </mask>`,
    `${i}    </defs>`,
    `${i}    <rect class="splash__square" x="6" y="6" width="128" height="128" rx="14.59"/>`,
    `${i}    <path class="splash__vw" transform="translate(28.94,81.65)" d="M0.4 -37.27L14.92 0L20.57 0L35 -37.27L27.74 -37.27L17.7 -8.93L7.67 -37.27L0.4 -37.27ZM37.1 -37.27L48.05 0L53.49 0L59.65 -24.66L65.64 0L71.14 0L82.03 -37.27L74.97 -37.27L68.37 -11.24L62.11 -37.27L57.07 -37.27L50.72 -11.24L44.16 -37.27L37.1 -37.27Z"/>`,
    `${i}    <path class="splash__arc" d="M36.08 102.96 Q 70.00 116.53 95.22 100.08" fill="none"`,
    `${i}          stroke-width="2.23" stroke-linecap="round" mask="url(#splash-dots)"/>`,
    `${i}    <g class="splash__plane"><g transform="scale(0.1453)">`,
    `${i}      <path d="M0 -42 C4 -42 6 -37 6 -30 L6 -13 L40 9 L40 17 L6 6 L6 24 L15 32 L15 38 L0 33 L-15 38 L-15 32 L-6 24 L-6 6 L-40 17 L-40 9 L-6 -13 L-6 -30 C-6 -37 -4 -42 0 -42 Z"/>`,
    `${i}    </g></g>`,
    `${i}    <g transform="translate(156.00,93.76)"><path class="splash__word splash__word--name" d="M47.58 -46.33L31.15 0L17.03 0L0.6 -46.33L12.6 -46.33L24.09 -11.35L35.64 -46.33L47.58 -46.33ZM58.25 -40.65Q55.28 -40.65 53.39 -42.41Q51.51 -44.16 51.51 -46.73Q51.51 -49.37 53.39 -51.11Q55.28 -52.86 58.25 -52.86Q61.15 -52.86 63.03 -51.11Q64.92 -49.37 64.92 -46.73Q64.92 -44.16 63.03 -42.41Q61.15 -40.65 58.25 -40.65ZM63.86 -36.83L63.86 0L52.57 0L52.57 -36.83L63.86 -36.83ZM87.33 0.53Q82.5 0.53 78.74 -1.12Q74.98 -2.77 72.8 -5.64Q70.62 -8.52 70.36 -12.08L81.51 -12.08Q81.72 -10.17 83.3 -8.97Q84.88 -7.79 87.19 -7.79Q89.31 -7.79 90.46 -8.61Q91.62 -9.44 91.62 -10.76Q91.62 -12.34 89.97 -13.1Q88.32 -13.86 84.62 -14.79Q80.66 -15.71 78.02 -16.73Q75.38 -17.76 73.46 -19.96Q71.55 -22.17 71.55 -25.94Q71.55 -29.1 73.29 -31.71Q75.05 -34.32 78.44 -35.84Q81.84 -37.35 86.53 -37.35Q93.46 -37.35 97.46 -33.92Q101.45 -30.49 102.04 -24.81L91.62 -24.81Q91.35 -26.73 89.93 -27.85Q88.51 -28.98 86.2 -28.98Q84.22 -28.98 83.16 -28.21Q82.11 -27.45 82.11 -26.13Q82.11 -24.55 83.79 -23.76Q85.47 -22.97 89.04 -22.17Q93.13 -21.12 95.7 -20.1Q98.28 -19.08 100.23 -16.8Q102.18 -14.52 102.24 -10.69Q102.24 -7.46 100.43 -4.91Q98.61 -2.37 95.21 -0.92Q91.81 0.53 87.33 0.53ZM107.22 -18.48Q107.22 -24.15 109.37 -28.44Q111.51 -32.73 115.21 -35.04Q118.91 -37.35 123.47 -37.35Q127.35 -37.35 130.29 -35.76Q133.23 -34.19 134.81 -31.62L134.81 -36.83L146.1 -36.83L146.1 0L134.81 0L134.81 -5.22Q133.16 -2.64 130.22 -1.05Q127.29 0.53 123.39 0.53Q118.91 0.53 115.21 -1.82Q111.51 -4.16 109.37 -8.48Q107.22 -12.81 107.22 -18.48ZM134.81 -18.42Q134.81 -22.64 132.47 -25.08Q130.13 -27.52 126.77 -27.52Q123.39 -27.52 121.05 -25.11Q118.71 -22.71 118.71 -18.48Q118.71 -14.25 121.05 -11.78Q123.39 -9.3 126.77 -9.3Q130.13 -9.3 132.47 -11.75Q134.81 -14.19 134.81 -18.42ZM218.34 -46.33L206.26 0L192.6 0L185.2 -30.49L177.55 0L163.89 0L152.14 -46.33L164.22 -46.33L170.89 -12.6L179.14 -46.33L191.55 -46.33L199.47 -12.6L206.2 -46.33L218.34 -46.33ZM222.07 -18.48Q222.07 -24.15 224.21 -28.44Q226.36 -32.73 230.05 -35.04Q233.75 -37.35 238.31 -37.35Q242.2 -37.35 245.14 -35.76Q248.08 -34.19 249.66 -31.62L249.66 -36.83L260.95 -36.83L260.95 0L249.66 0L249.66 -5.22Q248.01 -2.64 245.07 -1.05Q242.14 0.53 238.24 0.53Q233.75 0.53 230.05 -1.82Q226.36 -4.16 224.21 -8.48Q222.07 -12.81 222.07 -18.48ZM249.66 -18.42Q249.66 -22.64 247.31 -25.08Q244.97 -27.52 241.61 -27.52Q238.24 -27.52 235.9 -25.11Q233.56 -22.71 233.56 -18.48Q233.56 -14.25 235.9 -11.78Q238.24 -9.3 241.61 -9.3Q244.97 -9.3 247.31 -11.75Q249.66 -14.19 249.66 -18.42ZM307.05 -36.83L283.95 17.49L271.8 17.49L280.25 -1.26L265.28 -36.83L277.88 -36.83L286.4 -13.8L294.84 -36.83L307.05 -36.83Z"/"/></g>`,
    `${i}    <g transform="translate(479.05,93.76)"><path class="splash__word splash__word--kind" d="M41.58 -32.67Q39.6 -37.23 35.54 -39.83Q31.48 -42.44 26.01 -42.44Q20.85 -42.44 16.76 -40.05Q12.67 -37.68 10.29 -33.29Q7.92 -28.91 7.92 -23.1Q7.92 -17.29 10.29 -12.87Q12.67 -8.45 16.76 -6.06Q20.85 -3.69 26.01 -3.69Q30.82 -3.69 34.68 -5.78Q38.55 -7.86 40.89 -11.71Q43.23 -15.57 43.56 -20.73L24.15 -20.73L24.15 -24.48L48.45 -24.48L48.45 -21.12Q48.12 -15.05 45.15 -10.13Q42.18 -5.22 37.19 -2.37Q32.21 0.46 26.01 0.46Q19.6 0.46 14.39 -2.54Q9.18 -5.55 6.17 -10.92Q3.17 -16.3 3.17 -23.1Q3.17 -29.9 6.17 -35.27Q9.18 -40.65 14.39 -43.65Q19.6 -46.66 26.01 -46.66Q33.39 -46.66 38.94 -42.96Q44.49 -39.27 46.99 -32.67L41.58 -32.67ZM61.81 -29.64Q63.33 -33 66.46 -34.85Q69.6 -36.69 74.16 -36.69L74.16 -31.88L72.9 -31.88Q67.89 -31.88 64.84 -29.16Q61.81 -26.46 61.81 -20.13L61.81 0L57.19 0L57.19 -36.03L61.81 -36.03L61.81 -29.64ZM97.16 0.53Q92.08 0.53 88.01 -1.74Q83.96 -4.02 81.61 -8.21Q79.27 -12.41 79.27 -18.02Q79.27 -23.63 81.64 -27.81Q84.02 -32.01 88.12 -34.29Q92.21 -36.57 97.29 -36.57Q102.37 -36.57 106.49 -34.29Q110.62 -32.01 112.96 -27.81Q115.31 -23.63 115.31 -18.02Q115.31 -12.48 112.93 -8.25Q110.56 -4.02 106.39 -1.74Q102.24 0.53 97.16 0.53ZM97.16 -3.5Q100.72 -3.5 103.75 -5.12Q106.79 -6.73 108.67 -9.99Q110.56 -13.26 110.56 -18.02Q110.56 -22.77 108.7 -26.04Q106.86 -29.31 103.82 -30.92Q100.79 -32.54 97.22 -32.54Q93.66 -32.54 90.62 -30.92Q87.59 -29.31 85.78 -26.04Q83.96 -22.77 83.96 -18.02Q83.96 -13.26 85.78 -9.99Q87.59 -6.73 90.59 -5.12Q93.59 -3.5 97.16 -3.5ZM155.27 -36.03L155.27 0L150.65 0L150.65 -6.33Q149.07 -2.97 145.77 -1.19Q142.47 0.6 138.38 0.6Q131.91 0.6 127.82 -3.39Q123.73 -7.39 123.73 -14.98L123.73 -36.03L128.28 -36.03L128.28 -15.51Q128.28 -9.63 131.21 -6.53Q134.15 -3.43 139.24 -3.43Q144.45 -3.43 147.55 -6.73Q150.65 -10.03 150.65 -16.44L150.65 -36.03L155.27 -36.03ZM170.69 -28.11Q172.4 -31.74 176.13 -34.16Q179.86 -36.57 185.01 -36.57Q189.89 -36.57 193.82 -34.29Q197.75 -32.01 199.96 -27.81Q202.17 -23.63 202.17 -18.09Q202.17 -12.54 199.96 -8.31Q197.75 -4.09 193.82 -1.78Q189.89 0.53 185.01 0.53Q179.93 0.53 176.17 -1.88Q172.4 -4.29 170.69 -7.92L170.69 17.03L166.13 17.03L166.13 -36.03L170.69 -36.03L170.69 -28.11ZM197.48 -18.09Q197.48 -22.57 195.73 -25.83Q193.99 -29.1 190.95 -30.81Q187.91 -32.54 184.09 -32.54Q180.39 -32.54 177.31 -30.75Q174.25 -28.98 172.47 -25.68Q170.69 -22.38 170.69 -18.02Q170.69 -13.66 172.47 -10.36Q174.25 -7.06 177.31 -5.28Q180.39 -3.5 184.09 -3.5Q187.91 -3.5 190.95 -5.24Q193.99 -6.99 195.73 -10.32Q197.48 -13.66 197.48 -18.09Z"/"/></g>`,
    `${i}  </svg>`,
    `${i}</div>`
  ].join("\n");
}


function splashCss(indent) {
    /* Стили заставки. Живут прямо в <head>, а не в файле стилей: файл браузер
       может взять из кэша со старого захода, и тогда разметка осталась бы без
       оформления — чёрный квадрат посреди белого экрана. Внутри одного
       документа разметка и её стили приходят вместе, разойтись не могут.
    
       Цвета продублированы значениями: var(--dark, #2A2E35). Если tokens.css
       тоже устарел, заставка всё равно выглядит правильно.
    
       Движение укладывается в 700 мс. Последний кадр полёта в точности
       повторяет assets/logo-header.svg.

       pointer-events:none стоит всегда, а не в конце анимации: WebKit не
       применяет visibility:hidden из последнего кадра, и погасшая заставка
       продолжала бы ловить нажатия. Она чисто декоративная, ловить ей
       нечего. */
  const css = 
    ".splash{display:none}@media (prefers-reduced-motion:reduce){.splash{display:none!important}}@media (prefers-re" +
    "duced-motion:no-preference){.is-splash .splash{display:grid;place-items:center;position:fixed;inset:0;pointer-events:none;z-index:" +
    "var(--z-splash,1000);background-color:var(--dark,#2A2E35);animation:splash-out 180ms cubic-bezier(.4,0,.2,1) 5" +
    "20ms both}.is-splash .splash__logo{width:min(78vw,420px);height:auto}.splash__square{fill:var(--ink,#31363D);t" +
    "ransform-box:fill-box;transform-origin:center;animation:splash-square 220ms cubic-bezier(.16,1,.3,1) both}@key" +
    "frames splash-square{from{opacity:0;transform:scale(.86)}to{opacity:1;transform:none}}.splash__vw{fill:#FFF;an" +
    "imation:splash-fade 180ms cubic-bezier(.16,1,.3,1) 140ms both}.splash__arc{stroke:var(--copper-on-dark,#D98A5F" +
    ");stroke-dasharray:62;stroke-dashoffset:62;animation:splash-draw 260ms cubic-bezier(.16,1,.3,1) 250ms both}@ke" +
    "yframes splash-draw{to{stroke-dashoffset:0}}.splash__plane{fill:var(--copper-on-dark,#D98A5F);transform-box:vi" +
    "ew-box;transform-origin:0 0;animation:splash-fly 280ms cubic-bezier(.16,1,.3,1) 250ms both}@keyframes splash-f" +
    "ly{from{opacity:0;transform:translate(36.08px,102.96px) rotate(82.9deg)}20%{opacity:1;transform:translate(49.3" +
    "0px,107.19px) rotate(74.3deg)}40%{transform:translate(61.82px,109.01px) rotate(64.0deg)}60%{transform:translat" +
    "e(73.65px,108.44px) rotate(52.3deg)}80%{transform:translate(84.78px,105.46px) rotate(39.9deg)}to{opacity:1;tra" +
    "nsform:translate(103.92px,94.26px) rotate(28deg)}}.splash__word{transform-box:view-box;transform-origin:0 0;an" +
    "imation:splash-word 240ms cubic-bezier(.16,1,.3,1) 330ms both}.splash__word--name{fill:var(--on-dark,#F2F1EE)}" +
    ".splash__word--kind{fill:var(--on-dark-muted,#A8ADB5)}@keyframes splash-word{from{opacity:0;transform:translat" +
    "eX(-10px)}to{opacity:1;transform:none}}@keyframes splash-fade{from{opacity:0}to{opacity:1}}@keyframes splash-o" +
    "ut{from{opacity:1}to{opacity:0;visibility:hidden}}}";
  return `${indent}<style>${css}</style>`;
}


function bootBlock(indent) {
  /* Всё одной строкой: это первое, что исполняет браузер, и оно должно
     стоить как можно дешевле.

     Что делает: ставит классу <html> метку js (по ней стили прячут блоки,
     которые потом плавно появляются) и решает, показывать ли заставку.
     Заставка положена один раз за сессию и только если человек не просил
     уменьшить движение. Движение длится 700 мс и доигрывается целиком:
     если страница готова раньше, заставка ждёт конца анимации и уходит,
     если позже — её всё равно снимает потолок в 900 мс. Предохранитель
     на 1200 мс стоит на случай, если первый таймер почему-то не сработал.
     Потолок никогда не отменяется: дольше 900 мс заставки не бывает. */
  const js =
    '(function(d,w){d.classList.add("js");try{' +
    'if(sessionStorage.getItem("vw-splash"))return;' +
    'if(w.matchMedia&&w.matchMedia("(prefers-reduced-motion: reduce)").matches)return;' +
    'sessionStorage.setItem("vw-splash","1");d.classList.add("is-splash");' +
    'var t0=Date.now();var off=function(){d.classList.remove("is-splash")};' +
    'setTimeout(off,900);setTimeout(off,1200);' +
    'var done=function(){var left=700-(Date.now()-t0);setTimeout(off,left>0?left:0)};' +
    'if(d.ownerDocument.readyState==="complete")done();' +
    'else w.addEventListener("load",done,{once:true});' +
    '}catch(e){d.classList.remove("is-splash")}})(document.documentElement,window);';
  /* Стили заставки идут вместе со скриптом, который её включает:
     порознь они бессмысленны, а врозь могут разъехаться по кэшу. */
  return `${splashCss(indent)}\n${indent}<script>${js}</script>`;
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

/* ==================================================================== */
/* Маршруты первого экрана                                              */
/* ==================================================================== */

/* Из Ашхабада расходятся веером несколько маршрутов, у каждого свой
   самолёт. Города берутся из data/countries.json по ключу photo, поэтому
   подписи переводятся сами — здесь их писать не надо.

   Кривые и длины посчитаны заранее и проверены: линии нигде не сходятся
   ближе чем на 27 единиц рамки и не выходят за её край. Меняете кривую —
   пересчитайте длину, иначе прорисовка оборвётся или не дойдёт до конца.

   Вариантов два. Широкий, 420×720, с четырьмя маршрутами — для планшета
   и монитора. Узкий, 420×260, с двумя самыми разнесёнными — для телефона:
   там маршрут лежит под текстом полосой, и четыре линии в неё не влезут.
   Показывает нужный медиазапрос в css/home.css, второй при этом
   display:none, то есть его анимации не идут вовсе. */

const ROUTE_CITIES = [
  /* фоновые огни: неяркие точки, у каждой свой сдвиг мигания */
  { x: 40, y: 210 }, { x: 150, y: 130 }, { x: 250, y: 60 }, { x: 370, y: 210 },
  { x: 396, y: 356 }, { x: 52, y: 420 }, { x: 196, y: 470 }, { x: 320, y: 420 },
  { x: 376, y: 540 }, { x: 150, y: 620 }
];

const ROUTE_SETS = {
  wide: {
    box: [420, 720],
    from: { x: 196, y: 648, labelY: 692 },
    cities: ROUTE_CITIES,
    /* draw — когда начинает рисоваться линия; delay — когда вылетает
       самолёт; dur — сколько длится один полёт. Вылеты разведены
       примерно на секунду, длительности разные: иначе четыре самолёта
       идут строем, как на параде. */
    routes: [
      { key: "istanbul", d: "M196 648 C 110 596, 46 470, 74 360", len: 333, x: 74,  y: 360, labelY: 322, draw: 200,  delay: 1400, dur: "9s" },
      { key: "berlin",   d: "M196 648 C 150 500, 60 300, 86 120",  len: 544, x: 86,  y: 120, labelY: 82,  draw: 500,  delay: 2400, dur: "11s" },
      { key: "beijing",  d: "M196 648 C 250 520, 330 320, 344 152", len: 520, x: 344, y: 152, labelY: 114, draw: 800,  delay: 3500, dur: "12.5s" },
      { key: "dubai",    d: "M196 648 C 286 604, 352 540, 350 430", len: 284, x: 350, y: 430, labelY: 392, draw: 1100, delay: 4600, dur: "10s" }
    ]
  },
  narrow: {
    box: [420, 260],
    from: { x: 210, y: 214, labelY: 246 },
    cities: [
      { x: 46, y: 150 }, { x: 120, y: 60 }, { x: 300, y: 42 }, { x: 392, y: 150 },
      { x: 96, y: 226 }, { x: 330, y: 224 }
    ],
    routes: [
      { key: "istanbul", d: "M210 214 C 160 182, 96 150, 60 84",  len: 201, x: 60,  y: 84, labelY: 52, draw: 200, delay: 1400, dur: "9s" },
      { key: "beijing",  d: "M210 214 C 262 184, 330 156, 360 96", len: 194, x: 360, y: 96, labelY: 64, draw: 600, delay: 2400, dur: "11.5s" }
    ]
  }
};

const PLANE_PATH = "M0 -42 C4 -42 6 -37 6 -30 L6 -13 L40 9 L40 17 L6 6 L6 24 L15 32 L15 38 L0 33 L-15 38 L-15 32 L-6 24 L-6 6 L-40 17 L-40 9 L-6 -13 L-6 -30 C-6 -37 -4 -42 0 -42 Z";

function routeSvg(kind, lang, countries, labels, indent) {
  const set = ROUTE_SETS[kind];
  const [W, H] = set.box;
  const i = indent;
  const cityName = key => {
    const c = countries.find(x => x.photo === key);
    if (!c) throw new Error(`в data/countries.json нет города с photo="${key}"`);
    return c.city[lang];
  };
  const L = k => labels[k][lang];
  const out = [];

  out.push(`${i}<svg class="route route--${kind}" viewBox="0 0 ${W} ${H}"`);
  out.push(`${i}     xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${L("routeMap")}">`);
  out.push(`${i}  <defs>`);
  out.push(`${i}    <!-- Пунктир задаёт неподвижная маска: у самих линий`);
  out.push(`${i}         stroke-dasharray занят прорисовкой. -->`);
  out.push(`${i}    <mask id="route-dash-${kind}" maskUnits="userSpaceOnUse" x="0" y="0" width="${W}" height="${H}">`);
  for (const r of set.routes) {
    out.push(`${i}      <path d="${r.d}" fill="none" stroke="#FFFFFF" stroke-width="6" stroke-dasharray="5 13"/>`);
  }
  out.push(`${i}    </mask>`);
  out.push(`${i}  </defs>`);

  out.push(`${i}  <!-- Огни городов: как окна ночного города с высоты -->`);
  out.push(`${i}  <g class="route__cities">`);
  set.cities.forEach((c, n) => {
    out.push(`${i}    <circle class="route__city" style="--i: ${n}" cx="${c.x}" cy="${c.y}" r="2.6"/>`);
  });
  out.push(`${i}  </g>`);

  out.push(`${i}  <g class="route__lines" mask="url(#route-dash-${kind})">`);
  set.routes.forEach(r => {
    out.push(`${i}    <path class="route__line" style="--len: ${r.len}; --draw: ${r.draw}ms" d="${r.d}" fill="none" stroke-width="2"/>`);
  });
  out.push(`${i}  </g>`);

  out.push(`${i}  <!-- Откуда: единственная точка отправления -->`);
  out.push(`${i}  <circle class="route__ring" cx="${set.from.x}" cy="${set.from.y}" r="18" fill="none" stroke-width="1.5"/>`);
  out.push(`${i}  <circle class="route__dot" cx="${set.from.x}" cy="${set.from.y}" r="6"/>`);
  out.push(`${i}  <text class="route__label" x="${set.from.x}" y="${set.from.labelY}" text-anchor="middle">${L("routeFrom")}</text>`);

  out.push(`${i}  <!-- Куда: у каждой точки своя подпись, она не сменяется -->`);
  set.routes.forEach((r, n) => {
    out.push(`${i}  <g class="route__stop" style="--i: ${n}">`);
    out.push(`${i}    <circle class="route__pulse" cx="${r.x}" cy="${r.y}" r="20" fill="none" stroke-width="1.5"/>`);
    out.push(`${i}    <circle class="route__ring" cx="${r.x}" cy="${r.y}" r="20" fill="none" stroke-width="1.5"/>`);
    out.push(`${i}    <circle class="route__dot route__dot--end" cx="${r.x}" cy="${r.y}" r="6.5"/>`);
    out.push(`${i}    <text class="route__label route__label--end" x="${r.x}" y="${r.labelY}" text-anchor="middle">${cityName(r.key)}</text>`);
    out.push(`${i}  </g>`);
  });

  out.push(`${i}  <!-- Самолёты. Знак нарисован носом вверх, поэтому внутри`);
  out.push(`${i}       повёрнут на 90°: вдоль пути летит нос. -->`);
  set.routes.forEach(r => {
    out.push(`${i}  <g class="route__plane" style="--path: path('${r.d}'); --dur: ${r.dur}; --delay: ${r.delay}ms">`);
    out.push(`${i}    <g transform="rotate(90) scale(0.26)"><path d="${PLANE_PATH}"/></g>`);
    out.push(`${i}  </g>`);
  });

  out.push(`${i}</svg>`);
  return out.join("\n");
}

function routeBlock(indent, lang) {
  const data = loadCountries();
  return ["wide", "narrow"]
    .map(kind => routeSvg(kind, lang, data.countries, data.labels, indent))
    .join("\n");
}


/* ==================================================================== */
/* Версия в адресах стилей и скриптов                                   */
/* ==================================================================== */

/* Хостинг отдаёт css и js с кэшем на час. Без версии в адресе вернувшийся
   посетитель получает новую разметку и старые стили — сайт рассыпается,
   и никакой выкладкой это не лечится, надо ждать, пока кэш протухнет.
   Поэтому в адрес дописывается отпечаток содержимого: поменялся файл —
   поменялся адрес, и старый кэш к нему уже не подходит.

   Считается по самому файлу, так что запускать ничего отдельно не надо:
   sync-layout и так проходит по всем страницам. */
const assetHashes = new Map();

function assetHash(fileRel) {
  if (assetHashes.has(fileRel)) return assetHashes.get(fileRel);
  let h = "";
  try {
    h = crypto.createHash("sha1").update(fs.readFileSync(path.join(ROOT, fileRel))).digest("hex").slice(0, 8);
  } catch (e) {
    h = "";   /* файла нет — адрес не трогаем, об этом скажет preflight */
  }
  assetHashes.set(fileRel, h);
  return h;
}

function stampAssets(html, relPosix) {
  const dir = path.posix.dirname(relPosix) === "." ? "" : path.posix.dirname(relPosix);
  return html.replace(
    /(<(?:link|script)\b[^>]*?\b(?:href|src)=")([^"]+?\.(?:css|js))(?:\?v=[0-9a-f]+)?(")/g,
    (all, head, url, tail) => {
      if (/^(?:https?:)?\/\//.test(url)) return all;       /* чужие адреса не наши */
      const target = path.posix.normalize(path.posix.join(dir, url));
      const h = assetHash(target);
      return h ? `${head}${url}?v=${h}${tail}` : all;
    }
  );
}


/* Собирают ли сейчас вместе с черновиками. Ставит scripts/build.js
   при запуске с --drafts; обычная сборка эту переменную не задаёт,
   и черновиков не видит ни один блок. */
const WITH_DRAFTS = process.env.VW_DRAFTS === "1";


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

    /* Список источников фотографий — из data/photos.json */
    if (name === "photos") {
      blocks++;
      return `${indent}<!-- photos:start -->\n${photosBlock(lang, prefix, indent)}\n${indent}<!-- photos:end -->`;
    }

    /* Маршруты первого экрана — тоже из data/countries.json,
       поэтому подписи городов переводятся сами */
    if (name === "route") {
      blocks++;
      return `${indent}<!-- route:start -->\n${routeBlock(indent, lang)}\n${indent}<!-- route:end -->`;
    }

    /* Выбор страны на странице визы — из data/requirements.json.
       Черновики сюда попадают только в предпросмотре: сборщик
       ставит VW_DRAFTS=1, обычная сборка этого не делает. */
    if (name === "reqcountries") {
      blocks++;
      const visa = (rawAttrs.match(/visa="([^"]+)"/) || [])[1] || "";
      const body = requirements.pickerBlock(lang, visa, indent, relPosix, prefix, WITH_DRAFTS);
      return `${indent}<!-- reqcountries:start visa="${visa}" -->\n${body}\n${indent}<!-- reqcountries:end -->`;
    }

    /* Сетка стран и фильтр — из data/countries.json */
    if (name === "countries") {
      blocks++;
      return `${indent}<!-- countries:start -->\n${countriesBlock(lang, prefix, indent, relPosix)}\n${indent}<!-- countries:end -->`;
    }

    /* Экран загрузки. Разметка есть всегда, показывают её стили
       и только по метке, которую ставит строка из <head>. */
    if (name === "splash") {
      blocks++;
      return `${indent}<!-- splash:start -->\n${splashBlock(indent)}\n${indent}<!-- splash:end -->`;
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
  updated = stampAssets(updated, relPosix);

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
  "Aşgabat", "Türkmenistan", "türkmen", "Türkmen", "Türkiye",
  /* Названия проектов и наборов, которые не переводятся ни на один язык */
  "Wikimedia Commons", "Wikimedia", "Commons", "flag-icons"
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
  /* То же с именами фотографов, названиями лицензий и адресами
     на Викисклад: они одинаковы на всех трёх языках. */
  for (const name of ["countries.json", "photos.json"]) {
    const file = path.join(ROOT, "data", name);
    if (!fs.existsSync(file)) continue;
    try {
      walk(JSON.parse(fs.readFileSync(file, "utf8")));
    } catch (e) {
      warn(`data/${name} не читается: ${e.message}`);
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
  /* Названия, которые одинаковы на всех языках: компания, город,
     Wikimedia Commons и подобное. Их совпадение — не признак того,
     что страницу забыли перевести. */
  for (const a of ALLOWED) s = s.split(a).join(" ");
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

