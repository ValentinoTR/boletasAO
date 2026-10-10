#!/usr/bin/env python3
"""AO Nexus: generador local de boletas con envío SMTP opcional.

Solo escucha en 127.0.0.1. No envía ningún correo al iniciar ni al conectar.
Python 3.10 o posterior; utiliza únicamente la biblioteca estándar.
"""
from __future__ import annotations

import argparse
import base64
import binascii
import ctypes
import hashlib
import hmac
import json
import os
import re
import secrets
import smtplib
import socket
import sqlite3
import ssl
import sys
import threading
import time
import webbrowser
from email.message import EmailMessage
from email.utils import formataddr, formatdate, make_msgid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit

APP_DIR = Path(__file__).resolve().parent
HTML_PATH = APP_DIR / 'AO-Nexus-Boletas.html'
MAX_PDF = 10 * 1024 * 1024
MAX_BODY = 15 * 1024 * 1024
EMAIL_RE = re.compile(r'^[^\s<>@,;:]+@[^\s<>@,;:]+\.[^\s<>@,;:]+$')


class AppError(Exception):
    def __init__(self, message, status=400, code='error'):
        super().__init__(message)
        self.status, self.code = status, code


def email_address(value):
    if not isinstance(value, str) or len(value) > 254 or not EMAIL_RE.fullmatch(value.strip()):
        raise AppError('Ingresa una sola dirección de correo válida.')
    return value.strip()


def text_field(value, limit, *, required=False):
    if not isinstance(value, str):
        raise AppError('Hay datos de la boleta que no son válidos.')
    value = value.strip()
    if len(value) > limit or any(ord(ch) < 32 for ch in value) or (required and not value):
        raise AppError('Hay datos de la boleta que no son válidos.')
    return value


def dpapi(data, decrypt=False):
    """Protección de Windows para el usuario actual, sin diálogos ni ámbito global."""
    from ctypes import wintypes

    class Blob(ctypes.Structure):
        _fields_ = [('cbData', wintypes.DWORD), ('pbData', ctypes.POINTER(ctypes.c_ubyte))]

    buffer = (ctypes.c_ubyte * len(data)).from_buffer_copy(data)
    source = Blob(len(data), ctypes.cast(buffer, ctypes.POINTER(ctypes.c_ubyte)))
    output = Blob()
    crypt = ctypes.WinDLL('crypt32', use_last_error=True)
    kernel = ctypes.WinDLL('kernel32', use_last_error=True)
    function = crypt.CryptUnprotectData if decrypt else crypt.CryptProtectData
    description_type = ctypes.POINTER(wintypes.LPWSTR) if decrypt else wintypes.LPCWSTR
    function.argtypes = [ctypes.POINTER(Blob), description_type, ctypes.POINTER(Blob),
                         ctypes.c_void_p, ctypes.c_void_p, wintypes.DWORD, ctypes.POINTER(Blob)]
    function.restype = wintypes.BOOL
    kernel.LocalFree.argtypes = [ctypes.c_void_p]
    kernel.LocalFree.restype = ctypes.c_void_p
    description = None if decrypt else 'AO Nexus Boletas'
    if not function(ctypes.byref(source), description, None, None, None, 1, ctypes.byref(output)):
        raise ctypes.WinError(ctypes.get_last_error())
    try:
        return ctypes.string_at(output.pbData, output.cbData)
    finally:
        kernel.LocalFree(output.pbData)


def private_directory():
    if os.name == 'nt':
        base = Path(os.environ.get('LOCALAPPDATA', str(Path.home() / 'AppData' / 'Local')))
    else:
        base = Path(os.environ.get('XDG_CONFIG_HOME', str(Path.home() / '.config')))
    return base / 'AONexusBoletas'


