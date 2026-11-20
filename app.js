/* Balonmano Stats — registro y visualización de lanzamientos sobre Google Sheets */
(() => {
"use strict";

// ================================================================
// Constantes
// ================================================================
const ZONAS = ["EXT IZ", "6 IZ", "6 C", "6 DE", "EXT DER", "LAT IZ", "CENTRAL", "LAT DER", "PENALTI", "SAQUE", "POR"];
const ACCIONES = ["SOLO", "CONTACTO", "CONTRAATAQUE", "PENETRACION", "1 AMAGO", "2 AMAGO", "3 AMAGO", "4 AMAGO"];
const ACCIONES_BASE = ["SOLO", "CONTACTO", "CONTRAATAQUE", "PENETRACION"];   // siempre visibles
const ACCIONES_AMAGO = ["1 AMAGO", "2 AMAGO", "3 AMAGO", "4 AMAGO"];        // solo con zona PENALTI
const RESULTADOS = ["GOL", "PARADA", "FUERA"];
// En el Sheets, DESTINO_HORIZONTAL guarda la altura y DESTINO_VERTICAL el lado.
// Se mantienen esos nombres de columna para no romper los datos existentes.
const ALTURA = { 1: "ARRIBA", 2: "ARRIBA", 3: "ARRIBA", 4: "MEDIO", 5: "MEDIO", 6: "MEDIO", 7: "ABAJO", 8: "ABAJO", 9: "ABAJO", 10: "FUERA" };
const LADO = { 1: "IZQUIERDA", 4: "IZQUIERDA", 7: "IZQUIERDA", 2: "CENTRO", 5: "CENTRO", 8: "CENTRO", 3: "DERECHA", 6: "DERECHA", 9: "DERECHA", 10: "FUERA" };
const SHEET_COLS = ["EQUIPO", "NUMERO", "JUGADOR", "CONTRARIO", "ZONA TIRO", "DESTINO TIRO", "ACCION TIRO", "Resultado", "DESTINO_HORIZONTAL", "DESTINO_VERTICAL", "ID"];
const PALETTE = ["#3b82f6", "#f59e0b", "#10b981", "#ef4444", "#8b5cf6", "#ec4899", "#14b8a6", "#f97316", "#84cc16", "#06b6d4", "#64748b"];
const HIST_PAGE = 150;

const CFG = window.CONFIG || {};
const READ_ONLY = !CFG.SCRIPT_URL;

// ================================================================
// Utilidades
// ================================================================
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const up = (s) => String(s ?? "").trim().toUpperCase();
const numStr = (s) => String(s ?? "").trim().replace(/\.0+$/, "");
const pct = (a, b) => (b ? (100 * a) / b : 0);
const fmtPct = (a, b, d = 0) => (b ? pct(a, b).toFixed(d) + "%" : "–");
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const byNum = (a, b) => (parseInt(a, 10) || 999) - (parseInt(b, 10) || 999) || String(a).localeCompare(String(b));

const store = {
  get(k, def) { try { const v = localStorage.getItem(k); return v == null ? def : JSON.parse(v); } catch { return def; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* sin almacenamiento */ } },
};

function parseCSV(text) {
  const rows = []; let row = [], cur = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; }
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === ",") { row.push(cur); cur = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cur); rows.push(row); row = []; cur = "";
    } else cur += c;
  }
  if (cur !== "" || row.length) { row.push(cur); rows.push(row); }
  return rows;
}
function csvToObjects(text) {
  const [head, ...rows] = parseCSV(text);
  if (!head) return [];
  const keys = head.map((h) => up(h));
  return rows.filter((r) => r.some((c) => c.trim() !== "")).map((r) => Object.fromEntries(keys.map((k, i) => [k, r[i] ?? ""])));
}
function upKeys(o) { return Object.fromEntries(Object.entries(o).map(([k, v]) => [up(k), v])); }

function normRow(o) {
  o = upKeys(o);
  const destino = numStr(o["DESTINO TIRO"]);
  return {
    id: String(o.ID ?? "").trim(),
    equipo: up(o.EQUIPO),
    numero: numStr(o.NUMERO),
    jugador: up(o.JUGADOR),
    contrario: up(o.CONTRARIO),
    zona: up(o["ZONA TIRO"]),
    destino,
    accion: up(o["ACCION TIRO"]),
    resultado: up(o.RESULTADO),
    altura: up(o.DESTINO_HORIZONTAL) || ALTURA[destino] || "",
    lado: up(o.DESTINO_VERTICAL) || LADO[destino] || "",
  };
}
function toSheetRow(r) {
  const n = (v) => (/^\d+$/.test(v) ? Number(v) : v);
  return {
    EQUIPO: r.equipo, NUMERO: n(r.numero), JUGADOR: r.jugador, CONTRARIO: r.contrario,
    "ZONA TIRO": r.zona, "DESTINO TIRO": n(r.destino), "ACCION TIRO": r.accion, Resultado: r.resultado,
    DESTINO_HORIZONTAL: r.altura, DESTINO_VERTICAL: r.lado, ID: r.id,
  };
}

// ================================================================
// Estado
// ================================================================
// Registro: dos equipos fijos (a, b) y el titular ("a" o "b").
// El titular se escribe primero en el Sheets (columna EQUIPO) y es el que tiene la plantilla activa.
function migrateReg(o) {
  return { a: o.a ?? o.equipo ?? "", b: o.b ?? o.contrario ?? "", titular: o.titular === "b" ? "b" : "a" };
}
function regTeams() {
  const r = state.reg;
  return r.titular === "b" ? { equipo: r.b, contrario: r.a } : { equipo: r.a, contrario: r.b };
}

const state = {
  rows: [],                 // filas confirmadas en el Sheets
  roster: new Map(),        // equipo -> [{numero, nombre}]
  queue: store.get("bm_queue", []), // operaciones pendientes de enviar
  loaded: false,
  syncing: false,
  inFlight: [],             // operaciones que se están enviando ahora mismo
  error: "",
  tab: store.get("bm_tab", "registrar"),
  sel: { player: null, zona: "", destino: "", accion: "", resultado: "" },
  reg: migrateReg(store.get("bm_reg", {})),
  filters: { equipo: "", contrario: "", jugador: "", accion: "", zona: "" },
  sort: { key: "t", asc: false },
  destMode: "pct",
  histLimit: HIST_PAGE,
  histQuery: "",
};

function nameOf(equipo, numero) {
  const p = (state.roster.get(equipo) || []).find((x) => x.numero === numero);
  return p ? p.nombre : "";
}
const playerName = (r) => r.jugador || nameOf(r.equipo, r.numero);
const shortName = (n) => (n || "").split(/\s+/)[0] || "";

// Filas visibles = Sheets − borrados pendientes + altas pendientes
function viewRows() {
  const del = new Set(state.queue.filter((q) => q.op === "delete").map((q) => q.id));
  const rows = state.rows.filter((r) => !r.id || !del.has(r.id));
  for (const q of state.queue) if (q.op === "add" && !del.has(q.row.id)) rows.push({ ...q.row, pending: true });
  return rows;
}

