const formularioUsuario = document.getElementById('formulario-usuario');
const usuarioNuevo = document.getElementById('usuario-nuevo');
const contrasenaNueva = document.getElementById('contrasena-nueva');
const rolNuevo = document.getElementById('rol-nuevo');
const cuerpoTablaUsuarios = document.getElementById('cuerpo-tabla-usuarios');
const cantidadUsuarios = document.getElementById('cantidad-usuarios');
const arbolPermisosNuevo = document.getElementById('arbol-permisos-nuevo');
const notaSuperadminNuevo = document.getElementById('nota-superadmin-nuevo');
const mapaPermisosRoles = document.getElementById('mapa-permisos-roles');

// Jerarquia de permisos: que rol suele necesitar cada vista del sistema.
// Es la base tanto del mapa de referencia como de la sugerencia automatica
// al crear/editar un usuario; el super administrador siempre tiene acceso total.
const GRUPOS_PERMISOS = [
  {
    rol: 'operario',
    etiquetaRol: 'Operario',
    permisos: [{ vista: 'registro', etiqueta: 'Crear registros de combustible' }]
  },
  {
    rol: 'supervisor',
    etiquetaRol: 'Supervisor',
    permisos: [
      { vista: 'tablas', etiqueta: 'Ver registros' },
      { vista: 'reportes', etiqueta: 'Ver reportes' },
      { vista: 'alertas', etiqueta: 'Justificar alertas' },
      { vista: 'auditoria', etiqueta: 'Consultar auditoría' }
    ]
  },
  {
    rol: 'administrador',
    etiquetaRol: 'Administrador',
    permisos: [
      { vista: 'tractores', etiqueta: 'Administrar máquinas' },
      { vista: 'operarios', etiqueta: 'Administrar operarios' },
      { vista: 'usuarios', etiqueta: 'Administrar usuarios' },
      { vista: 'auditoria', etiqueta: 'Auditoría y exportación' }
    ]
  }
];

const vistasPermisos = GRUPOS_PERMISOS.flatMap((grupo) => grupo.permisos.map((p) => p.vista));

// Rol de quien esta viendo la pantalla. Solo un super administrador puede
// asignar o ver el rol "super_administrador"; el resto de administradores
// gestiona el resto de cuentas (el backend aplica esta misma restriccion).
function obtenerRolActual() {
  const sesion = typeof obtenerSesionActual === 'function' ? obtenerSesionActual() : null;
  return sesion?.rol || '';
}

const ROLES_ASIGNABLES =
  obtenerRolActual() === 'super_administrador'
    ? ['super_administrador', 'administrador', 'operario', 'supervisor']
    : ['administrador', 'operario', 'supervisor'];

// Lee la sesion para enviar el rol al servidor en APIs administrativas.
function obtenerCabecerasAdmin() {
  return { 'Content-Type': 'application/json' };
}

// Extrae el mensaje de error que envia el backend, con un texto de respaldo.
async function extraerMensajeError(respuesta, mensajePorDefecto) {
  try {
    const datos = await respuesta.json();
    return datos?.mensaje || mensajePorDefecto;
  } catch (_) {
    return mensajePorDefecto;
  }
}

// Construye el arbol de solo lectura "Mapa de permisos por rol".
function construirMapaPermisosRoles() {
  mapaPermisosRoles.innerHTML = '';

  GRUPOS_PERMISOS.forEach((grupo) => {
    mapaPermisosRoles.appendChild(crearGrupoArbol(grupo, { editable: false }));
  });

  const grupoSuperAdmin = {
    etiquetaRol: 'Super administrador',
    permisos: [{ etiqueta: 'Acceso total a todos los módulos' }]
  };
  mapaPermisosRoles.appendChild(crearGrupoArbol(grupoSuperAdmin, { editable: false }));
}

