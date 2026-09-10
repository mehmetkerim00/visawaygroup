#!/usr/bin/env node
/*
 * preflight.js — одна команда, которая проверяет, готов ли сайт к публикации.
 *
 *     node scripts/preflight.js
 *
 * Ничего не меняет. Просто смотрит на сайт и говорит, что готово,
 * а что мешает публикации — с указанием файла и номера строки.
 *
 * Запускайте её каждый раз перед тем, как выкладывать сайт в интернет,
 * и после любых правок.
 */

"use strict";

const fs = require("fs");
const path = require("path");
const L = require("./lib-site.js");

const ROOT = L.ROOT;

/* --------------------------------------------------------------------- */
/* Сбор результатов                                                       */
/* --------------------------------------------------------------------- */

const blockers = [];   /* мешает публикации */
const notices = [];    /* стоит знать, но не мешает */
const done = [];       /* что уже в порядке */

function block(group, message, where) { blockers.push({ group, message, where }); }
function notice(message, where) { notices.push({ message, where }); }
function ok(message) { done.push(message); }

/* --------------------------------------------------------------------- */
/* Вспомогательное                                                        */
/* --------------------------------------------------------------------- */

const PLACEHOLDER = L.TODO;   /* слово ЗАПОЛНИТЬ */

function lineOf(text, index) {
  return text.slice(0, index).split("\n").length;
}

function readIfExists(rel) {
  const full = path.join(ROOT, rel);
  return fs.existsSync(full) ? fs.readFileSync(full, "utf8") : null;
}

function pages() {
  return L.pageList();
}

/* Убираем комментарии — в них слово ЗАПОЛНИТЬ это подсказка, а не текст сайта */
function withoutComments(html) {
  return html.replace(/<!--[\s\S]*?-->/g, (m) => " ".repeat(m.length));
}

/* --------------------------------------------------------------------- */
/* 1. Незаполненные данные                                                */
/* --------------------------------------------------------------------- */

function checkPlaceholders(syncResult) {
  if (syncResult.todoFields.length) {
    block("Контакты",
          `не заполнено полей: ${syncResult.todoFields.length}. Список ниже, ` +
          `подробности — в HANDOVER.md`, "data/site.json");
    for (const field of syncResult.todoFields) {
      notice("  data/site.json → " + field, "");
    }
  } else {
    ok("Все контакты в data/site.json заполнены");
  }

  /* То же слово, но прямо в тексте страниц.
     Заглушки, которые подставляются из site.json, здесь не считаем второй раз:
     они исчезнут сами, как только заполнить site.json. Карточки команды тоже
     считаются отдельно — в разделе «Команда». */
  const fromSite = syncResult.todoFields.map(f => f.split(": ").slice(1).join(": ").trim());
  const seen = new Set();
  let inPages = 0;

  for (const rel of pages()) {
    const html = fs.readFileSync(path.join(ROOT, rel), "utf8");
    const visible = withoutComments(html);
    let m;
    const re = new RegExp(PLACEHOLDER + "[^<\\n]{0,40}", "g");
    while ((m = re.exec(visible)) !== null) {
      const text = m[0].trim();
      if (fromSite.some(v => v && text.includes(v))) continue;
      if (/team__name|team__role/.test(visible.slice(Math.max(0, m.index - 120), m.index))) continue;
      const key = text;
      if (seen.has(key)) continue;
      seen.add(key);
      inPages++;
      block("Тексты страниц", `на странице видно «${text}»`,
            `${rel}:${lineOf(visible, m.index)}`);
    }
  }
  if (!inPages) ok("В текстах страниц не осталось лишних заглушек");
}

/* --------------------------------------------------------------------- */
/* 2. Домен и абсолютные адреса                                           */
/* --------------------------------------------------------------------- */

