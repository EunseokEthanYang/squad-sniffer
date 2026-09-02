#!/usr/bin/env python3
"""
AI:GO 백엔드 데이터 전수 수집기 (읽기 전용).
- 서버에 쓰기(스쿼드 생성/실행) 없음. GET만 호출.
- 전역 엔드포인트를 먼저 긁고, 스쿼드가 있으면 스쿼드별 하위 리소스까지 재귀적으로 덤프.
- 결과: backend/dump/<타임스탬프>/*.json  +  catalog.json (무엇을 얼마나 가져왔는지 요약)

사용:  python dump_all.py
설정은 아래 BASE / KEY 변경.
"""
import os, json, os, sys, time, urllib.request, urllib.error, urllib.parse
try: sys.stdout.reconfigure(encoding="utf-8")
except Exception: pass

BASE = os.environ.get("AIGO_BASE", "http://127.0.0.1:8001")   # 기본: 이 컴퓨터의 Backend.AI GO 앱
KEY  = os.environ.get("AIGO_KEY", "")                          # 액세스 키 (없으면 빈 값)

# ---- 전역 읽기 전용 엔드포인트 (스쿼드 시각화에 유효한 것 위주로 선별) ----
GLOBAL_GETS = [
    # 스쿼드 구조
    "/api/v1/squads",
    "/api/v1/squad-templates",
    "/api/v1/squads/tasks/summary",
    "/api/v1/agent-profiles",
    # 전역 모니터링/비용
    "/api/v1/monitoring/metrics",
    "/api/v1/monitoring/inference-stats",
    "/api/v1/monitoring/status",
    "/api/v1/stats/usage",
    "/api/v1/stats/models",
    "/api/v1/stats/router?window=1h",
    "/api/v1/router/health",
    "/api/v1/router/status",
    "/api/v1/router/config",
    "/api/v1/router/capabilities",
    # 모델/엔진 (누가 무슨 모델인지)
    "/api/v1/models",
    "/api/v1/loaded",
    "/api/v1/engines",
    "/api/v1/providers",
    "/api/v1/pool/status",
    "/api/v1/pool/coordinator",
    # 도구/시스템
    "/api/v1/tools",
    "/api/v1/mcp/tools",
    "/api/v1/system/info",
    "/api/v1/system/metrics",
    "/api/v1/storage/usage",
    "/api/v1/limits/usage",
    "/api/v1/health",
    "/api/v1/version",
]

# ---- 스쿼드 하나당 긁을 하위 리소스 (%s = squadId) ----
SQUAD_GETS = [
    "/api/v1/squads/%s",
    "/api/v1/squads/%s/readiness",
    "/api/v1/squads/%s/tasks",
    "/api/v1/squads/%s/tasks/graph",
    "/api/v1/squads/%s/budget",
    "/api/v1/squads/%s/budget/usage",
    "/api/v1/squads/%s/analytics?period=month",
    "/api/v1/squads/%s/history?limit=50&offset=0",
    "/api/v1/squads/%s/activity-log/load?limit=200&offset=0",
    "/api/v1/squads/%s/workspace/status",
    "/api/v1/squads/%s/workspace/files",
]

# ---- 실행 이력 하나당 (%(sid)s, %(eid)s) ----
EXEC_GETS = [
    "/api/v1/squads/%(sid)s/history/%(eid)s",
    "/api/v1/squads/%(sid)s/history/%(eid)s/logs?limit=500",
]

# ---- 에이전트 하나당 (%(sid)s, %(aid)s) ----
AGENT_GETS = [
    "/api/v1/squads/%(sid)s/agents/%(aid)s/status",
    "/api/v1/squads/%(sid)s/agents/%(aid)s/conversation",
    "/api/v1/squads/%(sid)s/agents/%(aid)s/sessions",
    "/api/v1/squads/%(sid)s/memory/%(aid)s",
]


def add_key(path):
    sep = "&" if "?" in path else "?"
    return f"{BASE}{path}{sep}k={urllib.parse.quote(KEY)}"


