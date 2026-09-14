#!/usr/bin/env node
/*
 * build.js — собрать сайт.
 *
 *     node scripts/build.js
 *
 * Страницы требований собираются для всех записей: статус на видимость
 * больше не влияет. Незаполненные поля и пункты с меткой УТОЧНИТЬ на
 * страницу не выходят, вверху каждой стоит предупреждение, и весь раздел
 * закрыт от поиска — правила в api/_lib/core.js и scripts/requirements.js.
 *
 * Порядок действий: сначала страницы требований, потом sync-layout —
 * он разложит по ним шапку, подвал, ссылки на языки и микроразметку,
 * а заодно соберёт блок выбора страны на страницах виз.
 */

"use strict";

const { spawnSync } = require("child_process");
const path = require("path");
const requirements = require("./requirements");

function say(m) { console.log(m); }

function run(script, env) {
  const r = spawnSync(process.execPath, [path.join(__dirname, script)], {
    stdio: "inherit",
    env: Object.assign({}, process.env, env || {})
  });
  if (r.status !== 0) process.exit(r.status || 1);
}

function main() {
  say("");
  say("СБОРКА САЙТА");
  say("────────────────────────────────────────────────────────────────────────");

  let res;
  try {
    res = requirements.build();
  } catch (e) {
    console.error("\nОШИБКА: " + e.message);
    process.exit(1);
  }

  const data = requirements.load();
  const all = (data.req.entries || []);

  say(`  записей в data/requirements.json: ${all.length}`);
  say(`  страниц записано: ${res.written.length}`);
  if (res.removed.length) {
    say(`  страниц убрано с диска: ${res.removed.length}`);
    for (const r of res.removed.slice(0, 6)) say(`    − ${r}`);
    if (res.removed.length > 6) say(`    … и ещё ${res.removed.length - 6}`);
  }
  say("");

  run("sync-layout.js");

  say("");
  say("  Готово. Дальше: node scripts/preflight.js");
  say("");
}

main();
