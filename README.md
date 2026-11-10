# Servicios Locales

Directorio estático de servicios comunitarios en español. Se publica directamente desde los archivos fuente, sin proceso de build. La aplicación usa HTML, CSS y JavaScript ES modules, Supabase (Auth, Postgres y Storage) y Vercel para servir el sitio.

## Desarrollo local

Abre la carpeta raíz del repositorio con VS Code y sirve los archivos con cualquier servidor estático local (por ejemplo, la extensión Live Server). No abras `index.html` directamente como `file://`: los módulos ES y las solicitudes a Supabase requieren un origen HTTP. No hace falta instalar dependencias ni ejecutar un build.

## Configuración de Supabase

1. Crea un proyecto Supabase y abre el SQL Editor.
2. Ejecuta `supabase/schema.sql` con una cuenta propietaria del proyecto. El script crea categorías, perfiles, reportes, políticas RLS, la vista pública segura y el bucket de fotografías. Si el proyecto ya tiene tablas con esos nombres, revisa y adapta el esquema antes de ejecutarlo.
3. En Authentication → URL Configuration, agrega la URL local y el dominio de producción a Site URL y Redirect URLs.
4. En Authentication → Providers, habilita Google y agrega las credenciales OAuth de Google en Supabase. Configura la URL de callback de Supabase en Google Cloud Console; usa la URL exacta mostrada por el panel de Supabase.
5. Copia la Project URL y la clave pública `anon`/publishable a `config.js` en `SUPABASE_URL` y `SUPABASE_ANON_KEY`. No pongas la clave `service_role`, claves privadas de Google ni secretos en el navegador o Git.
6. La app queda en modo de configuración pendiente hasta que se sustituyan `TU_PROYECTO` y `TU_CLAVE`. La clave `anon` es pública por diseño; solo debe utilizarse junto con las políticas RLS del esquema.

## Administrador

La aplicación reconoce exclusivamente el claim `app_metadata.role = "admin"` del token de Supabase. No usa `user_metadata`, que el propio usuario puede modificar, ni expone un enlace público al panel. Asigna el rol desde un entorno confiable y privilegiado (por ejemplo, el editor de usuarios del Dashboard o una función de servidor protegida), no desde el navegador. No publiques ni incluyas una clave `service_role` en el sitio. Después de asignar el claim, el administrador debe cerrar e iniciar sesión para renovar su token. El panel se abre desde la consola del navegador con `window.openServicesAdmin()`.

## Publicación con GitHub y Vercel

Conecta el repositorio de GitHub al proyecto de Vercel y configura la raíz del proyecto como raíz de publicación. No hace falta comando de build ni directorio de salida personalizado. Los cambios enviados a la rama conectada se publican automáticamente. `vercel.json` establece URLs limpias, cabeceras de seguridad y una CSP para Supabase, el CDN del módulo y Google Fonts.

El dominio público no está configurado en este repositorio. Cuando se conozca, configura el dominio en Vercel, completa Site URL/Redirect URLs en Supabase, añade una URL canonical y un `sitemap.xml` real, y actualiza `robots.txt` con la URL del sitemap.

## Qué incluye la versión mejorada

- Directorio adaptable a móvil, búsqueda por texto/localidad/categoría con debounce y envío manual, ordenamiento, limpieza de filtros y reporte de perfiles.
- Categorías cargadas de Supabase; formulario accesible para publicar/editar perfiles con validación de datos, mayoría de edad, consentimiento, privacidad de contactos y fotos JPEG/PNG/WebP de hasta 3 MB.
- Perfiles enviados como pendientes de revisión y panel administrativo con permisos basados en `app_metadata`.
- Vista de lectura pública limitada a perfiles aprobados y contactos autorizados, control de acceso mediante RLS, páginas legales y página 404.

## Esquema, seguridad y privacidad

La publicación pública requiere ejecutar `supabase/schema.sql` y revisar sus políticas con el asesor de políticas de Supabase. La tabla `profiles` no concede lectura a `anon`; la vista `public_services` expone solo columnas permitidas y enmascara teléfono/WhatsApp cuando el propietario no autorizó mostrarlos. Los usuarios autenticados solo editan su perfil y los administradores se validan mediante `app_metadata.role`.

El bucket de fotografías es público para permitir mostrar las imágenes directamente en el sitio; por ello, un archivo cargado puede ser accesible mediante su enlace aun si el perfil está pendiente o se rechaza. Las cargas quedan limitadas a una ruta propiedad del usuario. La app aplica límites de tipo/tamaño en cliente, pero estos controles no sustituyen validaciones del lado del servidor ni moderación.

Antes de abrir el sitio al público, completa la identidad y contacto de la persona responsable en el aviso de privacidad, confirma las obligaciones legales y prueba autenticación, RLS, permisos de Storage y publicación de fotos en un proyecto Supabase de prueba. Los términos no implican verificación de proveedores. Los mensajes de error del cliente no incluyen detalles internos de Supabase.
