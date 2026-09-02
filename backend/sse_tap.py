#!/usr/bin/env python3
"""
AI:GO SSE 탭 — /api/v1/events 의 raw 스트림을 읽어 모든 이벤트(이름 포함)를 그대로 출력/저장.
브라우저 EventSource는 이름을 미리 알아야 듣지만, 여기선 raw 파싱이라 '어떤 이벤트가 존재하는지' 발견용.
사용: python sse_tap.py [초]   (기본 20초)
"""
import os, sys, time, json, os, urllib.request
try: sys.stdout.reconfigure(encoding="utf-8")
except Exception: pass

BASE = os.environ.get("AIGO_BASE", "http://127.0.0.1:8001")   # 기본: 이 컴퓨터의 Backend.AI GO 앱
KEY  = os.environ.get("AIGO_KEY", "")                          # 액세스 키 (없으면 빈 값)
DUR  = float(sys.argv[1]) if len(sys.argv) > 1 else 20

url = f"{BASE}/api/v1/events?k={KEY}"
req = urllib.request.Request(url, headers={"Accept": "text/event-stream", "Cache-Control": "no-cache"})
out_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "dump", "sse_events.jsonl")
os.makedirs(os.path.dirname(out_path), exist_ok=True)

print(f"connecting {url[:60]}... for {DUR}s")
t0 = time.time()
seen = {}
with urllib.request.urlopen(req, timeout=DUR + 5) as r, open(out_path, "a", encoding="utf-8") as f:
    print("status", r.status, "content-type", r.headers.get("content-type"))
    ev, data = None, []
    try:
        while time.time() - t0 < DUR:
            line = r.readline()
            if not line:
                break
            line = line.decode("utf-8", "replace").rstrip("\r\n")
            if line == "":
                if data:
                    payload = "\n".join(data)
                    name = ev or "message"
                    seen[name] = seen.get(name, 0) + 1
                    rec = {"t": round(time.time() - t0, 2), "event": name, "data": payload}
                    f.write(json.dumps(rec, ensure_ascii=False) + "\n")
                    print(f"[{rec['t']:6.2f}s] event={name} data={payload[:200]}")
                ev, data = None, []
            elif line.startswith(":"):
                print(f"[{time.time()-t0:6.2f}s] (comment) {line[:80]}")
            elif line.startswith("event:"):
                ev = line[6:].strip()
            elif line.startswith("data:"):
                data.append(line[5:].strip())
    except Exception as e:
        print("stream ended:", e)
print("\n== 이벤트 이름별 횟수:", seen or "(없음)")
print("== 저장:", out_path)
