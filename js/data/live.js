/* =========================================================
   data/live.js — 스쿼드 서버(AIGO.state) → Director 이벤트.
   1차 소스: 스쿼드 엔진(aigo-web/backend/squad_engine.py)의 이벤트 피드 state.executions.events
             request · planning · plan · wave · task_start · task_retry · task_done · task_failed · aggregate · done
           → 교실 각본으로 번역: 칠판에 문제 → 반장/담당이 카드 받음 → 다음 담당에게 넘김(단가가 오르면 손들기) → 채점 ○/✗ → 제출.
   2차(폴백): 이벤트 피드가 없는 서버(eventsSupported=false)면 토큰 증가 = working, 실행 상태 = task_start/submit.
   규칙: director.dispatch() 만 호출한다 (월드/UI 직접 조작 금지). 처음 봤을 때 이미 끝난 실행은 재생하지 않는다(기준선만).
   한 실행 = 한 교시(시간표 한 줄) = 카드 한 장. 실행 안의 작업(task)들은 카드가 누구 손에 있는지(담당 흐름)로 보인다.
   재생은 직렬(_replay): 엔진 이벤트를 한 건씩 await 하며 연출한다 — 엔진이 교실보다 빨라도 순서(넘김 → 채점 → 제출)가 지켜진다.
   다음 이벤트가 아직 없으면 풀이 중인 담당들에게 working 틱을 준다(실제 모델이 느릴 때 "풀이 중" 이 계속 보임).
   ========================================================= */
window.Sniffer = window.Sniffer || {};

