const express = require('express');
const { registrarAuditoria } = require('../../shared/infrastructure/audit');

function parseDetalle(detalle) {
  if (!detalle) return {};
  if (typeof detalle === 'string') {
    try {
      return JSON.parse(detalle);
    } catch (_) {
      return { valor: detalle };
    }
  }
  if (typeof detalle === 'object') return detalle;
  return { valor: detalle };
}

function normalizarFecha(valor) {
  return String(valor || '').slice(0, 10);
}

function getAuditoriaAccess(req, res, next) {
  if (!req.user) return res.status(401).json({ mensaje: 'Sesión no válida.' });
  const rol = String(req.user.rol || '').toLowerCase();
  if (rol === 'operario') {
    return res.status(403).json({ mensaje: 'No tienes permiso para acceder a la auditoría.' });
  }
  if (['super_administrador', 'administrador', 'supervisor'].includes(rol)) return next();
  return res.status(403).json({ mensaje: 'No tienes permisos suficientes para esta operación.' });
}

function getAuditoriaWriteAccess(req, res, next) {
  if (!req.user) return res.status(401).json({ mensaje: 'Sesión no válida.' });
  if (req.user.rol !== 'super_administrador') {
    return res.status(403).json({ mensaje: 'Solo el super administrador puede modificar o eliminar auditoría.' });
  }
  return next();
}

function buildFiltros(req) {
  const { fechaDesde, fechaHasta, usuario, accion, modulo, q } = req.query;
  const condiciones = [];
  const parametros = [];

  if (fechaDesde) {
    condiciones.push('DATE(a.creado_en) >= ?');
    parametros.push(normalizarFecha(fechaDesde));
  }

  if (fechaHasta) {
    condiciones.push('DATE(a.creado_en) <= ?');
    parametros.push(normalizarFecha(fechaHasta));
  }

  if (usuario) {
    condiciones.push('LOWER(a.usuario) LIKE ?');
    parametros.push(`%${String(usuario).trim().toLowerCase()}%`);
  }

  if (accion) {
    condiciones.push('LOWER(a.accion) = ?');
    parametros.push(String(accion).trim().toLowerCase());
  }

  if (modulo) {
    condiciones.push('LOWER(a.modulo) = ?');
    parametros.push(String(modulo).trim().toLowerCase());
  }

  if (q) {
    const texto = `%${String(q).trim().toLowerCase()}%`;
    condiciones.push(
      '(LOWER(a.usuario) LIKE ? OR LOWER(a.accion) LIKE ? OR LOWER(a.modulo) LIKE ? OR LOWER(CAST(a.detalle AS CHAR)) LIKE ? OR LOWER(CAST(a.registro_id AS CHAR)) LIKE ?)'
    );
    parametros.push(texto, texto, texto, texto, texto);
  }

  return { condiciones, parametros };
}

