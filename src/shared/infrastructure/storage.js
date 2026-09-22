// ============================================================================
// storage.js — ALMACENAMIENTO DE ARCHIVOS ADJUNTOS (soportes de alertas)
// ----------------------------------------------------------------------------
// En Vercel el disco es de solo lectura, por eso los archivos NO se guardan en
// uploads/ en producción. Según DB_PROVIDER, van a uno de estos dos lugares:
//   * Supabase Storage (bucket privado "soportes"), ruta "sb:alertas/archivo.pdf"
//   * Airtable (tabla soportes_combustible, campo de adjuntos), ruta "at:recXXXX"
// Rutas viejas "/uploads/reportes_alertas/x.pdf" (archivos de antes de esta
// migración) se siguen leyendo del disco local, solo para no perder acceso a
// lo ya guardado; nunca se vuelve a ESCRIBIR ahí salvo en desarrollo local.
// Configuración (.env / Vercel):
//   Supabase -> SUPABASE_URL, SUPABASE_SERVICE_KEY (SUPABASE_BUCKET opcional)
//   Airtable -> se reutiliza el mismo cliente de AIRTABLE_API_KEY/AIRTABLE_BASE_ID
// PARA USAR OTRO SERVICIO (p. ej. Cloudflare R2) cambia solo guardar() y leer().
// ============================================================================

const path = require('path'); // Rutas del sistema de archivos
const fs = require('fs/promises'); // Archivos en disco (desarrollo y legado)
const crypto = require('crypto'); // Sufijo aleatorio para nombres únicos

const CARPETA_LOCAL = path.join(__dirname, '../../../uploads'); // Solo desarrollo / legado
const TABLA_AIRTABLE = 'soportes_combustible';

function crearAlmacenamiento({ fetchImpl = globalThis.fetch, airtableClient = null } = {}) {
  const urlBase = String(process.env.SUPABASE_URL || '').replace(/\/+$/, '');
  const clave = process.env.SUPABASE_SERVICE_KEY || '';
  const bucket = process.env.SUPABASE_BUCKET || 'soportes';
  const usaSupabase = Boolean(urlBase && clave);
  const usaAirtable = Boolean(airtableClient);

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
    usaAirtable,

    // Guarda el archivo y devuelve la "ruta" que se almacena en la alerta.
    async guardar(buffer, { nombre, tipo }) {
      const nombreUnico = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}-${nombre}`;

      if (usaAirtable) {
        // La fila se crea primero (vacía) porque subir el adjunto necesita el id.
        const [fila] = await airtableClient.crear(TABLA_AIRTABLE, [
          { nombre, tipo, creado_en: new Date().toISOString() }
        ]);
        await airtableClient.subirAdjunto(TABLA_AIRTABLE, fila.id, 'archivo', {
          nombre: nombreUnico,
          tipo,
          contenidoBase64: buffer.toString('base64')
        });
        return `at:${fila.id}`;
      }

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
            'Almacenamiento de archivos sin configurar (faltan las variables de Supabase o Airtable).'
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

      if (valor.startsWith('at:')) {
        if (!usaAirtable) return null;
        const fila = await airtableClient.obtener(TABLA_AIRTABLE, valor.slice(3));
        const adjunto = fila?.archivo?.[0]; // Airtable guarda los adjuntos como una lista
        if (!adjunto?.url) return null;
        // La URL del adjunto es temporal pero pública mientras dura: se descarga directo.
        const respuesta = await fetchImpl(adjunto.url);
        if (!respuesta.ok) return null;
        return { buffer: Buffer.from(await respuesta.arrayBuffer()) };
      }

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