def get(path, timeout=25):
    url = add_key(path)
    req = urllib.request.Request(url, headers={"Accept": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            raw = r.read().decode("utf-8", "replace")
            try:
                return {"ok": True, "status": r.status, "path": path, "data": json.loads(raw)}
            except json.JSONDecodeError:
                return {"ok": True, "status": r.status, "path": path, "data_text": raw[:5000], "note": "non-json"}
    except urllib.error.HTTPError as e:
        body = ""
        try:
            body = e.read().decode("utf-8", "replace")[:400]
        except Exception:
            pass
        return {"ok": False, "status": e.code, "path": path, "error": body}
    except Exception as e:
        return {"ok": False, "status": None, "path": path, "error": str(e)}


def slug(path):
    s = path.split("?")[0].strip("/").replace("/api/v1/", "").replace("/", "__")
    q = path.split("?")[1] if "?" in path else ""
    if q:
        s += "__" + q.replace("=", "-").replace("&", "_")
    return s[:150] + ".json"


def find_ids(data):
    """스쿼드/에이전트/실행 응답에서 id들을 최대한 뽑아낸다."""
    ids = []
    if isinstance(data, list):
        for item in data:
            if isinstance(item, dict):
                for k in ("id", "squadId", "squad_id"):
                    if k in item:
                        ids.append(item[k]); break
    elif isinstance(data, dict):
        for key in ("squads", "items", "executions", "history", "agents", "tasks", "data"):
            if key in data and isinstance(data[key], list):
                ids += find_ids(data[key])
    return ids


def agents_of(squad_obj):
    if not isinstance(squad_obj, dict):
        return []
    ags = squad_obj.get("agents") or (squad_obj.get("data", {}) or {}).get("agents") or []
    out = []
    for a in ags:
        if isinstance(a, dict):
            out.append(a.get("id") or a.get("agentId") or a.get("name"))
    return [a for a in out if a]


def main():
    stamp = time.strftime("%Y%m%d-%H%M%S")
    root = os.path.join(os.path.dirname(os.path.abspath(__file__)), "dump", stamp)
    os.makedirs(root, exist_ok=True)
    catalog = {"base": BASE, "stamp": stamp, "results": []}

    def save(res):
        fn = slug(res["path"])
        with open(os.path.join(root, fn), "w", encoding="utf-8") as f:
            json.dump(res, f, ensure_ascii=False, indent=2)
        size = len(json.dumps(res.get("data", res.get("data_text", "")), ensure_ascii=False))
        catalog["results"].append({
            "path": res["path"], "ok": res["ok"], "status": res["status"],
            "file": fn, "bytes": size,
            "sample": (json.dumps(res.get("data"), ensure_ascii=False)[:180] if res.get("ok") else res.get("error", "")[:180]),
        })
        flag = "OK " if res["ok"] else "ERR"
        print(f"  [{flag} {res['status']}] {res['path']}  ({size}B)")

    print(f"== 전역 엔드포인트 {len(GLOBAL_GETS)}개 ==")
    squads_data = None
    for p in GLOBAL_GETS:
        res = get(p)
        save(res)
        if p == "/api/v1/squads" and res.get("ok"):
            squads_data = res["data"]

    squad_ids = find_ids(squads_data) if squads_data is not None else []
    print(f"\n== 발견된 스쿼드: {len(squad_ids)}개 {squad_ids} ==")

    for sid in squad_ids:
        print(f"\n-- 스쿼드 {sid} --")
        squad_obj = None
        for tpl in SQUAD_GETS:
            res = get(tpl % sid)
            save(res)
            if tpl == "/api/v1/squads/%s" and res.get("ok"):
                squad_obj = res["data"]
            if tpl.endswith("/history?limit=50&offset=0") and res.get("ok"):
                for eid in find_ids(res["data"])[:10]:
                    for etpl in EXEC_GETS:
                        save(get(etpl % {"sid": sid, "eid": eid}))
        for aid in agents_of(squad_obj):
            print(f"   에이전트 {aid}")
            for atpl in AGENT_GETS:
                save(get(atpl % {"sid": sid, "aid": aid}))

    with open(os.path.join(root, "catalog.json"), "w", encoding="utf-8") as f:
        json.dump(catalog, f, ensure_ascii=False, indent=2)

    ok = sum(1 for r in catalog["results"] if r["ok"])
    print(f"\n== 완료: {ok}/{len(catalog['results'])} 성공. 저장 위치: {root}")
    print(f"   카탈로그: {os.path.join(root, 'catalog.json')}")


if __name__ == "__main__":
    main()
