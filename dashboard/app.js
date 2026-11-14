(function () {
  'use strict';

  /* ---------- helpers ---------- */
  var $ = function (s, r) { return (r || document).querySelector(s); };
  function el(tag, attrs, kids) {
    var n = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (k === 'text') n.textContent = attrs[k];
      else if (k === 'class') n.className = attrs[k];
      else n.setAttribute(k, attrs[k]);
    });
    (kids || []).forEach(function (c) { n.appendChild(c); });
    return n;
  }
  function svg(tag, attrs) {
    var n = document.createElementNS('http://www.w3.org/2000/svg', tag);
    Object.keys(attrs || {}).forEach(function (k) { n.setAttribute(k, attrs[k]); });
    return n;
  }
  var fmt = function (n) { return n.toLocaleString(); };

  /* ---------- tabs ---------- */
  document.querySelectorAll('.tab').forEach(function (t) {
    t.addEventListener('click', function () {
      document.querySelectorAll('.tab').forEach(function (x) {
        var on = x === t;
        x.classList.toggle('active', on);
        x.setAttribute('aria-selected', on);
      });
      $('#tab-stats').hidden = t.dataset.tab !== 'stats';
      $('#tab-menu').hidden = t.dataset.tab !== 'menu';
    });
  });

  /* ================= USAGE ================= */
  var FUNCS = [
    { key: 'translate', label: 'Translation', color: 'var(--c-translate)' },
    { key: 'read',      label: 'Read aloud / questions', color: 'var(--c-read)' },
    { key: 'allergen',  label: 'Allergen info', color: 'var(--c-allergen)' }
  ];

  // Demo data: one record per day for the last 180 days. Replace with real logs.
  // Expected shape: [{date:'YYYY-MM-DD', translate:n, read:n, allergen:n}, ...]
  function demoUsage() {
    var seed = 42;
    function rnd() { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; }
    var out = [], today = new Date(); today.setHours(0, 0, 0, 0);
    for (var i = 179; i >= 0; i--) {
      var d = new Date(today); d.setDate(d.getDate() - i);
      var weekend = d.getDay() === 5 || d.getDay() === 6;
      var growth = 0.6 + (180 - i) / 180 * 0.8;
      var base = (weekend ? 55 : 32) * growth;
      out.push({
        date: d.toISOString().slice(0, 10),
        translate: Math.round(base * (0.9 + rnd() * 0.5)),
        read:      Math.round(base * (0.25 + rnd() * 0.2)),
        allergen:  Math.round(base * (0.6 + rnd() * 0.4))
      });
    }
    return out;
  }
  var usage = demoUsage();

  function bucket(period) {
    var map = {}, order = [];
    usage.forEach(function (r) {
      var d = new Date(r.date + 'T00:00:00'), key, label;
      if (period === 'daily') {
        key = r.date; label = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
      } else if (period === 'weekly') {
        var m = new Date(d); m.setDate(d.getDate() - ((d.getDay() + 6) % 7)); // Monday
        key = m.toISOString().slice(0, 10);
        label = m.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
      } else {
        key = r.date.slice(0, 7);
        label = d.toLocaleDateString(undefined, { month: 'short' });
      }
      if (!map[key]) { map[key] = { label: label, translate: 0, read: 0, allergen: 0 }; order.push(key); }
      FUNCS.forEach(function (f) { map[key][f.key] += r[f.key]; });
    });
    var rows = order.map(function (k) { return map[k]; });
    var keep = { daily: 14, weekly: 12, monthly: 6 }[period];
    return rows.slice(-keep);
  }

  function renderKpis() {
    var tot = { translate: 0, read: 0, allergen: 0 };
    usage.forEach(function (r) { FUNCS.forEach(function (f) { tot[f.key] += r[f.key]; }); });
    var all = tot.translate + tot.read + tot.allergen;
    var last7 = usage.slice(-7).reduce(function (a, r) { return a + r.translate + r.read + r.allergen; }, 0);
    var prev7 = usage.slice(-14, -7).reduce(function (a, r) { return a + r.translate + r.read + r.allergen; }, 0);
    var delta = prev7 ? Math.round((last7 - prev7) / prev7 * 100) : 0;

    var k = $('#kpis'); k.textContent = '';
    function card(lbl, val, sub, color) {
      var l = el('div', { class: 'lbl' });
      if (color) l.appendChild(el('span', { class: 'dot', style: 'background:' + color }));
      l.appendChild(document.createTextNode(lbl));
      k.appendChild(el('div', { class: 'kpi' }, [l, el('div', { class: 'val', text: fmt(val) }), el('div', { class: 'sub', text: sub })]));
    }
    card('Total button uses', all, (delta >= 0 ? '+' : '') + delta + '% vs previous 7 days');
    FUNCS.forEach(function (f) {
      card(f.label, tot[f.key], Math.round(tot[f.key] / all * 100) + '% of all uses', f.color);
    });
    return tot;
  }

  function renderBreakdown(tot) {
    var all = tot.translate + tot.read + tot.allergen, b = $('#breakdown');
    b.textContent = '';
    FUNCS.forEach(function (f) {
      var pct = tot[f.key] / all * 100;
      b.appendChild(el('div', { class: 'bar-row' }, [
        el('div', { text: f.label }),
        el('div', { class: 'track' }, [el('div', { class: 'fill', style: 'width:' + pct + '%;background:' + f.color })]),
        el('div', { class: 'n', text: fmt(tot[f.key]) + ' · ' + Math.round(pct) + '%' })
      ]));
    });
  }

  function renderLegend() {
    var lg = $('#legend'); lg.textContent = '';
    FUNCS.forEach(function (f) {
      var s = el('span'); s.appendChild(el('i', { style: 'background:' + f.color }));
      s.appendChild(document.createTextNode(f.label)); lg.appendChild(s);
    });
  }

  function renderChart(period) {
    var rows = bucket(period), W = 720, H = 280, L = 40, B = 28, T = 10, R = 8;
    var max = Math.max.apply(null, rows.map(function (r) { return r.translate + r.read + r.allergen; }));
    var step = Math.pow(10, Math.floor(Math.log10(max))), top = Math.ceil(max / step) * step;
    var s = svg('svg', { viewBox: '0 0 ' + W + ' ' + H });
    var ph = H - B - T;
    for (var i = 0; i <= 4; i++) {
      var y = T + ph - ph * i / 4;
      s.appendChild(svg('line', { x1: L, x2: W - R, y1: y, y2: y, class: 'grid' }));
      var t = svg('text', { x: L - 6, y: y + 4, 'text-anchor': 'end' });
      t.textContent = fmt(Math.round(top * i / 4)); s.appendChild(t);
    }
    var slot = (W - L - R) / rows.length, bw = Math.min(36, slot * 0.7);
    rows.forEach(function (r, i) {
      var x = L + slot * i + (slot - bw) / 2, y = T + ph;
      FUNCS.forEach(function (f) {
        var h = r[f.key] / top * ph; y -= h;
        var rect = svg('rect', { x: x, y: y, width: bw, height: Math.max(h, 0), fill: f.color.replace('var(', 'var(') });
        rect.style.fill = f.color;
        var tt = svg('title'); tt.textContent = r.label + ' – ' + f.label + ': ' + fmt(r[f.key]);
        rect.appendChild(tt); s.appendChild(rect);
      });
      if (rows.length <= 14 || i % 2 === 0) {
        var lb = svg('text', { x: x + bw / 2, y: H - 8, 'text-anchor': 'middle' });
        lb.textContent = r.label; s.appendChild(lb);
      }
    });
    var c = $('#chart'); c.textContent = ''; c.appendChild(s);
  }

  document.querySelectorAll('#period button').forEach(function (b) {
    b.addEventListener('click', function () {
      document.querySelectorAll('#period button').forEach(function (x) { x.classList.toggle('on', x === b); });
      renderChart(b.dataset.p);
    });
  });

  renderBreakdown(renderKpis());
  renderLegend();
  renderChart('daily');

  /* ================= MENU ADMIN ================= */
  var KEY = 'smartbutton.menu.v1';
  var ALLERGENS = {
    'Gluten':     ['wheat', 'flour', 'bread', 'pasta', 'noodle', 'barley', 'rye', 'soy sauce', 'couscous', 'breadcrumb'],
    'Dairy':      ['milk', 'cheese', 'butter', 'cream', 'yogurt', 'yoghurt', 'parmesan', 'mozzarella', 'whey'],
    'Eggs':       ['egg', 'mayonnaise', 'mayo', 'meringue'],
    'Peanuts':    ['peanut'],
    'Tree nuts':  ['almond', 'walnut', 'cashew', 'pecan', 'pistachio', 'hazelnut', 'macadamia'],
    'Soy':        ['soy', 'tofu', 'edamame', 'miso'],
    'Fish':       ['fish', 'salmon', 'tuna', 'cod', 'anchovy', 'anchovies', 'fish sauce'],
    'Shellfish':  ['shrimp', 'prawn', 'crab', 'lobster', 'clam', 'mussel', 'oyster', 'scallop'],
    'Sesame':     ['sesame', 'tahini']
  };

  function detect(ingredients) {
    var text = ingredients.map(function (i) { return i.toLowerCase(); });
    return Object.keys(ALLERGENS).filter(function (a) {
      return ALLERGENS[a].some(function (kw) { return text.some(function (t) { return t.indexOf(kw) !== -1; }); });
    });
  }
  function parseIngr(str) {
    return str.split(/[,\n]/).map(function (s) { return s.trim(); }).filter(Boolean);
  }
  function load() {
    try { var v = JSON.parse(localStorage.getItem(KEY)); if (Array.isArray(v)) return v; } catch (e) {}
    return [
      { id: 's1', name: 'Pad Thai', photo: '', ingredients: ['rice noodles', 'shrimp', 'peanuts', 'egg', 'tamarind', 'fish sauce'] },
      { id: 's2', name: 'Margherita Pizza', photo: '', ingredients: ['wheat flour', 'tomato', 'mozzarella', 'basil', 'olive oil'] }
    ];
  }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(meals)); }
    catch (e) { alert('Could not save: browser storage is full or blocked. Try a smaller photo.'); }
  }

  var meals = load(), editing = null, photoData = '';

  function chips(list, plain) {
    var w = el('div', { class: 'chips' });
    list.forEach(function (a) { w.appendChild(el('span', { class: 'chip' + (plain ? ' plain' : ''), text: a })); });
    return w;
  }

  function renderMeals() {
    var box = $('#meals'); box.textContent = '';
    $('#count').textContent = '(' + meals.length + ')';
    if (!meals.length) { box.appendChild(el('div', { class: 'empty', text: 'No meals yet. Add your first one above.' })); return; }
    meals.forEach(function (m) {
      var ph = el('div', { class: 'ph' });
      if (m.photo) ph.appendChild(el('img', { src: m.photo, alt: m.name })); else ph.textContent = '🍽';
      var al = detect(m.ingredients);
      var body = el('div', { class: 'body' }, [
        el('h3', { text: m.name }),
        el('div', { class: 'ingr', text: m.ingredients.join(', ') }),
        al.length ? chips(al) : el('span', { class: 'muted', text: 'No common allergens detected' })
      ]);
      var edit = el('button', { class: 'btn', text: 'Edit' });
      var del = el('button', { class: 'btn danger', text: 'Delete' });
      edit.onclick = function () { startEdit(m.id); };
      del.onclick = function () {
        if (confirm('Delete "' + m.name + '"?')) { meals = meals.filter(function (x) { return x.id !== m.id; }); save(); renderMeals(); }
      };
      box.appendChild(el('div', { class: 'meal' }, [ph, body, el('div', { class: 'actions' }, [edit, del])]));
    });
  }

  function showPreview() {
    var p = $('#f-preview'); p.textContent = '';
    p.hidden = !photoData;
    if (photoData) p.appendChild(el('img', { src: photoData, alt: 'Preview' }));
  }
  function updateAllergens() {
    var box = $('#f-allergens'), list = detect(parseIngr($('#f-ingr').value));
    box.textContent = '';
    if (list.length) box.appendChild(chips(list));
    else box.appendChild(el('span', { class: 'muted', text: $('#f-ingr').value.trim() ? 'None detected' : 'Type ingredients to detect allergens' }));
  }
  function resetForm() {
    editing = null; photoData = '';
    $('#meal-form').reset(); showPreview(); updateAllergens();
    $('#form-title').textContent = 'Add a meal';
    $('#f-save').textContent = 'Save meal';
    $('#f-cancel').hidden = true;
  }
  function startEdit(id) {
    var m = meals.filter(function (x) { return x.id === id; })[0]; if (!m) return;
    editing = id; photoData = m.photo || '';
    $('#f-name').value = m.name; $('#f-ingr').value = m.ingredients.join(', ');
    showPreview(); updateAllergens();
    $('#form-title').textContent = 'Edit meal';
    $('#f-save').textContent = 'Update meal';
    $('#f-cancel').hidden = false;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  $('#f-ingr').addEventListener('input', updateAllergens);
  $('#f-cancel').addEventListener('click', resetForm);

  $('#f-photo').addEventListener('change', function (e) {
    var file = e.target.files[0]; if (!file) return;
    var img = new Image(), url = URL.createObjectURL(file);
    img.onload = function () {
      var max = 640, sc = Math.min(1, max / Math.max(img.width, img.height));
      var c = document.createElement('canvas');
      c.width = Math.round(img.width * sc); c.height = Math.round(img.height * sc);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      photoData = c.toDataURL('image/jpeg', 0.8);
      URL.revokeObjectURL(url); showPreview();
    };
    img.onerror = function () { URL.revokeObjectURL(url); alert('That file could not be read as an image.'); };
    img.src = url;
  });

  $('#meal-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var rec = { id: editing || 'm' + Date.now(), name: $('#f-name').value.trim(), photo: photoData, ingredients: parseIngr($('#f-ingr').value) };
    if (!rec.name || !rec.ingredients.length) return;
    if (editing) meals = meals.map(function (m) { return m.id === editing ? rec : m; });
    else meals.push(rec);
    save(); renderMeals(); resetForm();
  });

  $('#export').addEventListener('click', function () {
    var data = meals.map(function (m) {
      return { name: m.name, photo: m.photo, ingredients: m.ingredients, allergens: detect(m.ingredients) };
    });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    a.download = 'menu.json'; a.click(); URL.revokeObjectURL(a.href);
  });

  renderMeals();
})();
