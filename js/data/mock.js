/* =========================================================
   data/mock.js — 서버 없이 도는 데모 시나리오. Director 이벤트 계약만 사용.
   스쿼드 구조는 config.mockAgents 에서 오고, 비트(beat)는 "단가 순위 r1<r2<r3" 참조로 써서
   에이전트 수가 달라도 동작한다 (없는 순위는 가장 가까운 순위로 대체).
   ========================================================= */
window.Sniffer = window.Sniffer || {};

Sniffer.Mock = class Mock {
  constructor(director, cfg) {
    this.d = director; this.cfg = cfg; this.running = false; this.queue = []; this.agentsByRank = [];
    director.costMode = 'event';
  }
  /* r1..rN → 실제 에이전트 id (단가 오름차순). 토큰이 소진된 에이전트는 건너뛰고, 순위가 없으면 가장 가까운 것으로.
     전원 소진이면 null → 비트는 스쿼드 중단(halt)으로 끝난다 */
  R(n) {
    const alive = this.agentsByRank.filter(a => !this.d.isExhausted(a.id));
    if (!alive.length) return null;
    return alive[Math.min(n - 1, alive.length - 1)].id;
  }
  /* 데모 시간표: 비트 순서 = 교시 순서 (시간표 패널의 데이터) */
  static BEATS = [
    { fn: 'bEasy',        title: '일반 문제 · 즉답',      cat: 'generic' },
    { fn: 'bVerifyRetry', title: '수학 · 검산 후 재계산', cat: 'math' },
    { fn: 'bEasy',        title: '일반 문제 · 즉답',      cat: 'generic' },
    { fn: 'bEscalate',    title: '코딩 · 상위 호출',      cat: 'coding' },
    { fn: 'bCutLoss',     title: '수학 최상 · 손절',      cat: 'math' },
    { fn: 'bEasy',        title: '일반 문제 · 즉답',      cat: 'generic' },
    { fn: 'bTopCall',     title: '코딩 결정적 · 최상위 판정', cat: 'coding' },
  ];
  async start() {
    this.running = true;
    const agents = this.cfg.mockAgents.map(m => ({ ...m, rate: this.cfg.rates[m.modelId] || 1 }));
    agents.sort((a, b) => a.rate - b.rate);
    this.agentsByRank = agents;
    for (const a of agents) {
      await this.d.dispatch({ kind: 'spawn', agent: a.id, name: a.name, rate: a.rate, modelId: a.modelId });
      await this.d.dispatch({ kind: 'agent_update', agent: a.id, budgetTokens: this.cfg.theme.mockAgentBudget || 0 });   // mock 전용 가상 한도
    }
    this.plan = Sniffer.Mock.BEATS.map((b, i) => ({ id: 'P' + (i + 1), title: b.title, fn: b.fn, text: undefined }));
    this.cursor = 0;
    await this._pushSchedule();
    await this.d.dispatch({ kind: 'note', text: '수업 시작 — 첫 번째 문제가 칠판에 적힙니다' });
    this._loop();
  }
  stop() { this.running = false; }
  enqueueTask(text, cat) {
    if (!this.running || this.d.halted) { this.d.dispatch({ kind: 'note', text: '스쿼드가 중단되어 새 문제를 받을 수 없습니다', tone: 'warn' }); return; }
    this.queue.push({ text, cat });
    const c = (this.cfg.taskCategories || []).find(x => x.id === cat), beat = c && c.beat ? c.beat : null;
    // 시간표: 현재 교시 바로 다음에 끼워넣음
    const insertAt = Math.min(this.cursor + 1 + this.queue.length - 1, this.plan.length);
    this.plan.splice(insertAt, 0, { id: null, title: '출제: ' + Sniffer.util.short(text, 16), fn: beat, text, user: true });
    this._renumber(); this._pushSchedule();
  }
  queueLength() { return this.queue.length; }
  _renumber() { let n = 0; for (const p of this.plan) p.id = 'P' + (++n); }
  _pushSchedule() {
    const agent = this.R(1) ? (this.d.world.get(this.R(1)) || {}).label || '' : '';
    const prev = new Map((this.d.schedule || []).map(x => [x.id, x.status]));     // 이미 끝난 교시의 결과(done/fail/skipped)는 보존
    return this.d.dispatch({ kind: 'schedule', items: this.plan.map((p, i) => {
      const keep = prev.get(p.id);
      const status = (i < this.cursor && (keep === 'done' || keep === 'fail' || keep === 'skipped')) ? keep
        : i < this.cursor ? 'done' : (i === this.cursor && this._started ? 'now' : 'upcoming');
      return { id: p.id, title: p.title, agent: p.user ? '출제' : agent, status };
    }) });
  }

  async _loop() {
    while (this.running) {
      if (!this.R(1)) {          // 전원 토큰 소진 → 스쿼드 중단
        await this.d.dispatch({ kind: 'halt', reason: 'all_agents_exhausted', text: '모든 에이전트의 토큰 한도 소진 → <b style="color:#ff5d5d">실행 중단</b>' });
        this.running = false; break;
      }
      if (this.cursor >= this.plan.length) {           // 한 바퀴 끝 → 같은 수업을 다음 교시들로 이어감
        const more = Sniffer.Mock.BEATS.map(b => ({ id: null, title: b.title, fn: b.fn }));
        this.plan.push(...more); this._renumber(); await this._pushSchedule();
      }
      const item = this.plan[this.cursor]; this._started = true;
      if (item.user) { this.queue.shift(); await this.d.dispatch({ kind: 'note', text: '출제된 문제가 칠판에 적혔습니다', tone: 'good' }); }
      const fn = item.fn && typeof this[item.fn] === 'function' ? this[item.fn] : this._forCategory(item.cat);
      await fn.call(this, item.text);
      this.cursor++;
      await Sniffer.util.sleep(1500);
    }
  }
  /* 카테고리 → 비트: config.taskCategories[].beat (없으면 무작위) */
  _forCategory(cat) {
    const c = (this.cfg.taskCategories || []).find(x => x.id === cat);
    if (c && c.beat && typeof this[c.beat] === 'function') return this[c.beat];
    const pool = (this.cfg.taskCategories || []).map(x => x.beat).filter(b => b && typeof this[b] === 'function');
    return pool.length ? this[pool[Math.floor(Math.random() * pool.length)]] : this.bEasy;
  }

  /* ---------- 비트: 전부 이벤트 나열일 뿐 (연출 로직 없음) ---------- */
  /* 비트 도중 담당 에이전트가 소진되면 남은 비트를 끊는다(소진 직후 '재계산 중' 같은 모순 방지) */
  async _seq(list) {
    for (const ev of list) {
      if (!this.running) return;
      if (ev.agent && ev.kind !== 'idle' && ev.kind !== 'leave' && this.d.isExhausted(ev.agent)) {
        if (ev.kind !== 'task_start') await this.d.dispatch({ kind: 'submit', ok: false, by: ev.agent, note: '담당 에이전트 토큰 소진 — 미완으로 제출' });
        return;
      }
      await this.d.dispatch(ev);
    }
  }
  async bEasy(text) {
    const r1 = this.R(1);
    await this._seq([
      { kind: 'task_start', agent: r1, text, category: 'generic · 난이도 하' },
      { kind: 'say', agent: r1, text: '이건 즉답 가능. 사고 토큰 안 씀.', ms: 1300 },
      { kind: 'working', agent: r1, tokens: 110, ms: 1100, text: '즉답 작성 중' },
      { kind: 'verify', agent: r1, ok: true, method: '형식 검사' },
      { kind: 'submit', ok: true, by: r1, note: '원콜 해결 (최저 단가)' },
    ]);
  }
  async bVerifyRetry(text) {
    const r1 = this.R(1);
    await this._seq([
      { kind: 'task_start', agent: r1, text, category: 'math · 난이도 중' },
      { kind: 'working', agent: r1, tokens: 380, ms: 1600, text: '풀이 중 (사고 상한)' },
      { kind: 'say', agent: r1, text: '답 나옴. 구거법(mod 9)으로 검산…', ms: 1200 },
      { kind: 'working', agent: r1, tokens: 40, ms: 400 },
      { kind: 'verify', agent: r1, ok: false, method: 'mod 9', note: '검산(수십 토큰)이 비싼 오답 제출을 막았습니다' },
      { kind: 'retry', agent: r1, text: '산술 오류다. 지우고 다시.' },
      { kind: 'working', agent: r1, tokens: 300, ms: 1400, text: '재계산 중' },
      { kind: 'verify', agent: r1, ok: true, method: 'mod 9 · mod 11' },
      { kind: 'submit', ok: true, by: r1, note: '검산 1회 불합격 후 자체 해결' },
    ]);
  }
  async bEscalate(text) {
    const r1 = this.R(1), r2 = this.R(2);
    await this._seq([
      { kind: 'task_start', agent: r1, text, category: 'coding · 난이도 상' },
      { kind: 'working', agent: r1, tokens: 450, ms: 1600, text: '코드 작성 중' },
      { kind: 'verify', agent: r1, ok: false, method: '2-샘플 일치', note: '두 샘플이 다르다 — 저확신' },
      { kind: 'escalate', agent: r1, to: r2, reason: '저확신', text: '이 문제요. 문제랑 제 후보 답만 드릴게요.', payload: '풀이과정 재전송 없음', note: '핸드오프는 대화가 아니라 태그 — 문제+후보답만' },
      { kind: 'say', agent: r2, text: '받았어. effort는 낮게 간다.', ms: 1300 },
      { kind: 'working', agent: r2, tokens: 520, ms: 1900, text: '검토 중 (low effort)' },
      { kind: 'verify', agent: r2, ok: true, text: '내 답, 네 후보랑 일치. 확정.' },
      { kind: 'submit', ok: true, by: r2, note: '상위 호출 1회로 종결' },
      { kind: 'idle', agent: r1 },
    ]);
  }
  async bCutLoss(text) {
    const r1 = this.R(1), r2 = this.R(2);
    await this._seq([
      { kind: 'task_start', agent: r1, text, category: 'math · 난이도 최상' },
      { kind: 'working', agent: r1, tokens: 430, ms: 1500, text: '풀이 중' },
      { kind: 'verify', agent: r1, ok: false, method: 'mod 9' },
      { kind: 'retry', agent: r1 }, { kind: 'working', agent: r1, tokens: 200, ms: 900 },
      { kind: 'verify', agent: r1, ok: false, method: '재계산' },
      { kind: 'escalate', agent: r1, to: r2, reason: '검증 2회 실패', text: '후보 답 A입니다.' },
      { kind: 'working', agent: r2, tokens: 560, ms: 1800, text: '독립 재풀이' },
      { kind: 'say', agent: r2, text: '내 답은 B. 불일치다. 상위 호출 판정 대기…', ms: 1600 },
      { kind: 'budget', verdict: 'cut_loss', gain: 0.14, threshold: 0.25, text: '더 비싼 호출의 기대이득이 기준 미만 — 현재 답 제출 후 손절' },
      { kind: 'say', agent: r2, text: '판정: 손절. 현재 답 내고 다음 문제로.', ms: 1400 },
      { kind: 'submit', ok: false, by: r2, note: '검증 2회 불합격, 최상위 호출 없이 손절' },
      { kind: 'idle', agent: r1 },
    ]);
  }
  async bTopCall(text) {
    const r1 = this.R(1), r2 = this.R(2), r3 = this.R(3);
    await this._seq([
      { kind: 'task_start', agent: r1, text, category: 'coding · 결정적 문제' },
      { kind: 'working', agent: r1, tokens: 420, ms: 1400, text: '풀이 중' },
      { kind: 'verify', agent: r1, ok: false, method: '2-샘플' },
      { kind: 'escalate', agent: r1, to: r2, reason: '저확신', text: '이것 좀 봐주세요.' },
      { kind: 'working', agent: r2, tokens: 540, ms: 1600, text: '독립 재풀이' },
      { kind: 'say', agent: r2, text: '불일치. 근데 이건 기대이득이 기준을 넘는다.', ms: 1500 },
      { kind: 'budget', verdict: 'escalate', gain: 0.41, threshold: 0.25 },
      ...(r3 && r3 !== r2 ? [
        { kind: 'handoff', agent: r2, to: r3, text: '두 후보입니다. 판정 부탁드립니다.', payload: '후보 2개만 전달', note: '최상위 호출 — 가장 비싼 구간' },
        { kind: 'say', agent: r3, text: '두 후보만 보면 된다. 최후심급으로 판정한다.', ms: 1600 },
        { kind: 'working', agent: r3, tokens: 700, ms: 2200, text: '최종 판정' },
        { kind: 'verify', agent: r3, ok: true, text: '두 번째 후보가 맞다. 종결.' },
        { kind: 'submit', ok: true, by: r3, note: '최상위 판정으로 정답' },
        { kind: 'leave', agent: r3 },
      ] : [
        { kind: 'working', agent: r2, tokens: 300, ms: 1200, text: '재검토' },
        { kind: 'verify', agent: r2, ok: true },
        { kind: 'submit', ok: true, by: r2 },
      ]),
      { kind: 'idle', agent: r1 },
    ]);
  }

  /* 대화 응답(목업) */
  reply(a, q) {
    const th = this.cfg.theme;
    if (/상태|뭐 ?해|근황/.test(q)) return `지금 상태는 "${a.status}"예요. 처리 ${a.handled}건, 소모 ${(a.weightedTokens || 0).toLocaleString()} ${th.taximeter ? 'wtok' : 'tok'}.`;
    if (/토큰|비용|돈|예산|얼마/.test(q)) return th.taximeter ? `제 단가는 ${a.rate}×라 쓰는 토큰이 ${a.rate}배로 찍혀요. 지금까지 ${(a.weightedTokens || 0).toLocaleString()} wtok.` : `지금까지 ${a.tokens} 토큰 썼어요.`;
    if (/문제|지금|최근|방금/.test(q)) return a.quote || '아직 처리한 문제가 없어요.';
    if (/누구|소개|이름|역할/.test(q)) return `${a.label}입니다. 모델은 ${a.name}${th.taximeter ? `, 단가 ${a.rate}×` : ''}.`;
    if (/손절|포기/.test(q)) return '손절은 예산 판정이에요. 더 비싼 호출의 기대 이득이 기준 아래면 현재 답을 내고 다음으로 넘어갑니다.';
    return '그건 제 범위 밖이네요. "상태", "최근 문제", "비용", "역할"을 물어보시면 정확히 답해요.';
  }
};
/* 소스 레지스트리 등록 (main.js 가 사용) */
Sniffer.sources = Sniffer.sources || {};
Sniffer.sources.mock = { create: (d, c) => new Sniffer.Mock(d, c), available: async () => ({ ok: true }) };
