const FILES = ["computingeducation.bib", "scholar.bib", "fub.bib"];

const els = {
  authorFilter: document.getElementById("authorFilter"),
  authorList: document.getElementById("authorList"),
  yearFilter: document.getElementById("yearFilter"),
  onlyDiff: document.getElementById("onlyDiff"),
  reload: document.getElementById("reload"),
  status: document.getElementById("status"),
  table: document.getElementById("resultTable"),
  fileNames: document.getElementById("fileNames"),
};

let cachedEntries = [];

els.fileNames.textContent = FILES.join(", ");

els.authorFilter.addEventListener("input", () => render());
els.yearFilter.addEventListener("input", () => render());
els.onlyDiff.addEventListener("change", () => render());
els.reload.addEventListener("click", () => loadAll());

loadAll();

async function loadAll() {
  setStatus("Lade Dateien...");
  try {
    const texts = await Promise.all(
      FILES.map(async (name) => {
        const res = await fetch(name, { cache: "no-store" });
        if (!res.ok) throw new Error(`${name} (${res.status})`);
        const buf = await res.arrayBuffer();
        return decodeBuffer(buf);
      })
    );
    cachedEntries = texts.map(parseBibTeX);
    refreshFilterOptions();
    setStatus(`Geladen: ${cachedEntries.reduce((sum, arr) => sum + arr.length, 0)} Einträge`);
    render();
  } catch (err) {
    setStatus(`Fehler beim Laden: ${err.message}. Falls der Browser fetch blockiert, bitte kurz lokal starten (z. B. python -m http.server).`);
    cachedEntries = [[], [], []];
    render();
  }
}

function setStatus(text) {
  els.status.textContent = text;
}

function render() {
  els.table.innerHTML = "";

  const authorNeedle = els.authorFilter.value.trim().toLowerCase();
  const yearNeedle = (els.yearFilter.value || "").trim();
  const onlyDiff = els.onlyDiff.checked;

  const normalizedMaps = cachedEntries.map((entries) => {
    return buildTitleMap(entries);
  });

  const allKeys = new Set();
  normalizedMaps.forEach((m) => m.forEach((_, k) => allKeys.add(k)));

  const head = document.createElement("div");
  head.className = "file-head";
  FILES.forEach((name) => {
    const div = document.createElement("div");
    div.textContent = name;
    head.appendChild(div);
  });
  els.table.appendChild(head);

  const rows = Array.from(allKeys).map((key) => {
    const rowEntries = normalizedMaps.map((m) => m.get(key));
    const presentCount = rowEntries.filter(Boolean).length;
    const isAll = presentCount === 3;
    const displayTitle = (rowEntries.find(Boolean)?.title || key).toLowerCase();
    return { key, rowEntries, presentCount, isAll, displayTitle };
  });

  rows.sort((a, b) => {
    const allDiff = Number(b.isAll) - Number(a.isAll);
    if (allDiff !== 0) return allDiff;
    const countDiff = b.presentCount - a.presentCount;
    if (countDiff !== 0) return countDiff;
    return a.displayTitle.localeCompare(b.displayTitle, "de");
  });

  for (const rowData of rows) {
    const { rowEntries, isAll } = rowData;

    if (onlyDiff && isAll) continue;
    if (!rowMatchesFilters(rowEntries, authorNeedle, yearNeedle)) continue;

    const row = document.createElement("div");
    row.className = `row ${isAll ? "all" : "partial"}`;

    rowEntries.forEach((entry) => {
      const cell = document.createElement("div");
      cell.className = "cell";
      if (!entry) {
        cell.classList.add("missing");
        cell.textContent = "—";
      } else {
        const title = document.createElement("div");
        title.className = "entry-title";
        title.textContent = entry.title || "(ohne Titel)";

        const meta = document.createElement("div");
        meta.className = "entry-meta";
        const authors = entry.author || "";
        const year = entry.year || "";
        const venue = entry.venue || "";

        meta.innerHTML = [
          authors ? `<div>${escapeHtml(authors)}</div>` : "",
          year ? `<div>${escapeHtml(year)}</div>` : "",
          venue ? `<div>${escapeHtml(venue)}</div>` : "",
        ].filter(Boolean).join("");

        cell.appendChild(title);
        cell.appendChild(meta);
      }
      row.appendChild(cell);
    });

    els.table.appendChild(row);
  }
}

function buildTitleMap(entries) {
  const map = new Map();
  for (const entry of entries) {
    const norm = normalizeTitle(entry.title || "");
    if (!norm) continue;
    if (!map.has(norm)) map.set(norm, entry);
  }
  return map;
}

