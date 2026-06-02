/* =============================================================================
   Silia · Talk-to-Data — Agente (capa encima)
   -----------------------------------------------------------------------------
   Se monta SOBRE la app de Silia sin tocar su archivo:
     - Vive en un Shadow DOM aislado (no choca con sus estilos ni ellos con los míos).
     - Lee la Data View que esté renderizada (tabla / grid). Si no la encuentra,
       usa datos de ejemplo para que el agente siga siendo 100% demostrable.
     - El chat genera "outputs" (filtros, resúmenes, gráficas, métricas) como
       objetos de primera clase que se pueden Exportar y Fijar al dashboard.
     - El dashboard permite arrastrar/reordenar y cambiar cada tarjeta entre
       "media sección" y "sección completa". El layout se guarda en localStorage.

   Integración: agrega una sola línea antes de </body> en silia.html:
       <script defer src="silia-agent.js"></script>
   (o pega este archivo en la consola del navegador para probar al instante).
   ============================================================================= */
(function () {
  "use strict";
  if (window.__siliaAgentMounted) return;        // evita doble inyección
  window.__siliaAgentMounted = true;

  try { boot(); } catch (e) { console.warn("[silia-agent] no se montó:", e); }

  /* ----------------------------------------------------------------------- *
   * Utilidades
   * ----------------------------------------------------------------------- */
  function norm(s) {
    return String(s == null ? "" : s)
      .toLowerCase()
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "")  // sin acentos
      .trim();
  }
  function uid() { return "o" + Math.random().toString(36).slice(2, 9); }
  function fmtInt(n) { return new Intl.NumberFormat("es-MX").format(n); }
  function escapeHTML(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function csvCell(v) {
    var s = String(v == null ? "" : v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function download(filename, text) {
    try {
      var blob = new Blob([text], { type: "text/csv;charset=utf-8;" });
      var a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      a.style.display = "none";
      document.body.appendChild(a);
      a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 800);
    } catch (e) { console.warn("[silia-agent] export falló", e); }
  }
  var LS_KEY = "silia.agent.dashboard.v1";
  function loadDash() {
    try { var r = JSON.parse(localStorage.getItem(LS_KEY)); return Array.isArray(r) ? r : []; }
    catch (e) { return []; }
  }
  function saveDash(items) {
    try { localStorage.setItem(LS_KEY, JSON.stringify(items)); } catch (e) {}
  }

  /* ----------------------------------------------------------------------- *
   * Puente de tema: lee las variables CSS de Silia para verse nativo
   * ----------------------------------------------------------------------- */
  function bridgeTheme(host) {
    var root = getComputedStyle(document.documentElement);
    function pick(names, fallback) {
      for (var i = 0; i < names.length; i++) {
        var val = root.getPropertyValue(names[i]).trim();
        if (val) return val;
      }
      return fallback;
    }
    var accent = pick(["--silia-purple7", "--silia-primary", "--ant-color-primary", "--color-primary"], "#5b5bd6");
    var accentSoft = pick(["--silia-purple3", "--silia-purple2"], "rgba(91,91,214,.10)");
    var bg = pick(["--silia-bg-container", "--ant-color-bg-container"], "#ffffff");
    var text = pick(["--silia-text", "--ant-color-text"], "#1f2430");
    var sub = pick(["--silia-text-description", "--ant-color-text-secondary"], "#6b7280");
    var split = pick(["--silia-split", "--ant-color-split", "--silia-border"], "rgba(15,18,40,.08)");
    var s = host.style;
    s.setProperty("--s2a-accent", accent);
    s.setProperty("--s2a-accent-soft", accentSoft);
    s.setProperty("--s2a-bg", bg);
    s.setProperty("--s2a-text", text);
    s.setProperty("--s2a-sub", sub);
    s.setProperty("--s2a-split", split);
  }

  /* ----------------------------------------------------------------------- *
   * Lectura de la Data View (defensiva) + datos de ejemplo
   * ----------------------------------------------------------------------- */
  function readDataView() {
    // 1) <table> real (cubre AntD y tablas HTML estándar)
    var tables = Array.prototype.slice.call(document.querySelectorAll("table"));
    tables.sort(function (a, b) { return rowsOf(b) - rowsOf(a); }); // la más "grande"
    for (var i = 0; i < tables.length; i++) {
      var got = fromTable(tables[i]);
      if (got && got.columns.length >= 2 && got.rows.length >= 1) { got.source = "live"; return got; }
    }
    // 2) Grid por roles ARIA
    var grid = document.querySelector('[role="grid"],[role="table"]');
    if (grid) {
      var g = fromAriaGrid(grid);
      if (g && g.columns.length >= 2 && g.rows.length >= 1) { g.source = "live"; return g; }
    }
    // 3) Fallback: muestra del reto (para que siempre sea demostrable)
    return sampleData();

    function rowsOf(t) { return t.querySelectorAll("tbody tr, tr").length; }

    function fromTable(table) {
      var headEls = table.querySelectorAll("thead th");
      var cols = [];
      if (headEls.length) {
        headEls.forEach(function (th) { cols.push(cleanText(th)); });
      } else {
        var first = table.querySelector("tr");
        if (!first) return null;
        first.querySelectorAll("th,td").forEach(function (c) { cols.push(cleanText(c)); });
      }
      var bodyRows = table.querySelectorAll("tbody tr");
      if (!bodyRows.length) bodyRows = table.querySelectorAll("tr");
      var rows = [];
      bodyRows.forEach(function (tr) {
        if (tr.querySelector("th") && !tr.querySelector("td")) return; // fila de encabezado
        var cells = tr.querySelectorAll("td");
        if (!cells.length) return;
        var r = [];
        cells.forEach(function (td) { r.push(cleanText(td)); });
        if (r.join("").trim()) rows.push(r);
      });
      return normalizeCols({ columns: cols, rows: rows });
    }

    function fromAriaGrid(el) {
      var cols = [];
      el.querySelectorAll('[role="columnheader"]').forEach(function (h) { cols.push(cleanText(h)); });
      var rows = [];
      el.querySelectorAll('[role="row"]').forEach(function (row) {
        var cells = row.querySelectorAll('[role="gridcell"],[role="cell"]');
        if (!cells.length) return;
        var r = [];
        cells.forEach(function (c) { r.push(cleanText(c)); });
        if (r.join("").trim()) rows.push(r);
      });
      return normalizeCols({ columns: cols, rows: rows });
    }

    function cleanText(node) {
      return (node.innerText || node.textContent || "").replace(/\s+/g, " ").trim();
    }
    // recorta columnas vacías / asegura rectangularidad
    function normalizeCols(d) {
      var width = d.columns.length || (d.rows[0] ? d.rows[0].length : 0);
      var columns = d.columns.length ? d.columns.slice(0, width) : [];
      while (columns.length < width) columns.push("Col " + (columns.length + 1));
      var rows = d.rows.map(function (r) {
        var rr = r.slice(0, width);
        while (rr.length < width) rr.push("");
        return rr;
      });
      // descarta columnas totalmente vacías (típico de checkbox/acciones)
      var keep = [];
      for (var c = 0; c < width; c++) {
        var hasData = rows.some(function (r) { return String(r[c]).trim() !== ""; });
        var named = String(columns[c]).trim() !== "";
        if (hasData || named) keep.push(c);
      }
      return {
        columns: keep.map(function (c) { return columns[c] || ("Col " + (c + 1)); }),
        rows: rows.map(function (r) { return keep.map(function (c) { return r[c]; }); })
      };
    }
  }

  function sampleData() {
    return {
      source: "sample",
      columns: ["File Received", "Name", "Company", "Fecha", "Email", "Tipo de Camión"],
      rows: [
        ["DF1.pdf", "Rafael Cano", "Farmacias YZA", "28/12/25 - 19:00", "rafael@farmaciasyza.com", "Camión Pesado"],
        ["DF3.pdf", "Julio Martínez", "Distribuciones ABC", "22/02/26 - 14:00", "julio@distribucionesabc.com", "Furgón"],
        ["DF5.pdf", "Mateo Pérez", "Electrodomésticos MX", "05/04/26 - 09:15", "mateo@electrodomesticosmx.com", "Furgón"],
        ["DF6.pdf", "Lucía Fernández", "Transporte Rápido", "20/05/26 - 11:00", "lucia@transporterapido.com", "Camión Pesado"],
        ["DF4.pdf", "Sofía López", "Logística Global", "10/03/26 - 16:45", "sofia@logisticaglobal.com", "Camión Mediano"],
        ["DF7.pdf", "Carlos Vega", "Productos Innovadores", "12/06/26 - 15:30", "carlos@productosinnovadores.com", "Camión Liviano"],
        ["DF2.pdf", "Isabella Ruiz", "Tecnología Express", "15/01/26 - 10:30", "isabella@tecnologiaexpress.com", "Camión Liviano"],
        ["DF8.pdf", "Andrés Núñez", "Comercial Norte", "03/07/26 - 12:00", "andres@comercialnorte.com", "Camión Mediano"]
      ]
    };
  }

  /* ----------------------------------------------------------------------- *
   * Tipos de columna + helpers de análisis
   * ----------------------------------------------------------------------- */
  function profile(data) {
    var cols = data.columns.map(function (name, idx) {
      var vals = data.rows.map(function (r) { return r[idx]; }).filter(function (v) { return String(v).trim() !== ""; });
      var n = vals.length || 1;
      var emails = vals.filter(function (v) { return /\S+@\S+\.\S+/.test(v); }).length;
      var dates = vals.filter(isDateish).length;
      var nums = vals.filter(function (v) { return isNumberish(v); }).length;
      var distinct = new Set(vals.map(function (v) { return String(v).trim(); })).size;
      var type = "text";
      if (emails / n > 0.6) type = "email";
      else if (dates / n > 0.6) type = "date";
      else if (nums / n > 0.7) type = "number";
      else if (distinct <= Math.max(8, vals.length * 0.6)) type = "enum";
      return { name: name, idx: idx, type: type, distinct: distinct };
    });
    return cols;
  }
  function isNumberish(v) {
    var s = String(v).replace(/[\s,$%]/g, "");
    return s !== "" && !isNaN(Number(s));
  }
  function toNumber(v) { return Number(String(v).replace(/[\s,$%]/g, "")) || 0; }
  function isDateish(v) {
    return /\d{1,4}[-/]\d{1,2}[-/]\d{1,4}/.test(String(v)) ||
           /^\d{4}-\d{2}-\d{2}/.test(String(v));
  }
  // "28/12/25 - 19:00" -> {y,m}; soporta ISO y dd/mm/yyyy
  function monthKey(v) {
    var s = String(v).trim();
    var iso = s.match(/^(\d{4})-(\d{2})/);
    if (iso) return iso[1] + "-" + iso[2];
    var dmy = s.match(/(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})/);
    if (dmy) {
      var mm = ("0" + dmy[2]).slice(-2);
      var yy = dmy[3].length === 2 ? "20" + dmy[3] : dmy[3];
      return yy + "-" + mm;
    }
    return s.slice(0, 7);
  }
  var MONTHS = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
  function monthLabel(key) {
    var m = key.match(/^(\d{4})-(\d{2})$/);
    if (!m) return key;
    return MONTHS[Number(m[2]) - 1] + " " + m[1].slice(2);
  }

  function findColumnMention(q, cols) {
    var nq = norm(q);
    var best = null;
    cols.forEach(function (c) {
      var nc = norm(c.name);
      if (!nc) return;
      // coincidencia por palabra completa o por inclusión
      var hit = nq.indexOf(nc) >= 0 || nc.split(/\s+/).some(function (w) { return w.length > 2 && nq.indexOf(w) >= 0; });
      if (hit && (!best || nc.length > norm(best.name).length)) best = c;
    });
    return best;
  }
  // detecta un valor citado contra el dominio de las columnas categóricas/texto
  function findValueMention(q, data, cols) {
    var nq = norm(q);
    var candidates = cols.filter(function (c) { return c.type === "enum" || c.type === "text"; });
    for (var i = 0; i < candidates.length; i++) {
      var c = candidates[i];
      var seen = {};
      for (var r = 0; r < data.rows.length; r++) {
        var raw = data.rows[r][c.idx];
        var nv = norm(raw);
        if (!nv || seen[nv]) continue;
        seen[nv] = true;
        if (nv.length >= 3 && nq.indexOf(nv) >= 0) return { col: c, value: raw };
      }
    }
    return null;
  }
  function groupBy(data, colIdx) {
    var map = new Map();
    data.rows.forEach(function (r) {
      var k = String(r[colIdx]).trim() || "(vacío)";
      map.set(k, (map.get(k) || 0) + 1);
    });
    return map;
  }

  /* ----------------------------------------------------------------------- *
   * Intérprete de lenguaje natural -> spec de output
   * (determinista: ideal para prototipo, sin llamadas externas)
   * ----------------------------------------------------------------------- */
  function interpret(query, data) {
    var cols = profile(data);
    var nq = norm(query);
    var enums = cols.filter(function (c) { return c.type === "enum"; });
    var dates = cols.filter(function (c) { return c.type === "date"; });
    var cats = cols.filter(function (c) { return c.type === "enum" || c.type === "text"; });
    var nums = cols.filter(function (c) { return c.type === "number"; });
    var mentioned = findColumnMention(query, cols);

    var wantsChart = /(grafic|grafica|grafico|visualiz|chart|barras|pastel|dona|tendencia)/.test(nq);
    var wantsCount = /(cuant|cuanto|cuanta|total|numero de|count|how many)/.test(nq);
    var wantsGroup = /(resum|resumen|agrupa|agrupar|por |desglos|distribuc|breakdown|reparto|cuantos por)/.test(nq);
    var wantsTop = /(top|mas |mayor|ranking|principales|los que mas)/.test(nq);
    var wantsFilter = /(filtr|muestra|solo |unicamente|donde |dame los|ensena|enséna)/.test(nq);
    var wantsMonth = /(mes|mensual|por fecha|tiempo|cuando)/.test(nq);

    // 1) Filtro por valor citado (ej. "solo Camión Pesado")
    var valHit = findValueMention(query, data, cols);
    if (wantsFilter && valHit) {
      var sub = data.rows.filter(function (r) { return norm(r[valHit.col.idx]) === norm(valHit.value); });
      return {
        reply: "Filtré la vista a " + sub.length + " documento(s) donde " + valHit.col.name + " = “" + valHit.value + "”.",
        followups: ["Gráfica de " + (enums[0] ? enums[0].name : "esto"), "Exporta esto a CSV", "¿Cuántos hay en total?"],
        spec: {
          kind: "view", id: uid(),
          title: valHit.col.name + ": " + valHit.value,
          meta: "Filtro · " + sub.length + " de " + data.rows.length + " filas",
          columns: data.columns, rows: sub, total: sub.length
        }
      };
    }

    // 2) Por mes (si hay fecha)
    if ((wantsMonth || (wantsGroup && dates.length && mentioned && mentioned.type === "date")) && dates.length) {
      var dcol = (mentioned && mentioned.type === "date") ? mentioned : dates[0];
      var byMonth = new Map();
      data.rows.forEach(function (r) {
        var k = monthKey(r[dcol.idx]);
        byMonth.set(k, (byMonth.get(k) || 0) + 1);
      });
      var keys = Array.from(byMonth.keys()).sort();
      var labels = keys.map(monthLabel), values = keys.map(function (k) { return byMonth.get(k); });
      return {
        reply: "Documentos por mes según " + dcol.name + ".",
        followups: ["Exporta esto a CSV", "Resume por " + (enums[0] ? enums[0].name : "categoría")],
        spec: {
          kind: "chart", id: uid(),
          title: "Documentos por mes",
          meta: "Línea · " + dcol.name,
          chartType: "line", labels: labels, values: values
        }
      };
    }

    // 3) Agrupar / gráfica por una categoría
    var groupCol = mentioned && (mentioned.type === "enum" || mentioned.type === "text") ? mentioned
                  : (enums[0] || cats[0]);
    if ((wantsGroup || wantsChart || wantsTop) && groupCol) {
      var map = groupBy(data, groupCol.idx);
      var entries = Array.from(map.entries()).sort(function (a, b) { return b[1] - a[1]; });
      var limit = wantsTop ? 5 : 12;
      entries = entries.slice(0, limit);
      var labels2 = entries.map(function (e) { return e[0]; });
      var values2 = entries.map(function (e) { return e[1]; });
      var isShare = /(pastel|dona|reparto|distribuc|share|porcentaje)/.test(nq);
      if (wantsChart) {
        return {
          reply: (wantsTop ? "Top " + limit + " de " : "Distribución por ") + groupCol.name + ".",
          followups: ["Vélo como tabla", "Exporta esto a CSV", "Filtra solo " + labels2[0]],
          spec: {
            kind: "chart", id: uid(),
            title: (wantsTop ? "Top " : "Por ") + groupCol.name,
            meta: (isShare ? "Dona" : "Barras") + " · agrupado por " + groupCol.name,
            chartType: isShare ? "donut" : "bar", labels: labels2, values: values2
          }
        };
      }
      return {
        reply: (wantsTop ? "Top " + limit + " de " : "Resumen por ") + groupCol.name + " (conteo de documentos).",
        followups: ["Gráfica de esto", "Exporta esto a CSV", "Filtra solo " + labels2[0]],
        spec: {
          kind: "summary", id: uid(),
          title: (wantsTop ? "Top " : "Resumen por ") + groupCol.name,
          meta: "Agrupado por " + groupCol.name + " · " + entries.length + " grupos",
          columns: [groupCol.name, "Documentos"],
          rows: entries.map(function (e) { return [e[0], e[1]]; }),
          chart: { type: "bar", labels: labels2, values: values2 }
        }
      };
    }

    // 4) Conteo / métrica
    if (wantsCount) {
      if (valHit) {
        var c2 = data.rows.filter(function (r) { return norm(r[valHit.col.idx]) === norm(valHit.value); }).length;
        return {
          reply: "Hay " + c2 + " documento(s) donde " + valHit.col.name + " = “" + valHit.value + "”.",
          followups: ["Filtra esos", "Resume por categoría"],
          spec: { kind: "metric", id: uid(), title: valHit.col.name + " = " + valHit.value, meta: "Conteo", value: c2, label: "documentos" }
        };
      }
      return {
        reply: "La Data View tiene " + data.rows.length + " documentos en " + data.columns.length + " columnas.",
        followups: ["Resume por " + (enums[0] ? enums[0].name : "categoría"), "Gráfica de " + (enums[0] ? enums[0].name : "categoría")],
        spec: { kind: "metric", id: uid(), title: "Total de documentos", meta: "Conteo", value: data.rows.length, label: "documentos" }
      };
    }

    // 5) Fallback: resumen útil de la tabla
    var topEnum = enums[0] || cats[0];
    var fb;
    if (topEnum) {
      var m = groupBy(data, topEnum.idx);
      var es = Array.from(m.entries()).sort(function (a, b) { return b[1] - a[1]; }).slice(0, 8);
      fb = {
        kind: "summary", id: uid(),
        title: "Resumen por " + topEnum.name,
        meta: "Sugerencia · agrupado por " + topEnum.name,
        columns: [topEnum.name, "Documentos"],
        rows: es.map(function (e) { return [e[0], e[1]]; }),
        chart: { type: "bar", labels: es.map(function (e) { return e[0]; }), values: es.map(function (e) { return e[1]; }) }
      };
    } else {
      fb = { kind: "metric", id: uid(), title: "Total de documentos", meta: "Resumen", value: data.rows.length, label: "documentos" };
    }
    return {
      reply: "No estoy seguro de qué buscas, así que te dejo un resumen. Prueba: “resume por " +
        (topEnum ? topEnum.name : "categoría") + "”, “gráfica de " + (topEnum ? topEnum.name : "categoría") +
        "” o “¿cuántos documentos hay?”.",
      followups: dynamicSuggestions(data),
      spec: fb
    };
  }

  function dynamicSuggestions(data) {
    var cols = profile(data);
    var enums = cols.filter(function (c) { return c.type === "enum"; });
    var dates = cols.filter(function (c) { return c.type === "date"; });
    var text = cols.filter(function (c) { return c.type === "text"; });
    var out = [];
    if (enums[0]) out.push("Resume por " + enums[0].name);
    if (enums[0]) out.push("Gráfica de " + enums[0].name);
    if (text[0]) out.push("Top " + text[0].name);
    if (dates[0]) out.push("¿Cuántos por mes?");
    out.push("¿Cuántos documentos hay?");
    return out.slice(0, 4);
  }

  /* ----------------------------------------------------------------------- *
   * Render de specs (mismo motor para chat y dashboard) + gráficas SVG
   * ----------------------------------------------------------------------- */
  var PALETTE = ["var(--s2a-accent)", "#22a06b", "#e8a33d", "#d9534f", "#3d8bfd", "#9b5de5", "#16a3a3", "#e36abd"];

  function renderSpec(spec, host) {
    host.innerHTML = "";
    if (spec.kind === "metric") {
      var box = document.createElement("div");
      box.className = "s2a-metric";
      box.innerHTML = '<div class="s2a-metric-val">' + fmtInt(spec.value) + "</div>" +
                      '<div class="s2a-metric-lbl">' + escapeHTML(spec.label || "") + "</div>";
      host.appendChild(box);
      return;
    }
    if (spec.kind === "chart") {
      host.appendChild(makeChart(spec.chartType, spec.labels, spec.values));
      return;
    }
    if (spec.kind === "summary") {
      if (spec.chart) host.appendChild(makeChart(spec.chart.type, spec.chart.labels, spec.chart.values));
      host.appendChild(makeTable(spec.columns, spec.rows, 8));
      return;
    }
    if (spec.kind === "view") {
      var cap = document.createElement("div");
      cap.className = "s2a-cap";
      cap.textContent = spec.total + " resultado(s)";
      host.appendChild(cap);
      host.appendChild(makeTable(spec.columns, spec.rows, 6));
      return;
    }
  }

  function makeTable(columns, rows, max) {
    var wrap = document.createElement("div");
    wrap.className = "s2a-tablewrap";
    var t = document.createElement("table");
    t.className = "s2a-table";
    var thead = "<thead><tr>" + columns.map(function (c) { return "<th>" + escapeHTML(c) + "</th>"; }).join("") + "</tr></thead>";
    var shown = rows.slice(0, max);
    var tbody = "<tbody>" + shown.map(function (r) {
      return "<tr>" + r.map(function (v) { return "<td>" + escapeHTML(v) + "</td>"; }).join("") + "</tr>";
    }).join("") + "</tbody>";
    t.innerHTML = thead + tbody;
    wrap.appendChild(t);
    if (rows.length > max) {
      var more = document.createElement("div");
      more.className = "s2a-more";
      more.textContent = "+" + (rows.length - max) + " más";
      wrap.appendChild(more);
    }
    return wrap;
  }

  function makeChart(type, labels, values) {
    var wrap = document.createElement("div");
    wrap.className = "s2a-chart";
    if (type === "donut") wrap.innerHTML = donutSVG(labels, values);
    else if (type === "line") wrap.innerHTML = lineSVG(labels, values);
    else wrap.innerHTML = barSVG(labels, values);
    return wrap;
  }

  function barSVG(labels, values) {
    var W = 520, H = 200, padL = 8, padR = 8, padT = 12, padB = 40;
    var max = Math.max.apply(null, values.concat([1]));
    var n = values.length || 1;
    var bw = (W - padL - padR) / n;
    var bars = values.map(function (v, i) {
      var h = (H - padT - padB) * (v / max);
      var x = padL + i * bw + bw * 0.16;
      var y = H - padB - h;
      var w = bw * 0.68;
      var color = PALETTE[i % PALETTE.length];
      var lbl = String(labels[i] == null ? "" : labels[i]);
      if (lbl.length > 10) lbl = lbl.slice(0, 9) + "…";
      return '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + Math.max(h, 1) +
             '" rx="4" fill="' + color + '"></rect>' +
             '<text class="s2a-svg-val" x="' + (x + w / 2) + '" y="' + (y - 5) + '" text-anchor="middle">' + v + "</text>" +
             '<text class="s2a-svg-lbl" x="' + (x + w / 2) + '" y="' + (H - padB + 16) + '" text-anchor="middle">' + escapeHTML(lbl) + "</text>";
    }).join("");
    return '<svg viewBox="0 0 ' + W + " " + H + '" width="100%" role="img">' + bars + "</svg>";
  }

  function lineSVG(labels, values) {
    var W = 520, H = 200, padL = 28, padR = 12, padT = 14, padB = 40;
    var max = Math.max.apply(null, values.concat([1]));
    var n = values.length;
    var stepX = n > 1 ? (W - padL - padR) / (n - 1) : 0;
    var pts = values.map(function (v, i) {
      var x = padL + i * stepX;
      var y = H - padB - (H - padT - padB) * (v / max);
      return [x, y];
    });
    var path = pts.map(function (p, i) { return (i ? "L" : "M") + p[0] + " " + p[1]; }).join(" ");
    var area = path + " L" + (pts[n - 1] ? pts[n - 1][0] : padL) + " " + (H - padB) + " L" + padL + " " + (H - padB) + " Z";
    var dots = pts.map(function (p, i) {
      return '<circle cx="' + p[0] + '" cy="' + p[1] + '" r="3.2" fill="var(--s2a-accent)"></circle>' +
             '<text class="s2a-svg-val" x="' + p[0] + '" y="' + (p[1] - 8) + '" text-anchor="middle">' + values[i] + "</text>";
    }).join("");
    var xlabels = labels.map(function (l, i) {
      var x = padL + i * stepX;
      var s = String(l); if (s.length > 8) s = s.slice(0, 7) + "…";
      return '<text class="s2a-svg-lbl" x="' + x + '" y="' + (H - padB + 16) + '" text-anchor="middle">' + escapeHTML(s) + "</text>";
    }).join("");
    return '<svg viewBox="0 0 ' + W + " " + H + '" width="100%" role="img">' +
      '<path d="' + area + '" fill="var(--s2a-accent-soft)"></path>' +
      '<path d="' + path + '" fill="none" stroke="var(--s2a-accent)" stroke-width="2.5" stroke-linejoin="round"></path>' +
      dots + xlabels + "</svg>";
  }

  function donutSVG(labels, values) {
    var size = 200, cx = 100, cy = 100, r = 70, sw = 30;
    var total = values.reduce(function (a, b) { return a + b; }, 0) || 1;
    var C = 2 * Math.PI * r, offset = 0;
    var arcs = values.map(function (v, i) {
      var frac = v / total, len = frac * C;
      var seg = '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="none" stroke="' +
        PALETTE[i % PALETTE.length] + '" stroke-width="' + sw + '" stroke-dasharray="' + len + " " + (C - len) +
        '" stroke-dashoffset="' + (-offset) + '" transform="rotate(-90 ' + cx + " " + cy + ')"></circle>';
      offset += len;
      return seg;
    }).join("");
    var legend = labels.map(function (l, i) {
      var pct = Math.round((values[i] / total) * 100);
      var s = String(l); if (s.length > 16) s = s.slice(0, 15) + "…";
      return '<div class="s2a-leg-item"><span class="s2a-leg-dot" style="background:' + PALETTE[i % PALETTE.length] +
        '"></span><span class="s2a-leg-txt">' + escapeHTML(s) + '</span><span class="s2a-leg-pct">' + pct + "%</span></div>";
    }).join("");
    return '<div class="s2a-donut"><svg viewBox="0 0 ' + size + " " + size + '" width="120" height="120" role="img">' +
      arcs + '<text x="' + cx + '" y="' + (cy + 5) + '" text-anchor="middle" class="s2a-donut-total">' + total + "</text></svg>" +
      '<div class="s2a-legend">' + legend + "</div></div>";
  }

  // Forma tabular para exportar CSV desde un spec
  function specToCSV(spec) {
    var cols, rows;
    if (spec.kind === "summary" || spec.kind === "view") { cols = spec.columns; rows = spec.rows; }
    else if (spec.kind === "chart") { cols = ["Etiqueta", "Valor"]; rows = spec.labels.map(function (l, i) { return [l, spec.values[i]]; }); }
    else if (spec.kind === "metric") { cols = ["Métrica", "Valor"]; rows = [[spec.title, spec.value]]; }
    else { cols = []; rows = []; }
    var lines = [cols.map(csvCell).join(",")];
    rows.forEach(function (r) { lines.push(r.map(csvCell).join(",")); });
    return lines.join("\n");
  }

  /* ----------------------------------------------------------------------- *
   * UI — Shadow DOM, FAB, chat, dashboard
   * ----------------------------------------------------------------------- */
  function boot() {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", mount, { once: true });
    } else {
      mount();
    }
  }

  function mount() {
    var host = document.createElement("div");
    host.id = "silia-agent-host";
    host.style.position = "relative";
    host.style.zIndex = "2147483000";
    document.body.appendChild(host);
    bridgeTheme(host);

    var root = host.attachShadow({ mode: "open" });
    var style = document.createElement("style");
    style.textContent = CSS;
    root.appendChild(style);

    var ui = document.createElement("div");
    ui.innerHTML = TEMPLATE;
    root.appendChild(ui);

    var $ = function (sel) { return root.querySelector(sel); };
    var $$ = function (sel) { return Array.prototype.slice.call(root.querySelectorAll(sel)); };

    var state = { dashboard: loadDash() };

    /* ---- FAB + leyenda ---- */
    var fab = $(".s2a-fab");
    var panel = $(".s2a-panel");
    var legendShown = true;
    setTimeout(function () { if (legendShown && !panel.classList.contains("open")) collapseLegend(); }, 6000);
    function collapseLegend() { fab.classList.add("collapsed"); legendShown = false; }

    fab.addEventListener("click", function () {
      collapseLegend();
      panel.classList.toggle("open");
      if (panel.classList.contains("open")) {
        refreshSource();
        setTimeout(function () { $(".s2a-input").focus(); }, 50);
      }
    });
    $(".s2a-close").addEventListener("click", function () { panel.classList.remove("open"); });
    root.addEventListener("keydown", function (e) {
      if (e.key === "Escape") {
        if ($(".s2a-dash").classList.contains("open")) closeDash();
        else panel.classList.remove("open");
      }
    });

    /* ---- fuente de datos (en vivo / ejemplo) ---- */
    var dataCache = null;
    function getData() { if (!dataCache) dataCache = readDataView(); return dataCache; }
    function refreshSource() {
      dataCache = readDataView();
      var d = dataCache;
      var tag = $(".s2a-source");
      if (d.source === "live") {
        tag.innerHTML = '<span class="s2a-dot live"></span> Leyendo la tabla actual · ' + d.rows.length + " filas";
      } else {
        tag.innerHTML = '<span class="s2a-dot sample"></span> Datos de ejemplo (no encontré la tabla en pantalla)';
      }
      renderSuggestions();
    }

    /* ---- sugerencias contextuales ---- */
    function renderSuggestions() {
      var box = $(".s2a-suggest");
      box.innerHTML = "";
      dynamicSuggestions(getData()).forEach(function (s) {
        var b = document.createElement("button");
        b.className = "s2a-chip";
        b.textContent = s;
        b.addEventListener("click", function () { send(s); });
        box.appendChild(b);
      });
    }

    /* ---- mensajes del chat ---- */
    var thread = $(".s2a-thread");
    function addUser(text) {
      var el = document.createElement("div");
      el.className = "s2a-msg user";
      el.innerHTML = '<div class="s2a-bubble">' + escapeHTML(text) + "</div>";
      thread.appendChild(el);
      scroll();
    }
    function addAgent(result) {
      var el = document.createElement("div");
      el.className = "s2a-msg agent";
      var card = document.createElement("div");
      card.className = "s2a-out";

      var head = document.createElement("div");
      head.className = "s2a-out-head";
      head.innerHTML =
        '<div class="s2a-out-titles"><div class="s2a-out-title">' + escapeHTML(result.spec.title) + "</div>" +
        '<div class="s2a-out-meta">' + escapeHTML(result.spec.meta || "") + "</div></div>" +
        '<div class="s2a-out-actions">' +
          '<button class="s2a-btn pin" title="Fijar al dashboard">' + ICON.pin + " Fijar</button>" +
          '<button class="s2a-btn ghost export" title="Exportar CSV">' + ICON.dl + "</button>" +
        "</div>";
      var body = document.createElement("div");
      body.className = "s2a-out-body";
      renderSpec(result.spec, body);

      card.appendChild(head);
      card.appendChild(body);

      var reply = document.createElement("div");
      reply.className = "s2a-bubble agent-bubble";
      reply.textContent = result.reply;

      el.appendChild(reply);
      el.appendChild(card);

      if (result.followups && result.followups.length) {
        var fu = document.createElement("div");
        fu.className = "s2a-suggest inline";
        result.followups.forEach(function (s) {
          var b = document.createElement("button");
          b.className = "s2a-chip";
          b.textContent = s;
          b.addEventListener("click", function () { send(s); });
          fu.appendChild(b);
        });
        el.appendChild(fu);
      }

      head.querySelector(".pin").addEventListener("click", function () {
        pinToDash(result.spec);
        flash(head.querySelector(".pin"), "Fijado ✓");
      });
      head.querySelector(".export").addEventListener("click", function () {
        download(slug(result.spec.title) + ".csv", specToCSV(result.spec));
      });

      thread.appendChild(el);
      scroll();
    }
    function flash(btn, txt) {
      var old = btn.innerHTML; btn.innerHTML = txt; btn.disabled = true;
      setTimeout(function () { btn.innerHTML = old; btn.disabled = false; }, 1200);
    }
    function scroll() { thread.scrollTop = thread.scrollHeight; }

    function send(text) {
      var q = (text != null ? text : $(".s2a-input").value).trim();
      if (!q) return;
      $(".s2a-input").value = "";
      $(".s2a-welcome") && $(".s2a-welcome").remove();
      addUser(q);
      var typing = document.createElement("div");
      typing.className = "s2a-msg agent";
      typing.innerHTML = '<div class="s2a-bubble agent-bubble s2a-typing"><span></span><span></span><span></span></div>';
      thread.appendChild(typing); scroll();
      setTimeout(function () {
        typing.remove();
        var result = interpret(q, getData());
        addAgent(result);
      }, 430);
    }
    $(".s2a-send").addEventListener("click", function () { send(); });
    $(".s2a-input").addEventListener("keydown", function (e) {
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
    });

    /* ---- reset del chat (no borra el dashboard) ---- */
    $(".s2a-reset").addEventListener("click", function () {
      thread.innerHTML = WELCOME;
      renderSuggestions();
    });

    /* ---- dashboard: abrir/cerrar ---- */
    $(".s2a-dash-open").addEventListener("click", openDash);
    $(".s2a-dash-close").addEventListener("click", closeDash);
    function openDash() { $(".s2a-dash").classList.add("open"); renderDash(); }
    function closeDash() { $(".s2a-dash").classList.remove("open"); }

    function pinToDash(spec) {
      state.dashboard.push({ id: spec.id || uid(), size: spec.kind === "metric" ? "half" : "full", spec: spec });
      saveDash(state.dashboard);
      bumpBadge();
    }
    function bumpBadge() {
      var b = $(".s2a-dash-badge");
      b.textContent = state.dashboard.length;
      b.style.display = state.dashboard.length ? "inline-flex" : "none";
    }
    bumpBadge();

    /* ---- dashboard: render + arrastrar/reordenar + resize ---- */
    var grid = $(".s2a-dgrid");
    function renderDash() {
      grid.innerHTML = "";
      if (!state.dashboard.length) {
        $(".s2a-dempty").style.display = "flex";
        return;
      }
      $(".s2a-dempty").style.display = "none";
      state.dashboard.forEach(function (item) { grid.appendChild(makeDashCard(item)); });
    }

    function makeDashCard(item) {
      var card = document.createElement("div");
      card.className = "s2a-dcard" + (item.size === "full" ? " full" : "");
      card.dataset.id = item.id;

      var head = document.createElement("div");
      head.className = "s2a-dcard-head";
      head.innerHTML =
        '<button class="s2a-grip" title="Arrastrar para reordenar" aria-label="Arrastrar">' + ICON.grip + "</button>" +
        '<div class="s2a-dcard-titles"><div class="s2a-dcard-title">' + escapeHTML(item.spec.title) + "</div>" +
        '<div class="s2a-dcard-meta">' + escapeHTML(item.spec.meta || "") + "</div></div>" +
        '<div class="s2a-dcard-actions">' +
          '<button class="s2a-iconbtn size" title="Media / sección completa">' + (item.size === "full" ? ICON.half : ICON.full) + "</button>" +
          '<button class="s2a-iconbtn export" title="Exportar CSV">' + ICON.dl + "</button>" +
          '<button class="s2a-iconbtn remove" title="Quitar">' + ICON.x + "</button>" +
        "</div>";

      var body = document.createElement("div");
      body.className = "s2a-dcard-body";
      renderSpec(item.spec, body);

      card.appendChild(head);
      card.appendChild(body);

      head.querySelector(".size").addEventListener("click", function () {
        item.size = item.size === "full" ? "half" : "full";
        card.classList.toggle("full", item.size === "full");
        head.querySelector(".size").innerHTML = item.size === "full" ? ICON.half : ICON.full;
        saveDash(state.dashboard);
      });
      head.querySelector(".export").addEventListener("click", function () {
        download(slug(item.spec.title) + ".csv", specToCSV(item.spec));
      });
      head.querySelector(".remove").addEventListener("click", function () {
        state.dashboard = state.dashboard.filter(function (x) { return x.id !== item.id; });
        saveDash(state.dashboard); renderDash(); bumpBadge();
      });

      enableDrag(card, head.querySelector(".s2a-grip"));
      return card;
    }

    // arrastrar/reordenar con puntero (mouse + touch), reflujo en vivo
    function enableDrag(card, handle) {
      handle.addEventListener("pointerdown", function (e) {
        e.preventDefault();
        handle.setPointerCapture(e.pointerId);
        card.classList.add("s2a-dragging");
        var move = function (ev) {
          var after = dragAfter(grid, ev.clientY);
          if (after == null) grid.appendChild(card);
          else if (after !== card) grid.insertBefore(card, after);
        };
        var up = function (ev) {
          handle.releasePointerCapture(e.pointerId);
          handle.removeEventListener("pointermove", move);
          handle.removeEventListener("pointerup", up);
          card.classList.remove("s2a-dragging");
          syncOrder();
        };
        handle.addEventListener("pointermove", move);
        handle.addEventListener("pointerup", up);
      });
    }
    function dragAfter(container, y) {
      var els = Array.prototype.slice.call(container.querySelectorAll(".s2a-dcard:not(.s2a-dragging)"));
      var closest = { offset: -Infinity, el: null };
      els.forEach(function (child) {
        var box = child.getBoundingClientRect();
        var offset = y - box.top - box.height / 2;
        if (offset < 0 && offset > closest.offset) closest = { offset: offset, el: child };
      });
      return closest.el;
    }
    function syncOrder() {
      var ids = Array.prototype.slice.call(grid.querySelectorAll(".s2a-dcard")).map(function (c) { return c.dataset.id; });
      state.dashboard.sort(function (a, b) { return ids.indexOf(a.id) - ids.indexOf(b.id); });
      saveDash(state.dashboard);
    }

    function slug(s) { return norm(s).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "silia-output"; }

    // primer pintado
    refreshSource();
  }

  /* ----------------------------------------------------------------------- *
   * Iconos (SVG inline) + plantilla + CSS
   * ----------------------------------------------------------------------- */
  var ICON = {
    spark: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1"/><circle cx="12" cy="12" r="3.2"/></svg>',
    pin: '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 4h6M10 4l1 7-3 2v2h8v-2l-3-2 1-7M12 17v3"/></svg>',
    dl: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v10M8 11l4 3 4-3M5 19h14"/></svg>',
    grip: '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><circle cx="9" cy="6" r="1.4"/><circle cx="15" cy="6" r="1.4"/><circle cx="9" cy="12" r="1.4"/><circle cx="15" cy="12" r="1.4"/><circle cx="9" cy="18" r="1.4"/><circle cx="15" cy="18" r="1.4"/></svg>',
    x: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    full: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="6" width="16" height="12" rx="1.5"/></svg>',
    half: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="6" width="7.5" height="12" rx="1.5"/></svg>'
  };

  var WELCOME =
    '<div class="s2a-welcome">' +
      '<div class="s2a-welcome-ic">' + ICON.spark + "</div>" +
      "<h4>Pregúntale a tus datos</h4>" +
      "<p>Filtra, resume o visualiza la Data View en lenguaje natural. " +
      "Cada respuesta puedes <b>fijarla al dashboard</b> o <b>exportarla</b>.</p>" +
    "</div>";

  var TEMPLATE =
    // FAB
    '<button class="s2a-fab" aria-label="Abrir agente Talk-to-Data">' +
      '<span class="s2a-fab-ic">' + ICON.spark + "</span>" +
      '<span class="s2a-fab-label">Pregúntale a tus datos</span>' +
    "</button>" +
    // Panel del chat
    '<section class="s2a-panel" role="dialog" aria-label="Agente Talk-to-Data">' +
      '<header class="s2a-head">' +
        '<div class="s2a-head-l"><span class="s2a-head-ic">' + ICON.spark + "</span>" +
          '<div><div class="s2a-head-title">Talk-to-Data</div>' +
          '<div class="s2a-source"></div></div></div>' +
        '<div class="s2a-head-r">' +
          '<button class="s2a-dash-open" title="Ver dashboard">Dashboard <span class="s2a-dash-badge"></span></button>' +
          '<button class="s2a-reset" title="Reiniciar chat">Reiniciar</button>' +
          '<button class="s2a-close" aria-label="Cerrar">' + ICON.x + "</button>" +
        "</div>" +
      "</header>" +
      '<div class="s2a-thread">' + WELCOME + "</div>" +
      '<div class="s2a-suggest"></div>' +
      '<div class="s2a-inputbar">' +
        '<input class="s2a-input" type="text" placeholder="Ej. Resume por Tipo de Camión…" autocomplete="off">' +
        '<button class="s2a-send" aria-label="Enviar">' +
          '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>' +
        "</button>" +
      "</div>" +
    "</section>" +
    // Dashboard
    '<section class="s2a-dash" role="dialog" aria-label="Dashboard">' +
      '<div class="s2a-dash-card">' +
        '<header class="s2a-dash-head">' +
          "<div><div class=\"s2a-dash-title\">Dashboard</div>" +
          '<div class="s2a-dash-sub">Arrastra para reordenar · cambia entre media sección y sección completa</div></div>' +
          '<button class="s2a-dash-close" aria-label="Cerrar dashboard">' + ICON.x + "</button>" +
        "</header>" +
        '<div class="s2a-dgrid"></div>' +
        '<div class="s2a-dempty">' +
          '<div class="s2a-dempty-ic">' + ICON.pin + "</div>" +
          "<p>Aún no has fijado nada.<br>Pídele algo al agente y toca <b>“Fijar”</b>.</p>" +
        "</div>" +
      "</div>" +
    "</section>";

  var CSS = "\
:host, * { box-sizing: border-box; }\
:host { all: initial; }\
.s2a-fab, .s2a-panel, .s2a-dash { font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }\
\
/* FAB */\
.s2a-fab { position: fixed; right: 22px; bottom: 22px; height: 52px; display: flex; align-items: center; gap: 10px;\
  padding: 0 18px 0 14px; border: none; border-radius: 26px; cursor: pointer; color: #fff;\
  background: var(--s2a-accent); box-shadow: 0 8px 24px rgba(20,20,60,.28); transition: transform .18s ease, box-shadow .18s ease;\
  z-index: 2; }\
.s2a-fab:hover { transform: translateY(-2px); box-shadow: 0 12px 30px rgba(20,20,60,.34); }\
.s2a-fab-ic { display: inline-flex; }\
.s2a-fab-ic svg { animation: s2a-pulse 2.6s ease-in-out infinite; }\
.s2a-fab-label { font-size: 14px; font-weight: 600; white-space: nowrap; max-width: 220px; overflow: hidden;\
  transition: max-width .3s ease, opacity .2s ease, margin .3s ease; }\
.s2a-fab.collapsed { padding: 0; width: 52px; justify-content: center; }\
.s2a-fab.collapsed .s2a-fab-label { max-width: 0; opacity: 0; margin: 0; }\
@keyframes s2a-pulse { 0%,100% { opacity: 1; } 50% { opacity: .55; } }\
\
/* Panel */\
.s2a-panel { position: fixed; right: 22px; bottom: 86px; width: 400px; max-width: calc(100vw - 32px);\
  height: 620px; max-height: calc(100vh - 110px); background: var(--s2a-bg); color: var(--s2a-text);\
  border: 1px solid var(--s2a-split); border-radius: 18px; box-shadow: 0 24px 70px rgba(15,18,40,.30);\
  display: none; flex-direction: column; overflow: hidden; z-index: 3; transform: translateY(8px) scale(.98); opacity: 0;\
  transition: opacity .18s ease, transform .18s ease; }\
.s2a-panel.open { display: flex; transform: translateY(0) scale(1); opacity: 1; }\
.s2a-head { display: flex; align-items: center; justify-content: space-between; padding: 12px 12px 12px 14px;\
  border-bottom: 1px solid var(--s2a-split); }\
.s2a-head-l { display: flex; align-items: center; gap: 10px; }\
.s2a-head-ic { width: 30px; height: 30px; border-radius: 9px; background: var(--s2a-accent-soft); color: var(--s2a-accent);\
  display: inline-flex; align-items: center; justify-content: center; }\
.s2a-head-ic svg { width: 18px; height: 18px; }\
.s2a-head-title { font-size: 14px; font-weight: 700; line-height: 1.1; }\
.s2a-source { font-size: 11px; color: var(--s2a-sub); margin-top: 2px; display: flex; align-items: center; gap: 5px; }\
.s2a-dot { width: 7px; height: 7px; border-radius: 50%; display: inline-block; }\
.s2a-dot.live { background: #22a06b; box-shadow: 0 0 0 3px rgba(34,160,107,.18); }\
.s2a-dot.sample { background: #e8a33d; box-shadow: 0 0 0 3px rgba(232,163,61,.18); }\
.s2a-head-r { display: flex; align-items: center; gap: 6px; }\
.s2a-dash-open, .s2a-reset { border: 1px solid var(--s2a-split); background: transparent; color: var(--s2a-text);\
  font-size: 12px; font-weight: 600; padding: 6px 10px; border-radius: 9px; cursor: pointer; font-family: inherit; }\
.s2a-dash-open { display: inline-flex; align-items: center; gap: 6px; }\
.s2a-dash-open:hover, .s2a-reset:hover { background: var(--s2a-accent-soft); border-color: transparent; }\
.s2a-dash-badge { display: none; align-items: center; justify-content: center; min-width: 17px; height: 17px; padding: 0 4px;\
  border-radius: 9px; background: var(--s2a-accent); color: #fff; font-size: 10px; font-weight: 700; }\
.s2a-close { border: none; background: transparent; color: var(--s2a-sub); cursor: pointer; padding: 6px; border-radius: 8px;\
  display: inline-flex; }\
.s2a-close:hover { background: var(--s2a-accent-soft); color: var(--s2a-text); }\
\
/* Thread */\
.s2a-thread { flex: 1; overflow-y: auto; padding: 16px 14px 6px; }\
.s2a-welcome { text-align: center; padding: 28px 18px; color: var(--s2a-sub); }\
.s2a-welcome-ic { width: 46px; height: 46px; border-radius: 14px; margin: 0 auto 12px; background: var(--s2a-accent-soft);\
  color: var(--s2a-accent); display: flex; align-items: center; justify-content: center; }\
.s2a-welcome h4 { margin: 0 0 6px; font-size: 16px; color: var(--s2a-text); }\
.s2a-welcome p { margin: 0; font-size: 13px; line-height: 1.5; }\
.s2a-msg { margin-bottom: 14px; display: flex; flex-direction: column; }\
.s2a-msg.user { align-items: flex-end; }\
.s2a-bubble { max-width: 86%; padding: 9px 13px; border-radius: 14px; font-size: 13.5px; line-height: 1.45; }\
.s2a-msg.user .s2a-bubble { background: var(--s2a-accent); color: #fff; border-bottom-right-radius: 5px; }\
.agent-bubble { background: var(--s2a-accent-soft); color: var(--s2a-text); border-bottom-left-radius: 5px; align-self: flex-start; }\
.s2a-typing { display: inline-flex; gap: 4px; }\
.s2a-typing span { width: 6px; height: 6px; border-radius: 50%; background: var(--s2a-accent); opacity: .5; animation: s2a-blink 1.2s infinite; }\
.s2a-typing span:nth-child(2) { animation-delay: .2s; } .s2a-typing span:nth-child(3) { animation-delay: .4s; }\
@keyframes s2a-blink { 0%,100% { opacity: .3; transform: translateY(0); } 50% { opacity: 1; transform: translateY(-2px); } }\
\
/* Output card (chat) */\
.s2a-out { margin-top: 8px; border: 1px solid var(--s2a-split); border-radius: 14px; overflow: hidden; background: var(--s2a-bg);\
  box-shadow: 0 2px 6px rgba(15,18,40,.05); align-self: stretch; }\
.s2a-out-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; padding: 11px 12px;\
  border-bottom: 1px solid var(--s2a-split); }\
.s2a-out-title { font-size: 13px; font-weight: 700; }\
.s2a-out-meta { font-size: 11px; color: var(--s2a-sub); margin-top: 2px; }\
.s2a-out-actions { display: flex; gap: 6px; flex-shrink: 0; }\
.s2a-btn { display: inline-flex; align-items: center; gap: 5px; border: 1px solid var(--s2a-split); background: transparent;\
  color: var(--s2a-text); font-size: 11.5px; font-weight: 600; padding: 5px 9px; border-radius: 8px; cursor: pointer; font-family: inherit; }\
.s2a-btn.pin { background: var(--s2a-accent); color: #fff; border-color: transparent; }\
.s2a-btn.pin:hover { filter: brightness(1.07); }\
.s2a-btn.ghost:hover { background: var(--s2a-accent-soft); border-color: transparent; }\
.s2a-out-body { padding: 12px; }\
.s2a-cap { font-size: 11px; color: var(--s2a-sub); margin-bottom: 8px; }\
\
/* Suggestions / chips */\
.s2a-suggest { display: flex; flex-wrap: wrap; gap: 7px; padding: 4px 14px 10px; }\
.s2a-suggest.inline { padding: 10px 0 0; }\
.s2a-chip { border: 1px solid var(--s2a-split); background: transparent; color: var(--s2a-accent); font-size: 12px; font-weight: 600;\
  padding: 6px 11px; border-radius: 16px; cursor: pointer; font-family: inherit; transition: background .15s ease; white-space: nowrap; }\
.s2a-chip:hover { background: var(--s2a-accent-soft); }\
\
/* Input */\
.s2a-inputbar { display: flex; gap: 8px; padding: 10px 12px; border-top: 1px solid var(--s2a-split); background: var(--s2a-bg); }\
.s2a-input { flex: 1; border: 1px solid var(--s2a-split); border-radius: 11px; padding: 10px 12px; font-size: 13.5px;\
  color: var(--s2a-text); background: var(--s2a-bg); outline: none; font-family: inherit; }\
.s2a-input:focus { border-color: var(--s2a-accent); box-shadow: 0 0 0 3px var(--s2a-accent-soft); }\
.s2a-send { border: none; background: var(--s2a-accent); color: #fff; width: 40px; border-radius: 11px; cursor: pointer;\
  display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0; }\
.s2a-send:hover { filter: brightness(1.07); }\
\
/* Tables & charts */\
.s2a-tablewrap { overflow-x: auto; }\
.s2a-table { width: 100%; border-collapse: collapse; font-size: 12px; }\
.s2a-table th { text-align: left; color: var(--s2a-sub); font-weight: 600; padding: 6px 8px; border-bottom: 1px solid var(--s2a-split); white-space: nowrap; }\
.s2a-table td { padding: 6px 8px; border-bottom: 1px solid var(--s2a-split); color: var(--s2a-text); }\
.s2a-table tr:last-child td { border-bottom: none; }\
.s2a-more { font-size: 11px; color: var(--s2a-sub); padding: 6px 8px; }\
.s2a-chart { margin-bottom: 10px; }\
.s2a-chart:last-child { margin-bottom: 0; }\
.s2a-svg-val { fill: var(--s2a-sub); font-size: 10px; font-family: inherit; }\
.s2a-svg-lbl { fill: var(--s2a-sub); font-size: 10px; font-family: inherit; }\
.s2a-metric { text-align: center; padding: 14px 8px; }\
.s2a-metric-val { font-size: 38px; font-weight: 800; color: var(--s2a-accent); line-height: 1; }\
.s2a-metric-lbl { font-size: 12px; color: var(--s2a-sub); margin-top: 6px; }\
.s2a-donut { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; }\
.s2a-donut-total { fill: var(--s2a-text); font-size: 22px; font-weight: 800; font-family: inherit; }\
.s2a-legend { flex: 1; min-width: 130px; display: flex; flex-direction: column; gap: 5px; }\
.s2a-leg-item { display: flex; align-items: center; gap: 7px; font-size: 12px; }\
.s2a-leg-dot { width: 9px; height: 9px; border-radius: 3px; flex-shrink: 0; }\
.s2a-leg-txt { flex: 1; color: var(--s2a-text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }\
.s2a-leg-pct { color: var(--s2a-sub); font-weight: 600; }\
\
/* Dashboard */\
.s2a-dash { position: fixed; inset: 0; background: rgba(12,14,30,.42); backdrop-filter: blur(2px);\
  display: none; align-items: center; justify-content: center; padding: 24px; z-index: 5; }\
.s2a-dash.open { display: flex; }\
.s2a-dash-card { width: 1080px; max-width: 100%; height: 86vh; background: var(--s2a-bg); color: var(--s2a-text);\
  border-radius: 18px; box-shadow: 0 30px 80px rgba(10,12,30,.45); display: flex; flex-direction: column; overflow: hidden; }\
.s2a-dash-head { display: flex; align-items: center; justify-content: space-between; padding: 16px 20px;\
  border-bottom: 1px solid var(--s2a-split); }\
.s2a-dash-title { font-size: 17px; font-weight: 800; }\
.s2a-dash-sub { font-size: 12px; color: var(--s2a-sub); margin-top: 3px; }\
.s2a-dgrid { flex: 1; overflow-y: auto; padding: 18px; display: flex; flex-wrap: wrap; gap: 16px; align-content: flex-start; }\
.s2a-dcard { flex: 1 1 calc(50% - 8px); min-width: 0; max-width: 100%; border: 1px solid var(--s2a-split); border-radius: 14px;\
  background: var(--s2a-bg); box-shadow: 0 2px 8px rgba(15,18,40,.05); overflow: hidden; display: flex; flex-direction: column; }\
.s2a-dcard.full { flex-basis: 100%; }\
.s2a-dcard.s2a-dragging { opacity: .45; outline: 2px dashed var(--s2a-accent); }\
.s2a-dcard-head { display: flex; align-items: center; gap: 8px; padding: 10px 12px; border-bottom: 1px solid var(--s2a-split); }\
.s2a-grip { border: none; background: transparent; color: var(--s2a-sub); cursor: grab; padding: 2px; display: inline-flex; touch-action: none; }\
.s2a-grip:active { cursor: grabbing; }\
.s2a-dcard-titles { flex: 1; min-width: 0; }\
.s2a-dcard-title { font-size: 13px; font-weight: 700; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }\
.s2a-dcard-meta { font-size: 11px; color: var(--s2a-sub); margin-top: 1px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }\
.s2a-dcard-actions { display: flex; gap: 3px; flex-shrink: 0; }\
.s2a-iconbtn { border: none; background: transparent; color: var(--s2a-sub); cursor: pointer; padding: 5px; border-radius: 7px; display: inline-flex; }\
.s2a-iconbtn:hover { background: var(--s2a-accent-soft); color: var(--s2a-text); }\
.s2a-dcard-body { padding: 14px; overflow-x: auto; }\
.s2a-dempty { flex: 1; display: none; flex-direction: column; align-items: center; justify-content: center; color: var(--s2a-sub); text-align: center; }\
.s2a-dempty-ic { width: 52px; height: 52px; border-radius: 16px; background: var(--s2a-accent-soft); color: var(--s2a-accent);\
  display: flex; align-items: center; justify-content: center; margin-bottom: 14px; }\
.s2a-dempty-ic svg { width: 24px; height: 24px; }\
.s2a-dempty p { font-size: 13.5px; line-height: 1.6; margin: 0; }\
\
@media (max-width: 620px) {\
  .s2a-panel { right: 8px; left: 8px; width: auto; bottom: 80px; height: calc(100vh - 100px); }\
  .s2a-dcard { flex-basis: 100% !important; }\
  .s2a-dash { padding: 0; }\
  .s2a-dash-card { height: 100vh; border-radius: 0; }\
}";

})();
