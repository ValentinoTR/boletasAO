# AO Nexus Boletas · web independiente

Aplicación estática para GitHub Pages, con datos, accesos, PDFs privados y servicio de correo en Supabase. Puede usarse desde el navegador sin entrar a ChatGPT ni instalar Python.

## Publicar

1. Sube los archivos de este proyecto a la raíz de `ValentinoTR/boletasAO`.
2. En GitHub abre **Settings → Pages**. Selecciona **Deploy from a branch**, rama **main**, carpeta **/(root)** y pulsa **Save**.
3. La dirección será `https://valentinotr.github.io/boletasAO/` cuando GitHub termine de publicar.

`index.html` es la entrada. Los archivos de `assets/` y `boletas.html` deben mantenerse juntos. El archivo antiguo `AO-Nexus-Boletas.html` y los iniciadores de Python pueden conservarse como respaldo; la web nueva usa `index.html`.

## Activar el acceso

La configuración pública del sitio ya apunta al proyecto de Supabase `vundymszmdbkhuliglwz`. Las tablas y la función `ao-api` se instalaron en ese proyecto durante la preparación.

El propietario recibe por separado un enlace privado de activación de un solo uso. Al abrirlo, crea una contraseña propia para la web. El administrador será `aonexuspe@gmail.com`. El enlace no se incluye en el repositorio ni en este archivo; vence a los siete días si no se usa.

Después de ingresar, abre **Equipo** para crear la cuenta de tu socio. Cada persona usa su propia contraseña de esta web. Puedes activar o desactivar sus accesos. No se manda ningún correo al crear estas cuentas: comparte los accesos por tu medio habitual.

Si una cuenta olvida su contraseña, la persona que administra el proyecto puede cambiarla desde **Supabase → Authentication → Users**. No hay registro público en esta web.

## Uso

- Completa los datos de la venta. La fecha del borrador usa la hora de Lima.
- **Exportar PDF** guarda la boleta en la nube, le asigna un número único y descarga el documento. También intenta guardar una copia privada del PDF.
- **Historial** muestra las boletas de todo el equipo. Permite buscar, abrir la venta guardada y descargar el PDF. Las boletas emitidas conservan sus datos y su fecha.
- **Nueva boleta** inicia otro borrador. Los borradores se guardan en el navegador y no se consideran emitidos hasta exportar.
- La numeración de B001 empieza en 110. El administrador puede elegir el siguiente número libre desde **Equipo → Numeración de boletas**. No se permiten números anteriores a los ya emitidos en esta web.
- El correo del cliente es opcional. **Enviar también por correo** viene desmarcado. Si el correo falla, el PDF sigue descargado y la boleta permanece en el historial.

## Conectar Gmail una sola vez

Abre [activar-correo.html](activar-correo.html) y completa la conexión desde **Correo de la empresa** dentro del generador. Se utiliza el proyecto de Google Apps Script que ya preparaste con la cuenta de la empresa.

La contraseña normal de Gmail no se usa. La URL de Google y `AO_SECRET` se guardan cifrados en el servidor. Tu socio no verá esa clave ni tendrá que ingresarla. La función de Supabase comprueba la cuenta activa y su rol en cada operación.

## Verificación y mantenimiento

```bash
npm ci
npm run check
npm test
```

Supabase JS está fijado en 2.117.3 y el CLI en 2.120.0. El navegador utiliza una copia local del SDK, así que no depende de un CDN para cargarla.

La clave de `assets/config.js` es pública. El acceso real lo controlan las políticas de base de datos y la sesión de cada persona. Las claves de servidor, el enlace de activación y las claves de Gmail no deben agregarse al repositorio.

Las migraciones se encuentran en `supabase/migrations/`. La función de servidor está en `supabase/functions/ao-api/`. Se valida la sesión dentro de la función porque el proyecto usa claves públicas modernas de Supabase; `verify_jwt=false` no concede acceso a visitantes anónimos. La única operación inicial sin sesión requiere el token privado de activación y solo puede completarse una vez.

El cifrado del correo usa la clave de servidor de Supabase, salvo que configures `AO_ENCRYPTION_KEY` como secreto de la función. Si rotas la clave que cifra una conexión existente, reconecta el correo. Puedes definir `AO_ALLOWED_ORIGINS` con otros orígenes separados por comas si alojas el frontend en un dominio diferente.

La publicación externa y el envío real de Gmail requieren sus respectivos pasos de activación. Las pruebas automáticas usan correos ficticios y no envían mensajes a clientes.
