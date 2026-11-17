// Configuración de la app. Es lo único que hay que tocar al instalarla.
window.CONFIG = {
  // ID del Google Sheets (lo que va entre /d/ y /edit en la URL).
  // Con esto la app puede LEER los datos si el Sheets está compartido como
  // "Cualquier persona con el enlace → Lector".
  SHEET_ID: "1ZQpcvqXAaaLxLX0Dwp0xD3FKXicN4kXjFbaUSziVrw4",

  // URL de la Web App de Apps Script (termina en /exec). Necesaria para
  // REGISTRAR y BORRAR lanzamientos. Ver README.md → "Paso 2".
  // Si se deja vacía, la app funciona en modo solo lectura.
  SCRIPT_URL: "https://script.google.com/macros/s/AKfycbwQme_73vGLaNlU6tVSoggODFU4kkYVRliGDwX_LiiVZdeimtoqAihi8-VVC2NOCp-r/exec",

  // Nombres de las pestañas del Sheets.
  SHEET_TIROS: "LIMPIO",
  SHEET_NOMBRES: "NOMBRES",
};
