# Auditoría de aprobación y publicación de perfiles

Auditoría estática del flujo de aprobación, publicación y fotografías de
Servicios Locales. No se ejecutó SQL ni se verificó el estado remoto de
Supabase o de la Edge Function.

## Hallazgo identificado

| # | Severidad | Archivo y líneas | Hallazgo | Confianza |
|---|---|---|---|---|
| 1 | MEDIA | `supabase/schema.sql:146-149` | El propietario de un perfil `approved` puede modificar campos públicos manteniendo `status = 'approved'`. RLS permite ese resultado y el trigger solo bloquea cambios de estado; por tanto, la modificación puede publicarse sin una nueva revisión. | 9/10 |

## Administración y aprobaciones

- `app.js` identifica administradores con `currentUser.app_metadata.role` y
  expone el panel mediante `openAdmin()`.
- `openAdmin()` consulta perfiles con `status = 'pending'` y excluye el perfil
  del administrador actual.
- `reviewProfile()` permite aprobar o rechazar perfiles ajenos. La interfaz
  bloquea la autoaprobación, pero esta comprobación de cliente es adicional;
  la protección real debe residir en la base de datos.
- El claim confiable `app_metadata.role` debe asignarse desde un entorno
  privilegiado, nunca desde datos editables por el usuario.

## RLS y protección del estado

El esquema activa RLS sobre `profiles`. La política permite leer el perfil
propio o perfiles a un administrador; insertar el propio perfil solo como
`pending`; y permite a los administradores actualizar perfiles. Para
propietarios permite que la fila resultante conserve el estado `pending` o
`approved`.

`public.prevent_profile_self_approval()` se ejecuta cuando cambia `status` y
rechaza la modificación si el usuario autenticado es propietario del perfil
anterior o nuevo. Esto impide que un usuario, incluido un administrador,
cambie el estado de su propio perfil. Los administradores pueden cambiar el
estado de perfiles ajenos mediante la API, sujeto a RLS.

**Riesgo pendiente:** un propietario puede editar el contenido de un perfil
aprobado y conservar `approved`. El trigger no bloquea esta operación porque
el estado no cambia. Los cambios se reflejan inmediatamente en el directorio
público. Debe definirse una transición a revisión para que los cambios a
campos publicados no aparezcan antes de una nueva aprobación.

## Hallazgos anteriores y estado actual

Una auditoría anterior encontró lectura pública del bucket de fotografías,
incluidas fotos de perfiles no aprobados. El esquema actual del repositorio
configura el bucket como privado y la función `profile-photo` sirve las fotos
de perfiles aprobados; no se verificó que estas correcciones estén aplicadas
o desplegadas en el proyecto remoto.

También se revisó el riesgo de autoaprobación por parte de un administrador
que fuera propietario de un perfil. La interfaz excluye el perfil propio y
`prevent_profile_self_approval()` bloquea cambios de estado del propietario
en la base de datos. No se encontró una vía de autoaprobación en el código
auditado.

## Directorio público

El directorio consulta `public.public_services`, una vista que incluye solo
perfiles con `status = 'approved'`. Los perfiles `pending` y `rejected` quedan
excluidos. La vista expone una selección limitada de columnas; teléfono y
WhatsApp se incluyen solo si `show_phone` y `show_whatsapp` están habilitados.

## Fotografías

El esquema configura `service-photos` como bucket privado y limita las
operaciones de escritura a la carpeta del usuario autenticado. La aplicación
guarda `photo_path`; el código local de `profile-photo` sirve fotos asociadas
a perfiles aprobados. Esta auditoría no confirma si el esquema fue aplicado,
si la función está desplegada ni si su configuración de producción permite
servir las fotografías.

## Otros permisos y datos

- `public.categories`: lectura pública de categorías activas; los
  administradores también pueden leer categorías inactivas.
- `public.reports`: usuarios autenticados solo pueden insertar reportes donde
  `reporter_id` coincide con `auth.uid()`; no se define una política de
  lectura.
- Los visitantes anónimos consultan la vista pública, no la tabla de perfiles.
- Las fotos dependen de que el bucket sea privado y la función Edge esté
  desplegada y configurada correctamente.
- El esquema no otorga a usuarios comunes la capacidad de asignar
  `app_metadata.role = 'admin'`.

## Pruebas recomendadas

1. Como propietario, actualizar un campo público de un perfil aprobado sin
   cambiar `status`; verificar si la vista refleja el cambio antes de una
   nueva aprobación.
2. Como propietario, intentar cambiar su propio `status` a `approved`,
   `rejected` y `pending`, incluso mediante llamadas directas a la API; el
   trigger debe rechazar los cambios.
3. Como administrador, aprobar y rechazar perfiles ajenos desde la interfaz y
   mediante la API; confirmar que cambiar el estado del perfil propio falla.
4. Consultar `public.public_services` como usuario anónimo con perfiles en los
   tres estados y confirmar que solo aparecen los aprobados y los campos de
   contacto autorizados.
5. En el proyecto Supabase desplegado, verificar el estado de
   `profile-photo` y probar lectura sin sesión, como propietario y como
   visitante para perfiles aprobados, pendientes y rechazados.

## Límites de la auditoría

No se ejecutó SQL ni se verificó el proyecto desplegado. La existencia de la
Edge Function en el repositorio no demuestra que esté desplegada o
configurada. La prueba previa de API que reportó que no existía
`public.categories` tampoco equivale a ejecutar o validar el esquema actual.