class MailService:
    def __init__(self, config_dir):
        self.config_dir = config_dir
        config_dir.mkdir(parents=True, exist_ok=True)
        if os.name != 'nt':
            config_dir.chmod(0o700)
        self.config_path = config_dir / 'correo.json'
        self.db_path = config_dir / 'envios.sqlite3'
        self.lock = threading.RLock()
        self.config = None
        self.load_configuration()
        with self.database() as db:
            db.execute('CREATE TABLE IF NOT EXISTS deliveries '
                       '(id TEXT PRIMARY KEY, digest TEXT NOT NULL, status TEXT NOT NULL, '
                       'message_id TEXT NOT NULL, updated REAL NOT NULL)')
            # Un proceso interrumpido puede haber entregado el mensaje: no reenviar a ciegas.
            db.execute("UPDATE deliveries SET status='unknown' WHERE status='pending'")
        if os.name != 'nt':
            self.db_path.chmod(0o600)

    def database(self):
        return sqlite3.connect(self.db_path, timeout=30)

    def load_configuration(self):
        if not self.config_path.exists():
            return
        try:
            config = json.loads(self.config_path.read_text(encoding='utf-8'))
            if config.get('protection') == 'windows-dpapi':
                if os.name != 'nt':
                    return
                config['password'] = dpapi(base64.b64decode(config.pop('secret')), True).decode('utf-8')
            self.config = config
        except (OSError, ValueError, KeyError):
            print('Vuelve a conectar el correo desde Configurar correo. La clave guardada no se pudo recuperar.')

    def status(self):
        cfg = self.config or {}
        return {'configured': bool(cfg), 'sender': cfg.get('sender', 'aonexuspe@gmail.com'),
                'senderName': cfg.get('senderName', 'AO Nexus'), 'provider': cfg.get('provider', 'gmail'),
                'host': cfg.get('host', 'smtp.gmail.com'), 'port': cfg.get('port', 587),
                'security': cfg.get('security', 'starttls'), 'user': cfg.get('user', '')}

    def open_smtp(self, config):
        context = ssl.create_default_context()
        if config['security'] == 'ssl':
            client = smtplib.SMTP_SSL(config['host'], config['port'], timeout=30, context=context)
        else:
            client = smtplib.SMTP(config['host'], config['port'], timeout=30)
            try:
                client.ehlo()
                client.starttls(context=context)
                client.ehlo()
            except Exception:
                client.close()
                raise
        try:
            client.login(config['user'], config['password'])
            return client
        except Exception:
            client.close()
            raise

    def configure(self, payload):
        sender = email_address(payload.get('sender'))
        name = text_field(payload.get('senderName'), 80, required=True)
        provider = payload.get('provider')
        password = payload.get('password')
        if not isinstance(password, str) or not password or len(password) > 256:
            raise AppError('Ingresa la clave del servicio de correo.')
        if provider == 'gmail':
            password = ''.join(password.split())
            if not re.fullmatch(r'[A-Za-z0-9]{16}', password):
                raise AppError('Usa la contraseña de aplicación de Google de 16 caracteres. '
                               'Créala desde el enlace de esta pantalla, con la verificación en dos pasos activada.')
            host, port, security, user = 'smtp.gmail.com', 587, 'starttls', sender
        elif provider == 'smtp':
            host = text_field(payload.get('host'), 253, required=True)
            if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9.-]*', host) or host.startswith('.'):
                raise AppError('Revisa el nombre del servidor SMTP.')
            port, security = payload.get('port'), payload.get('security')
            if type(port) is not int or not 1 <= port <= 65535 or security not in ('ssl', 'starttls'):
                raise AppError('Revisa el puerto y selecciona SSL / TLS o STARTTLS.')
            user = text_field(payload.get('user') or sender, 254, required=True)
        else:
            raise AppError('Selecciona Gmail o un proveedor SMTP.')
        config = {'sender': sender, 'senderName': name, 'provider': provider, 'host': host,
                  'port': port, 'security': security, 'user': user, 'password': password}
        with self.lock:
            try:
                client = self.open_smtp(config)
                try:
                    client.quit()
                except smtplib.SMTPException:
                    client.close()
            except smtplib.SMTPAuthenticationError:
                raise AppError('Gmail no aceptó la clave. Revisa el correo y la contraseña de aplicación. '
                               'Si tu administrador no permite contraseñas de aplicación, necesitas otra conexión autorizada.', 400)
            except (smtplib.SMTPException, OSError, ssl.SSLError):
                raise AppError('No se pudo conectar al servidor de correo. Revisa internet y los datos de la cuenta.', 502)
            stored = dict(config)
            if os.name == 'nt':
                stored['secret'] = base64.b64encode(dpapi(password.encode('utf-8'))).decode('ascii')
                stored.pop('password')
                stored['protection'] = 'windows-dpapi'
            else:
                stored['protection'] = 'local-file-permissions'
            temporary = self.config_dir / ('correo-' + secrets.token_hex(8) + '.tmp')
            try:
                fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
                with os.fdopen(fd, 'w', encoding='utf-8') as file:
                    json.dump(stored, file, ensure_ascii=False)
                os.replace(temporary, self.config_path)
            finally:
                temporary.unlink(missing_ok=True)
            self.config = config
        return self.status()

    def disconnect(self):
        with self.lock:
            self.config_path.unlink(missing_ok=True)
            self.config = None
        return {'disconnected': True}

    def validate_delivery(self, payload):
        recipient = email_address(payload.get('to'))
        request_id = payload.get('requestId')
        if not isinstance(request_id, str) or not re.fullmatch(r'[A-Za-z0-9_-]{12,100}', request_id):
            raise AppError('El identificador de envío no es válido.')
        encoded = payload.get('pdfBase64')
        if not isinstance(encoded, str) or len(encoded) > (MAX_PDF + 2) // 3 * 4:
            raise AppError('El PDF supera el tamaño permitido de 10 MB.')
        try:
            pdf = base64.b64decode(encoded, validate=True)
        except (ValueError, binascii.Error):
            raise AppError('El archivo PDF no es válido.')
        if len(pdf) > MAX_PDF or not pdf.startswith(b'%PDF-'):
            raise AppError('El archivo adjunto debe ser un PDF válido de hasta 10 MB.')
        fields = {'customer': text_field(payload.get('customer'), 110, required=True),
                  'series': text_field(payload.get('series'), 8, required=True),
                  'number': text_field(payload.get('number'), 10, required=True),
                  'date': text_field(payload.get('date'), 10, required=True),
                  'total': text_field(payload.get('total'), 40, required=True)}
        if not re.fullmatch(r'[A-Za-z0-9]{1,8}', fields['series']) or not fields['number'].isdigit():
            raise AppError('La serie o el número de la boleta no son válidos.')
        if not re.fullmatch(r'\d{4}-\d{2}-\d{2}', fields['date']):
            raise AppError('La fecha de la boleta no es válida.')
        filename = text_field(payload.get('filename'), 150, required=True)
        if '/' in filename or '\\' in filename or not filename.lower().endswith('.pdf'):
            raise AppError('El nombre del archivo adjunto no es válido.')
        digest_source = json.dumps({'to': recipient, 'filename': filename, **fields}, sort_keys=True).encode()
        digest = hashlib.sha256(digest_source + b'\0' + pdf).hexdigest()
        return recipient, request_id, fields, filename, pdf, digest

    def send(self, payload):
        recipient, request_id, fields, filename, pdf, digest = self.validate_delivery(payload)
        with self.lock:
            if not self.config:
                raise AppError('Conecta el correo de la empresa antes de enviar.', 409, 'not_configured')
            with self.database() as db:
                row = db.execute('SELECT digest, status, message_id FROM deliveries WHERE id=?', (request_id,)).fetchone()
            if row:
                if row[0] != digest:
                    raise AppError('Este envío corresponde a otra boleta. Exporta nuevamente.', 409)
                if row[1] == 'sent':
                    return {'sent': True, 'duplicate': True, 'to': recipient, 'messageId': row[2]}
                if row[1] in ('unknown', 'pending'):
                    raise AppError('No se pudo confirmar el resultado del envío anterior. '
                                   'Revisa la carpeta Enviados de Gmail antes de exportar de nuevo.', 409, 'delivery_unknown')
            config = dict(self.config)
            message_id = row[2] if row else make_msgid(domain=config['sender'].split('@')[1])
            message = EmailMessage()
            message['From'] = formataddr((config['senderName'], config['sender']))
            message['To'] = recipient
            message['Subject'] = f"Boleta {fields['series']}-{fields['number']} | {config['senderName']}"
            message['Date'] = formatdate(localtime=True)
            message['Message-ID'] = message_id
            date = '/'.join(reversed(fields['date'].split('-')))
            message.set_content(f"Hola, {fields['customer']}:\n\n"
                                f"Adjuntamos tu boleta {fields['series']}-{fields['number']}.\n"
                                f"Fecha: {date}\nImporte total: {fields['total']}\n\n"
                                f"Gracias por tu compra.\n{config['senderName']}\n")
            message.add_attachment(pdf, maintype='application', subtype='pdf', filename=filename)
            try:
                client = self.open_smtp(config)
            except smtplib.SMTPAuthenticationError:
                raise AppError('La cuenta necesita volver a conectarse. Revisa la contraseña de aplicación.', 502, 'authentication')
            except (smtplib.SMTPException, OSError):
                raise AppError('No se pudo conectar a Gmail. Revisa internet y reintenta el envío.', 502, 'connection')
            with self.database() as db:
                db.execute('INSERT OR REPLACE INTO deliveries VALUES (?,?,?,?,?)',
                           (request_id, digest, 'pending', message_id, time.time()))
            try:
                refused = client.send_message(message, from_addr=config['sender'], to_addrs=[recipient])
                if refused:
                    raise smtplib.SMTPRecipientsRefused(refused)
            except (smtplib.SMTPRecipientsRefused, smtplib.SMTPSenderRefused, smtplib.SMTPDataError, smtplib.SMTPHeloError):
                with self.database() as db:
                    db.execute("UPDATE deliveries SET status='failed', updated=? WHERE id=?", (time.time(), request_id))
                raise AppError('El servidor rechazó el correo. Revisa la dirección del cliente y vuelve a intentarlo.', 502, 'rejected')
            except (smtplib.SMTPException, OSError):
                with self.database() as db:
                    db.execute("UPDATE deliveries SET status='unknown', updated=? WHERE id=?", (time.time(), request_id))
                raise AppError('La conexión se cortó y no se pudo confirmar el envío. '
                               'Revisa la carpeta Enviados antes de exportar de nuevo.', 502, 'delivery_unknown')
            else:
                with self.database() as db:
                    db.execute("UPDATE deliveries SET status='sent', updated=? WHERE id=?", (time.time(), request_id))
            finally:
                # El cierre no cambia un envío que el servidor ya aceptó.
                try:
                    client.quit()
                except (smtplib.SMTPException, OSError):
                    client.close()
            return {'sent': True, 'duplicate': False, 'to': recipient, 'messageId': message_id}