function checkDomain(site) {
  const url = L.siteUrl(site);
  if (!url) {
    block("Домен", "домен не вписан — карта сайта, og-теги и разметка " +
          "останутся с относительными адресами, поисковики и мессенджеры их не поймут",
          "data/site.json");
    return;
  }
  ok(`Домен вписан: ${url}`);

  /* Проверяем, что адреса действительно собрались абсолютными */
  const home = readIfExists("index.html") || "";
  for (const [name, re] of [
    ["canonical", /<link rel="canonical" href="([^"]*)"/],
    ["og:url", /<meta property="og:url" content="([^"]*)"/],
    ["og:image", /<meta property="og:image" content="([^"]*)"/]
  ]) {
    const m = home.match(re);
    if (!m) { block("Домен", `на главной нет тега ${name}`, "index.html"); continue; }
    if (!m[1].startsWith("http")) {
      block("Домен", `${name} остался относительным (${m[1]}) — запустите node scripts/sync-layout.js`,
            "index.html");
    }
  }

  const sitemap = readIfExists("sitemap.xml") || "";
  if (sitemap && !/<loc>https?:\/\//.test(sitemap)) {
    block("Домен", "в sitemap.xml адреса относительные — запустите node scripts/sync-layout.js",
          "sitemap.xml");
  }
  const robots = readIfExists("robots.txt") || "";
  if (robots && !/^Sitemap:\s*https?:\/\//m.test(robots)) {
    block("Домен", "в robots.txt не указан адрес карты сайта", "robots.txt");
  }
}

/* --------------------------------------------------------------------- */
/* 3. Ссылки, якоря и пути к файлам                                       */
/* --------------------------------------------------------------------- */

const EXTERNAL = /^(#|mailto:|tel:|https?:|\/\/|data:)/i;

function checkLinks() {
  let broken = 0, checked = 0;

  for (const rel of pages()) {
    const html = fs.readFileSync(path.join(ROOT, rel), "utf8");
    const dir = path.posix.dirname(rel);
    const ids = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map(m => m[1]));

    for (const m of html.matchAll(/\s(href|src)="([^"]+)"/g)) {
      const value = m[2];
      if (value === "#" || EXTERNAL.test(value)) {
        /* внутренние якоря всё равно проверяем */
        if (value.startsWith("#") && value.length > 1 && !ids.has(value.slice(1))) {
          broken++;
          block("Ссылки", `ссылка на несуществующий якорь ${value}`,
                `${rel}:${lineOf(html, m.index)}`);
        }
        continue;
      }
      checked++;
      const [filePart, anchor] = value.split("#");
      if (!filePart) continue;
      const target = path.posix.normalize(path.posix.join(dir === "." ? "" : dir, filePart));
      if (!fs.existsSync(path.join(ROOT, target))) {
        broken++;
        block("Ссылки", `файла нет: ${value}`, `${rel}:${lineOf(html, m.index)}`);
        continue;
      }
      if (anchor) {
        const targetHtml = fs.readFileSync(path.join(ROOT, target), "utf8");
        if (!targetHtml.includes(`id="${anchor}"`)) {
          broken++;
          block("Ссылки", `в ${target} нет якоря #${anchor}`, `${rel}:${lineOf(html, m.index)}`);
        }
      }
    }

    /* Значки подставляются из общего набора — проверяем, что все нашлись */
    const symbols = new Set([...html.matchAll(/<symbol id="([^"]+)"/g)].map(m => m[1]));
    for (const m of html.matchAll(/<use href="#([^"]+)"/g)) {
      if (!symbols.has(m[1])) {
        broken++;
        block("Значки", `значка #${m[1]} нет в наборе`, `${rel}:${lineOf(html, m.index)}`);
      }
    }
  }
  if (!broken) ok(`Все ссылки, якоря и пути рабочие (проверено ${checked})`);
}

