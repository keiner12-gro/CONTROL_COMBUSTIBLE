// ============================================================================
// alert.service.js (APLICACIÓN) — LÓGICA DE ALERTAS Y SUS SOPORTES
// ----------------------------------------------------------------------------
// Dos responsabilidades principales:
//   1. create(): crear la alerta evitando duplicados.
//   2. update(): justificar una alerta, validando y guardando en disco el
//      archivo de soporte adjunto (PDF o imagen).
// PARA CAMBIAR LOS TIPOS DE ARCHIVO O EL PESO MÁXIMO permitidos en el soporte
// -> arreglo "permitidos" y la validación de 8 MB dentro de update().
// ============================================================================

const fs = require('fs/promises'); // Escritura de archivos en disco (versión con promesas)
const path = require('path'); // Rutas del sistema de archivos
const crypto = require('crypto'); // Sufijo aleatorio para los nombres de archivo

class AlertService {
  constructor(repository) {
    this.repository = repository;
  }

  // Todas las alertas (la pantalla las filtra en el navegador).
  async list() {
    return this.repository.list();
  }

  async findById(id) {
    return this.repository.findById(id);
  }

  // "connection" es opcional: si el llamador esta corriendo una transaccion
  // (ver record.service.js), la alerta se crea con esa misma conexion para
  // que quede todo o nada junto con el registro que la origina.
  async create(alerta, connection) {
    const tipo = alerta.tipoAlerta || 'sobrecapacidad';
    // Antidruplicados: un registro solo puede tener una alerta de cada tipo.
    const existente = alerta.registroId
      ? await this.repository.findByRegistro(alerta.registroId, tipo, connection)
      : null;
    if (existente) return existente; // Ya existía: se devuelve la misma
    return this.repository.create(alerta, connection);
  }

  // JUSTIFICAR una alerta: texto obligatorio + archivo de soporte opcional.
  async update(id, datos) {
    const alerta = (await this.repository.list()).find((a) => String(a.id) === String(id));
    if (!alerta) throw Object.assign(new Error('La alerta no existe.'), { status: 404 });

    const justificacion = String(datos.justificacion || '').trim();
    if (!justificacion)
      throw Object.assign(new Error('La justificación es obligatoria.'), { status: 400 });

    // El archivo es opcional. Si se adjunta, se valida y se almacena; si no,
    // la alerta queda justificada solamente con el texto ingresado.
    const actualizado = {
      justificacion,
      estado: 'justificada', // Deja de contar como pendiente
      justificadoPor: String(datos.usuario || datos.rol || 'usuario').trim() || 'usuario',
      justificadoEn: new Date()
    };

    if (datos.reporteBase64) {
      // El archivo llega como Data URL: "data:tipo/mime;base64,XXXXX"
      const [meta, data] = String(datos.reporteBase64).split(',', 2);
      const mime =
        (meta.match(/data:([^;]+);base64/i) || [])[1] || // Tipo declarado en la Data URL
        datos.reporteTipo ||
        'application/octet-stream';

      // VALIDACIÓN 1: solo se aceptan PDF e imágenes (nada de ejecutables).
      const permitidos = ['application/pdf', 'image/png', 'image/jpeg', 'image/webp'];
      if (!permitidos.includes(mime))
        throw Object.assign(new Error('El reporte debe ser PDF, PNG, JPG o WEBP.'), {
          status: 400
        });

      // VALIDACIÓN 2: peso máximo 8 MB y archivo no vacío.
      const buffer = Buffer.from(data || '', 'base64');
      if (!buffer.length || buffer.length > 8 * 1024 * 1024)
        throw Object.assign(new Error('El reporte debe pesar máximo 8 MB.'), { status: 400 });

      // Extensión deducida del tipo real, no del nombre que envió el usuario.
      const ext =
        { 'application/pdf': 'pdf', 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }[
          mime
        ] || 'bin';

      // VALIDACIÓN 3: se limpia el nombre original dejando solo caracteres
      // seguros, para evitar rutas maliciosas del tipo "../../archivo".
      const nombreOriginal = String(datos.reporteNombre || `reporte-alerta-${id}.${ext}`).replace(
        /[^a-zA-Z0-9._-]/g,
        '_'
      );
      // Nombre físico único: marca de tiempo + aleatorio + nombre limpio.
      const nombre = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}-${nombreOriginal}`;
      const carpeta = path.join(__dirname, '../../../uploads/reportes_alertas');
      await fs.mkdir(carpeta, { recursive: true }); // Crea la carpeta si no existe
      await fs.writeFile(path.join(carpeta, nombre), buffer);

      actualizado.reporteNombre = nombreOriginal; // Nombre que se muestra al usuario
      actualizado.reporteRuta = `/uploads/reportes_alertas/${nombre}`; // Ubicación real
      actualizado.reporteTipo = mime;
    }

    await this.repository.update(id, actualizado);

    // La notificación solo se considera leída cuando la alerta quedó justificada.
    // Al justificarse, se cierran las notificaciones de todos los roles asociados
    // a esa misma alerta para que no sigan apareciendo como pendientes.
    if (typeof this.repository.markNotificationsForAlert === 'function') {
      await this.repository.markNotificationsForAlert(id);
    }

    return { ...alerta, ...actualizado };
  }

  // Notificaciones de la campanita para un rol concreto.
  listNotifications(rol) {
    return this.repository.listNotifications(rol);
  }
  // Marca una notificación como leída.
  markNotification(id, rol) {
    return this.repository.markNotification(id, rol);
  }

  // Alertas dentro de un rango de fechas (se incluyen en los reportes).
  listByDateRange(inicio, fin) {
    return this.repository.listByDateRange(inicio, fin);
  }
}
module.exports = { AlertService };
