#!/usr/bin/env node
/*
 * admin-dev.js — запустить сайт вместе с панелью у себя на компьютере.
 *
 *     node scripts/admin-dev.js          http://localhost:8787
 *
 * На Vercel этого файла нет и не нужно: там статику раздаёт сам хостинг,
 * а каждый файл в api/ сам становится серверной функцией. Здесь то же
 * самое собрано вручную, чтобы панель можно было открыть и проверить
 * до выкладки.
 *
 * Данные в этом режиме лежат в одном файле во временной папке — см.
 * api/_lib/kv.js. На сервере такой режим запрещён.
 */

"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const ROOT = path.resolve(__dirname, "..");

/* Ключи хранилища лежат в .env.local — его кладёт сюда `vercel env pull`.
   На сервере переменные приходят от самого Vercel, и файла там нет. */
try {
  if (require("fs").existsSync(require("path").join(__dirname, "..", ".env.local"))) {
    process.loadEnvFile(require("path").join(__dirname, "..", ".env.local"));
  }
} catch (e) { /* старый Node — значит, переменные задаются вручную */ }

const PORT = Number(process.argv[2] || process.env.PORT || 8787);

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".png": "image/png",
  ".woff2": "font/woff2",
  ".xml": "application/xml; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".webmanifest": "application/manifest+json"
};

/* Те же заголовки, что ставит vercel.json для /admin. Без них локальная
   проверка показывала бы не то, что будет на сервере. */
const ADMIN_HEADERS = {
  "Content-Security-Policy":
    "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; " +
    "font-src 'self'; connect-src 'self'; form-action 'self'; frame-src 'self'; " +
    "frame-ancestors 'self'; base-uri 'none'",
  "X-Frame-Options": "SAMEORIGIN",
  "X-Robots-Tag": "noindex, nofollow, noarchive",
  "Cache-Control": "no-store, max-age=0"
};

const handlers = new Map();

/* Перечитываем обработчики и всё, на что они опираются, при каждом
   запросе. Иначе после правки файла сервер продолжал бы отвечать
   старым кодом, и проверка показывала бы не то, что написано. */
function loadHandlers() {
  for (const key of Object.keys(require.cache)) {
    if (key.startsWith(path.join(ROOT, "api"))) delete require.cache[key];
  }
  const dir = path.join(ROOT, "api", "admin");
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith(".js")) continue;
    const route = "/api/admin/" + name.replace(/\.js$/, "");
    handlers.set(route, require(path.join(dir, name)));
  }
}

function serveStatic(req, res, urlPath) {
  let rel = decodeURIComponent(urlPath.split("?")[0]);
  if (rel.endsWith("/")) rel += "index.html";
  const file = path.join(ROOT, rel.replace(/^\/+/, ""));
  if (!file.startsWith(ROOT)) { res.statusCode = 403; res.end("нельзя"); return; }
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.statusCode = 404;
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.end("404 — нет такого файла: " + rel);
    return;
  }
  const ext = path.extname(file).toLowerCase();
  res.setHeader("Content-Type", TYPES[ext] || "application/octet-stream");
  if (rel.startsWith("/admin")) {
    for (const [k, v] of Object.entries(ADMIN_HEADERS)) res.setHeader(k, v);
  } else {
    res.setHeader("Cache-Control", "no-cache");
  }
  const body = fs.readFileSync(file);
  const accepts = String(req.headers["accept-encoding"] || "").includes("gzip");
  if (accepts && /^(text|application)\//.test(TYPES[ext] || "")) {
    res.setHeader("Content-Encoding", "gzip");
    res.end(zlib.gzipSync(body));
  } else {
    res.end(body);
  }
}

const server = http.createServer(async (req, res) => {
  const urlPath = req.url.split("?")[0];
  if (urlPath.startsWith("/api/")) {
    loadHandlers();
    const fn = handlers.get(urlPath);
    if (!fn) {
      res.statusCode = 404;
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.end(JSON.stringify({ error: "Нет такого адреса." }));
      return;
    }
    try {
      await fn(req, res);
    } catch (e) {
      console.error(e);
      if (!res.headersSent) res.statusCode = 500;
      res.end(JSON.stringify({ error: "Сбой" }));
    }
    return;
  }
  serveStatic(req, res, urlPath);
});

server.listen(PORT, () => {
  console.log("");
  console.log("  Сайт и панель: http://localhost:" + PORT);
  console.log("  Панель:        http://localhost:" + PORT + "/admin/");
  console.log("");
  console.log("  Остановить — Ctrl+C");
  console.log("");
});
