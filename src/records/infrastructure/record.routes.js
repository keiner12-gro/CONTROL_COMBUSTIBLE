const express = require('express');
const { requireAnyPermission, requirePermission } = require('../../shared/infrastructure/security');
const { registrarAuditoria } = require('../../shared/infrastructure/audit');

function crearRutasRegistros(service, reports, db) {
  const router = express.Router();

  router.get('/analitica/maquinas', requirePermission('reportes'), async (req, res, next) => {
    try {
      const hoy = new Date();
      const anio = hoy.getFullYear();
      const inicio = req.query.fechaInicio || `${anio}-01-01`;
      const fin = req.query.fechaFin || `${anio}-12-31`;
      res.json(await service.machineConsumptionStats(inicio, fin));
    } catch (error) {
      next(error);
    }
  });

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

  router.get('/cierre-dia/estado', requirePermission('registro'), async (req, res, next) => {
    try {
      res.json(await service.getDailyMeterState(req.query.fecha));
    } catch (error) {
      next(error);
    }
  });

  router.post('/registros', requirePermission('registro'), async (req, res, next) => {
    try {
      const creado = await service.create(req.body);
      await registrarAuditoria(db, {
        usuarioId: req.user.id,
        usuario: req.user.usuario,
        rol: req.user.rol,
        accion: 'CREAR',
        modulo: 'registros',
        registroId: creado.id,
        detalle: { maquina: req.body.maquina, cantidad: req.body.cantidad }
      });
      res.status(201).json(creado);
    } catch (error) {
      next(error);
    }
  });

  router.post('/cierre-dia', requirePermission('registro'), async (req, res, next) => {
    try {
      const cierre = await service.saveDailyClosing(req.body);
      await reports.generate();
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

  router.put(
    '/registros/:id',
    requireAnyPermission(['tablas', 'registro']),
    async (req, res, next) => {
      try {
        if (!(await service.update(req.params.id, req.body)))
          return res.status(400).json({ mensaje: 'No hay campos validos para actualizar.' });
        await registrarAuditoria(db, {
          usuarioId: req.user.id,
          usuario: req.user.usuario,
          rol: req.user.rol,
          accion: 'EDITAR',
          modulo: 'registros',
          registroId: req.params.id,
          detalle: req.body
        });
        res.json({ mensaje: 'Registro actualizado.' });
      } catch (error) {
        next(error);
      }
    }
  );

  router.delete(
    '/registros/:id',
    requireAnyPermission(['tablas', 'registro']),
    async (req, res, next) => {
      try {
        await service.remove(req.params.id);
        await registrarAuditoria(db, {
          usuarioId: req.user.id,
          usuario: req.user.usuario,
          rol: req.user.rol,
          accion: 'ELIMINAR',
          modulo: 'registros',
          registroId: req.params.id
        });
        res.json({ mensaje: 'Registro eliminado.' });
      } catch (error) {
        next(error);
      }
    }
  );

  return router;
}

module.exports = { crearRutasRegistros };
