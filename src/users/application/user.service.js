// ============================================================================
// user.service.js (APLICACIÓN) — REGLAS DE NEGOCIO DE USUARIOS
// ----------------------------------------------------------------------------
// Capa intermedia entre las rutas HTTP y la base de datos. Aquí van las reglas
// que no dependen de MySQL ni de Express (por ejemplo, el largo mínimo de la
// contraseña o prohibir "123456").
// SI QUIERES CAMBIAR LAS REGLAS DE CONTRASEÑA -> método changePassword.
// ============================================================================

class UserService {
  // Recibe el repositorio por parámetro (inyección de dependencias desde server.js)
  constructor(repository) {
    this.repository = repository;
  }

  // Valida credenciales y arma el objeto de usuario que verá el frontend.
  async login(usuario, contrasena) {
    const encontrado = await this.repository.findByCredentials(usuario, contrasena);
    if (!encontrado) return null; // Usuario inexistente o contraseña incorrecta
    return {
      id: encontrado.id,
      usuario: encontrado.usuario,
      rol: encontrado.rol,
      debeCambiarContrasena: Boolean(encontrado.debe_cambiar_contrasena), // Se convierte 0/1 a true/false
      permisos: await this.repository.getPermissions(encontrado.id, encontrado.rol)
    };
  }

  // Listado completo de usuarios (para la pantalla de administración).
  list() {
    return this.repository.list();
  }

  // Consulta puntual de un usuario por id.
  findById(id) {
    return this.repository.findById(id);
  }

  // Cambio de contraseña con las validaciones de negocio.
  async changePassword(id, contrasenaActual, nuevaContrasena) {
    // Regla 1: mínimo 6 caracteres.
    if (!nuevaContrasena || String(nuevaContrasena).length < 6)
      throw Object.assign(new Error('La nueva contrasena debe tener al menos 6 caracteres.'), {
        status: 400 // El "status" lo usa el manejador de errores de server.js
      });
    // Regla 2: no se permite dejar la contraseña temporal por defecto.
    if (String(nuevaContrasena) === '123456')
      throw Object.assign(new Error('La nueva contrasena no puede ser 123456.'), { status: 400 });

    const actualizada = await this.repository.changePassword(id, contrasenaActual, nuevaContrasena);
    // Si el repositorio devuelve false, la contraseña actual no coincidía.
    if (!actualizada)
      throw Object.assign(new Error('La contrasena actual no es correcta.'), { status: 401 });
    return true;
  }

  // Crear usuario = insertar la cuenta + guardar sus permisos.
  async create(datos) {
    const id = await this.repository.create(datos);
    await this.repository.replacePermissions(id, datos.permisos);
    return id;
  }

  // Actualizar usuario = actualizar rol/contraseña + reemplazar sus permisos.
  async update(id, datos) {
    await this.repository.update(id, datos);
    await this.repository.replacePermissions(id, datos.permisos);
  }

  // Eliminar usuario (sus permisos se borran solos por el ON DELETE CASCADE).
  remove(id) {
    return this.repository.remove(id);
  }
}

module.exports = { UserService };