function allTeams() {
  const s = new Set(state.roster.keys());
  for (const r of viewRows()) { if (r.equipo) s.add(r.equipo); if (r.contrario) s.add(r.contrario); }
  return [...s].sort((a, b) => a.localeCompare(b, "es"));
}

// ================================================================
// Carga de datos
// ================================================================
async function fetchGviz(sheet) {
  const url = `https://docs.google.com/spreadsheets/d/${CFG.SHEET_ID}/gviz/tq?tqx=out:csv&headers=1&sheet=${encodeURIComponent(sheet)}&t=${Date.now()}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("No se pudo leer el Sheets (" + res.status + ")");
  const text = await res.text();
  if (text.trimStart().startsWith("<")) throw new Error("El Sheets no es público. Configura SCRIPT_URL o compártelo como lector.");
  return csvToObjects(text);
}

async function loadData() {
  setBusy(true);
  try {
    let tiros, nombres;
    if (CFG.SCRIPT_URL) {
      const res = await fetch(CFG.SCRIPT_URL + "?action=list&t=" + Date.now());
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Error del script");
      ({ tiros, nombres } = data);
    } else {
      [tiros, nombres] = await Promise.all([fetchGviz(CFG.SHEET_TIROS || "LIMPIO"), fetchGviz(CFG.SHEET_NOMBRES || "NOMBRES")]);
    }
    state.rows = tiros.map(normRow).filter((r) => r.equipo || r.zona || r.resultado);
    const roster = new Map();
    for (const o of nombres.map(upKeys)) {
      const eq = up(o.EQUIPO), numero = numStr(o.NUMERO), nombre = up(o.NOMBRE ?? o.JUGADOR);
      if (!eq || !numero) continue;
      if (!roster.has(eq)) roster.set(eq, []);
      roster.get(eq).push({ numero, nombre });
    }
    for (const list of roster.values()) list.sort((a, b) => byNum(a.numero, b.numero));
    state.roster = roster;
    state.loaded = true;
    state.error = "";
  } catch (e) {
    console.error(e);
    state.error = e.message || String(e);
    toast("⚠ " + state.error);
  } finally {
    setBusy(false);
    renderAll();
  }
  flushQueue();
}

// ================================================================
// Envío al Sheets (cola con reintentos, funciona sin conexión)
// ================================================================
function saveQueue() { store.set("bm_queue", state.queue); }

// interactive = lo ha lanzado el usuario (puede pedir el PIN); los reintentos automáticos no preguntan
async function flushQueue(interactive = true) {
  if (READ_ONLY || state.syncing || !state.queue.length || !navigator.onLine) { updateSync(); return; }
  state.syncing = true; updateSync();
  const ops = state.queue.slice();
  state.inFlight = ops;
  let needPin = false;
  try {
    const res = await fetch(CFG.SCRIPT_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ pin: store.get("bm_pin", ""), ops: ops.map((q) => (q.op === "add" ? { op: "add", row: toSheetRow(q.row) } : q)) }),
    });
    const data = await res.json();
    if (!data.ok) {
      needPin = data.error === "pin";
      throw new Error(needPin ? "Falta el PIN o es incorrecto" : data.error || "Error del script");
    }
    // Pasar lo enviado al estado confirmado
    for (const q of ops) {
      if (q.op === "add") state.rows.push({ ...q.row });
      else state.rows = state.rows.filter((r) => r.id !== q.id);
    }
    state.queue = state.queue.filter((q) => !ops.includes(q));
    saveQueue();
    state.error = "";
  } catch (e) {
    console.warn("Sincronización pendiente:", e);
    state.error = e.message || "Sin conexión";
  } finally {
    state.syncing = false;
    state.inFlight = [];
    renderAll();
  }
  if (needPin && interactive) {
    const pin = await modal({ title: "PIN", text: "Introduce el PIN para guardar en el Sheets.", input: { type: "password", inputmode: "numeric" }, ok: "Guardar" });
    if (pin) { store.set("bm_pin", pin); return flushQueue(true); }
  } else if (state.queue.length && !state.error) {
    flushQueue(interactive);
  }
}
window.addEventListener("online", () => flushQueue(false));
setInterval(() => { if (state.queue.length) flushQueue(false); }, 30000);

function addShot(resultado) {
  const { player, zona, destino, accion } = state.sel;
  const { equipo, contrario } = regTeams();
  const row = {
    id: uid(),
    equipo, numero: player.numero, jugador: player.nombre,
    contrario, zona, destino, accion, resultado,
    altura: ALTURA[destino] || "", lado: LADO[destino] || "",
  };
  state.queue.push({ op: "add", row });
  saveQueue();
  return row;
}

function deleteShot(id) {
  const i = state.queue.findIndex((q) => q.op === "add" && q.row.id === id);
  if (i >= 0 && !state.inFlight.includes(state.queue[i])) state.queue.splice(i, 1); // aún no se había enviado
  else state.queue.push({ op: "delete", id });
  saveQueue();
  renderAll();
  flushQueue();
}

// ================================================================
// Estado de sincronización (cabecera)
// ================================================================
function setBusy(on) { $("#btnRefresh").classList.toggle("spin", on); }
function updateSync() {
  const pill = $("#syncPill");
  const n = state.queue.length;
  let txt, cls;
  if (!state.loaded && !state.error) { txt = "Cargando…"; cls = ""; }
  else if (READ_ONLY) { txt = "Solo lectura"; cls = "warn"; }
  else if (state.syncing) { txt = `Enviando ${n}…`; cls = "warn"; }
  else if (n && !navigator.onLine) { txt = `Sin conexión · ${n} pendiente${n > 1 ? "s" : ""}`; cls = "err"; }
  else if (n) { txt = `${n} pendiente${n > 1 ? "s" : ""}`; cls = state.error ? "err" : "warn"; }
  else if (state.error) { txt = "Error"; cls = "err"; }
  else { txt = "✓ Sincronizado"; cls = "ok"; }
  pill.textContent = txt;
  pill.className = "sync-pill " + cls;
  pill.title = state.error || "";
}

// Ventana propia en lugar de prompt()/confirm(), que algunos navegadores integrados bloquean
function modal({ title, text = "", input = null, ok = "Aceptar", danger = false }) {
  return new Promise((resolve) => {
    const dlg = $("#modal");
    dlg.innerHTML = `<form method="dialog">
      <h4>${esc(title)}</h4>${text ? `<p>${esc(text)}</p>` : ""}
      ${input ? `<input name="v" type="${input.type || "text"}" inputmode="${input.inputmode || "text"}" placeholder="${esc(input.placeholder || "")}" autocomplete="off">` : ""}
      <div class="modal-btns"><button value="cancel" class="btn ghost">Cancelar</button><button value="ok" class="btn ${danger ? "danger" : "primary"}">${esc(ok)}</button></div>
    </form>`;
    const field = $("input", dlg);
    dlg.onclose = () => resolve(dlg.returnValue === "ok" ? (field ? field.value.trim() : true) : null);
    dlg.returnValue = "";
    dlg.showModal();
    if (field) field.focus();
  });
}

let toastTimer;
function toast(msg, action) {
  const el = $("#toast");
  el.innerHTML = `<span>${esc(msg)}</span>` + (action ? `<button>${esc(action.label)}</button>` : "");
  if (action) $("button", el).onclick = () => { el.classList.remove("show"); action.fn(); };
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), action ? 5000 : 3200);
}

// ================================================================
// Dibujo: pista
// ================================================================
const LPX = 170, RPX = 230, R6 = 120, R9 = 220, BOTTOM = 372;
const rad = (d) => (d * Math.PI) / 180;
// φ ∈ [0,180]: 0 = línea de fondo izquierda, 90 = frente a portería, 180 = fondo derecha
function dpt(rho, phi, side) {
  if (phi < 90 || (phi === 90 && side !== "R")) return [LPX - rho * Math.cos(rad(phi)), rho * Math.sin(rad(phi))];
  return [RPX + rho * Math.cos(rad(180 - phi)), rho * Math.sin(rad(180 - phi))];
}
// Puntos de la línea "D" (6 m, 9 m…) a distancia rho entre los ángulos a y b.
// Al cruzar φ = 90 se añade el tramo recto entre los dos postes.
function arc(rho, a, b) {
  const n = Math.max(2, Math.ceil(Math.abs(b - a) / 2));
  const phis = [];
  for (let i = 0; i <= n; i++) phis.push(a + ((b - a) * i) / n);
  const out = [];
  for (let i = 0; i < phis.length; i++) {
    const phi = phis[i], prev = phis[i - 1];
    const both = b > a ? [dpt(rho, 90, "L"), dpt(rho, 90, "R")] : [dpt(rho, 90, "R"), dpt(rho, 90, "L")];
    if (phi === 90) { out.push(...both); continue; }
    if (prev != null && (prev - 90) * (phi - 90) < 0) out.push(...both);
    out.push(dpt(rho, phi, phi > 90 ? "R" : "L"));
  }
  return out;
}
function clipRect(poly, x0, y0, x1, y1) {
  const edges = [
    (p) => p[0] >= x0, (p) => p[0] <= x1, (p) => p[1] >= y0, (p) => p[1] <= y1,
  ];
  const cut = [
    (a, b) => { const t = (x0 - a[0]) / (b[0] - a[0]); return [x0, a[1] + t * (b[1] - a[1])]; },
    (a, b) => { const t = (x1 - a[0]) / (b[0] - a[0]); return [x1, a[1] + t * (b[1] - a[1])]; },
    (a, b) => { const t = (y0 - a[1]) / (b[1] - a[1]); return [a[0] + t * (b[0] - a[0]), y0]; },
    (a, b) => { const t = (y1 - a[1]) / (b[1] - a[1]); return [a[0] + t * (b[0] - a[0]), y1]; },
  ];
  let out = poly;
  for (let e = 0; e < 4; e++) {
    const inp = out; out = [];
    for (let i = 0; i < inp.length; i++) {
      const a = inp[(i + inp.length - 1) % inp.length], b = inp[i];
      const ia = edges[e](a), ib = edges[e](b);
      if (ib) { if (!ia) out.push(cut[e](a, b)); out.push(b); }
      else if (ia) out.push(cut[e](a, b));
    }
  }
  return out;
}
const pts = (p) => p.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
const pathOf = (p, close) => "M" + p.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join(" L") + (close ? " Z" : "");

const ZONE_GEOM = (() => {
  const band = (r1, r2, a, b) => clipRect([...arc(r2, a, b), ...arc(r1, b, a)], 0, 0, 400, BOTTOM);
  return {
    "EXT IZ": { poly: band(R6, 700, 0, 40), lbl: [30, 52] },
    "6 IZ": { poly: band(R6, R9, 40, 80), lbl: [100, 140] },
    "6 C": { poly: band(R6, R9, 80, 100), lbl: [200, 192] },
    "6 DE": { poly: band(R6, R9, 100, 140), lbl: [300, 140] },
    "EXT DER": { poly: band(R6, 700, 140, 180), lbl: [370, 52] },
    "LAT IZ": { poly: band(R9, 700, 40, 80), lbl: [66, 262] },
    "CENTRAL": { poly: band(R9, 700, 80, 100), lbl: [200, 272] },
    "LAT DER": { poly: band(R9, 700, 100, 140), lbl: [334, 262] },
    "SAQUE": { rect: [0, BOTTOM, 400, 46], lbl: [200, 396] },
    "PENALTI": { rect: [152, 122, 96, 38], lbl: [200, 143] },
    "POR": { semi: [200, 470, 54], lbl: [200, 450] },
  };
})();

function efColor(e, a = 1) {
  // rojo → ámbar → verde
  const stops = [[229, 72, 77], [245, 184, 61], [16, 185, 129]];
  const t = Math.max(0, Math.min(1, e)) * 2;
  const i = t < 1 ? 0 : 1, f = t - i;
  const c = stops[i].map((v, k) => Math.round(v + (stops[i + 1][k] - v) * f));
  return `rgba(${c.join(",")},${a})`;
}

/**
 * opts.mode: "select" (registro) o "stats" (tendencias)
 * opts.selected: zona marcada; opts.stats: {zona: {g, t}}
 */
function courtSVG(opts) {
  const { mode, selected, stats = {} } = opts;
  const isStats = mode === "stats";
  const zoneShape = (z, g, extra) => {
    if (g.poly) return `<polygon points="${pts(g.poly)}" ${extra}/>`;
    if (g.rect) return `<rect x="${g.rect[0]}" y="${g.rect[1]}" width="${g.rect[2]}" height="${g.rect[3]}" rx="${z === "PENALTI" ? 4 : 0}" ${extra}/>`;
    const [cx, cy, r] = g.semi;
    return `<path d="M${cx - r} ${cy} A${r} ${r} 0 0 1 ${cx + r} ${cy} Z" ${extra}/>`;
  };
  // En modo stats el penalti es una tarjeta más grande dentro del área para que quepan 2 líneas
  const statsLbl = { "6 C": [200, 160], "6 IZ": [95, 138], "6 DE": [305, 138], PENALTI: [200, 102] };
  const dark = `style="fill:#0b1220;stroke:none"`;
  let zones = "", labels = "";
  for (const z of ZONAS) {
    const g = ZONE_GEOM[z];
    const s = stats[z] || { g: 0, t: 0 };
    const on = selected === z;
    if (isStats && z === "PENALTI") {
      zones += `<rect x="146" y="66" width="108" height="60" rx="6" fill="#fff" class="zone" data-zona="PENALTI" ${on ? 'stroke="var(--accent)" stroke-width="4"' : ""}/>`;
    } else {
      let fill = "transparent";
      if (z === "PENALTI") fill = on ? "var(--accent)" : "#fff";
      else if (z === "POR") fill = on && !isStats ? "var(--accent)" : "var(--area)";
      else if (isStats && s.t) fill = efColor(s.g / s.t, on ? 1 : 0.82);
      else if (!isStats && on) fill = "rgba(255,107,129,.85)";
      const stroke = isStats && on ? `stroke="#fff" stroke-width="3"` : "";
      zones += zoneShape(z, g, `class="zone" data-zona="${z}" fill="${fill}" ${stroke}`);
    }

    const [x, y] = (isStats && statsLbl[z]) || g.lbl;
    const lstyle = z === "PENALTI" && (isStats || !on) ? dark : "";
    if (!isStats) {
      const sm = z === "PENALTI" || z === "SAQUE" || z === "POR" ? " sm" : "";
      const edge = z === "EXT IZ" ? [6, "start"] : z === "EXT DER" ? [394, "end"] : [x, "middle"];
      labels += `<text class="zone-lbl${sm}" x="${edge[0]}" y="${y + 6}" text-anchor="${edge[1]}" ${lstyle}>${z}</text>`;
    } else {
      const off = z === "SAQUE" || z === "POR" ? -6 : -10;
      labels += `<text class="zone-lbl" x="${x}" y="${y + off}" text-anchor="middle" ${lstyle}>${z}</text>`;
      labels += `<text class="zone-sub" x="${x}" y="${y + off + 16}" text-anchor="middle" ${lstyle}>${s.g} / ${s.t}</text>`;
      if (s.t && !["SAQUE", "POR", "PENALTI"].includes(z)) labels += `<text class="zone-ef" x="${x}" y="${y + off + 30}" text-anchor="middle">${fmtPct(s.g, s.t)}</text>`;
    }
  }
  const area6 = pathOf(arc(R6, 0, 180), true);
  const line9 = pathOf(arc(R9, 0, 180));
  const div = (phi) => { const a = dpt(R6, phi, phi > 90 ? "R" : "L"), b = dpt(700, phi, phi > 90 ? "R" : "L"); return `<line x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}"/>`; };

  return `<svg viewBox="0 0 400 470" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Pista" class="${isStats ? "court-stats" : "court-sel"}">
    <defs><clipPath id="cc-${mode}"><rect x="0" y="0" width="400" height="470"/></clipPath></defs>
    <rect x="0" y="0" width="400" height="470" fill="var(--court)"/>
    <path d="${area6}" fill="var(--area)"/>
    ${zones}
    <g clip-path="url(#cc-${mode})" fill="none" stroke="var(--court-line)" stroke-width="2" pointer-events="none">
      <path d="${area6}"/>
      <path d="${line9}" stroke-dasharray="10 8"/>
      <g stroke-width="1.6">${div(40)}${div(80)}${div(100)}${div(140)}</g>
      <line x1="0" y1="${BOTTOM}" x2="400" y2="${BOTTOM}" stroke-width="1" stroke-opacity=".35"/>
      <line x1="0" y1="400" x2="400" y2="400"/>
      <path d="M146 470 A54 54 0 0 1 254 470" />
    </g>
    ${labels}
  </svg>`;
}

