/* ==========================================================================
   admin.js — панель требований.

   Три экрана: вход, список пар, редактор одной пары. Переключаются
   показом и скрытием, без перезагрузки страницы.

   Ничего из этого файла публичный сайт не загружает.
   ========================================================================== */

(function () {
  "use strict";

  var LANGS = [
    { key: "tk", name: "Туркменский" },
    { key: "ru", name: "Русский" },
    { key: "en", name: "Английский" }
  ];

  /* Подписи полей по-русски. Специалист не обязан знать, что поле
     в файле называется admissionDates. */
  var FIELD = {
    summary:        { title: "Краткое описание", hint: "Одним абзацем: что это за виза именно для этой страны." },
    where:          { title: "Куда подаётся", hint: "Консульство в Ашхабаде или в другой стране, нужна ли запись." },
    prepDays:       { title: "Срок подготовки документов у нас", hint: "" },
    reviewDays:     { title: "Срок рассмотрения консульством", hint: "" },
    fee:            { title: "Консульский сбор", hint: "Можно оставить пустым — встанет честная строка «по официальному тарифу». Если вписали сумму, поставьте дату её проверки." },
    recognition:    { title: "Признание диплома в Туркменистане", hint: "Для родителей это главный вопрос. На странице стоит отдельным заметным блоком." },
    admissionDates: { title: "Сроки поступления", hint: "Когда открывается и когда закрывается приём документов." },
    language:       { title: "Языковые требования", hint: "Какой экзамен и какой уровень." },
    tuition:        { title: "Примерная стоимость обучения", hint: "Можно оставить пустым. Если вписали сумму, поставьте дату её проверки." },
    scholarships:   { title: "Стипендии и квоты", hint: "Для граждан Туркменистана." },
    audience:       { title: "Кому подходит", hint: "По пунктам." },
    documents:      { title: "Документы", hint: "Отметьте, какие нужны всегда, а какие не всегда." },
    notes:          { title: "Особенности", hint: "" },
    refusals:       { title: "Частые причины отказа", hint: "" }
  };

  var ORDER = {
    visa: ["summary", "audience", "documents", "where", "prepDays", "reviewDays", "fee", "notes", "refusals"],
    education: ["summary", "audience", "documents", "recognition", "admissionDates", "language", "tuition", "scholarships", "notes", "refusals"]
  };
  var LIST_FIELDS = ["audience", "notes", "refusals"];

  var state = { csrf: "", me: null, rows: [], filter: "all", search: "", entry: null, meta: null,
                lang: "tk", size: "phone" };

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
      /* 401 от самого входа — это «почта, пароль или код неверны», а не
         «сессия кончилась». Если не различать, человек при опечатке
         видел бы сообщение не о том. */
      if (res.status === 401 && path !== "login") {
        /* quiet: при самой первой загрузке мы просто спрашиваем «а кто
           вошёл?». Ответ «никто» — это не «сессия закончилась», и писать
           так человеку, который ещё ни разу не входил, неправильно. */
        showLogin(options.quiet401 ? "" : "Сессия закончилась. Войдите заново.");
        throw new Error("нет входа");
      }
      var type = res.headers.get("content-type") || "";
      if (type.indexOf("text/html") !== -1) return res.text();
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
    window.scrollTo(0, 0);
  }

  function showLogin(message) {
    state.csrf = "";
    state.me = null;
    show("login");
    if (message) setAlert("login-error", message);
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
    btn.textContent = "Проверяем…";
    api("login", {
      method: "POST",
      body: { email: $("in-email").value, password: $("in-password").value, code: $("in-code").value }
    }).then(function (data) {
      state.csrf = data.csrf;
      state.me = data.user;
      $("in-password").value = "";
      $("in-code").value = "";
      return loadList();
    }).catch(function (err) {
      setAlert("login-error", err.message || "Не удалось войти.");
      $("in-code").value = "";
      $("in-code").focus();
    }).finally(function () {
      btn.disabled = false;
      btn.textContent = "Войти";
    });
  });

  function logout() {
    api("logout", { method: "POST" }).catch(function () {}).finally(function () {
      showLogin("Вы вышли из панели.");
    });
  }
  $("btn-logout").addEventListener("click", logout);
  $("btn-logout-2").addEventListener("click", logout);

  /* --------------------------------------------------------------- */
  /* Список                                                           */
  /* --------------------------------------------------------------- */

  function loadList() {
    return api("records").then(function (data) {
      state.rows = data.list;
      $("who").textContent = state.me
        ? state.me.email + " · " + (state.me.role === "owner" ? "владелец" : "редактор")
        : "";
      $("counts").innerHTML =
        "Всего: <b>" + data.counts.всего + "</b> · " +
        "черновиков: <b>" + data.counts.черновики + "</b> · " +
        "проверено: <b>" + data.counts.проверено + "</b> · " +
        "пора перепроверить: <b>" + data.counts.устарело + "</b>";
      renderList();
      show("list");
    }).catch(function (err) {
      if (err.message !== "нет входа") setAlert("list-error", err.message);
    });
  }

  function matches(row) {
    if (state.filter === "draft" && row.status === "verified") return false;
    if (state.filter === "verified" && row.status !== "verified") return false;
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
      var b = document.createElement("button");
      b.className = "row";
      b.type = "button";

      var name = document.createElement("span");
      name.className = "row__name";
      name.textContent = row.countryName + " — " + row.visaName.toLowerCase();

      var meta = document.createElement("span");
      meta.className = "row__meta";
      meta.textContent = row.checkedOn
        ? "проверено " + row.checkedOn + (row.checkedBy ? " · " + row.checkedBy : "")
        : "проверки ещё не было";

      var tags = document.createElement("span");
      tags.className = "row__tags";
      tags.appendChild(tag(row.status === "verified" ? "проверено" : "черновик",
                           row.status === "verified" ? "verified" : "draft"));
      if (row.stale) tags.appendChild(tag("пора перепроверить", "stale"));
      if (row.todo) tags.appendChild(tag("УТОЧНИТЬ: " + row.todo, "todo"));

      b.appendChild(name);
      b.appendChild(meta);
      b.appendChild(tags);
      b.addEventListener("click", function () { openEditor(row.visa, row.country); });
      box.appendChild(b);
    });
  }

  function tag(text, kind) {
    var s = document.createElement("span");
    s.className = "tag tag--" + kind;
    s.textContent = text;
    return s;
  }

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

  $("btn-back").addEventListener("click", function () { loadList(); });

  /* --------------------------------------------------------------- */
  /* Редактор                                                         */
  /* --------------------------------------------------------------- */

  function openEditor(visa, country) {
    api("record?visa=" + encodeURIComponent(visa) + "&country=" + encodeURIComponent(country))
      .then(function (data) {
        state.entry = data.entry;
        state.meta = data;
        $("edit-title").textContent = data.country.country.ru + " — " + data.visaName.ru.toLowerCase();
        $("edit-sub").textContent = data.kind === "education"
          ? "Помощь с поступлением — поля отличаются от визовых"
          : "Тип визы";
        setAlert("edit-error", "");
        $("edit-ok").hidden = true;
        buildFields();
        showBlockers(data.blockers);
        show("edit");
        refreshPreview();
      }).catch(function (err) {
        if (err.message !== "нет входа") setAlert("list-error", err.message);
      });
  }

  function showBlockers(list) {
    var box = $("blockers");
    var ul = $("blockers-list");
    ul.textContent = "";
    (list || []).forEach(function (text) {
      var li = document.createElement("li");
      li.textContent = text;
      ul.appendChild(li);
    });
    box.hidden = !(list && list.length);
    $("btn-verify").hidden = state.entry.status === "verified";
    $("btn-draft").hidden = state.entry.status !== "verified";
  }

  function buildFields() {
    var box = $("fields");
    box.textContent = "";
    var kind = state.meta.kind;
    var required = state.meta.fields.required;

    ORDER[kind].forEach(function (key) {
      var group = document.createElement("section");
      group.className = "group";

      var h = document.createElement("h2");
      h.textContent = FIELD[key].title;
      if (required.indexOf(key) !== -1) h.className = "req";
      group.appendChild(h);

      if (FIELD[key].hint) {
        var hint = document.createElement("p");
        hint.className = "hint";
        hint.textContent = FIELD[key].hint;
        group.appendChild(hint);
      }

      if (key === "documents") group.appendChild(documentsEditor());
      else if (LIST_FIELDS.indexOf(key) !== -1) group.appendChild(listEditor(key));
      else group.appendChild(trioEditor(key));

      /* Дата проверки суммы стоит рядом с самой суммой, а не отдельно
         в конце: иначе связь между ними теряется. */
      var money = state.meta.fields.money;
      if (key === money.field) group.appendChild(dateEditor(money.date, "Когда проверяли эту сумму"));

      box.appendChild(group);
    });

    var last = document.createElement("section");
    last.className = "group";
    var h2 = document.createElement("h2");
    h2.className = "req";
    h2.textContent = "Проверка";
    last.appendChild(h2);
    var hint = document.createElement("p");
    hint.className = "hint";
    hint.textContent = "Дата попадает на страницу строкой «Информация проверена в …» и в разметку для поисковиков.";
    last.appendChild(hint);
    last.appendChild(dateEditor("checkedOn", "Дата проверки"));
    last.appendChild(plainEditor("checkedBy", "Кто проверил"));
    box.appendChild(last);
  }

  function onEdit() { scheduleSave(); schedulePreview(); }

  function trioEditor(key) {
    var wrap = document.createElement("div");
    wrap.className = "langs";
    LANGS.forEach(function (l) {
      var label = document.createElement("label");
      var span = document.createElement("span");
      span.textContent = l.name;
      var ta = document.createElement("textarea");
      ta.value = (state.entry[key] && state.entry[key][l.key]) || "";
      ta.addEventListener("input", function () {
        state.entry[key] = state.entry[key] || {};
        state.entry[key][l.key] = ta.value;
        onEdit();
      });
      label.appendChild(span);
      label.appendChild(ta);
      wrap.appendChild(label);
    });
    return wrap;
  }

  function dateEditor(key, title) {
    var label = document.createElement("label");
    label.className = "field";
    var span = document.createElement("span");
    span.textContent = title;
    var input = document.createElement("input");
    input.type = "date";
    input.value = state.entry[key] || "";
    input.addEventListener("change", function () { state.entry[key] = input.value; onEdit(); });
    label.appendChild(span);
    label.appendChild(input);
    return label;
  }

  function plainEditor(key, title) {
    var label = document.createElement("label");
    label.className = "field";
    var span = document.createElement("span");
    span.textContent = title;
    var input = document.createElement("input");
    input.type = "text";
    input.value = state.entry[key] || "";
    input.addEventListener("input", function () { state.entry[key] = input.value; onEdit(); });
    label.appendChild(span);
    label.appendChild(input);
    return label;
  }

  /* Список пунктов: добавить, убрать, передвинуть */
  function listEditor(key) {
    var box = document.createElement("div");
    box.className = "items";
    state.entry[key] = state.entry[key] || [];

    function redraw() {
      box.textContent = "";
      state.entry[key].forEach(function (item, index) {
        box.appendChild(itemCard({
          index: index,
          total: state.entry[key].length,
          onMove: function (dir) { move(state.entry[key], index, dir); redraw(); onEdit(); },
          onDelete: function () { state.entry[key].splice(index, 1); redraw(); onEdit(); },
          body: [trioInputs(item)]
        }));
      });
      box.appendChild(addButton("Добавить пункт", function () {
        state.entry[key].push({ tk: "", ru: "", en: "" });
        redraw(); onEdit();
      }));
    }
    redraw();
    return box;
  }

  function documentsEditor() {
    var box = document.createElement("div");
    box.className = "items";
    state.entry.documents = state.entry.documents || [];

    function redraw() {
      box.textContent = "";
      state.entry.documents.forEach(function (doc, index) {
        doc.note = doc.note || { tk: "", ru: "", en: "" };
        var check = document.createElement("label");
        check.className = "item__check";
        var cb = document.createElement("input");
        cb.type = "checkbox";
        cb.checked = doc.required !== false;
        cb.addEventListener("change", function () { doc.required = cb.checked; onEdit(); });
        check.appendChild(cb);
        check.appendChild(document.createTextNode("нужен всегда"));

        var noteTitle = document.createElement("p");
        noteTitle.className = "hint";
        noteTitle.textContent = "Уточнение мелким шрифтом (не обязательно)";

        box.appendChild(itemCard({
          index: index,
          total: state.entry.documents.length,
          extra: check,
          onMove: function (dir) { move(state.entry.documents, index, dir); redraw(); onEdit(); },
          onDelete: function () { state.entry.documents.splice(index, 1); redraw(); onEdit(); },
          body: [trioInputs(doc.text), noteTitle, trioInputs(doc.note)]
        }));
      });
      box.appendChild(addButton("Добавить документ", function () {
        state.entry.documents.push({ required: true, text: { tk: "", ru: "", en: "" }, note: { tk: "", ru: "", en: "" } });
        redraw(); onEdit();
      }));
    }
    redraw();
    return box;
  }

  function trioInputs(target) {
    var wrap = document.createElement("div");
    wrap.className = "langs";
    LANGS.forEach(function (l) {
      var label = document.createElement("label");
      var span = document.createElement("span");
      span.textContent = l.name;
      var input = document.createElement("input");
      input.type = "text";
      input.value = target[l.key] || "";
      input.addEventListener("input", function () { target[l.key] = input.value; onEdit(); });
      label.appendChild(span);
      label.appendChild(input);
      wrap.appendChild(label);
    });
    return wrap;
  }

  function itemCard(opts) {
    var card = document.createElement("div");
    card.className = "item";
    var head = document.createElement("div");
    head.className = "item__head";

    var num = document.createElement("span");
    num.className = "grow muted";
    num.textContent = "№ " + (opts.index + 1);
    head.appendChild(num);
    if (opts.extra) head.appendChild(opts.extra);

    head.appendChild(iconButton("↑", "Выше", opts.index === 0, function () { opts.onMove(-1); }));
    head.appendChild(iconButton("↓", "Ниже", opts.index === opts.total - 1, function () { opts.onMove(1); }));
    head.appendChild(iconButton("✕", "Убрать", false, opts.onDelete));

    card.appendChild(head);
    opts.body.forEach(function (el) { card.appendChild(el); });
    return card;
  }

  function iconButton(sign, title, disabled, onClick) {
    var b = document.createElement("button");
    b.type = "button";
    b.className = "icon-btn";
    b.textContent = sign;
    b.title = title;
    b.setAttribute("aria-label", title);
    b.disabled = !!disabled;
    b.addEventListener("click", onClick);
    return b;
  }

  function addButton(text, onClick) {
    var b = document.createElement("button");
    b.type = "button";
    b.className = "btn";
    b.textContent = "+ " + text;
    b.addEventListener("click", onClick);
    return b;
  }

  function move(list, index, dir) {
    var to = index + dir;
    if (to < 0 || to >= list.length) return;
    var tmp = list[index];
    list[index] = list[to];
    list[to] = tmp;
  }

  /* --------------------------------------------------------------- */
  /* Сохранение                                                       */
  /* --------------------------------------------------------------- */

  var saveTimer = null;
  function scheduleSave() { /* автосохранения нет нарочно: сохраняет человек кнопкой */ }

  function payload() {
    var kind = state.meta.kind;
    var out = { documents: state.entry.documents, checkedOn: state.entry.checkedOn || "",
                checkedBy: state.entry.checkedBy || "" };
    ORDER[kind].forEach(function (key) {
      if (key === "documents") return;
      out[key] = state.entry[key];
    });
    var money = state.meta.fields.money;
    out[money.date] = state.entry[money.date] || "";
    return out;
  }

  function save(extra) {
    setAlert("edit-error", "");
    $("edit-ok").hidden = true;
    var body = payload();
    if (extra) Object.assign(body, extra);
    var visa = state.entry.visa, country = state.entry.country;
    return api("record?visa=" + encodeURIComponent(visa) + "&country=" + encodeURIComponent(country),
               { method: "PUT", body: body })
      .then(function (data) {
        state.entry = data.entry;
        showBlockers(data.blockers);
        $("edit-ok").textContent = "Сохранено.";
        $("edit-ok").hidden = false;
        refreshPreview();
      })
      .catch(function (err) {
        if (err.message === "нет входа") return;
        setAlert("edit-error", err.message);
        if (err.data && err.data.blockers) showBlockers(err.data.blockers);
      });
  }

  $("btn-save").addEventListener("click", function () { save(); });
  $("btn-verify").addEventListener("click", function () { save({ status: "verified" }); });
  $("btn-draft").addEventListener("click", function () { save({ status: "draft" }); });

  /* --------------------------------------------------------------- */
  /* Предпросмотр                                                     */
  /* --------------------------------------------------------------- */

  var previewTimer = null;
  function schedulePreview() {
    clearTimeout(previewTimer);
    previewTimer = setTimeout(refreshPreview, 600);
  }

  function refreshPreview() {
    if (!state.entry) return;
    api("preview", { method: "POST", body: { entry: state.entry, lang: state.lang } })
      .then(function (data) {
        if (data && data.id) $("preview").src = "/api/admin/preview?id=" + encodeURIComponent(data.id);
      })
      .catch(function () { /* предпросмотр не критичен: молча не обновляем */ });
  }

  $("preview-langs").addEventListener("click", function (e) {
    var btn = e.target.closest("[data-lang]");
    if (!btn) return;
    state.lang = btn.dataset.lang;
    [].forEach.call(this.querySelectorAll(".chip"), function (c) { c.classList.toggle("is-on", c === btn); });
    refreshPreview();
  });

  $("preview-size").addEventListener("click", function (e) {
    var btn = e.target.closest("[data-size]");
    if (!btn) return;
    state.size = btn.dataset.size;
    [].forEach.call(this.querySelectorAll(".chip"), function (c) { c.classList.toggle("is-on", c === btn); });
    $("preview-frame").classList.toggle("is-wide", state.size === "wide");
  });

  /* --------------------------------------------------------------- */
  /* Запуск                                                           */
  /* --------------------------------------------------------------- */

  api("me", { quiet401: true }).then(function (me) {
    state.csrf = me.csrf;
    state.me = { email: me.email, role: me.role };
    return loadList();
  }).catch(function () { showLogin(); });

})();