/* --------------------------------------------------------------------- */
/* 3b. Языковые префиксы                                                   */
/*                                                                         */
/* Страница из папки ru/ должна ссылаться на страницы из ru/, а не уводить */
/* посетителя на туркменскую версию. Единственное исключение —             */
/* переключатель языков: он для того и нужен, чтобы уводить.               */
/*                                                                         */
/* Эта проверка появилась после того, как меню на русских и английских     */
/* страницах полгода вело на туркменские: ссылки в шаблонах считались      */
/* от корня сайта, а не от папки языка.                                    */
/* --------------------------------------------------------------------- */

function checkLanguagePrefixes() {
  let wrong = 0, checked = 0;

  for (const rel of pages()) {
    const lang = L.langOf(rel);
    if (lang === L.DEFAULT_LANG) continue;          /* туркменский лежит в корне */

    const html = fs.readFileSync(path.join(ROOT, rel), "utf8");
    const dir = path.posix.dirname(rel);

    for (const m of html.matchAll(/<a\b([^>]*)>/g)) {
      const tag = m[1];
      /* переключатель языков обязан вести на другие языки */
      if (/class="[^"]*lang-switch__link/.test(tag)) continue;

      const href = (tag.match(/\shref="([^"]*)"/) || [])[1];
      if (!href || href === "#" || EXTERNAL.test(href)) continue;

      const file = href.split("#")[0];
      if (!file || !file.endsWith(".html")) continue;

      const target = path.posix.normalize(path.posix.join(dir === "." ? "" : dir, file));
      checked++;
      if (L.langOf(target) !== lang) {
        wrong++;
        block("Языки",
          `ссылка уводит из ${lang}/ на «${L.langOf(target)}»: ${href} → ${target}`,
          `${rel}:${lineOf(html, m.index)}`);
      }
    }
  }
  if (!wrong) ok(`Ссылки не уводят между языками (проверено ${checked})`);
}


/* --------------------------------------------------------------------- */
/* 4. Заголовки и описания страниц                                        */
/* --------------------------------------------------------------------- */

function checkTitles() {
  const titles = new Map(), descs = new Map();
  let bad = 0;

  for (const rel of pages()) {
    const html = fs.readFileSync(path.join(ROOT, rel), "utf8");
    const t = (html.match(/<title>([\s\S]*?)<\/title>/) || [])[1];
    const d = (html.match(/<meta name="description" content="([^"]*)"/) || [])[1];

    if (!t) { bad++; block("Заголовки", "нет <title>", rel); }
    else titles.set(t.trim(), [...(titles.get(t.trim()) || []), rel]);

    if (!d) { bad++; block("Заголовки", "нет описания (meta description)", rel); }
    else {
      descs.set(d, [...(descs.get(d) || []), rel]);
      if (d.length > 160) {
        bad++;
        block("Заголовки", `описание ${d.length} символов, максимум 160`, rel);
      }
    }
  }
  for (const [t, list] of titles) {
    if (list.length > 1) { bad++; block("Заголовки", `одинаковый заголовок «${t}»`, list.join(", ")); }
  }
  for (const [, list] of descs) {
    if (list.length > 1) { bad++; block("Заголовки", "одинаковое описание", list.join(", ")); }
  }
  if (!bad) ok("У всех страниц свои заголовок и описание, длина в норме");
}

/* --------------------------------------------------------------------- */
/* 5. Цены и команда                                                      */
/* --------------------------------------------------------------------- */

