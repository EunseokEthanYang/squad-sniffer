/* =========================================================
   engine/director.js — 이벤트 → 연출. 데이터 소스(live/mock)와 화면 사이의 유일한 계약.
   -----------------------------------------------------------------
   이벤트 계약 (kind 어휘). agent/to/by 는 엔티티 id. 모든 필드는 아래가 전부다.
     spawn        { agent, name, rate?, label?, color?, modelId?, tier? }      에이전트 등장(좌석 자동, 같은 단가 중복 시 라벨 A/B·색 변주)
     agent_update { agent, rate?, label?, tokens?, weightedTokens?, status? } 상위 변수 동기화(라벨 재렌더)
     task_start   { taskId?, text?, category?, agent? }                       칠판에 문제, (agent가 있으면) 받으러 감
     working      { agent, tokens?, text?, ms? }                              작업 애니 + 비용 증가(event 모드). 숨겨진 에이전트면 먼저 등장
     say          { agent, text, ms?, think? }
     verify       { agent?, ok, method?, text?(말풍선), note?(자막) }          채점 ○/✗
     retry        { agent, text? }
     handoff      { agent(from), to, text?, payload?, note? }                 걸어가서 전달 (to가 안 보이면 먼저 등장)
     escalate     { agent(from), to, reason?, text?, payload?, note? }        판정카드 + handoff
     budget       { verdict:'cut_loss'|'escalate'|'warn', gain?, threshold?, text?, to? }
     enter        { agent, text? }  /  leave { agent, text? }                 문으로 등장/퇴장
     submit       { ok, by?, taskId?, note? }
     idle         { agent }                                                   자리로 복귀 (교탁 담당은 퇴장)
     note         { text, tone?:'good'|'warn', trace? }                       자막
     board        { html }                                                    칠판 텍스트(라이브 보조; 진행 중 문제가 없을 때만)
     meter        { value }                                                   미터 절대값(absolute 모드)
     schedule     { items:[{ id?, title, agent?, status?:'done'|'fail'|'now'|'upcoming' }] }  시간표(교시별 계획). task_start/submit 이 상태를 갱신
   소리: task_start→audio.on.taskStart, submit→submitOk/submitFail, enter→enter, budget warn→budgetWarn (config.audio)
   dispatch(ev) 는 해당 연출이 끝나면 resolve 되는 Promise. 같은 agent 의 이벤트는 순서대로, 다른 agent 는 병렬.
   주의: 핸들러 안에서 같은 agent 키로 dispatch 를 await 하면 데드락 — 내부 메서드(_handoff/_enter/_leave)를 직접 호출할 것.
   ========================================================= */
window.Sniffer = window.Sniffer || {};

