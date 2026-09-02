#!/usr/bin/env node
/*
 * serve.js — маленький локальный сервер для проверки сайта.
 * В отличие от простого http-сервера он сжимает файлы gzip — так же,
 * как это будет делать настоящий хостинг. Без этого замеры скорости
 * получаются пессимистичными.
 *
 *     node scripts/serve.js          — открыть на http://localhost:8777
 *     node scripts/serve.js 3000     — на другом порту
 */

"use strict";
const http = require("http");
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const ROOT = path.resolve(__dirname, "..");
const PORT = Number(process.argv[2] || process.env.PORT || 8777);

const TYPES = {
  ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8", ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml", ".png": "image/png", ".woff2": "font/woff2",
  ".xml": "application/xml; charset=utf-8", ".txt": "text/plain; charset=utf-8"
};
/* woff2 и png уже сжаты — повторно жать бессмысленно */
const COMPRESS = new Set([".html", ".css", ".js", ".json", ".webmanifest", ".svg", ".xml", ".txt"]);

http.createServer((req, res) => {
  let rel = decodeURIComponent(req.url.split("?")[0]);
  if (rel.endsWith("/")) rel += "index.html";
  const file = path.join(ROOT, path.normalize(rel).replace(/^(\.\.[/\\])+/, ""));

  fs.readFile(file, (err, data) => {
    if (err) {
      const ext404 = path.join(ROOT, "404.html");
      return fs.readFile(ext404, (e2, d2) => {
        res.writeHead(404, { "Content-Type": TYPES[".html"] });
        res.end(e2 ? "404" : d2);
      });
    }
    const ext = path.extname(file).toLowerCase();
    const headers = {
      "Content-Type": TYPES[ext] || "application/octet-stream",
      "Cache-Control": ext === ".html" ? "no-cache" : "public, max-age=31536000"
    };
    const accepts = (req.headers["accept-encoding"] || "").includes("gzip");
    if (accepts && COMPRESS.has(ext)) {
      const gz = zlib.gzipSync(data, { level: 6 });
      headers["Content-Encoding"] = "gzip";
      headers["Vary"] = "Accept-Encoding";
      res.writeHead(200, headers);
      return res.end(gz);
    }
    res.writeHead(200, headers);
    res.end(data);
  });
}).listen(PORT, () => console.log(`Сайт: http://localhost:${PORT}  (со сжатием gzip)`));
