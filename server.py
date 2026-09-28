#!/usr/bin/env python3
"""
Servidor Local y Lanzador para Gestor de Ventas e Inventario (iOS / Mobile PWA)

- Detecta automáticamente tu IP local en la red Wi-Fi
- Genera y muestra un código QR en la consola para escanear con la cámara del iPhone
- Abre el navegador web en el ordenador para pruebas inmediatas
- Sirve los archivos locales con soporte completo para PWA, Service Worker y ES Modules
"""

import sys
import os
import socket
import webbrowser
from http.server import HTTPServer, SimpleHTTPRequestHandler

# Asegurar codificación UTF-8 en consola de Windows
if sys.platform.startswith('win'):
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except Exception:
        pass

def get_local_ip():
    """Detecta la dirección IP de este ordenador en la red Wi-Fi local."""
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        # No envía datos reales, solo conecta para determinar la interfaz de red local
        s.connect(('8.8.8.8', 80))
        ip = s.getsockname()[0]
    except Exception:
        ip = '127.0.0.1'
    finally:
        s.close()
    return ip

class PWAServerHandler(SimpleHTTPRequestHandler):
    """Manejador HTTP con soporte MIME adecuado para PWA y módulos ES6."""
    
    def end_headers(self):
        # Evitar problemas de caché durante el desarrollo y habilitar CORS
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Cache-Control', 'no-cache, must-revalidate')
        super().end_headers()

    def guess_type(self, path):
        # Asegurar tipo MIME para módulos JavaScript modernos
        if path.endswith('.js'):
            return 'application/javascript'
        if path.endswith('.json') or path.endswith('.webmanifest'):
            return 'application/json'
        if path.endswith('.css'):
            return 'text/css'
        return super().guess_type(path)

def print_banner(ip, port):
    local_url = f"http://localhost:{port}"
    lan_url = f"http://{ip}:{port}"

    print("\n" + "=" * 62)
    print(" 🚀  GESTOR DE INVENTARIO Y VENTAS - SERVIDOR LOCAL iOS")
    print("=" * 62)
    print(f" 💻 En este ordenador: {local_url}")
    print(f" 📱 En tu iPhone:     {lan_url}")
    print("-" * 62)
    print(" PASOS PARA ABRIRLO EN TU IPHONE:")
    print(" 1. Conecta tu iPhone a la MISMA RED WI-FI que este PC.")
    print(" 2. Abre la app 'Cámara' en tu iPhone y apunta al código QR:")
    print("-" * 62)

    try:
        import qrcode
        qr = qrcode.QRCode(box_size=1, border=2)
        qr.add_data(lan_url)
        qr.print_ascii(invert=True)
    except Exception as e:
        print(f" (QR opcional no disponible: {e})")
        print(f" Simplemente escribe en Safari de tu iPhone: {lan_url}")

    print("-" * 62)
    print(" 3. En Safari, pulsa el botón Compartir (cuadrado con flecha)")
    print("    y selecciona: 'Añadir a la pantalla de inicio'.")
    print(" 4. ¡Listo! Se abrirá como una App nativa sin barras de Safari.")
    print("=" * 62)
    print(" Presiona Ctrl + C en esta ventana para detener el servidor.\n")

def run(port=8000):
    # Cambiar al directorio del script
    current_dir = os.path.dirname(os.path.abspath(__file__))
    os.chdir(current_dir)

    ip = get_local_ip()

    # Probar puertos si el 8000 está ocupado
    for p in [port, 8080, 8081, 8888, 3000]:
        try:
            server = HTTPServer(('0.0.0.0', p), PWAServerHandler)
            port = p
            break
        except OSError:
            continue
    else:
        print("Error: No se pudo enlazar ningún puerto disponible.")
        sys.exit(1)

    print_banner(ip, port)

    # Abrir navegador en el PC automáticamente
    try:
        webbrowser.open(f"http://localhost:{port}")
    except Exception:
        pass

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nServidor detenido. ¡Hasta pronto!")
        server.server_close()

if __name__ == '__main__':
    run()
