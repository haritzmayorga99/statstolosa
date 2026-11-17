# Balonmano Stats

Web para registrar lanzamientos de balonmano durante un partido y analizarlos después. Funciona en el móvil y en el ordenador. Todos los datos se guardan en un Google Sheets, así que se pueden corregir a mano cuando haga falta.

**Apartados**

- **🎯 Registrar**: eliges el equipo y el contrario, y luego el jugador, la zona de la pista, el destino en la portería y el tipo de lanzamiento. Al pulsar **GOL**, **PARADA** o **FUERA** se guarda. Si no hay cobertura, los tiros esperan en el móvil y se envían solos cuando vuelve la conexión.
- **📋 Historial**: lista de todos los lanzamientos, con buscador, borrado y descarga en Excel.
- **📊 Stats**: totales, tabla por jugador (se ordena tocando las columnas), reparto por zona y por jugador, y resultados por tipo de lanzamiento.
- **📈 Tendencias**: eficacia por zona de la pista (toca una zona para filtrar), mapa de destino en la portería y reparto por altura y por lateralidad.

Los filtros de Stats y Tendencias (equipo, contrario, jugador y acción) son los mismos en los dos apartados.

---

## Estructura del Google Sheets

| Pestaña   | Uso |
|-----------|-----|
| `LIMPIO`  | Un lanzamiento por fila. La app lee de aquí y escribe aquí. |
| `NOMBRES` | Plantillas: `EQUIPO`, `NUMERO`, `NOMBRE`. De aquí salen los botones de jugadores. |

Columnas de `LIMPIO`:

`EQUIPO, NUMERO, JUGADOR, CONTRARIO, ZONA TIRO, DESTINO TIRO, ACCION TIRO, Resultado, DESTINO_HORIZONTAL, DESTINO_VERTICAL, ID`

- **DESTINO TIRO** va del 1 al 9 (rejilla de la portería, de izquierda a derecha y de arriba abajo). El 10 significa fuera de la portería.
- **DESTINO_HORIZONTAL** guarda la altura (ARRIBA, MEDIO, ABAJO) y **DESTINO_VERTICAL** el lado (IZQUIERDA, CENTRO, DERECHA). Los nombres están cruzados, pero se han mantenido así para no romper los datos que ya existían.
- **ID** lo rellena la app. Sirve para poder borrar desde la app los tiros que se registraron con ella. Las filas que se metieron a mano no tienen ID y solo se pueden borrar desde el Sheets.

---

## Instalación

### Paso 1: Publicar la web en GitHub Pages

1. Crea un repositorio nuevo en GitHub, por ejemplo `balonmano-stats`.
2. Sube todos los archivos de esta carpeta. Puedes arrastrarlos en **Add file → Upload files**.
3. Ve a **Settings → Pages → Build and deployment**, elige **Deploy from a branch**, la rama `main` y la carpeta `/ (root)`, y pulsa **Save**.
4. En un par de minutos la web estará disponible en `https://<usuario>.github.io/balonmano-stats/`.

Si el Sheets está compartido como **"Cualquier persona con el enlace → Lector"**, con esto ya se pueden **ver** las estadísticas. Para **registrar** tiros hace falta también el paso 2.

### Paso 2: Conectar el Sheets para guardar (Apps Script)

1. Abre el Google Sheets y ve a **Extensiones → Apps Script**.
2. Borra el contenido de `Code.gs`, pega el de [`apps-script/Code.gs`](apps-script/Code.gs) y guarda.
3. Pulsa **Implementar → Nueva implementación**. En el engranaje elige **Aplicación web** y configúrala así:
   - **Ejecutar como**: Yo
   - **Quién tiene acceso**: Cualquier usuario
4. Pulsa **Implementar** y acepta los permisos. Google avisará de que la app "no está verificada": entra en *Configuración avanzada → Ir a…*. Es normal, porque es tu propio script.
5. Copia la **URL de la aplicación web** (termina en `/exec`) y pégala en [`config.js`](config.js):

   ```js
   SCRIPT_URL: "https://script.google.com/macros/s/XXXXXXXX/exec",
   ```

6. Sube el `config.js` modificado a GitHub.

> Si más adelante cambias el código del script, usa **Implementar → Gestionar implementaciones → ✏️ → Nueva versión**. Así la URL no cambia.

### Paso 3 (recomendado): Poner un PIN

La URL del script está a la vista en `config.js`, así que cualquiera que la encuentre podría escribir en el Sheets. Para evitarlo:

1. En Apps Script, ve a **Configuración del proyecto (⚙) → Propiedades del script → Añadir propiedad**.
2. Pon `PIN` como nombre y el número que quieras como valor.

La app pedirá ese PIN la primera vez que se guarde un tiro en cada móvil u ordenador, y lo recordará después.

Con el script configurado, también puedes volver a poner el Sheets como privado: la app leerá los datos a través del script.

---

## Configuración (`config.js`)

| Clave           | Para qué sirve |
|-----------------|----------------|
| `SHEET_ID`      | El ID del Sheets, que es lo que va entre `/d/` y `/edit` en su URL. Se usa para leer sin script. |
| `SCRIPT_URL`    | La URL `/exec` del paso 2. Si está vacía, la app funciona en modo solo lectura. |
| `SHEET_TIROS`   | Nombre de la pestaña de lanzamientos (`LIMPIO`). |
| `SHEET_NOMBRES` | Nombre de la pestaña de plantillas (`NOMBRES`). |

## Probar en local

```bash
python3 -m http.server 8000
```

Después abre <http://localhost:8000>.

## Archivos

```
index.html          estructura de la página
styles.css          estilos (móvil y escritorio)
app.js              lógica: carga, registro, cola sin conexión y gráficos
config.js           configuración
apps-script/Code.gs API que se pega en el Google Sheets
```

La web no necesita ninguna instalación ni compilación. La única librería externa es [SheetJS](https://sheetjs.com/), y solo se descarga al pulsar "Excel".
