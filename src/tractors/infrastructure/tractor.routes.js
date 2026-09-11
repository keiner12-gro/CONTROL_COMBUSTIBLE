// ============================================================================
// tractor.routes.js (INFRAESTRUCTURA) — ENDPOINTS HTTP DE MAQUINARIA
// ----------------------------------------------------------------------------
//   GET    /api/tractores      -> listar (también alimenta el selector del registro)
//   POST   /api/tractores      -> crear
//   PUT    /api/tractores/:id  -> editar
//   DELETE /api/tractores/:id  -> anular (requiere motivo)
// ============================================================================

const express = require('express');
const { requirePermission } = require('../../shared/infrastructure/security');
const { registrarAuditoria } = require('../../shared/infrastructure/audit');

function crearRutasTractores(service, db) {
  const router = express.Router();

  // --- GET /api/tractores --------------------------------------------------
  // Permiso variable: si la petición viene del selector del formulario de
  // registro (?selector=1) basta con el permiso 'registro'; si viene de la
  // pantalla de administración se exige el permiso 'tractores'.
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

  // --- POST /api/tractores: crear máquina ----------------------------------
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

  // --- PUT /api/tractores/:id: editar máquina ------------------------------
  router.put('/tractores/:id', requirePermission('tractores'), async (req, res, next) => {
    try {
      const antes = await service.findById(req.params.id); // Foto previa para la auditoría
      const tractor = await service.update(req.params.id, req.body);
      if (!tractor) return res.status(404).json({ mensaje: 'Máquina no encontrada.' });
      await registrarAuditoria(db, {
        usuarioId: req.user.id,
        usuario: req.user.usuario,
        rol: req.user.rol,
        // Cambiar la capacidad se audita aparte porque afecta directamente a
        // qué cargas disparan alerta de sobrecapacidad.
        accion:
          antes && Number(antes.capacidad_galones) !== Number(req.body.capacidad_galones)
            ? 'CAMBIAR_CAPACIDAD'
            : 'EDITAR',
        modulo: 'tractores',
        registroId: req.params.id,
        detalle: { antes, despues: req.body }
      });
      res.json(tractor);
    } catch (error) {
      next(error);
    }
  });

  // --- DELETE /api/tractores/:id: anulación lógica -------------------------
  // No borra la máquina: la marca como ANULADA con motivo, usuario y fecha.
  router.delete('/tractores/:id', requirePermission('tractores'), async (req, res, next) => {
    try {
      const motivo = String(req.body?.motivo || '').trim(); // El service exige que no esté vacío
      const anulado = await service.remove(req.params.id, motivo, req.user.usuario);
      await registrarAuditoria(db, {
        usuarioId: req.user.id,
        usuario: req.user.usuario,
        rol: req.user.rol,
        accion: 'ANULAR',
        modulo: 'tractores',
        registroId: req.params.id,
        detalle: { antes: anulado, motivo }
      });
      res.json({ mensaje: 'Máquina anulada. Los registros históricos no se modificaron.' });
    } catch (error) {
      next(error);
    }
  });

  return router;
}

module.exports = { crearRutasTractores };
