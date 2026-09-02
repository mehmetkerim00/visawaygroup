#!/usr/bin/env node
/*
 * measure-speed.js — замеряет, за сколько страница показывает первый текст
 * на медленном интернете. Инструмент для разработчика, для работы сайта не нужен.
 *
 *     node scripts/measure-speed.js                  — главная и страница услуги
 *     node scripts/measure-speed.js ru/index.html    — конкретные страницы
 *
 * Как это работает: запускается Chrome без окна, ему через протокол отладки
 * задаётся медленная сеть (400 Кбит/с, задержка 400 мс), после чего
 * замеряются два момента:
 *   FCP — на экране появился первый текст или картинка;
 *   LCP — отрисован самый крупный элемент экрана.
 *
 * Нужен установленный Google Chrome и запущенный локальный сервер:
 *     python3 -m http.server 8777
 */

"use strict";

const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");

const CHROME = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium"
].find(p => fs.existsSync(p));

const PORT = Number(process.env.PORT || 8777);
const BASE = `http://localhost:${PORT}/`;

/* 400 Кбит/с = 51200 байт/с, задержка 400 мс */
const NET = { downloadThroughput: 400 * 1024 / 8, uploadThroughput: 400 * 1024 / 8, latency: 400 };

const targets = process.argv.slice(2).filter(a => !a.startsWith("-"));
const PAGES = targets.length ? targets : ["index.html", "wizalar/is-wizasy.html"];

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function json(url, method = "GET") {
  const res = await fetch(url, { method });
  return res.json();
}

class CDP {
  constructor(ws) { this.ws = ws; this.id = 0; this.waiting = new Map(); this.handlers = []; }
  static async connect(wsUrl) {
    const ws = new WebSocket(wsUrl);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
    const cdp = new CDP(ws);
    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      if (msg.id && cdp.waiting.has(msg.id)) {
        cdp.waiting.get(msg.id)(msg.result);
        cdp.waiting.delete(msg.id);
      } else if (msg.method) {
        for (const h of cdp.handlers) h(msg);
      }
    };
    return cdp;
  }
  send(method, params = {}) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise(res => this.waiting.set(id, res));
  }
  on(fn) { this.handlers.push(fn); }
  close() { this.ws.close(); }
}

/* Считаем метрики внутри самой страницы через Performance API —
   это надёжнее, чем ловить события протокола: они приходят не для каждой
   навигации подряд. */
const LCP_WATCHER = `
  window.__lcp = 0;
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) window.__lcp = e.startTime;
    }).observe({ type: "largest-contentful-paint", buffered: true });
  } catch (e) {}
`;

function attach(cdp) {
  const state = { bytes: 0, requests: 0 };
  cdp.on((msg) => {
    if (msg.method === "Network.loadingFinished") state.bytes += msg.params.encodedDataLength || 0;
    if (msg.method === "Network.requestWillBeSent") state.requests++;
  });
  return state;
}

async function evaluate(cdp, expression) {
  const r = await cdp.send("Runtime.evaluate", { expression, returnByValue: true });
  return r && r.result ? r.result.value : null;
}

/* Каждый замер — в отдельной вкладке. В одной и той же вкладке Chrome
   сообщает о первой отрисовке только для первой страницы. */
async function measure(url) {
  const created = await json("http://localhost:9333/json/new?about:blank", "PUT");
  const cdp = await CDP.connect(created.webSocketDebuggerUrl);
  const state = attach(cdp);

  await cdp.send("Page.enable");
  await cdp.send("Network.enable");
  await cdp.send("Runtime.enable");
  await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: LCP_WATCHER });
  await cdp.send("Network.clearBrowserCache");
  await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
  await cdp.send("Network.emulateNetworkConditions", { offline: false, ...NET });

  await cdp.send("Page.navigate", { url });

  /* ждём полной загрузки, но не дольше 30 секунд */
  const started = Date.now();
  let ready = null;
  while (Date.now() - started < 30000) {
    await sleep(250);
    ready = await evaluate(cdp, "document.readyState");
    if (ready === "complete") break;
  }
  await sleep(700);   /* даём досчитаться самому крупному элементу */

  const raw = await evaluate(cdp, `JSON.stringify((() => {
    const nav = performance.getEntriesByType("navigation")[0] || {};
    const paint = performance.getEntriesByName("first-contentful-paint")[0];
    return {
      fcp: paint ? paint.startTime : null,
      lcp: window.__lcp || null,
      dcl: nav.domContentLoadedEventEnd || null,
      load: nav.loadEventEnd || null
    };
  })())`);

  const m = raw ? JSON.parse(raw) : {};
  cdp.close();
  try { await fetch(`http://localhost:9333/json/close/${created.id}`); } catch {}
  return {
    fcp: m.fcp || null,
    lcp: m.lcp || null,
    dcl: m.dcl || null,
    load: m.load || null,
    bytes: state.bytes,
    requests: state.requests
  };
}

async function main() {
  if (!CHROME) { console.error("Не найден Google Chrome."); process.exit(1); }
  try { await fetch(BASE); } catch {
    console.error(`Не отвечает ${BASE}\nЗапустите в другом окне: python3 -m http.server ${PORT}`);
    process.exit(1);
  }

  const userDir = fs.mkdtempSync(path.join(require("os").tmpdir(), "chrome-measure-"));
  const chrome = spawn(CHROME, [
    "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
    "--remote-debugging-port=9333", `--user-data-dir=${userDir}`,
    "--window-size=1280,900", "about:blank"
  ], { stdio: "ignore" });

  let version = null;
  for (let i = 0; i < 50 && !version; i++) {
    await sleep(200);
    try { version = await json("http://localhost:9333/json/version"); } catch {}
  }
  if (!version) { chrome.kill(); console.error("Chrome не запустился."); process.exit(1); }

  console.log(`Медленная сеть: 400 Кбит/с, задержка ${NET.latency} мс, кэш пустой\n`);
  console.log("страница".padEnd(30) + "FCP".padStart(9) + "LCP".padStart(9) +
              "загрузка".padStart(11) + "запросов".padStart(10) + "передано".padStart(11));
  console.log("-".repeat(80));

  const results = [];
  for (const p of PAGES) {
    /* Замер изредка срывается и не отдаёт время первой отрисовки —
       в этом случае просто повторяем. */
    let r = await measure(BASE + p);
    if (r.fcp === null) r = await measure(BASE + p);
    results.push([p, r]);
    const ms = (v) => v === null ? "—" : (v / 1000).toFixed(2) + " с";
    console.log(
      p.padEnd(30) +
      ms(r.fcp).padStart(9) + ms(r.lcp).padStart(9) + ms(r.load).padStart(11) +
      String(r.requests).padStart(10) + ((r.bytes / 1024).toFixed(0) + " КБ").padStart(11)
    );
  }

  const slow = results.filter(([, r]) => r.fcp !== null && r.fcp > 3000);
  console.log("");
  if (slow.length) {
    console.log(`⚠  Дольше 3 секунд до первого текста: ${slow.map(([p]) => p).join(", ")}`);
    process.exitCode = 1;
  } else {
    console.log("Первый текст на всех проверенных страницах появляется быстрее 3 секунд.");
  }

  chrome.kill();
  await sleep(500);
  try { fs.rmSync(userDir, { recursive: true, force: true }); } catch { /* временная папка удалится сама */ }
}

main();
