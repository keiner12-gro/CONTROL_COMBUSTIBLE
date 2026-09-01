const express = require('express');
const { requirePermission } = require('../../shared/infrastructure/security');
const { convertirRegistroParaFrontend } = require('../../records/domain/record.mapper');

function rangoDelMes(anio, mes) {
  const ultimoDia = new Date(anio, mes, 0).getDate();
  return {
    inicio: `${anio}-${String(mes).padStart(2, '0')}-01`,
    fin: `${anio}-${String(mes).padStart(2, '0')}-${String(ultimoDia).padStart(2, '0')}`
  };
}

function crearRutasReportes(service) {
  const router = express.Router();

  router.get('/reportes', requirePermission('reportes'), async (req, res, next) => {
    try {
      res.json(await service.list());
    } catch (error) {
      next(error);
    }
  });

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
        res.json(registros.map(convertirRegistroParaFrontend));
      } catch (error) {
        next(error);
      }
    }
  );

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