function checkPricing() {
  let bad = 0, blocks = 0;
  for (const rel of pages()) {
    if (!rel.includes("wizalar/")) continue;
    const html = fs.readFileSync(path.join(ROOT, rel), "utf8");
    if (!html.includes("pricing__list")) continue;
    blocks++;

    for (const m of html.matchAll(/class="pricing[^"]*pricing--todo[^"]*"/g)) {
      bad++;
      block("Цены", "блок цен ещё помечен как незаполненный (класс pricing--todo)",
            `${rel}:${lineOf(html, m.index)}`);
    }
    /* Цифры мы не требуем: цена назначается по ситуации, и на странице
       это сказано прямо. Требуем только, чтобы не осталось прочерков
       и меток «здесь ещё не заполнено». */
    for (const m of html.matchAll(/<span class="pricing__value[^"]*">([\s\S]*?)<\/span>/g)) {
      const value = m[1].replace(/&mdash;|&ndash;|—|–/g, "").trim();
      if (!value) {
        bad++;
        block("Цены", "в строке цены остался прочерк — впишите значение или уберите строку",
              `${rel}:${lineOf(html, m.index)}`);
      }
    }
    for (const m of html.matchAll(/pricing__value--todo/g)) {
      bad++;
      block("Цены", "строка цены ещё помечена как незаполненная (класс pricing__value--todo)",
            `${rel}:${lineOf(html, m.index)}`);
    }
  }
  if (!blocks) notice("На страницах услуг не найдено блоков цен — проверьте вручную");
  else if (!bad) ok(`Блоки «Сроки и цены» заполнены на всех страницах услуг (${blocks} шт.)`);
}

function checkTeam() {
  let bad = 0, found = 0;
  for (const rel of pages()) {
    if (!rel.endsWith("biz-barada.html")) continue;
    const html = fs.readFileSync(path.join(ROOT, rel), "utf8");
    for (const m of html.matchAll(/class="team__member[^"]*"/g)) {
      found++;
      if (m[0].includes("team__member--todo")) {
        bad++;
        block("Команда", "карточка сотрудника не заполнена: впишите имя и должность, " +
              "затем уберите класс team__member--todo",
              `${rel}:${lineOf(html, m.index)}`);
      }
    }
  }
  if (found && !bad) ok(`Карточки команды заполнены (${found} шт.)`);
  /* Раздела команды на сайте может не быть — это нормальный вариант,
     а не недоделка. Поэтому молчим, если карточек нет вовсе. */
}

/* --------------------------------------------------------------------- */
/* 6. Картинки, иконки, служебные файлы                                   */
/* --------------------------------------------------------------------- */

function checkAssets() {
  const required = [
    ["assets/og-image.png", "превью ссылки в мессенджерах и соцсетях"],
    ["assets/apple-touch-icon.png", "иконка на экране «Домой» у iPhone"],
    ["assets/icon-192.png", "иконка для манифеста"],
    ["assets/icon-512.png", "иконка для манифеста"],
    ["assets/favicon.svg", "иконка во вкладке браузера"],
    ["manifest.webmanifest", "имя и иконки сайта"],
    ["sitemap.xml", "карта сайта для поисковиков"],
    ["robots.txt", "разрешение на обход сайта"],
    ["404.html", "страница «такой страницы нет»"],
    [".htaccess", "настройки хостинга на Apache"],
    ["assets/fonts/inter-latin.woff2", "шрифт"]
  ];
  let missing = 0;
  for (const [rel, why] of required) {
    if (!fs.existsSync(path.join(ROOT, rel))) {
      missing++;
      block("Файлы", `нет файла — ${why}`, rel);
    }
  }
  if (!missing) ok("Все нужные картинки, иконки и служебные файлы на месте");

  /* og:image должен вести на png: svg в превью не показывается */
  const home = readIfExists("index.html") || "";
  const og = (home.match(/<meta property="og:image" content="([^"]*)"/) || [])[1] || "";
  if (og && !og.endsWith(".png")) {
    block("Файлы", `og:image ведёт на ${og} — для превью нужен png`, "index.html");
  }
}

/* --------------------------------------------------------------------- */
/* 7. Источники фотографий                                                */
/* --------------------------------------------------------------------- */

/* Для снимков под CC-BY и CC-BY-SA указание автора — требование лицензии.
   Если поле пустое, а снимок на сайте лежит, мы нарушаем условия, под
   которыми нам его разрешили взять. Поэтому это ошибка, а не замечание. */

