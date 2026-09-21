// ============================================================================
// tareas.routes.js (INFRAESTRUCTURA) — TAREAS PROGRAMADAS (CRON)
// ----------------------------------------------------------------------------
//   GET|POST /api/tareas/recordatorio-cierre
// Revisa las jornadas que siguen abiertas: crea la alerta "cierre pendiente"
// para supervisores y envía la notificación push a quienes deben cerrar.
// NO usa sesión de usuario: lo llama un programador externo (Vercel Cron,
// Cloudflare Workers Cron o pg_cron de Supabase) con la cabecera
//     Authorization: Bearer <CRON_SECRET>
// CRON_SECRET es una variable de entorno larga y secreta (ver .env.example).
// Las horas de ejecución se definen en vercel.json ("crons").
// ============================================================================

const express = require('express');
const crypto = require('crypto');

// Compara el secreto en tiempo constante (evita ataques de temporización).
function secretoValido(recibido) {
  const esperado = process.env.CRON_SECRET || '';
  if (!esperado || esperado.length < 16) return false; // Sin secreto seguro, la tarea queda apagada
  const a = crypto.createHash('sha256').update(String(recibido)).digest();
  const b = crypto.createHash('sha256').update(esperado).digest();
  return crypto.timingSafeEqual(a, b);
}

function crearRutasTareas(jornadaService) {
  const router = express.Router();

  async function ejecutar(req, res, next) {
    try {
      const cabecera = String(req.headers.authorization || '');
      const token = cabecera.startsWith('Bearer ') ? cabecera.slice(7) : '';
      if (!secretoValido(token)) return res.status(401).json({ mensaje: 'No autorizado.' });
      res.json(await jornadaService.ejecutarRecordatorios());
    } catch (error) {
      next(error);
    }
  }

  router.get('/tareas/recordatorio-cierre', ejecutar); // Vercel Cron llama con GET
  router.post('/tareas/recordatorio-cierre', ejecutar);
  return router;
}

module.exports = { crearRutasTareas, secretoValido };
