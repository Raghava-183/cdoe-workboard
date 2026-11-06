/*
  Reads calendar spreadsheets into a list of events.

  Three layouts are understood:
   1. A table:  Start date | End date | Title | Type | For   (headings in the first rows)
   2. Activity-calendar grid: a row of day numbers, with the events typed in the cells
      underneath each day (the department Activity Calendar workbook).
   3. COE grid: each day box holds the date and the events on new lines, often as
      "• July 2025 – Sem III: Continuous Assessment – I Submission Window Open"
      (the Master Calendar of Events workbook).

  Works in the browser (window.CDOEImport) and in Node for testing.
*/
(function (root) {
  "use strict";

  const MONTHS = ["january","february","march","april","may","june","july","august","september","october","november","december"];
  const MABBR = MONTHS.map(m => m.slice(0, 3));
  const pad = n => String(n).padStart(2, "0");
  const isoOf = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;
  const addDays = (s, n) => { const [y, m, d] = s.split("-").map(Number); const t = new Date(Date.UTC(y, m - 1, d + n)); return isoOf(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate()); };
  const weekday = (y, m, d) => (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;   // Monday = 0
  const clean = s => String(s ?? "").replace(/ /g, " ").replace(/[ \t]+/g, " ").trim();

  /* ---------- tidy titles ---------- */
  const FIXES = [[/\bbatchs\b/gi, "batches"], [/\bbacths\b/gi, "batches"], [/Enterprenorship/gi, "Entrepreneurship"],
    [/Durgaastami/gi, "Durgashtami"], [/Vinayaka Chavathi/gi, "Vinayaka Chavithi"], [/Independence day/g, "Independence Day"],
    [/BATCH_\s*/g, "Batch – "], [/\s*-\s*-\s*/g, " – "], [/\s+([,:;])/g, "$1"], [/\(\s+/g, "("], [/\s+\)/g, ")"],
    [/\s+-\s+/g, " – "], [/Semester\s*[–-]\s*([IVX]+)\b/g, "Semester $1"],
    [/Continuous Assessment\s*[–-]?\s*(I{1,2})\b/gi, "Continuous Assessment – $1"],
    [/Maha shivaratri/gi, "Maha Shivaratri"], [/\bdiwali\b/gi, "Diwali"]];
  const ACRO = /^(AI|MBA|MCA|BBA|BCA|FDP|UGC|CIQA|IKS|LMS|PTM|VOX|IT|AR|VR|CDOE|UDBHAV|STTP|NAAC|NIRF|PPT|ERP|USDC|IBM|AWS)$/;
  function tidy(t) {
    t = clean(t).replace(/^[•·▪●\-*]\s*/, "").replace(/\s*\n\s*/g, " ");
    for (const [a, b] of FIXES) t = t.replace(a, b);
    t = t.replace(/\s{2,}/g, " ").replace(/^[.\s]+|[.\s]+$/g, "");
    const caps = (t.match(/\b[A-Z]{3,}\b/g) || []).filter(w => !ACRO.test(w));
    if (t !== t.toUpperCase() && caps.length >= 3)                 // "Dashboard AI, ANALYTICS, AND BUSINESS INTELLIGENCE"
      t = t.replace(/\b[A-Z]{2,}\b/g, w => ACRO.test(w) ? w : (/^(AND|OF|FOR|THE|IN|ON|TO|WITH)$/.test(w) ? w.toLowerCase() : w[0] + w.slice(1).toLowerCase()));
    if (t.length > 6 && t === t.toUpperCase() && /[A-Z]/.test(t)) {
      t = t.toLowerCase().replace(/\b([a-z])/g, c => c.toUpperCase())
           .replace(/\b(Ai|Mba|Mca|Bba|Bca|Fdp|Ugc|Ciqa|Iks|Lms|Ptm|Vox|It|Ar|Vr)\b/g, w => w.toUpperCase())
           .replace(/\b(And|Of|For|The|In|On|To|With|A|An)\b/g, w => w.toLowerCase());
      t = t[0].toUpperCase() + t.slice(1);
    }
    return t ? t[0].toUpperCase() + t.slice(1) : t;
  }

  /* ---------- guess the type from the words ---------- */
  const HOLIDAYS = /holiday|independence day|republic day|gandhi|christmas|diwali|deepavali|dasara|dussehra|dasami|ugadi|pongal|sankranti|bhogi|kanuma|ramzan|ramadan|bakrid|eid\b|milad|muharram|good friday|holi\b|shivaratri|krishna|ashtami|vinayaka|chavithi|chaturthi|navami|mahavir|ambedkar|may day|onam|guru nanak|buddha purnima/i;
  function guessType(text, cal) {
    const s = String(text || "").toLowerCase();
    if (HOLIDAYS.test(s)) return "holiday";
    if (/continuous assessment|\bca[- ]?(i|ii|1|2)\b|assignment submission/.test(s)) return "assessment";
    if (/end semester exam|semester exam|examination|exams?\b|viva/.test(s)) return "exam";
    if (/commence|semester completion|progression|academic term|semester .*(begin|start)/.test(s)) return "semester";
    if (/result/.test(s)) return "result";
    if (/registration|last date|fee\b|fees\b|enrol/.test(s)) return cal === "coe" ? "registration" : "admission";
    if (/vacation|summer break|winter break/.test(s)) return "vacation";
    if (/tech ?talk/.test(s)) return "techtalk";
    if (/webinar/.test(s)) return "webinar";
    if (/workshop|hackathon/.test(s)) return "workshop";
    if (/orientation|induction|inauguration|pre-semester/.test(s)) return "orientation";
    if (/\bfdp\b|sttp|training|faculty awareness|soft skill/.test(s)) return "fdp";
    if (/meeting|review|ciqa|quality assurance/.test(s)) return cal === "coe" ? "academic" : "meeting";
    if (/counsel|catch-up|live session|academic sessions|pcp/.test(s)) return "counselling";
    if (/outreach|promotion|campaign|stall|admission|placement|channel partner|scholarship/.test(s)) return "admission";
    if (/content|recording|lms/.test(s)) return "content";
    if (/convocation|conference|guest lecture|meet\b|day 20|talk/.test(s)) return cal === "coe" ? "academic" : "event";
    return cal === "coe" ? "academic" : "event";
  }

  /* "July 2025 – Sem III: Continuous Assessment – I ..." → batch + title */
  const BATCH = "(?:jan(?:uary)?|jul(?:y)?)\\s+\\d{4}(?:\\s*[–-]\\s*sem(?:ester)?\\s*[ivx\\d]+)?";
  const BATCH_LEAD = new RegExp("^(" + BATCH + "(?:\\s*(?:&|and|,)\\s*" + BATCH + ")*)\\s*:?\\s*(.*)$", "i");
  function splitBatch(t) {
    const m = t.match(BATCH_LEAD);
    if (!m || !m[2]) return { audience: "", title: t };
    // "Jul 2024 Batch Academic Term Commenced" is a title, not a batch label.
    const colon = /^\s*:/.test(t.slice(m[1].length));
    if (/^batch\b/i.test(m[2]) || (!/sem/i.test(m[1]) && !colon)) return { audience: "", title: t };
    const audience = m[1].replace(/\s*[–-]\s*/g, " – ").replace(/\s*&\s*/g, " & ").replace(/\s+/g, " ").trim();
    return { audience, title: tidy(m[2]) };
  }

  /* "(06-20 Jan)", "(27 Jun-12 Jul)", "(21 Dec-04 Jan)" inside a title → a date range */
  const RANGE = /\((\d{1,2})(?:\s+([A-Za-z]{3,}))?\s*[-–]\s*(\d{1,2})\s+([A-Za-z]{3,})\)/;
  function applyRange(ev) {
    const m = ev.title.match(RANGE); if (!m) return ev;
    const mi = s => MABBR.indexOf(s.slice(0, 3).toLowerCase()) + 1;
    const m2 = mi(m[4]), m1 = m[2] ? mi(m[2]) : m2;
    if (!m1 || !m2) return ev;
    const y = Number(ev.start.slice(0, 4));
    let s = isoOf(m1 > m2 ? y - 1 : y, m1, Number(m[1])), e = isoOf(y, m2, Number(m[3]));
    if (e < ev.start) e = isoOf(y + 1, m2, Number(m[3]));
    const monthStart = ev.start.slice(0, 8) + "01";
    if (s < monthStart) s = monthStart;                          // "(21 Dec-04 Jan)" on a January sheet starts 1 Jan
    return Object.assign({}, ev, { start: s, end: e, title: tidy(ev.title.replace(RANGE, "")) });
  }

  /* ---------- table layout ---------- */
  function pickHeader(rows, tests) {
    for (let r = 0; r < Math.min(rows.length, 12); r++) {
      const cells = (rows[r] || []).map(c => String(c ?? "").trim().toLowerCase());
      const idx = {};
      for (const [k, re] of Object.entries(tests)) {
        const i = cells.findIndex((c, j) => re.test(c) && !Object.values(idx).includes(j));
        if (i >= 0) idx[k] = i;
      }
      if (idx.start !== undefined && idx.title !== undefined) return { row: r, idx };
    }
    return null;
  }
  function dateCell(v, XLSX) {
    if (typeof v === "number" && v > 20000 && v < 80000) {
      const t = new Date(Math.round((v - 25569) * 864e5));
      return isoOf(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
    }
    const s = clean(v); if (!s) return null;
    let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/); if (m) return isoOf(m[1], m[2], m[3]);
    m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/); if (m) return isoOf(m[3].length === 2 ? "20" + m[3] : m[3], m[2], m[1]);
    m = s.match(/^(\d{1,2})[\s-]+([A-Za-z]{3,})[\s,-]+(\d{4})/);
    if (m) { const k = MABBR.indexOf(m[2].slice(0, 3).toLowerCase()); if (k >= 0) return isoOf(m[3], k + 1, m[1]); }
    return null;
  }
  function readTable(rows, cal, typeOf) {
    const h = pickHeader(rows, { start: /start|^from|^date/, end: /end|^to$|till/, title: /title|activity|event|particular|program|description|^name$/,
      type: /type|category|kind/, aud: /^for$|audience|class|batch|programme/ });
    if (!h) return null;
    const out = [], skipped = [];
    for (let r = h.row + 1; r < rows.length; r++) {
      const row = rows[r] || [], raw = clean(row[h.idx.title]);
      if (!raw && !clean(row[h.idx.start])) continue;
      const start = dateCell(row[h.idx.start]);
      const end = h.idx.end !== undefined ? (dateCell(row[h.idx.end]) || start) : start;
      if (!raw || !start || end < start) { skipped.push(r + 1); continue; }
      const typed = h.idx.type !== undefined ? typeOf(clean(row[h.idx.type])) : null;
      out.push({ start, end, title: tidy(raw), category: typed || guessType(raw, cal),
        audience: h.idx.aud !== undefined ? clean(row[h.idx.aud]) : "" });
    }
    return { layout: "table", events: out, skipped, notes: [] };
  }

  /* ---------- grid layouts ---------- */
  const MONTH_HEAD = new RegExp("^(" + MONTHS.join("|") + ")\\s+(\\d{4})$", "i");
  const STOP = /month highlights|colour key|color key|^legend|^key$|^notes?$/i;
  const LEADNUM = /^\s*(\d{1,2})(?:\s*\n([\s\S]*)|\s*)$/;      // "15" or "15\n• Something"

  function gridSheet(rows, fills, cal, notes) {
    // Pass 1: learn which column is which weekday, from the day numbers themselves.
    const votes = {};
    let y = 0, m = 0;
    for (const row of rows) {
      const head = row.map(clean).find(c => MONTH_HEAD.test(c));
      if (head) { const mm = head.match(MONTH_HEAD); m = MONTHS.indexOf(mm[1].toLowerCase()) + 1; y = Number(mm[2]); continue; }
      if (!m) continue;
      const nums = dayRow(row);
      if (!nums) continue;
      for (const [c, d] of Object.entries(nums)) {
        if (d < 1 || d > new Date(Date.UTC(y, m, 0)).getUTCDate()) continue;
        const k = (votes[c] ||= {}); const w = weekday(y, m, d); k[w] = (k[w] || 0) + 1;
      }
    }
    const lay = {};
    for (const [c, v] of Object.entries(votes)) {
      const tot = Object.values(v).reduce((a, b) => a + b, 0);
      const [w, n] = Object.entries(v).sort((a, b) => b[1] - a[1])[0];
      if (n / tot >= 0.8 && tot >= 2) lay[c] = Number(w);         // week-number columns fail this test
    }
    const cols = Object.keys(lay).map(Number).sort((a, b) => a - b);
    if (cols.length < 5) return [];
    const colDay = c => { let best = null; for (const k of cols) if (k <= c) best = k; return best === null ? null : lay[best]; };

    // Pass 2: read the events.
    const out = [];
    let weekStart = null, mode = "skip"; y = 0; m = 0;
    const push = (date, text, r, c) => {
      const raw = String(text);
      const parts = /[•·▪●]/.test(raw) ? raw.split(/(?=[•·▪●])/) : [raw.replace(/\s*\n\s*/g, " ")];
      const keyType = typeFromFill(fills[r] && fills[r][c]);
      for (let line of parts) {
        line = clean(line); if (!line || line === ".") continue;
        if (/^ongoing:/i.test(line)) continue;                  // repeats a range already listed
        let { audience, title } = splitBatch(tidy(line));
        if (!title) continue;
        const words = guessType(title, cal);
        // The sheet's own colour key decides the type; holidays are recognised by name too.
        const category = words === "holiday" ? "holiday" : (keyType || words);
        out.push(applyRange({ start: date, end: date, title, audience, category }));
      }
    };
    // Colour key: coloured cells such as "HOLIDAY" or "Tech Talks" outside the month grids.
    const key = [];
    let inMonth = false;
    rows.forEach((row, ri) => row.forEach((v, c) => {
      const t = clean(v), f = fills[ri] && fills[ri][c];
      if (MONTH_HEAD.test(t)) inMonth = true;
      if (!t || !f || t.length > 45 || LEADNUM.test(t) || MONTH_HEAD.test(t) || /^(mon|tue|wed|thu|fri|sat|sun)[a-z]*$/i.test(t)) return;
      const lab = t.toLowerCase(), above = rows.slice(Math.max(0, ri - 3), ri).flat().map(clean).join(" ");
      if (inMonth && !STOP.test(above) && !STOP.test(t)) return;
      const type = /holiday/.test(lab) ? "holiday" : /commence|end sem/.test(lab) ? "semester" : /continuous|assess/.test(lab) ? "assessment"
        : /tech ?talk/.test(lab) ? "techtalk" : /webinar/.test(lab) ? "webinar" : /exam/.test(lab) ? "exam" : /workshop/.test(lab) ? "workshop"
        : /orient|induct/.test(lab) ? "orientation" : null;
      if (type) key.push({ f, type, label: t });
    }));
    if (key.length) notes.push("Colour key used: " + key.map(k => k.label + " → " + k.type).join(", "));
    function typeFromFill(f) {
      if (!f) return null;
      for (const k of key) if (sameFill(f, k.f)) return k.type;
      return null;
    }

    rows.forEach((row, ri) => {
      const cellsTxt = row.map(clean);
      const head = cellsTxt.find(c => MONTH_HEAD.test(c));
      if (head) { const mm = head.match(MONTH_HEAD); m = MONTHS.indexOf(mm[1].toLowerCase()) + 1; y = Number(mm[2]); weekStart = null; mode = "cal"; return; }
      if (!m) return;
      if (cellsTxt.some(c => STOP.test(c))) { mode = "skip"; return; }
      if (mode !== "cal") return;
      if (cellsTxt.filter(c => /^(mon|tue|wed|thu|fri|sat|sun)[a-z]*$/i.test(c)).length >= 5) return;   // weekday heading row
      const nums = dayRow(row);
      if (nums) {
        const known = Object.entries(nums).find(([c]) => lay[c] !== undefined);
        if (known) { const [c, d] = known; const ws = isoOf(y, m, d); weekStart = addDays(ws, -lay[c]); }
        for (const [c, d] of Object.entries(nums)) {
          const mm = String(row[c] ?? "").match(LEADNUM);
          if (mm && mm[2] && clean(mm[2])) push(isoOf(y, m, d), mm[2], ri, Number(c));
        }
        return;
      }
      if (!weekStart) return;
      row.forEach((v, c) => {
        const t = clean(v); if (!t) return;
        const w = colDay(c); if (w === null) return;
        const date = addDays(weekStart, w);
        if (Number(date.slice(5, 7)) !== m) notes.push(`A note in ${MONTHS[m - 1]} sits on a day outside that month (${date}) and was skipped: "${t.slice(0, 60)}"`);
        else push(date, v, ri, c);
      });
    });
    return out;
  }
  function dayRow(row) {
    const nums = {}; let any = false;
    for (let c = 0; c < row.length; c++) {
      const v = row[c]; if (v === "" || v === null || v === undefined) continue;
      const mm = String(v).match(LEADNUM);
      if (!mm) return null;
      nums[c] = Number(mm[1]); any = true;
    }
    return any ? nums : null;
  }

  /* Same event on back-to-back days → one entry with a date range. */
  function mergeRuns(list) {
    const key = e => (e.title + "|" + e.audience + "|" + e.category).toLowerCase();
    const sorted = list.slice().sort((a, b) => key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : a.start < b.start ? -1 : 1);
    const out = [];
    for (const e of sorted) {
      const p = out[out.length - 1];
      if (p && key(p) === key(e) && e.start <= addDays(p.end, 1)) { if (e.end > p.end) p.end = e.end; continue; }
      out.push(Object.assign({}, e));
    }
    return out.sort((a, b) => a.start < b.start ? -1 : a.start > b.start ? 1 : a.title < b.title ? -1 : 1);
  }

  function readWorkbook(sheets, opts = {}) {
    const cal = opts.cal || "activity", typeOf = opts.typeOf || (() => null);
    // A table on the first sheet wins.
    for (const s of sheets) {
      const t = readTable(s.rows, cal, typeOf);
      if (t && t.events.length) return Object.assign(t, { events: mergeRuns(t.events) });
    }
    const notes = [];
    let all = [];
    for (const s of sheets) all = all.concat(gridSheet(s.rows, s.fills || [], cal, notes));
    if (!all.length) return { layout: "none", events: [], skipped: [], notes };
    return { layout: "grid", events: mergeRuns(all), skipped: [], notes };
  }

  function sameFill(a, b) {
    if (a.theme !== undefined && b.theme !== undefined && a.theme === b.theme && Math.abs((a.tint || 0) - (b.tint || 0)) < 0.05) return true;
    if (!a.rgb || !b.rgb) return false;
    const h = x => [0, 2, 4].map(i => parseInt(x.slice(-6).slice(i, i + 2), 16));
    const [p, q] = [h(a.rgb), h(b.rgb)];
    return Math.max(...p.map((v, i) => Math.abs(v - q[i]))) <= 10;
  }

  /* ================= Batch-wise status report =================

     One sheet per batch, named for the batch ("Jan 2022", "July 2022").
     Each sheet is a table of programmes with the figures the department
     tracks. Column headings are found by their words, so the sheets need
     not have the same columns in the same order, and a heading split over
     two or three rows ("Total Admitted" / "(a)") still reads.          */

  const BS_COLS = [
    ["admitted",     /total admitted|admissions|\badmitted\b/],
    ["discontinued", /discontinu|dropped|dropout/],
    ["graduated",    /completed degree|completed|graduat/],
    ["remaining",    /remaining/],
    ["active",       /\bactive\b/],
    ["notResponding",/not respond/],
    ["backlogs",     /backlog/],
    ["canComplete",  /can complete|complete by/]
  ];
  /* Headings that look like a figure but are not one. */
  const BS_SKIP = /sanction|s\.?\s*no\b|^%$|percent/;

  const BS_PROGS = [
    [/^bba\b/,                               "BBA"],
    [/^mba\s*\(?\s*gen/,                     "MBA (General)"],
    [/^mba\s*\(?\s*fin/,                     "MBA (Finance)"],
    [/^mba\s*\(?\s*(hrm?|hr)\b/,             "MBA HRM"],
    [/^bca\b/,                               "BCA"],
    [/^mca\b/,                               "MCA"]
  ];
  const bsProgName = s => {
    const t = clean(s).toLowerCase().replace(/\s+/g, " ");
    if (!t || /^total\b/.test(t)) return "";
    for (const [rx, name] of BS_PROGS) if (rx.test(t)) return name;
    return "";
  };

  /* "Jan 2022" → "Jan-22".  Falls back to the sheet name as typed. */
  function bsBatchName(sheet) {
    const m = clean(sheet).match(/([A-Za-z]{3,9})[^A-Za-z0-9]*((?:19|20)\d\d|\d\d)\b/);
    if (!m) return clean(sheet);
    const mi = MABBR.indexOf(m[1].slice(0, 3).toLowerCase());
    if (mi < 0) return clean(sheet);
    const y = Number(m[2]);
    const mon = MABBR[mi][0].toUpperCase() + MABBR[mi].slice(1);
    return mon + "-" + String(y < 100 ? y : y % 100).padStart(2, "0");
  }

  /* A figure in the report. "-" and "" mean nothing is recorded.
     "22(1)" means 22, with 1 noted in brackets; the report's own totals
     use the 22, so that is what is read, and the bracket is kept as a note. */
  function bsNum(v) {
    if (v === null || v === undefined) return { n: null, note: "" };
    if (typeof v === "number") return Number.isFinite(v) ? { n: Math.round(v), note: "" } : { n: null, note: "" };
    const s = clean(v);
    if (!s || /^[-–—]+$/.test(s) || /^(na|n\/a|nil)$/i.test(s)) return { n: null, note: "" };
    const m = s.match(/^(\d+)\s*(?:\((\d+)\))?$/);
    if (!m) return { n: null, note: "" };
    return { n: Number(m[1]), note: m[2] ? m[2] + " more in brackets on the sheet" : "" };
  }

  /* Workbook → [{ batch, rows: [{ programme, admitted, ... }], sheet }] */
  function readBatchWorkbook(sheets) {
    const out = [];
    for (const sh of sheets) {
      const rows = sh.rows || [];
      /* The heading row is the one naming the programme column. */
      let hr = -1, pc = -1;
      for (let r = 0; r < Math.min(rows.length, 20) && hr < 0; r++)
        for (let c = 0; c < (rows[r] || []).length; c++)
          if (/programme|program|course/i.test(clean(rows[r][c])) && /name/i.test(clean(rows[r][c]))) { hr = r; pc = c; break; }
      if (hr < 0)                                        // no "Programme Name": try a column of programme names
        for (let r = 0; r < Math.min(rows.length, 20) && hr < 0; r++)
          for (let c = 0; c < (rows[r] || []).length; c++)
            if (bsProgName(rows[r][c])) { hr = r - 1; pc = c; break; }
      if (hr < 0 || pc < 0) continue;

      /* Headings can run over the next two rows, so read them together. */
      const width = Math.max(...rows.slice(hr, hr + 4).map(r => (r || []).length), 0);
      const head = [];
      for (let c = 0; c < width; c++)
        head[c] = clean([0, 1, 2].map(k => clean((rows[hr + k] || [])[c])).join(" ")).toLowerCase();

      const col = {};
      for (let c = 0; c < width; c++) {
        if (c === pc || !head[c] || BS_SKIP.test(head[c])) continue;
        for (const [key, rx] of BS_COLS)
          if (col[key] === undefined && rx.test(head[c])) { col[key] = c; break; }
      }
      if (col.admitted === undefined) continue;          // nothing to read without the intake

      const found = [];
      let totalRow = null;
      for (let r = hr + 1; r < rows.length; r++) {
        const row = rows[r] || [];
        /* "MBA" on one line with "(HRM)" on the next is one programme. */
        let label = clean(row[pc]);
        const next = clean((rows[r + 1] || [])[pc]);
        if (/^mba$/i.test(label) && /^\(/.test(next)) label = label + " " + next;

        const figures = () => {
          const rec = {}, notes = [];
          for (const [key] of BS_COLS) {
            if (col[key] === undefined) { rec[key] = null; continue; }
            const { n, note } = bsNum(row[col[key]]);
            rec[key] = n;
            if (note) notes.push(key === "admitted" ? note : key + ": " + note);
          }
          rec.note = notes.join("; ");
          return rec;
        };
        if (/^total\b/i.test(label)) { totalRow = totalRow || figures(); continue; }

        const programme = bsProgName(label);
        if (!programme) continue;
        if (found.some(x => x.programme === programme)) continue;
        found.push(Object.assign({ programme }, figures()));
      }

      /* The sheet's own Total row is checked against its columns, so a slip in
         the spreadsheet is reported rather than quietly carried over. */
      const totals = [];
      if (totalRow) for (const [key, label] of [["admitted", "Total Admitted"], ["discontinued", "Discontinued"],
                                                ["graduated", "Completed Degree"]]) {
        const adds = found.reduce((a, r) => a + (r[key] || 0), 0);
        if (totalRow[key] !== null && totalRow[key] !== adds)
          totals.push(`${label} adds up to ${adds}, but the sheet's Total row says ${totalRow[key]}`);
      }
      if (found.length) out.push({ batch: bsBatchName(sh.name), sheet: sh.name, rows: found, totals });
    }
    return out;
  }

  /* SheetJS workbook (read with cellStyles: true) → [{ name, rows, fills }] */
  function sheetsFrom(wb, XLSX) {
    return wb.SheetNames.map(name => {
      const ws = wb.Sheets[name];
      const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: "" });
      const fills = [];
      if (ws["!ref"]) {
        const r0 = XLSX.utils.decode_range(ws["!ref"]).s;
        for (const addr of Object.keys(ws)) {
          if (addr[0] === "!") continue;
          const s = ws[addr].s; if (!s || s.patternType !== "solid" || !s.fgColor) continue;
          const { r, c } = XLSX.utils.decode_cell(addr);
          const fg = s.fgColor;
          ((fills[r - r0.r] ||= [])[c - r0.c]) = { rgb: fg.rgb, theme: fg.theme, tint: fg.tint };
        }
      }
      return { name, rows, fills };
    });
  }

  root.CDOEImport = { readWorkbook, readBatchWorkbook, sheetsFrom, guessType, tidy };
})(typeof window !== "undefined" ? window : globalThis);
