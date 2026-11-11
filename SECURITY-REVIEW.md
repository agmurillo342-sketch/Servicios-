# Auditoría de seguridad del esquema de Supabase

Auditoría estática de `supabase/schema.sql` y de su uso desde `app.js`. No se
ejecutó SQL ni se verificó el esquema contra el estado real del proyecto.

## Hallazgo

| # | Severidad | Archivo y líneas | Hallazgo | Confianza |
|---|---|---|---|---|
| 1 | MEDIA | `supabase/schema.sql:92-99` | El bucket `service-photos` es público y la política permite leer sus objetos a `anon` y `authenticated`, sin comprobar si el perfil asociado fue aprobado. También pueden descubrirse fotos de perfiles pendientes o rechazados. | 9/10 |

La aplicación carga la foto antes de guardar el perfil (`app.js`, función
`saveProfile`). Por ello, una imagen puede quedar accesible aunque el perfil
esté pendiente o posteriormente se rechace. Si las fotos deben permanecer
privadas hasta la aprobación, habría que usar un bucket privado y autorizar la
lectura de forma acorde.

## Tablas y datos del directorio

- `public.categories`: categorías activas del directorio.
- `public.profiles`: perfiles de proveedores; cada fila corresponde a un
  usuario de `auth.users` y referencia una categoría.
- `public.reports`: reportes de perfiles, con referencias al perfil y al
  usuario que reporta.
- El esquema también configura el bucket de Storage `service-photos`; no es
  una tabla creada por este archivo.

Sí, incluye `public.categories` y `public.profiles`, así como la vista
`public.public_services` que consulta el directorio. La aplicación también
usa `public.reports` para reportar perfiles. El SQL concede lectura pública
de categorías activas y de la vista, que filtra perfiles con estado
`approved`.

## RLS y permisos

El esquema activa RLS en `categories`, `profiles` y `reports`:

- **Categorías:** lectura para `anon` y `authenticated` si están activas, o
  para un administrador.
- **Perfiles:** lectura directa solo para el propietario o un administrador
  autenticado; inserción del propio perfil únicamente con estado `pending`;
  actualización del propio perfil o de cualquier perfil por un administrador,
  con restricción del propietario a conservar estado `pending`.
- **Reportes:** permite insertar a usuarios autenticados solo si
  `reporter_id` coincide con `auth.uid()`. No define una política de lectura.
- **Fotos:** lectura pública de todo el bucket; inserción, actualización y
  borrado limitados a la carpeta cuyo primer segmento coincide con el ID del
  usuario autenticado.

## Exposición de datos y privilegios

Los visitantes anónimos consultan la vista pública, no la tabla de perfiles.
La vista contiene una selección limitada de columnas de perfiles aprobados:
teléfono y WhatsApp se devuelven únicamente cuando sus respectivos campos
`show_phone` y `show_whatsapp` son verdaderos. No expone otros campos del
perfil como `status`. Sin embargo, las fotos del bucket son públicas
independientemente del estado del perfil; es el hallazgo de privacidad
descrito arriba.

Los proveedores pueden crear perfiles propios en estado pendiente y actualizar
únicamente su propia fila si la fila resultante conserva ese estado. No pueden
eliminar perfiles según las concesiones y políticas definidas. El esquema no
otorga a usuarios comunes la capacidad de asignar el claim confiable
`app_metadata.role = 'admin'`; la autorización de administrador depende de
ese claim y su asignación debe realizarse fuera del cliente y mediante un
entorno privilegiado.

## Compatibilidad de ejecución

Por inspección estática, el script parece compatible con un proyecto Supabase
nuevo estándar, suponiendo disponibles los roles y esquemas Auth y Storage
habituales de Supabase. No se ejecutó el SQL, así que no se garantiza que
aplique correctamente en el proyecto concreto. La prueba previa de API que
reportó que no existía `public.categories` no equivale a ejecutar ni validar
este archivo.