class LocalServer(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self, address, service):
        super().__init__(address, Handler)
        self.service = service
        self.token = secrets.token_urlsafe(32)


class Handler(BaseHTTPRequestHandler):
    server_version = 'AO-Nexus'

    def log_message(self, *_args):
        pass  # No imprimir correos, nombres, claves ni contenido de las boletas.

    def allowed_request(self):
        port = self.server.server_address[1]
        hosts = {f'127.0.0.1:{port}', f'localhost:{port}'}
        if self.headers.get('Host') not in hosts:
            raise AppError('Acceso permitido solo desde este equipo.', 403)
        origin = self.headers.get('Origin')
        if origin and origin not in {f'http://{host}' for host in hosts}:
            raise AppError('Esta página no puede usar el servicio de correo.', 403)
        if self.headers.get('Sec-Fetch-Site') not in (None, 'same-origin', 'none'):
            raise AppError('Esta página no puede usar el servicio de correo.', 403)
        if self.command == 'POST':
            if origin not in {f'http://{host}' for host in hosts}:
                raise AppError('Abre el generador desde Iniciar-Boletas.cmd.', 403)
            token = self.headers.get('X-AO-Token', '')
            if not hmac.compare_digest(token, self.server.token):
                raise AppError('La sesión venció. Recarga el generador.', 403)
            if self.headers.get('Content-Type', '').split(';')[0].strip() != 'application/json':
                raise AppError('La solicitud no es válida.', 415)

    def reply(self, code, body, content_type='application/json; charset=utf-8'):
        if not isinstance(body, bytes):
            body = json.dumps(body, ensure_ascii=False).encode('utf-8')
        self.send_response(code)
        self.send_header('Content-Type', content_type)
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('X-Frame-Options', 'DENY')
        self.send_header('Cross-Origin-Resource-Policy', 'same-origin')
        self.end_headers()
        try:
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def do_GET(self):
        try:
            self.allowed_request()
            path = urlsplit(self.path).path
            if path == '/api/email-config':
                self.reply(200, {'token': self.server.token, **self.server.service.status()})
            elif path in ('/', '/AO-Nexus-Boletas.html'):
                self.reply(200, HTML_PATH.read_bytes(), 'text/html; charset=utf-8')
            elif path == '/favicon.ico':
                self.reply(204, b'')
            else:
                self.reply(404, {'error': 'No se encontró esta página.'})
        except AppError as error:
            self.reply(error.status, {'error': str(error), 'code': error.code})
        except OSError:
            self.reply(500, {'error': 'El archivo HTML debe estar en la misma carpeta que el servidor.'})

    def do_POST(self):
        try:
            self.allowed_request()
            try:
                length = int(self.headers.get('Content-Length', '0'))
            except ValueError:
                raise AppError('La solicitud no es válida.')
            if length <= 0 or length > MAX_BODY:
                raise AppError('La solicitud es demasiado grande o está vacía.', 413)
            self.connection.settimeout(30)
            try:
                payload = json.loads(self.rfile.read(length))
            except (ValueError, UnicodeDecodeError, socket.timeout):
                raise AppError('La solicitud no es válida.')
            if not isinstance(payload, dict):
                raise AppError('La solicitud no es válida.')
            path = urlsplit(self.path).path
            if path == '/api/settings':
                result = self.server.service.configure(payload)
            elif path == '/api/disconnect':
                result = self.server.service.disconnect()
            elif path == '/api/send':
                result = self.server.service.send(payload)
            else:
                raise AppError('La operación no existe.', 404)
            self.reply(200, result)
        except AppError as error:
            self.reply(error.status, {'error': str(error), 'code': error.code})
        except Exception:
            # El detalle técnico puede incluir contenido sensible: respuesta deliberadamente acotada.
            self.reply(500, {'error': 'No se pudo completar la operación. Reintenta o vuelve a conectar la cuenta.'})

    def do_OPTIONS(self):
        self.reply(405, {'error': 'Solicitud no permitida.'})