Sniffer.Director = class Director {
  /* halt 상태에서도 통과시키는 이벤트 종류(상태 동기화·재개·정리) */
  static PASS_WHEN_HALTED = new Set(['spawn', 'agent_update', 'meter', 'note', 'board', 'schedule', 'halt', 'resume', 'leave', 'idle', 'exhausted']);
  constructor(world, ui, cfg) {
    this.world = world; this.ui = ui; this.cfg = cfg; this.th = cfg.theme; this.col = cfg.colors;
    this.costMode = 'event';
    this.meterValue = 0;
    this.stats = { prob: 0, done: 0, correct: 0, cut: 0, callsByRate: {}, baseRate: 1 };
    this.queues = new Map(); this.gq = Promise.resolve(); this.currentTask = null;
    this.schedule = [];
    ui.setStats(this.stats);
  }
  /* 종소리 (config.audio.on 의 이벤트 키 → 종 종류) */
  _bell(eventKey) { const A = Sniffer.Audio, on = (this.cfg.audio || {}).on || {}; const kind = on[eventKey]; if (A && kind) A.bell(kind); }
  /* 시간표 상태 갱신 */
  /* 이모트: config.theme.emotes.on[evKey] → map/colors/hop 로 world.emote() 호출 (설정 없으면 무음) */
  _emote(e, evKey, ms) {
    const EM = this.th.emotes; if (!EM || EM.enabled === false || !e || !e.visible) return;
    const key = EM.on && EM.on[evKey]; if (!key) return;
    const sym = (EM.map || {})[key]; if (!sym) return;
    this.world.emote(e, sym, { color: (EM.colors || {})[key], ms: ms || EM.ms || 1500, hop: (EM.hop || []).includes(key) });
  }
  _schedMark(taskId, status) {
    let it = taskId ? this.schedule.find(x => x.id === taskId) : null;
    if (!it && status === 'now') it = this.schedule.find(x => x.status === 'upcoming');
    if (!it && status !== 'now') it = this.schedule.find(x => x.status === 'now');
    if (!it) return;
    if (status === 'now') for (const x of this.schedule) if (x.status === 'now') x.status = 'done';
    it.status = status; this.ui.renderTimetable(this.schedule);
  }
  /* 현재 교시 항목의 단계/세부(담당 흐름·검증 실패·상위 호출·손절·비용) 갱신 — 시간표 클릭 시 보이는 "숨긴 정보" */
  _cur() { return this.schedule.find(x => x.status === 'now') || null; }
  _stage(stage, patch) {
    const it = this._cur(); if (!it) return;
    if (stage) it.stage = stage;
    if (patch) { if (patch.pushPath) { it.path = it.path || []; if (it.path[it.path.length - 1] !== patch.pushPath) it.path.push(patch.pushPath); } if (patch.verifyFail) it.verifyFail = (it.verifyFail || 0) + 1; if (patch.escalated) it.escalated = true; if (patch.cut) it.cut = true; if (patch.cost != null) it.cost = patch.cost; }
    this.ui.renderTimetable(this.schedule);
  }
  reset() {
    this.queues = new Map(); this.gq = Promise.resolve(); this.currentTask = null; this.schedule = []; this.halted = false;
    this.stats = { prob: 0, done: 0, correct: 0, cut: 0, callsByRate: {}, baseRate: 1 }; this.meterValue = 0;
    this.world.clearAgents(); this.ui.resetAgents();
    this.ui.setStats(this.stats); this.ui.setMeterTarget(0); this.ui.setLamps([], {});
    this.ui.burnOurs = [0]; this.ui.burnLine = [0];
  }
  _q(key, fn) { const prev = this.queues.get(key) || Promise.resolve(); const next = prev.then(fn, fn); this.queues.set(key, next); return next; }
  _ent(id) { return id ? this.world.get(id) : null; }
  _baseRate() { const rs = this.world.agents().map(a => a.rate || 1); return rs.length ? Math.min(...rs) : 1; }
  _refreshLamps() {
    const m = {}; for (const a of this.world.agents()) { const r = a.rate || 1; if (!m[r]) m[r] = a.color; }
    this.ui.setLamps(Object.keys(m).map(Number).sort((a, b) => a - b), m);
    this.stats.baseRate = this._baseRate(); this.ui.setStats(this.stats);
  }
  /* 토큰 소진 판정: 한도는 ent.budgetTokens 만 본다(live = 서버 budget.maxTokensPerAgent, mock = spawn 직후 agent_update 로 주입). 없으면 소진 없음 */
  capOf(ent) { return ent.budgetTokens || 0; }
  _checkExhausted(ent) {
    const cap = this.capOf(ent);
    if (cap && ent.tokens >= cap && !ent.exhausted) { ent.exhausted = true; this.dispatch({ kind: 'exhausted', agent: ent.id }); }
  }
  isExhausted(id) { const e = this._ent(id); return !!(e && e.exhausted); }
  addCost(ent, tokens) {
    if (!tokens) return;
    ent.tokens += tokens; ent.weightedTokens += Math.round(tokens * (ent.rate || 1));
    this.ui.updateGauge(ent); this._checkExhausted(ent);
    if (this.costMode === 'event') { this.meterValue += this.th.taximeter ? Math.round(tokens * (ent.rate || 1)) : tokens; this.ui.setMeterTarget(this.meterValue); }
  }
  _countCall(to) { if ((to.rate || 1) > this._baseRate()) { this.stats.callsByRate[to.rate] = (this.stats.callsByRate[to.rate] || 0) + 1; this.ui.setStats(this.stats); } }
  _tierColor(rate) { const tc = this.cfg.tierColors; return tc[rate] || tc[Math.max(...Object.keys(tc).map(Number))] || this.col.warn; }

  /* ---------- 내부 연출 (큐를 거치지 않음: 핸들러끼리 재사용) ---------- */
  async _ensureVisible(e) { if (e && !e.visible && !e.isPlayer) await this._enter(e); }
  async _enter(e, text) {
    const U = this.ui; if (!e || e.visible) return;
    this._bell('enter'); U.setFocus(e.id);
    U.annotate(text || `드르륵 — ${e.label} 등장${this.th.taximeter ? ` (${e.rate}× 구간)` : ''}`, 'warn');
    await this.world.enterFromDoor(e, e.home); if (e.isTeacher) U.teacherPresence(e, true); e.status = '판정 중';
  }
  async _leave(e, text) {
    const U = this.ui; if (!e || !e.visible) return;
    await this.world.leaveByDoor(e); if (e.isTeacher) U.teacherPresence(e, false); e.status = '부재';
    U.annotate(text || `${e.label} 퇴장 — 자리가 다시 빕니다`, 'good');
  }
  async _handoff(from, to, ev) {
    const W = this.world, U = this.ui, S = Sniffer.util.sleep;
    if (!to.visible) await this._q(to.id, () => this._enter(to));          // to 의 큐에서 등장 (from 큐와 다른 키 → 안전)
    const spot = W.approachSpot(to);
    await W.walkFront(from, spot.x, spot.y); U.cardTo(from);
    U.bubble(from, ev.text || `${to.label}, 이 문제 부탁해요.${ev.payload ? '\n(' + ev.payload + ')' : ''}`, 2000); await S(2000);
    U.cardTo(to); to.handled++; to.status = '검토 중'; this._countCall(to); U.setFocus(to.id);
    this._stage(`${to.label} 검토 중`, { pushPath: to.label, escalated: (to.rate || 1) > this._baseRate() });
    U.trace({ ev: 'handoff', from: from.id, to: to.id, payload: ev.payload || null }, 'tEv');
    U.annotate(ev.note || `핸드오프: ${from.label} → ${to.label}`, '');
    this._q(from.id, () => W.goHome(from));
  }

  dispatch(ev) {
    const k = ev.kind, S = Sniffer.util.sleep, W = this.world, U = this.ui;
    const who = ev.agent ? String(ev.agent) : null;
    /* 중단(halt) 뒤에는 상태성 이벤트만 통과 — 연출 이벤트(working/say/task_start…)가 '중단'을 덮어쓰지 않게 */
    const PASS = Director.PASS_WHEN_HALTED;
    const run = fn => (this.halted && !PASS.has(k)) ? Promise.resolve() : (who ? this._q(who, fn) : (this.gq = this.gq.then(fn, fn)));
    switch (k) {
      case 'spawn': return run(async () => {
        if (W.get(who)) return;
        const idx = W.agents().length, rate = ev.rate || 1;
        const dup = W.agents().filter(a => (a.rate || 1) === rate).length;       // 같은 단가 중복 수
        const baseLabel = ev.label || this.cfg.roleLabels[rate] || ev.name || who;
        const baseColor = ev.color || this.cfg.tierColors[rate] || this.cfg.palette[idx % this.cfg.palette.length];
        const sh = dup ? Sniffer.util.shade(baseColor, dup) : { color: baseColor, filter: '' };
        const e = W.addAgent({ id: who, name: ev.name || who, rate, label: dup && !ev.label ? `${baseLabel} ${String.fromCharCode(65 + dup)}` : baseLabel,
          color: sh.color, tintFilter: sh.filter, modelId: ev.modelId, tier: ev.tier });
        U.agentTag(e); this._refreshLamps(); U.trace({ ev: 'spawn', agent: e.id, name: e.name, rate, label: e.label }, 'tEv');
      });
      case 'agent_update': return run(async () => {
        const e = this._ent(who); if (!e) return;
        let relabel = false;
        if (ev.rate != null && ev.rate !== e.rate) { e.rate = ev.rate; relabel = true; }
        if (ev.label && ev.label !== e.label && !/ [A-Z]$/.test(e.label)) { e.label = ev.label; relabel = true; }
        if (ev.tokens != null) e.tokens = ev.tokens; if (ev.weightedTokens != null) e.weightedTokens = ev.weightedTokens;
        if (ev.budgetTokens != null) e.budgetTokens = ev.budgetTokens;
        if (ev.status) e.status = ev.status;
        if (relabel) { U.agentTag(e); this._refreshLamps(); W.refreshSheet(e); } else U.updateGauge(e);
        this._checkExhausted(e);
      });
      /* 토큰 소진: 연필이 다 닳음 → 더 못 품. 다른 에이전트가 이어받는다 */
      case 'exhausted': return run(async () => {
        const e = this._ent(who); if (!e) return; e.exhausted = true; e.status = '토큰 소진';
        U.updateGauge(e);
        this._emote(e, 'exhausted', 2600); if (e.visible) U.bubble(e, '연필이 다 닳았어요… 더는 못 풀어요', 2600);          // 부재자(문 밖)에겐 말풍선 없음
        U.annotate(ev.note || `${e.label} 토큰 한도 소진 — 더는 작업하지 않습니다`, 'warn');
        U.trace({ ev: 'exhausted', agent: e.id, tokens: Math.round(e.tokens) }, 'tCut'); if (e.visible) await S(1200);
        this._q(e.id, async () => { if (!e.isTeacher) await W.goHome(e); e.status = '토큰 소진'; });
      });
      /* 스쿼드 전체 예산 초과/비상정지/전원 소진: 실행 중단 */
      case 'halt': return run(async () => {
        if (this.halted) return; this.halted = true;
        U.setFocus(null); U.setActiveRate(0); for (const a of W.agents()) this._emote(a, 'halt', 2200);
        const title = ev.reason === 'emergency_stop' ? '비상 정지' : ev.reason === 'all_agents_exhausted' ? '토큰 소진' : '예산 소진';
        await U.showVerdict(title, ev.text || '스쿼드 총 예산 초과 → <b style="color:' + this.col.bad + '">실행 중단</b>', false, 3200);
        U.annotate(ev.note || '스쿼드가 멈췄습니다 — 남은 문제는 처리되지 않습니다', 'warn');
        U.trace({ ev: 'halt', reason: ev.reason || 'budget_exceeded' }, 'tCut');
        for (const a of W.agents()) {
          a.working = false; a.status = '중단';
          this._q(a.id, async () => { if (a.isTeacher) { if (a.visible) await this._leave(a, `${a.label} 퇴장`); } else await W.goHome(a); a.status = '중단'; });
        }
        for (const it of this.schedule) if (it.status === 'upcoming' || it.status === 'now') it.status = 'skipped';
        U.renderTimetable(this.schedule);
      });
      /* 예산 초과 해제(라이브에서 exceeded 가 false 로 돌아옴): 재개 */
      case 'resume': return run(async () => {
        if (!this.halted) return; this.halted = false;
        for (const a of W.agents()) if (a.status === '중단') a.status = a.visible ? '대기 중' : '부재';
        U.annotate(ev.text || '예산 초과 해제 — 스쿼드 재개', 'good'); U.trace({ ev: 'resume' }, 'tEv');
      });
      case 'task_start': return run(async () => {
        this.stats.prob++; U.setStats(this.stats);
        const label = ev.taskId ? String(ev.taskId) : 'P' + this.stats.prob;
        this.currentTask = { id: label, text: ev.text || '', category: ev.category || '' };
        U.setBoard(`${label}${ev.category ? ' · ' + ev.category : ''}<small>${Sniffer.util.short(ev.text || '벤치마크 문제', 30)}</small>`);
        U.newCard(label); this._schedMark(label, 'now'); this._bell('taskStart');
        this._taskCost0 = this.meterValue;
        const e = this._ent(who);
        this._stage('접수', e ? { pushPath: e.label } : null);
        if (e) {
          U.setFocus(e.id); await this._ensureVisible(e);
          const p = this.cfg.world.boardPickup; await W.walkFront(e, p.x, p.y); U.cardTo(e);
          this._emote(e, 'taskStart'); U.bubble(e, `${label} 받았습니다${ev.category ? '. 분류: ' + ev.category : ''}`, 1400); e.status = label + ' 접수'; await S(1400);
          await W.goHome(e);
        }
        U.trace({ ev: 'task_start', task: label, category: ev.category, text: Sniffer.util.short(ev.text, 40) }, 'tEv');
      });
      case 'working': return run(async () => {
        const e = this._ent(who); if (!e) return;
        if (e.exhausted) { if (e.visible) U.bubble(e, '…', 600, true); return; }     // 소진된 에이전트는 더 일하지 않음(비용·애니 없음)
        await this._ensureVisible(e);
        e.working = true; e.status = ev.text || '작업 중'; U.bubble(e, ev.text && ev.text.length < 30 ? ev.text : '…', ev.ms || 1200, true); U.setActiveRate(e.rate);
        if (e.id === U.focusId) this._stage(ev.text ? Sniffer.util.short(ev.text, 14) : '풀이 중');
        const ms = ev.ms || 1200, steps = Math.max(1, Math.round(ms / 120)), per = (ev.tokens || 0) / steps;
        try { for (let i = 0; i < steps; i++) { this.addCost(e, per); if (e.exhausted) break; await S(ms / steps); } }   // 한도 도달 즉시 중단
        finally { e.working = false; U.setActiveRate(0); }
      });
      case 'say': return run(async () => { const e = this._ent(who); if (!e) return; await this._ensureVisible(e); e.quote = ev.text; U.bubble(e, ev.text, ev.ms || 1500, ev.think); await S(ev.ms || 1500); });
      case 'verify': return run(async () => {
        const e = this._ent(who); if (e) await this._ensureVisible(e); U.cardStamp(!!ev.ok);
        if (e) { this._emote(e, ev.ok ? 'verifyOk' : 'verifyFail'); U.bubble(e, ev.text || (ev.ok ? `검증 ○${ev.method ? ' (' + ev.method + ')' : ''}` : `✗ 검증 실패${ev.method ? ' (' + ev.method + ')' : ''}`), 1400); }
        if (!ev.ok) U.annotate(ev.note || '검증이 오답 제출을 막았습니다', 'warn');
        this._stage(ev.ok ? '검증 통과' : '검증 실패', ev.ok ? null : { verifyFail: true });
        U.trace({ ev: 'verify', agent: who, ok: !!ev.ok, method: ev.method }, ev.ok ? 'tEv' : 'tWarn'); await S(1200);
      });
      case 'retry': return run(async () => { const e = this._ent(who); U.cardReset(); this._stage('다시 풀기'); if (e) { await this._ensureVisible(e); this._emote(e, 'retry'); U.bubble(e, ev.text || '다시 풀어봅니다', 1200); e.status = '재시도'; } await S(900); });
      case 'handoff': return run(async () => { const from = this._ent(who), to = this._ent(ev.to); if (!from || !to || from === to) return; await this._ensureVisible(from); await this._handoff(from, to, ev); });
      case 'escalate': return run(async () => {
        const from = this._ent(who), to = this._ent(ev.to); if (!from || !to || from === to) return; await this._ensureVisible(from);
        this._emote(from, 'escalate'); U.bubble(from, '✋ ' + (to.label || '') + '!', 1200); await S(1200);
        await U.showVerdict('에스컬레이션', `${ev.reason || '저확신'} → <b style="color:${to.color}">${this.th.taximeter ? to.rate + '× 요금 시작' : to.label + ' 호출'}</b>`, true, 2000);
        await this._handoff(from, to, ev);
      });
      case 'budget': return run(async () => {
        const g = ev.gain != null ? Math.round(ev.gain * 100) + '%' : null, t = ev.threshold != null ? Math.round(ev.threshold * 100) + '%' : null;
        const callColor = (this._ent(ev.to) || {}).color || this._tierColor(ev.rate);
        if (ev.verdict === 'cut_loss') {
          this.stats.cut++; U.setStats(this.stats); this._stage('손절 판정', { cut: true }); this._emote(this._ent(who), 'cutLoss');
          await U.showVerdict('호출 판정', (g && t ? `이득 <b style="color:${this.col.loss}">${g}</b> &lt; 기준 <b>${t}</b> → ` : '') + `<b style="color:${this.col.bad}">손절</b>`, false, 2800);
          U.annotate(ev.text || '추가 과금 대비 이득이 기준 미만 — 현재 답으로 손절', 'warn'); U.trace({ ev: 'budget', verdict: 'cut_loss', gain: ev.gain, threshold: ev.threshold }, 'tCut');
        } else if (ev.verdict === 'escalate') {
          await U.showVerdict('호출 판정', (g && t ? `이득 <b style="color:${this.col.good}">${g}</b> &gt; 기준 <b>${t}</b> → ` : '') + `<b style="color:${callColor}">호출</b>`, true, 2800);
          U.trace({ ev: 'budget', verdict: 'escalate', gain: ev.gain, threshold: ev.threshold }, 'tEv');
        } else { this._bell('budgetWarn'); this._emote(this._ent(who), 'budgetWarn'); U.annotate(ev.text || '예산 경고', 'warn'); U.trace({ ev: 'budget', verdict: ev.verdict || 'warn' }, 'tWarn'); }
      });
      case 'schedule': return run(async () => {
        const prev = new Map(this.schedule.map(x => [x.id, x]));
        this.schedule = (ev.items || []).map((it, i) => {
          const id = it.id != null ? String(it.id) : 'P' + (i + 1), old = prev.get(id) || {};
          let status = it.status || 'upcoming';
          if (this.halted && (status === 'upcoming' || status === 'now')) status = 'skipped';   // 중단 뒤 재전송이 '진행 중'으로 되돌리지 않게
          return Object.assign({}, old, { id, no: it.no != null ? it.no : old.no, title: it.title || old.title || '', agent: it.agent || old.agent || null, status });
        });
        U.renderTimetable(this.schedule);
      });
      case 'enter': return run(async () => this._enter(this._ent(who), ev.text));
      case 'leave': return run(async () => this._leave(this._ent(who), ev.text));
      case 'submit': return run(async () => {
        U.cardResult(!!ev.ok); this.stats.done++; if (ev.ok) this.stats.correct++; U.setStats(this.stats);
        this._stage(ev.ok ? '제출 완료' : '제출(오답)', { cost: Math.max(0, this.meterValue - (this._taskCost0 || 0)) });
        this._schedMark(this.currentTask && this.currentTask.id, ev.ok ? 'done' : 'fail'); this._bell(ev.ok ? 'submitOk' : 'submitFail');
        U.setFocus(null);
        U.pushBurn(this.meterValue); U.trace({ ev: 'submit', ok: !!ev.ok, by: ev.by || who, task: this.currentTask && this.currentTask.id }, 'tEv');
        if (ev.note) U.annotate(ev.note, ev.ok ? 'good' : 'warn');
        const e = this._ent(ev.by || who); if (e) { e.handled++; this._emote(e, ev.ok ? 'submitOk' : 'submitFail'); }
      });
      case 'idle': return run(async () => { const e = this._ent(who); if (!e) return; if (e.isTeacher) { if (e.visible) await this._leave(e); } else await W.goHome(e); });
      case 'note': return run(async () => { U.annotate(ev.text, ev.tone); if (ev.trace) U.trace(ev.trace, 'tEv'); });
      case 'board': return run(async () => { if (!this.currentTask) U.setBoard(ev.html || ''); });
      case 'meter': return run(async () => { this.meterValue = ev.value || 0; this.ui.setMeterTarget(this.meterValue); });
      default: return run(async () => { U.trace({ ev: 'unknown', raw: ev }, 'tWarn'); });
    }
  }
};
