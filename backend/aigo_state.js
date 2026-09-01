/* =========================================================
   aigo_state.js — AI:GO 데이터의 "상위 변수" 레이어 (정규화 스토어)
   ---------------------------------------------------------
   시각화는 이 파일의 AIGO.state.* 만 본다. 서버 응답 형태가 바뀌면 아래 ADAPT.* 만 고친다.
   의존: aigo_client.js (AigoClient) 를 먼저 로드.

   사용:
     <script src="backend/aigo_client.js"></script>
     <script src="backend/aigo_state.js"></script>
     AIGO.configure({ squadId: null })            // null이면 첫 스쿼드 자동 선택
     AIGO.on((s, what) => render(s))              // 변경될 때마다 콜백 (s === AIGO.state)
     AIGO.start({ pollMs: 5000, fastMs: 1500 })   // REST 폴링 + SSE 구독 시작
     AIGO.state.agents[0].label / .rate / .tokens / .weightedTokens ...
   ========================================================= */
(function (global) {
  'use strict';

  /* ---------- 단가표: 모델 ID → 배수 (팀 규칙. configure({rates}) 로 덮어쓰기 가능) ---------- */
  const RATES_DEFAULT = {
    'furiosa-ai/Qwen3-32B-FP8': 1,
    'furiosa-ai/gpt-oss-120b': 2,
    'furiosa-ai/K-EXAONE-236B-A23B-NVFP4A16': 3,
  };
  const ROLE_LABEL_BY_RATE = { 1: '후배', 2: '선배', 3: '선생님' };

  /* ---------- 상위 변수 (여기 적힌 키가 시각화가 믿어도 되는 계약) ---------- */
  const state = {
    server:  { ok: false, status: null, version: null, routerHealthy: null, models: [], providers: [], components: {} },
    squad:   { id: null, name: null, description: null, status: null, plannerAgentId: null, createdAt: null, agentCount: 0, available: null },
    agents:  [],   // [{ id, name, icon, roleType, modelId, rate, label, tools[], status, tokens, weightedTokens, isPlanner, available, modelServed, systemPrompt }]
    budget:  { maxTotalTokens: null, maxTokensPerAgent: null, maxTokensPerTask: null, maxConcurrentAgents: null,
               maxTasksPerPlan: null, maxPlanIterations: null, maxAgentTurns: null, executionTimeoutSecs: null,
               taskTimeoutSecs: null, warningPercent: null },
    usage:   { totalTokens: 0, weightedTokens: 0, perAgentTokens: {}, perAgentWeighted: {}, percentOfBudget: 0,
               tasksCreated: 0, planIterations: 0, activeAgents: 0, startedAt: null,
               exceeded: false, warningEmitted: false, emergencyStopped: false },
    metrics: { cpuPct: null, memPct: null, memUsedBytes: null, memTotalBytes: null,
               tokensPerSecond: null, contextUsed: null, contextMax: null, timestamp: null },
    tasks:   { list: [], waves: [], readyTaskIds: [], count: 0 },
    squads:  [],   // 서버의 스쿼드 목록 [{ id, name, updatedAt, agentCount }] (최근 갱신 순)
    /* current = 가장 최근 실행(진행 중이든 끝났든), running = 그것이 진행 중인가.
       events = 그 실행의 엔진 이벤트 피드(GET executions/{eid}/events?after=seq 누적), eventSeq = 받은 마지막 seq,
       eventsSupported = 서버가 이벤트 피드를 주는가(null = 아직 모름) */
    executions: { current: null, currentId: null, currentNo: null, running: false, history: [], count: 0, events: [], eventSeq: 0, eventsSupported: null },
    activity: [],   // [{ t, agentId, agentName, kind, message, raw }]
    events:   [],   // SSE 정규화 이벤트 링버퍼 [{ t, name, kind, agentId, tokens, data }]
    stats:    { totalRequests: 0, successfulRequests: 0, failedRequests: 0, totalTokens: 0, avgLatencyMs: 0, modelStats: [] },
    meta:     { lastRefresh: null, lastFast: null, refreshMs: null, sse: 'disconnected', errors: [], squadSource: null, eventNamesSeen: {} },
  };

  /* ---------- 유틸 ---------- */
  const pick = (obj, paths, dflt) => {
    if (dflt === undefined) dflt = null;
    for (const p of paths) {
      const v = p.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
      if (v !== undefined && v !== null) return v;
    }
    return dflt;
  };
  const num = (v, d) => { if (d === undefined) d = 0; return (typeof v === 'number' && isFinite(v)) ? v : (v != null && !isNaN(+v) ? +v : d); };
  /* 단가: 정확한 모델 ID → 없으면 소문자 부분 일치(가장 긴 키) → 없으면 null. 예: 'openai/gpt-oss-20b' ↔ 키 'gpt-oss-20b' */
  function rateOf(modelId) {
    if (!modelId) return null;
    const R = AIGO.rates; if (R[modelId] != null) return R[modelId];
    const m = String(modelId).toLowerCase(); let best = null, len = 0;
    for (const k of Object.keys(R)) { const kk = k.toLowerCase(); if (kk.length > len && m.includes(kk)) { best = R[k]; len = kk.length; } }
    return best;
  }
  const inFlight = e => /planning|awaiting|executing|aggregating|running|in_progress|active/i.test(String(pick(e, ['phase', 'status.type', 'status'], '')));
  const nowIso = () => new Date().toISOString();
  const EVENTS_MAX = 500, ACTIVITY_MAX = 300;

  /* ---------- 어댑터: 서버 raw → 상위 변수 (형태가 바뀌면 여기만 고친다) ---------- */
  const ADAPT = {
    health(raw) {
      state.server.ok = !!raw; state.server.status = pick(raw, ['status']);
      state.server.components = pick(raw, ['components'], {}) || {};
      state.server.routerHealthy = pick(raw, ['components.router'], state.server.routerHealthy);
    },
    version(raw) { state.server.version = pick(raw, ['version', 'appVersion'], typeof raw === 'string' ? raw : null); },
    routerStatus(raw) {
      const backends = pick(raw, ['backends'], []) || [];
      state.server.models = Array.from(new Set(backends.flatMap(b => b.models || [])));
      if (pick(raw, ['state.state']) === 'running') state.server.routerHealthy = true;
    },
    providers(raw) {
      const list = Array.isArray(raw) ? raw : (pick(raw, ['data'], []) || []);
      state.server.providers = list.map(p => ({ id: p.id, name: p.name, type: pick(p, ['providerType.type']), models: p.models || [], enabled: p.enabled }));
      if (!state.server.models.length) state.server.models = Array.from(new Set(list.flatMap(p => p.models || [])));
    },
    metrics(raw) {
      const d = pick(raw, ['data'], raw) || {};
      Object.assign(state.metrics, {
        cpuPct: num(pick(d, ['cpu.utilization']), null),
        memPct: num(pick(d, ['memory.usagePercent']), null),
        memUsedBytes: num(pick(d, ['memory.used', 'memory.usedBytes']), null),
        memTotalBytes: num(pick(d, ['memory.total', 'memory.totalBytes']), null),
        tokensPerSecond: num(pick(d, ['inference.tokensPerSecond']), null),
        contextUsed: num(pick(d, ['inference.contextUsed']), null),
        contextMax: num(pick(d, ['inference.contextMax']), null),
        timestamp: pick(d, ['timestamp'], Date.now()),
      });
    },
    stats(raw) {
      const d = pick(raw, ['data'], raw) || {};
      Object.assign(state.stats, {
        totalRequests: num(d.totalRequests), successfulRequests: num(d.successfulRequests), failedRequests: num(d.failedRequests),
        totalTokens: num(d.totalTokens), avgLatencyMs: num(d.avgLatencyMs), modelStats: d.modelStats || [],
      });
    },
    squad(raw) {
      const s = pick(raw, ['data'], raw) || {};
      Object.assign(state.squad, {
        id: s.id || state.squad.id, name: s.name || null, description: s.description || null,
        status: pick(s, ['status.type', 'status'], null), plannerAgentId: s.plannerAgentId || null,
        createdAt: s.createdAt || null, agentCount: (s.agents || []).length,
      });
      const prev = {}; for (const a of state.agents) prev[a.id] = a;
      state.agents = (s.agents || []).map(a => {
        const id = a.id || a.agentId || a.name;
        const modelId = pick(a, ['modelPreferences.preferredModelId', 'modelId', 'model'], null);
        const rate = rateOf(modelId) || (prev[id] && prev[id].rate) || 1;
        const roleType = pick(a, ['role.type', 'role'], null);
        const isPlanner = !!((s.plannerAgentId && id === s.plannerAgentId) || roleType === 'planner');
        return Object.assign({ tokens: 0, weightedTokens: 0, status: 'idle', available: null, modelServed: null, lastEvent: null },
          prev[id] || {}, {
            id, name: a.name || id, icon: a.icon || '',
            roleType, modelId, rate, systemPrompt: pick(a, ['systemPrompt'], '') || '',
            label: (isPlanner && AIGO.plannerLabel) || AIGO.roleLabels[rate] || a.name,
            tools: pick(a, ['toolConfig.enabledTools', 'tools'], []) || [],
            memoryEnabled: !!a.memoryEnabled, executionMode: a.executionMode || null,
            isPlanner,
          });
      });
      recomputeWeighted();
    },
    readiness(raw) {
      const d = pick(raw, ['data'], raw) || {};
      state.squad.available = pick(d, ['available'], null);
      if (d.routerHealthy != null) state.server.routerHealthy = d.routerHealthy;
      for (const ra of (d.agents || [])) {
        const a = state.agents.find(x => x.id === ra.agentId || x.name === ra.agentName);
        if (!a) continue;
        if (!a.modelId && ra.modelId) { a.modelId = ra.modelId; a.rate = rateOf(ra.modelId) || a.rate; a.label = (a.isPlanner && AIGO.plannerLabel) || AIGO.roleLabels[a.rate] || a.label; }
        a.modelServed = !!ra.modelServed; a.available = !!ra.available;
      }
    },
    budget(raw) {
      const d = pick(raw, ['data'], raw) || {};
      Object.assign(state.budget, {
        maxTotalTokens: num(d.maxTotalTokens, null), maxTokensPerAgent: num(d.maxTokensPerAgent, null),
        maxTokensPerTask: num(d.maxTokensPerTask, null), maxConcurrentAgents: num(d.maxConcurrentAgents, null),
        maxTasksPerPlan: num(d.maxTasksPerPlan, null), maxPlanIterations: num(d.maxPlanIterations, null),
        maxAgentTurns: num(d.maxAgentTurns, null), executionTimeoutSecs: num(d.executionTimeoutSecs, null),
        taskTimeoutSecs: num(d.taskTimeoutSecs, null), warningPercent: num(d.warningThresholdPercent, null),
      });
      recomputeWeighted();
    },
    usage(raw) {
      const d = pick(raw, ['data'], raw) || {};
      Object.assign(state.usage, {
        totalTokens: num(d.totalTokens), perAgentTokens: d.perAgentTokens || {},
        tasksCreated: num(d.tasksCreated), planIterations: num(d.planIterations), activeAgents: num(d.activeAgents),
        startedAt: d.startedAt || null, exceeded: !!d.exceeded, warningEmitted: !!d.warningEmitted, emergencyStopped: !!d.emergencyStopped,
      });
      for (const a of state.agents) a.tokens = num(state.usage.perAgentTokens[a.id], a.tokens);
      recomputeWeighted();
    },
    taskGraph(raw) {
      const d = pick(raw, ['data'], raw) || {};
      state.tasks.waves = d.waves || []; state.tasks.readyTaskIds = d.readyTaskIds || [];
      if (Array.isArray(d.tasks) && d.tasks.length) state.tasks.list = d.tasks;
      state.tasks.count = state.tasks.list.length;
    },
    tasks(raw) {
      const list = Array.isArray(raw) ? raw : (pick(raw, ['data', 'tasks'], []) || []);
      state.tasks.list = list; state.tasks.count = list.length;
    },
    squads(raw) {
      const list = Array.isArray(raw) ? raw : (pick(raw, ['data', 'squads'], []) || []);
      state.squads = list.map(s => ({ id: s.id, name: s.name || s.id, updatedAt: s.updatedAt || s.createdAt || '', agentCount: (s.agents || []).length || num(s.agentCount, 0) }))
        .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
    },
    /* 실행 이력(엔진: 최신순). current = 가장 최근 실행 — 새 실행으로 바뀌면 이벤트 피드를 처음부터 다시 받는다 */
    history(raw) {
      const list = Array.isArray(raw) ? raw : (pick(raw, ['data', 'executions', 'history', 'items'], []) || []);
      const X = state.executions;
      X.history = list; X.count = list.length;
      const newest = list[0] || null, id = newest ? (newest.id || newest.executionId) : null;
      if (id !== X.currentId) { X.current = newest; X.currentId = id; X.currentNo = newest ? (newest.no != null ? newest.no : null) : null; X.events = []; X.eventSeq = 0; }
      else if (newest && !(X.current && X.current.plan)) X.current = newest;   // 상세(DTO)가 없으면 이력 레코드로
      X.running = !!(newest && inFlight(newest));
    },
    execution(raw) {
      const d = pick(raw, ['data'], raw);
      if (d && (d.id || d.executionId) === state.executions.currentId) { state.executions.current = d; state.executions.running = inFlight(d); }
    },
    /* 엔진 이벤트 피드: { executionId, phase, seq, events:[{seq,t,kind,agent?,to?,task?,text?,tokens?,ok?…}] } */
    execEvents(raw) {
      const d = pick(raw, ['data'], raw) || {}, X = state.executions;
      if (d.executionId && d.executionId !== X.currentId) return;
      for (const e of (d.events || [])) { if (e.seq > X.eventSeq) { X.events.push(e); X.eventSeq = e.seq; } }
      if (X.events.length > EVENTS_MAX) X.events.splice(0, X.events.length - EVENTS_MAX);
      if (d.phase) X.running = /planning|awaiting|executing|aggregating/.test(d.phase);
      X.eventsSupported = true;
    },
    activity(raw) {
      const entries = pick(raw, ['entries', 'data.entries', 'data'], []) || [];
      state.activity = entries.slice(-ACTIVITY_MAX).map(e => ({
        key: e.id || e.entryId || null,   // 안정 키(없으면 소비자가 t+agent+message 로 만든다)
        t: e.timestamp || e.createdAt || e.time || null,
        agentId: e.agentId || e.agent_id || null, agentName: e.agentName || e.agent || null,
        kind: e.kind || e.type || e.level || 'activity',
        message: e.message || e.content || e.text || JSON.stringify(e).slice(0, 200), raw: e,
      }));
    },
    /* SSE 이벤트 정규화. 이름을 아직 모르므로 휴리스틱 + EVENT_MAP(확정되면 채움) */
    event(ev) {
      const name = ev.event || 'message';
      if (name === ':comment') { state.meta.sse = 'connected'; return null; }
      state.meta.eventNamesSeen[name] = (state.meta.eventNamesSeen[name] || 0) + 1;
      const d = (ev.data && typeof ev.data === 'object') ? ev.data : { value: ev.data };
      const map = AIGO.EVENT_MAP[name] || {};
      const agentId = map.agentId ? map.agentId(d) : pick(d, ['agentId', 'agent_id', 'agent.id', 'payload.agentId', 'sender'], null);
      const tokens = map.tokens ? map.tokens(d) : num(pick(d, ['tokens', 'totalTokens', 'usage.total_tokens', 'payload.tokens']), 0);
      const kind = map.kind || guessKind(name, d);
      state.meta.eventSeq = (state.meta.eventSeq || 0) + 1;
      const norm = { seq: state.meta.eventSeq, t: (ev.t != null ? ev.t : Date.now()), name, kind, agentId, tokens, data: d };
      state.events.push(norm); if (state.events.length > EVENTS_MAX) state.events.shift();
      if (agentId) {
        const a = state.agents.find(x => x.id === agentId || x.name === agentId);
        if (a) { a.lastEvent = kind; if (kind === 'working') a.status = 'working'; if (kind === 'done' || kind === 'idle') a.status = 'idle'; }
      }
      return norm;
    },
  };
  function guessKind(name, d) {
    const s = (name + ' ' + JSON.stringify(d || {})).toLowerCase();
    if (/hand.?off|delegat|assign/.test(s)) return 'handoff';
    if (/verif|check|validate|review/.test(s) && /fail|reject|mismatch/.test(s)) return 'verify_fail';
    if (/budget|cut.?loss|give.?up|abandon|exceeded/.test(s)) return 'budget';
    if (/complete|finish|done|submit|success/.test(s)) return 'done';
    if (/start|begin|thinking|token|stream|chunk|progress/.test(s)) return 'working';
    if (/error|fail/.test(s)) return 'error';
    return 'info';
  }
  function recomputeWeighted() {
    let total = 0; const perW = {};
    for (const a of state.agents) { a.weightedTokens = Math.round(a.tokens * (a.rate || 1)); perW[a.id] = a.weightedTokens; total += a.weightedTokens; }
    state.usage.perAgentWeighted = perW; state.usage.weightedTokens = total;
    state.usage.percentOfBudget = state.budget.maxTotalTokens ? Math.min(100, 100 * state.usage.totalTokens / state.budget.maxTotalTokens) : 0;
  }

  /* ---------- 스토어 본체 ---------- */
  const listeners = new Set();
  let client = null, squadId = null, pollTimer = null, fastTimer = null, stopSse = null, refreshing = false;
  function emit(what) { for (const cb of listeners) { try { cb(state, what); } catch (e) { console.error(e); } } }
  function errs(where, e) { state.meta.errors.push({ t: nowIso(), where, error: String((e && e.message) || e) }); if (state.meta.errors.length > 50) state.meta.errors.shift(); }
  async function safe(path, adapt) {
    try { const raw = await client.get(path); adapt(raw); return raw; }
    catch (e) { errs(path, e); return null; }
  }

  const AIGO = {
    state,
    rates: Object.assign({}, RATES_DEFAULT),
    roleLabels: Object.assign({}, ROLE_LABEL_BY_RATE),
    plannerLabel: null,   // 플래너 라벨 (config.plannerLabel; null 이면 단가 라벨)
    EVENT_MAP: {},   // SSE 이벤트 이름 확정 후 채움: { 'squad.task.started': { kind:'working', agentId: d => d.agent_id, tokens: d => 0 }, ... }
    ADAPT,
    configure(opts) {
      opts = opts || {};
      client = new (global.AigoClient)({ base: opts.base || '/aigo', key: opts.key || '' });
      if (opts.squadId !== undefined) squadId = opts.squadId;
      if (opts.rates) AIGO.rates = Object.assign({}, opts.rates);             // 병합이 아니라 교체 (config 가 단일 진실)
      if (opts.roleLabels) AIGO.roleLabels = Object.assign({}, opts.roleLabels);
      if (opts.plannerLabel !== undefined) AIGO.plannerLabel = opts.plannerLabel || null;
      return AIGO;
    },
    get squadId() { return squadId; },
    async pickSquad(id) { squadId = id || null; return AIGO.refreshAll(); },
    /* 전체 새로고침: 서버 + 스쿼드 정적 정보 + 사용량 */
    async refreshAll() {
      if (!client) AIGO.configure();
      if (refreshing) return state;
      refreshing = true;
      const t0 = performance.now();
      await Promise.all([
        safe('/api/v1/health', ADAPT.health), safe('/api/v1/version', ADAPT.version),
        safe('/api/v1/router/status', ADAPT.routerStatus), safe('/api/v1/providers', ADAPT.providers),
        safe('/api/v1/monitoring/metrics', ADAPT.metrics), safe('/api/v1/stats/usage', ADAPT.stats),
      ]);
      await safe('/api/v1/squads', ADAPT.squads);
      if (!squadId && state.squads.length) { squadId = state.squads[0].id; state.meta.squadSource = 'auto-recent'; }   // 최근 갱신 스쿼드
      if (squadId) {
        const s = encodeURIComponent(squadId);
        await safe('/api/v1/squads/' + s, ADAPT.squad);
        await Promise.all([
          safe('/api/v1/squads/' + s + '/readiness', ADAPT.readiness),
          safe('/api/v1/squads/' + s + '/budget', ADAPT.budget),
          safe('/api/v1/squads/' + s + '/budget/usage', ADAPT.usage),
          safe('/api/v1/squads/' + s + '/tasks', ADAPT.tasks),
          safe('/api/v1/squads/' + s + '/tasks/graph', ADAPT.taskGraph),
          safe('/api/v1/squads/' + s + '/history?limit=12&offset=0', ADAPT.history),
          safe('/api/v1/squads/' + s + '/activity-log/load?limit=200&offset=0', ADAPT.activity),
        ]);
      }
      state.meta.lastRefresh = nowIso(); state.meta.refreshMs = Math.round(performance.now() - t0);
      refreshing = false;
      emit('refreshAll'); return state;
    },
    /* 빠른 새로고침: 실행 중 자주 바뀌는 것만 */
    async refreshFast() {
      if (!client || !squadId) return state;
      const s = encodeURIComponent(squadId);
      await Promise.all([
        safe('/api/v1/squads/' + s + '/budget/usage', ADAPT.usage),
        safe('/api/v1/monitoring/metrics', ADAPT.metrics),
        safe('/api/v1/squads/' + s + '/history?limit=12&offset=0', ADAPT.history),   // 새 실행은 여기서 먼저 보인다
      ]);
      const X = state.executions, eid = X.currentId && encodeURIComponent(X.currentId);
      if (eid) {
        const jobs = [];
        if (X.running) jobs.push(safe('/api/v1/squads/' + s + '/executions/' + eid, ADAPT.execution));
        if (X.eventsSupported !== false) jobs.push((async () => {
          const path = '/api/v1/squads/' + s + '/executions/' + eid + '/events?after=' + X.eventSeq;
          try { ADAPT.execEvents(await client.get(path)); }
          catch (e) { if (/-> 404/.test(String(e))) X.eventsSupported = false; else errs(path, e); }   // 404 = 이벤트 피드 없는 서버 → 폴백(토큰 diff)
        })());
        await Promise.all(jobs);
      }
      state.meta.lastFast = nowIso(); emit('refreshFast'); return state;
    },
    start(opts) {
      opts = opts || {};
      const pollMs = opts.pollMs || 10000, fastMs = opts.fastMs || 2000, sse = opts.sse !== false;
      AIGO.stop();
      if (!client) AIGO.configure();
      AIGO.refreshAll();
      pollTimer = setInterval(() => AIGO.refreshAll(), pollMs);
      fastTimer = setInterval(() => AIGO.refreshFast(), fastMs);
      if (sse) stopSse = client.tapEvents(ev => { const n = ADAPT.event(ev); if (n) emit('event'); },
        { onState: st => { state.meta.sse = st; emit('sse'); } });
      return AIGO;
    },
    stop() { clearInterval(pollTimer); clearInterval(fastTimer); if (stopSse) stopSse(); pollTimer = fastTimer = stopSse = null; },
    on(cb) { listeners.add(cb); return () => listeners.delete(cb); },
    toJSON() { return JSON.parse(JSON.stringify(state)); },
    /* 시각화용 편의 getter */
    agentByLabel(label) { return state.agents.find(a => a.label === label) || null; },
    agentsByRate() { return state.agents.slice().sort((a, b) => a.rate - b.rate); },
  };
  global.AIGO = AIGO;
  if (typeof module !== 'undefined') module.exports = AIGO;
})(typeof window !== 'undefined' ? window : globalThis);