// ================================================================
// Dibujo: portería
// ================================================================
const GX = 29, GY = 29, GW = 272, GH = 201;
function goalFrame(inner, id) {
  return `<svg viewBox="0 0 330 232" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <pattern id="net-${id}" width="12" height="12" patternUnits="userSpaceOnUse"><path d="M12 0H0V12" fill="none" stroke="rgba(255,255,255,.08)" stroke-width="1"/></pattern>
    </defs>
    <rect x="${GX}" y="${GY}" width="${GW}" height="${GH}" fill="#0f1d38"/>
    <rect x="${GX}" y="${GY}" width="${GW}" height="${GH}" fill="url(#net-${id})"/>
    ${inner}
    <g stroke-width="14" fill="none">
      <path d="M22 232 V22 H308 V232" stroke="#fff" stroke-linejoin="round"/>
      <path d="M22 232 V22 H308 V232" stroke="#e5484d" stroke-dasharray="18 18" stroke-linejoin="round"/>
    </g>
  </svg>`;
}
function goalGridSVG({ mode, selected, cells = {}, total = 0, destMode = "pct", id }) {
  const cw = GW / 3, ch = GH / 3;
  const maxV = Math.max(1, ...Object.values(cells).map((c) => (destMode === "ef" ? (c.t ? c.g / c.t : 0) : c.t)));
  let s = "";
  for (let i = 0; i < 9; i++) {
    const d = String(i + 1), x = GX + (i % 3) * cw, y = GY + Math.floor(i / 3) * ch;
    const c = cells[d] || { g: 0, t: 0 };
    if (mode === "select") {
      const on = selected === d;
      s += `<rect class="gcell" data-dest="${d}" x="${x}" y="${y}" width="${cw}" height="${ch}" fill="${on ? "rgba(255,107,129,.75)" : "transparent"}"/>`;
      s += `<text class="gnum" x="${x + cw / 2}" y="${y + ch / 2 + 8}" text-anchor="middle">${d}</text>`;
    } else {
      const v = destMode === "ef" ? (c.t ? c.g / c.t : 0) : c.t;
      const a = c.t ? 0.18 + 0.72 * (v / maxV) : 0;
      const fill = destMode === "ef" ? efColor(v, c.t ? 0.75 : 0) : `rgba(16,185,129,${a.toFixed(2)})`;
      const main = destMode === "pct" ? fmtPct(c.t, total, 1) : destMode === "gt" ? `${c.g}/${c.t}` : fmtPct(c.g, c.t);
      const sub = destMode === "pct" ? `${c.t} tiros` : destMode === "gt" ? fmtPct(c.g, c.t) + " ef." : `${c.g}/${c.t}`;
      s += `<rect x="${x}" y="${y}" width="${cw}" height="${ch}" fill="${fill}"/>`;
      s += `<text class="gval" x="${x + cw / 2}" y="${y + ch / 2 + 3}" text-anchor="middle">${main}</text>`;
      s += `<text class="gsub" x="${x + cw / 2}" y="${y + ch / 2 + 20}" text-anchor="middle">${sub}</text>`;
    }
  }
  s += `<g stroke="rgba(255,255,255,.85)" stroke-width="2" pointer-events="none">
    <line x1="${GX + cw}" y1="${GY}" x2="${GX + cw}" y2="${GY + GH}"/><line x1="${GX + 2 * cw}" y1="${GY}" x2="${GX + 2 * cw}" y2="${GY + GH}"/>
    <line x1="${GX}" y1="${GY + ch}" x2="${GX + GW}" y2="${GY + ch}"/><line x1="${GX}" y1="${GY + 2 * ch}" x2="${GX + GW}" y2="${GY + 2 * ch}"/></g>`;
  return goalFrame(s, id);
}
function goalBandsSVG({ parts, counts, vertical, id }) {
  const n = parts.length, max = Math.max(1, ...parts.map((p) => counts[p]?.t || 0));
  let s = "";
  parts.forEach((p, i) => {
    const c = counts[p] || { g: 0, t: 0 };
    const x = vertical ? GX + (i * GW) / n : GX, y = vertical ? GY : GY + (i * GH) / n;
    const w = vertical ? GW / n : GW, h = vertical ? GH : GH / n;
    s += `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="rgba(16,185,129,${c.t ? (0.15 + 0.6 * (c.t / max)).toFixed(2) : 0})" stroke="rgba(255,255,255,.7)" stroke-width="1.5"/>`;
    const cx = x + w / 2, cy = y + h / 2;
    s += `<text class="gsub" x="${cx}" y="${cy - 12}" text-anchor="middle" style="font-weight:700;letter-spacing:1px">${p}</text>`;
    s += `<text class="gval" x="${cx}" y="${cy + 10}" text-anchor="middle" style="font-size:24px">${c.t}</text>`;
    s += `<text class="gsub" x="${cx}" y="${cy + 26}" text-anchor="middle">${c.g} gol · ${fmtPct(c.g, c.t)}</text>`;
  });
  return goalFrame(s, id);
}

