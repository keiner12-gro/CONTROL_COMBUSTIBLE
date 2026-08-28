const formularioUsuario = document.getElementById('formulario-usuario');
const usuarioNuevo = document.getElementById('usuario-nuevo');
const contrasenaNueva = document.getElementById('contrasena-nueva');
const rolNuevo = document.getElementById('rol-nuevo');
const cuerpoTablaUsuarios = document.getElementById('cuerpo-tabla-usuarios');
const cantidadUsuarios = document.getElementById('cantidad-usuarios');

const vistasPermisos = ['registro', 'tablas', 'usuarios', 'tractores', 'operarios', 'reportes', 'alertas'];

// Lee la sesion para enviar el rol al servidor en APIs administrativas.
function obtenerCabecerasAdmin() {
  const sesion = obtenerSesionActual();

  return {
    'Content-Type': 'application/json',
    
  };
}

// Obtiene los permisos marcados en el formulario de crear usuario.
function obtenerPermisosFormulario() {
  return Array.from(document.querySelectorAll('.permisos-usuario input:checked'))
    .map((permiso) => permiso.value);
}

// Carga usuarios desde MySQL usando la API de Express.
async function cargarUsuarios() {
  const respuesta = await fetch('/api/usuarios', {
    headers: obtenerCabecerasAdmin()
  });

  if (!respuesta.ok) {
    cuerpoTablaUsuarios.innerHTML = '';
    return;
  }

  const usuarios = await respuesta.json();
  pintarUsuarios(usuarios);
}

// Crea un checkbox de permiso para editar una vista especifica.
function crearCheckboxPermiso(usuario, vista) {
  const checkbox = document.createElement('input');

  checkbox.type = 'checkbox';
  checkbox.checked = usuario.permisos.includes(vista);
  checkbox.disabled = usuario.rol === 'super_administrador';
  checkbox.dataset.vista = vista;

  return checkbox;
}

// Pinta la tabla de usuarios y permite editar permisos.
function pintarUsuarios(usuarios) {
  cuerpoTablaUsuarios.innerHTML = '';
  cantidadUsuarios.textContent = usuarios.length;

  usuarios.forEach((usuario) => {
    const fila = document.createElement('tr');
    const celdaUsuario = document.createElement('td');
    const celdaRol = document.createElement('td');
    const selectorRol = document.createElement('select');
    const entradaContrasena = document.createElement('input');
    const botonGuardar = document.createElement('button');
    const botonEliminar = document.createElement('button');

    celdaUsuario.textContent = usuario.usuario;

    ['super_administrador', 'administrador', 'operario', 'supervisor'].forEach((rol) => {
      const opcion = document.createElement('option');
      opcion.value = rol;
      opcion.textContent = rol;
      opcion.selected = usuario.rol === rol;
      selectorRol.appendChild(opcion);
    });

    celdaRol.appendChild(selectorRol);
    fila.appendChild(celdaUsuario);
    fila.appendChild(celdaRol);

    vistasPermisos.forEach((vista) => {
      const celdaPermiso = document.createElement('td');
      celdaPermiso.appendChild(crearCheckboxPermiso(usuario, vista));
      fila.appendChild(celdaPermiso);
    });

    entradaContrasena.type = 'password';
    entradaContrasena.placeholder = 'Dejar vacio si no cambia';
    fila.appendChild(crearCeldaConElemento(entradaContrasena));

    botonGuardar.type = 'button';
    botonGuardar.textContent = 'Guardar';
    botonGuardar.addEventListener('click', async () => {
      await guardarCambiosUsuario(usuario.id, fila, selectorRol.value, entradaContrasena.value);
      entradaContrasena.value = '';
      await cargarUsuarios();
      mostrarAlertaExito('Usuario actualizado', 'Los cambios del usuario fueron guardados.');
    });

    botonEliminar.type = 'button';
    botonEliminar.textContent = 'Eliminar';
    botonEliminar.className = 'boton-eliminar';
    botonEliminar.addEventListener('click', async () => {
      await eliminarUsuario(usuario.id);
    });

    const celdaAcciones = document.createElement('td');
    celdaAcciones.className = 'acciones-usuario';
    celdaAcciones.appendChild(botonGuardar);
    celdaAcciones.appendChild(botonEliminar);
    fila.appendChild(celdaAcciones);

    cuerpoTablaUsuarios.appendChild(fila);
  });
}

function crearCeldaConElemento(elemento) {
  const celda = document.createElement('td');
  celda.appendChild(elemento);
  return celda;
}

// Lee los permisos marcados en una fila de la tabla.
function obtenerPermisosFila(fila) {
  return Array.from(fila.querySelectorAll('input[type="checkbox"]:checked'))
    .map((checkbox) => checkbox.dataset.vista);
}

// Guarda cambios de rol, contrasena y permisos de un usuario.
async function guardarCambiosUsuario(id, fila, rol, contrasena) {
  await fetch(`/api/usuarios/${id}`, {
    method: 'PUT',
    headers: obtenerCabecerasAdmin(),
    body: JSON.stringify({
      rol,
      contrasena,
      permisos: obtenerPermisosFila(fila)
    })
  });
}

// Elimina un usuario de usuarios_combustible.
async function eliminarUsuario(id) {
  const confirmado = await confirmarAccion(
    'Eliminar usuario',
    'Desea eliminar este usuario?',
    'Si, eliminar'
  );

  if (!confirmado) {
    return;
  }

  await fetch(`/api/usuarios/${id}`, {
    method: 'DELETE',
    headers: obtenerCabecerasAdmin()
  });

  await cargarUsuarios();
  mostrarAlertaExito('Usuario eliminado', 'El usuario fue eliminado correctamente.');
}

// Crea un usuario nuevo desde el formulario superior.
formularioUsuario.addEventListener('submit', async (evento) => {
  evento.preventDefault();

  await fetch('/api/usuarios', {
    method: 'POST',
    headers: obtenerCabecerasAdmin(),
    body: JSON.stringify({
      usuario: usuarioNuevo.value.trim(),
      contrasena: contrasenaNueva.value.trim(),
      rol: rolNuevo.value,
      permisos: obtenerPermisosFormulario()
    })
  });

  formularioUsuario.reset();
  await cargarUsuarios();
  mostrarAlertaExito('Usuario creado', 'El usuario fue creado correctamente.');
});

cargarUsuarios();
