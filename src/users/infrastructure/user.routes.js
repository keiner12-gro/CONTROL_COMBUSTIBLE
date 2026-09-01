const express = require('express');
const { VISTAS_DISPONIBLES } = require('../../shared/application/permisos');
const {
  crearSesion,
  destruirSesion,
  requirePermission,
  limitarIntentosLogin,
  registrarIntentoLoginFallido,
  limpiarIntentosLogin
} = require('../../shared/infrastructure/security');
const { registrarAuditoria } = require('../../shared/infrastructure/audit');

function crearRutasUsuarios(service, db) {
  const router = express.Router();

  router.post('/login', limitarIntentosLogin, async (req, res, next) => {
    try {
      const resultadoLogin = await service.login(req.body.usuario, req.body.contrasena);
      if (!resultadoLogin) {
        registrarIntentoLoginFallido(req);
        return res.status(401).json({ mensaje: 'Usuario o contraseña incorrectos.' });
      }
      limpiarIntentosLogin(req);
      const permisos =
        (await service.repository?.getPermissions?.(resultadoLogin.id, resultadoLogin.rol)) ||
        resultadoLogin.permisos ||
        [];
      await crearSesion(db, resultadoLogin.id, req, res);
      await registrarAuditoria(db, {
        usuarioId: resultadoLogin.id,
        usuario: resultadoLogin.usuario,
        rol: resultadoLogin.rol,
        accion: 'LOGIN',
        modulo: 'usuarios',
        detalle: { resultado: 'ok' }
      });
      res.json({ ...resultadoLogin, permisos });
    } catch (error) {
      next(error);
    }
  });

  router.post('/logout', async (req, res, next) => {
    try {
      await destruirSesion(db, req, res);
      if (req.user)
        await registrarAuditoria(db, {
          usuarioId: req.user.id,
          usuario: req.user.usuario,
          rol: req.user.rol,
          accion: 'LOGOUT',
          modulo: 'usuarios'
        });
      res.json({ mensaje: 'Sesión cerrada.' });
    } catch (error) {
      next(error);
    }
  });

  router.get('/sesion', async (req, res) => {
    res.json({ ...req.user, debeCambiarContrasena: Boolean(req.user.debe_cambiar_contrasena) });
  });

  router.post('/cambiar-contrasena', async (req, res, next) => {
    try {
      await service.changePassword(
        req.user.id,
        req.body.contrasenaActual,
        req.body.nuevaContrasena
      );
      await registrarAuditoria(db, {
        usuarioId: req.user.id,
        usuario: req.user.usuario,
        rol: req.user.rol,
        accion: 'CAMBIAR_CONTRASENA',
        modulo: 'usuarios',
        registroId: req.user.id
      });
      res.json({ mensaje: 'Contraseña actualizada correctamente.' });
    } catch (error) {
      next(error);
    }
  });

  // Solo el super administrador puede ver, crear, editar o eliminar cuentas de
  // OTRO super administrador. Un administrador con el permiso "usuarios" puede
  // gestionar el resto de cuentas, pero nunca escalar privilegios ni tocar la
  // cuenta de un super administrador.
  const esSuperAdmin = (req) => req.user.rol === 'super_administrador';

  router.get('/usuarios', requirePermission('usuarios'), async (req, res, next) => {
    try {
      const usuarios = await service.list();
      res.json(
        esSuperAdmin(req) ? usuarios : usuarios.filter((u) => u.rol !== 'super_administrador')
      );
    } catch (error) {
      next(error);
    }
  });

  router.post('/usuarios', requirePermission('usuarios'), async (req, res, next) => {
    try {
      if (req.body.rol === 'super_administrador' && !esSuperAdmin(req))
        return res
          .status(403)
          .json({ mensaje: 'Solo el super administrador puede crear otro super administrador.' });
      const id = await service.create(req.body);
      await registrarAuditoria(db, {
        usuarioId: req.user.id,
        usuario: req.user.usuario,
        rol: req.user.rol,
        accion: 'CREAR',
        modulo: 'usuarios',
        registroId: id,
        detalle: { usuario: req.body.usuario, rol: req.body.rol }
      });
      res.status(201).json({ mensaje: 'Usuario creado.', id });
    } catch (error) {
      next(error);
    }
  });

  router.put('/usuarios/:id', requirePermission('usuarios'), async (req, res, next) => {
    try {
      const antes = await service.findById(req.params.id);
      if (!esSuperAdmin(req)) {
        if (req.body.rol === 'super_administrador')
          return res
            .status(403)
            .json({ mensaje: 'Solo el super administrador puede asignar ese rol.' });
        if (antes?.rol === 'super_administrador')
          return res
            .status(403)
            .json({ mensaje: 'No tienes permiso para modificar un super administrador.' });
      }
      await service.update(req.params.id, req.body);
      await registrarAuditoria(db, {
        usuarioId: req.user.id,
        usuario: req.user.usuario,
        rol: req.user.rol,
        accion: antes && antes.rol !== req.body.rol ? 'CAMBIAR_ROL' : 'EDITAR',
        modulo: 'usuarios',
        registroId: req.params.id,
        detalle: {
          antes: antes ? { rol: antes.rol } : null,
          despues: { rol: req.body.rol, permisos: req.body.permisos }
        }
      });
      res.json({ mensaje: 'Usuario actualizado.' });
    } catch (error) {
      next(error);
    }
  });

  router.delete('/usuarios/:id', requirePermission('usuarios'), async (req, res, next) => {
    try {
      if (String(req.user.id) === String(req.params.id))
        return res.status(400).json({ mensaje: 'No puedes eliminar tu propio usuario.' });
      if (!esSuperAdmin(req)) {
        const objetivo = await service.findById(req.params.id);
        if (objetivo?.rol === 'super_administrador')
          return res
            .status(403)
            .json({ mensaje: 'No tienes permiso para eliminar un super administrador.' });
      }
      await service.remove(req.params.id);
      await registrarAuditoria(db, {
        usuarioId: req.user.id,
        usuario: req.user.usuario,
        rol: req.user.rol,
        accion: 'ELIMINAR',
        modulo: 'usuarios',
        registroId: req.params.id
      });
      res.json({ mensaje: 'Usuario eliminado.' });
    } catch (error) {
      next(error);
    }
  });

  return router;
}

module.exports = { crearRutasUsuarios };
