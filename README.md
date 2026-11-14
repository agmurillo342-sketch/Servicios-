# Servicios Locales

Directorio estático de servicios comunitarios en español. Se publica directamente desde los archivos fuente, sin proceso de build. La aplicación usa HTML, CSS y JavaScript ES modules, Supabase (Auth, Postgres y Storage) y Vercel para servir el sitio.

## Desarrollo local

Abre la carpeta raíz del repositorio con VS Code y sirve los archivos con cualquier servidor estático local (por ejemplo, la extensión Live Server). No abras `index.html` directamente como `file://`: los módulos ES y las solicitudes a Supabase requieren un origen HTTP. No hace falta instalar dependencias ni ejecutar un build.

## Configuración de Supabase

1. Crea un proyecto Supabase y abre el SQL Editor.
2. Ejecuta `supabase/schema.sql` con una cuenta propietaria del proyecto. El script crea categorías, perfiles, reportes, políticas RLS, la vista pública y un bucket privado de fotografías. Si el proyecto ya tiene tablas con esos nombres, revisa y adapta el esquema antes de ejecutarlo. Vuelve a ejecutar el esquema para aplicar cambios posteriores a las políticas. En instalaciones previas, el script conserva los objetos y convierte las URLs públicas de fotos reconocidas a rutas. Si encuentra una URL no reconocida, se detiene antes de cambiar el bucket; resuelve esas filas manualmente antes de volver a ejecutar. Para permitir una migración gradual, conserva `photo_url` temporalmente para clientes antiguos y presenta esa columna como `NULL` en la vista pública: el directorio antiguo seguirá cargando, pero mostrará placeholders hasta actualizar el sitio.
3. En Authentication → URL Configuration, configura la URL local y el dominio de producción en Site URL y Redirect URLs.
4. En Authentication → Providers, habilita Google y agrega las credenciales OAuth de Google en Supabase. Configura la URL de callback de Supabase en Google Cloud Console; usa la URL exacta mostrada por el panel de Supabase.
5. La Project URL y la clave pública publishable de este proyecto ya están configuradas en `config.js`. No pongas la clave `service_role`, claves privadas de Google ni secretos en el navegador o Git.
6. La clave publishable es pública por diseño; utilízala junto con las políticas RLS del esquema.
7. Después de aplicar el esquema, despliega la Edge Function con Supabase CLI: `supabase functions deploy profile-photo --remote=<PROJECT_REF>`, y publica el nuevo `app.js`. En `supabase/config.toml`, `verify_jwt = false` es intencional porque las imágenes aprobadas se cargan como `<img>` anónimo; la función solo responde con la imagen después de consultar el estado aprobado en la base de datos. Supabase proporciona automáticamente `SUPABASE_URL` y `SUPABASE_SECRET_KEYS` a la función; la implementación analiza `SUPABASE_SECRET_KEYS` como JSON y selecciona la clave `default`. No configures manualmente `SUPABASE_SERVICE_ROLE_KEY` ni copies credenciales al proyecto. La clave privilegiada debe permanecer únicamente en el entorno de servidor, nunca en `config.js`, HTML, JavaScript del navegador o Git.
8. Revisa las políticas ya existentes en `storage.objects` en proyectos previos. El esquema elimina la política pública que crea esta aplicación y agrega una política restrictiva que impide acceso anónimo o lectura de fotos ajenas, incluso si hay políticas permisivas adicionales.
9. Para fotografías históricas, el esquema migra automáticamente las URLs creadas por la aplicación cuando coinciden con el dominio Supabase y la ruta `service-photos/<id-del-perfil>/<uuid>.(jpg|png|webp)`. No borra objetos ni la columna anterior. Un cliente antiguo que guarde temporalmente una URL reconocible también se convierte a ruta mediante un trigger; el bucket ya privado impide que esa URL vuelva a ser pública. Si el script se detiene por URLs no reconocidas, revisa cada fila y su objeto en Storage desde un entorno administrativo; solo establece `photo_path` con una ruta existente dentro de la carpeta UUID del perfil. Si no puedes verificar que el objeto pertenece a ese perfil, deja `photo_path` vacío y conserva el registro anterior para revisión manual. No hagas público el bucket para resolver errores de migración.