// ================================================================
// Registrar
// ================================================================
function renderRegistrar() {
  const teams = allTeams();
  if (!teams.includes(state.reg.a)) state.reg.a = teams[0] || "";
  if (!teams.includes(state.reg.b) || state.reg.b === state.reg.a) state.reg.b = teams.find((t) => t !== state.reg.a) || "";
  const opt = (v) => teams.map((t) => `<option ${t === v ? "selected" : ""}>${esc(t)}</option>`).join("");
  $("#regA").innerHTML = opt(state.reg.a);
  $("#regB").innerHTML = opt(state.reg.b);
  $("#titA").checked = state.reg.titular === "a";
  $("#titB").checked = state.reg.titular === "b";
  const { equipo, contrario } = regTeams();

  // Jugadores (del titular)
  const roster = state.roster.get(equipo) || [];
  const extra = state.sel.player && !roster.some((p) => p.numero === state.sel.player.numero) ? [state.sel.player] : [];
  const tiles = [...roster, ...extra].map((p) => {
    const on = state.sel.player && state.sel.player.numero === p.numero;
    return `<button class="ptile ${on ? "sel" : ""}" data-num="${esc(p.numero)}" title="${esc(p.nombre)}"><span class="num">${esc(p.numero)}</span><span class="name">${esc(shortName(p.nombre) || "—")}</span></button>`;
  }).join("");
  $("#regPlayers").innerHTML = (state.loaded && !roster.length ? `<div class="empty">Sin plantilla en la pestaña NOMBRES</div>` : "") + tiles +
    `<button class="ptile add" data-num="+"><span class="num">+</span><span class="name">Otro</span></button>`;

  $("#regGoal").innerHTML = goalGridSVG({ mode: "select", selected: state.sel.destino, id: "reg" }) +
    `<button class="out-chip ${state.sel.destino === "10" ? "sel" : ""}" data-dest="10">FUERA (10)</button>`;
  $("#regCourt").innerHTML = courtSVG({ mode: "select", selected: state.sel.zona });

  // Los amagos solo se ofrecen con penalti; si cambias de zona, se quita el amago elegido
  const conPenalti = state.sel.zona === "PENALTI";
  if (!conPenalti && ACCIONES_AMAGO.includes(state.sel.accion)) state.sel.accion = "";
  if (conPenalti && ACCIONES_BASE.includes(state.sel.accion)) state.sel.accion = "";
  const visibles = conPenalti ? ACCIONES_AMAGO : ACCIONES_BASE;
  $("#regAcciones").innerHTML = visibles.map((a) =>
    `<button class="acc ${a.includes("AMAGO") ? "amago" : ""} ${state.sel.accion === a ? "sel" : ""}" data-acc="${a}">${a}</button>`).join("");

  const s = state.sel;
  const chip = (ok, txt, ph) => `<span class="${ok ? "ok" : ""}">${esc(ok ? txt : ph)}</span>`;
  $("#regSummary").innerHTML =
    chip(s.player, s.player ? `#${s.player.numero} ${shortName(s.player.nombre)}` : "", "① Jugador") +
    chip(s.zona, s.zona, "② Zona") +
    chip(s.destino, s.destino === "10" ? "Fuera portería" : "Destino " + s.destino, "③ Destino") +
    chip(s.accion, s.accion, "④ Acción") +
    chip(s.resultado, s.resultado, "⑤ Resultado");
  const ready = s.player && s.zona && s.destino && s.accion;
  $$(".res").forEach((b) => {
    b.disabled = !ready;
    b.classList.toggle("sel", s.resultado === b.dataset.res);
  });
  const falta = [!s.player && "jugador", !s.zona && "zona", !s.destino && "destino", !s.accion && "acción", !s.resultado && "resultado"].filter(Boolean);
  const saveBtn = $("#regSave");
  saveBtn.disabled = !(ready && s.resultado);
  document.querySelector(".save-bar").classList.toggle("ready", !saveBtn.disabled);
  $("#regHint").textContent = falta.length ? "Falta: " + falta.join(", ") : "Listo para guardar";
  $("#regHint").className = "save-hint" + (falta.length ? "" : " ok");

  // Marcador y últimos tiros del partido seleccionado
  const match = viewRows().filter((r) => r.equipo === equipo && r.contrario === contrario);
  const cnt = (res) => match.filter((r) => r.resultado === res).length;
  $("#regScore").innerHTML = match.length
    ? `<span><b>${match.length}</b> tiros</span><i class="dot"></i><span><b>${cnt("GOL")}</b> goles</span><i class="dot"></i><span><b>${cnt("PARADA")}</b> paradas</span><i class="dot"></i><span><b>${cnt("FUERA")}</b> fuera</span>`
    : ``;
  const recent = match.slice(-5).reverse();
  $("#regRecent").innerHTML = recent.length
    ? `<div class="ttl">Últimos tiros</div>` + recent.map((r) =>
      `<div class="row ${r.pending ? "pending" : ""}"><b>${esc(r.numero)}</b><span class="meta">${esc(shortName(playerName(r)))} · ${esc(r.zona)} → ${esc(r.destino)} · ${esc(r.accion)}${r.pending ? " · ⏳" : ""}</span><span class="badge ${esc(r.resultado)}">${esc(r.resultado)}</span></div>`).join("")
    : "";
}

