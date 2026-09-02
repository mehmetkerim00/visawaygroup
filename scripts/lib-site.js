/*
 * lib-site.js — общий код для скриптов в этой папке.
 * Здесь лежит то, что нужно и sync-layout.js, и build-seo.js:
 * список языков, разбор путей и чтение data/site.json.
 * Отдельно этот файл не запускается.
 */

"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const SITE_FILE = path.join(ROOT, "data", "site.json");

const LANGS = ["tk", "ru", "en"];
const LANG_DIR = { tk: "", ru: "ru", en: "en" };
const DEFAULT_LANG = "tk";
const TODO = "ЗАПОЛНИТЬ";

/* Папки, в которых страниц нет */
const SKIP_DIRS = new Set([
  "partials", "scripts", "assets", "css", "js", "data", "node_modules", ".git",
  /* backups — это резервные копии сайта. Заходить в них нельзя:
     иначе скрипты начнут их переписывать, и копии перестанут быть копиями. */
  "backups"
]);

function isTodo(v) { return typeof v === "string" && v.indexOf(TODO) !== -1; }

/* "ru/wizalar/is-wizasy.html" -> "ru" ; "wizalar.html" -> "tk" */
function langOf(rel) {
  const first = rel.split("/")[0];
  for (const l of LANGS) if (LANG_DIR[l] && first === LANG_DIR[l]) return l;
  return DEFAULT_LANG;
}

/* "ru/wizalar/is-wizasy.html" -> "wizalar/is-wizasy.html" */
function stripLang(rel) {
  const l = langOf(rel);
  return LANG_DIR[l] ? rel.slice(LANG_DIR[l].length + 1) : rel;
}

/* ("wizalar/is-wizasy.html", "ru") -> "ru/wizalar/is-wizasy.html" */
function joinLang(bare, lang) {
  return LANG_DIR[lang] ? LANG_DIR[lang] + "/" + bare : bare;
}

/* Относительная ссылка с одной страницы на другую */
function relLink(fromRel, toRel) {
  const fromDir = path.posix.dirname(fromRel.split(path.sep).join("/"));
  const rel = path.posix.relative(fromDir === "." ? "" : fromDir, toRel);
  return rel || path.posix.basename(toRel);
}

function findPages(dir = ROOT, found = []) {
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

/* Пути страниц от корня сайта, через косую черту */
function pageList() {
  return findPages().map(p => path.relative(ROOT, p).split(path.sep).join("/")).sort();
}

function loadSite() {
  if (!fs.existsSync(SITE_FILE)) {
    console.error("ОШИБКА: нет файла data/site.json.");
    process.exit(1);
  }
  try {
    return JSON.parse(fs.readFileSync(SITE_FILE, "utf8"));
  } catch (e) {
    console.error("ОШИБКА: data/site.json не читается — скорее всего, лишняя или пропущенная запятая.\n" + e.message);
    process.exit(1);
  }
}

/* Значение бывает общим ("текст") или языковым ({tk:…, ru:…, en:…}) */
function pick(value, lang) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    if (Object.prototype.hasOwnProperty.call(value, lang)) return value[lang];
  }
  return value;
}

/* Адрес сайта. Пока домен не вписан — пусто, тогда используем относительные пути. */
function siteUrl(site) {
  return isTodo(site.domain || "") ? "" : "https://" + String(site.domain).replace(/\/+$/, "") + "/";
}

module.exports = {
  ROOT, SITE_FILE, LANGS, LANG_DIR, DEFAULT_LANG, TODO, SKIP_DIRS,
  isTodo, langOf, stripLang, joinLang, relLink, findPages, pageList,
  loadSite, pick, siteUrl
};
