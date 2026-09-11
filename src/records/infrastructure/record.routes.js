// ============================================================================
// record.routes.js (INFRAESTRUCTURA) — ENDPOINTS HTTP DE REGISTROS
// ----------------------------------------------------------------------------
//   GET    /api/analitica/maquinas -> estadísticas de consumo por máquina
//   GET    /api/registros          -> listado completo
//   GET    /api/cierre-dia/estado  -> lecturas de medidores de una fecha
//   POST   /api/registros          -> crear carga de combustible
//   POST   /api/cierre-dia         -> guardar el cierre del día
//   PUT    /api/registros/:id      -> editar
//   DELETE /api/registros/:id      -> anular (requiere motivo)
// ============================================================================

const express = require('express');
const { requireAnyPermission, requirePermission } = require('../../shared/infrastructure/security');
const { registrarAuditoria } = require('../../shared/infrastructure/audit');

function crearRutasRegistros(service, reports, db) {
  const router = express.Router();

  // --- GET /api/analitica/maquinas ----------------------------------------
  // Consumo agrupado por máquina. Sin parámetros devuelve el año en curso.
  router.get('/analitica/maquinas', requirePermission('reportes'), async (req, res, next) => {
    try {
      const hoy = new Date();
      const anio = hoy.getFullYear();
      const inicio = req.query.fechaInicio || `${anio}-01-01`; // 1 de enero por defecto
      const fin = req.query.fechaFin || `${anio}-12-31`; // 31 de diciembre por defecto
      res.json(await service.machineConsumptionStats(inicio, fin));
    } catch (error) {
      next(error);
    }
  });

  // --- GET /api/registros --------------------------------------------------
  // Lo consultan tres pantallas distintas, por eso acepta cualquiera de los
  // tres permisos.
  router.get(
    '/registros',
    requireAnyPermission(['registro', 'tablas', 'reportes']),
    async (req, res, next) => {
      try {
        res.json(await service.list());
      } catch (error) {
        next(error);
      }
    }
  );

  // --- GET /api/cierre-dia/estado?fecha=YYYY-MM-DD -------------------------
  // El formulario lo llama al cargar para saber con qué lecturas abrir el día.
  router.get('/cierre-dia/estado', requirePermission('registro'), async (req, res, next) => {
    try {
      res.json(await service.getDailyMeterState(req.query.fecha));
    } catch (error) {
      next(error);
    }
  });

  // --- POST /api/registros: crear una carga de combustible -----------------
  router.post('/registros', requirePermission('registro'), async (req, res, next) => {
    try {
      const hoy = new Date().toISOString().slice(0, 10);
      const fecha = String(req.body.fecha || '').slice(0, 10);
      const esCorreccionFecha = Boolean(fecha) && fecha !== hoy; // ¿Registro retroactivo?

      // CONTROL DE REGISTROS RETROACTIVOS SEGÚN EL ROL.
      // Los días permitidos se configuran en .env:
      //   DIAS_ATRAS_ADMIN (administrador, 30 por defecto)
      //   DIAS_ATRAS_PERMITIDOS (supervisor, 3 por defecto)
      // El operario no puede registrar fechas pasadas y el super administrador
      // no tiene límite.
      if (esCorreccionFecha && req.user.rol !== 'super_administrador') {
        const limiteDias =
          req.user.rol === 'administrador'
            ? Number(process.env.DIAS_ATRAS_ADMIN || 30)
            : req.user.rol === 'supervisor'
              ? Number(process.env.DIAS_ATRAS_PERMITIDOS || 3)
              : 0; // Operario u otro rol: 0 días hacia atrás
        const fechaLimite = new Date();
        fechaLimite.setDate(fechaLimite.getDate() - limiteDias); // Fecha más antigua permitida
        if (limiteDias <= 0 || fecha < fechaLimite.toISOString().slice(0, 10))
          return res.status(403).json({
            mensaje:
              req.user.rol === 'operario'
                ? 'Solo puedes registrar suministros con la fecha de hoy.'
                : `No puedes registrar una fecha con más de ${limiteDias} día(s) de antigüedad.`
          });
      }

      const creado = await service.create(req.body); // Aquí se validan datos y se generan alertas
      await registrarAuditoria(db, {
        usuarioId: req.user.id,
        usuario: req.user.usuario,
        rol: req.user.rol,
        accion: 'CREAR',
        modulo: 'registros',
        registroId: creado.id,
        detalle: {
          maquina: req.body.maquina,
          cantidad: req.body.cantidad,
          fechaRegistro: fecha || null,
          correccionFechaRetroactiva: esCorreccionFecha // Queda marcado si fue retroactivo
        }
      });
      res.status(201).json(creado);
    } catch (error) {
      next(error);
    }
  });

  // --- POST /api/cierre-dia: cerrar la jornada -----------------------------
  router.post('/cierre-dia', requirePermission('registro'), async (req, res, next) => {
    try {
      const cierre = await service.saveDailyClosing(req.body);
      await reports.generate(); // Recalcula los totales del reporte mensual afectado
      await registrarAuditoria(db, {
        usuarioId: req.user.id,
        usuario: req.user.usuario,
        rol: req.user.rol,
        accion: 'CIERRE_DIA',
        modulo: 'surtidor',
        registroId: cierre.id,
        detalle: { fecha: req.body.fecha, m1Final: req.body.m1Final, m2Final: req.body.m2Final }
      });
      res.status(201).json(cierre);
    } catch (error) {
      next(error);
    }
  });

  // --- PUT /api/registros/:id: editar un registro --------------------------
  // Solo se aplican los campos de la lista blanca del repositorio.
  router.put(
    '/registros/:id',
    requireAnyPermission(['tablas', 'registro']),
    async (req, res, next) => {
      try {
        const antes = await service.findById(req.params.id); // Valor previo para auditar
        if (!(await service.update(req.params.id, req.body)))
          return res.status(400).json({ mensaje: 'No hay campos validos para actualizar.' });
        await registrarAuditoria(db, {
          usuarioId: req.user.id,
          usuario: req.user.usuario,
          rol: req.user.rol,
          accion: 'EDITAR',
          modulo: 'registros',
          registroId: req.params.id,
          detalle: { antes, despues: req.body }
        });
        res.json({ mensaje: 'Registro actualizado.' });
      } catch (error) {
        next(error);
      }
    }
  );

  // --- DELETE /api/registros/:id: anulación lógica -------------------------
  router.delete(
    '/registros/:id',
    requireAnyPermission(['tablas', 'registro']),
    async (req, res, next) => {
      try {
        const motivo = String(req.body?.motivo || '').trim();
        const anulado = await service.remove(req.params.id, motivo, req.user.usuario);
        await registrarAuditoria(db, {
          usuarioId: req.user.id,
          usuario: req.user.usuario,
          rol: req.user.rol,
          accion: 'ANULAR',
          modulo: 'registros',
          registroId: req.params.id,
          detalle: { antes: anulado, motivo }
        });
        res.json({ mensaje: 'Registro anulado. Queda disponible en el historial de auditoría.' });
      } catch (error) {
        next(error);
      }
    }
  );

  return router;
}

module.exports = { crearRutasRegistros };
