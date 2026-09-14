#!/usr/bin/env node
/*
 * build-vercel.js — сборка сайта на стороне хостинга.
 *
 * ЗАЧЕМ ОНА ЕСТЬ. Раньше страницы собирались на вашем компьютере и
 * ложились в репозиторий готовыми. Пока требования правились в файле,
 * этого хватало. Теперь их правит специалист в панели, и данные лежат
 * в базе — значит, собирать надо там, где база доступна в момент
 * выкладки. Иначе кнопка «Опубликовать» не могла бы ничего изменить.
 *
 * Порядок такой:
 *   1. выгрузить требования из базы в data/requirements.json;
 *   2. собрать страницы и разложить по ним шапку, подвал, разметку;
 *   3. прогнать preflight.
 *
 * Если preflight не пропускает — выходим с ошибкой. Vercel тогда не
 * заменяет сайт: прежняя версия остаётся жить. Это и есть страховка,
 * про которую шла речь: неудачная сборка не ломает работающий сайт.
 *
 * Черновики сюда не попадают: собирается обычная сборка, без --drafts.
 */

"use strict";

const { spawnSync } = require("child_process");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");

/* На Vercel переменные приходят от самого хостинга. Локально они лежат
   в .env.local — без этого проверить сборку у себя было бы нельзя:
   она молча пропускала бы выгрузку из базы. */
try {
  if (require("fs").existsSync(path.join(ROOT, ".env.local"))) {
    process.loadEnvFile(path.join(ROOT, ".env.local"));
  }
} catch (e) { /* старый Node — переменные задаются вручную */ }

function step(name, file, args) {
  console.log("");
  console.log("── " + name + " " + "─".repeat(Math.max(0, 60 - name.length)));
  const r = spawnSync(process.execPath, [path.join(ROOT, "scripts", file)].concat(args || []), {
    stdio: "inherit",
    cwd: ROOT
  });
  if (r.status !== 0) {
    console.error("");
    console.error("ОСТАНОВЛЕНО НА ШАГЕ: " + name);
    console.error("Сайт не заменён — продолжает работать прежняя версия.");
    process.exit(r.status || 1);
  }
}

function main() {
  console.log("СБОРКА САЙТА НА ХОСТИНГЕ");

  /* Без ключей хранилища выгружать нечего. Это не повод падать: если
     кто-то соберёт проект без панели, сайт должен собраться из файла,
     который лежит в репозитории. */
  if (!process.env.KV_REST_API_URL) {
    console.log("");
    console.log("  Хранилище панели не подключено — берём требования из файла.");
  } else {
    step("Выгрузка требований из базы", "admin-init.js", ["export"]);
  }

  step("Сборка страниц", "build.js");
  step("Проверка перед публикацией", "preflight.js");

  console.log("");
  console.log("Готово. Сайт собран.");
}

main();
