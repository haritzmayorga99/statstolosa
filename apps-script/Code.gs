/**
 * Balonmano Stats — API para Google Sheets
 *
 * Pegar en el Sheets: Extensiones → Apps Script → Code.gs
 * Implementar → Nueva implementación → Aplicación web
 *   - Ejecutar como: Yo
 *   - Quién tiene acceso: Cualquier usuario
 * Copiar la URL (termina en /exec) en config.js → SCRIPT_URL
 *
 * PIN opcional: Configuración del proyecto (⚙) → Propiedades del script →
 * añadir la propiedad PIN con el valor que quieras. Si existe, la app lo
 * pedirá la primera vez que alguien guarde un lanzamiento.
 */

const SHEET_TIROS = 'LIMPIO';
const SHEET_NOMBRES = 'NOMBRES';
const ID_HEADER = 'ID';

function doGet() {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    return json_({
      ok: true,
      tiros: readSheet_(ss.getSheetByName(SHEET_TIROS)),
      nombres: readSheet_(ss.getSheetByName(SHEET_NOMBRES)),
    });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  }
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const body = JSON.parse(e.postData.contents);
    const pin = PropertiesService.getScriptProperties().getProperty('PIN');
    if (pin && String(body.pin || '') !== String(pin)) return json_({ ok: false, error: 'pin' });

    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_TIROS);
    const headers = ensureIdColumn_(sheet);
    const idCol = headers.indexOf(ID_HEADER) + 1;
    const results = [];

    (body.ops || []).forEach(function (op) {
      if (op.op === 'add') {
        const row = op.row || {};
        if (row.ID && findRowById_(sheet, idCol, row.ID)) { results.push('duplicate'); return; }
        const values = headers.map(function (h) {
          const key = Object.keys(row).filter(function (k) { return k.trim().toUpperCase() === h.trim().toUpperCase(); })[0];
          return key === undefined ? '' : row[key];
        });
        sheet.appendRow(values);
        results.push('added');
      } else if (op.op === 'delete') {
        const r = findRowById_(sheet, idCol, op.id);
        if (r) { sheet.deleteRow(r); results.push('deleted'); } else results.push('missing');
      }
    });
    return json_({ ok: true, results: results });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}

// --- utilidades ---

function readSheet_(sheet) {
  if (!sheet) return [];
  const values = sheet.getDataRange().getDisplayValues();
  const headers = values.shift().map(function (h) { return String(h).trim(); });
  return values
    .filter(function (r) { return r.some(function (c) { return c !== ''; }); })
    .map(function (r) {
      const o = {};
      headers.forEach(function (h, i) { if (h) o[h] = r[i]; });
      return o;
    });
}

// Añade la columna ID al final de la cabecera si todavía no existe
function ensureIdColumn_(sheet) {
  const lastCol = Math.max(sheet.getLastColumn(), 1);
  const headers = sheet.getRange(1, 1, 1, lastCol).getDisplayValues()[0].map(function (h) { return String(h).trim(); });
  if (headers.indexOf(ID_HEADER) === -1) {
    sheet.getRange(1, lastCol + 1).setValue(ID_HEADER);
    headers.push(ID_HEADER);
  }
  return headers;
}

function findRowById_(sheet, idCol, id) {
  if (!id || sheet.getLastRow() < 2) return 0;
  const found = sheet.getRange(2, idCol, sheet.getLastRow() - 1, 1)
    .createTextFinder(String(id)).matchEntireCell(true).findNext();
  return found ? found.getRow() : 0;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
