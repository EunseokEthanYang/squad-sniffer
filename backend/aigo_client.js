/* =========================================================
   aigo_client.js — AI:GO 서버 읽기 전용 클라이언트 (브라우저/Node 공용, 의존성 0)
   - REST GET: 접근 키(k)를 자동으로 붙여 호출 · POST: 문제 내기(execute) 같은 쓰기
   - SSE 탭: /api/v1/events 를 fetch 스트림으로 raw 파싱 → "모든" named event 수신
     (EventSource는 이벤트 이름을 미리 알아야만 들을 수 있어서 발견용으론 부적합)
   - 스쿼드 한 개의 시각화 필요 데이터를 한 번에 긁는 snapshot()
   사용:
     const c = new AigoClient({ base, key });
     const squads = await c.get('/api/v1/squads');
     const snap = await c.squadSnapshot(squadId);
     const stop = c.tapEvents(ev => console.log(ev.event, ev.data));  // ev = {event, data(json|string), id, t}
   ========================================================= */
class AigoClient {
  constructor({ base = '/aigo', key = '' } = {}) {
    // 기본: 같은 origin의 로컬 프록시(backend/proxy.py)를 경유 → CORS 없음, 키는 프록시가 붙임.
    // 직접 호출하려면 { base: 'https://aigo-web-production.up.railway.app', key: '...' } (CORS 때문에 브라우저에선 실패함)
    this.base = base.replace(/\/$/, '');
    this.key = key;
  }
  url(path) {
    if (!this.key) return `${this.base}${path}`;
    const sep = path.includes('?') ? '&' : '?';
    return `${this.base}${path}${sep}k=${encodeURIComponent(this.key)}`;
  }
  async get(path) {
    const r = await fetch(this.url(path), { headers: { Accept: 'application/json' } });
    if (!r.ok) throw new Error(`GET ${path} -> ${r.status}`);
    const txt = await r.text();
    try { return JSON.parse(txt); } catch { return txt; }
  }
  async safe(path) { try { return { ok: true, data: await this.get(path) }; } catch (e) { return { ok: false, error: String(e) }; } }
  /* 쓰기: 문제 내기(POST squads/{id}/execute) 등 — 우리 스쿼드 엔진(aigo-web)에만 쓴다 */
  async post(path, body) {
    const r = await fetch(this.url(path), { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(body || {}) });
    const txt = await r.text(); let data = txt; try { data = JSON.parse(txt); } catch {}
    if (!r.ok) throw new Error(`POST ${path} -> ${r.status}${data && data.error && data.error.message ? ': ' + data.error.message : ''}`);
    return data;
  }

  /* ---- 전역(스쿼드 무관) 스냅샷: 누가 무슨 모델인지, 서버 상태, 사용량 ---- */
  async globalSnapshot() {
    const paths = {
      squads: '/api/v1/squads',
      templates: '/api/v1/squad-templates',
      taskSummary: '/api/v1/squads/tasks/summary',
      routerStatus: '/api/v1/router/status',          // backends[].models = 실제 서빙 모델 3종
      providers: '/api/v1/providers',
      metrics: '/api/v1/monitoring/metrics',           // cpu/mem/inference.tokensPerSecond
      usage: '/api/v1/stats/usage',                    // totalTokens, modelStats[], dailyStats[]
      statsModels: '/api/v1/stats/models',
      health: '/api/v1/health',
      version: '/api/v1/version',
    };
    const out = {};
    await Promise.all(Object.entries(paths).map(async ([k, p]) => { out[k] = await this.safe(p); }));
    return out;
  }