function bindRegistrar() {
  const setTeam = (slot) => (e) => {
    state.reg[slot] = e.target.value;
    const other = slot === "a" ? "b" : "a";
    if (state.reg[other] === state.reg[slot]) state.reg[other] = "";
    state.sel.player = null;
    store.set("bm_reg", state.reg); renderRegistrar();
  };
  $("#regA").onchange = setTeam("a");
  $("#regB").onchange = setTeam("b");
  const setTitular = (t) => () => {
    if (state.reg.titular === t) return;
    state.reg.titular = t; state.sel.player = null;   // cambia la plantilla; el resto del tiro se conserva
    store.set("bm_reg", state.reg); renderRegistrar();
  };
  $("#titA").onchange = setTitular("a");
  $("#titB").onchange = setTitular("b");
  $("#regPlayers").onclick = async (e) => {
    const b = e.target.closest(".ptile"); if (!b) return;
    if (b.dataset.num === "+") {
      const n = await modal({ title: "Otro jugador", text: "Dorsal del jugador:", input: { inputmode: "numeric", placeholder: "Ej. 33" } });
      if (!n) return;
      const numero = numStr(n);
      state.sel.player = { numero, nombre: nameOf(regTeams().equipo, numero) };
    } else {
      const numero = b.dataset.num;
      const p = (state.roster.get(regTeams().equipo) || []).find((x) => x.numero === numero) || state.sel.player;
      state.sel.player = state.sel.player?.numero === numero ? null : { numero, nombre: p?.nombre || "" };
    }
    renderRegistrar();
  };
  $("#regGoal").onclick = (e) => {
    const t = e.target.closest("[data-dest]"); if (!t) return;
    state.sel.destino = state.sel.destino === t.dataset.dest ? "" : t.dataset.dest; renderRegistrar();
  };
  $("#regCourt").onclick = (e) => {
    const t = e.target.closest("[data-zona]"); if (!t) return;
    state.sel.zona = state.sel.zona === t.dataset.zona ? "" : t.dataset.zona; renderRegistrar();
  };
  $("#regAcciones").onclick = (e) => {
    const t = e.target.closest("[data-acc]"); if (!t) return;
    state.sel.accion = state.sel.accion === t.dataset.acc ? "" : t.dataset.acc; renderRegistrar();
  };
  $$(".res").forEach((b) => (b.onclick = () => {
    state.sel.resultado = state.sel.resultado === b.dataset.res ? "" : b.dataset.res;
    renderRegistrar();
  }));
  // Atajos de teclado (PC): T titular · G/P/F resultado · Enter guardar
  document.addEventListener("keydown", (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.target.closest && e.target.closest("input, select, textarea")) return;
    if (!document.querySelector("#tab-registrar.active")) return;
    const k = e.key.toLowerCase();
    if (k === "t") $(state.reg.titular === "a" ? "#titB" : "#titA").click();
    else if (k === "g") $(".res.gol").click();
    else if (k === "p") $(".res.parada").click();
    else if (k === "f") $(".res.fuera").click();
    else if (e.key === "Enter") { const b = $("#regSave"); if (!b.disabled) b.click(); }
    else return;
    e.preventDefault();
  });
  $("#regSave").onclick = () => {
    if (READ_ONLY) { toast("Modo solo lectura: falta configurar SCRIPT_URL (ver README)"); return; }
    const { equipo, contrario } = regTeams();
    if (!equipo || !contrario) { toast("Elige equipo y contrario"); return; }
    const s = state.sel;
    if (!(s.player && s.zona && s.destino && s.accion && s.resultado)) return;
    const row = addShot(s.resultado);
    state.sel = { player: null, zona: "", destino: "", accion: "", resultado: "" };
    if (navigator.vibrate) navigator.vibrate(30);
    renderAll();
    toast(`✓ ${row.resultado} · #${row.numero} ${shortName(row.jugador)} · ${row.zona} → ${row.destino}`, { label: "Deshacer", fn: () => deleteShot(row.id) });
    flushQueue();
  };
}

