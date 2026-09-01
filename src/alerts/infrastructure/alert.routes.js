const express = require('express');
const path = require('path');
const fs = require('fs');
const { requirePermission } = require('../../shared/infrastructure/security');
const { registrarAuditoria } = require('../../shared/infrastructure/audit');

const CARPETA_SOPORTES = path.join(__dirname, '../../../uploads');

function crearRutasAlertas(service, db) {
  const router = express.Router();

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

      const rutaRelativa = String(alerta.reporte_ruta).replace(/^\/?uploads\//, '');
      const rutaAbsoluta = path.join(CARPETA_SOPORTES, rutaRelativa);

      // Evita path traversal: la ruta resuelta debe quedar dentro de la carpeta de soportes.
      if (!rutaAbsoluta.startsWith(CARPETA_SOPORTES + path.sep))
        return res.status(400).json({ mensaje: 'Ruta de soporte inválida.' });
      if (!fs.existsSync(rutaAbsoluta))
        return res.status(404).json({ mensaje: 'El archivo de soporte ya no está disponible.' });

      const nombreDescarga = String(alerta.reporte_nombre || 'soporte').replace(/[^\w.\- ]/g, '_');
      res.setHeader('Content-Disposition', `inline; filename="${nombreDescarga}"`);
      res.sendFile(rutaAbsoluta);
    } catch (error) {
      next(error);
    }
  });

  router.get(
    '/alertas/reportes/:anio/:mes',
    requirePermission('alertas'),
    async (req, res, next) => {
      try {
        const anio = Number(req.params.anio);
        const mes = Number(req.params.mes);
        const ultimoDia = new Date(anio, mes, 0).getDate();
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

  router.get('/notificaciones', requirePermission('alertas'), async (req, res, next) => {
    try {
      res.json(await service.listNotifications(req.user.rol));
    } catch (error) {
      next(error);
    }
  });

  router.put('/notificaciones/:id/leida', requirePermission('alertas'), async (req, res, next) => {
    try {
      await service.markNotification(req.params.id, req.user.rol);
      res.json({ mensaje: 'Notificación marcada como leída.' });
    } catch (error) {
      next(error);
    }
  });

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
