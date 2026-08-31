const express = require('express');
const { VISTAS_DISPONIBLES } = require('../../shared/application/permisos');
const { crearSesion, destruirSesion, requireSuperAdmin, limitarIntentosLogin, registrarIntentoLoginFallido, limpiarIntentosLogin } = require('../../shared/infrastructure/security');
const { registrarAuditoria } = require('../../shared/infrastructure/audit');

function crearRutasUsuarios(service, db) {
  const r = express.Router();

  r.post('/login', limitarIntentosLogin, async (req, res, next) => {
    try {
      const x = await service.login(req.body.usuario, req.body.contrasena);
      if (!x) {
        registrarIntentoLoginFallido(req);
        return res.status(401).json({ mensaje: 'Usuario o contraseña incorrectos.' });
      }
      limpiarIntentosLogin(req);
      const permisos = await service.repository?.getPermissions?.(x.id, x.rol) || x.permisos || [];
      await crearSesion(db, x.id, req, res);
      await registrarAuditoria(db, { usuarioId: x.id, usuario: x.usuario, rol: x.rol, accion: 'LOGIN', modulo: 'usuarios', detalle: { resultado: 'ok' } });
      res.json({ ...x, permisos });
    } catch (e) { next(e); }
  });

  r.post('/logout', async (req, res, next) => {
    try {
      await destruirSesion(db, req, res);
      if (req.user) await registrarAuditoria(db, { usuarioId: req.user.id, usuario: req.user.usuario, rol: req.user.rol, accion: 'LOGOUT', modulo: 'usuarios' });
      res.json({ mensaje: 'Sesión cerrada.' });
    } catch (e) { next(e); }
  });

  r.get('/sesion', async (req, res) => {
    res.json({ ...req.user, debeCambiarContrasena: Boolean(req.user.debe_cambiar_contrasena) });
  });

  r.post('/cambiar-contrasena', async (req, res, next) => {
    try {
      await service.changePassword(req.user.id, req.body.contrasenaActual, req.body.nuevaContrasena);
      await registrarAuditoria(db, { usuarioId: req.user.id, usuario: req.user.usuario, rol: req.user.rol, accion: 'CAMBIAR_CONTRASENA', modulo: 'usuarios', registroId: req.user.id });
      res.json({ mensaje: 'Contraseña actualizada correctamente.' });
    } catch (e) { next(e); }
  });

  r.get('/usuarios', requireSuperAdmin, async (req, res, next) => {
    try { res.json(await service.list()); } catch (e) { next(e); }
  });

  r.post('/usuarios', requireSuperAdmin, async (req, res, next) => {
    try {
      if (!VISTAS_DISPONIBLES.includes(req.body?.permisos?.[0]) && Array.isArray(req.body?.permisos)) {
        // Los permisos inválidos simplemente se filtran en el servicio/repositorio.
      }
      const id = await service.create(req.body);
      await registrarAuditoria(db, { usuarioId: req.user.id, usuario: req.user.usuario, rol: req.user.rol, accion: 'CREAR', modulo: 'usuarios', registroId: id, detalle: { usuario: req.body.usuario, rol: req.body.rol } });
      res.status(201).json({ mensaje: 'Usuario creado.', id });
    } catch (e) { next(e); }
  });

  r.put('/usuarios/:id', requireSuperAdmin, async (req, res, next) => {
    try {
      await service.update(req.params.id, req.body);
      await registrarAuditoria(db, { usuarioId: req.user.id, usuario: req.user.usuario, rol: req.user.rol, accion: 'EDITAR', modulo: 'usuarios', registroId: req.params.id, detalle: { rol: req.body.rol, permisos: req.body.permisos } });
      res.json({ mensaje: 'Usuario actualizado.' });
    } catch (e) { next(e); }
  });

  r.delete('/usuarios/:id', requireSuperAdmin, async (req, res, next) => {
    try {
      if (String(req.user.id) === String(req.params.id)) return res.status(400).json({ mensaje: 'No puedes eliminar tu propio usuario.' });
      await service.remove(req.params.id);
      await registrarAuditoria(db, { usuarioId: req.user.id, usuario: req.user.usuario, rol: req.user.rol, accion: 'ELIMINAR', modulo: 'usuarios', registroId: req.params.id });
      res.json({ mensaje: 'Usuario eliminado.' });
    } catch (e) { next(e); }
  });

  return r;
}
module.exports = { crearRutasUsuarios };
