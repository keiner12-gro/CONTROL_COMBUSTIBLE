class UserService {
  constructor(repository) {
    this.repository = repository;
  }

  async login(usuario, contrasena) {
    const encontrado = await this.repository.findByCredentials(usuario, contrasena);
    if (!encontrado) return null;
    return {
      id: encontrado.id,
      usuario: encontrado.usuario,
      rol: encontrado.rol,
      debeCambiarContrasena: Boolean(encontrado.debe_cambiar_contrasena),
      permisos: await this.repository.getPermissions(encontrado.id, encontrado.rol)
    };
  }

  list() {
    return this.repository.list();
  }

  async changePassword(id, contrasenaActual, nuevaContrasena) {
    if (!nuevaContrasena || String(nuevaContrasena).length < 6)
      throw Object.assign(new Error('La nueva contrasena debe tener al menos 6 caracteres.'), {
        status: 400
      });
    if (String(nuevaContrasena) === '123456')
      throw Object.assign(new Error('La nueva contrasena no puede ser 123456.'), { status: 400 });
    const actualizada = await this.repository.changePassword(id, contrasenaActual, nuevaContrasena);
    if (!actualizada)
      throw Object.assign(new Error('La contrasena actual no es correcta.'), { status: 401 });
    return true;
  }

  async create(datos) {
    const id = await this.repository.create(datos);
    await this.repository.replacePermissions(id, datos.permisos);
    return id;
  }

  async update(id, datos) {
    await this.repository.update(id, datos);
    await this.repository.replacePermissions(id, datos.permisos);
  }

  remove(id) {
    return this.repository.remove(id);
  }
}

module.exports = { UserService };
