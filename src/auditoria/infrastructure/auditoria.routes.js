// ============================================================================
// auditoria.routes.js (INFRAESTRUCTURA) — ENDPOINTS HTTP DE LA BITÁCORA
// ----------------------------------------------------------------------------
//   GET    /api/auditoria        -> listado paginado con filtros y resumen
//   GET    /api/auditoria/:id    -> un evento concreto
//   GET    /api/auditoria/export -> exportar a CSV
// La bitácora es INMUTABLE: no existen rutas para editar ni borrar eventos,
// ni siquiera para el super administrador. Solo se agregan eventos nuevos
// (mediante registrarAuditoria) y se consultan aquí.
// "auditRepository" hace las consultas reales (Postgres o Airtable, según
// DB_PROVIDER); ver src/shared/domain/audit.repository.js.
// ============================================================================

const express = require('express');

// La columna "detalle" es JSON. Según el proveedor puede llegar como texto o
// como objeto ya interpretado; esta función normaliza ambos casos y nunca falla.
function parseDetalle(detalle) {
  if (!detalle) return {};
  if (typeof detalle === 'string') {
    try {
      return JSON.parse(detalle);
    } catch (_) {
      return { valor: detalle }; // No era JSON válido: se guarda como texto plano
    }
  }
  if (typeof detalle === 'object') return detalle;
  return { valor: detalle };
}

// Recorta cualquier fecha a YYYY-MM-DD.
function normalizarFecha(valor) {
  return String(valor || '').slice(0, 10);
}

// PERMISO DE LECTURA: todos los roles administrativos pueden consultar la
// auditoría; el operario no. (Este módulo no usa requirePermission porque el
// acceso se define por rol, no por la lista de vistas asignadas.)
function getAuditoriaAccess(req, res, next) {
  if (!req.user) return res.status(401).json({ mensaje: 'Sesión no válida.' });
  const rol = String(req.user.rol || '').toLowerCase();
  if (rol === 'operario') {
    return res.status(403).json({ mensaje: 'No tienes permiso para acceder a la auditoría.' });
  }
  if (['super_administrador', 'administrador', 'supervisor'].includes(rol)) return next();
  return res.status(403).json({ mensaje: 'No tienes permisos suficientes para esta operación.' });
}

// Recoge los filtros de la URL, ya recortados (el repositorio arma la
// consulta real con ellos, distinta según Postgres o Airtable).
function extraerFiltros(req) {
  const { fechaDesde, fechaHasta, usuario, accion, modulo, q } = req.query;
  return {
    fechaDesde: fechaDesde ? normalizarFecha(fechaDesde) : null,
    fechaHasta: fechaHasta ? normalizarFecha(fechaHasta) : null,
    usuario: usuario ? String(usuario).trim() : null,
    accion: accion ? String(accion).trim() : null,
    modulo: modulo ? String(modulo).trim() : null,
    q: q ? String(q).trim() : null
  };
}

function formatearEvento(registro) {
  return {
    ...registro,
    detalle: parseDetalle(registro.detalle),
    fecha: registro.creado_en,
    // Fecha ya formateada al estilo colombiano para mostrar directamente.
    fechaFormateada: new Date(registro.creado_en).toLocaleString('es-CO', {
      dateStyle: 'short',
      timeStyle: 'short'
    })
  };
}

function crearRutasAuditoria(auditRepository) {
  const router = express.Router();

  // --- GET /api/auditoria: listado paginado -------------------------------
  router.get('/auditoria', getAuditoriaAccess, async (req, res, next) => {
    try {
      const { page = '1', limit = '20' } = req.query;
      const filtros = {
        ...extraerFiltros(req),
        pagina: Math.max(1, Number(page) || 1), // Nunca menor que 1
        limite: Math.min(100, Math.max(1, Number(limit) || 20)) // Entre 1 y 100 por página
      };

      const [{ registros, total }, resumen] = await Promise.all([
        auditRepository.paginar(filtros),
        auditRepository.resumen(filtros)
      ]);

      res.json({
        page: filtros.pagina,
        limit: filtros.limite,
        total,
        totalPages: Math.max(1, Math.ceil(total / filtros.limite)), // Número de páginas
        resumen,
        registros: registros.map(formatearEvento)
      });
    } catch (error) {
      next(error);
    }
  });

  // --- GET /api/auditoria/export: descarga en CSV -------------------------
  // Va ANTES de '/auditoria/:id' para que Express no la tome como id="export".
  router.get('/auditoria/export', getAuditoriaAccess, async (req, res, next) => {
    try {
      const filas = await auditRepository.listarTodo(extraerFiltros(req)); // Exporta respetando los filtros activos
      // Primera fila del CSV: los encabezados de columna.
      const csv = [['id', 'usuario', 'rol', 'accion', 'modulo', 'registro_id', 'fecha', 'detalle']];

      filas.forEach((fila) => {
        csv.push([
          fila.id,
          fila.usuario || '',
          fila.rol || '',
          fila.accion || '',
          fila.modulo || '',
          fila.registro_id || '',
          fila.creado_en || '',
          JSON.stringify(parseDetalle(fila.detalle))
        ]);
      });

      // Cada celda se encierra en comillas y las comillas internas se duplican
      // ("") según el estándar CSV, para que no se rompan las columnas.
      const contenido = csv
        .map((fila) =>
          fila.map((valor) => `"${String(valor ?? '').replace(/"/g, '""')}"`).join(',')
        )
        .join('\n');

      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="auditoria_combustible.csv"'); // attachment = fuerza la descarga
      res.send(contenido);
    } catch (error) {
      next(error);
    }
  });

  // --- GET /api/auditoria/:id: un evento concreto -------------------------
  // OJO: Express resuelve por orden de declaración. Cualquier ruta con nombre
  // fijo (como /auditoria/export) debe declararse ARRIBA de esta.
  router.get('/auditoria/:id', getAuditoriaAccess, async (req, res, next) => {
    try {
      const fila = await auditRepository.obtener(req.params.id);
      if (!fila) return res.status(404).json({ mensaje: 'Registro de auditoría no encontrado.' });
      res.json(formatearEvento(fila));
    } catch (error) {
      next(error);
    }
  });

  return router;
}

module.exports = { crearRutasAuditoria };
