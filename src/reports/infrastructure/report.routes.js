// ============================================================================
// report.routes.js (INFRAESTRUCTURA) — ENDPOINTS HTTP DE REPORTES
// ----------------------------------------------------------------------------
//   GET /api/reportes                      -> lista de meses con sus totales
//   GET /api/reportes-general/registros    -> reporte de un rango de fechas
//   GET /api/reportes/:anio/:mes/registros -> reporte de un mes concreto
// Los dos últimos devuelven { suministros, jornadas, conciliacion }: las lecturas
// del surtidor (jornadas) y los suministros a máquinas viajan por separado.
// Todas exigen el permiso 'reportes'.
// ============================================================================

const express = require('express');
const { requirePermission } = require('../../shared/infrastructure/security');
const { hoyLocal, esFechaValida } = require('../../shared/application/fechas');

const bad = (mensaje) => Object.assign(new Error(mensaje), { status: 400 });

function crearRutasReportes(service) {
  const router = express.Router();

  // --- GET /api/reportes: meses con totales (se calculan al consultarlos) ---
  router.get('/reportes', requirePermission('reportes'), async (req, res, next) => {
    try {
      res.json(await service.list());
    } catch (error) {
      next(error);
    }
  });

  // --- GET /api/reportes-general/registros --------------------------------
  // Consulta libre por rango de fechas y texto. Sin parámetros, el año actual.
  router.get(
    '/reportes-general/registros',
    requirePermission('reportes'),
    async (req, res, next) => {
      try {
        const anioActual = hoyLocal().slice(0, 4);
        const inicio = String(req.query.fechaInicio || `${anioActual}-01-01`).slice(0, 10);
        const fin = String(req.query.fechaFin || `${anioActual}-12-31`).slice(0, 10);
        if (!esFechaValida(inicio) || !esFechaValida(fin))
          throw bad('El rango de fechas no es válido.');
        res.json(await service.detalle(inicio, fin, String(req.query.busqueda || '').trim()));
      } catch (error) {
        next(error);
      }
    }
  );

  // --- GET /api/reportes/:anio/:mes/registros -----------------------------
  router.get(
    '/reportes/:anio/:mes/registros',
    requirePermission('reportes'),
    async (req, res, next) => {
      try {
        const anio = Number(req.params.anio);
        const mes = Number(req.params.mes);
        if (
          !Number.isInteger(anio) ||
          anio < 2000 ||
          anio > 2100 ||
          !Number.isInteger(mes) ||
          mes < 1 ||
          mes > 12
        )
          throw bad('El año o el mes no son válidos.');
        res.json(await service.detalleMensual(anio, mes));
      } catch (error) {
        next(error);
      }
    }
  );

  return router;
}

module.exports = { crearRutasReportes };
