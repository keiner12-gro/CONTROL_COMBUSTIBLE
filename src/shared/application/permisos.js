const VISTAS_DISPONIBLES = [
  'registro',
  'tablas',
  'usuarios',
  'tractores',
  'operarios',
  'reportes',
  'alertas',
  'auditoria'
];

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
