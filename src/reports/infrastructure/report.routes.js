// ============================================================================
// report.routes.js (INFRAESTRUCTURA) — ENDPOINTS HTTP DE REPORTES
// ----------------------------------------------------------------------------
//   GET /api/reportes                      -> lista de meses con sus totales
//   GET /api/reportes-general/registros    -> registros filtrados (reporte general)
//   GET /api/reportes/:anio/:mes/registros -> registros de un mes concreto
// Todas exigen el permiso 'reportes'.
// ============================================================================

const express = require('express');
const { requirePermission } = require('../../shared/infrastructure/security');
const { convertirRegistroParaFrontend } = require('../../records/domain/record.mapper');

// Devuelve el primer y último día de un mes en formato YYYY-MM-DD.
function rangoDelMes(anio, mes) {
  const ultimoDia = new Date(anio, mes, 0).getDate(); // Día 0 del mes siguiente
  return {
    inicio: `${anio}-${String(mes).padStart(2, '0')}-01`,
    fin: `${anio}-${String(mes).padStart(2, '0')}-${String(ultimoDia).padStart(2, '0')}`
  };
}

function crearRutasReportes(service) {
  const router = express.Router();

  // --- GET /api/reportes: meses con totales (se regeneran al consultarlos) --
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
        const anioActual = new Date().getFullYear();
        const registros = await service.listGeneral(
          req.query.fechaInicio || `${anioActual}-01-01`,
          req.query.fechaFin || `${anioActual}-12-31`,
          String(req.query.busqueda || '').trim()
        );
        res.json(registros.map(convertirRegistroParaFrontend)); // Traducción a camelCase
      } catch (error) {
        next(error);
      }
    }
  );

  // --- GET /api/reportes/:anio/:mes/registros -----------------------------
  // Detalle de un mes: lo usa la pantalla reporte-detalle para exportar.
  router.get(
    '/reportes/:anio/:mes/registros',
    requirePermission('reportes'),
    async (req, res, next) => {
      try {
        const rango = rangoDelMes(Number(req.params.anio), Number(req.params.mes));
        const registros = await service.listGeneral(rango.inicio, rango.fin, '');
        res.json(registros.map(convertirRegistroParaFrontend));
      } catch (error) {
        next(error);
      }
    }
  );

  return router;
}

module.exports = { crearRutasReportes };
