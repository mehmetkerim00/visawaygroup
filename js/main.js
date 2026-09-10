/* ==========================================================================
   main.js — весь интерактив сайта.
   Обычный JavaScript, без библиотек. Подключается в конце index.html.
   ========================================================================== */

(function () {
  "use strict";

  /* ------------------------------------------------------------------------
     1. МОБИЛЬНОЕ МЕНЮ (бургер)

     Что умеет:
       • открывается и закрывается по кнопке-бургеру;
       • закрывается по клавише Esc;
       • закрывается по клику вне меню (по затемнению или по любому месту
         страницы за пределами панели);
       • закрывается после нажатия на пункт меню;
       • закрывается сам, если экран стал широким (поворот телефона, планшет);
       • блокирует прокрутку страницы, пока открыто;
       • держит фокус клавиатуры внутри панели, пока она открыта.
     ---------------------------------------------------------------------- */

  var burger   = document.querySelector("[data-nav-toggle]");
  var nav      = document.querySelector("[data-nav]");
  var backdrop = document.querySelector("[data-nav-backdrop]");
  var header   = document.querySelector("[data-header]");

  // Та же граница, что и в layout.css (@media min-width: 64em).
  // Единицы em, а не пиксели: при увеличенном шрифте порог сдвигается вместе
  // с текстом. Если поменяете её в CSS — поменяйте и здесь.
  var desktopQuery = window.matchMedia("(min-width: 64em)");

  var isOpen = false;

  function openNav() {
    if (isOpen || !nav || !burger) return;
    isOpen = true;

    nav.classList.add("is-open");
    burger.setAttribute("aria-expanded", "true");
    updateHeader();
    document.body.classList.add("no-scroll");
    if (backdrop) backdrop.classList.add("is-visible");

    // Переводим фокус на первый пункт меню, чтобы с клавиатуры
    // сразу можно было идти по списку.
    var first = nav.querySelector("a, button");
    if (first) first.focus();
  }

  function closeNav(returnFocus) {
    if (!isOpen || !nav || !burger) return;
    isOpen = false;

    nav.classList.remove("is-open");
    burger.setAttribute("aria-expanded", "false");
    updateHeader();
    document.body.classList.remove("no-scroll");
    if (backdrop) backdrop.classList.remove("is-visible");

    // Возвращаем фокус на бургер — иначе он «потеряется» на скрытом элементе.
    if (returnFocus) burger.focus();
  }

  function toggleNav() {
    if (isOpen) {
      closeNav(true);
    } else {
      openNav();
    }
  }

  if (burger && nav) {

    burger.addEventListener("click", toggleNav);

    // Клик по затемнению
    if (backdrop) {
      backdrop.addEventListener("click", function () {
        closeNav(false);
      });
    }

    // Клик где угодно вне панели и вне кнопки
    document.addEventListener("click", function (event) {
      if (!isOpen) return;
      if (nav.contains(event.target) || burger.contains(event.target)) return;
      closeNav(false);
    });

    // Нажали на пункт меню — панель больше не нужна
    nav.addEventListener("click", function (event) {
      var link = event.target.closest("a");
      if (link) closeNav(false);
    });

    // Клавиатура: Esc закрывает, Tab не выпускает фокус из панели
    document.addEventListener("keydown", function (event) {
      if (!isOpen) return;

      if (event.key === "Escape" || event.key === "Esc") {
        event.preventDefault();
        closeNav(true);
        return;
      }

      if (event.key !== "Tab") return;

      // Удерживаем фокус внутри открытой панели
      var focusable = nav.querySelectorAll(
        'a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])'
      );
      if (!focusable.length) return;

      var first = focusable[0];
      var last  = focusable[focusable.length - 1];

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    });

    // Экран стал широким — меню и так видно строкой, панель закрываем
    function handleBreakpoint(event) {
      if (event.matches) closeNav(false);
    }

    if (typeof desktopQuery.addEventListener === "function") {
      desktopQuery.addEventListener("change", handleBreakpoint);
    } else if (typeof desktopQuery.addListener === "function") {
      // Запасной вариант для старых браузеров
      desktopQuery.addListener(handleBreakpoint);
    }
  }


  /* ------------------------------------------------------------------------
     2. ТЕНЬ У ШАПКИ ПРИ ПРОКРУТКЕ
     Пока страница вверху — шапка плоская. Прокрутили — появляется тень,
     чтобы шапка отделялась от содержимого.
     ---------------------------------------------------------------------- */

  /* Функция объявлена здесь, а не внутри блока ниже: её зовёт и меню,
     когда открывается поверх прозрачной шапки на главной. */
  function updateHeader() {
    if (!header) return;
    /* Шапка становится «плотной» либо от прокрутки, либо когда открыто
       меню: полупрозрачная шапка над белой панелью меню читалась бы плохо. */
    header.classList.toggle("is-scrolled", window.scrollY > 8 || isOpen);
  }

  if (header) {
    var ticking = false;

    function onScroll() {
      updateHeader();
      ticking = false;
    }

    window.addEventListener("scroll", function () {
      // requestAnimationFrame — чтобы не пересчитывать на каждый пиксель
      if (!ticking) {
        window.requestAnimationFrame(onScroll);
        ticking = true;
      }
    }, { passive: true });

    updateHeader();
  }


  /* ------------------------------------------------------------------------
     3. АККОРДЕОН «ЧАСТЫЕ ВОПРОСЫ»

     Сами вопросы работают на обычных <details> — они раскрываются даже
     при выключенном JavaScript. Скрипт лишь добавляет удобство:
     когда открывают один вопрос, остальные закрываются.
     ---------------------------------------------------------------------- */

  var faqGroups = document.querySelectorAll("[data-faq]");

  Array.prototype.forEach.call(faqGroups, function (group) {
    var items = group.querySelectorAll("details");

    Array.prototype.forEach.call(items, function (item) {
      item.addEventListener("toggle", function () {
        if (!item.open) return;
        Array.prototype.forEach.call(items, function (other) {
          if (other !== item) other.open = false;
        });
      });
    });
  });


  /* ------------------------------------------------------------------------
     4. ГОД В СТРОКЕ КОПИРАЙТА
     Чтобы год в подвале не пришлось править руками каждый январь.
     ---------------------------------------------------------------------- */

  var yearEl = document.querySelector("[data-current-year]");
  if (yearEl) {
    yearEl.textContent = String(new Date().getFullYear());
  }

})();
