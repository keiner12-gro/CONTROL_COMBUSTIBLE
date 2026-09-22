# Control de Combustible 3.0

Sistema de control diario de combustible: registro de suministros a cada máquina, lecturas de los medidores del
surtidor (M1/M2), cierre de jornada, alertas, reportes y auditoría. **Node.js + Express**, con la base de datos a
elegir entre **PostgreSQL (Supabase)** o **Airtable** (interruptor `DB_PROVIDER`, sin tocar código — ver
`docs/GUIA-SUPABASE.md` y `docs/GUIA-AIRTABLE.md`), instalable como app en celular y tablet (**PWA**, con
notificaciones push).

## Qué hace

| Módulo                  | Descripción                                                                                                                                                 |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Registro**            | Suministro a una máquina (operario, horómetro, cantidad, SAI, firma dibujada).                                                                              |
| **Jornada**             | Una por día: lecturas M1/M2 iniciales/finales + checklist. Se **autoguarda**; un solo cierre por día.                                                       |
| **Alertas**             | Sobrecapacidad, consumo sobre el promedio, horómetro irregular, inspección pendiente y **cierre pendiente**.                                                |
| **Reportes**            | Se calculan al momento con dos fuentes **independientes**: medidores del surtidor (jornadas) y suministros a máquinas, más la **conciliación** entre ambos. |
| **Auditoría**           | Bitácora de solo lectura, **inmutable** incluso a nivel de base de datos.                                                                                   |
| **Usuarios y permisos** | Roles (super administrador, administrador, supervisor, operario) y permisos por pantalla.                                                                   |
| **Avisos**              | Notificaciones push y barra en la app cuando una jornada queda sin cerrar.                                                                                  |

## Estructura

```
server.js                 Punto de entrada (Express, seguridad, montaje de módulos, interruptor DB_PROVIDER)
src/<módulo>/             domain (contratos) · application (reglas) · infrastructure (pg-*/airtable-* + rutas HTTP)
  jornadas/  records/  reports/  alerts/  auditoria/  users/  tractors/  operators/  push/  tareas/
src/shared/               db.js · airtable-client.js · storage.js · security.js · fechas.js · audit.js
supabase/schema.sql       Esquema de Postgres/Supabase (12 tablas)
airtable/schema.js        Esquema de Airtable (13 tablas: una extra para los archivos adjuntos)
public/                   Frontend (html, css, js), manifest.webmanifest, sw.js, íconos y librerías (vendor/)
scripts/                  db-migrar · db-sembrar · airtable-migrar · airtable-sembrar · migrar-datos · generar-vapid · dev-local
test/                     Pruebas automáticas (más de 120, incluye un Airtable simulado en memoria)
docs/                     GUIA-SUPABASE.md · GUIA-AIRTABLE.md · GUIA-APP-MOVIL.md
```

## Puesta en marcha rápida

```bash
npm install
npm run dev:local        # prueba SIN Supabase (Postgres embebido). Usuarios: admin / supervisor / operario, clave demo1234
npm test                 # pruebas automáticas
```

La base de datos se elige con `DB_PROVIDER` (`postgres`, por defecto, o `airtable`) — es un interruptor, no dos
versiones de la app. Para producción sigue **`docs/GUIA-SUPABASE.md`** o **`docs/GUIA-AIRTABLE.md`** según cuál
uses (montaje, variables de entorno, y traspaso a otra cuenta). Para instalar la app, activar avisos o generar el
APK: **`docs/GUIA-APP-MOVIL.md`**.

Comandos:

| Comando                                   | Para qué                                                                                |
| ----------------------------------------- | --------------------------------------------------------------------------------------- |
| `npm start`                               | Levanta el servidor con la base configurada en `DB_PROVIDER`.                           |
| `npm run db:migrar` / `airtable:migrar`   | Crea/actualiza las tablas (idempotente), en Postgres o Airtable.                        |
| `npm run db:sembrar` / `airtable:sembrar` | Maquinaria inicial y primer administrador.                                              |
| `npm run migrar-datos`                    | Pasa los datos de la base antigua (MySQL/TiDB) a Supabase (`-- --simular` para probar). |
| `npm run generar-vapid`                   | Claves gratuitas para las notificaciones push.                                          |
| `npm run dev:local`                       | App completa en local con Postgres embebido.                                            |

## Configuración

Toda la configuración va en variables de entorno (ver `.env.example`). Con `DB_PROVIDER=postgres` (o sin
definir): `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`. Con `DB_PROVIDER=airtable`: `AIRTABLE_API_KEY`,
`AIRTABLE_BASE_ID`. Comunes a ambas: `CRON_SECRET`, `VAPID_*`, `ZONA_HORARIA` (America/Bogota),
`HORA_LIMITE_CIERRE` (18:00).

## Reglas de negocio importantes

- **Fechas**: todo usa la zona horaria de la operación (`ZONA_HORARIA`), no UTC.
- **Jornada**: una fila por día (`fecha` única). El primer suministro o el primer guardado la crea; el cierre la
  completa. Los galones los calcula el servidor. La lectura inicial del día es la final del cierre del día anterior.
- **Fechas pasadas**: el operario solo puede registrar hoy (sí puede completar una jornada que quedó abierta);
  supervisor hasta `DIAS_ATRAS_PERMITIDOS` días, administrador hasta `DIAS_ATRAS_ADMIN`; el super administrador sin límite.
- **Anulación**: registros, máquinas y operarios no se borran: se anulan con motivo.
- **Archivos adjuntos**: máx. 3 MB (PDF, PNG, JPG o WEBP); se guardan en Supabase Storage o en Airtable (según
  `DB_PROVIDER`) y se valida su contenido real.

## Seguridad

Contraseñas con scrypt, sesiones con cookie HttpOnly (el token se guarda hasheado), bloqueo de intentos de login en
base de datos, cabeceras CSP/HSTS, consultas parametrizadas, auditoría inmutable (con Postgres, también a nivel de
base de datos mediante un trigger — ver `docs/GUIA-AIRTABLE.md` sección 6 para la diferencia con Airtable), RLS
activado en todas las tablas de Postgres, y librerías propias en `public/vendor` (sin CDN). No compartas el
archivo `.env`.
