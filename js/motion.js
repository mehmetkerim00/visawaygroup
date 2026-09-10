/* ==========================================================================
   motion.js — появление блоков при прокрутке.

   На весь сайт один наблюдатель (IntersectionObserver). Отдельных скриптов
   для отдельных секций нет и быть не должно: если понадобилось оживить ещё
   один блок, ему дописывают атрибут в разметке, а не новый файл.

   Как размечать:

     <div data-reveal>            блок поднимается снизу и проявляется;
     <div data-reveal="fade">     только проявляется, без подъёма;
     <ul  data-reveal-group>      дети появляются по очереди, с нарастающей
                                  задержкой (--stagger в tokens.css);
     <section data-reveal="dash"> сам блок не двигается — «бежит» пунктирный
                                  разделитель над ним.

   Само оформление живёт в css/base.css, здесь только момент включения.

   Движения не будет вовсе, если:
     • в системе включено «уменьшить движение»;
     • браузер не умеет IntersectionObserver.
   В обоих случаях страница просто показана целиком — ничего не спрятано.
   Прячет блоки CSS, и только когда у <html> есть класс js, который ставит
   строка в <head>. Без JavaScript класса нет, значит, и прятать нечего.
   ========================================================================== */

(function () {
  "use strict";

  var GROUP = "[data-reveal-group]";
  var SINGLE = "[data-reveal]";

  if (!("IntersectionObserver" in window)) return;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  /* Что показываем, когда сработает наблюдатель. Ключ — элемент, за которым
     следим, значение — список элементов, которым ставим класс.
     У одиночного блока это он сам, у списка — его дети. */
  var targets = new WeakMap();
  var watched = [];

  /* --- Списки: дети появляются друг за другом ---------------------------- */
  Array.prototype.forEach.call(document.querySelectorAll(GROUP), function (group) {
    var items = Array.prototype.filter.call(group.children, function (node) {
      return node.nodeType === 1;
    });
    if (!items.length) return;

    /* Порядковый номер ребёнка. CSS умножает его на --stagger и получает
       задержку: первый появляется сразу, третий — на 140 мс позже. */
    items.forEach(function (item, index) {
      item.style.setProperty("--i", String(index));
    });

    targets.set(group, items);
    watched.push(group);
  });

  /* --- Одиночные блоки ---------------------------------------------------- */
  Array.prototype.forEach.call(document.querySelectorAll(SINGLE), function (el) {
    /* Если блок лежит внутри списка, им уже занимается список */
    if (el.parentElement && el.parentElement.closest(GROUP)) return;
    targets.set(el, [el]);
    watched.push(el);
  });

  if (!watched.length) return;

  var observer = new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      if (!entry.isIntersecting) return;

      var list = targets.get(entry.target);
      if (list) {
        list.forEach(function (el) {
          el.classList.add("is-visible");
        });
      }
      /* Показали один раз — больше следить незачем */
      observer.unobserve(entry.target);
    });
  }, {
    /* Блок считается «в кадре», когда поднялся выше нижней кромки экрана
       примерно на десятую её часть: так появление успевает закончиться
       к моменту, когда читатель до блока доберётся. */
    rootMargin: "0px 0px -8% 0px",
    threshold: 0.05
  });

  watched.forEach(function (el) {
    observer.observe(el);
  });

})();
