/* ==========================================================================
   admin.js — панель требований.

   Три экрана: вход, список пар, редактор одной пары. Плюс предпросмотр
   во всю ширину поверх всего.

   Главный принцип редактора: на экране один язык за раз. Три языка
   сразу — это форма втрое длиннее и путаница, в каком поле что.
   Какие языки ещё не заполнены, видно строкой над формой.

   Ничего из этого файла публичный сайт не загружает.
   ========================================================================== */

(function () {
  "use strict";

  /* Языки САЙТА: на них заполняется содержимое страниц. Турецкого тут
     нет и быть не должно — сайт на трёх языках. */
  var LANGS = [
    { key: "tk", name: "Türkmen" },
    { key: "ru", name: "Русский" },
    { key: "en", name: "English" }
  ];

  /* Языки ПАНЕЛИ: на них специалист видит кнопки и подсказки.
     Это другой список и другая задача. */
  var UI_LANGS = ["ru", "tk", "tr"];
  var TODO_MARK = "УТОЧНИТЬ:";

  var DICT = window.VW_I18N || {};
  var uiLang = "ru";

  function t(key) {
    var row = DICT[key];
    if (!row) return key;
    return row[uiLang] || row.ru || key;
  }

  /* Выбор языка помнится в этом браузере у этого человека */
  function loadUiLang(who) {
    try {
      var saved = localStorage.getItem("vw-ui-lang:" + (who || ""));
      if (saved && UI_LANGS.indexOf(saved) !== -1) uiLang = saved;
    } catch (e) { /* хранилище закрыто — останется русский */ }
  }
  function saveUiLang(who) {
    try { localStorage.setItem("vw-ui-lang:" + (who || ""), uiLang); } catch (e) {}
  }

  /* Подписи, написанные прямо в разметке */
  function applyStatic() {
    [].forEach.call(document.querySelectorAll("[data-t]"), function (n) {
      n.textContent = t(n.dataset.t);
    });
    [].forEach.call(document.querySelectorAll("[data-t-ph]"), function (n) {
      n.placeholder = t(n.dataset.tPh);
    });
    [].forEach.call(document.querySelectorAll("[data-uilang]"), function (sel) {
      sel.value = uiLang;
    });
    document.documentElement.lang = uiLang === "tk" ? "tk" : uiLang === "tr" ? "tr" : "ru";
  }

  /* Какие поля бывают и как они устроены. Подписи и подсказки лежат
     в admin/i18n.js: их три набора, по одному на язык панели. */
  var FIELD = {
    summary:          { big: true },
    audience:         { list: true },
    documents:        { docs: true },
    where:            { big: true },
    prepDays:         {},
    reviewDays:       {},
    fee:              {},
    recognition:      { big: true },
    admissionDates:   { big: true },
    language:         { big: true },
    tuition:          {},
    scholarships:     { big: true },
    notes:            { list: true },
    refusals:         { list: true },
    checkedOn:        { date: true, one: true },
    checkedBy:        { plain: true, one: true },
    feeCheckedOn:     { date: true, one: true },
    tuitionCheckedOn: { date: true, one: true }
  };

  function fieldTitle(key) { return t("f." + key + ".title"); }
  function fieldHint(key) { return t("f." + key + ".hint"); }

  var PARTS = {
    visa: [
      { id: "about", tk: "pAbout", fields: ["summary", "audience"] },
      { id: "docs", tk: "pDocs", fields: ["documents"] },
      { id: "terms", tk: "pTerms", fields: ["where", "prepDays", "reviewDays", "fee", "feeCheckedOn"] },
      { id: "extra", tk: "pExtra", fields: ["notes", "refusals"] },
      { id: "check", tk: "pCheck", fields: ["checkedOn", "checkedBy"] }
    ],
    education: [
      { id: "about", tk: "pAboutEdu", fields: ["summary", "audience", "recognition"] },
      { id: "docs", tk: "pDocs", fields: ["documents"] },
      { id: "terms", tk: "pTermsEdu", fields: ["admissionDates", "language", "tuition", "tuitionCheckedOn", "scholarships"] },
      { id: "extra", tk: "pExtra", fields: ["notes", "refusals"] },
      { id: "check", tk: "pCheck", fields: ["checkedOn", "checkedBy"] }
    ]
  };

  var state = {
    csrf: "", me: null, rows: [], counts: {}, filter: "all", search: "",
    entry: null, meta: null, lang: "tk", dirty: false, savedAt: null,
    issues: [], previewLang: "tk", previewSize: "wide", openPart: "about"
  };

  var $ = function (id) { return document.getElementById(id); };

  /* --------------------------------------------------------------- */
  /* Обращения к серверу                                              */
  /* --------------------------------------------------------------- */

  function api(path, options) {
    options = options || {};
    var headers = { "Content-Type": "application/json" };
    if (state.csrf) headers["X-CSRF-Token"] = state.csrf;
    return fetch("/api/admin/" + path, {
      method: options.method || "GET",
      headers: headers,
      credentials: "same-origin",
      body: options.body ? JSON.stringify(options.body) : undefined
    }).then(function (res) {
      /* 401 от самого входа — это «почта или пароль неверны», а не
         «сессия кончилась». Если не различать, человек при опечатке
         видел бы сообщение не о том. */
      if (res.status === 401 && path !== "login") {
        showLogin(options.quiet401 ? "" : t("sessionOver"));
        throw new Error("нет входа");
      }
      return res.json().then(function (data) {
        if (!res.ok) { var e = new Error(data.error || "Ошибка"); e.data = data; throw e; }
        return data;
      });
    });
  }

  /* --------------------------------------------------------------- */
  /* Экраны                                                           */
  /* --------------------------------------------------------------- */

  function show(which) {
    ["login", "list", "edit"].forEach(function (name) {
      $("screen-" + name).hidden = name !== which;
    });
    $("issuebar").hidden = which !== "edit";
    window.scrollTo(0, 0);
  }

  function showLogin(message) {
    state.csrf = ""; state.me = null; state.entry = null;
    show("login");
    setAlert("login-error", message || "");
    var f = $("in-email");
    if (f && !f.value) f.focus();
  }

  function setAlert(id, message) {
    var el = $(id);
    el.textContent = message || "";
    el.hidden = !message;
  }

  /* --------------------------------------------------------------- */
  /* Вход                                                             */
  /* --------------------------------------------------------------- */

  $("form-login").addEventListener("submit", function (e) {
    e.preventDefault();
    setAlert("login-error", "");
    var btn = $("btn-login");
    btn.disabled = true;
    btn.textContent = t("signingIn");
    api("login", { method: "POST", body: { email: $("in-email").value, password: $("in-password").value } })
      .then(function (data) {
        state.csrf = data.csrf;
        state.me = data.user;
        $("in-password").value = "";
        return loadList();
      })
      .catch(function (err) {
        setAlert("login-error", err.message || t("cantSignIn"));
        $("in-password").value = "";
        $("in-password").focus();
      })
      .finally(function () { btn.disabled = false; btn.textContent = t("signIn"); });
  });

  function logout() {
    api("logout", { method: "POST" }).catch(function () {}).finally(function () {
      showLogin(t("signedOut"));
    });
  }
  $("btn-logout").addEventListener("click", logout);
  $("btn-logout-2").addEventListener("click", logout);

  /* --------------------------------------------------------------- */
  /* Список записей                                                   */
  /* --------------------------------------------------------------- */

  function loadList() {
    return api("records").then(function (data) {
      state.rows = data.list;
      $("who").textContent = state.me
        ? state.me.email + " · " + t(state.me.role === "owner" ? "owner" : "editor")
        : "";
      state.counts = data.counts;
      state.siteBase = data.siteBase || "";
      renderCounts();
      renderPublishButton();
      renderList();
      renderPath();
      show("list");
    }).catch(function (err) {
      if (err.message !== "нет входа") setAlert("list-error", err.message);
    });
  }

  function matches(row) {
    if (state.filter === "draft" && row.state !== "draft") return false;
    if (state.filter === "verified" && row.state !== "verified") return false;
    if (state.filter === "published" && row.state !== "published" && row.state !== "changed") return false;
    if (state.filter === "stale" && !row.stale) return false;
    if (!state.search) return true;
    var hay = (row.countryName + " " + row.visaName + " " + row.visa + " " + row.country).toLowerCase();
    return hay.indexOf(state.search) !== -1;
  }

  function renderList() {
    var box = $("list");
    box.textContent = "";
    var shown = state.rows.filter(matches);
    $("list-empty").hidden = shown.length > 0;

    shown.forEach(function (row) {
      /* Строка — не кнопка, а рамка вокруг кнопки: у опубликованных
         записей рядом стоит ссылка на живую страницу, а ссылку внутрь
         кнопки класть нельзя. */
      var строка = el("div", "row row--" + row.state);

      var b = el("button", "row__open");
      b.type = "button";
      var имя = el("span", "row__name");
      имя.appendChild(значок(row.state));
      имя.appendChild(document.createTextNode(row.countryName + " — " + row.visaName.toLowerCase()));
      b.appendChild(имя);
      b.appendChild(el("span", "row__meta", row.checkedOn
        ? t("checkedOnShort") + " " + row.checkedOn + (row.checkedBy ? " · " + row.checkedBy : "")
        : t("neverChecked")));
      b.addEventListener("click", function () { openEditor(row.visa, row.country); });
      строка.appendChild(b);

      var tags = el("span", "row__tags");
      tags.appendChild(tag(stateName(row.state), row.state));
      if (row.stale) tags.appendChild(tag(t("cStale"), "stale"));
      if (row.blockers) tags.appendChild(tag(t("partIssues") + " " + row.blockers, "todo"));

      if ((row.state === "published" || row.state === "changed") && row.liveUrl) {
        var a = document.createElement("a");
        a.className = "row__live";
        a.href = (state.siteBase || "") + row.liveUrl;
        a.target = "_blank";
        a.rel = "noopener";
        a.textContent = t("openLive") + " ↗";
        a.title = t("openOnSite");
        tags.appendChild(a);
      }
      строка.appendChild(tags);
      box.appendChild(строка);
    });
  }

  /* Кружок цвета этапа перед названием: состояние видно, не читая подпись. */
  function значок(st) {
    var n = el("span", "dot dot--" + st);
    n.setAttribute("role", "img");
    n.setAttribute("aria-label", t("stateOf") + ": " + stateName(st));
    n.title = stateName(st);
    return n;
  }

  /* --------------------------------------------------------------- */
  /* Этап записи: где она сейчас и что это значит                     */
  /* --------------------------------------------------------------- */

  var STATE_KEY = { draft: "stDraft", verified: "stVerified", published: "stPublished", changed: "stChanged" };
  var STATE_WHAT = { draft: "expDraft", verified: "expVerified", published: "expPublished", changed: "expChanged" };

  function stateName(st) { return t(STATE_KEY[st] || "stDraft"); }
  function stateWhat(st) { return t(STATE_WHAT[st] || "expDraft"); }

  function renderCounts() {
    var c = state.counts || {};
    var box = $("counts");
    box.textContent = "";
    [[t("cDrafts"), c.draft], [t("cVerified"), c.verified],
     [t("cPublished"), c.published], [t("cStale"), c.stale]].forEach(function (pair, i) {
      if (i) box.appendChild(document.createTextNode(" · "));
      box.appendChild(document.createTextNode(pair[0] + " "));
      box.appendChild(el("b", "", String(pair[1] || 0)));
    });
    if (c.changed) {
      box.appendChild(document.createTextNode(" · "));
      box.appendChild(document.createTextNode(t("stChanged") + " "));
      box.appendChild(el("b", "", String(c.changed)));
    }
  }

  /* Полоса состояния в редакторе: где запись сейчас, увидит ли её клиент
     и по какому адресу. Адрес показываем и у черновика — приглушённо, как
     будущий: так видно, что именно создаётся. Он зависит от языка, который
     специалист сейчас заполняет, поэтому полоса перерисовывается вместе с
     формой при переключении языка. */
  function renderStage() {
    var st = records_state();
    $("stage").className = "stage stage--" + st;
    $("stage-name").textContent = stateName(st);
    $("stage-what").textContent = stateWhat(st);

    var где = $("stage-where");
    var адрес = адресСтраницы();
    где.textContent = "";
    if (!адрес) { где.hidden = true; return; }

    var живая = st === "published" || st === "changed";
    где.className = "stage__where" + (живая ? "" : " stage__where--future");
    где.appendChild(document.createTextNode(t(живая ? "liveAddress" : "willBeAt") + " "));

    if (живая) {
      var a = document.createElement("a");
      a.href = адрес;
      a.target = "_blank";
      a.rel = "noopener";
      a.textContent = короткийАдрес(адрес);
      a.title = t("openOnSite");
      где.appendChild(a);
      где.appendChild(document.createTextNode(" ↗"));
    } else {
      где.appendChild(el("span", "stage__url", короткийАдрес(адрес)));
    }
    где.hidden = false;
  }

  /* Адрес страницы на том языке, который сейчас открыт в форме. */
  function адресСтраницы() {
    var m = state.meta;
    if (!m) return "";
    return (m.liveUrls && m.liveUrls[state.lang]) || m.liveUrl || "";
  }

  /* Без «https://» адрес читается как адрес, а не как строка кода. */
  function короткийАдрес(url) { return String(url).replace(/^https?:\/\//, ""); }

  /* Тот же расчёт, что на сервере: иначе после сохранения карточка
     показывала бы старый этап до перезагрузки списка. */
  function records_state() {
    var e = state.entry;
    if (!e || e.status !== "verified") return "draft";
    if (!e.publishedAt) return "verified";
    if (e.updatedAt && e.updatedAt > e.publishedAt) return "changed";
    return "published";
  }

  function el(name, cls, text) {
    var n = document.createElement(name);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }
  function tag(text, kind) { return el("span", "tag tag--" + kind, text); }

  $("filters").addEventListener("click", function (e) {
    var btn = e.target.closest("[data-filter]");
    if (!btn) return;
    state.filter = btn.dataset.filter;
    [].forEach.call(this.querySelectorAll(".chip"), function (c) { c.classList.toggle("is-on", c === btn); });
    renderList();
  });

  $("search").addEventListener("input", function () {
    state.search = this.value.trim().toLowerCase();
    renderList();
  });

  $("btn-back").addEventListener("click", function () {
    if (!confirmLeave()) return;
    state.entry = null;
    loadList();
  });

  /* Уходить с незаполненным языком можно, но молча — нельзя:
     пустой язык на сайте выглядит как забытая страница. */
  function confirmLeave() {
    var gaps = languageGaps();
    var empty = LANGS.filter(function (l) { return gaps[l.key] > 0; });
    if (state.dirty) {
      if (!window.confirm(t("leaveUnsaved"))) return false;
    }
    if (!empty.length) return true;
    return window.confirm(
      t("leaveGaps") + " " + empty.map(function (l) { return l.name + " (" + gaps[l.key] + ")"; }).join(", ") +
      ".\n\n" + t("leaveAnyway"));
  }

  /* --------------------------------------------------------------- */
  /* Редактор                                                         */
  /* --------------------------------------------------------------- */

  function openEditor(visa, country) {
    api("record?visa=" + encodeURIComponent(visa) + "&country=" + encodeURIComponent(country))
      .then(function (data) {
        state.entry = data.entry;
        state.meta = data;
        state.meta.liveUrl = data.liveUrl || "";
        state.dirty = false;
        state.savedAt = null;
        state.openPart = "about";
        $("edit-title").textContent = data.country.country.ru + " — " + data.visaName.ru.toLowerCase();
        $("edit-sub").textContent = t(data.kind === "education" ? "eduType" : "visaType");
        setAlert("edit-error", "");
        renderEditor();
        setIssues(data.blockers);
        show("edit");
        showSaved();
      })
      .catch(function (err) {
        if (err.message !== "нет входа") setAlert("list-error", err.message);
      });
  }

  function parts() { return PARTS[state.meta.kind]; }
  function required() { return state.meta.fields.required; }

  /* Обязательные поля — выше необязательных внутри своей части */
  function orderedFields(part) {
    var req = required();
    return part.fields.slice().sort(function (a, b) {
      return (req.indexOf(b) !== -1) - (req.indexOf(a) !== -1);
    });
  }

  function renderEditor() {
    var box = $("fields");
    box.textContent = "";
    parts().forEach(function (part) {
      var wrap = document.createElement("details");
      wrap.className = "part";
      wrap.id = "part-" + part.id;
      wrap.open = part.id === state.openPart;

      var head = document.createElement("summary");
      head.className = "part__head";
      head.appendChild(el("span", "part__sign", "›"));
      head.appendChild(el("span", "grow", t(part.tk)));
      var mark = el("span", "part__mark");
      mark.dataset.part = part.id;
      head.appendChild(mark);
      wrap.appendChild(head);

      var body = el("div", "part__body");
      orderedFields(part).forEach(function (key) {
        if (!FIELD[key]) return;
        body.appendChild(fieldGroup(key));
      });
      wrap.appendChild(body);
      wrap.addEventListener("toggle", function () { if (wrap.open) state.openPart = part.id; markParts(); });
      box.appendChild(wrap);
    });
    renderToc();
    markParts();
    renderLangFill();
  }

  function renderToc() {
    var ul = $("toc");
    ul.textContent = "";
    parts().forEach(function (part) {
      var li = document.createElement("li");
      var b = el("button", state.openPart === part.id ? "is-on" : "");
      b.type = "button";
      b.appendChild(el("span", "", t(part.tk)));
      var c = el("span", "toc__count");
      c.dataset.toc = part.id;
      b.appendChild(c);
      b.addEventListener("click", function () { openPart(part.id); });
      li.appendChild(b);
      ul.appendChild(li);
    });
  }

  function openPart(id) {
    var node = $("part-" + id);
    if (!node) return;
    node.open = true;
    state.openPart = id;
    node.scrollIntoView({ behavior: "smooth", block: "start" });
    [].forEach.call($("toc").querySelectorAll("button"), function (b, i) {
      b.classList.toggle("is-on", parts()[i].id === id);
    });
  }

  /* Сколько замечаний в каждой части — цифра рядом с заголовком
     и в оглавлении, чтобы не открывать всё подряд в поисках. */
  function markParts() {
    var byField = {};
    state.issues.forEach(function (b) { byField[b.field] = (byField[b.field] || 0) + 1; });
    parts().forEach(function (part) {
      var n = 0;
      part.fields.forEach(function (f) { n += byField[f] || 0; });
      var mark = document.querySelector('[data-part="' + part.id + '"]');
      if (mark) mark.textContent = n ? t("partIssues") + " " + n : "";
      var toc = document.querySelector('[data-toc="' + part.id + '"]');
      if (toc) {
        toc.textContent = n ? String(n) : "";
        toc.parentNode.classList.toggle("is-on", part.id === state.openPart);
      }
    });
  }

  /* --------------------------------------------------------------- */
  /* Поля                                                             */
  /* --------------------------------------------------------------- */

  function fieldGroup(key) {
    var spec = FIELD[key];
    var group = el("div", "group");
    group.dataset.field = key;

    var title = el("label", "group__title");
    title.appendChild(document.createTextNode(fieldTitle(key)));
    if (required().indexOf(key) !== -1 || key === "checkedOn") {
      title.appendChild(el("span", "req", " " + t("required")));
    }
    group.appendChild(title);
    group.appendChild(el("p", "group__hint", fieldHint(key)));

    if (spec.list) group.appendChild(listEditor(key));
    else if (spec.docs) group.appendChild(documentsEditor());
    else if (spec.date) group.appendChild(simpleInput(key, "date"));
    else if (spec.plain) group.appendChild(simpleInput(key, "text"));
    else group.appendChild(textField(key, spec.big));

    return group;
  }

  /* Поле на одном языке — том, что сейчас выбран наверху.

     Если в значении сидит вопрос от разработчика, в поле его не
     показываем: вопрос стоит жёлтой полосой над ним, а поле остаётся
     пустым и готовым принять ответ. В данных вопрос при этом остаётся —
     пока человек не написал ответ, запись не должна становиться
     готовой к публикации. Значение переписывается только когда в поле
     действительно что-то набрали. */
  function textField(key, big) {
    var wrap = el("div");
    var stored = (state.entry[key] && state.entry[key][state.lang]) || "";
    var ask = askStrip(stored, function () {
      LANGS.forEach(function (l) {
        var v = (state.entry[key] && state.entry[key][l.key]) || "";
        state.entry[key][l.key] = stripAsk(v);
      });
      renderEditor();
      focusField(key);
    });
    if (ask) { wrap.className = "has-ask"; wrap.appendChild(ask); }

    var ta = document.createElement("textarea");
    ta.value = ask ? stripAsk(stored) : stored;
    ta.rows = big ? 6 : 5;
    if (ask) ta.placeholder = t("answerHere");
    ta.addEventListener("input", function () {
      state.entry[key] = state.entry[key] || {};
      state.entry[key][state.lang] = ta.value;
      grow(ta);
      touched();
    });
    wrap.appendChild(ta);
    setTimeout(function () { grow(ta); }, 0);
    return wrap;
  }

  function simpleInput(key, type) {
    var input = document.createElement("input");
    input.type = type;
    input.value = state.entry[key] || "";
    input.addEventListener("input", function () { state.entry[key] = input.value; touched(); });
    input.addEventListener("change", function () { state.entry[key] = input.value; touched(); });
    return input;
  }

  /* Поле растёт по содержимому: внутренняя прокрутка в длинном абзаце
     означает, что конец текста не виден и легко теряется. */
  function grow(ta) {
    ta.style.height = "auto";
    ta.style.height = Math.max(ta.scrollHeight, 120) + "px";
  }

  function stripAsk(text) {
    return String(text || "").replace(/УТОЧНИТЬ:[^\n]*/g, "").trim();
  }

  function askText(value) {
    var m = String(value || "").match(/УТОЧНИТЬ:\s*([^\n]*)/);
    return m ? m[1].trim() : null;
  }

  /* Жёлтая полоска с вопросом от разработчика */
  function askStrip(value, onRemove) {
    var question = askText(value);
    if (!question) return null;
    var box = el("div", "ask");
    var text = el("div", "ask__text");
    text.appendChild(el("b", "", t("devQuestion")));
    text.appendChild(document.createTextNode(question));
    box.appendChild(text);
    var btn = el("button", "", t("removeQuestion"));
    btn.type = "button";
    btn.addEventListener("click", function () { onRemove(); touched(); });
    box.appendChild(btn);
    return box;
  }

  /* --------------------------------------------------------------- */
  /* Списки пунктов                                                   */
  /* --------------------------------------------------------------- */

  function listEditor(key) {
    state.entry[key] = state.entry[key] || [];
    var box = el("div", "items");
    var data = state.entry[key];

    function redraw() {
      box.textContent = "";
      data.forEach(function (item, index) {
        var value = item[state.lang] || "";
        var ask = askStrip(value, function () {
          LANGS.forEach(function (l) { item[l.key] = stripAsk(item[l.key]); });
          redraw(); touched();
        });
        if (ask) box.appendChild(ask);
        box.appendChild(itemRow({
          index: index,
          value: ask ? stripAsk(value) : value,
          placeholder: ask ? t("answerHere") : "",
          hasAsk: !!ask,
          onInput: function (v) { item[state.lang] = v; touched(); },
          onEnter: function () {
            var blank = { tk: "", ru: "", en: "" };
            data.splice(index + 1, 0, blank);
            redraw(); touched();
            focusItem(box, index + 1);
          },
          onDelete: function () { data.splice(index, 1); redraw(); touched(); }
        }));
      });
      box.appendChild(addButton(t("addItem"), function () {
        data.push({ tk: "", ru: "", en: "" });
        redraw(); touched();
        focusItem(box, data.length - 1);
      }));
      enableDrag(box, data, redraw);
    }
    redraw();
    return box;
  }

  function documentsEditor() {
    state.entry.documents = state.entry.documents || [];
    var box = el("div", "items");
    var data = state.entry.documents;

    function redraw() {
      box.textContent = "";
      data.forEach(function (doc, index) {
        doc.text = doc.text || { tk: "", ru: "", en: "" };
        doc.note = doc.note || { tk: "", ru: "", en: "" };

        var row = itemRow({
          index: index,
          value: doc.text[state.lang] || "",
          onInput: function (v) { doc.text[state.lang] = v; touched(); },
          onEnter: function () {
            data.splice(index + 1, 0, { required: true, text: { tk: "", ru: "", en: "" }, note: { tk: "", ru: "", en: "" } });
            redraw(); touched(); focusItem(box, index + 1);
          },
          onDelete: function () { data.splice(index, 1); redraw(); touched(); }
        });

        var extra = el("div", "item__extra");
        var check = el("label", "item__check");
        var cb = document.createElement("input");
        cb.type = "checkbox";
        cb.checked = doc.required !== false;
        cb.addEventListener("change", function () { doc.required = cb.checked; touched(); });
        check.appendChild(cb);
        check.appendChild(document.createTextNode(t("alwaysNeeded")));
        extra.appendChild(check);

        var note = el("div", "item__note");
        var ni = document.createElement("input");
        ni.type = "text";
        ni.placeholder = t("notePh");
        ni.value = doc.note[state.lang] || "";
        ni.addEventListener("input", function () { doc.note[state.lang] = ni.value; touched(); });
        note.appendChild(ni);
        extra.appendChild(note);

        row.appendChild(extra);
        box.appendChild(row);
      });
      box.appendChild(addButton(t("addDoc"), function () {
        data.push({ required: true, text: { tk: "", ru: "", en: "" }, note: { tk: "", ru: "", en: "" } });
        redraw(); touched(); focusItem(box, data.length - 1);
      }));
      enableDrag(box, data, redraw);
    }
    redraw();
    return box;
  }

  /* Одна строка списка: слева ручка, посередине текст, справа крестик */
  function itemRow(opts) {
    var row = el("div", "item" + (opts.hasAsk ? " has-ask" : ""));
    row.dataset.index = String(opts.index);

    var grip = el("button", "item__grip", "⠿");
    grip.type = "button";
    grip.title = t("dragHint");
    grip.setAttribute("aria-label", t("dragHint"));
    row.appendChild(grip);

    var input = document.createElement("input");
    input.type = "text";
    input.value = opts.value;
    if (opts.placeholder) input.placeholder = opts.placeholder;
    input.addEventListener("input", function () { opts.onInput(input.value); });
    input.addEventListener("keydown", function (e) {
      if (e.key === "Enter") { e.preventDefault(); opts.onEnter(); }
    });
    row.appendChild(input);

    var del = el("button", "item__del", "✕");
    del.type = "button";
    del.title = t("removeItem");
    del.setAttribute("aria-label", t("removeItem"));
    del.addEventListener("click", opts.onDelete);
    row.appendChild(del);
    return row;
  }

  function focusItem(box, index) {
    var rows = box.querySelectorAll(".item");
    if (rows[index]) rows[index].querySelector('input[type="text"]').focus();
  }

  function addButton(text, onClick) {
    var b = el("button", "btn additem", "+ " + text);
    b.type = "button";
    b.addEventListener("click", onClick);
    return b;
  }

  /* Перетаскивание работает и мышью, и пальцем: события указателя
     одинаковы для того и другого, в отличие от встроенного
     перетаскивания, которого на телефоне просто нет. */
  function enableDrag(box, data, redraw) {
    var dragging = null;

    box.addEventListener("pointerdown", function (e) {
      var grip = e.target.closest(".item__grip");
      if (!grip) return;
      dragging = grip.closest(".item");
      dragging.classList.add("is-dragging");
      grip.setPointerCapture(e.pointerId);
      e.preventDefault();
    });

    box.addEventListener("pointermove", function (e) {
      if (!dragging) return;
      var rows = [].slice.call(box.querySelectorAll(".item"));
      for (var i = 0; i < rows.length; i++) {
        if (rows[i] === dragging) continue;
        var r = rows[i].getBoundingClientRect();
        if (e.clientY > r.top && e.clientY < r.bottom) {
          var after = e.clientY > r.top + r.height / 2;
          box.insertBefore(dragging, after ? rows[i].nextSibling : rows[i]);
          break;
        }
      }
    });

    function finish() {
      if (!dragging) return;
      dragging.classList.remove("is-dragging");
      dragging = null;
      var order = [].slice.call(box.querySelectorAll(".item")).map(function (n) { return Number(n.dataset.index); });
      var moved = order.map(function (i) { return data[i]; });
      data.length = 0;
      moved.forEach(function (x) { data.push(x); });
      redraw();
      touched();
    }
    box.addEventListener("pointerup", finish);
    box.addEventListener("pointercancel", finish);
  }

  /* --------------------------------------------------------------- */
  /* Языки                                                            */
  /* --------------------------------------------------------------- */

  /* Сколько мест в этом языке пусто при том, что в другом языке
     они заполнены. Ровно это и есть «пробел». */
  function languageGaps() {
    var gaps = { tk: 0, ru: 0, en: 0 };
    if (!state.entry) return gaps;
    var e = state.entry;

    function trio(obj) {
      if (!obj) return;
      var any = LANGS.some(function (l) { return String(obj[l.key] || "").trim(); });
      if (!any) return;
      LANGS.forEach(function (l) { if (!String(obj[l.key] || "").trim()) gaps[l.key]++; });
    }

    parts().forEach(function (part) {
      part.fields.forEach(function (key) {
        var spec = FIELD[key];
        if (!spec || spec.one) return;
        if (spec.list) (e[key] || []).forEach(trio);
        else if (spec.docs) (e.documents || []).forEach(function (d) { trio(d.text); });
        else trio(e[key]);
      });
    });
    return gaps;
  }

  function renderLangFill() {
    var gaps = languageGaps();
    var box = $("lang-fill");
    box.textContent = "";
    LANGS.forEach(function (l, i) {
      if (i) box.appendChild(document.createTextNode(" · "));
      box.appendChild(document.createTextNode(l.name + " "));
      if (gaps[l.key]) box.appendChild(el("i", "", t("notFilled") + " " + gaps[l.key]));
      else box.appendChild(el("b", "", "✓"));
    });
  }

  $("lang-switch").addEventListener("click", function (e) {
    var btn = e.target.closest("[data-lang]");
    if (!btn) return;
    state.lang = btn.dataset.lang;
    [].forEach.call(this.querySelectorAll(".chip"), function (c) { c.classList.toggle("is-on", c === btn); });
    renderEditor();
    /* Адрес страницы у каждого языка свой — полоса состояния должна
       показать адрес того языка, который открыт сейчас. */
    renderStage();
  });

  /* --------------------------------------------------------------- */
  /* Сохранение                                                       */
  /* --------------------------------------------------------------- */

  function touched() {
    state.dirty = true;
    showSaved();
    renderLangFill();
  }

  function showSaved() {
    var box = $("saved-state");
    box.classList.toggle("is-dirty", state.dirty);
    if (state.dirty) { box.textContent = t("unsaved"); return; }
    box.textContent = state.savedAt ? t("savedAt") + " " + state.savedAt : "";
  }

  /* Сообщение после сохранения. Сказать «сохранено» мало: человек правит
     текст и хочет знать, увидит ли это клиент. Поэтому в каждом состоянии
     своя фраза, и в ней сразу написано, что делать дальше. */
  var СООБЩЕНИЕ = { draft: "savedDraft", verified: "savedVerified",
                    published: "savedLive", changed: "savedLive" };
  var тостТаймер = null;

  function сказать(st) {
    var box = $("toast");
    box.className = "toast toast--" + st;
    box.textContent = t(СООБЩЕНИЕ[st] || "savedDraft");
    box.hidden = false;
    clearTimeout(тостТаймер);
    тостТаймер = setTimeout(function () { box.hidden = true; }, 7000);
  }

  function timeNow() {
    var d = new Date();
    return String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
  }

  function payload(extra) {
    var e = state.entry;
    var out = { documents: e.documents, checkedOn: e.checkedOn || "", checkedBy: e.checkedBy || "" };
    parts().forEach(function (part) {
      part.fields.forEach(function (key) {
        if (key === "documents" || key === "checkedOn" || key === "checkedBy") return;
        out[key] = e[key];
      });
    });
    return Object.assign(out, extra || {});
  }

  function save(extra, silent) {
    setAlert("edit-error", "");
    var visa = state.entry.visa, country = state.entry.country;
    return api("record?visa=" + encodeURIComponent(visa) + "&country=" + encodeURIComponent(country),
               { method: "PUT", body: payload(extra) })
      .then(function (data) {
        state.entry = data.entry;
        state.dirty = false;
        state.savedAt = timeNow();
        setIssues(data.blockers);
        showSaved();
        if (!silent) { renderEditor(); сказать(records_state()); }
      })
      .catch(function (err) {
        if (err.message === "нет входа") return;
        setAlert("edit-error", err.message);
        if (err.data && err.data.blockers) setIssues(err.data.blockers);
      });
  }

  $("btn-save").addEventListener("click", function () { save(); });
  $("btn-verify").addEventListener("click", function () { save({ status: "verified" }); });
  $("btn-draft").addEventListener("click", function () { save({ status: "draft" }); });

  /* Черновик сохраняется сам раз в полминуты: правка текста — долгая
     работа, и терять её из-за закрытой вкладки нельзя. */
  setInterval(function () {
    if (state.entry && state.dirty) save(null, true);
  }, 30000);

  window.addEventListener("beforeunload", function (e) {
    if (state.dirty) { e.preventDefault(); e.returnValue = ""; }
  });

  /* --------------------------------------------------------------- */
  /* Полоса замечаний                                                 */
  /* --------------------------------------------------------------- */

  function setIssues(list) {
    state.issues = (list || []).map(function (b) {
      return typeof b === "string" ? { field: "", text: b } : b;
    });
    var bar = $("issuebar");
    var n = state.issues.length;
    bar.classList.toggle("is-ready", n === 0);
    $("issues-summary").textContent = n
      ? t("notReady") + ": " + n + " " + t("issuesN")
      : t("readyToPublish");
    /* Кнопку не прячем, а делаем недоступной: спрятанная кнопка выглядит
       так, будто такой возможности нет вовсе, и человек её ищет. */
    var verify = $("btn-verify");
    verify.hidden = !!(state.entry && state.entry.status === "verified");
    verify.disabled = n > 0;
    verify.title = n > 0 ? t("closeFirst") : "";
    $("btn-draft").hidden = !(state.entry && state.entry.status === "verified");

    var ul = $("issues-list");
    ul.textContent = "";
    state.issues.forEach(function (issue) {
      var li = document.createElement("li");
      var b = el("button", "", issue.text);
      b.type = "button";
      b.addEventListener("click", function () { focusField(issue.field); });
      li.appendChild(b);
      ul.appendChild(li);
    });
    if (!n) { ul.hidden = true; bar.classList.remove("is-open"); $("issues-toggle").setAttribute("aria-expanded", "false"); }
    markParts();
    renderStage();
  }

  function plural(n, one, few, many) {
    var a = Math.abs(n) % 100, b = a % 10;
    if (a > 10 && a < 20) return many;
    if (b > 1 && b < 5) return few;
    if (b === 1) return one;
    return many;
  }

  $("issues-toggle").addEventListener("click", function () {
    if (!state.issues.length) return;
    var ul = $("issues-list");
    ul.hidden = !ul.hidden;
    $("issuebar").classList.toggle("is-open", !ul.hidden);
    this.setAttribute("aria-expanded", String(!ul.hidden));
  });

  /* Прыжок к полю: открыть его часть, прокрутить, мигнуть рамкой */
  function focusField(key) {
    if (!key) return;
    var part = parts().filter(function (p) { return p.fields.indexOf(key) !== -1; })[0];
    if (part) { $("part-" + part.id).open = true; state.openPart = part.id; }
    var group = document.querySelector('[data-field="' + key + '"]');
    if (!group) return;
    group.scrollIntoView({ behavior: "smooth", block: "center" });
    group.classList.remove("is-target");
    void group.offsetWidth;
    group.classList.add("is-target");
    var input = group.querySelector("textarea, input");
    if (input) setTimeout(function () { input.focus({ preventScroll: true }); }, 350);
  }

  /* --------------------------------------------------------------- */
  /* Предпросмотр                                                     */
  /* --------------------------------------------------------------- */

  $("btn-preview").addEventListener("click", function () {
    state.previewLang = state.lang;
    [].forEach.call($("preview-langs").querySelectorAll(".chip"), function (c) {
      c.classList.toggle("is-on", c.dataset.lang === state.previewLang);
    });
    $("overlay").hidden = false;
    refreshPreview();
  });
  $("btn-close-preview").addEventListener("click", function () { $("overlay").hidden = true; });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && !$("overlay").hidden) $("overlay").hidden = true;
  });

  $("preview-langs").addEventListener("click", function (e) {
    var btn = e.target.closest("[data-lang]");
    if (!btn) return;
    state.previewLang = btn.dataset.lang;
    [].forEach.call(this.querySelectorAll(".chip"), function (c) { c.classList.toggle("is-on", c === btn); });
    refreshPreview();
  });

  $("preview-size").addEventListener("click", function (e) {
    var btn = e.target.closest("[data-size]");
    if (!btn) return;
    state.previewSize = btn.dataset.size;
    [].forEach.call(this.querySelectorAll(".chip"), function (c) { c.classList.toggle("is-on", c === btn); });
    $("overlay-frame").classList.toggle("is-phone", state.previewSize === "phone");
  });

  function refreshPreview() {
    if (!state.entry) return;
    api("preview", { method: "POST", body: { entry: state.entry, lang: state.previewLang } })
      .then(function (data) {
        if (data && data.id) $("preview").src = "/api/admin/preview?id=" + encodeURIComponent(data.id);
      })
      .catch(function () { /* предпросмотр не критичен: молча не обновляем */ });
  }

  /* --------------------------------------------------------------- */
  /* Публикация                                                       */
  /* --------------------------------------------------------------- */

  function renderPublishButton() {
    var n = (state.counts && state.counts.ждут) || 0;
    var b = $("btn-publish");
    b.textContent = n ? t("publish") + " · " + n : t("publish");
    b.disabled = !n;
    b.title = n ? "" : t("publishNothing");
  }

  function dialog(title, buildBody, goText, onGo) {
    $("pub-title").textContent = title;
    var body = $("pub-body");
    body.textContent = "";
    buildBody(body);
    var go = $("pub-go");
    go.hidden = !goText;
    go.textContent = goText || "";
    go.onclick = onGo || null;
    $("pub-overlay").hidden = false;
  }
  $("pub-close").addEventListener("click", function () { $("pub-overlay").hidden = true; });

  $("btn-publish").addEventListener("click", function () {
    var waiting = state.rows.filter(function (r) { return r.state === "verified" || r.state === "changed"; });
    dialog(t("publishWhat"), function (body) {
      var ul = el("ul", "dialog__list");
      waiting.forEach(function (r) {
        ul.appendChild(el("li", "", r.countryName + " — " + r.visaName.toLowerCase()));
      });
      body.appendChild(ul);
    }, t("publish"), startPublish);
  });

  function startPublish() {
    dialog(t("publishConfirm"), function (body) {
      body.appendChild(el("p", "", t("publishRunning")));
    }, "", null);

    api("publish", { method: "POST", body: {} })
      .then(function () { pollPublish(0); })
      .catch(function (err) {
        if (err.message === "нет входа") return;
        dialog(t("publishFailed"), function (body) {
          body.appendChild(el("p", "alert", err.message));
          var problems = err.data && err.data.problems;
          if (problems) {
            body.appendChild(el("p", "", t("publishBlocked")));
            var ul = el("ul", "dialog__list");
            problems.forEach(function (pr) {
              var li = document.createElement("li");
              li.appendChild(el("b", "", pr.title));
              var inner = el("ul");
              pr.issues.forEach(function (x) { inner.appendChild(el("li", "", x)); });
              li.appendChild(inner);
              ul.appendChild(li);
            });
            body.appendChild(ul);
          }
        }, "", null);
      });
  }

  /* Спрашиваем не у себя, а у живого сайта: страница отвечает —
     значит, действительно опубликована. */
  function pollPublish(tries) {
    api("publish").then(function (data) {
      var done = data.pages.length && data.pages.every(function (x) { return x.live; });
      dialog(done ? t("publishDone") : t("publishConfirm"), function (body) {
        if (!done) body.appendChild(el("p", "", t("publishRunning")));
        var ul = el("ul", "dialog__list");
        data.pages.forEach(function (pg) {
          var li = document.createElement("li");
          if (pg.live) {
            var a = document.createElement("a");
            a.href = pg.url; a.target = "_blank"; a.rel = "noopener";
            a.textContent = pg.title + " ↗";
            li.appendChild(a);
          } else {
            li.appendChild(document.createTextNode(pg.title + " — " + t("waitingPage") + "…"));
          }
          ul.appendChild(li);
        });
        body.appendChild(ul);
      }, "", null);

      if (done) { loadList(); return; }
      if (tries < 40) setTimeout(function () { pollPublish(tries + 1); }, 5000);
    }).catch(function () {});
  }

  /* --------------------------------------------------------------- */
  /* Объяснение пути текста на сайт                                   */
  /* --------------------------------------------------------------- */

  /* Три строки над списком: правка → проверено → опубликовано → на сайте.
     Сворачивается и запоминается: в первый день это нужно, через месяц
     только занимает место. */
  var ПУТЬ_КЛЮЧ = "vw-path-hidden";

  function путьСвёрнут() {
    try { return localStorage.getItem(ПУТЬ_КЛЮЧ) === "1"; } catch (e) { return false; }
  }

  function renderPath() {
    var свёрнут = путьСвёрнут();
    $("path-body").hidden = свёрнут;
    $("path").classList.toggle("is-folded", свёрнут);
    var кн = $("path-toggle");
    кн.textContent = t(свёрнут ? "pathShow" : "pathHide");
    кн.setAttribute("aria-expanded", свёрнут ? "false" : "true");
  }

  $("path-toggle").addEventListener("click", function () {
    try { localStorage.setItem(ПУТЬ_КЛЮЧ, путьСвёрнут() ? "0" : "1"); } catch (e) {}
    renderPath();
  });

  /* --------------------------------------------------------------- */
  /* Запуск                                                           */
  /* --------------------------------------------------------------- */

  /* Переключатель языка панели. Сохраняется у этого человека в этом
     браузере и применяется сразу, без перезагрузки. */
  [].forEach.call(document.querySelectorAll("[data-uilang]"), function (sel) {
    sel.addEventListener("change", function () {
      uiLang = sel.value;
      saveUiLang(state.me && state.me.email);
      applyStatic();
      renderCounts();
      renderPublishButton();
      renderList();
      renderPath();
      if (state.entry) { renderEditor(); setIssues(state.issues); }
      showSaved();
    });
  });

  loadUiLang("");
  applyStatic();
  renderPath();

  api("me", { quiet401: true }).then(function (me) {
    state.csrf = me.csrf;
    state.me = { email: me.email, role: me.role };
    loadUiLang(me.email);
    applyStatic();
    return loadList();
  }).catch(function () { showLogin(); });

})();
