// ============================================================================
// permisos.js — CATÁLOGO DE VISTAS Y VALIDACIÓN DE SUPER ADMIN
// ----------------------------------------------------------------------------
// VISTAS_DISPONIBLES es la lista maestra de módulos que se pueden asignar a un
// usuario en la pantalla de Usuarios. Si creas un módulo nuevo y quieres que se
// pueda dar/quitar permiso sobre él, AGRÉGALO A ESTE ARREGLO (y a la pantalla
// public/html/usuarios.html).
// ============================================================================

const VISTAS_DISPONIBLES = [
  'registro', // Formulario de carga diaria de combustible
  'tablas', // Consulta de registros
  'usuarios', // Administración de usuarios
  'tractores', // Administración de maquinaria
  'operarios', // Administración de operarios
  'reportes', // Cierres mensuales
  'alertas', // Bandeja de alertas
  'auditoria' // Bitácora del sistema
];

// Corta la petición con 403 si quien la hace no es super administrador.
// Devuelve true/false para poder usarla dentro de un handler:
//   if (!validarSuperAdministrador(req, res)) return;
function validarSuperAdministrador(solicitud, respuesta) {
  if (solicitud.user?.rol !== 'super_administrador') {
    respuesta
      .status(403)
      .json({ mensaje: 'Solo el super administrador puede realizar esta acción.' });
    return false;
  }
  return true;
}

module.exports = { VISTAS_DISPONIBLES, validarSuperAdministrador };