function checkPhotoCredits() {
  const dataFile = path.join(ROOT, "data", "photos.json");
  const creditsFile = path.join(ROOT, "assets", "photos", "CREDITS.md");
  const dir = path.join(ROOT, "assets", "photos");

  const onDisk = fs.existsSync(dir)
    ? fs.readdirSync(dir).filter(f => f.endsWith(".webp"))
    : [];
  if (!onDisk.length) {
    ok("Фотографий городов пока нет — проверять источники не у чего");
    return;
  }

  if (!fs.existsSync(dataFile)) {
    block("Фотографии", "нет data/photos.json — источники снимков не записаны", "data/photos.json");
    return;
  }

  let data;
  try {
    data = JSON.parse(fs.readFileSync(dataFile, "utf8"));
  } catch (e) {
    block("Фотографии", `data/photos.json не читается: ${e.message}`, "data/photos.json");
    return;
  }

  const credits = fs.existsSync(creditsFile) ? fs.readFileSync(creditsFile, "utf8") : "";
  if (!credits) {
    block("Фотографии", "нет assets/photos/CREDITS.md — запустите python3 scripts/photos.py",
          "assets/photos/CREDITS.md");
  }

  const listed = new Set((data.photos || []).map(p => p.photo));
  let bad = 0;

  for (const p of data.photos || []) {
    if (!onDisk.includes(p.photo + ".webp")) continue;   /* снимка нет — и спрашивать не с чего */
    const where = `data/photos.json → ${p.photo}`;
    const free = /public domain|cc0/i.test(p.licence || "");

    if (!free && !(p.author || "").trim()) {
      bad++;
      block("Фотографии", `не указан автор, а лицензия «${p.licence || "?"}» этого требует`, where);
    }
    if (!(p.licence || "").trim()) {
      bad++;
      block("Фотографии", "не указана лицензия", where);
    }
    if (!/^https?:\/\//.test(p.page || "")) {
      bad++;
      block("Фотографии", "нет ссылки на страницу описания снимка", where);
    }
    if (credits && credits.indexOf(p.photo + ".webp") === -1) {
      bad++;
      block("Фотографии", "снимка нет в CREDITS.md — пересоберите: python3 scripts/photos.py",
            "assets/photos/CREDITS.md");
    }
  }

  /* Файл лежит, а в списке его нет — значит, источник вообще неизвестен */
  for (const file of onDisk) {
    const slug = file.replace(/\.webp$/, "");
    if (!listed.has(slug)) {
      bad++;
      block("Фотографии", `снимок есть, а источник неизвестен — впишите его в data/photos.json`,
            `assets/photos/${file}`);
    }
  }

  if (!bad) ok(`У всех фотографий указаны автор, лицензия и ссылка (${onDisk.length} шт.)`);
}


/* --------------------------------------------------------------------- */
/* 7. Резервная копия                                                     */
/* --------------------------------------------------------------------- */

function checkBackup() {
  const dir = path.join(ROOT, "backups");
  if (!fs.existsSync(dir)) {
    notice("Резервных копий ещё не было. Перед правками сделайте: node scripts/backup.js");
    return;
  }
  const list = fs.readdirSync(dir).filter(n => /^\d{4}-\d{2}-\d{2}/.test(n)).sort();
  if (!list.length) {
    notice("Папка backups пуста. Перед правками сделайте: node scripts/backup.js");
    return;
  }
  const last = list[list.length - 1];
  const age = Math.round((Date.now() - fs.statSync(path.join(dir, last)).mtimeMs) / 86400000);
  ok(`Последняя резервная копия: ${last}` + (age > 0 ? ` (${age} дн. назад)` : " (сегодня)"));
  if (age > 14) notice("Резервной копии больше двух недель — стоит сделать новую: node scripts/backup.js");
}

/* --------------------------------------------------------------------- */
/* Вывод                                                                  */
/* --------------------------------------------------------------------- */

