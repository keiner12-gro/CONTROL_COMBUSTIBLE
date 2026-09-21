// ============================================================================
// jornada.routes.js (INFRAESTRUCTURA) — ENDPOINTS HTTP DE LA JORNADA DIARIA
// ----------------------------------------------------------------------------
//   GET  /api/cierre-dia/estado?fecha=  -> estado de la jornada (borrador/cierre)
//   PUT  /api/jornadas/:fecha           -> autoguardado de lo que lleva escrito
//   POST /api/cierre-dia                -> cierre definitivo (uno por día)
//   GET  /api/jornadas/pendientes       -> jornadas que faltan por cerrar
// Todas exigen el permiso 'registro'.
// ============================================================================

const express = require('express');
const { requirePermission } = require('../../shared/infrastructure/security');
const { registrarAuditoria } = require('../../shared/infrastructure/audit');
const { motivoDeRechazoPorFecha } = require('../../shared/application/retroactivo');
const { convertirJornadaParaFrontend } = require('../domain/jornada.mapper');

function crearRutasJornadas(service, db) {
  const router = express.Router();

  // ¿Puede este usuario tocar la jornada de esa fecha? (regla de fechas pasadas;
  // completar una jornada que ya está abierta siempre se permite).
  async function rechazoPorFecha(req, fecha) {
    const existente = await service.repository.findByFecha(fecha);
    return motivoDeRechazoPorFecha(req.user, fecha, {
      jornadaAbierta: existente?.estado === 'abierta'
    });
  }

  // --- GET /api/cierre-dia/estado?fecha=YYYY-MM-DD -------------------------
  // El formulario lo llama al cargar: trae lo que ya está guardado del día
  // (borrador o cierre) y con qué lecturas debe abrir.
  router.get('/cierre-dia/estado', requirePermission('registro'), async (req, res, next) => {
    try {
      res.json(await service.getDailyMeterState(String(req.query.fecha || '').slice(0, 10)));
    } catch (error) {
      next(error);
    }
  });

  // --- PUT /api/jornadas/:fecha: autoguardado del borrador ------------------
  // Se llama mientras el operario escribe. No se audita cada guardado (serían
  // cientos); sí se audita el cierre definitivo.
  router.put('/jornadas/:fecha', requirePermission('registro'), async (req, res, next) => {
    try {
      const fecha = String(req.params.fecha || '').slice(0, 10);
      const rechazo = await rechazoPorFecha(req, fecha);
      if (rechazo) return res.status(403).json({ mensaje: rechazo });
      const jornada = await service.guardarBorrador(fecha, req.body, req.user.usuario);
      res.json({ jornada: convertirJornadaParaFrontend(jornada), guardadoEn: new Date() });
    } catch (error) {
      next(error);
    }
  });

  // --- POST /api/cierre-dia: cerrar la jornada -----------------------------
  router.post('/cierre-dia', requirePermission('registro'), async (req, res, next) => {
    try {
      const fecha = String(req.body.fecha || '').slice(0, 10);
      const rechazo = await rechazoPorFecha(req, fecha);
      if (rechazo) return res.status(403).json({ mensaje: rechazo });
      const cierre = await service.cerrar(req.body, req.user.usuario, req.user.rol);
      await registrarAuditoria(db, {
        usuarioId: req.user.id,
        usuario: req.user.usuario,
        rol: req.user.rol,
        accion: 'CIERRE_DIA',
        modulo: 'surtidor',
        registroId: cierre.id,
        detalle: {
          fecha,
          m1Final: cierre.m1Final,
          m2Final: cierre.m2Final,
          totalGalones: cierre.totalGalones
        }
      });
      res.status(201).json(cierre);
    } catch (error) {
      next(error);
    }
  });

  // --- GET /api/jornadas/pendientes ---------------------------------------
  // Jornadas abiertas que ya deberían estar cerradas (de días anteriores, o de
  // hoy pasada la hora límite). El frontend las muestra como aviso fijo.
  router.get('/jornadas/pendientes', requirePermission('registro'), async (req, res, next) => {
    try {
      res.json(await service.pendientes());
    } catch (error) {
      next(error);
    }
  });

  return router;
}

module.exports = { crearRutasJornadas };
