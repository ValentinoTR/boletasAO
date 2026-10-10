# AO Nexus · Boletas con correo opcional

El generador descarga tu boleta en PDF. Si ingresas el correo del cliente y marcas
**Enviar también por correo al exportar el PDF**, envía ese mismo PDF como adjunto
desde **aonexuspe@gmail.com**. Puedes mandar a Gmail, Outlook u otra dirección válida.

## Primer uso en Windows

1. Extrae **todos** los archivos del ZIP en una misma carpeta.
2. Abre **Iniciar-Boletas.cmd**. Si te pide Python, instala Python 3.10 o posterior
   desde <https://www.python.org/downloads/> y marca **Add Python to PATH**.
3. Se abre el generador en tu navegador. Deja abierta la ventana del programa.
4. Pulsa **Configurar correo**. El remitente ya está escrito: aonexuspe@gmail.com.
5. Activa la verificación en dos pasos de esa cuenta y crea una contraseña de
   aplicación para **AO Nexus Boletas** en <https://myaccount.google.com/apppasswords>.
6. Introduce esa contraseña de aplicación de 16 caracteres en la pantalla del generador
   y pulsa **Guardar y conectar**. La comprobación conecta con Gmail, pero no envía
   ningún correo de prueba.

La contraseña normal de Gmail no sirve para esta conexión. No incluyas claves en
el HTML, en mensajes de chat ni en las copias de boletas. La configuración se guarda
en tu equipo; en Windows la clave queda protegida por tu sesión de usuario.
En macOS/Linux el archivo de configuración queda accesible solo para el usuario
propietario. No copies esa configuración al compartir el paquete.

Si Google no muestra la opción de contraseñas de aplicación, revisa los requisitos
de tu cuenta. Algunas cuentas de organización o con Protección Avanzada no permiten
esta opción y necesitan otra conexión autorizada por el administrador.

## Para cada venta

- Completa los datos y productos como siempre. La fecha toma el día de tu equipo.
- Para WhatsApp: deja el envío por correo desmarcado y pulsa **Exportar PDF**.
  Comparte el PDF descargado como lo haces habitualmente.
- Para correo: escribe el correo del cliente, marca la opción de envío y pulsa
  **Exportar y enviar**. El PDF se descarga y se envía con asunto, saludo e importe.
- La pantalla confirma si Gmail aceptó el mensaje. Esa confirmación no garantiza
  que el destinatario lo haya leído ni que su proveedor lo coloque en la bandeja
  principal. Puedes revisar **Enviados** en Gmail.
- Si falla la conexión, el PDF permanece descargado. Usa **Reintentar envío**,
  que conserva el mismo identificador para evitar duplicar un envío ya confirmado.
  Si el resultado es incierto, revisa **Enviados** antes de exportar nuevamente.
- Cada boleta nueva y cada copia recuperada deja la opción de envío desmarcada.
- Para cambiar de cuenta o quitarla, usa **Configurar correo → Desconectar**.

## Archivos y funcionamiento

- **AO-Nexus-Boletas.html**: generador; exporta PDF incluso abriéndolo directamente.
- **servidor_correo.py**: conexión local de correo con adjunto PDF.
- **Iniciar-Boletas.cmd**: inicio en Windows.
- **Iniciar-Boletas.sh**: inicio en macOS/Linux (`sh Iniciar-Boletas.sh`).

El envío automático necesita que el programa local esté abierto y que haya
internet. Abrir solamente el HTML sigue permitiendo exportar PDF; para enviar
correo usa el archivo de inicio. No necesita instalar bibliotecas adicionales.
El servicio solo atiende en este equipo, no publica tu generador en internet.

Si ya tienes un borrador en el HTML anterior, usa **Guardar copia** allí y
**Abrir copia** en el nuevo generador para recuperarlo.

## Referencias de configuración

- Contraseñas de aplicación de Google: <https://support.google.com/accounts/answer/185833?hl=es>
- Verificación en dos pasos: <https://support.google.com/accounts/answer/185839?hl=es>
- Servidor de envío Gmail: <https://developers.google.com/workspace/gmail/imap/imap-smtp>

Esta versión no tiene ninguna contraseña ni cuenta conectada dentro del paquete.
El generador conserva su funcionamiento de PDF y no está conectado a SUNAT.
