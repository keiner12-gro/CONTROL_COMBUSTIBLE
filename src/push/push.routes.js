// ============================================================================
// push.routes.js (INFRAESTRUCTURA) — ENDPOINTS DE NOTIFICACIONES PUSH
// ----------------------------------------------------------------------------
//   GET  /api/push/clave       -> clave pública VAPID (el navegador la necesita)
//   POST /api/push/suscribir   -> registra el dispositivo del usuario conectado
//   POST /api/push/desuscribir -> quita ese dispositivo
//   POST /api/push/probar      -> envía una notificación de prueba a mi usuario
// Basta con estar conectado (cualquier rol): cada quien activa sus avisos.
// ============================================================================

const express = require('express');

function crearRutasPush(service) {
  const router = express.Router();

  router.get('/push/clave', (req, res) => {
    res.json({ activo: service.activo(), clave: service.clavePublica() });
  });

  router.post('/push/suscribir', async (req, res, next) => {
    try {
      await service.suscribir(req.user.id, req.body?.suscripcion, req.headers['user-agent']);
      res.status(201).json({ mensaje: 'Notificaciones activadas en este dispositivo.' });
    } catch (error) {
      next(error);
    }
  });

  router.post('/push/desuscribir', async (req, res, next) => {
    try {
      await service.desuscribir(req.user.id, req.body?.endpoint);
      res.json({ mensaje: 'Notificaciones desactivadas en este dispositivo.' });
    } catch (error) {
      next(error);
    }
  });

  router.post('/push/probar', async (req, res, next) => {
    try {
      if (!service.activo())
        return res
          .status(503)
          .json({ mensaje: 'Las notificaciones no están configuradas en el servidor.' });
      const resultado = await service.notificar(
        { usuarioIds: [req.user.id] },
        {
          titulo: 'Notificaciones activas',
          cuerpo: 'Así te avisaremos cuando falte cerrar la jornada.',
          url: '/menu',
          etiqueta: 'prueba'
        }
      );
      res.json(resultado);
    } catch (error) {
      next(error);
    }
  });

  return router;
}

module.exports = { crearRutasPush };