function parseBibTeX(text) {
  const entries = [];
  let i = 0;

  while (i < text.length) {
    const at = text.indexOf("@", i);
    if (at === -1) break;
    i = at + 1;

    const typeMatch = /[A-Za-z]+/.exec(text.slice(i));
    if (!typeMatch) { i += 1; continue; }
    const type = typeMatch[0].toLowerCase();
    i += typeMatch[0].length;

    while (i < text.length && /\s/.test(text[i])) i++;
    const open = text[i];
    if (open !== "{" && open !== "(") { i += 1; continue; }
    const close = open === "{" ? "}" : ")";
    i++;

    const start = i;
    let depth = 1;
    while (i < text.length && depth > 0) {
      const ch = text[i];
      if (ch === open) depth++;
      else if (ch === close) depth--;
      i++;
    }
    const body = text.slice(start, i - 1).trim();

    if (type === "comment" || type === "preamble" || type === "string") continue;
    const entry = parseEntryBody(body);
    if (!entry) continue;
    entry.type = type;
    entries.push(entry);
  }

  return entries;
}

function parseEntryBody(body) {
  const comma = body.indexOf(",");
  if (comma === -1) return null;
  const key = body.slice(0, comma).trim();
  const fieldsRaw = body.slice(comma + 1);

  const parts = splitTopLevel(fieldsRaw);
  const fields = {};
  for (const part of parts) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    const name = part.slice(0, eq).trim().toLowerCase();
    const rawVal = part.slice(eq + 1).trim();
    const value = cleanValue(rawVal);
    if (value) fields[name] = value;
  }

  const rawYear = fields.year || "";
  const rawDate = fields.date || "";
  const yearFromDate = rawYear ? "" : extractYear(rawDate);
  const normalizedYear = extractYear(rawYear) || yearFromDate;
  const titleRaw = fields.title || "";
  const titleDisplay = cleanTitleForDisplay(titleRaw);

  const entry = {
    key,
    title: titleDisplay,
    author: fields.author || "",
    year: rawYear || (yearFromDate ? yearFromDate : ""),
    yearDisplay: rawYear || (yearFromDate ? yearFromDate : ""),
    yearNormalized: normalizedYear,
    venue: fields.journal || fields.booktitle || fields.publisher || fields.school || "",
    raw: fields,
  };
  return entry;
}

function splitTopLevel(text) {
  const parts = [];
  let buf = "";
  let depth = 0;
  let inQuotes = false;
  let escaped = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (ch === "\\" && !escaped) {
      escaped = true;
      buf += ch;
      continue;
    }

    if (ch === '"' && !escaped) inQuotes = !inQuotes;
    escaped = false;

    if (!inQuotes) {
      if (ch === "{") depth++;
      if (ch === "}") depth--;
    }

    if (ch === "," && depth === 0 && !inQuotes) {
      const trimmed = buf.trim();
      if (trimmed) parts.push(trimmed);
      buf = "";
      continue;
    }

    buf += ch;
  }

  const tail = buf.trim();
  if (tail) parts.push(tail);
  return parts;
}

