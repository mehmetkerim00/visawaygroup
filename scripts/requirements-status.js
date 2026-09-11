#!/usr/bin/env node
/*
 * requirements-status.js — что заполнено, что проверено, где остались вопросы.
 *
 *     node scripts/requirements-status.js            таблица
 *     node scripts/requirements-status.js --todo     только вопросы специалисту
 *
 * Ничего не меняет, только смотрит и показывает.
 */

"use strict";

const requirements = require("./requirements");
const { LANGS } = require("./lib-site");

const ONLY_TODO = process.argv.includes("--todo");

const VISAS = ["is-wizasy", "okuw-wizasy", "syyahat-wizasy",
               "myhmancylyk-wizasy", "isewurlik-wizasy", "bilim-maslahaty"];

function pad(s, n) {
  s = String(s);
  /* Считаем по видимым знакам: в названиях есть буквы шире ASCII */
  return s + " ".repeat(Math.max(0, n - [...s].length));
}

function main() {
  let data;
  try {
    data = requirements.load();
  } catch (e) {
    console.error("ОШИБКА: " + e.message);
    process.exit(1);
  }

  const entries = data.req.entries || [];
  const byPair = new Map(entries.map(e => [e.visa + "|" + e.country, e]));
  const countries = data.countries;

  if (!ONLY_TODO) {
    console.log("");
    console.log("ТРЕБОВАНИЯ ПО СТРАНАМ");
    console.log("─".repeat(78));
    console.log("  ·  записи нет      ○  черновик      ✓  проверено");
    console.log("");

    const head = pad("страна", 14) + VISAS.map(v => pad(v.slice(0, 9), 10)).join("");
    console.log("  " + head);
    for (const c of countries) {
      const row = VISAS.map(v => {
        const e = byPair.get(v + "|" + c.flag);
        if (!e) return pad("·", 10);
        return pad(e.status === "verified" ? "✓" : "○", 10);
      }).join("");
      console.log("  " + pad(c.country.ru, 14) + row);
    }

    const verified = entries.filter(e => e.status === "verified").length;
    const total = countries.length * VISAS.length;
    console.log("");
    console.log(`  Всего пар: ${total}. Заполнено: ${entries.length}. Проверено: ${verified}.`);
    console.log(`  На сайте сейчас видно: ${verified} ${verified === 1 ? "страница" : "страниц"} требований на каждом языке.`);
    console.log("");
  }

  /* Вопросы специалисту и пустые поля */
  console.log("ЧТО ЖДЁТ СПЕЦИАЛИСТА");
  console.log("─".repeat(78));
  let any = false;
  for (const e of entries) {
    const country = data.byCode.get(e.country);
    const todos = requirements.todos(e);
    const empty = requirements.emptyFields(e);
    if (!todos.length && !empty.length && e.status === "verified") continue;
    any = true;
    console.log("");
    console.log(`  ${country.country.ru} · ${e.visa}   [${e.status === "verified" ? "проверено" : "черновик"}]`);
    if (empty.length) console.log(`    пустые поля: ${empty.join(", ")}`);
    for (const t of todos) {
      console.log(`    ${t.text.replace(/\s+/g, " ").slice(0, 120)}`);
    }
  }
  if (!any) console.log("\n  Пусто: вопросов нет, поля заполнены.");
  console.log("");
  console.log("  Править: data/requirements.json. Как — в SPECIALIST.md.");
  console.log("");
}

main();
