// ============================================================================
// auth.repository.js (DOMINIO) — CONTRATO DE SESIONES Y LOGIN
// ----------------------------------------------------------------------------
// Lo que security.js necesita para crear/validar sesiones y frenar la fuerza
// bruta, sin decir CÓMO se guarda (Postgres o Airtable).
// Implementaciones reales:
//   infrastructure/pg-auth.repository.js       (Postgres/Supabase)
//   infrastructure/airtable-auth.repository.js (Airtable)
// ============================================================================

const pendiente = () => {
  throw new Error('Not implemented');
};

class AuthRepository {
  async crearSesion() {
    return pendiente(); // Guarda una sesión nueva (token ya hasheado)
  }

  async buscarSesionConPermisos() {
    return pendiente(); // Sesión vigente + usuario dueño + sus permisos, o null
  }

  async marcarUltimoUso() {
    return pendiente(); // Actualiza la marca de actividad de la sesión
  }

  async eliminarSesionPorToken() {
    return pendiente(); // Cierra una sesión (logout)
  }

  async limpiarSesionesVencidas() {
    return pendiente(); // Borra sesiones cuya fecha de expiración ya pasó
  }

  async obtenerIntento() {
    return pendiente(); // { intentos, segundos } del contador anti fuerza bruta, o null
  }

  async registrarIntentoFallido() {
    return pendiente(); // Suma un intento fallido (reinicia si la ventana venció)
  }

  async limpiarIntento() {
    return pendiente(); // Borra el contador (login correcto)
  }
}

module.exports = { AuthRepository };