// Crea un bloque "Rol -> lista de permisos" con conectores de arbol via CSS.
// Si editable=true, cada permiso es un checkbox marcable; si no, es solo texto.
function crearGrupoArbol(grupo, { editable, permisosActivos, deshabilitado, usuarioId }) {
  const contenedor = document.createElement('div');
  contenedor.className = 'grupo-permiso-rol';
  if (grupo.rol) contenedor.dataset.rol = grupo.rol;

  const titulo = document.createElement('div');
  titulo.className = 'arbol-rol-nombre';
  titulo.textContent = grupo.etiquetaRol;
  contenedor.appendChild(titulo);

  const lista = document.createElement('ul');
  lista.className = 'arbol-permisos';

  grupo.permisos.forEach((permiso) => {
    const item = document.createElement('li');

    if (!editable || !permiso.vista) {
      item.textContent = permiso.etiqueta;
    } else {
      const label = document.createElement('label');
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.value = permiso.vista;
      checkbox.dataset.vista = permiso.vista;
      checkbox.checked = Boolean(permisosActivos && permisosActivos.includes(permiso.vista));
      checkbox.disabled = Boolean(deshabilitado);
      if (usuarioId !== undefined) checkbox.dataset.usuarioId = usuarioId;
      label.appendChild(checkbox);
      label.append(' ' + permiso.etiqueta);
      item.appendChild(label);
    }

    lista.appendChild(item);
  });

  contenedor.appendChild(lista);
  return contenedor;
}

// Construye el arbol editable de permisos, usado en el formulario de creacion
// y en cada fila de la tabla de usuarios.
function construirArbolPermisosEditable(permisosActivos, deshabilitado, usuarioId) {
  const fragmento = document.createDocumentFragment();
  GRUPOS_PERMISOS.forEach((grupo) => {
    fragmento.appendChild(
      crearGrupoArbol(grupo, { editable: true, permisosActivos, deshabilitado, usuarioId })
    );
  });
  return fragmento;
}

// Marca solo los permisos sugeridos para el rol elegido en el formulario de creacion.
function aplicarSugerenciaDeRol() {
  const rolSeleccionado = rolNuevo.value;
  const esSuperAdmin = rolSeleccionado === 'super_administrador';

  notaSuperadminNuevo.hidden = !esSuperAdmin;
  arbolPermisosNuevo.hidden = esSuperAdmin;

  const grupo = GRUPOS_PERMISOS.find((g) => g.rol === rolSeleccionado);
  const sugeridos = grupo ? grupo.permisos.map((p) => p.vista) : [];

  arbolPermisosNuevo.querySelectorAll('input[type="checkbox"]').forEach((checkbox) => {
    checkbox.checked = sugeridos.includes(checkbox.value);
  });
}

// Obtiene los permisos marcados en el formulario de crear usuario.
function obtenerPermisosFormulario() {
  return Array.from(arbolPermisosNuevo.querySelectorAll('input:checked')).map(
    (permiso) => permiso.value
  );
}

// Carga usuarios desde MySQL usando la API de Express.
async function cargarUsuarios() {
  const respuesta = await fetch('/api/usuarios', {
    headers: obtenerCabecerasAdmin()
  });

  if (!respuesta.ok) {
    cuerpoTablaUsuarios.innerHTML = '';
    cantidadUsuarios.textContent = '0';
    const mensaje = await extraerMensajeError(respuesta, 'No se pudo cargar la lista de usuarios.');
    mostrarAlertaError('No se pudo cargar la lista', mensaje);
    return;
  }

  const usuarios = await respuesta.json();
  pintarUsuarios(usuarios);
}

