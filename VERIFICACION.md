# Verificación de la versión independiente

- Las migraciones se aplicaron al proyecto de Supabase `vundymszmdbkhuliglwz`.
- La función `ao-api` está desplegada y activa. Se probaron sus respuestas reales sin sesión: 401 para operaciones privadas y 403 para activación con token inválido.
- La API de datos deniega a visitantes anónimos la lectura de boletas y la consulta de configuración de servidor.
- Pruebas SQL realizadas en una transacción revertida: total en céntimos, numeración compartida, reintento sin duplicar la boleta, historial, rechazo de cantidades inválidas, prohibición de elevar roles, inmutabilidad de los datos emitidos, ausencia de acceso para personas ajenas, bloqueo de sesiones anónimas y miembros desactivados, y activación del administrador mediante el rol de servidor.
- Seis pruebas de JavaScript pasaron: PDF real, conservación de fechas históricas, guardado único, correo opcional, reintentos del mismo envío, manejo de pérdida de confirmación, conservación del borrador ante fallo de conexión, validación del adjunto, cifrado y redirecciones de Google.
- Las dos pruebas del script de Google pasaron. La comprobación de permisos no envía mensajes, el PDF se adjunta y no se reintenta automáticamente un envío de resultado incierto.
- Se generó un PDF de prueba de una página, se extrajo su texto y se revisó su imagen renderizada. Conserva el diseño, las tildes y «CUATROCIENTOS OCHENTA SOLES».
- Las comprobaciones de seguridad de Supabase no devolvieron errores ni advertencias. Las notas informativas corresponden a tablas privadas sin políticas de acceso para clientes. Los índices nuevos aún no tienen uso registrado.

## Alcance pendiente

No se ha publicado esta versión en GitHub: la conexión rechazó la escritura con 403, `Resource not accessible by integration`. Los archivos están preparados para la subida manual. La dirección raíz de GitHub Pages devolvía 404 en la comprobación previa a esta entrega.

La prueba del generador utiliza un DOM simulado y genera el PDF con las bibliotecas reales. No se hizo una prueba visual de navegador ni un ingreso con una cuenta real. El propietario crea su acceso mediante el enlace privado proporcionado por separado.

No se enviaron correos reales. La conexión de Apps Script debe completarla el administrador una sola vez desde la propia web.