Sniffer.Live = class Live {
  constructor(director, cfg) {
    this.d = director; this.cfg = cfg; this.unsub = null;
    this.prev = { tokens: {}, lastWorkingAt: {}, eventSeq: 0, execId: null, execStatus: null, exceeded: false, warned: false, baselined: false, histSig: '' };
    this.run = null;   // 재생 중인 실행(교시): { id, label, text, replay, queue:[events], loop:Promise, started, holder, done, inflight:{task:{agent,text}}, tasks:{id:{agent,wave,dependsOn,title}} }
    this.stopped = false;
    director.costMode = 'absolute';
  }
  queueLength() { return 0; }
  static async available(cfg) {
    try {
      const c = new AigoClient({ base: cfg.proxyBase }); const h = await c.get('/api/v1/health');
      const raw = await c.get('/api/v1/squads'), squads = Array.isArray(raw) ? raw : (raw && raw.data) || [];
      return { ok: !!h, squads: squads.length };
    } catch (e) { return { ok: false, squads: 0, error: String(e) }; }
  }
  start() {
    AIGO.configure({ base: this.cfg.proxyBase, squadId: this.cfg.squadId, rates: this.cfg.rates, roleLabels: this.cfg.roleLabels, plannerLabel: this.cfg.plannerLabel });
    Object.assign(AIGO.EVENT_MAP, this.cfg.eventMap || {});
    this.unsub = AIGO.on((s, what) => this._onState(s, what));
    AIGO.start({ pollMs: this.cfg.pollMs, fastMs: this.cfg.fastMs });
    this.d.dispatch({ kind: 'note', text: '스쿼드 서버 연결 — 상태를 읽는 중' });
  }
  stop() { this.stopped = true; if (this.unsub) this.unsub(); this.unsub = null; AIGO.stop(); }

  /* 문제 내기 → 스쿼드 실행 요청(POST execute). 엔진이 받으면 request 이벤트로 칠판에 적힌다 */
  async enqueueTask(text) {
    const sid = AIGO.squadId || this.cfg.squadId;
    if (!sid) { this.d.dispatch({ kind: 'note', text: '스쿼드가 없습니다 — ⚙에서 스쿼드를 고르세요', tone: 'warn' }); return; }
    try {
      await new AigoClient({ base: this.cfg.proxyBase }).post(`/api/v1/squads/${encodeURIComponent(sid)}/execute`, { request: text, autoApprove: true });
      this.d.dispatch({ kind: 'note', text: '문제를 냈습니다 — 스쿼드가 받으면 칠판에 적힙니다', tone: 'good' });
      setTimeout(() => AIGO.refreshFast(), 400);
    } catch (e) { this.d.dispatch({ kind: 'note', text: '문제 내기 실패: ' + (e.message || e), tone: 'warn' }); }
  }

  /* 이름/id 어느 쪽이 와도 엔티티 id 로 */
  _aid(x, s) { if (!x) return null; if (this.d.world.get(x)) return x; const a = (s.agents || []).find(y => y.id === x || y.name === x); return a ? a.id : null; }
  _ent(id) { return id ? this.d.world.get(id) : null; }
  /* 에이전트가 답을 끝내면 그 캐릭터의 미연시 대화창을 열어 답을 보여 주고, 그 캐릭터 목소리로 읽는다 (config.voice.agents) */
  _announce(id, text, key) {
    const V = (this.d.cfg && this.d.cfg.voice) || {}, A = V.agents || {};
    if (!A.enabled) return;
    const ent = this._ent(id), ui = this.d.ui; if (!ent || !ui) return;
    /* 교실이 여러 곳(분할 화면 iframe · 교실 탭 · 새 창)에 떠 있으면 전부 같은 이벤트를 받는다.
       같은 답을 한 페이지만 읽도록 localStorage 로 선점한다 — 먼저 잡은 쪽만 말하고, 나머지는 창만 연다 */
    let speaker = true;
    if (key) {
      try {
        const k = 'sniffer_spoke:' + key, now = Date.now(), prev = Number(localStorage.getItem(k) || 0);
        if (prev && now - prev < 90000) speaker = false; else localStorage.setItem(k, String(now));
        if (!speaker && (this._seenSpeak || (this._seenSpeak = new Set())).has(key)) return;   // 같은 페이지의 중복 이벤트
        (this._seenSpeak || (this._seenSpeak = new Set())).add(key);
      } catch (e) {}
    }
    const body = (Sniffer.Voice && Sniffer.Voice.clean) ? Sniffer.Voice.clean(text) : text;
    if (A.vn !== false) {
      (ui.chatLogs[ent.id] = ui.chatLogs[ent.id] || []).push({ who: 'agent', text: body });
      ui.chatMode = 'vn'; ui.openChat(ent);
      const inp = document.getElementById('vnInput'); if (inp && document.activeElement === inp) inp.blur();   // 자동으로 열린 창이 키 입력을 뺏지 않게
    }
    const openedAt = Date.now(), minMs = Math.max(4000, Math.min(20000, body.length * 60));   // 소리가 안 나와도 읽을 시간은 준다
    const dismiss = () => {
      const wait = Math.max(1200, minMs - (Date.now() - openedAt));
      setTimeout(() => {
        const inp = document.getElementById('vnInput');
        if (ui.chatAgent !== ent || (inp && inp.value.trim()) || (inp && document.activeElement === inp)) return;   // 사람이 그 창을 쓰는 중이면 둔다
        ui.el.vnBox.classList.add('closing'); setTimeout(() => { if (ui.chatAgent === ent) ui.closeAll(); ui.el.vnBox.classList.remove('closing'); }, 380);
      }, wait);
    };
    if (speaker && Sniffer.Voice && Sniffer.Voice.speakFor) Sniffer.Voice.speakFor(ent, body, { onend: dismiss }); else dismiss();
  }
  _lbl(id) { const e = this._ent(id); return e ? e.label : (id || '?'); }
  _runLabel(h, no) { const n = no != null ? no : (h && h.no); return 'P' + (n != null ? n : String((h && (h.id || h.executionId)) || '').slice(0, 4)); }

  _onState(s) {
    const D = this.d, th = this.cfg.theme;
    if (!s.agents.length) return;   // 스쿼드 상세가 오기 전엔 아무것도 안 한다 (이벤트가 모르는 에이전트를 가리키지 않게)
    /* 1) 에이전트 등장 / 갱신 (토큰은 서버 누적 절대값) */
    for (const a of s.agents) {
      if (!D.world.get(a.id)) D.dispatch({ kind: 'spawn', agent: a.id, name: a.name, rate: a.rate, label: a.label, modelId: a.modelId, tier: a.rate });
      D.dispatch({ kind: 'agent_update', agent: a.id, rate: a.rate, label: a.label, tokens: a.tokens, weightedTokens: a.weightedTokens, budgetTokens: s.budget.maxTokensPerAgent || null });
    }
    /* 2) 미터기 절대값 */
    D.dispatch({ kind: 'meter', value: th.taximeter ? s.usage.weightedTokens : s.usage.totalTokens });
    const first = !this.prev.baselined; this.prev.baselined = true;
    /* 3) 시간표 = 실행 이력(교시) */
    this._timetable(s);
    /* 4) 엔진 이벤트 피드 → 재생 큐. 새 실행이 보이면 처음부터, 처음 봤을 때 이미 끝난 실행은 조용히 건너뜀 */
    const X = s.executions;
    if (X.currentId !== this.prev.execId) {
      this.prev.execId = X.currentId; this.prev.eventSeq = 0;
      this.run = X.currentId ? { id: X.currentId, label: this._runLabel(X.current, X.currentNo), text: (X.current && X.current.request) || '', replay: X.running,
        queue: [], loop: null, started: false, holder: null, done: false, inflight: {}, tasks: {} } : null;
    }
    const R = this.run;
    if (R) {
      for (const e of X.events) { if (!(e.seq > this.prev.eventSeq)) continue; this.prev.eventSeq = e.seq; if (R.replay) R.queue.push(e); }
      if (R.replay && !R.loop) R.loop = this._replay(R, s);
    }
    /* 5) 이벤트 피드가 없는 서버: 예전 방식(토큰 diff·실행 상태) */
    if (X.eventsSupported === false) this._fallback(s, first);
    /* 6) 예산 경고/초과/비상정지 → 스쿼드 중단, 해제되면 재개 */
    const ex2 = !!(s.usage.exceeded || s.usage.emergencyStopped);
    if (ex2 && !this.prev.exceeded)
      D.dispatch({ kind: 'halt', reason: s.usage.emergencyStopped ? 'emergency_stop' : 'budget_exceeded',
        text: s.usage.emergencyStopped ? '비상 정지 → <b style="color:#ff5d5d">실행 중단</b>' : `총 예산 ${s.budget.maxTotalTokens ? s.budget.maxTotalTokens.toLocaleString() + ' tok ' : ''}초과 → <b style="color:#ff5d5d">실행 중단</b>` });
    else if (!ex2 && this.prev.exceeded) D.dispatch({ kind: 'resume' });
    if (s.usage.warningEmitted && !this.prev.warned) D.dispatch({ kind: 'budget', verdict: 'warn', text: `예산 ${s.budget.warningPercent || 80}% 경고선 도달` });
    this.prev.exceeded = ex2; this.prev.warned = !!s.usage.warningEmitted;
  }

  /* 시간표: 최근 실행 N개(오래된 것부터). 진행 중은 가장 최근 것만 ▶, 그보다 오래된 미완료는 건너뜀(–) */
  _timetable(s) {
    const hist = (s.executions.history || []).slice(0, this.cfg.timetableMax || 12);
    const sig = hist.map(h => (h.no != null ? h.no : (h.id || h.executionId)) + ':' + (h.phase || h.status)).join('|');
    if (sig === this.prev.histSig) return; this.prev.histSig = sig;
    const items = hist.map((h, i) => {
      const ph = String(h.phase || (h.status && h.status.type) || h.status || '');
      const status = /completed/.test(ph) ? 'done' : /failed/.test(ph) ? 'fail' : /cancel/.test(ph) ? 'skipped' : (i === 0 ? 'now' : 'skipped');
      const t0 = (h.tasks || [])[0], ag = t0 && this._ent(t0.assignedAgentId || t0.agentId || t0.assignedTo);
      return { id: this._runLabel(h), no: h.no != null ? h.no : undefined, title: Sniffer.util.short(h.request || h.title || '', 20), agent: ag ? ag.label : '', status };   // no = 스쿼드의 n번째 실행 → 시간표가 n교시로 부름 (Studio 바와 같은 번호)
    }).reverse();
    this.d.dispatch({ kind: 'schedule', items });
  }

  /* ---------- 직렬 재생 루프: 이벤트 한 건씩 연출, 비면 풀이 중인 담당들에게 working 틱 ---------- */
  async _replay(R, s) {
    const D = this.d, sleep = Sniffer.util.sleep;
    while (this.run === R && !this.stopped) {
      const e = R.queue.shift();
      if (e) { try { await this._engineEvent(e, s); } catch (err) { console.warn('[live] event', e, err); } continue; }
      if (R.done) break;
      const busy = new Map(); for (const it of Object.values(R.inflight)) if (it.agent && !busy.has(it.agent)) busy.set(it.agent, it.text);
      if (busy.size) await Promise.all([...busy].map(([agent, text]) => D.dispatch({ kind: 'working', agent, text, ms: 1200 })));
      else await sleep(250);
    }
  }

  /* ---------- 엔진 이벤트 → director 계약 (각 연출을 await: 순서 보존) ---------- */
  async _engineEvent(e, s) {
    const D = this.d, R = this.run, S = Sniffer.util.short, agent = this._aid(e.agent, s);
    switch (e.kind) {
      case 'request': R.text = e.text || R.text; if (Sniffer.Voice && Sniffer.Voice.hold) Sniffer.Voice.hold(); break;   // 풀이 시작: 마이크 끔
      case 'planning': if (agent) { await this._pickup(agent); this._work('__plan', agent, '계획 중'); } break;
      case 'plan': {
        delete R.inflight.__plan;
        for (const t of (e.tasks || [])) R.tasks[t.id] = { agent: this._aid(t.agent, s), wave: t.wave || 0, dependsOn: t.dependsOn || [], title: t.title || '' };
        const n = (e.tasks || []).length, p = this._aid(e.plannedBy, s);
        D.dispatch({ kind: 'note', text: `계획: 작업 ${n}개 · ${e.waves || 1}단계`, tone: 'good' });
        if (p) await D.dispatch({ kind: 'say', agent: p, text: n > 1 ? `${n}개 작업으로 나눴어. 나눠서 풀자.` : '이건 한 명이면 돼. 바로 맡길게.', ms: 1800 });
        break;
      }
      case 'wave': if ((e.total || 1) > 1) D.dispatch({ kind: 'note', text: `${(e.index || 0) + 1}/${e.total}단계 시작` }); break;
      case 'task_start': {
        if (!agent) break;
        const t = R.tasks[e.task] || { wave: 0, dependsOn: e.dependsOn || [], title: e.title || '' }, title = S(e.title || t.title || '', 18);
        if (!R.started) await this._pickup(agent);
        else if (R.holder !== agent) {
          /* 같은 단계에서 이미 다른 담당이 풀고 있으면(병렬) 카드는 그 담당에게 두고 같이 푼다. 앞 단계 결과를 잇는 작업이면 카드를 넘긴다 */
          const sibling = Object.keys(R.inflight).some(id => R.tasks[id] && R.tasks[id].wave === t.wave && id !== e.task);
          if ((t.dependsOn && t.dependsOn.length) || !sibling) await this._hand(R.holder, agent, `${title} — 부탁해요`);
          else await D.dispatch({ kind: 'say', agent, text: `${title}, 저도 같이 맡을게요`, ms: 1500 });
        } else await D.dispatch({ kind: 'say', agent, text: `다음: ${title}`, ms: 1400 });
        await this._work(e.task, agent, S(e.title || '', 12) || '풀이 중');
        break;
      }
      case 'task_retry': if (agent) await D.dispatch({ kind: 'retry', agent, text: '응답이 없네… 직접 추론으로 다시' }); break;
      case 'task_done':
        delete R.inflight[e.task];
        if (agent) { await D.dispatch({ kind: 'verify', agent, ok: true, text: '○ ' + (S(e.text, 30) || '완료') }); if (e.text) await D.dispatch({ kind: 'say', agent, text: S(e.text, 70), ms: 2600 }); }
        if (agent && e.text) this._announce(agent, e.text, `${(this.run && this.run.id) || ''}:${e.seq}`);
        break;
      case 'task_failed':
        delete R.inflight[e.task];
        if (agent) await D.dispatch({ kind: 'verify', agent, ok: false, text: '✗ ' + (S(e.text, 30) || '실패'), note: `${this._lbl(agent)} 작업 실패 — ${S(e.text, 60)}` });
        break;
      case 'aggregate':
        if (!agent) break;
        if (!R.started) await this._pickup(agent); else if (R.holder && R.holder !== agent) await this._hand(R.holder, agent, '결과 모아서 정리 부탁해요');
        await this._work('__agg', agent, '종합 중');
        break;
      case 'done': {
        R.inflight = {}; const by = agent || R.holder, ok = !!e.ok, cancelled = e.phase === 'cancelled';
        if (!R.started) await this._pickup(null);   // 아무도 받기 전에 끝남(계획 실패·취소): 카드만 칠판에 올렸다가 결과 도장
        await D.dispatch({ kind: 'submit', ok, by, note: cancelled ? '취소됨' : ok ? `${this._lbl(by)} 제출 · ${(e.tokens || 0).toLocaleString()} tok` : `실패: ${S(e.text, 50)}` });
        const b = this._ent(by); if (b && b.isTeacher) await D.dispatch({ kind: 'idle', agent: by });
        if (Sniffer.Voice && Sniffer.Voice.release) Sniffer.Voice.release(!(Sniffer.Voice.enabled && !cancelled));   // 끝: 답을 읽을 거면 읽은 뒤에, 아니면 바로 다시 듣는다
        if (Sniffer.Voice && Sniffer.Voice.enabled && !cancelled) { const cur = AIGO.state.executions.current; Sniffer.Voice.speakAnswer((ok && cur && (cur.id || cur.executionId) === R.id && cur.finalResult) || e.text, ok); }   // 음성 모드: 답(가능하면 전체 finalResult)을 읽어 준다
        R.holder = null; R.done = true;
        break;
      }
      case 'cancel': D.dispatch({ kind: 'note', text: '실행 취소 요청', tone: 'warn' }); break;
      case 'awaiting_approval': D.dispatch({ kind: 'note', text: '계획 승인 대기 중 — 콘솔에서 승인하면 시작합니다', tone: 'warn' }); break;
      case 'approved': D.dispatch({ kind: 'note', text: '계획 승인됨', tone: 'good' }); break;
      default: D.dispatch({ kind: 'note', text: `${e.kind}${e.text ? ': ' + S(e.text, 40) : ''}`, trace: { ev: 'engine', raw: e } });
    }
  }
  /* 카드 받기: 첫 담당이 칠판 앞에서 카드를 받아 온다 (교시 시작). agent 가 없으면 카드만 칠판에 */
  _pickup(agent) {
    const R = this.run; if (R.started) return Promise.resolve(); R.started = true; R.holder = agent || null;
    return this.d.dispatch({ kind: 'task_start', agent: agent || undefined, taskId: R.label, text: R.text, category: '' });
  }
  /* 카드 넘기기: 받는 쪽 단가가 높으면 손들고 호출(escalate), 아니면 핸드오프 */
  _hand(from, to, text) {
    const R = this.run, f = this._ent(from), t = this._ent(to);
    R.holder = to; if (!f || !t || f === t) return Promise.resolve();
    const up = (t.rate || 1) > (f.rate || 1);
    return this.d.dispatch(up ? { kind: 'escalate', agent: from, to, reason: '상위 검토', text } : { kind: 'handoff', agent: from, to, text });
  }
  /* 풀이 시작: 최소 한 박자는 "풀이 중"이 보이게 하고, 이후엔 재생 루프가 다음 이벤트를 기다리는 동안 working 틱을 준다 */
  _work(task, agent, text) { this.run.inflight[task] = { agent, text }; return this.d.dispatch({ kind: 'working', agent, text, ms: 1200 }); }

  /* ---------- 폴백: 이벤트 피드가 없는 서버 (토큰 diff → working, 실행 상태 → task_start/submit) ---------- */
  _fallback(s, first) {
    const D = this.d, now = Date.now();
    for (const a of s.agents) {
      const before = this.prev.tokens[a.id] || 0;
      if (!first && a.tokens > before && now - (this.prev.lastWorkingAt[a.id] || 0) > 1500) {
        this.prev.lastWorkingAt[a.id] = now;
        D.dispatch({ kind: 'working', agent: a.id, tokens: 0, ms: 1500, text: `+${(a.tokens - before).toLocaleString()} tok` });
      }
      this.prev.tokens[a.id] = a.tokens;
    }
    const ex = s.executions.current, exId = s.executions.currentId, exStatus = ex && (ex.phase || (ex.status && ex.status.type) || ex.status);
    if (!first && exId && exId !== this.prev.execStatusId && s.executions.running) D.dispatch({ kind: 'task_start', taskId: this._runLabel(ex), text: ex.request || '', category: '' });
    if (!first && exStatus && exStatus !== this.prev.execStatus && exId === this.prev.execStatusId) {
      if (/complete|success|done/i.test(exStatus)) D.dispatch({ kind: 'submit', ok: true });
      else if (/fail|error|cancel/i.test(exStatus)) D.dispatch({ kind: 'submit', ok: false });
    }
    this.prev.execStatusId = exId; this.prev.execStatus = exStatus;
  }

  /* ---------- 대화: 에이전트가 "자기 모델"로 직접 답한다 ----------
     교실에서 말을 걸면(Space) 그 에이전트의 모델(sa.modelId)에게 지금 상황을 요약해 함께 보내고,
     지나가듯 한두 문장으로 답하게 한다. 서버가 안 되면 아래 _canned 로 조용히 내려앉는다.
     주의: 엔진이 쓰는 에이전트 세션(POST agents/{id}/message)이 아니라 별도 채팅 호출이라 실행을 방해하지 않는다. */
  _selfContext(a, sa, s) {
    const R = this.run, S = Sniffer.util.short, L = n => Number(n || 0).toLocaleString(), out = [];
    out.push(`반(스쿼드): ${s.squad.name || '?'}`);
    out.push(`수업: ${s.executions.running ? '진행 중' : '쉬는 중'}${R && R.label ? ' · ' + R.label + (R.text ? ' — ' + S(R.text, 60) : '') : ''}`);
    const mine = R ? Object.values(R.tasks || {}).filter(t => t.agent === a.id) : [];
    if (mine.length) out.push(`내가 맡은 작업: ${mine.map(t => S(t.title, 40)).join(' · ')}`);
    const busy = R ? Object.values(R.inflight || {}).find(x => x.agent === a.id) : null;
    out.push(`나는 지금: ${busy ? S(busy.text, 30) + ' (작업 중)' : (a.status || '대기 중')}`);
    out.push(`내가 쓴 토큰: ${L(sa.tokens)} (단가 ${a.rate}배 → 가중 ${L(sa.weightedTokens)}), 반 전체 ${L(s.usage.totalTokens)}`);
    const ev = (s.executions.events || []).filter(e => !e.agent || e.agent === a.id).slice(-4)
      .map(e => e.kind + (e.title ? ' ' + S(e.title, 28) : '') + (e.text ? ': ' + S(e.text, 44) : ''));
    if (ev.length) out.push('최근 벌어진 일: ' + ev.join(' / '));
    if (a.quote) out.push(`내가 마지막으로 한 말: ${S(a.quote, 60)}`);
    return out.join('\n');
  }
  reply(a, q) {
    const s = AIGO.state, sa = s.agents.find(x => x.id === a.id) || {};
    if (!sa.modelId) return this._canned(a, q, s, sa);
    const sys = [
      sa.systemPrompt ? '원래 역할 지침: ' + String(sa.systemPrompt).slice(0, 300) : '',
      `너는 교실 그림 속 "${a.label}"(${sa.name || a.name})이고, 옆에 온 친구가 말을 걸었다.`,
      '지나가듯 편하게, 한국어로 두 문장 안에 답해라. 아래 "지금 상황"에 적힌 사실만 쓰고, 없는 건 모른다고 해라. 목록·표·마크다운 금지.',
      '지금 상황:\n' + this._selfContext(a, sa, s),
    ].filter(Boolean).join('\n\n');
    /* gpt-oss 계열은 사고에 상한을 다 써 버리면 본문이 빈 채로 온다 — 사고를 낮추고, 그래도 비면 한 번 더 넉넉히 */
    const c = new AigoClient({ base: this.cfg.proxyBase }), msgs = [{ role: 'system', content: sys }, { role: 'user', content: q }];
    /* 잡담은 빠른 짝 모델로 — 로컬 CLI 다리는 claude-code 옆에 claude-chat(도구 없음·저추론, 4~15초)을 함께 낸다.
       라우터가 그 이름을 실제로 서빙할 때만 바꾼다 (config.chatModels) */
    const served = (s.server && s.server.models) || [], CM = this.cfg.chatModels || {};
    const model = (CM[sa.modelId] && served.includes(CM[sa.modelId])) ? CM[sa.modelId] : sa.modelId;
    const ask = max => c.post('/v1/chat/completions', { model, stream: false, max_tokens: max, temperature: 0.6, reasoning_effort: 'low', messages: msgs })
      .then(r => String((((r.choices || [])[0] || {}).message || {}).content || '').replace(/\s+/g, ' ').trim(), () => '');
    return ask(400).then(t => t || ask(900)).then(t => t || this._canned(a, q, s, sa));
  }
  /* 모델이 없거나 서버가 안 될 때: 상위 변수만 보고 답한다 */
  _canned(a, q, s, sa) {
    if (/상태|뭐 ?해/.test(q)) return `상태 "${sa.status || a.status}". 토큰 ${(sa.tokens || 0).toLocaleString()}, 가중 ${(sa.weightedTokens || 0).toLocaleString()}. 스쿼드: ${s.squad.name || '?'} (${s.executions.running ? '실행 중' : '대기'}).`;
    if (/토큰|비용|예산/.test(q)) return `스쿼드 전체 ${s.usage.totalTokens.toLocaleString()} tok (가중 ${s.usage.weightedTokens.toLocaleString()}), 예산 ${s.budget.maxTotalTokens ? s.budget.maxTotalTokens.toLocaleString() : '?'} 중 ${s.usage.percentOfBudget.toFixed(1)}%.`;
    if (/모델|누구|역할/.test(q)) return `${a.label} — 모델 ${sa.modelId || a.name}, 역할 ${sa.isPlanner ? '플래너(작업을 나누고 모음)' : (sa.roleType || '?')}, 도구 ${(sa.tools || []).length}개.`;
    if (/문제|최근|방금|결과|답/.test(q)) return a.quote || '아직 이번 수업에서 처리한 문제가 없어요.';
    return '지금은 서버에 못 물어봐서 아는 것만 말할 수 있어요 — "상태", "비용", "모델", "최근 결과"를 물어보세요.';
  }
};
/* 소스 레지스트리 등록 (main.js 가 사용) */
Sniffer.sources = Sniffer.sources || {};
Sniffer.sources.live = { create: (d, c) => new Sniffer.Live(d, c), available: cfg => Sniffer.Live.available(cfg) };