function crearRutasAuditoria(db) {
  const router = express.Router();

  router.get('/auditoria', getAuditoriaAccess, async (req, res, next) => {
    try {
      const { page = '1', limit = '20' } = req.query;
      const pagina = Math.max(1, Number(page) || 1);
      const limite = Math.min(100, Math.max(1, Number(limit) || 20));
      const offset = (pagina - 1) * limite;
      const filtros = buildFiltros(req);

      const baseSql = 'FROM auditoria_combustible a WHERE 1=1';
      const whereSql = filtros.condiciones.length ? ` AND ${filtros.condiciones.join(' AND ')}` : '';

      const [totalRows] = await db.query(
        `SELECT COUNT(*) AS total ${baseSql}${whereSql}`,
        filtros.parametros
      );
      const total = Number(totalRows[0]?.total || 0);

      const [registros] = await db.query(
        `SELECT a.id, a.usuario_id, a.usuario, a.rol, a.accion, a.modulo, a.registro_id, a.detalle, a.creado_en ${baseSql}${whereSql} ORDER BY a.creado_en DESC LIMIT ? OFFSET ?`,
        [...filtros.parametros, limite, offset]
      );

      const [resumenRows] = await db.query(
        `SELECT COUNT(*) AS total_eventos, COUNT(DISTINCT a.usuario) AS usuarios_unicos, COUNT(DISTINCT a.accion) AS acciones_unicas, COUNT(DISTINCT a.modulo) AS modulos_unicos ${baseSql}${whereSql}`,
        filtros.parametros
      );

      const resumen = resumenRows[0] || {
        total_eventos: 0,
        usuarios_unicos: 0,
        acciones_unicas: 0,
        modulos_unicos: 0
      };

      res.json({
        page: pagina,
        limit: limite,
        total,
        totalPages: Math.max(1, Math.ceil(total / limite)),
        resumen,
        registros: registros.map((registro) => ({
          ...registro,
          detalle: parseDetalle(registro.detalle),
          fecha: registro.creado_en,
          fechaFormateada: new Date(registro.creado_en).toLocaleString('es-CO', {
            dateStyle: 'short',
            timeStyle: 'short'
          })
        }))
      });
    } catch (error) {
      next(error);
    }
  });

  router.get('/auditoria/:id', getAuditoriaAccess, async (req, res, next) => {
    try {
      const [rows] = await db.query(
        'SELECT id,usuario_id,usuario,rol,accion,modulo,registro_id,detalle,creado_en FROM auditoria_combustible WHERE id=? LIMIT 1',
        [req.params.id]
      );
      if (!rows.length) return res.status(404).json({ mensaje: 'Registro de auditoría no encontrado.' });
      const fila = rows[0];
      res.json({
        ...fila,
        detalle: parseDetalle(fila.detalle),
        fecha: fila.creado_en,
        fechaFormateada: new Date(fila.creado_en).toLocaleString('es-CO', {
          dateStyle: 'short',
          timeStyle: 'short'
        })
      });
    } catch (error) {
      next(error);
    }
  });

  router.put('/auditoria/:id', getAuditoriaWriteAccess, async (req, res, next) => {
    try {
      const [actuales] = await db.query(
        'SELECT id,usuario,rol,accion,modulo,registro_id,detalle,creado_en FROM auditoria_combustible WHERE id=? LIMIT 1',
        [req.params.id]
      );
      if (!actuales.length) return res.status(404).json({ mensaje: 'Registro de auditoría no encontrado.' });

      const detalleActual = parseDetalle(actuales[0].detalle);
      const detalleNuevo = {
        ...detalleActual,
        ...(req.body?.detalle && typeof req.body.detalle === 'object' ? req.body.detalle : {}),
        motivo: req.body?.motivo || detalleActual.motivo || 'Edición manual por super administrador.'
      };

      await db.query('UPDATE auditoria_combustible SET detalle=? WHERE id=?', [
        JSON.stringify(detalleNuevo),
        req.params.id
      ]);

      await registrarAuditoria(db, {
        usuarioId: req.user.id,
        usuario: req.user.usuario,
        rol: req.user.rol,
        accion: 'EDITAR_AUDITORIA',
        modulo: 'auditoria',
        registroId: req.params.id,
        detalle: {
          motivo: req.body?.motivo || 'Edición manual.',
          antes: detalleActual,
          despues: detalleNuevo,
          registroOriginal: actuales[0].id
        }
      });

      res.json({ mensaje: 'Registro de auditoría actualizado.' });
    } catch (error) {
      next(error);
    }
  });

  router.delete('/auditoria/:id', getAuditoriaWriteAccess, async (req, res, next) => {
    try {
      const [actuales] = await db.query(
        'SELECT id,usuario,rol,accion,modulo,registro_id,detalle,creado_en FROM auditoria_combustible WHERE id=? LIMIT 1',
        [req.params.id]
      );
      if (!actuales.length) return res.status(404).json({ mensaje: 'Registro de auditoría no encontrado.' });

      await db.query('DELETE FROM auditoria_combustible WHERE id=?', [req.params.id]);

      await registrarAuditoria(db, {
        usuarioId: req.user.id,
        usuario: req.user.usuario,
        rol: req.user.rol,
        accion: 'ELIMINAR_AUDITORIA',
        modulo: 'auditoria',
        registroId: req.params.id,
        detalle: {
          motivo: req.body?.motivo || 'Eliminación manual por super administrador.',
          eliminado: parseDetalle(actuales[0].detalle)
        }
      });

      res.json({ mensaje: 'Registro de auditoría eliminado.' });
    } catch (error) {
      next(error);
    }
  });

  router.get('/auditoria/export', getAuditoriaAccess, async (req, res, next) => {
    try {
      const filtros = buildFiltros(req);
      const sql = `SELECT a.id, a.usuario, a.rol, a.accion, a.modulo, a.registro_id, a.detalle, a.creado_en FROM auditoria_combustible a WHERE 1=1 ${filtros.condiciones.length ? `AND ${filtros.condiciones.join(' AND ')}` : ''} ORDER BY a.creado_en DESC`;
      const [rows] = await db.query(sql, filtros.parametros);
      const csv = [
        ['id', 'usuario', 'rol', 'accion', 'modulo', 'registro_id', 'fecha', 'detalle']
      ];

      rows.forEach((fila) => {
        csv.push([
          fila.id,
          fila.usuario || '',
          fila.rol || '',
          fila.accion || '',
          fila.modulo || '',
          fila.registro_id || '',
          fila.creado_en || '',
          JSON.stringify(parseDetalle(fila.detalle))
        ]);
      });

      const contenido = csv
        .map((fila) => fila.map((valor) => `"${String(valor ?? '').replace(/"/g, '""')}"`).join(','))
        .join('\n');

      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="auditoria_combustible.csv"');
      res.send(contenido);
    } catch (error) {
      next(error);
    }
  });

  return router;
}

module.exports = { crearRutasAuditoria };
