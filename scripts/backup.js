#!/usr/bin/env node
/*
 * backup.js — делает резервную копию сайта.
 *
 *     node scripts/backup.js
 *
 * Копия кладётся в папку backups/ и называется по дате и времени,
 * например backups/2026-09-02-1430/. Внутри — весь сайт целиком.
 *
 * ЗАЧЕМ. Если после правки что-то сломалось и непонятно что — просто
 * возьмите файлы из последней копии и положите обратно. Ничего
 * восстанавливать через программиста не придётся.
 *
 * ДЕЛАЙТЕ КОПИЮ ПЕРЕД КАЖДОЙ ПРАВКОЙ. Это занимает секунду.
 *
 *     node scripts/backup.js --list     показать все копии
 *     node scripts/backup.js --keep 20  оставить только 20 последних
 */

"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const BACKUPS = path.join(ROOT, "backups");

/* Что в копию не берём */
const SKIP = new Set(["backups", "node_modules", ".git", ".DS_Store"]);

/* Сколько копий хранить по умолчанию */
const DEFAULT_KEEP = 30;

function stamp() {
  const d = new Date();
  const p = n => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

function copyDir(from, to, stats) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue;
    const src = path.join(from, entry.name);
    const dst = path.join(to, entry.name);
    if (entry.isDirectory()) {
      copyDir(src, dst, stats);
    } else if (entry.isFile()) {
      fs.copyFileSync(src, dst);
      stats.files++;
      stats.bytes += fs.statSync(src).size;
    }
  }
}

function listBackups() {
  if (!fs.existsSync(BACKUPS)) return [];
  return fs.readdirSync(BACKUPS)
    .filter(n => /^\d{4}-\d{2}-\d{2}-\d{4}$/.test(n))
    .sort();
}

function folderSize(dir) {
  let total = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    total += entry.isDirectory() ? folderSize(full) : fs.statSync(full).size;
  }
  return total;
}

function showList() {
  const list = listBackups();
  if (!list.length) {
    console.log("Резервных копий пока нет.");
    console.log("Сделать первую:  node scripts/backup.js");
    return;
  }
  console.log(`Резервных копий: ${list.length}\n`);
  for (const name of list) {
    const size = folderSize(path.join(BACKUPS, name));
    const when = name.replace(/^(\d{4})-(\d{2})-(\d{2})-(\d{2})(\d{2})$/, "$3.$2.$1 в $4:$5");
    console.log(`  ${name}   ${when}   ${(size / 1024 / 1024).toFixed(1)} МБ`);
  }
  console.log(`\nПапка с копиями: backups/`);
  console.log("Чтобы вернуть сайт к копии — скопируйте файлы из неё обратно в корень проекта.");
}

function prune(keep) {
  const list = listBackups();
  if (list.length <= keep) return 0;
  const extra = list.slice(0, list.length - keep);
  for (const name of extra) {
    fs.rmSync(path.join(BACKUPS, name), { recursive: true, force: true });
  }
  return extra.length;
}

function main() {
  const args = process.argv.slice(2);

  if (args.includes("--list")) return showList();

  const keepIndex = args.indexOf("--keep");
  const keep = keepIndex !== -1 ? Number(args[keepIndex + 1]) || DEFAULT_KEEP : DEFAULT_KEEP;

  const name = stamp();
  const target = path.join(BACKUPS, name);

  if (fs.existsSync(target)) {
    console.log(`Копия ${name} уже сделана минуту назад — новая не нужна.`);
    return;
  }

  const stats = { files: 0, bytes: 0 };
  copyDir(ROOT, target, stats);

  console.log(`Копия сохранена: backups/${name}`);
  console.log(`Файлов: ${stats.files},  размер: ${(stats.bytes / 1024 / 1024).toFixed(1)} МБ`);

  const removed = prune(keep);
  if (removed) console.log(`Старых копий удалено: ${removed} (храним последние ${keep}).`);

  console.log("\nЕсли после правок что-то сломается — верните файлы из этой папки.");
  console.log("Посмотреть все копии:  node scripts/backup.js --list");
}

main();
