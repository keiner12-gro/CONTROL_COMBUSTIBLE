// ============================================================================
// alert.routes.js (INFRAESTRUCTURA) — ENDPOINTS HTTP DE ALERTAS
// ----------------------------------------------------------------------------
//   GET /api/alertas                    -> todas las alertas
//   GET /api/alertas/:id/soporte        -> descarga protegida del adjunto (vía storage)
//   GET /api/alertas/reportes/:anio/:mes-> alertas de un mes
//   GET /api/notificaciones             -> avisos de la campanita por rol
//   PUT /api/notificaciones/:id/leida   -> marcar aviso como leído
//   PUT /api/alertas/:id                -> justificar una alerta
// Todas exigen el permiso 'alertas'.
// ============================================================================

const express = require('express');
const { requirePermission } = require('../../shared/infrastructure/security');
const { registrarAuditoria } = require('../../shared/infrastructure/audit');

function crearRutasAlertas(service, db, storage) {
  const router = express.Router();

  // --- GET /api/alertas: listado completo ---------------------------------
  router.get('/alertas', requirePermission('alertas'), async (req, res, next) => {
    try {
      res.json(await service.list());
    } catch (error) {
      next(error);
    }
  });

  // El soporte adjunto (PDF/imagen) ya no se sirve como archivo estático publico:
  // solo se entrega aqui, despues de validar sesion y permiso sobre alertas.
  router.get('/alertas/:id/soporte', requirePermission('alertas'), async (req, res, next) => {
    try {
      const alerta = await service.findById(req.params.id);
      if (!alerta || !alerta.reporte_ruta)
        return res.status(404).json({ mensaje: 'Esta alerta no tiene un soporte adjunto.' });

      // La ruta guardada es "db:<id>" (o una ruta vieja /uploads/...); la capa
      // de storage sabe leer ambos formatos.
      const archivo = await storage.leer(alerta.reporte_ruta);
      if (!archivo)
        return res.status(404).json({ mensaje: 'El archivo de soporte ya no está disponible.' });

      // Se limpia el nombre para que no rompa la cabecera HTTP.
      const nombreDescarga = String(alerta.reporte_nombre || 'soporte').replace(/[^\w.\- ]/g, '_');
      res.setHeader('Content-Disposition', `inline; filename="${nombreDescarga}"`); // inline = se abre en el navegador
      res.setHeader('Content-Type', alerta.reporte_tipo || 'application/octet-stream');
      res.send(archivo.buffer);
    } catch (error) {
      next(error);
    }
  });

  // --- GET /api/alertas/reportes/:anio/:mes -------------------------------
  // Alertas del mes indicado; se usan al armar el reporte mensual.
  router.get(
    '/alertas/reportes/:anio/:mes',
    requirePermission('alertas'),
    async (req, res, next) => {
      try {
        const anio = Number(req.params.anio);
        const mes = Number(req.params.mes);
        const ultimoDia = new Date(anio, mes, 0).getDate(); // Último día del mes
        res.json(
          await service.listByDateRange(
            `${anio}-${String(mes).padStart(2, '0')}-01`,
            `${anio}-${String(mes).padStart(2, '0')}-${String(ultimoDia).padStart(2, '0')}`
          )
        );
      } catch (error) {
        next(error);
      }
    }
  );

  // --- GET /api/notificaciones: avisos del rol del usuario conectado ------
  router.get('/notificaciones', requirePermission('alertas'), async (req, res, next) => {
    try {
      res.json(await service.listNotifications(req.user.rol));
    } catch (error) {
      next(error);
    }
  });

  // --- PUT /api/notificaciones/:id/leida ----------------------------------
  router.put('/notificaciones/:id/leida', requirePermission('alertas'), async (req, res, next) => {
    try {
      await service.markNotification(req.params.id, req.user.rol);
      res.json({ mensaje: 'Notificación marcada como leída.' });
    } catch (error) {
      next(error);
    }
  });

  // --- PUT /api/alertas/:id: justificar una alerta ------------------------
  // El usuario y el rol se toman de la sesión (no del cuerpo) para que quede
  // registrado quién justificó realmente.
  router.put('/alertas/:id', requirePermission('alertas'), async (req, res, next) => {
    try {
      const alertaActualizada = await service.update(req.params.id, {
        ...req.body,
        rol: req.user.rol,
        usuario: req.user.usuario
      });
      await registrarAuditoria(db, {
        usuarioId: req.user.id,
        usuario: req.user.usuario,
        rol: req.user.rol,
        accion: 'JUSTIFICAR',
        modulo: 'alertas',
        registroId: req.params.id,
        detalle: { justificacion: req.body.justificacion }
      });
      res.json(alertaActualizada);
    } catch (error) {
      next(error);
    }
  });

  return router;
}

module.exports = { crearRutasAlertas };
