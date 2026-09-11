// ============================================================================
// user.routes.js (INFRAESTRUCTURA) — ENDPOINTS HTTP DE USUARIOS Y SESIÓN
// ----------------------------------------------------------------------------
// Rutas que expone este archivo (todas bajo el prefijo /api):
//   POST /login               -> iniciar sesión
//   POST /logout              -> cerrar sesión
//   GET  /sesion              -> datos del usuario conectado
//   POST /cambiar-contrasena  -> cambio de contraseña propio
//   GET/POST/PUT/DELETE /usuarios -> administración de cuentas
// ============================================================================

const express = require('express');
const { VISTAS_DISPONIBLES } = require('../../shared/application/permisos');
const {
  crearSesion, // Crea la cookie de sesión
  destruirSesion, // Borra la sesión
  requirePermission, // Middleware de permiso por vista
  limitarIntentosLogin, // Anti fuerza bruta
  registrarIntentoLoginFallido,
  limpiarIntentosLogin
} = require('../../shared/infrastructure/security');
const { registrarAuditoria } = require('../../shared/infrastructure/audit');

function crearRutasUsuarios(service, db) {
  const router = express.Router(); // Router aislado que se monta en server.js

  // --- POST /api/login: única ruta pública de la API -----------------------
  router.post('/login', limitarIntentosLogin, async (req, res, next) => {
    try {
      const resultadoLogin = await service.login(req.body.usuario, req.body.contrasena);
      if (!resultadoLogin) {
        registrarIntentoLoginFallido(req); // Suma un intento al contador anti fuerza bruta
        // Mensaje genérico a propósito: no revela si falló el usuario o la clave.
        return res.status(401).json({ mensaje: 'Usuario o contraseña incorrectos.' });
      }
      limpiarIntentosLogin(req); // Login correcto: se reinicia el contador
      // Permisos del usuario (con respaldo por si el repositorio no los trajo).
      const permisos =
        (await service.repository?.getPermissions?.(resultadoLogin.id, resultadoLogin.rol)) ||
        resultadoLogin.permisos ||
        [];
      await crearSesion(db, resultadoLogin.id, req, res); // Envía la cookie cc_session
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

  // --- POST /api/logout: cierra la sesión y limpia la cookie ---------------
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

  // --- GET /api/sesion: el frontend lo usa para saber quién está conectado,
  // qué rol tiene y qué menús mostrar (ver public/js/auth.js).
  router.get('/sesion', async (req, res) => {
    res.json({ ...req.user, debeCambiarContrasena: Boolean(req.user.debe_cambiar_contrasena) });
  });

  // --- POST /api/cambiar-contrasena: cambio de la contraseña propia --------
  router.post('/cambiar-contrasena', async (req, res, next) => {
    try {
      await service.changePassword(
        req.user.id, // Siempre el usuario de la sesión: no se puede cambiar la de otro
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

  // --- GET /api/usuarios: listado de cuentas -------------------------------
  router.get('/usuarios', requirePermission('usuarios'), async (req, res, next) => {
    try {
      const usuarios = await service.list();
      // Un admin normal ni siquiera ve en la lista a los super administradores.
      res.json(
        esSuperAdmin(req) ? usuarios : usuarios.filter((u) => u.rol !== 'super_administrador')
      );
    } catch (error) {
      next(error);
    }
  });

  // --- POST /api/usuarios: crear una cuenta --------------------------------
  router.post('/usuarios', requirePermission('usuarios'), async (req, res, next) => {
    try {
      // Bloqueo de escalada de privilegios.
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
      res.status(201).json({ mensaje: 'Usuario creado.', id }); // 201 = creado
    } catch (error) {
      next(error);
    }
  });

  // --- PUT /api/usuarios/:id: editar rol, permisos o contraseña ------------
  router.put('/usuarios/:id', requirePermission('usuarios'), async (req, res, next) => {
    try {
      const antes = await service.findById(req.params.id); // Estado previo (para la auditoría)
      if (!esSuperAdmin(req)) {
        // Un admin no puede ascender a nadie a super administrador...
        if (req.body.rol === 'super_administrador')
          return res
            .status(403)
            .json({ mensaje: 'Solo el super administrador puede asignar ese rol.' });
        // ...ni modificar la cuenta de un super administrador.
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
        // Se distingue el cambio de rol de una edición normal.
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

  // --- DELETE /api/usuarios/:id: eliminar una cuenta -----------------------
  router.delete('/usuarios/:id', requirePermission('usuarios'), async (req, res, next) => {
    try {
      // Nadie puede borrarse a sí mismo (evita quedarse sin administradores).
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
