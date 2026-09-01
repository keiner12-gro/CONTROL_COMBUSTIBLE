const express = require('express');
const { requirePermission } = require('../../shared/infrastructure/security');
const { registrarAuditoria } = require('../../shared/infrastructure/audit');

function crearRutasTractores(service, db) {
  const router = express.Router();

  router.get('/tractores', async (req, res, next) => {
    const permiso = req.query.selector === '1' ? 'registro' : 'tractores';
    try {
      if (req.user.rol !== 'super_administrador' && !req.user.permisos.includes(permiso))
        return res.status(403).json({ mensaje: 'No tienes permiso para consultar máquinas.' });
      res.json(await service.list());
    } catch (error) {
      next(error);
    }
  });

  router.post('/tractores', requirePermission('tractores'), async (req, res, next) => {
    try {
      const creado = await service.create(req.body);
      await registrarAuditoria(db, {
        usuarioId: req.user.id,
        usuario: req.user.usuario,
        rol: req.user.rol,
        accion: 'CREAR',
        modulo: 'tractores',
        registroId: creado.id,
        detalle: creado
      });
      res.status(201).json(creado);
    } catch (error) {
      next(error);
    }
  });

  router.put('/tractores/:id', requirePermission('tractores'), async (req, res, next) => {
    try {
      const tractor = await service.update(req.params.id, req.body);
      if (!tractor) return res.status(404).json({ mensaje: 'Máquina no encontrada.' });
      await registrarAuditoria(db, {
        usuarioId: req.user.id,
        usuario: req.user.usuario,
        rol: req.user.rol,
        accion: 'EDITAR',
        modulo: 'tractores',
        registroId: req.params.id,
        detalle: req.body
      });
      res.json(tractor);
    } catch (error) {
      next(error);
    }
  });

  router.delete('/tractores/:id', requirePermission('tractores'), async (req, res, next) => {
    try {
      await service.remove(req.params.id);
      await registrarAuditoria(db, {
        usuarioId: req.user.id,
        usuario: req.user.usuario,
        rol: req.user.rol,
        accion: 'ELIMINAR',
        modulo: 'tractores',
        registroId: req.params.id
      });
      res.json({ mensaje: 'Máquina eliminada. Los registros históricos no se modificaron.' });
    } catch (error) {
      next(error);
    }
  });

  return router;
}

module.exports = { crearRutasTractores };