def main():
    parser = argparse.ArgumentParser(description='Boletas AO Nexus con correo opcional')
    parser.add_argument('--port', type=int, default=8765)
    parser.add_argument('--open', action='store_true', help='Abrir el generador en el navegador')
    args = parser.parse_args()
    if not HTML_PATH.is_file():
        print('Extrae todos los archivos del ZIP en una misma carpeta y vuelve a abrir Iniciar-Boletas.cmd.')
        return 1
    try:
        server = LocalServer(('127.0.0.1', args.port), MailService(private_directory()))
    except OSError:
        print('No se pudo iniciar el generador. Si ya está abierto, usa la ventana existente.')
        return 1
    url = f'http://127.0.0.1:{server.server_address[1]}/'
    print(f'AO NEXUS · BOLETAS\n\nAbre {url}\n')
    print('Deja esta ventana abierta mientras envías boletas. Para cerrar, pulsa Ctrl+C.\n')
    if args.open:
        threading.Timer(0.6, lambda: webbrowser.open(url)).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print('\nGenerador cerrado.')
    finally:
        server.server_close()
    return 0


if __name__ == '__main__':
    if sys.version_info < (3, 10):
        print('Se necesita Python 3.10 o posterior. Descárgalo desde https://www.python.org/downloads/')
        sys.exit(1)
    sys.exit(main())
