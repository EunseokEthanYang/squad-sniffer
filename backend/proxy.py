#!/usr/bin/env python3
"""
squad-sniffer 로컬 백엔드 (의존성 0, 표준 라이브러리만)
  1) 정적 서빙: 프로젝트 폴더(index.html, assets, backend/aigo_client.js …)
  2) 리버스 프록시: /aigo/<경로>  →  AI:GO 서버 /<경로>   (접근 키 k 자동 부착, CORS 우회)
     - 일반 JSON 응답은 그대로 중계
     - /aigo/api/v1/events 같은 SSE(text/event-stream)는 청크 단위로 실시간 통과
  3) POST /snap : 캔버스 스냅샷 수신(개발 검증용)
실행:  python backend/proxy.py [port]     (기본 8790)  — 또는 run.bat
브라우저:  http://127.0.0.1:8790/index.html
"""
import sys, os, json, base64, urllib.request, urllib.error, urllib.parse
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler

try: sys.stdout.reconfigure(encoding="utf-8")
except Exception: pass

ROOT  = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))   # squad-sniffer/
BASE  = os.environ.get("AIGO_BASE", "https://aigo-web-production.up.railway.app")
KEY   = os.environ.get("AIGO_KEY",  "aigo-834a73a39c9a0af596c967a1")
PORT  = int(sys.argv[1]) if len(sys.argv) > 1 else 8790   # 8765 는 다른 앱(Fusion360)과 충돌 이력 → 8790
PREFIX = "/aigo/"
SNAP_OUT = os.path.join(ROOT, "backend", "dump", "snapshot.png")

class H(SimpleHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    def __init__(self, *a, **kw): super().__init__(*a, directory=ROOT, **kw)
    def log_message(self, fmt, *a):
        if self.path.startswith(PREFIX): print("[proxy]", fmt % a)

    # ---- 프록시 ----
    def do_GET(self):
        if self.path.startswith(PREFIX): return self.proxy()
        return super().do_GET()
    def do_OPTIONS(self):
        self.send_response(204); self._cors(); self.end_headers()

    def end_headers(self):
        # 정적 파일은 캐시 금지 (개발 중 수정 즉시 반영). 프록시 응답은 그대로.
        if not self.path.startswith(PREFIX):
            self.send_header("Cache-Control", "no-store, max-age=0")
        super().end_headers()

    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")

    def proxy(self):
        path = self.path[len(PREFIX)-1:]                    # "/api/v1/..."
        sep = "&" if "?" in path else "?"
        url = f"{BASE}{path}{sep}k={urllib.parse.quote(KEY)}"
        req = urllib.request.Request(url, headers={
            "Accept": self.headers.get("Accept", "*/*"),
            "Cache-Control": "no-cache",
        })
        try:
            up = urllib.request.urlopen(req, timeout=None if "events" in path else 30)
        except urllib.error.HTTPError as e:
            body = e.read()
            self.send_response(e.code); self._cors()
            self.send_header("Content-Type", e.headers.get("Content-Type", "application/json"))
            self.send_header("Content-Length", str(len(body))); self.end_headers()
            self.wfile.write(body); return
        except Exception as e:
            body = json.dumps({"error": str(e)}).encode()
            self.send_response(502); self._cors()
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body))); self.end_headers()
            self.wfile.write(body); return

        ctype = up.headers.get("Content-Type", "application/octet-stream")
        self.send_response(up.status); self._cors()
        self.send_header("Content-Type", ctype)
        if ctype.startswith("text/event-stream"):
            # SSE: 청크 스트리밍 (chunked transfer), 버퍼링 금지
            self.send_header("Cache-Control", "no-cache")
            self.send_header("X-Accel-Buffering", "no")
            self.send_header("Transfer-Encoding", "chunked")
            self.end_headers()
            try:
                while True:
                    line = up.readline()
                    if not line: break
                    self.wfile.write(f"{len(line):X}\r\n".encode() + line + b"\r\n")
                    self.wfile.flush()
            except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
                pass
            finally:
                try: self.wfile.write(b"0\r\n\r\n"); self.wfile.flush()
                except Exception: pass
                up.close()
        else:
            body = up.read()
            self.send_header("Content-Length", str(len(body))); self.end_headers()
            self.wfile.write(body)

    # ---- 스냅샷 수신(개발용) ----
    def do_POST(self):
        if self.path.startswith("/snap"):
            n = int(self.headers.get("Content-Length", 0))
            body = self.rfile.read(n).decode()
            b64 = body.split(",", 1)[1] if body.startswith("data:") else body
            os.makedirs(os.path.dirname(SNAP_OUT), exist_ok=True)
            with open(SNAP_OUT, "wb") as f: f.write(base64.b64decode(b64))
            self.send_response(200); self._cors()
            self.send_header("Content-Length", "5"); self.end_headers(); self.wfile.write(b"saved"); return
        self.send_response(404); self.end_headers()

if __name__ == "__main__":
    print(f"squad-sniffer backend  http://127.0.0.1:{PORT}/index.html")
    print(f"  static root : {ROOT}")
    print(f"  proxy       : http://127.0.0.1:{PORT}{PREFIX}api/v1/...  ->  {BASE}/api/v1/... (+k)")
    ThreadingHTTPServer(("127.0.0.1", PORT), H).serve_forever()