// Construye la celda de permisos: un resumen compacto que se expande al
// arbol editable, en vez de siete columnas fijas de checkboxes.
function crearCeldaPermisos(usuario) {
  const celda = document.createElement('td');
  celda.className = 'celda-permisos';

  if (usuario.rol === 'super_administrador') {
    const chip = document.createElement('span');
    chip.className = 'chip-permiso-total';
    chip.textContent = 'Acceso total';
    celda.appendChild(chip);
    return celda;
  }

  const detalle = document.createElement('details');
  detalle.className = 'permisos-detalle';

  const resumen = document.createElement('summary');
  const cantidad = usuario.permisos.length;
  resumen.textContent = cantidad === 1 ? '1 permiso' : `${cantidad} permisos`;
  detalle.appendChild(resumen);

  const arbol = document.createElement('div');
  arbol.className = 'arbol-roles arbol-roles-compacto';
  arbol.appendChild(construirArbolPermisosEditable(usuario.permisos, false, usuario.id));
  detalle.appendChild(arbol);

  celda.appendChild(detalle);
  return celda;
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

    ROLES_ASIGNABLES.forEach((rol) => {
      const opcion = document.createElement('option');
      opcion.value = rol;
      opcion.textContent = rol;
      opcion.selected = usuario.rol === rol;
      selectorRol.appendChild(opcion);
    });

    celdaRol.appendChild(selectorRol);
    fila.appendChild(celdaUsuario);
    fila.appendChild(celdaRol);
    fila.appendChild(crearCeldaPermisos(usuario));

    entradaContrasena.type = 'password';
    entradaContrasena.placeholder = 'Dejar vacio si no cambia';
    fila.appendChild(crearCeldaConElemento(entradaContrasena));

    botonGuardar.type = 'button';
    botonGuardar.textContent = 'Guardar';
    botonGuardar.addEventListener('click', async () => {
      const respuesta = await guardarCambiosUsuario(
        usuario.id,
        fila,
        selectorRol.value,
        entradaContrasena.value
      );
      if (!respuesta.ok) {
        const mensaje = await extraerMensajeError(respuesta, 'No se pudo actualizar el usuario.');
        mostrarAlertaError('No se pudo guardar', mensaje);
        return;
      }
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
  return Array.from(fila.querySelectorAll('input[type="checkbox"]:checked')).map(
    (checkbox) => checkbox.dataset.vista
  );
}

// Guarda cambios de rol, contrasena y permisos de un usuario.
function guardarCambiosUsuario(id, fila, rol, contrasena) {
  return fetch(`/api/usuarios/${id}`, {
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

  const respuesta = await fetch(`/api/usuarios/${id}`, {
    method: 'DELETE',
    headers: obtenerCabecerasAdmin()
  });

  if (!respuesta.ok) {
    const mensaje = await extraerMensajeError(respuesta, 'No se pudo eliminar el usuario.');
    mostrarAlertaError('No se pudo eliminar', mensaje);
    return;
  }

  await cargarUsuarios();
  mostrarAlertaExito('Usuario eliminado', 'El usuario fue eliminado correctamente.');
}

// Crea un usuario nuevo desde el formulario superior.
formularioUsuario.addEventListener('submit', async (evento) => {
  evento.preventDefault();

  const respuesta = await fetch('/api/usuarios', {
    method: 'POST',
    headers: obtenerCabecerasAdmin(),
    body: JSON.stringify({
      usuario: usuarioNuevo.value.trim(),
      contrasena: contrasenaNueva.value.trim(),
      rol: rolNuevo.value,
      permisos: obtenerPermisosFormulario()
    })
  });

  if (!respuesta.ok) {
    const mensaje = await extraerMensajeError(respuesta, 'No se pudo crear el usuario.');
    mostrarAlertaError('No se pudo crear el usuario', mensaje);
    return;
  }

  formularioUsuario.reset();
  aplicarSugerenciaDeRol();
  await cargarUsuarios();
  mostrarAlertaExito('Usuario creado', 'El usuario fue creado correctamente.');
});

// Oculta la opcion "Super administrador" del formulario si quien la ve no lo es.
if (obtenerRolActual() !== 'super_administrador') {
  rolNuevo.querySelector('option[value="super_administrador"]')?.remove();
}

arbolPermisosNuevo.appendChild(construirArbolPermisosEditable([], false));
rolNuevo.addEventListener('change', aplicarSugerenciaDeRol);
construirMapaPermisosRoles();
cargarUsuarios();
