#!/usr/bin/env python3
"""
squad-sniffer 로컬 백엔드 (의존성 0, 표준 라이브러리만)
  1) 정적 서빙: 프로젝트 폴더(index.html, assets, backend/aigo_client.js …)
  2) 리버스 프록시: /aigo/<경로>  →  AI:GO 서버 /<경로>   (접근 키 k 자동 부착, CORS 우회)
     - 일반 JSON 응답은 그대로 중계
     - /aigo/api/v1/events 같은 SSE(text/event-stream)는 청크 단위로 실시간 통과
  3) POST /snap : 캔버스 스냅샷 수신(개발 검증용)
실행:  python backend/proxy.py [port]     (기본 8790)  — 또는 ./run.sh
     127.0.0.1:8001 에 관리 API 가 있으면 자동으로 붙는다(헤드리스 aigo-server). 데스크톱 앱 1.12.1 은 그 포트를 열지 않아 미지원.
     다른 서버: AIGO_BASE=https://… AIGO_KEY=… (aigo-web 배포본이면 게이트 토큰, 데스크톱 앱이면 액세스 키)
브라우저:  http://127.0.0.1:8790/index.html
"""
import sys, os, json, base64, urllib.request, urllib.error, urllib.parse
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler

try: sys.stdout.reconfigure(encoding="utf-8")
except Exception: pass

ROOT  = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))   # squad-sniffer/
PORT  = int(sys.argv[1]) if len(sys.argv) > 1 else 8790   # 8765 는 다른 앱(Fusion360)과 충돌 이력 → 8790
PREFIX = "/aigo/"
SNAP_OUT = os.path.join(ROOT, "backend", "dump", "snapshot.png")

# ---- 어느 AI:GO 에 붙을까 ----------------------------------------------------------------
#   AIGO_BASE       Management API 주소. 비우면 이 컴퓨터의 Backend.AI GO 앱(127.0.0.1:8001)을 찾는다
#   AIGO_INFERENCE  OpenAI 호환 추론 주소(/v1). 비우면 데스크톱 앱은 127.0.0.1:39080, 그 밖에는 AIGO_BASE
#   AIGO_KEY        액세스 키. 데스크톱 앱은 API > 액세스 키 에서 만든 값(X-API-Key), aigo-web 배포본은 게이트 토큰
#   AIGO_AUTH       apikey | gate | auto(기본: 127.0.0.1 이면 apikey, 아니면 gate)
LOCAL_APP = "http://127.0.0.1:8001"
LOCAL_INFERENCE = "http://127.0.0.1:39080"

def _alive(url):
    try:
        with urllib.request.urlopen(url, timeout=1.5) as r: return r.status < 500
    except urllib.error.HTTPError as e: return e.code in (401, 403)   # 살아는 있는데 키가 필요한 상태
    except Exception: return False

BASE = os.environ.get("AIGO_BASE", "").rstrip("/")
if not BASE:
    if _alive(LOCAL_APP + "/api/v1/health"): BASE = LOCAL_APP
    else:
        sys.stderr.write(
            "AI:GO 서버를 찾지 못했습니다.\n"
            "  · 데스크톱 앱(1.12.1)은 관리 API를 밖으로 열지 않아 아직 지원하지 않습니다.\n"
            "  · aigo-web 컨테이너:  AIGO_BASE=http://127.0.0.1:1001 ./run.sh\n"
            "  · 배포본·헤드리스:    AIGO_BASE=http://주소[:포트] AIGO_KEY=<키> ./run.sh\n")
        sys.exit(2)
KEY = os.environ.get("AIGO_KEY", "")
AUTH = os.environ.get("AIGO_AUTH", "auto")
if AUTH == "auto": AUTH = "apikey" if BASE.startswith("http://127.0.0.1") or BASE.startswith("http://localhost") else "gate"
INFERENCE = os.environ.get("AIGO_INFERENCE", "").rstrip("/") or (LOCAL_INFERENCE if BASE == LOCAL_APP else BASE)

def auth_headers():
    if not KEY: return {}
    return {"X-API-Key": KEY} if AUTH == "apikey" else {"X-Access-Token": KEY}

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

    def proxy(self, body=None):
        path = self.path[len(PREFIX)-1:]                    # "/api/v1/..." 또는 "/v1/..."
        target = INFERENCE if (path == "/v1" or path.startswith("/v1/")) else BASE
        url = f"{target}{path}"
        headers = {"Accept": self.headers.get("Accept", "*/*"), "Cache-Control": "no-cache"}
        headers.update(auth_headers())
        if body is not None: headers["Content-Type"] = self.headers.get("Content-Type", "application/json")
        req = urllib.request.Request(url, data=body, method=self.command, headers=headers)
        try:
            up = urllib.request.urlopen(req, timeout=None if "events" in path else 300)
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

    def _body(self):
        n = int(self.headers.get("Content-Length", 0) or 0)
        return self.rfile.read(n) if n else b""
    def do_PUT(self):
        if self.path.startswith(PREFIX): return self.proxy(self._body())
        self.send_response(404); self.end_headers()
    def do_DELETE(self):
        if self.path.startswith(PREFIX): return self.proxy(b"")
        self.send_response(404); self.end_headers()

    # ---- POST: 프록시(문제 내기 · 말 걸기) + 스냅샷 수신(개발용) ----
    def do_POST(self):
        if self.path.startswith(PREFIX): return self.proxy(self._body())
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
    print(f"  proxy       : http://127.0.0.1:{PORT}{PREFIX}api/v1/...  ->  {BASE}/api/v1/...  ({'X-API-Key' if AUTH == 'apikey' else 'X-Access-Token'}{'' if KEY else ' 없음'})")
    print(f"  inference   : http://127.0.0.1:{PORT}{PREFIX}v1/...      ->  {INFERENCE}/v1/...")
    if BASE == LOCAL_APP: print("  source      : 이 컴퓨터의 Backend.AI GO 앱 (사이드 앱 모드)")
    ThreadingHTTPServer(("127.0.0.1", PORT), H).serve_forever()
