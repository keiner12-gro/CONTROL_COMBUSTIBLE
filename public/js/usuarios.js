// ============================================================================
// usuarios.js — PANTALLA DE USUARIOS Y PERMISOS (public/html/usuarios.html)
// ----------------------------------------------------------------------------
// Administra las cuentas del sistema: crear, cambiar rol/contraseña, asignar
// permisos por vista y eliminar usuarios.
// La pieza central es GRUPOS_PERMISOS: define qué permisos existen y a qué rol
// pertenece cada uno. Con ese mismo arreglo se construyen el mapa de consulta,
// las sugerencias automáticas al elegir rol y los árboles editables.
// SI CREAS UNA VISTA NUEVA: agrégala a GRUPOS_PERMISOS aquí Y al arreglo
// VISTAS_DISPONIBLES del backend (src/shared/application/permisos.js).
// ============================================================================

// Elementos del formulario de creación y de la tabla.
const formularioUsuario = document.getElementById('formulario-usuario');
const usuarioNuevo = document.getElementById('usuario-nuevo');
const contrasenaNueva = document.getElementById('contrasena-nueva');
const rolNuevo = document.getElementById('rol-nuevo');
const cuerpoTablaUsuarios = document.getElementById('cuerpo-tabla-usuarios');
const cantidadUsuarios = document.getElementById('cantidad-usuarios');
const arbolPermisosNuevo = document.getElementById('arbol-permisos-nuevo'); // Checkboxes del formulario
const notaSuperadminNuevo = document.getElementById('nota-superadmin-nuevo'); // Aviso "acceso total"
const mapaPermisosRoles = document.getElementById('mapa-permisos-roles'); // Tabla de referencia

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
      { vista: 'auditoria', etiqueta: 'Auditoría y exportación' } // 'auditoria' se repite a propósito
    ]
  }
];

// Lista plana de todas las vistas que se pueden asignar.
const vistasPermisos = GRUPOS_PERMISOS.flatMap((grupo) => grupo.permisos.map((p) => p.vista));

// Rol de quien esta viendo la pantalla. Solo un super administrador puede
// asignar o ver el rol "super_administrador"; el resto de administradores
// gestiona el resto de cuentas (el backend aplica esta misma restriccion).
function obtenerRolActual() {
  const sesion = typeof obtenerSesionActual === 'function' ? obtenerSesionActual() : null;
  return sesion?.rol || '';
}

// Roles que aparecen en los selectores, según quién esté conectado.
const ROLES_ASIGNABLES =
  obtenerRolActual() === 'super_administrador'
    ? ['super_administrador', 'administrador', 'operario', 'supervisor']
    : ['administrador', 'operario', 'supervisor'];

// Lee la sesion para enviar el rol al servidor en APIs administrativas.
// (Hoy solo declara el tipo de contenido: la identidad va en la cookie.)
function obtenerCabecerasAdmin() {
  return { 'Content-Type': 'application/json' };
}

// Extrae el mensaje de error que envia el backend, con un texto de respaldo.
async function extraerMensajeError(respuesta, mensajePorDefecto) {
  try {
    const datos = await respuesta.json();
    return datos?.mensaje || mensajePorDefecto;
  } catch (_) {
    return mensajePorDefecto; // La respuesta no era JSON
  }
}

// Construye el arbol de solo lectura "Mapa de permisos por rol".
function construirMapaPermisosRoles() {
  mapaPermisosRoles.innerHTML = '';

  GRUPOS_PERMISOS.forEach((grupo) => {
    mapaPermisosRoles.appendChild(crearGrupoArbol(grupo, { editable: false }));
  });

  // El super administrador no está en GRUPOS_PERMISOS (no tiene permisos
  // individuales), así que su bloque se agrega aparte.
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
      item.textContent = permiso.etiqueta; // Modo consulta: solo texto
    } else {
      // Modo edición: checkbox marcado si el usuario ya tiene ese permiso.
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
  // El fragmento permite armar todo en memoria y agregarlo de una sola vez.
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

  // Al super administrador no se le asignan permisos: se oculta el árbol y se
  // muestra la nota de acceso total.
  notaSuperadminNuevo.hidden = !esSuperAdmin;
  arbolPermisosNuevo.hidden = esSuperAdmin;

  const grupo = GRUPOS_PERMISOS.find((g) => g.rol === rolSeleccionado);
  const sugeridos = grupo ? grupo.permisos.map((p) => p.vista) : [];

  // Los sugeridos quedan marcados y el resto desmarcados (son solo una
  // propuesta: quien crea la cuenta puede cambiarlos antes de guardar).
  arbolPermisosNuevo.querySelectorAll('input[type="checkbox"]').forEach((checkbox) => {
    checkbox.checked = sugeridos.includes(checkbox.value);
  });
}