// ================================================================
// Historial
// ================================================================
function renderHistorial() {
  const all = viewRows();
  const q = state.histQuery.trim().toUpperCase();
  let list = all.map((r, i) => ({ r, n: i + 1 })).reverse();
  if (q) list = list.filter(({ r }) => [r.equipo, r.numero, playerName(r), r.contrario, r.zona, r.destino, r.accion, r.resultado].join(" ").includes(q));
  const pend = all.filter((r) => r.pending).length;
  $("#histCount").innerHTML = `Registros: <b>${all.length}</b>` + (q ? ` · filtrados <b>${list.length}</b>` : "") + (pend ? ` · <span style="color:#fbbf24">${pend} pendientes de enviar</span>` : "");
  $("#histTable tbody").innerHTML = list.slice(0, state.histLimit).map(({ r, n }) => `
    <tr class="${r.pending ? "pending" : ""}">
      <td>${n}</td><td>${esc(r.equipo)}</td><td>${esc(r.numero)}</td><td title="${esc(playerName(r))}">${esc(playerName(r))}</td>
      <td>${esc(r.contrario)}</td><td>${esc(r.zona)}</td><td>${esc(r.destino)}</td><td>${esc(r.accion)}</td>
      <td><span class="badge ${esc(r.resultado)}">${esc(r.resultado)}</span></td>
      <td>${r.id && !READ_ONLY ? `<button class="del-btn" data-id="${esc(r.id)}" title="Borrar">🗑</button>` : ""}</td>
    </tr>`).join("") || `<tr><td colspan="10" class="empty-state">Sin registros</td></tr>`;
  $("#histMore").style.display = list.length > state.histLimit ? "" : "none";
  $("#btnUndo").disabled = READ_ONLY || !all.some((r) => r.id);
}

function describe(r) { return `#${r.numero} ${playerName(r)} · ${r.equipo} vs ${r.contrario} · ${r.zona} → ${r.destino} · ${r.accion} · ${r.resultado}`; }

function bindHistorial() {
  $("#histSearch").oninput = (e) => { state.histQuery = e.target.value; state.histLimit = HIST_PAGE; renderHistorial(); };
  $("#histMore").onclick = () => { state.histLimit += HIST_PAGE; renderHistorial(); };
  $("#btnImport").onclick = loadData;
  const askDelete = async (r, title) => {
    if (r && await modal({ title, text: describe(r), ok: "Borrar", danger: true })) deleteShot(r.id);
  };
  $("#btnUndo").onclick = () => askDelete([...viewRows()].reverse().find((x) => x.id), "¿Borrar el último lanzamiento registrado desde la app?");
  $("#histTable").onclick = (e) => {
    const b = e.target.closest(".del-btn"); if (!b) return;
    askDelete(viewRows().find((x) => x.id === b.dataset.id), "¿Borrar este lanzamiento?");
  };
  $("#btnExcel").onclick = exportExcel;
}

