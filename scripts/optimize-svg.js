#!/usr/bin/env node
/*
 * optimize-svg.js — уменьшает вес svg-файлов в assets/, не меняя картинку.
 *
 * Что делает:
 *   • округляет координаты до одного знака после запятой
 *     (при размере логотипа в шапке это меньше сотой доли пикселя);
 *   • убирает нули в хвосте чисел: 1.90 → 1.9, 130.0 → 130;
 *   • убирает лишние пробелы и переносы строк.
 *
 * Запускать нужно только если вы заменили файлы логотипов:
 *     node scripts/optimize-svg.js
 *     node scripts/optimize-svg.js --dry     (только показать, ничего не менять)
 *
 * Скрипт можно запускать повторно: второй раз он уже ничего не изменит.
 */

"use strict";

const fs = require("fs");
const path = require("path");

const ASSETS = path.resolve(__dirname, "..", "assets");
const DRY = process.argv.includes("--dry");
const PRECISION = 1;

function round(numText) {
  const n = Number(numText);
  if (!isFinite(n)) return numText;

  /* Один знак после запятой годится для координат, которые измеряются
     десятками и сотнями. Но у мелких чисел — например у коэффициентов
     масштаба вроде 0.037 — так теряется всё значение: 0.037 превратится
     в 0, и часть картинки просто исчезнет. Поэтому для чисел меньше
     единицы оставляем значащие цифры, а не знаки после запятой. */
  let out;
  if (Math.abs(n) < 1 && n !== 0) {
    out = n.toPrecision(4);
    if (out.indexOf("e") !== -1) return numText;   /* очень мелкое — не трогаем */
    if (out.indexOf(".") !== -1) out = out.replace(/0+$/, "").replace(/\.$/, "");
  } else {
    out = n.toFixed(PRECISION);
    if (out.indexOf(".") !== -1) out = out.replace(/\.?0+$/, "");
  }
  if (out === "-0") out = "0";
  return out;
}

function optimize(svg) {
  let out = svg;
  out = out.replace(/<\?xml[\s\S]*?\?>\s*/g, "");
  out = out.replace(/<!--[\s\S]*?-->/g, "");
  out = out.replace(/<metadata[\s\S]*?<\/metadata>/g, "");
  /* числа: и в атрибутах, и внутри d="..." */
  out = out.replace(/-?\d*\.\d+/g, round);
  out = out.replace(/(\d)\.0+(?=\D|$)/g, "$1");
  out = out.replace(/\s+/g, " ");
  out = out.replace(/\s*\/>/g, "/>");
  out = out.replace(/>\s+</g, "><");
  return out.trim() + "\n";
}

function main() {
  const files = fs.readdirSync(ASSETS).filter(f => f.endsWith(".svg")).sort();
  let before = 0, after = 0, changed = 0;

  console.log(DRY ? "Проверка (файлы не меняются)\n" : "Оптимизация svg\n");

  for (const file of files) {
    const full = path.join(ASSETS, file);
    const src = fs.readFileSync(full, "utf8");
    const opt = optimize(src);

    before += Buffer.byteLength(src);
    after += Buffer.byteLength(opt);

    const saved = Buffer.byteLength(src) - Buffer.byteLength(opt);
    const pct = saved / Buffer.byteLength(src) * 100;

    if (saved === 0) {
      console.log(`  =  ${file.padEnd(28)} без изменений`);
      continue;
    }
    changed++;
    console.log(`  ${DRY ? "!" : "✓"}  ${file.padEnd(28)} ` +
      `${(Buffer.byteLength(src) / 1024).toFixed(1)} → ${(Buffer.byteLength(opt) / 1024).toFixed(1)} КБ  ` +
      `(−${pct.toFixed(0)}%)`);
    if (!DRY) fs.writeFileSync(full, opt, "utf8");
  }

  console.log(`\nИтого: ${(before / 1024).toFixed(1)} → ${(after / 1024).toFixed(1)} КБ, ` +
    `экономия ${((before - after) / 1024).toFixed(1)} КБ (${((before - after) / before * 100).toFixed(0)}%). ` +
    `Файлов изменено: ${changed}.`);
}

main();