Para ejecutar las pruebas locales de la función: `deno test supabase/functions/profile-photo/index_test.ts`.

## Administrador

La aplicación reconoce exclusivamente el claim `app_metadata.role = "admin"` del token de Supabase. No usa `user_metadata`, que el propio usuario puede modificar, ni muestra el botón para publicar perfiles a usuarios con ese rol. La política RLS también impide que una cuenta administrativa cree perfiles y solo permite que administradores eliminen perfiles y sus fotografías. Los perfiles enviados antes de asignar el rol se conservan y deben revisarse desde otra cuenta administrativa. Asigna el rol desde un entorno confiable y privilegiado (por ejemplo, el editor de usuarios del Dashboard o una función de servidor protegida), no desde el navegador. No publiques ni incluyas una clave `service_role` en el sitio. Después de asignar el claim, el administrador debe cerrar e iniciar sesión para renovar su token. Los administradores acceden al panel mediante el botón «Administración» de la navegación del sitio.

## Publicación con GitHub y Vercel

Conecta el repositorio de GitHub al proyecto de Vercel y configura la raíz del proyecto como raíz de publicación. No hace falta comando de build ni directorio de salida personalizado. Los cambios enviados a la rama conectada se publican automáticamente. `vercel.json` establece URLs limpias, cabeceras de seguridad y una CSP para Supabase, el CDN del módulo y Google Fonts.

El dominio público no está configurado en este repositorio. Cuando se conozca, configura el dominio en Vercel, completa Site URL/Redirect URLs en Supabase, añade una URL canonical y un `sitemap.xml` real, y actualiza `robots.txt` con la URL del sitemap.

## Qué incluye la versión mejorada

- Directorio adaptable a móvil, búsqueda por texto/localidad/categoría con debounce y envío manual, ordenamiento, limpieza de filtros y reporte de perfiles. Solo los perfiles aprobados aparecen en las búsquedas; desde «Mi perfil», cada propietario puede consultar su perfil y editarlo para solicitar una revisión.
- Categorías cargadas de Supabase; formulario accesible para publicar/editar perfiles con validación de datos, mayoría de edad, consentimiento, privacidad de contactos y fotos JPEG/PNG/WebP de hasta 3 MB.
- Perfiles enviados como pendientes de revisión y panel administrativo con permisos basados en `app_metadata`.
- Vista de lectura pública limitada a perfiles aprobados y contactos autorizados, control de acceso mediante RLS, páginas legales y página 404.

## Esquema, seguridad y privacidad

La publicación pública requiere ejecutar `supabase/schema.sql`, desplegar `profile-photo` y revisar las políticas con el asesor de políticas de Supabase. La tabla `profiles` no concede lectura a `anon`; la vista `public_services` expone solo columnas permitidas y enmascara teléfono/WhatsApp cuando el propietario no autorizó mostrarlos. La Edge Function recibe solo un ID de perfil, verifica en servidor que su estado sea `approved` y obtiene la ruta de imagen desde la base de datos, no desde el cliente. Los usuarios autenticados solo editan su perfil; un trigger impide que incluso un administrador apruebe su propio perfil.

El bucket de fotografías es privado. Las cargas quedan limitadas a una ruta propiedad del usuario, y las imágenes públicas se sirven sin caché solo cuando el perfil está aprobado. Las fotos de proveedores que ya estaban guardadas se conservan; el esquema migra las rutas reconocibles sin borrar archivos ni la columna histórica `photo_url`. Si ya se compartieron URLs públicas, no se puede retirar copias o cachés descargadas previamente. La app aplica límites de tipo/tamaño en cliente y Storage; estos controles no sustituyen validaciones ni moderación.

Antes de abrir el sitio al público, completa la identidad y contacto de la persona responsable en el aviso de privacidad, confirma las obligaciones legales y prueba autenticación, RLS, permisos de Storage y publicación de fotos en un proyecto Supabase de prueba. Los términos no implican verificación de proveedores. Los mensajes de error del cliente no incluyen detalles internos de Supabase.
