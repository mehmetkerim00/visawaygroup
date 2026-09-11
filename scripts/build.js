#!/usr/bin/env node
/*
 * build.js — собрать сайт.
 *
 *     node scripts/build.js            для публикации
 *     node scripts/build.js --drafts   для себя, вместе с черновиками
 *
 * Разница одна, но важная. Обычная сборка кладёт на диск только те
 * страницы требований, у которых в data/requirements.json стоит
 * status: "verified". Черновиков после неё на диске не остаётся —
 * они не прячутся стилями, их просто нет.
 *
 * Сборка с --drafts добавляет черновики, помечает каждый красной
 * полосой «ЧЕРНОВИК — НЕ ПРОВЕРЕНО СПЕЦИАЛИСТОМ» и ставит им noindex.
 * Такую сборку публиковать нельзя, и preflight об этом скажет.
 *
 * Порядок действий: сначала страницы требований, потом sync-layout —
 * он разложит по ним шапку, подвал, ссылки на языки и микроразметку,
 * а заодно соберёт блок выбора страны на страницах виз.
 */

"use strict";

const { spawnSync } = require("child_process");
const path = require("path");
const requirements = require("./requirements");

const DRAFTS = process.argv.includes("--drafts");

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
  say(DRAFTS
    ? "СБОРКА С ЧЕРНОВИКАМИ — только для просмотра, публиковать нельзя"
    : "СБОРКА ДЛЯ ПУБЛИКАЦИИ — черновики не попадут никуда");
  say("────────────────────────────────────────────────────────────────────────");

  let res;
  try {
    res = requirements.build({ drafts: DRAFTS });
  } catch (e) {
    console.error("\nОШИБКА: " + e.message);
    process.exit(1);
  }

  const data = requirements.load();
  const all = (data.req.entries || []);
  const verified = all.filter(e => e.status === "verified").length;
  const draftCount = all.length - verified;

  say(`  записей в data/requirements.json: ${all.length}` +
      `  (проверено ${verified}, черновиков ${draftCount})`);
  say(`  страниц записано: ${res.written.length}`);
  if (res.removed.length) {
    say(`  страниц убрано с диска: ${res.removed.length}`);
    for (const r of res.removed.slice(0, 6)) say(`    − ${r}`);
    if (res.removed.length > 6) say(`    … и ещё ${res.removed.length - 6}`);
  }
  if (!DRAFTS && draftCount) {
    say(`  черновики (${draftCount}) пропущены — посмотреть их: node scripts/build.js --drafts`);
  }
  say("");

  run("sync-layout.js", DRAFTS ? { VW_DRAFTS: "1" } : { VW_DRAFTS: "" });

  say("");
  if (DRAFTS) {
    say("  Готово. Это сборка с черновиками — на хостинг её не выкладывайте.");
    say("  Перед публикацией соберите заново: node scripts/build.js");
  } else {
    say("  Готово. Дальше: node scripts/preflight.js");
  }
  say("");
}

main();
