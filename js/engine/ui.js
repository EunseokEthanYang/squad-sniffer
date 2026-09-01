/* =========================================================
   engine/ui.js — DOM 오버레이: 라벨·말풍선·카드·자막·판정카드·HUD 미터·대화(미연시/웹)·문제내기·Nerd
   월드 좌표 → 화면 좌표 변환은 world.toScreen 사용. 스쿼드 구조를 모른다.
   ========================================================= */
window.Sniffer = window.Sniffer || {};

Sniffer.UI = class UI {
  constructor(world, cfg) {
    this.world = world; this.cfg = cfg; this.th = cfg.theme;
    const $ = id => document.getElementById(id);
    this.overlay = $('overlay');
    this.el = {
      meterVal: $('meterVal'), lamps: $('lamps'), probStat: $('probStat'), srcChip: $('srcChip'),
      verdict: $('verdict'), subs: $('subs'), talkHint: $('talkHint'), trace: $('trace'),
      vnBox: $('vnBox'), chatPanel: $('chatPanel'), taskModal: $('taskModal'), nerd: $('nerd'), nerdBtn: $('nerdBtn'),
      modeBtn: $('modeBtn'), queueBadge: $('queueBadge'), burn: $('burn'),
    };
    this.tags = []; this.bubbles = new Map();
    this.card = null; this.cardPos = { x: 0, y: 0 }; this.cardFollow = null; this.cardLabel = '';
    this.meter = { shown: 0, target: 0 };
    this.burnOurs = [0]; this.burnLine = [0];
    this.chatMode = 'vn'; this.chatAgent = null; this.chatLogs = {}; this._vnTimer = null;
    this.onTask = null;          // (text, cat) => void
    this.replyProvider = null;   // (ent, question) => string
    this.t0 = performance.now();
    /* 생각 박스 포커스 정책: 카드를 든 에이전트(focus)·가까이 간 에이전트·대화 중인 에이전트만 전체 말풍선, 나머지는 작은 점(pip) */
    this.focusId = null; this.nearId = null; this.pips = new Map(); this.maxFull = (this.th.maxBubbles || 2);
    this._wireChat(); this._wireTask(); this._wireNerd(); this._wireTimetable(); this._wireBell(); this._wireGear();
    this.boardText = document.createElement('div'); this.boardText.id = 'boardText'; this.overlay.appendChild(this.boardText);
    this.boardText._wx = cfg.world.board.x; this.boardText._wy = cfg.world.board.y; this.tags.push(this.boardText);
    this.setBoard('오늘의 문제<small>대기 중…</small>');
    this.teacherTag = null;
    const mt = document.querySelector('#meterBox .mlabel'); if (mt) mt.textContent = cfg.text.meterTitle || (this.th.taximeter ? 'TAXIMETER' : 'TOKENS');
  }

  /* ---------- 소스 칩 ---------- */
  setSource(kind, text) { this.el.srcChip.textContent = text; this.el.srcChip.className = kind; }

  /* ---------- 월드 고정 라벨 ---------- */
  tag(x, y, html, cls) { const d = document.createElement('div'); d.className = 'tag' + (cls ? ' ' + cls : ''); d.innerHTML = html; d._wx = x; d._wy = y; this.overlay.appendChild(d); this.tags.push(d); return d; }
  agentTag(ent) {
    const html = `${ent.label}<small>${ent.name}${ent.rate && this.th.taximeter ? ' · ' + ent.rate + '×' : ''}</small>` + this._gaugeHtml(ent);
    if (ent._tag) { ent._tag.innerHTML = html; return; }
    /* 이름표는 캐릭터를 따라다닌다(발 아래). 표시 여부는 tick 의 정책(theme.tags) */
    ent._tag = this.tag(ent.x, ent.y + 24, html, 'agentTag'); ent._tag._follow = ent;
    if (ent.isTeacher) {
      /* 교탁 위 작은 분필 메모: 선생님이 없을 때만 보임 */
      const d = this.cfg.world.teacherDesk, T = this.cfg.text;
      this.teacherTag = this.tag(d.x + d.w / 2, d.y + 14, `<span class="chalk">${ent.label} ${T.teacherAbsent}</span><small>${T.teacherAbsentSub}</small>`, 'teacherNote');
      this.teacherPresence(ent, false);
    }
  }
  _tagMode() { return localStorage.getItem('sniffer_tags') || this.th.tags || 'auto'; }
  _tagVisible(ent) {
    const m = this._tagMode(); if (m === 'never') return false; if (m === 'always') return ent.visible;
    return ent.visible && (ent.id === this.focusId || ent.id === this.nearId || ent.working || ent.moving || (this.chatAgent && this.chatAgent.id === ent.id));
  }
  /* 에이전트별 토큰 소모 게이지 (연필이 닳는 은유). used/budget 은 ent.tokens / ent.budgetTokens */
  _gaugeHtml(ent) {
    const mode = this.th.agentGauge; if (!mode || mode === 'none') return '';
    const used = ent.tokens || 0, cap = ent.budgetTokens || 0;        // 한도는 ent.budgetTokens 만 (mock 은 spawn 때 주입)
    const left = cap ? Math.max(0, Math.min(1, 1 - used / cap)) : 1;
    const pct = Math.round(left * 100), warn = left < 0.25;
    return `<span class="gauge ${mode}${warn ? ' warn' : ''}" title="사용 ${used.toLocaleString()} tok${cap ? ' / 한도 ' + cap.toLocaleString() : ''}"><i style="width:${pct}%"></i></span>`;
  }
  updateGauge(ent) {
    if (!ent._tag) return; const g = ent._tag.querySelector('.gauge'); if (!g) { this.agentTag(ent); return; }
    const used = ent.tokens || 0, cap = ent.budgetTokens || 0;
    const left = cap ? Math.max(0, Math.min(1, 1 - used / cap)) : 1;
    g.querySelector('i').style.width = Math.round(left * 100) + '%'; g.classList.toggle('warn', left < 0.25);
    g.title = `사용 ${used.toLocaleString()} tok${cap ? ' / 한도 ' + cap.toLocaleString() : ''}`;
  }
  teacherPresence(ent, present) { if (this.teacherTag) this.teacherTag.style.display = present ? 'none' : ''; }
  ghostSeats(seats) { for (const s of seats) this.tag(s.x, s.y + 36, '빈 자리', 'ghost'); }
  /* 소스 전환: 에이전트 라벨·말풍선·카드·대화 로그 제거 (칠판·유령 라벨은 유지) */
  resetAgents() {
    this.tags = this.tags.filter(t => { const keep = t === this.boardText || t.classList.contains('ghost'); if (!keep) t.remove(); return keep; });
    for (const b of this.bubbles.values()) b.remove(); this.bubbles.clear();
    for (const p of this.pips.values()) p.remove(); this.pips.clear(); this.focusId = null; this.nearId = null;
    if (this.card) { this.card.remove(); this.card = null; }
    this.chatLogs = {}; this.closeAll(); this.teacherTag = null;
    this.setBoard('오늘의 문제<small>대기 중…</small>');
    this.renderTimetable([]);
  }
  setBoard(html) { this.boardText.innerHTML = html; }

  /* ---------- 말풍선 (포커스 정책) ---------- */
  setFocus(id) { this.focusId = id || null; }
  _fullCount() { let n = 0; for (const b of this.bubbles.values()) if (b.classList.contains('show')) n++; return n; }
  _wantsFull(ent) {
    return ent.id === this.focusId || ent.id === this.nearId || (this.chatAgent && this.chatAgent.id === ent.id) || this._fullCount() < this.maxFull;
  }
  bubble(ent, text, ms, think) {
    ent._last = { text, think: !!think, t: performance.now(), ms: ms || 1500 };
    if (this._wantsFull(ent)) { this._pipHide(ent); this._bubbleShow(ent, text, ms, think); }
    else { this._bubbleHide(ent); this._pipShow(ent, think ? '…' : '💬', ms); }
  }
  _bubbleShow(ent, text, ms, think) {
    let b = this.bubbles.get(ent.id);
    if (!b) { b = document.createElement('div'); b.className = 'bubble'; this.overlay.appendChild(b); this.bubbles.set(ent.id, b); }
    b.classList.toggle('think', !!think); b.textContent = text; b.classList.add('show'); b._ent = ent;
    clearTimeout(b._t); if (ms) b._t = setTimeout(() => b.classList.remove('show'), ms);
  }
  _bubbleHide(ent) { const b = this.bubbles.get(ent.id); if (b) { clearTimeout(b._t); b.classList.remove('show'); } }
  _pipShow(ent, icon, ms) {
    let p = this.pips.get(ent.id);
    if (!p) { p = document.createElement('div'); p.className = 'pip'; this.overlay.appendChild(p); this.pips.set(ent.id, p); }
    p.textContent = icon; p.classList.add('show'); p._ent = ent;
    clearTimeout(p._t); if (ms) p._t = setTimeout(() => p.classList.remove('show'), ms);
  }
  _pipHide(ent) { const p = this.pips.get(ent.id); if (p) { clearTimeout(p._t); p.classList.remove('show'); } }
  /* 플레이어가 다가가면 그 에이전트의 최근 말을 전체로 펼친다 (떠나면 접힘) */
  _promote(near) {
    const id = near ? near.id : null;
    if (id === this.nearId) return;
    if (this.nearId) { const prev = this.world.get(this.nearId); if (prev && prev._promoted) { prev._promoted = false; this._bubbleHide(prev); } }
    this.nearId = id;
    if (near && near._last && performance.now() - near._last.t < 20000 && !(this.bubbles.get(near.id) || {}).classList?.contains('show')) {
      this._pipHide(near); this._bubbleShow(near, near._last.text, 6000, near._last.think); near._promoted = true;
    }
  }

  /* ---------- 문제 카드 ---------- */
  newCard(label) {
    if (this.card) this.card.remove();
    this.card = document.createElement('div'); this.card.className = 'card'; this.card.textContent = label; this.overlay.appendChild(this.card);
    this.cardLabel = label; const b = this.cfg.world.board; this.cardPos = { x: b.x, y: b.y + 40 }; this.cardFollow = null;
  }
  cardTo(ent) { this.cardFollow = ent; }
  cardStamp(ok) {
    if (!this.card) return; const c = this.card;
    c.textContent = ok ? '○' : '✗'; c.style.color = ok ? '#2f9b57' : '#c62828'; c.style.borderColor = ok ? '#2f9b57' : '#c62828';
    c.style.transform = 'translate(-50%,-50%) scale(1.6)'; setTimeout(() => { if (this.card === c) c.style.transform = 'translate(-50%,-50%)'; }, 250);
  }
  cardReset() { if (!this.card) return; this.card.textContent = this.cardLabel; this.card.style.color = ''; this.card.style.borderColor = ''; }
  cardResult(ok) {
    if (!this.card) return; const c = this.card; this.cardFollow = null;
    c.classList.add(ok ? 'done' : 'fail'); c.textContent = ok ? '○' : '✗';
    const s = this.cfg.world.submitSpot; this.cardPos = { x: s.x, y: s.y };
    setTimeout(() => { c.style.opacity = 0; setTimeout(() => c.remove(), 400); }, 1100); this.card = null;
  }

  /* ---------- 자막 / 트레이스 / 판정 ---------- */
  annotate(text, kind) {
    if (this.th.annotations === false) return;   // 팝업 끔 (config.theme.annotations) — 트레이스는 director 쪽에서 별도 기록
    const d = document.createElement('div'); d.className = 'sub' + (kind ? ' ' + kind : ''); d.textContent = text; this.el.subs.appendChild(d);
    while (this.el.subs.children.length > 3) this.el.subs.firstChild.remove();
    setTimeout(() => { d.style.transition = 'opacity .5s'; d.style.opacity = 0; setTimeout(() => d.remove(), 500); }, 4200);
  }
  trace(obj, cls) {
    const t = ((performance.now() - this.t0) / 1000).toFixed(1), d = document.createElement('div'); if (cls) d.className = cls;
    d.textContent = `[${t}s] ` + JSON.stringify(obj); this.el.trace.appendChild(d);
    while (this.el.trace.children.length > 150) this.el.trace.firstChild.remove(); this.el.trace.scrollTop = this.el.trace.scrollHeight;
  }
  async showVerdict(title, html, esc, ms = 2600) {
    if (!this.th.verdictCards) return;
    const v = this.el.verdict; v.querySelector('.vt').textContent = title; v.querySelector('.vf').innerHTML = html;
    v.classList.toggle('esc', !!esc); v.classList.add('show'); await Sniffer.util.sleep(ms); v.classList.remove('show');
  }

  /* ---------- HUD 미터 ---------- */
  setMeterTarget(v) { this.meter.target = v; }
  setLamps(rates, colors) {
    const L = this.el.lamps; L.innerHTML = '';
    if (!this.th.rateLamps) return;
    for (const r of rates) { const d = document.createElement('div'); d.className = 'lamp'; d.dataset.rate = r; d.textContent = r + '×'; d.style.setProperty('--lamp', colors[r] || '#fff'); L.appendChild(d); }
  }
  setActiveRate(r) { for (const d of this.el.lamps.children) d.classList.toggle('on', +d.dataset.rate === r); }
  setStats(s) {
    const base = s.baseRate || 1;
    const esc = Object.entries(s.callsByRate || {}).filter(([r]) => +r > base).map(([r, n]) => `${this.th.taximeter ? r + '×' : ''} 호출 <b>${n}</b>`).join(' · ');
    this.el.probStat.innerHTML = `문제 <b>${s.prob}</b> · 제출 <b>${s.done}</b> · 정답 <b>${s.correct}</b><br>${esc || '호출 <b>0</b>'} · 손절 <b>${s.cut}</b>`;
  }
  pushBurn(ours) { this.burnOurs.push(ours); this.burnLine.push((this.burnLine[this.burnLine.length - 1] || 0) + this.th.assemblyLineCostPerProblem); }
  drawBurn() {
    const cv = this.el.burn, c = cv.getContext('2d'), w = cv.width = cv.clientWidth * 2, h = cv.height = 220; c.clearRect(0, 0, w, h);
    const cur = this.meter.target, n = Math.max(this.burnOurs.length, 2), maxY = Math.max(this.burnLine[this.burnLine.length - 1] || 1, cur, 1) * 1.15;
    const px = i => 14 + (w - 28) * i / (n - 1), py = v => h - 16 - (h - 32) * v / maxY;
    const line = (arr, col, dash) => { c.strokeStyle = col; c.lineWidth = 3; c.setLineDash(dash || []); c.beginPath(); arr.forEach((v, i) => i ? c.lineTo(px(i), py(v)) : c.moveTo(px(i), py(v))); c.stroke(); c.setLineDash([]); };
    c.strokeStyle = '#2a2f4a'; c.lineWidth = 1; c.beginPath(); c.moveTo(14, py(0)); c.lineTo(w - 14, py(0)); c.stroke();
    line(this.burnLine, '#ff5d5d', [6, 5]); const o = this.burnOurs.slice(); o[o.length - 1] = cur; line(o, '#ffb020');
  }

  /* ---------- 프레임마다: 위치 동기화 ---------- */
  tick(nearAgent) {
    const W = this.world;
    this.meter.shown += (this.meter.target - this.meter.shown) * .2;
    this.el.meterVal.innerHTML = Math.round(this.meter.shown).toLocaleString() + `<small>${this.th.taximeter ? 'wtok' : 'tok'}</small>`;
    const SZ = this.cfg.world.sprite.size, headY = 16 - SZ - 4;      // 머리 위 (발이 y+16)
    for (const tg of this.tags) {
      if (tg._follow) { const e = tg._follow; const show = this._tagVisible(e); tg.style.display = show ? '' : 'none'; if (!show) continue; tg._wx = e.x; tg._wy = e.y + 24; }
      const [sx, sy] = W.toScreen(tg._wx, tg._wy); tg.style.left = sx + 'px'; tg.style.top = sy + 'px';
    }
    for (const b of this.bubbles.values()) { if (!b._ent) continue; const [sx, sy] = W.toScreen(b._ent.x, b._ent.y + headY); b.style.left = sx + 'px'; b.style.top = sy + 'px'; }
    for (const p of this.pips.values()) { if (!p._ent) continue; const [sx, sy] = W.toScreen(p._ent.x, p._ent.y + headY); p.style.left = sx + 'px'; p.style.top = sy + 'px'; }
    this._promote(nearAgent);
    if (this.card) {
      if (this.cardFollow) { this.cardPos.x += (this.cardFollow.x + 18 - this.cardPos.x) * .15; this.cardPos.y += (this.cardFollow.y - 30 - this.cardPos.y) * .15; }
      const [sx, sy] = W.toScreen(this.cardPos.x, this.cardPos.y); this.card.style.left = sx + 'px'; this.card.style.top = sy + 'px';
    }
    /* E 힌트는 말풍선(머리 위)과 안 겹치게 캐릭터 오른쪽 옆구리에 */
    if (nearAgent && !this.chatAgent) { const [sx, sy] = W.toScreen(nearAgent.x + SZ / 2 + 6, nearAgent.y - 8); this.el.talkHint.style.display = 'block'; this.el.talkHint.style.left = sx + 'px'; this.el.talkHint.style.top = sy + 'px'; }
    else this.el.talkHint.style.display = 'none';
  }

  /* ---------- 대화 (미연시 / 웹) ---------- */
  _wireChat() {
    const $ = id => document.getElementById(id);
    const send = inp => { this.sendChat(inp.value); inp.value = ''; };
    $('vnSend').addEventListener('click', () => send($('vnInput')));
    $('vnInput').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); send(e.target); } });
    $('cpSend').addEventListener('click', () => send($('cpInput')));
    $('cpInput').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); send(e.target); } });
    $('vnClose').addEventListener('click', () => this.closeAll()); $('cpClose').addEventListener('click', () => this.closeAll());
    /* 미연시 메뉴: AUTO(타자기 효과 끔) · LOG(웹 패널로 전체 기록 보기) */
    const vnAuto = $('vnAuto'); if (vnAuto) { this._vnAuto = localStorage.getItem('sniffer_vnauto') === 'on'; const ap = () => vnAuto.classList.toggle('on', this._vnAuto); vnAuto.addEventListener('click', () => { this._vnAuto = !this._vnAuto; localStorage.setItem('sniffer_vnauto', this._vnAuto ? 'on' : 'off'); ap(); }); ap(); }
    const vnLog = $('vnLog'); if (vnLog) vnLog.addEventListener('click', () => { this.chatMode = 'web'; this.el.modeBtn.innerHTML = '대화 UI: <b>웹</b>'; if (this.chatAgent) this.renderChat(); });
    this.el.modeBtn.addEventListener('click', () => { this.chatMode = this.chatMode === 'vn' ? 'web' : 'vn'; this.el.modeBtn.innerHTML = `대화 UI: <b>${this.chatMode === 'vn' ? '미연시' : '웹'}</b>`; if (this.chatAgent) this.renderChat(); });
  }
  openChat(ent) {
    this.chatAgent = ent;
    if (!this.chatLogs[ent.id]) this.chatLogs[ent.id] = [{ who: 'agent', text: ent.quote || '아직 별일 없었어요. 문제가 칠판에 적히면 받습니다. 뭐든 물어보세요.' }];
    this.renderChat(); this.trace({ ev: 'player_talk', to: ent.id, ui: this.chatMode }, 'tEv');
  }
  /* 답은 문자열이거나 Promise(에이전트 모델에게 물어보는 중). Promise 면 "…" 를 먼저 놓고 도착하면 그 자리를 갈아 끼운다 */
  sendChat(text) {
    if (!text.trim() || !this.chatAgent) return; const a = this.chatAgent;
    const log = this.chatLogs[a.id];
    log.push({ who: 'me', text: text.trim() }); this.renderChat();
    const reply = this.replyProvider ? this.replyProvider(a, text) : '…';
    if (!reply || typeof reply.then !== 'function') {
      setTimeout(() => { log.push({ who: 'agent', text: reply }); if (this.chatAgent === a) this.renderChat(); }, 600);
      return;
    }
    const slot = { who: 'agent', text: '…', pending: true };
    log.push(slot); this.renderChat();
    reply.then(t => { slot.text = t || '…'; }, e => { slot.text = '지금은 답하기 어려워요 (' + (e && e.message ? e.message : e) + ')'; })
      .then(() => { slot.pending = false; if (this.chatAgent === a) this.renderChat(); });
  }
  closeAll() { this.chatAgent = null; this.el.vnBox.classList.remove('open'); this.el.chatPanel.classList.remove('open'); this.el.taskModal.classList.remove('open'); if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); }   // 닫자마자 방향키 이동 가능
  renderChat() { if (!this.chatAgent) return; if (this.chatMode === 'vn') { this.el.chatPanel.classList.remove('open'); this._renderVN(); } else { this.el.vnBox.classList.remove('open'); this._renderWeb(); } }
  _renderVN() {
    const a = this.chatAgent, log = this.chatLogs[a.id], $ = id => document.getElementById(id);
    this.el.vnBox.style.setProperty('--vn-color', a.color);
    $('vnName').innerHTML = `${a.label}<small>${a.name}${this.th.taximeter ? ' · ' + a.rate + '×' : ''}</small>`;
    this._vnPortrait(a, $);
    const la = [...log].reverse().find(m => m.who === 'agent'), lm = [...log].reverse().find(m => m.who === 'me');
    $('vnEcho').textContent = lm ? `나: ${lm.text}` : '';
    clearInterval(this._vnTimer); const t = la ? la.text : '…', el = $('vnText');
    if (this._vnAuto) el.textContent = t;                                  // AUTO: 타자기 효과 없이 즉시 표시
    else { el.textContent = ''; let i = 0; this._vnTimer = setInterval(() => { el.textContent = t.slice(0, ++i); if (i >= t.length) clearInterval(this._vnTimer); }, 18); }
    this.el.vnBox.classList.add('open'); $('vnInput').focus();
  }
  /* 입간판: config.characters.portraits[세트] 원화가 있으면 <img>, 없으면 도트 스프라이트 캔버스 */
  _vnPortrait(a, $) {
    const img = $('vnPortraitImg'), cv = $('vnPortrait'), P = (this.cfg.characters || {}).portraits || {}, src = a && a.charSet && P[a.charSet];
    if (src && img) { if (img.getAttribute('src') !== src) img.src = src; img.style.display = 'block'; if (cv) cv.style.display = 'none'; }
    else { if (img) img.style.display = 'none'; if (cv) { cv.style.display = 'block'; this.world.drawPortrait(cv, a); } }
  }
  _renderWeb() {
    const a = this.chatAgent, log = this.chatLogs[a.id], $ = id => document.getElementById(id);
    $('cpName').textContent = `${a.label} 에이전트`;
    $('cpMeta').innerHTML = `<span class="chip">${a.name}</span>` + (this.th.taximeter ? `<span class="chip rate" style="background:${a.color}">${a.rate}× 단가</span>` : '');
    this.world.drawPortrait($('cpAvatar'), a);
    $('cpStatus').innerHTML = `<span>상태 <b>${a.status}</b></span><span>처리 <b>${a.handled}건</b></span><span>소모 <b>${((this.th.taximeter ? a.weightedTokens : a.tokens) || 0).toLocaleString()} ${this.th.taximeter ? 'wtok' : 'tok'}</b></span>`;
    const box = $('cpMsgs'); box.innerHTML = '';
    for (const m of log) { const d = document.createElement('div'); d.className = 'msg ' + (m.who === 'me' ? 'me' : 'agent'); d.textContent = m.text; box.appendChild(d); }
    box.scrollTop = box.scrollHeight; this.el.chatPanel.classList.add('open'); $('cpInput').focus();
  }

  /* ---------- 문제 내기 ---------- */
  _wireTask() {
    const $ = id => document.getElementById(id);
    const sel = $('taskCat'); sel.innerHTML = '';                         // 카테고리는 config.taskCategories 가 단일 진실
    for (const c of (this.cfg.taskCategories || [])) { const o = document.createElement('option'); o.value = c.id; o.textContent = c.label; sel.appendChild(o); }
    $('taskBtn').addEventListener('click', () => this.openTask()); $('taskCancel').addEventListener('click', () => this.closeAll());
    $('taskGo').addEventListener('click', () => { const txt = $('taskText').value.trim(); if (!txt) return; if (this.onTask) this.onTask(txt, $('taskCat').value); $('taskText').value = ''; this.el.taskModal.classList.remove('open'); });
  }
  openTask() { this.el.taskModal.classList.add('open'); document.getElementById('taskText').focus(); }
  setQueue(n) { this.el.queueBadge.textContent = n ? `(대기 ${n})` : ''; }

  /* ---------- 시간표 (교실 벽 시간표: 몇 교시, 무슨 단계인지. 자세한 건 클릭) ---------- */
  _wireTimetable() {
    const $ = id => document.getElementById(id), panel = $('timetable'), btn = $('ttBtn');
    if (!panel || !btn) return;
    const saved = localStorage.getItem('sniffer_tt');
    this._ttOpen = this.th.timetable && saved !== 'off';
    const apply = () => { panel.style.display = this._ttOpen ? 'block' : 'none'; btn.innerHTML = `시간표 <b>${this._ttOpen ? 'ON' : 'OFF'}</b>`; if (!this._ttOpen) this.hideTtDetail(); };
    btn.addEventListener('click', () => { this._ttOpen = !this._ttOpen; localStorage.setItem('sniffer_tt', this._ttOpen ? 'on' : 'off'); apply(); });
    if (!this.th.timetable) btn.style.display = 'none';
    $('ttDetailClose').addEventListener('click', () => this.hideTtDetail());
    $('ttRows').addEventListener('click', e => { const row = e.target.closest('.tt-row'); if (!row) return; const it = (this._ttItems || [])[+row.dataset.i]; if (it) this.showTtDetail(it, +row.dataset.i); });
    /* 스크롤: 휠/드래그(스크롤바는 CSS로 숨김) + ▲▼ 클릭. 사용자가 만진 뒤 8초간은 자동 추적(현재 교시 따라가기) 중지 */
    const rows = $('ttRows'), touched = () => { this._ttUserAt = performance.now(); };
    rows.addEventListener('wheel', touched, { passive: true }); rows.addEventListener('touchstart', touched, { passive: true });
    rows.addEventListener('scroll', () => this._ttNav());
    const step = dir => { touched(); const r = rows.querySelector('.tt-row'); rows.scrollBy({ top: dir * Math.max(18, (r ? r.offsetHeight + 2 : 22) * 2), behavior: 'smooth' }); };
    $('ttUp').addEventListener('click', () => step(-1)); $('ttDown').addEventListener('click', () => step(1));
    apply(); this.renderTimetable([]);
  }
  /* ▲ 이전 n개 / ▼ 다음 n개 — 스크롤 위치로 계산 (보이지 않는 행 수) */
  _ttNav() {
    const rows = document.getElementById('ttRows'), up = document.getElementById('ttUp'), dn = document.getElementById('ttDown'); if (!rows || !up || !dn) return;
    const top = rows.scrollTop, bot = top + rows.clientHeight; let above = 0, below = 0;
    const list = rows.querySelectorAll('.tt-row'), base = list.length && list[0].offsetParent !== rows ? rows.offsetTop : 0;   // 행의 offsetParent 가 #ttRows 가 아니면(비배치) 부모 기준 보정
    for (const r of list) { const ot = r.offsetTop - base; if (ot + r.offsetHeight - 4 < top) above++; else if (ot + 4 > bot) below++; }
    up.textContent = above ? `▲ 이전 ${above}개` : ''; dn.textContent = below ? `▼ 다음 ${below}개` : '';
    up.classList.toggle('on', !!above); dn.classList.toggle('on', !!below);
    rows.classList.toggle('scrollable', rows.scrollHeight > rows.clientHeight + 2);   // 가장자리 페이드 마스크 on/off
  }
  /* 시간표: 전체 행을 스크롤 영역(스크롤바 숨김)에 그리고, 현재 교시가 바뀌면 그 행이 둘째 줄에 오도록 자동 추적.
     사용자가 휠/▲▼로 만진 직후(8초)는 자동 추적을 쉬어 "내가 내린 게 다시 올라가는" 일을 막는다. 높이는 CSS --tt-rows-h */
  renderTimetable(items) {
    const rows = document.getElementById('ttRows'), title = document.getElementById('ttTitle'); if (!rows) return;
    this._ttItems = items || [];
    const T = this.cfg.text, per = typeof T.period === 'function' ? T.period : (n => n + '교시');
    const nowIdx = this._ttItems.findIndex(x => x.status === 'now');
    const noOf = (it, i) => (it && it.no != null ? it.no : i + 1);   // 서버 실행 번호가 있으면 그 번호로(Studio 바와 동일), 없으면 순번
    title.innerHTML = `${T.timetableTitle || '시간표'}${nowIdx >= 0 ? ` <b>· ${per(noOf(this._ttItems[nowIdx], nowIdx))} 진행 중</b>` : ''}`;
    if (!this._ttItems.length) { rows.innerHTML = `<div class="tt-empty">${T.ttEmpty || '-'}</div>`; this._ttNav(); return; }
    const mark = { done: '✓', fail: '✕', now: '▶', upcoming: '', skipped: '–' };   // skipped = 중단으로 건너뜀
    const keep = rows.scrollTop;
    rows.innerHTML = this._ttItems.map((it, i) => {
        const st = it.status || 'upcoming';
        return `<div class="tt-row ${st}" data-i="${i}">` +
          `<span class="tt-period">${per(noOf(it, i))}</span>` +
          `<span class="tt-title" title="${(it.title || '').replace(/"/g, '&quot;')}">${Sniffer.util.short(it.title || it.id || '', 16)}</span>` +
          `<span class="tt-mark">${mark[st] || ''}</span>` +
          (st === 'now' && it.stage ? `<span class="tt-stage">${it.stage}</span>` : '') + `</div>`;
      }).join('');
    rows.scrollTop = keep;
    const idle = !this._ttUserAt || performance.now() - this._ttUserAt > 8000;
    if (idle && nowIdx !== this._ttNowIdx) {                                  // 교시가 바뀐 순간만 따라감
      const r = rows.querySelector(`.tt-row[data-i="${nowIdx}"]`), first = rows.querySelector('.tt-row');
      const base = r && r.offsetParent !== rows ? rows.offsetTop : 0;
      if (r) rows.scrollTo({ top: Math.max(0, (r.offsetTop - base) - (first ? first.offsetHeight + 2 : 22)), behavior: 'smooth' });
    }
    this._ttNowIdx = nowIdx; this._ttNav();
    if (this._ttDetailIdx != null && this._ttItems[this._ttDetailIdx]) this.showTtDetail(this._ttItems[this._ttDetailIdx], this._ttDetailIdx);
  }
  showTtDetail(it, i) {
    const box = document.getElementById('ttDetail'), body = document.getElementById('ttDetailBody'); if (!box) return;
    this._ttDetailIdx = i;
    const T = this.cfg.text, per = typeof T.period === 'function' ? T.period : (n => n + '교시');
    const unit = this.th.taximeter ? 'wtok' : 'tok';
    const rows = [
      ['문제', it.title || it.id || '-'],
      ['상태', { done: '제출 완료 ✓', fail: '제출 (오답/손절) ✕', now: '진행 중 ▶', upcoming: '대기', skipped: '중단됨 –' }[it.status] || it.status],
      ['지금 단계', it.stage || '-'],
      ['담당 흐름', (it.path && it.path.length) ? it.path.join(' → ') : (it.agent || '-')],
      ['검증 실패', it.verifyFail ? `${it.verifyFail}회` : '없음'],
      ['상위 호출', it.escalated ? '있음' : '없음'],
      ['손절', it.cut ? '있음' : '없음'],
      ['비용', it.cost != null ? `${Math.round(it.cost).toLocaleString()} ${unit}` : '-'],
    ];
    body.innerHTML = `<div class="ttd-h">${per(it.no != null ? it.no : i + 1)}</div>` + rows.map(([k, v]) => `<div class="ttd-row"><span>${k}</span><b>${v}</b></div>`).join('');
    box.classList.add('open');
  }
  hideTtDetail() { this._ttDetailIdx = null; const box = document.getElementById('ttDetail'); if (box) box.classList.remove('open'); }

  /* ---------- 설정 메뉴(⚙) + 테마 토글 ---------- */
  _wireGear() {
    const $ = id => document.getElementById(id), btn = $('gearBtn'), menu = $('gearMenu'); if (!btn || !menu) return;
    /* 메뉴가 열리면 바로 아래 시간표를 메뉴 높이만큼 내려 겹치지 않게 (닫히면 복귀). 높이는 실측 → 항목이 늘어도 OK */
    const tt = $('timetable'), ttd = $('ttDetail');
    const shift = () => { const on = menu.classList.contains('open'), dy = on ? menu.offsetHeight + 6 : 0; for (const el of [tt, ttd]) if (el) el.style.transform = dy ? `translateY(${dy}px)` : ''; };
    btn.addEventListener('click', e => { e.stopPropagation(); menu.classList.toggle('open'); shift(); });
    document.addEventListener('click', e => { if (!menu.contains(e.target) && e.target !== btn) { menu.classList.remove('open'); shift(); } });
    /* 이름표 모드: 자동 → 항상 → 숨김 */
    const tgb = $('tagBtn');
    if (tgb) {
      const modes = [['auto', '자동'], ['always', '항상'], ['never', '숨김']];
      const applyT = () => { const m = this._tagMode(); tgb.innerHTML = `이름표: <b>${(modes.find(x => x[0] === m) || modes[0])[1]}</b>`; };
      tgb.addEventListener('click', () => { const i = modes.findIndex(x => x[0] === this._tagMode()); localStorage.setItem('sniffer_tags', modes[(i + 1) % modes.length][0]); applyT(); });
      applyT();
    }
    /* 스쿼드 선택: 서버 스쿼드 목록 → 선택 시 기억하고 LIVE 재시작 (main.js 가 Sniffer.app.startSource 제공) */
    const sq = $('squadSel');
    if (sq) {
      this.loadSquadList = async () => {
        try {
          const c = new AigoClient({ base: this.cfg.proxyBase }); const raw = await c.get('/api/v1/squads');
          const list = (Array.isArray(raw) ? raw : (raw && raw.data) || []).slice().sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));   // 최근 갱신 순
          sq.innerHTML = '<option value="">(자동: 최근 갱신 스쿼드)</option>' + list.map(s => `<option value="${s.id}">${(s.name || s.id).replace(/</g, '&lt;')}${s.agentCount ? ' · ' + s.agentCount + '명' : ''}</option>`).join('');
          const want = this.cfg.squadId || ''; sq.value = want; if (sq.value !== want) sq.value = '';
        } catch (e) { sq.innerHTML = '<option value="">(서버 연결 안 됨)</option>'; }
      };
      sq.addEventListener('click', e => e.stopPropagation());
      sq.addEventListener('change', () => {
        localStorage.setItem('sniffer_squad', sq.value); this.cfg.squadId = sq.value || null;
        if (Sniffer.app && Sniffer.app.startSource) Sniffer.app.startSource('live');
      });
      this.loadSquadList();
    }
    const tb = $('themeBtn'), link = $('themeLink');
    if (tb && link) {
      /* 테마 순환: 밝음(theme-light, 기본값) → 기본(css/game.css) → 초안(theme-draft). 목록은 config.themes 로 확장 */
      const themes = this.cfg.themes || [{ id: 'light', label: '밝음', href: 'css/theme-light.css' }, { id: 'default', label: '어둠', href: 'css/game.css' }, { id: 'draft', label: '초안', href: 'css/theme-draft.css' }];
      const cur = () => themes.find(t => t.id === (localStorage.getItem('sniffer_theme') || this.th.defaultTheme || 'light')) || themes[0];
      const apply = () => { const t = cur(); link.setAttribute('href', t.href); tb.innerHTML = `테마: <b>${t.label}</b>`; };
      tb.addEventListener('click', () => { const i = themes.indexOf(cur()); localStorage.setItem('sniffer_theme', themes[(i + 1) % themes.length].id); apply(); });
      apply();
    }
  }

  /* ---------- 종소리 토글 ---------- */
  _wireBell() {
    const btn = document.getElementById('bellBtn'); if (!btn) return;
    const A = Sniffer.Audio; if (!A) { btn.style.display = 'none'; return; }
    const apply = () => { btn.innerHTML = `${A.enabled ? '🔔' : '🔕'} 종소리 <b>${A.enabled ? 'ON' : 'OFF'}</b>`; };
    btn.addEventListener('click', () => { A.setEnabled(!A.enabled); apply(); if (A.enabled) A.bell('next'); });
    apply();
  }

  /* ---------- Nerd ---------- */
  _wireNerd() { this.el.nerdBtn.addEventListener('click', () => this.toggleNerd()); }
  toggleNerd() {
    const open = this.el.nerd.classList.toggle('open');
    document.body.classList.toggle('nerd-open', open);          // 게임 화면은 옆으로 양보(가리지 않음)
    this.el.nerdBtn.style.color = open ? 'var(--green)' : ''; setTimeout(() => this.drawBurn(), 50);
  }
  nerdOpen() { return this.el.nerd.classList.contains('open'); }
};