function cleanValue(val) {
  let v = val.replace(/\s+/g, " ").trim();
  v = v.replace(/^\{+/, "").replace(/\}+$/, "");
  v = v.replace(/^\"+/, "").replace(/\"+$/, "");
  v = v.replace(/\s+#\s+/g, "");
  v = v.replace(/\{\s*/g, "").replace(/\s*\}/g, "");
  v = decodeLatex(v);
  return v.trim();
}

function normalizeTitle(title) {
  if (!title) return "";
  let t = cleanTitleForDisplay(title);
  t = t.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  t = t.replace(/ß/g, "ss");
  t = t.toLowerCase();
  t = t.replace(/[^a-z0-9]+/g, "");
  return t;
}

function decodeLatex(input) {
  let s = input || "";
  s = s.replace(/\\&/g, "&")
    .replace(/\\%/g, "%")
    .replace(/\\_/g, "_")
    .replace(/\\#/g, "#")
    .replace(/\\\$/g, "$")
    .replace(/~/g, " ");

  const simpleMap = {
    "\\ss": "ß",
    "\\ae": "æ",
    "\\AE": "Æ",
    "\\oe": "œ",
    "\\OE": "Œ",
    "\\aa": "å",
    "\\AA": "Å",
    "\\o": "ø",
    "\\O": "Ø",
    "\\l": "ł",
    "\\L": "Ł",
    "\\dh": "ð",
    "\\DH": "Ð",
    "\\th": "þ",
    "\\TH": "Þ",
    "\\i": "i",
    "\\j": "j",
  };

  for (const [k, v] of Object.entries(simpleMap)) {
    s = s.replace(new RegExp(escapeRegExp(k), "g"), v);
  }

  const accentMap = {
    "\"": "\u0308",
    "'": "\u0301",
    "`": "\u0300",
    "^": "\u0302",
    "~": "\u0303",
    "=": "\u0304",
    ".": "\u0307",
    "u": "\u0306",
    "v": "\u030C",
    "H": "\u030B",
    "r": "\u030A",
    "c": "\u0327",
    "k": "\u0328",
  };

  s = s.replace(/\\([\"'`^~=.uvHrck])\s*\{?\s*([A-Za-z])\s*\}?/g, (m, acc, ch) => {
    const mark = accentMap[acc];
    if (!mark) return ch;
    return (ch + mark).normalize("NFC");
  });

  return s.replace(/\s{2,}/g, " ");
}

function escapeHtml(str) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function extractYear(value) {
  if (!value) return "";
  const match = String(value).match(/\b(19|20)\d{2}\b/);
  return match ? match[0] : "";
}

function rowMatchesFilters(rowEntries, authorNeedle, yearNeedle) {
  const hasAuthorFilter = !!authorNeedle;
  const hasYearFilter = !!yearNeedle;
  if (!hasAuthorFilter && !hasYearFilter) return true;

  const yearNeedleNorm = extractYear(yearNeedle);
  const yearNeedleLower = yearNeedle.toLowerCase();

  return rowEntries.some((entry) => {
    if (!entry) return false;
    if (hasAuthorFilter) {
      const authorField = (entry.author || "").toLowerCase();
      if (!authorField.includes(authorNeedle)) return false;
    }
    if (hasYearFilter) {
      const yearField = (entry.yearDisplay || "").trim();
      const yearNorm = (entry.yearNormalized || "").trim();
      if (yearNeedleNorm) {
        if (yearNorm !== yearNeedleNorm) return false;
      } else if (!yearField.toLowerCase().includes(yearNeedleLower)) {
        return false;
      }
    }
    return true;
  });
}

function cleanTitleForDisplay(title) {
  let t = decodeLatex(title || "");
  t = t.replace(/[{}]/g, "");
  t = t.replace(/\s+/g, " ").trim();
  t = stripInClause(t);
  return t.replace(/\s{2,}/g, " ").trim();
}

function stripInClause(title) {
  let t = title || "";
  if (/^\s*In:\s+/i.test(t)) {
    t = t.replace(/^\s*In:\s+/i, "").trim();
  }
  const parts = t.split(/\s+In:\s+/i);
  if (parts.length > 1) {
    const left = parts[0].replace(/[.:\s]+$/g, "").trim();
    if (left.length >= 8) return left;
  }
  return t;
}

function refreshFilterOptions() {
  const currentAuthor = els.authorFilter.value;
  const currentYear = els.yearFilter.value;

  const allEntries = cachedEntries.flat();
  const years = new Set();
  const authors = new Set();

  for (const entry of allEntries) {
    const year = entry.yearNormalized || extractYear(entry.yearDisplay || entry.year || "");
    if (year) years.add(year);

    const authorField = entry.author || "";
    for (const name of splitAuthors(authorField)) {
      const surname = extractSurname(name);
      if (surname) authors.add(surname);
    }
  }

  const sortedYears = Array.from(years).sort((a, b) => Number(b) - Number(a));
  const sortedAuthors = Array.from(authors).sort((a, b) => a.localeCompare(b, "de"));

  els.yearFilter.innerHTML = "";
  const anyOpt = document.createElement("option");
  anyOpt.value = "";
  anyOpt.textContent = "Alle Jahre";
  els.yearFilter.appendChild(anyOpt);
  for (const y of sortedYears) {
    const opt = document.createElement("option");
    opt.value = y;
    opt.textContent = y;
    els.yearFilter.appendChild(opt);
  }

  els.authorList.innerHTML = "";
  for (const a of sortedAuthors) {
    const opt = document.createElement("option");
    opt.value = a;
    els.authorList.appendChild(opt);
  }

  if (currentYear && years.has(currentYear)) {
    els.yearFilter.value = currentYear;
  } else {
    els.yearFilter.value = "";
  }
  els.authorFilter.value = currentAuthor;
}

function splitAuthors(authorField) {
  return String(authorField)
    .split(/\s+and\s+/i)
    .map((a) => a.trim())
    .filter(Boolean);
}

function extractSurname(name) {
  if (!name) return "";
  const cleaned = name.replace(/[{}]/g, "").trim();
  if (!cleaned) return "";
  if (cleaned.includes(",")) {
    return cleaned.split(",")[0].trim();
  }
  const parts = cleaned.split(/\s+/);
  return parts[parts.length - 1] || "";
}

function decodeBuffer(buf) {
  const utf8 = new TextDecoder("utf-8", { fatal: false }).decode(buf);
  const replacementCount = countReplacement(utf8);
  if (replacementCount > 0) {
    const latin1 = new TextDecoder("iso-8859-1", { fatal: false }).decode(buf);
    // Heuristic: prefer latin1 if utf-8 has replacement chars.
    return replacementCount > 0 ? latin1 : utf8;
  }
  return utf8;
}

function countReplacement(text) {
  let count = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "\uFFFD") count++;
  }
  return count;
}
