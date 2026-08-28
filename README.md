# Control de Combustible 2.0

Sistema de control diario de combustible con Node.js, Express y MySQL/MariaDB.

## Cambios principales

- Sesiones reales mediante cookie HttpOnly y tokens de sesión almacenados como hash.
- Contraseñas migradas automáticamente desde texto plano a hash scrypt al iniciar sesión/preparar la base.
- APIs protegidas por autenticación y permisos.
- El backend ya no confía en `x-rol` ni `x-usuario`.
- Auditoría de accesos y operaciones críticas.
- Cierre M1/M2 independiente: si existe cierre del día anterior, el inicial se carga automáticamente y queda bloqueado; si no existe cierre del día anterior, el inicial queda editable manualmente.
- Validación en backend para impedir alterar un inicial automático.
- Vista de registros convertida de tabla ancha a tarjetas editables, más cómoda en móvil.
- Identidad visual verde + naranja, sin imágenes de fondo nuevas.
- Indicador visual de capacidad del tanque y sobrecapacidad.
- Alertas por sobrecapacidad y por consumo superior al promedio histórico.
- Parámetros de alerta de promedio configurables en `.env`.
- Separación del contenido público en `public/`; `src`, `data`, `.env` y `database.sql` no se sirven como archivos estáticos.

## Instalación

1. Copia `.env.example` como `.env` y completa las credenciales de MySQL/MariaDB.
2. Ejecuta `npm install`.
3. Asegúrate de que MySQL/MariaDB esté iniciado.
4. Ejecuta `npm start`.
5. Abre `http://localhost:3000`.

La aplicación crea/migra las tablas necesarias al iniciar. Si ya existen usuarios con contraseñas antiguas en texto plano, el esquema las convierte a hash scrypt.

## Seguridad

No compartas el archivo `.env`. El ZIP de entrega no incluye credenciales ni `node_modules`.

## M1/M2

Para una fecha seleccionada, el sistema consulta exclusivamente el día calendario anterior. Si existe un cierre de ese día, M1 y M2 toman respectivamente sus lecturas finales. Si no existe cierre del día anterior, cada inicial puede introducirse manualmente. Si solo existe cierre para una manguera, esa manguera queda automática y la otra puede permanecer manual.

## Promedio de consumo

Por defecto se necesitan 5 registros históricos de la máquina y el nuevo suministro debe superar en 25% el promedio para generar una alerta. Se puede cambiar con:

- `MIN_MUESTRAS_PROMEDIO`
- `FACTOR_ALERTA_PROMEDIO`
