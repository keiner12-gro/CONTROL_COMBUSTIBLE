// ============================================================================
// storage.js — ALMACENAMIENTO DE ARCHIVOS ADJUNTOS (soportes de alertas)
// ----------------------------------------------------------------------------
// En Vercel el disco es de solo lectura, así que los archivos NO pueden
// guardarse en /uploads. Por ahora se guardan en la base de datos (tabla
// soportes_combustible). La ruta guardada en la alerta tiene el formato:
//   "db:<id>"                    -> archivo guardado en la base (actual)
//   "/uploads/reportes_alertas/x"-> archivo viejo en disco (solo lectura, legado)
// PARA MIGRAR A CLOUDFLARE R2: reemplaza guardar() y leer() por llamadas al
// bucket (prefijo "r2:<clave>") y deja intacto el resto de la aplicación.
// ============================================================================

const path = require('path'); // Rutas del sistema de archivos (solo para el legado en disco)
const fs = require('fs/promises'); // Lectura de archivos viejos guardados en /uploads

const CARPETA_LEGADO = path.join(__dirname, '../../../uploads'); // Carpeta antigua de soportes

function crearAlmacenamiento(db) {
  return {
    // Guarda el archivo y devuelve la "ruta" que se almacena en alertas_combustible.
    async guardar(buffer, { nombre, tipo }) {
      const [resultado] = await db.query(
        'INSERT INTO soportes_combustible(nombre,tipo,contenido) VALUES(?,?,?)',
        [nombre, tipo, buffer]
      );
      return `db:${resultado.insertId}`;
    },

    // Devuelve { buffer } o null si el archivo ya no existe.
    async leer(ruta) {
      const valor = String(ruta || '');
      if (valor.startsWith('db:')) {
        const [filas] = await db.query('SELECT contenido FROM soportes_combustible WHERE id=?', [
          Number(valor.slice(3))
        ]);
        return filas.length ? { buffer: filas[0].contenido } : null;
      }
      // Legado: archivos que se subieron cuando se guardaba en disco.
      const absoluta = path.join(CARPETA_LEGADO, valor.replace(/^\/?uploads\//, ''));
      if (!absoluta.startsWith(CARPETA_LEGADO + path.sep)) return null; // Anti path traversal
      try {
        return { buffer: await fs.readFile(absoluta) };
      } catch (_) {
        return null;
      }
    }
  };
}

module.exports = { crearAlmacenamiento };
