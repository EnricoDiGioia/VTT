# Servidor local para testar o VTT. Igual ao "python -m http.server",
# mas manda o navegador NUNCA usar arquivos velhos do cache (assim cada
# atualização aparece só com F5).
import http.server
import socketserver
import sys

PORTA = int(sys.argv[1]) if len(sys.argv) > 1 else 8000


class SemCache(http.server.SimpleHTTPRequestHandler):
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map,
                      ".js": "text/javascript", ".webmanifest": "application/manifest+json"}

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, *args):
        pass  # não polui a janela com cada arquivo pedido


class Servidor(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True
    allow_reuse_address = True


with Servidor(("0.0.0.0", PORTA), SemCache) as srv:
    print(f"  Servidor ligado na porta {PORTA}. Deixe esta janela aberta.")
    srv.serve_forever()
