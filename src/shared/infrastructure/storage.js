// ============================================================================
// storage.js — ALMACENAMIENTO DE ARCHIVOS ADJUNTOS (soportes de alertas)
// ----------------------------------------------------------------------------
// En Vercel el disco es de solo lectura, por eso los archivos van a
// SUPABASE STORAGE (bucket privado "soportes"). La ruta que se guarda en
// alertas_combustible.reporte_ruta tiene el formato:
//   "sb:alertas/1789-ab12-archivo.pdf"   -> archivo en Supabase Storage
//   "/uploads/reportes_alertas/x.pdf"    -> archivo antiguo en disco (solo lectura)
// Configuración (.env / variables de Vercel):
//   SUPABASE_URL, SUPABASE_SERVICE_KEY (¡solo en el servidor, nunca en el navegador!)
//   SUPABASE_BUCKET (opcional, por defecto "soportes")
// Sin esas variables, en LOCAL se guarda en la carpeta uploads/ (solo para
// desarrollo). En producción, sin configurar, se avisa con un error claro.
// PARA USAR OTRO SERVICIO (p. ej. Cloudflare R2) cambia solo guardar() y leer().
// ============================================================================

const path = require('path'); // Rutas del sistema de archivos
const fs = require('fs/promises'); // Archivos en disco (desarrollo y legado)
const crypto = require('crypto'); // Sufijo aleatorio para nombres únicos

const CARPETA_LOCAL = path.join(__dirname, '../../../uploads'); // Solo desarrollo / legado

function crearAlmacenamiento({ fetchImpl = globalThis.fetch } = {}) {
  const urlBase = String(process.env.SUPABASE_URL || '').replace(/\/+$/, '');
  const clave = process.env.SUPABASE_SERVICE_KEY || '';
  const bucket = process.env.SUPABASE_BUCKET || 'soportes';
  const usaSupabase = Boolean(urlBase && clave);

  // Las claves nuevas de Supabase ("sb_secret_...") van solo en "apikey"; la clave
  // antigua "service_role" (un JWT) va también como Bearer.
  const cabeceras = (extra = {}) => ({
    ...(clave.startsWith('sb_') ? {} : { Authorization: `Bearer ${clave}` }),
    apikey: clave,
    ...extra
  });
  // Codifica cada tramo de la ruta para la URL (los nombres pueden traer espacios).
  const rutaUrl = (ruta) => ruta.split('/').map(encodeURIComponent).join('/');

  async function leerDeDiscoLocal(ruta) {
    const absoluta = path.join(CARPETA_LOCAL, String(ruta).replace(/^\/?uploads\//, ''));
    if (!absoluta.startsWith(CARPETA_LOCAL + path.sep)) return null; // Anti path traversal
    try {
      return { buffer: await fs.readFile(absoluta) };
    } catch (_) {
      return null;
    }
  }

  return {
    usaSupabase,

    // Guarda el archivo y devuelve la "ruta" que se almacena en la alerta.
    async guardar(buffer, { nombre, tipo }) {
      const nombreUnico = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}-${nombre}`;

      if (usaSupabase) {
        const ruta = `alertas/${nombreUnico}`;
        const respuesta = await fetchImpl(
          `${urlBase}/storage/v1/object/${bucket}/${rutaUrl(ruta)}`,
          {
            method: 'POST',
            headers: cabeceras({ 'Content-Type': tipo, 'x-upsert': 'false' }),
            body: buffer
          }
        );
        if (!respuesta.ok) {
          const detalle = await respuesta.text().catch(() => '');
          console.error('Supabase Storage rechazó el archivo:', respuesta.status, detalle);
          throw Object.assign(new Error('No se pudo guardar el archivo adjunto.'), { status: 502 });
        }
        return `sb:${ruta}`;
      }

      if (process.env.NODE_ENV === 'production')
        throw Object.assign(
          new Error(
            'Almacenamiento de archivos sin configurar (faltan SUPABASE_URL y SUPABASE_SERVICE_KEY).'
          ),
          { status: 503 }
        );
      // Desarrollo local: se guarda en la carpeta uploads/.
      const carpeta = path.join(CARPETA_LOCAL, 'reportes_alertas');
      await fs.mkdir(carpeta, { recursive: true });
      await fs.writeFile(path.join(carpeta, nombreUnico), buffer);
      return `/uploads/reportes_alertas/${nombreUnico}`;
    },

    // Devuelve { buffer } o null si el archivo ya no existe.
    async leer(ruta) {
      const valor = String(ruta || '');
      if (valor.startsWith('sb:')) {
        if (!usaSupabase) return null;
        const respuesta = await fetchImpl(
          `${urlBase}/storage/v1/object/${bucket}/${rutaUrl(valor.slice(3))}`,
          { headers: cabeceras() }
        );
        if (!respuesta.ok) return null;
        return { buffer: Buffer.from(await respuesta.arrayBuffer()) };
      }
      return leerDeDiscoLocal(valor); // Archivos antiguos guardados en disco
    }
  };
}

module.exports = { crearAlmacenamiento };