// Obtiene los permisos marcados en el formulario de crear usuario.
function obtenerPermisosFormulario() {
  const marcados = Array.from(arbolPermisosNuevo.querySelectorAll('input:checked')).map(
    (permiso) => permiso.value
  );
  // Algunas vistas (ej. auditoria) aparecen en mas de un grupo de rol, asi
  // que puede haber dos checkboxes con el mismo valor marcados a la vez.
  return [...new Set(marcados)]; // Set elimina los duplicados
}

// Carga usuarios desde MySQL usando la API de Express.
async function cargarUsuarios() {
  const respuesta = await fetch('/api/usuarios', {
    headers: obtenerCabecerasAdmin()
  });

  // Sin permiso o con error: la tabla queda vacía y se explica el motivo.
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

  // El super administrador no tiene checkboxes: solo una etiqueta.
  if (usuario.rol === 'super_administrador') {
    const chip = document.createElement('span');
    chip.className = 'chip-permiso-total';
    chip.textContent = 'Acceso total';
    celda.appendChild(chip);
    return celda;
  }

  // <details>/<summary>: el navegador maneja solo el desplegable.
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
    // Una fila con: nombre | selector de rol | permisos | contraseña | acciones
    const fila = document.createElement('tr');
    const celdaUsuario = document.createElement('td');
    const celdaRol = document.createElement('td');
    const selectorRol = document.createElement('select');
    const entradaContrasena = document.createElement('input');
    const botonGuardar = document.createElement('button');
    const botonEliminar = document.createElement('button');

    celdaUsuario.textContent = usuario.usuario;

    // Selector con los roles que esta persona puede asignar.
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

    // Campo de contraseña: si se deja vacío, no se cambia.
    entradaContrasena.type = 'password';
    entradaContrasena.placeholder = 'Dejar vacio si no cambia';
    fila.appendChild(crearCeldaConElemento(entradaContrasena));

    // "Guardar" envía rol, contraseña y permisos marcados en esa fila.
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
      entradaContrasena.value = ''; // Nunca se deja la contraseña escrita en pantalla
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

// Pequeño ayudante: envuelve un elemento dentro de una celda <td>.
function crearCeldaConElemento(elemento) {
  const celda = document.createElement('td');
  celda.appendChild(elemento);
  return celda;
}

// Lee los permisos marcados en una fila de la tabla.
function obtenerPermisosFila(fila) {
  const marcados = Array.from(fila.querySelectorAll('input[type="checkbox"]:checked')).map(
    (checkbox) => checkbox.dataset.vista
  );
  // Algunas vistas (ej. auditoria) aparecen en mas de un grupo de rol, asi
  // que puede haber dos checkboxes con el mismo valor marcados a la vez.
  return [...new Set(marcados)];
}

// Guarda cambios de rol, contrasena y permisos de un usuario.
// Devuelve la respuesta sin procesar para que quien llame maneje el error.
function guardarCambiosUsuario(id, fila, rol, contrasena) {
  return fetch(`/api/usuarios/${id}`, {
    method: 'PUT',
    headers: obtenerCabecerasAdmin(),
    body: JSON.stringify({
      rol,
      contrasena, // Vacío = no se modifica
      permisos: obtenerPermisosFila(fila)
    })
  });
}

// Elimina un usuario de usuarios_combustible.
// OJO: este sí es un borrado real (no una anulación como en los otros módulos).
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
  aplicarSugerenciaDeRol(); // Deja el árbol acorde al rol que quedó seleccionado
  await cargarUsuarios();
  mostrarAlertaExito('Usuario creado', 'El usuario fue creado correctamente.');
});

// --- Arranque de la pantalla ------------------------------------------------
// Oculta la opcion "Super administrador" del formulario si quien la ve no lo es.
if (obtenerRolActual() !== 'super_administrador') {
  rolNuevo.querySelector('option[value="super_administrador"]')?.remove();
}

arbolPermisosNuevo.appendChild(construirArbolPermisosEditable([], false)); // Árbol vacío inicial
rolNuevo.addEventListener('change', aplicarSugerenciaDeRol); // Sugerir al cambiar de rol
construirMapaPermisosRoles(); // Tabla de referencia de permisos
cargarUsuarios(); // Listado de cuentas
