// ============================================================================
// user.repository.js (DOMINIO) — CONTRATO DEL REPOSITORIO DE USUARIOS
// ----------------------------------------------------------------------------
// Clase abstracta: define QUÉ operaciones debe ofrecer cualquier repositorio de
// usuarios, sin decir CÓMO. La implementación real contra MySQL está en
// infrastructure/mysql-user.repository.js.
// Sirve para que el servicio dependa de este contrato y no de MySQL: si algún
// día se cambia de motor de base de datos, solo se crea otra implementación.
// Cada método lanza error si no fue sobrescrito por la clase hija.
// ============================================================================

class UserRepository {
  async findByCredentials() {
    // Busca un usuario validando su contraseña (para el login)
    throw new Error('Not implemented');
  }
  async findById() {
    // Trae un usuario por su id
    throw new Error('Not implemented');
  }
  async changePassword() {
    // Cambia la contraseña validando la actual
    throw new Error('Not implemented');
  }
  async list() {
    // Lista todos los usuarios con sus permisos
    throw new Error('Not implemented');
  }
  async create() {
    // Crea un usuario nuevo
    throw new Error('Not implemented');
  }
  async update() {
    // Actualiza rol y/o contraseña
    throw new Error('Not implemented');
  }
  async remove() {
    // Elimina un usuario
    throw new Error('Not implemented');
  }
  async getPermissions() {
    // Devuelve las vistas permitidas de un usuario
    throw new Error('Not implemented');
  }
  async replacePermissions() {
    // Reemplaza por completo los permisos de un usuario
    throw new Error('Not implemented');
  }
}
module.exports = { UserRepository };