async function exportExcel() {
  const rows = viewRows().map((r) => SHEET_COLS.map((c) => {
    const o = toSheetRow({ ...r, jugador: playerName(r) }); return o[c] ?? "";
  }));
  const name = `balonmano-stats-${new Date().toISOString().slice(0, 10)}`;
  try {
    if (!window.XLSX) await new Promise((ok, ko) => {
      const s = document.createElement("script");
      s.src = "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js";
      s.onload = ok; s.onerror = ko; document.head.appendChild(s);
    });
    const ws = XLSX.utils.aoa_to_sheet([SHEET_COLS, ...rows]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "LIMPIO");
    XLSX.writeFile(wb, name + ".xlsx");
  } catch {
    // Sin conexión a la librería: CSV que Excel abre igual
    const csv = [SHEET_COLS, ...rows].map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(";")).join("\r\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }));
    a.download = name + ".csv"; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
}

// ================================================================
// Filtros (compartidos entre Stats y Tendencias)
// ================================================================
const pkey = (r) => r.equipo + "|" + r.numero;
function filtered(skipZona = false) {
  const f = state.filters;
  return viewRows().filter((r) =>
    (!f.equipo || r.equipo === f.equipo) &&
    (!f.contrario || r.contrario === f.contrario) &&
    (!f.jugador || pkey(r) === f.jugador) &&
    (!f.accion || r.accion === f.accion) &&
    (skipZona || !f.zona || r.zona === f.zona));
}

function renderFilters() {
  const rows = viewRows(), f = state.filters;
  const uniq = (arr) => [...new Set(arr.filter(Boolean))].sort((a, b) => a.localeCompare(b, "es"));
  const equipos = uniq(rows.map((r) => r.equipo));
  const contrarios = uniq(rows.filter((r) => !f.equipo || r.equipo === f.equipo).map((r) => r.contrario));
  const players = new Map();
  for (const r of rows) if (!f.equipo || r.equipo === f.equipo) players.set(pkey(r), r);
  const plist = [...players.entries()].sort((a, b) => a[1].equipo.localeCompare(b[1].equipo) || byNum(a[1].numero, b[1].numero));
  const acciones = uniq(rows.map((r) => r.accion));

  const sel = (name, label, all, opts) => `<label class="sel"><span>${label}</span><select data-f="${name}">
    <option value="">${all}</option>${opts.map(([v, t]) => `<option value="${esc(v)}" ${f[name] === v ? "selected" : ""}>${esc(t)}</option>`).join("")}</select></label>`;
  const html =
    sel("equipo", "Equipo", "Todos", equipos.map((e) => [e, e])) +
    sel("contrario", "Contrario", "Todos", contrarios.map((e) => [e, e])) +
    sel("jugador", "Jugador", "Todos", plist.map(([k, r]) => [k, `${r.numero} · ${playerName(r) || "—"}${f.equipo ? "" : " (" + r.equipo + ")"}`])) +
    sel("accion", "Acción", "Todas", acciones.map((a) => [a, a])) +
    `<div class="chips">${f.zona ? `<span class="chip">Zona: ${esc(f.zona)} <button data-clear="zona" aria-label="Quitar zona">✕</button></span>` : ""}${
      Object.values(f).some(Boolean) ? `<span class="chip" style="background:var(--panel-2);color:var(--muted)">Limpiar filtros <button data-clear="*" aria-label="Limpiar filtros">✕</button></span>` : ""}</div>`;
  $$("[data-filters]").forEach((el) => (el.innerHTML = html));
}

function bindFilters() {
  $$("[data-filters]").forEach((el) => {
    el.onchange = (e) => {
      const k = e.target.dataset.f; if (!k) return;
      state.filters[k] = e.target.value;
      if (k === "equipo") { state.filters.jugador = ""; state.filters.contrario = ""; }
      renderAnalysis();
    };
    el.onclick = (e) => {
      const b = e.target.closest("[data-clear]"); if (!b) return;
      if (b.dataset.clear === "*") Object.keys(state.filters).forEach((k) => (state.filters[k] = ""));
      else state.filters[b.dataset.clear] = "";
      renderAnalysis();
    };
  });
}

// ================================================================
// Stats
// ================================================================
function count(rows) {
  const c = { t: rows.length, g: 0, p: 0, f: 0 };
  for (const r of rows) { if (r.resultado === "GOL") c.g++; else if (r.resultado === "PARADA") c.p++; else if (r.resultado === "FUERA") c.f++; }
  return c;
}
function groupBy(rows, keyFn) {
  const m = new Map();
  for (const r of rows) { const k = keyFn(r); if (!m.has(k)) m.set(k, []); m.get(k).push(r); }
  return m;
}

function donutHTML(items, total) {
  const R = 52, C = 2 * Math.PI * R;
  let acc = 0, arcs = "";
  items.forEach((it, i) => {
    const len = (it.n / total) * C;
    arcs += `<circle r="${R}" cx="70" cy="70" fill="none" stroke="${it.color || PALETTE[i % PALETTE.length]}" stroke-width="22"
      stroke-dasharray="${Math.max(0, len - 1.2).toFixed(2)} ${C.toFixed(2)}" stroke-dashoffset="${(-acc).toFixed(2)}" transform="rotate(-90 70 70)"><title>${esc(it.label)}: ${it.n}</title></circle>`;
    acc += len;
  });
  const legend = items.map((it, i) => `<div><i style="background:${it.color || PALETTE[i % PALETTE.length]}"></i><span title="${esc(it.label)}">${esc(it.label)}</span><em>${it.n} · ${fmtPct(it.n, total, 1)}</em></div>`).join("");
  return `<svg viewBox="0 0 140 140">${arcs}<text class="center-n" x="70" y="74" text-anchor="middle">${total}</text><text class="center-l" x="70" y="92" text-anchor="middle">TIROS</text></svg><div class="legend">${legend}</div>`;
}

function renderStats() {
  const rows = filtered();
  const c = count(rows);
  $("#kpis").innerHTML = [
    ["Tiros", c.t, ""], ["% Eficacia", fmtPct(c.g, c.t, 1), "ef"], ["Goles", c.g, "gol"], ["Paradas", c.p, "parada"], ["Fuera", c.f, "fuera"],
  ].map(([k, v, cls]) => `<div class="kpi ${cls}"><div class="k">${k}</div><div class="v">${v}</div></div>`).join("");

  if (!rows.length) {
    const empty = `<div class="empty-state">${state.loaded ? "No hay tiros con estos filtros" : "Cargando…"}</div>`;
    ["#playerTable", "#trendPlayerTable"].forEach((s) => ($(s).innerHTML = `<tbody><tr><td>${empty}</td></tr></tbody>`));
    ["#donutZona", "#donutJugador", "#accionBars"].forEach((s) => ($(s).innerHTML = empty));
    return;
  }

  // Tabla de jugadores
  const players = [...groupBy(rows, pkey).values()].map((rs) => {
    const k = count(rs), r = rs[0];
    return { key: pkey(r), equipo: r.equipo, numero: r.numero, nombre: playerName(r) || "—", ...k, ef: k.t ? k.g / k.t : 0 };
  });
  const { key, asc } = state.sort;
  players.sort((a, b) => {
    const va = a[key], vb = b[key];
    const d = typeof va === "string" ? (key === "numero" ? byNum(va, vb) : va.localeCompare(vb, "es")) : va - vb;
    return (asc ? d : -d) || b.t - a.t;
  });
  const showTeam = !state.filters.equipo;
  const cols = [["nombre", "Jugador"], ["numero", "Nº"], ...(showTeam ? [["equipo", "Equipo"]] : []), ["t", "Tiros"], ["g", "Gol"], ["p", "Par."], ["f", "Fue."], ["ef", "% Ef"]];
  const tableHTML = `<thead><tr>${cols.map(([k, l]) => `<th data-sort="${k}" class="${k === "p" || k === "f" ? "hide-sm " : ""}${k === key ? "sorted" + (asc ? " asc" : "") : ""}">${l}</th>`).join("")}</tr></thead><tbody>${
    players.map((p) => `<tr data-key="${esc(p.key)}" data-eq="${esc(p.equipo)}"><td class="name" title="${esc(p.nombre)}">${esc(p.nombre)}</td><td>${esc(p.numero)}</td>${showTeam ? `<td class="team">${esc(p.equipo)}</td>` : ""}<td><b>${p.t}</b></td><td>${p.g}</td><td class="hide-sm">${p.p}</td><td class="hide-sm">${p.f}</td>
      <td><div class="efbar"><i><b style="width:${(p.ef * 100).toFixed(0)}%;background:${efColor(p.ef)}"></b></i><span>${(p.ef * 100).toFixed(0)}%</span></div></td></tr>`).join("")}</tbody>`;
  $("#playerTable").innerHTML = tableHTML;
  $("#trendPlayerTable").innerHTML = tableHTML;

  // Donut zonas
  const zonas = [...groupBy(rows, (r) => r.zona || "—").entries()].map(([z, rs]) => ({ label: z, n: rs.length })).sort((a, b) => b.n - a.n);
  $("#donutZona").innerHTML = donutHTML(zonas, rows.length);

  // Donut jugadores (top 9 + otros)
  const byP = players.slice().sort((a, b) => b.t - a.t);
  const top = byP.slice(0, 9).map((p) => ({ label: `${p.numero} · ${p.nombre}`, n: p.t }));
  const rest = byP.slice(9).reduce((s, p) => s + p.t, 0);
  if (rest) top.push({ label: `Otros (${byP.length - 9})`, n: rest, color: "#475569" });
  $("#donutJugador").innerHTML = donutHTML(top, rows.length);

  // Barras por acción
  const acc = [...groupBy(rows, (r) => r.accion || "—").entries()].map(([a, rs]) => ({ a, ...count(rs) })).sort((x, y) => y.t - x.t);
  const maxT = Math.max(...acc.map((x) => x.t));
  $("#accionBars").innerHTML = `<div class="bars-legend"><span><i style="background:var(--gol)"></i>Gol</span><span><i style="background:var(--parada)"></i>Parada</span><span><i style="background:var(--fuera)"></i>Fuera</span></div>` +
    acc.map((x) => {
      const w = (n) => ((n / maxT) * 100).toFixed(2) + "%";
      const lab = (n) => (n / maxT > 0.06 ? n : "");
      return `<div class="bar-row"><span class="lbl">${esc(x.a)}</span>
        <div class="track"><b class="g" style="width:${w(x.g)}">${lab(x.g)}</b><b class="p" style="width:${w(x.p)}">${lab(x.p)}</b><b class="f" style="width:${w(x.f)}">${lab(x.f)}</b></div>
        <span class="num"><b>${x.g}/${x.t}</b> · ${fmtPct(x.g, x.t)}</span></div>`;
    }).join("");
}

function bindStats() {
  ["#playerTable", "#trendPlayerTable"].forEach((s) => ($(s).onclick = playerTableClick));
}

function playerTableClick(e) {
  const th = e.target.closest("th[data-sort]");
  if (th) {
    const k = th.dataset.sort;
    state.sort = state.sort.key === k ? { key: k, asc: !state.sort.asc } : { key: k, asc: ["nombre", "numero", "equipo"].includes(k) };
    renderStats(); return;
  }
  const tr = e.target.closest("tr[data-key]");
  if (tr) {
    state.filters.equipo = tr.dataset.eq;
    state.filters.jugador = state.filters.jugador === tr.dataset.key ? "" : tr.dataset.key;
    renderAnalysis();
  }
}

// ================================================================
// Tendencias
// ================================================================
function renderTendencias() {
  const base = filtered(true);
  const zstats = {};
  for (const [z, rs] of groupBy(base, (r) => r.zona)) { const c = count(rs); zstats[z] = { g: c.g, t: c.t }; }
  $("#trendCourt").innerHTML = courtSVG({ mode: "stats", selected: state.filters.zona, stats: zstats });

  const rows = filtered();
  const cells = {};
  for (const [d, rs] of groupBy(rows, (r) => r.destino)) { const c = count(rs); cells[d] = { g: c.g, t: c.t }; }
  const out10 = cells["10"]?.t || 0;
  $("#destHint").textContent = state.destMode === "pct" ? "% sobre el total" : state.destMode === "gt" ? "goles / tiros" : "goles / tiros a cada zona";
  $("#trendGoal").innerHTML = goalGridSVG({ mode: "stats", cells, total: rows.length, destMode: state.destMode, id: "dest" }) +
    `<div class="goal-total">Total: ${rows.length}${out10 ? ` · fuera de portería (10): ${out10}` : ""}</div>`;
  $$("#destMode button").forEach((b) => b.classList.toggle("active", b.dataset.mode === state.destMode));

  // Listado detallado de lanzamientos que cumplen los filtros (más reciente arriba)
  const listRows = rows.map((r, i) => ({ r, n: i + 1 })).reverse();
  $("#trendListTitle").textContent = `Lanzamientos (${rows.length})`;
  $("#trendList tbody").innerHTML = listRows.map(({ r, n }) => `
    <tr class="${r.pending ? "pending" : ""}">
      <td>${n}</td><td>${esc(r.equipo)}</td><td>${esc(r.contrario)}</td><td>${esc(r.numero)}</td>
      <td title="${esc(playerName(r))}">${esc(playerName(r))}</td><td>${esc(r.zona)}</td><td>${esc(r.destino)}</td>
      <td>${esc(r.accion)}</td><td><span class="badge ${esc(r.resultado)}">${esc(r.resultado)}</span></td>
    </tr>`).join("") || `<tr><td colspan="9" class="empty-state">Sin lanzamientos con estos filtros</td></tr>`;

  const fuera = rows.filter((r) => r.resultado === "FUERA").length;
  const by = (field) => { const o = {}; for (const [k, rs] of groupBy(rows, (r) => r[field])) { const c = count(rs); o[k] = { g: c.g, t: c.t }; } return o; };
  const head = `<div class="goal-head">Tiros fuera <span>${fuera}</span></div>`;
  $("#trendAltura").innerHTML = head + goalBandsSVG({ parts: ["ARRIBA", "MEDIO", "ABAJO"], counts: by("altura"), vertical: false, id: "alt" }) + `<div class="goal-total">Total: ${rows.length}</div>`;
  $("#trendLado").innerHTML = head + goalBandsSVG({ parts: ["IZQUIERDA", "CENTRO", "DERECHA"], counts: by("lado"), vertical: true, id: "lado" }) + `<div class="goal-total">Total: ${rows.length}</div>`;
}

function bindTendencias() {
  $("#trendCourt").onclick = (e) => {
    const t = e.target.closest("[data-zona]"); if (!t) return;
    state.filters.zona = state.filters.zona === t.dataset.zona ? "" : t.dataset.zona;
    renderAnalysis();
  };
  $("#destMode").onclick = (e) => {
    const b = e.target.closest("[data-mode]"); if (!b) return;
    state.destMode = b.dataset.mode; renderTendencias();
  };
}

// ================================================================
// Navegación y render global
// ================================================================
function renderAnalysis() { renderFilters(); renderStats(); renderTendencias(); }
function renderAll() {
  updateSync();
  renderRegistrar();
  renderHistorial();
  renderAnalysis();
}
function showTab(tab) {
  if (!$("#tab-" + tab)) tab = "registrar";
  state.tab = tab; store.set("bm_tab", tab);
  document.body.dataset.theme = "dark";
  $$(".tab").forEach((s) => s.classList.toggle("active", s.id === "tab-" + tab));
  $$("#tabs button").forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
  window.scrollTo({ top: 0 });
}

$("#tabs").onclick = (e) => { const b = e.target.closest("[data-tab]"); if (b) showTab(b.dataset.tab); };
$("#btnRefresh").onclick = loadData;
bindRegistrar(); bindHistorial(); bindFilters(); bindStats(); bindTendencias();
showTab(state.tab);
renderAll();
loadData();
})();