  /* ---- 스쿼드 1개 스냅샷: 시각화가 먹을 것 전부 ---- */
  async squadSnapshot(sid, { historyLimit = 20, logLimit = 500 } = {}) {
    const s = encodeURIComponent(sid);
    const paths = {
      squad: `/api/v1/squads/${s}`,                             // agents[] (name/role/model/tools)
      readiness: `/api/v1/squads/${s}/readiness`,
      tasks: `/api/v1/squads/${s}/tasks`,
      taskGraph: `/api/v1/squads/${s}/tasks/graph`,             // 태스크 DAG → 노선도/흐름
      budget: `/api/v1/squads/${s}/budget`,                     // 예산 설정 (임계)
      budgetUsage: `/api/v1/squads/${s}/budget/usage`,          // 택시미터
      analytics: `/api/v1/squads/${s}/analytics?period=month`,
      history: `/api/v1/squads/${s}/history?limit=${historyLimit}&offset=0`,  // 실행 이력
      activity: `/api/v1/squads/${s}/activity-log/load?limit=300&offset=0`,   // 활동 로그(핸드오프 후보)
      workspace: `/api/v1/squads/${s}/workspace/status`,
    };
    const out = { squadId: sid };
    await Promise.all(Object.entries(paths).map(async ([k, p]) => { out[k] = await this.safe(p); }));
    // 실행 이력 상세 + 로그
    const hist = out.history.ok ? this._ids(out.history.data) : [];
    out.executions = {};
    await Promise.all(hist.slice(0, 5).map(async eid => {
      const e = encodeURIComponent(eid);
      out.executions[eid] = {
        detail: await this.safe(`/api/v1/squads/${s}/history/${e}`),
        logs: await this.safe(`/api/v1/squads/${s}/history/${e}/logs?limit=${logLimit}`),
      };
    }));
    // 에이전트별 상태/대화
    const agents = out.squad.ok ? (out.squad.data.agents || (out.squad.data.data||{}).agents || []) : [];
    out.agents = {};
    await Promise.all(agents.map(async a => {
      const aid = a.id || a.agentId || a.name; if (!aid) return;
      const ae = encodeURIComponent(aid);
      out.agents[aid] = {
        meta: a,
        status: await this.safe(`/api/v1/squads/${s}/agents/${ae}/status`),
        conversation: await this.safe(`/api/v1/squads/${s}/agents/${ae}/conversation`),
      };
    }));
    return out;
  }
  _ids(d) {
    if (Array.isArray(d)) return d.map(x => x && (x.id || x.executionId || x.execution_id)).filter(Boolean);
    if (d && typeof d === 'object') for (const k of ['executions','history','items','data']) if (Array.isArray(d[k])) return this._ids(d[k]);
    return [];
  }

  /* ---- SSE raw 탭: 모든 이벤트를 이름과 함께 콜백 ---- */
  tapEvents(onEvent, { onState } = {}) {
    const ctrl = new AbortController();
    const t0 = performance.now();
    (async () => {
      let attempt = 0;
      while (!ctrl.signal.aborted) {
        try {
          onState && onState('connecting');
          const r = await fetch(this.url('/api/v1/events'), { headers: { Accept: 'text/event-stream' }, signal: ctrl.signal });
          if (!r.ok || !r.body) throw new Error('SSE ' + r.status);
          onState && onState('connected'); attempt = 0;
          const rd = r.body.getReader(), dec = new TextDecoder();
          let buf = '', ev = null, id = null, data = [];
          for (;;) {
            const { value, done } = await rd.read(); if (done) break;
            buf += dec.decode(value, { stream: true });
            let i;
            while ((i = buf.indexOf('\n')) >= 0) {
              const line = buf.slice(0, i).replace(/\r$/, ''); buf = buf.slice(i + 1);
              if (line === '') {
                if (data.length) {
                  const raw = data.join('\n'); let parsed = raw;
                  try { parsed = JSON.parse(raw); } catch {}
                  onEvent({ event: ev || 'message', id, data: parsed, raw, t: (performance.now() - t0) / 1000 });
                }
                ev = null; id = null; data = [];
              } else if (line.startsWith(':')) { onEvent({ event: ':comment', data: line.slice(1).trim(), t: (performance.now() - t0) / 1000 }); }
              else if (line.startsWith('event:')) ev = line.slice(6).trim();
              else if (line.startsWith('data:')) data.push(line.slice(5).trim());
              else if (line.startsWith('id:')) id = line.slice(3).trim();
            }
          }
        } catch (e) { if (ctrl.signal.aborted) break; }
        onState && onState('disconnected');
        await new Promise(r => setTimeout(r, Math.min(30000, 1000 * 2 ** attempt++)));
      }
    })();
    return () => ctrl.abort();
  }
}
if (typeof module !== 'undefined') module.exports = { AigoClient };
if (typeof window !== 'undefined') window.AigoClient = AigoClient;
