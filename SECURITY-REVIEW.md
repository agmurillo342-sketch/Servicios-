# Auditoría de aprobación y publicación de perfiles

Este documento presenta una auditoría estática del flujo de aprobación,
publicación y fotografías de Servicios Locales. Posteriormente, se verificó
el estado remoto de Supabase y el despliegue de la Edge Function
`profile-photo`. La función se probó exitosamente con una fotografía JPEG de
un perfil aprobado. Estas comprobaciones no constituyen una auditoría integral
de seguridad ni abarcan aspectos que no se verificaron.

## Estado del hallazgo

| # | Estado | Archivo | Hallazgo | Confianza |
|---|---|---|---|---|
| 1 | CORREGIDO EN EL ESQUEMA | `supabase/schema.sql` | El propietario no puede aprobar su propio perfil. Si modifica campos públicos de un perfil aprobado, el trigger lo devuelve a `pending`; la aprobación posterior corresponde a un administrador. | Alta |

## Administración y aprobaciones

- `app.js` identifica administradores con `currentUser.app_metadata.role` y
  expone el panel mediante `openAdmin()`.
- `openAdmin()` consulta perfiles con `status = 'pending'` y excluye el perfil
  del administrador actual.
- `reviewProfile()` permite aprobar o rechazar perfiles ajenos. La interfaz
  bloquea la autoaprobación y el trigger de base de datos impide cambiar el
  estado del perfil propio, incluso mediante una llamada directa a la API.
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
anterior o nuevo. Esto impide que un propietario, incluso si es administrador,
apruebe su propio perfil. Solo un administrador puede cambiar el estado de
perfiles ajenos, sujeto a RLS.

Cuando el propietario modifica campos públicos de un perfil `approved`, el
trigger cambia automáticamente su estado a `pending`. El perfil deja de
aparecer en el directorio público hasta que un administrador lo apruebe de
nuevo. Esta transición se aplica en la base de datos, no depende solo de la
interfaz.

## Hallazgos anteriores y estado actual

Una auditoría anterior encontró lectura pública del bucket de fotografías,
incluidas fotos de perfiles no aprobados. Ese hallazgo corresponde al estado
anterior y no describe la configuración actual. El esquema corregido se aplicó
en Supabase; las verificaciones remotas confirmaron, para el caso probado, la
entrega de una foto de perfil aprobado mediante `profile-photo`. No se
verificaron individualmente todas las políticas ni todos los estados de perfil.

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
guarda `photo_path`; la Edge Function `profile-photo` está desplegada. Una
petición GET remota para una fotografía de un perfil aprobado respondió HTTP
200 con `Content-Type: image/jpeg` y 47.464 bytes; la firma y la decodificación
JPEG fueron válidas. Esto confirma el caso probado, no una auditoría integral
de producción ni el acceso para perfiles pendientes o rechazados.

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

### Realizadas

1. `deno test supabase/functions/profile-photo/index_test.ts`: 7 pruebas
   pasaron y 0 fallaron.
2. Una petición a `profile-photo` con un ID malformado respondió HTTP 400.
3. Una petición GET remota para la foto de un perfil aprobado respondió HTTP
   200 con una imagen JPEG válida de 47.464 bytes.

### Pendientes

1. Como propietario, actualizar un campo público de un perfil aprobado;
   verificar que el trigger lo devuelva a `pending`, que deje de aparecer en
   la vista y que solo vuelva a publicarse después de la aprobación de un
   administrador.
2. Como propietario, intentar cambiar su propio `status` a `approved`,
   `rejected` y `pending`, incluso mediante llamadas directas a la API; el
   trigger debe rechazar los cambios.
3. Como administrador, aprobar y rechazar perfiles ajenos desde la interfaz y
   mediante la API; confirmar que cambiar el estado del perfil propio falla.
4. Consultar `public.public_services` como usuario anónimo con perfiles en los
   tres estados y confirmar que solo aparecen los aprobados y los campos de
   contacto autorizados.
5. Probar la lectura de fotos de perfiles pendientes y rechazados, y los
   accesos como propietario y visitante para esos estados.

## Límites de la auditoría

No se ejecutó SQL durante esta revisión. Se verificaron el despliegue de
`profile-photo` y una respuesta exitosa para una foto aprobada, pero no se
realizó una auditoría integral de producción ni se comprobaron todas las
políticas RLS, los triggers o la matriz de acceso. La prueba previa de API que
reportó que no existía `public.categories` tampoco equivale a ejecutar o
validar el esquema actual.
