// ============================================================================
// operator.routes.js (INFRAESTRUCTURA) — ENDPOINTS HTTP DE OPERARIOS
// ----------------------------------------------------------------------------
//   GET    /api/operarios      -> listar (pantalla o selector del registro)
//   POST   /api/operarios      -> crear
//   DELETE /api/operarios/:id  -> anular (requiere motivo)
// ============================================================================

const express = require('express');
const { requirePermission } = require('../../shared/infrastructure/security');
const { registrarAuditoria } = require('../../shared/infrastructure/audit');

function crearRutasOperarios(service, auditRepository) {
  const router = express.Router();

  // --- GET /api/operarios --------------------------------------------------
  // Igual que en tractores: ?selector=1 lo usa el formulario de registro y
  // basta con el permiso 'registro'; si no, se exige el permiso 'operarios'.
  router.get('/operarios', async (req, res, next) => {
    const permiso = req.query.selector === '1' ? 'registro' : 'operarios';
    try {
      if (req.user.rol !== 'super_administrador' && !req.user.permisos.includes(permiso))
        return res.status(403).json({ mensaje: 'No tienes permiso para consultar operarios.' });
      res.json(await service.list());
    } catch (error) {
      next(error);
    }
  });

  // --- POST /api/operarios: crear operario ---------------------------------
  router.post('/operarios', requirePermission('operarios'), async (req, res, next) => {
    try {
      const creado = await service.create(req.body);
      await registrarAuditoria(auditRepository, {
        usuarioId: req.user.id,
        usuario: req.user.usuario,
        rol: req.user.rol,
        accion: 'CREAR',
        modulo: 'operarios',
        registroId: creado.id,
        detalle: creado
      });
      res.status(201).json(creado);
    } catch (error) {
      next(error);
    }
  });

  // --- DELETE /api/operarios/:id: anulación lógica -------------------------
  router.delete('/operarios/:id', requirePermission('operarios'), async (req, res, next) => {
    try {
      const motivo = String(req.body?.motivo || '').trim();
      const anulado = await service.remove(req.params.id, motivo, req.user.usuario);
      await registrarAuditoria(auditRepository, {
        usuarioId: req.user.id,
        usuario: req.user.usuario,
        rol: req.user.rol,
        accion: 'ANULAR',
        modulo: 'operarios',
        registroId: req.params.id,
        detalle: { antes: anulado, motivo }
      });
      res.json({ mensaje: 'Operario anulado. Los registros históricos no se modificaron.' });
    } catch (error) {
      next(error);
    }
  });

  return router;
}

module.exports = { crearRutasOperarios };
