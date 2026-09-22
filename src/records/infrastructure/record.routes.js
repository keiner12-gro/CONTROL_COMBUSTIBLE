// ============================================================================
// record.routes.js (INFRAESTRUCTURA) — ENDPOINTS HTTP DE REGISTROS
// ----------------------------------------------------------------------------
//   GET    /api/analitica/maquinas -> estadísticas de consumo por máquina
//   GET    /api/registros          -> listado completo
//   POST   /api/registros          -> crear carga de combustible
// (El cierre del día y las lecturas M1/M2 están en src/jornadas/.)
//   PUT    /api/registros/:id      -> editar
//   DELETE /api/registros/:id      -> anular (requiere motivo)
// ============================================================================

const express = require('express');
const { requireAnyPermission, requirePermission } = require('../../shared/infrastructure/security');
const { registrarAuditoria } = require('../../shared/infrastructure/audit');
const { hoyLocal } = require('../../shared/application/fechas');
const { motivoDeRechazoPorFecha } = require('../../shared/application/retroactivo');

function crearRutasRegistros(service, auditRepository) {
  const router = express.Router();

  // --- GET /api/analitica/maquinas ----------------------------------------
  // Consumo agrupado por máquina. Sin parámetros devuelve el año en curso.
  router.get('/analitica/maquinas', requirePermission('reportes'), async (req, res, next) => {
    try {
      const anio = Number(hoyLocal().slice(0, 4)); // Año actual en la zona horaria local
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

  // --- POST /api/registros: crear una carga de combustible -----------------
  router.post('/registros', requirePermission('registro'), async (req, res, next) => {
    try {
      const fecha = String(req.body.fecha || '').slice(0, 10);
      const esCorreccionFecha = Boolean(fecha) && fecha !== hoyLocal(); // ¿Registro retroactivo?

      // CONTROL DE REGISTROS RETROACTIVOS SEGÚN EL ROL (ver retroactivo.js).
      // Los días permitidos se configuran en .env: DIAS_ATRAS_ADMIN (30) y
      // DIAS_ATRAS_PERMITIDOS (3). El operario solo puede registrar hoy y el
      // super administrador no tiene límite.
      const rechazo = motivoDeRechazoPorFecha(req.user, fecha);
      if (rechazo)
        return res.status(403).json({
          mensaje:
            req.user.rol === 'operario'
              ? 'Solo puedes registrar suministros con la fecha de hoy.'
              : rechazo
        });

      const creado = await service.create(req.body, req.user.usuario); // Aquí se validan datos y se generan alertas
      await registrarAuditoria(auditRepository, {
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
        await registrarAuditoria(auditRepository, {
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
        await registrarAuditoria(auditRepository, {
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