function printReport() {
  const line = "─".repeat(72);

  console.log("\nПРОВЕРКА ПЕРЕД ПУБЛИКАЦИЕЙ");
  console.log(line);

  console.log("\nЧТО В ПОРЯДКЕ\n");
  for (const d of done) console.log("  ✓ " + d);
  if (!done.length) console.log("  (пока ничего)");

  if (notices.length) {
    console.log("\nСТОИТ ЗНАТЬ\n");
    for (const n of notices) {
      console.log("  · " + n.message + (n.where ? `\n      ${n.where}` : ""));
    }
  }

  /* Одинаковые по сути пункты сводим вместе: 18 страниц с незаполненной ценой —
     это одна задача, а не восемнадцать. */
  const tasks = [];
  if (blockers.length) {
    const byGroup = new Map();
    for (const b of blockers) byGroup.set(b.group, [...(byGroup.get(b.group) || []), b]);

    console.log("\nМЕШАЕТ ПУБЛИКАЦИИ\n");
    for (const [group, list] of byGroup) {
      const byMessage = new Map();
      for (const b of list) byMessage.set(b.message, [...(byMessage.get(b.message) || []), b.where]);

      console.log(`  ${group}`);
      for (const [message, places] of byMessage) {
        tasks.push({ group, message, count: places.length });
        const spots = places.filter(Boolean);
        console.log(`    ✗ ${message}` + (spots.length > 1 ? `   — мест: ${spots.length}` : ""));
        for (const where of spots.slice(0, 3)) console.log(`        ${where}`);
        if (spots.length > 3) console.log(`        … и ещё ${spots.length - 3}`);
      }
      console.log("");
    }
  }

  console.log(line);
  if (blockers.length === 0) {
    console.log("\n  МОЖНО ПУБЛИКОВАТЬ\n");
    console.log("  Дальше — DEPLOY.md, там по шагам расписано, куда и как загружать.\n");
    return 0;
  }
  const places = blockers.length;
  console.log(`\n  НЕЛЬЗЯ ПУБЛИКОВАТЬ, ОСТАЛОСЬ ПУНКТОВ: ${tasks.length}` +
    (places > tasks.length ? `  (всего мест для правки: ${places})` : "") + "\n");
  console.log("  Что делать по каждому пункту — в HANDOVER.md и CONTENT-MAP.md.");
  console.log("  После правок запустите: node scripts/sync-layout.js");
  console.log("  и снова:                node scripts/preflight.js\n");
  return 1;
}

/* --------------------------------------------------------------------- */

function main() {
  const site = L.loadSite();

  /* Сборка и переводы — берём готовые проверки из sync-layout.js */
  const sync = require("./sync-layout.js").run({ check: true, quiet: true });

  if (sync.changed > 0) {
    block("Сборка", `${sync.changed} стр. разошлись с шаблонами — запустите node scripts/sync-layout.js`,
          "partials/");
  } else {
    ok("Шапка, подвал и контакты одинаковы на всех страницах");
  }

  for (const e of sync.errors) block("Языки и разметка", e, "");
  if (!sync.errors.length) ok("Все страницы есть на трёх языках, переводы на месте, hreflang согласованы");

  for (const w of sync.warnings) notice(w, "");

  if (!sync.seo.sitemapStale) ok("Карта сайта sitemap.xml актуальна");
  else block("Поиск", "карта сайта устарела — запустите node scripts/sync-layout.js", "sitemap.xml");

  if (!sync.seo.robotsStale) ok("robots.txt актуален");
  else block("Поиск", "robots.txt устарел — запустите node scripts/sync-layout.js", "robots.txt");

  checkPlaceholders(sync);
  checkDomain(site);
  checkLinks();
  checkLanguagePrefixes();
  checkTitles();
  checkPricing();
  checkTeam();
  checkAssets();
  checkPhotoCredits();
  checkBackup();

  process.exitCode = printReport();
}

main();
