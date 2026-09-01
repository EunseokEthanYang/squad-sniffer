/* =========================================================
   engine/world.js — 캔버스 월드: 배경·캐릭터 세트(스프라이트)·엔티티·좌석 배정·이동·충돌·렌더
   특정 스쿼드 구조를 모른다. "N명의 에이전트 + 플레이어 1명"만 안다. 기하/키 이름/캐릭터 배정은 전부 config 에서 온다.
   캐릭터 세트: window.SPRITE_SETS = { set: { walk_down, walk_up, walk_left|walk_right|walk_side, work? } } (tools/build_sprites.ps1 생성)
   ========================================================= */
window.Sniffer = window.Sniffer || {};

Sniffer.World = class World {
  constructor(canvas, cfg) {
    this.cfg = cfg; this.geo = cfg.world; this.sp = this.geo.sprite; this.chars = cfg.characters || { sets: {}, byName: {}, byRate: {}, fallback: null };
    this.W = this.geo.w; this.H = this.geo.h;
    this.cv = canvas; this.cx = canvas.getContext('2d'); this.cx.imageSmoothingEnabled = false;
    this.gameEl = canvas.parentElement;

    this.ents = new Map(); this.seatsTaken = [];
    this.solids = [this.geo.teacherDesk, ...this.geo.furniture];
    const G = this.geo.deskGrid;
    /* 충돌 박스는 책상 상판만(G.solidH). 의자 영역은 걸어 다닐 수 있게 — 줄 사이 통로 확보 */
    for (const gx of G.cols) for (const ry of G.rows) this.solids.push({ x: gx - G.w / 2, y: ry + (G.solidDY || 0), w: G.w, h: G.solidH || G.h });
    this.seatTotal = this.geo.seatColOrder.length * G.rows.length;

    /* cascade 테마의 교탁 단가: config.rates 기준으로 고정 (스폰 순서와 무관) */
    const rs = Object.values(cfg.rates || {}).map(Number).filter(Number.isFinite);
    const th = cfg.theme;
    this.teacherTier = (th.teacherTier && rs.includes(th.teacherTier)) ? th.teacherTier : (rs.length ? Math.max(...rs) : null);
    if (th.cascade && th.teacherTier && this.teacherTier !== th.teacherTier) console.warn('[world] theme.teacherTier', th.teacherTier, 'not in config.rates → fallback', this.teacherTier);

    const p = this.geo.player;
    this.player = this._makeEnt({ id: 'player', name: '나', color: p.color, x: p.x, y: p.y, speed: p.speed, isPlayer: true });
    this.player.home = { x: p.x, y: p.y };

    this.sets = {};            // setName → { key: {img, n} } (원본)
    this.sheets = {};          // entId → { key: {cv|img, n} } (엔티티별 최종 시트; 틴팅 세트만 캔버스 복제)
    this.spritesReady = false;
    this.bgImg = null; this.bgReady = false;
    this.teacherOccupant = null;
  }

  /* ---------- 자산 ---------- */
  setBackground(dataUrl) { if (!dataUrl) return; this.bgImg = new Image(); this.bgImg.onload = () => { this.bgReady = true; }; this.bgImg.src = dataUrl; }
  /* sets: { setName: { key: dataURL } } */
  setSprites(sets) {
    const names = Object.keys(sets || {}); if (!names.length) return;
    let pending = 0;
    for (const sn of names) {
      const keys = Object.keys(sets[sn] || {}); if (!keys.length) continue;
      this.sets[sn] = this.sets[sn] || {};
      for (const k of keys) {
        pending++;
        const im = new Image();
        const done = () => { if (--pending === 0) this._onSprites(); };
        im.onload = () => { this.sets[sn][k] = { img: im, n: Math.max(1, Math.round(im.width / this.sp.frame)) }; done(); };
        im.onerror = done;
        im.src = sets[sn][k];
      }
    }
    if (!pending) this._onSprites();
  }
  _onSprites() { this.spritesReady = true; for (const e of this.allEnts()) this._buildSheet(e); }
  /* 엔티티 → 캐릭터 세트명 (byName > player > byRate > fallback > 아무거나) */
  charSetFor(e) {
    const C = this.chars, has = n => n && this.sets[n] && Object.keys(this.sets[n]).length;
    const cands = [C.byName && C.byName[e.name], e.isPlayer ? C.player : null, !e.isPlayer && C.byRate ? C.byRate[e.rate || 1] : null, C.fallback];
    for (const c of cands) if (has(c)) return c;
    const any = Object.keys(this.sets).find(has); return any || null;
  }
  _buildSheet(e) {
    if (!this.spritesReady) return;
    const sn = charSetFor_safe(this, e); if (!sn) { delete this.sheets[e.id]; return; }
    const raw = this.sets[sn], meta = (this.chars.sets || {})[sn] || {}, sheet = {};
    const tint = !!meta.tint, rot = tint ? Sniffer.util.hueOf(e.color) - this.sp.baseHue : 0, extra = tint ? (e.tintFilter || '') : '';
    for (const k in raw) {
      const im = raw[k].img;
      if (tint && (rot || extra)) {
        const c = document.createElement('canvas'); c.width = im.width; c.height = im.height;
        const g = c.getContext('2d'); const f = (rot ? `hue-rotate(${rot}deg) ` : '') + extra; if (f.trim()) g.filter = f.trim(); g.drawImage(im, 0, 0);
        sheet[k] = { cv: c, n: raw[k].n };
      } else sheet[k] = { cv: im, n: raw[k].n };
    }
    e.charSet = sn; this.sheets[e.id] = sheet;
    function charSetFor_safe(w, ent) { try { return w.charSetFor(ent); } catch (err) { return null; } }
  }

  /* ---------- 엔티티 ---------- */
  _makeEnt(o) {
    return Object.assign({
      tx: o.x, ty: o.y, moving: false, visible: true, face: 'down', flip: false, working: false,
      status: '대기 중', tokens: 0, weightedTokens: 0, quote: '', handled: 0, rate: 1, label: o.name,
      speed: this.geo.agentSpeed, aisle: null, seat: null, homeFace: 'down', _res: null, meta: {},
    }, o);
  }
  allEnts() { return [...this.ents.values(), this.player]; }
  agents() { return [...this.ents.values()]; }
  get(id) { return id === 'player' ? this.player : this.ents.get(id); }

  /* 에이전트 추가: 좌석 자동 배정. cascade 테마면 teacherTier 단가의 첫 에이전트가 교탁 담당(평소 부재) */
  addAgent({ id, name, rate = 1, label, color, modelId, tier, tintFilter }) {
    if (this.ents.has(id)) return this.ents.get(id);
    const th = this.cfg.theme;
    const useTeacher = th.cascade && this.teacherTier != null && (tier ?? rate) === this.teacherTier && !this.teacherOccupant;
    let ent;
    if (useTeacher) {
      const h = this.geo.teacherHome;
      ent = this._makeEnt({ id, name, rate, label: label || name, color, modelId, tintFilter, x: h.x, y: h.y });
      ent.home = { x: h.x, y: h.y }; ent.homeFace = 'down'; ent.face = 'down'; ent.visible = false; ent.isTeacher = true; this.teacherOccupant = id;
    } else {
      const seatIdx = this.seatsTaken.length;
      if (seatIdx >= this.seatTotal) console.warn('[world] seat overflow — 좌석이 부족합니다 (', seatIdx + 1, '/', this.seatTotal, ') → 순환 배정');
      const s = this.seatFor(seatIdx);
      ent = this._makeEnt({ id, name, rate, label: label || name, color, modelId, tintFilter, x: s.x, y: s.y });
      ent.home = { x: s.x, y: s.y }; ent.homeFace = 'up'; ent.face = 'up'; ent.seat = s; ent.aisle = s.aisle;
      this.seatsTaken.push(id);
    }
    this.ents.set(id, ent); this._buildSheet(ent);
    return ent;
  }
  /* 단가/이름이 나중에 바뀌면 캐릭터 세트도 다시 고른다 */
  refreshSheet(e) { this._buildSheet(e); }
  removeAgent(id) { const e = this.ents.get(id); if (!e) return; this.ents.delete(id); delete this.sheets[id]; if (this.teacherOccupant === id) this.teacherOccupant = null; }
  clearAgents() {
    for (const e of this.ents.values()) { if (e._res) { const r = e._res; e._res = null; r(); } delete this.sheets[e.id]; }
    this.ents.clear(); this.seatsTaken = []; this.teacherOccupant = null;
  }
  seatFor(index) {
    const G = this.geo.deskGrid, order = this.geo.seatColOrder, perRow = order.length;
    const row = Math.floor(index / perRow) % G.rows.length, col = order[index % perRow];
    return { col, row, x: G.cols[col], y: G.rows[row] + G.sitDY, aisle: this.geo.aisleX[Math.min(col, this.geo.aisleX.length - 1)] };
  }
  emptySeats() { const out = []; for (let i = this.seatsTaken.length; i < this.seatTotal; i++) out.push(this.seatFor(i)); return out; }
  approachSpot(target) { const a = this.geo.approach, o = target.isTeacher ? a.teacher : a.seat; return { x: target.home.x + o.dx, y: target.home.y + o.dy }; }

  /* ---------- 이동 (모든 경로는 축 정렬: 가로/세로 구간만 — 뚫고 가거나 뱅글 도는 일이 없게) ---------- */
  moveTo(e, x, y) { e.tx = x; e.ty = y; e.moving = true; return new Promise(r => { e._res = r; }); }
  async route(e, pts) { for (const p of pts) { if (Math.abs(p[0] - e.x) < 0.5 && Math.abs(p[1] - e.y) < 0.5) continue; await this.moveTo(e, p[0], p[1]); } }
  /* 교탁 옆 통로 x: 목적지(tx)가 교탁 중심보다 왼쪽이면 왼쪽 옆, 아니면 오른쪽 옆 (뱅글 돌지 않게) */
  teacherSideX(tx) { const d = this.geo.teacherDesk, DX = this.geo.teacherSideDX || 18, c = d.x + d.w / 2; return (tx != null && tx < c) ? d.x - DX : d.x + d.w + DX; }
  _atHome(e) { return Math.abs(e.x - e.home.x) < 0.5 && Math.abs(e.y - e.home.y) < 0.5; }
  /* 선생님: 교탁 뒤(y<cy)에 있으면 옆 통로로 내려오고, 이미 복도 아래면 바로 복도로 */
  _teacherPrefix(e, cy, tx) { const sx = this.teacherSideX(tx); return e.y > cy ? [[e.x, cy]] : [[sx, e.y], [sx, cy]]; }
  async walkFront(e, tx, ty) {
    const cy = this.geo.corridorY;
    if (e.isTeacher) return this.route(e, [...this._teacherPrefix(e, cy, tx), [tx, cy], [tx, ty]]);
    const ax = e.aisle || this.geo.aisleX[1];
    const pre = (Math.abs(e.x - ax) < 12 || e.y <= cy) ? [[e.x, cy]] : [[ax, e.y], [ax, cy]];   // 통로 위가 아니면 먼저 통로로 (책상 위로 올라가지 않게)
    await this.route(e, [...pre, [tx, cy], [tx, ty]]);
  }
  async goHome(e) {
    if (this._atHome(e)) { e.status = '대기 중'; e.face = e.homeFace || 'down'; return; }   // 이미 자리면 한 바퀴 돌지 않음
    const cy = this.geo.corridorY;
    if (e.isTeacher) { const sx = this.teacherSideX(e.x); await this.route(e, [...this._teacherPrefix(e, cy, e.x), [sx, cy], [sx, e.home.y], [e.home.x, e.home.y]]); }
    else {
      const ax = e.aisle || this.geo.aisleX[1];
      const pre = (Math.abs(e.x - ax) < 12 || e.y <= cy) ? [[e.x, cy]] : [[ax, e.y], [ax, cy]];
      await this.route(e, [...pre, [ax, cy], [ax, e.home.y], [e.home.x, e.home.y]]);
    }
    e.status = '대기 중'; e.face = e.homeFace || 'down';
  }
  async enterFromDoor(e, to) {
    const d = this.geo.door, cy = this.geo.corridorY, h = to || e.home;
    e.visible = true; e.x = d.x; e.y = d.y;
    if (e.isTeacher) { const sx = this.teacherSideX(); await this.route(e, [[d.x, cy], [sx, cy], [sx, h.y], [h.x, h.y]]); }   // 문이 오른쪽이라 오른쪽 옆으로
    else { const ax = e.aisle || this.geo.aisleX[this.geo.aisleX.length - 1]; await this.route(e, [[d.x, cy], [ax, cy], [ax, h.y], [h.x, h.y]]); }
    e.face = e.homeFace || 'down';
  }
  async leaveByDoor(e) {
    const d = this.geo.door, cy = this.geo.corridorY;
    if (e.isTeacher) await this.route(e, [...this._teacherPrefix(e, cy, d.x), [d.x, cy], [d.x, d.y]]);
    else { const ax = e.aisle || this.geo.aisleX[this.geo.aisleX.length - 1]; const pre = (Math.abs(e.x - ax) < 12 || e.y <= cy) ? [[e.x, cy]] : [[ax, e.y], [ax, cy]]; await this.route(e, [...pre, [d.x, cy], [d.x, d.y]]); }
    e.visible = false;
  }

  /* ---------- 업데이트 ---------- */
  /* 플레이어 충돌은 "발 박스"(x±6, y+6..y+16 = 그려지는 발 위치)만 — 몸통이 책상 위에 겹쳐 보여도 발만 막히면 자연스럽다 */
  _collide(x, y) { for (const s of this.solids) if (x + 6 > s.x && x - 6 < s.x + s.w && y + 16 > s.y && y + 6 < s.y + s.h) return true; return false; }
  update(dt, inputVec) {
    for (const e of this.ents.values()) {
      if (!e.moving) continue;
      const dx = e.tx - e.x, dy = e.ty - e.y, d = Math.hypot(dx, dy);
      /* 방향은 구간 시작 시 한 번 정한다(히스테리시스) — 도착 직전 잔여 오차로 얼굴이 떨리지 않게 */
      if (e._segKey !== e.tx + ',' + e.ty) {
        e._segKey = e.tx + ',' + e.ty;
        if (Math.abs(dx) >= Math.abs(dy)) { if (Math.abs(dx) > 0.5) { e.face = 'side'; e.flip = dx > 0; } } else e.face = dy < 0 ? 'up' : 'down';
      }
      if (d < 2) { e.x = e.tx; e.y = e.ty; e.moving = false; if (e._res) { const r = e._res; e._res = null; r(); } }
      else { const step = Math.min(d, e.speed * dt); e.x += dx / d * step; e.y += dy / d * step; }
    }
    const p = this.player, [ix, iy] = inputVec, B = this.geo.bounds;
    p.moving = !!(ix || iy);
    if (p.moving) { if (Math.abs(ix) > Math.abs(iy)) { p.face = 'side'; p.flip = ix > 0; } else p.face = iy < 0 ? 'up' : 'down'; }
    const nx = p.x + ix * p.speed * dt, ny = p.y + iy * p.speed * dt;
    const WK = this.geo.walkable;
    const ok = (x, y) => WK && WK.length ? WK.some(r => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) : (x >= B.x0 && x <= B.x1 && y >= B.y0 && y <= B.y1);
    if (!this._collide(nx, p.y) && ok(nx, p.y)) p.x = nx;     // 바닥 영역 밖(벽·창문·아래 벽)으로는 못 나감
    if (!this._collide(p.x, ny) && ok(p.x, ny)) p.y = ny;
  }
  nearestAgent(radius) {
    if (radius == null) radius = this.geo.talkRadius || 84;
    let best = null, bd = radius;
    for (const a of this.ents.values()) { if (!a.visible) continue; const d = Math.hypot(a.x - this.player.x, a.y - this.player.y); if (d < bd) { bd = d; best = a; } }
    return best;
  }

  /* ---------- 렌더 ---------- */
  scale() { return this.gameEl.clientWidth / this.W; }
  toScreen(x, y) { const s = this.scale(); return [x * s, y * s]; }
  draw(t) {
    const cx = this.cx;
    if (this.bgReady) cx.drawImage(this.bgImg, 0, 0, this.W, this.H);
    else { cx.fillStyle = '#8f7a5e'; cx.fillRect(0, 0, this.W, this.H); cx.fillStyle = '#463629'; cx.fillRect(0, 0, this.W, 60); }
    /* 전경 조각(교탁 등): 발이 조각 아랫변보다 위에 있는 캐릭터는 조각 뒤에, 아래에 있으면 앞에 */
    const ents = this.allEnts().sort((a, b) => a.y - b.y);
    const fgs = this.bgReady ? (this.geo.foreground || []).map(r => ({ ...r, bottom: r.y + r.h })).sort((a, b) => a.bottom - b.bottom) : [];
    let i = 0;
    for (const fg of fgs) {
      while (i < ents.length && ents[i].y + 16 < fg.bottom) this._drawEnt(ents[i++], t);
      const kx = this.bgImg.width / this.W, ky = this.bgImg.height / this.H;
      cx.drawImage(this.bgImg, fg.x * kx, fg.y * ky, fg.w * kx, fg.h * ky, fg.x, fg.y, fg.w, fg.h);
    }
    while (i < ents.length) this._drawEnt(ents[i++], t);
  }
  /* 상태·방향 → 시트 키와 반전 여부. 세트에 좌/우 클립이 있으면 반전 없이 그걸 쓴다 */
  _pickFrame(e, sheet, t) {
    const K = this.sp.keys, atHome = e.home && Math.hypot(e.x - e.home.x, e.y - e.home.y) < 8;
    const has = k => k && sheet[k];
    if (e.working && atHome && !e.isTeacher && has(K.up)) return { key: K.up, fi: Math.floor(t / 110) % sheet[K.up].n, flip: false };
    if (e.working && has(K.work)) return { key: K.work, fi: Math.floor(t / 70) % sheet[K.work].n, flip: false };
    let key, flip = false;
    if (e.face === 'up' && has(K.up)) key = K.up;
    else if (e.face === 'side') {
      if (e.flip && has(K.right)) key = K.right;
      else if (!e.flip && has(K.left)) key = K.left;
      else if (has(K.side)) { key = K.side; flip = !!e.flip; }
      else if (has(K.left)) { key = K.left; flip = !!e.flip; }          // 왼쪽만 있으면 오른쪽은 반전
      else if (has(K.right)) { key = K.right; flip = !e.flip; }
    }
    if (!key) key = has(K.down) ? K.down : Object.keys(sheet)[0];
    const fi = e.moving ? Math.floor(t / 70) % sheet[key].n : 0;
    return { key, fi, flip };
  }
  _drawEnt(e, t) {
    if (!e.visible) return;
    const cx = this.cx, SZ = this.sp.size, F = this.sp.frame, sheet = this.spritesReady && this.sheets[e.id];
    const hop = this._hopDY(e, t);                                     // 이모트 '!' 등일 때 살짝 뛰어오름(그림자는 제자리)
    const ey = Math.round(e.y), ex = Math.round(e.x);
    cx.fillStyle = '#00000038'; cx.fillRect(ex - Math.round(SZ * 0.2), ey + 10, Math.round(SZ * 0.4), 5);
    if (sheet && Object.keys(sheet).length) {
      const { key, fi, flip } = this._pickFrame(e, sheet, t), sp = sheet[key], dy = ey + 16 - SZ - hop;
      if (flip) { cx.save(); cx.translate(ex, 0); cx.scale(-1, 1); cx.drawImage(sp.cv, fi * F, 0, F, F, -SZ / 2, dy, SZ, SZ); cx.restore(); }
      else cx.drawImage(sp.cv, fi * F, 0, F, F, ex - SZ / 2, dy, SZ, SZ);
    } else {
      cx.fillStyle = e.color; cx.fillRect(ex - 9, ey - 10 - hop, 18, 16);
      cx.fillStyle = '#ffdbac'; cx.fillRect(ex - 7, ey - 24 - hop, 14, 14);
    }
    if (e._emote) this._drawEmote(e, t, hop);
  }
  /* ---- 머리 위 이모트(RPG 말풍선 아이콘). director → world.emote(ent, '!', {color, ms, hop}) ---- */
  emote(e, sym, opts) {
    if (!e || !sym) return; const o = opts || {};
    e._emote = { sym, t0: performance.now(), ms: o.ms || 1500, color: o.color || '#2a241c', hop: !!o.hop };
  }
  _hopDY(e, t) {
    const m = e._emote; if (!m || !m.hop) return 0;
    const age = t - m.t0; return age < 320 ? Math.round(Math.sin(age / 320 * Math.PI) * 7) : 0;
  }
  _drawEmote(e, t, hop) {
    const m = e._emote, age = t - m.t0; if (age > m.ms) { e._emote = null; return; }
    const cx = this.cx, SZ = this.sp.size;
    const pop = Math.min(1, age / 160), ease = 1 - Math.pow(1 - pop, 3);          // 튀어나오는 팝인
    const fade = age > m.ms - 220 ? Math.max(0, (m.ms - age) / 220) : 1;         // 끝에 페이드아웃
    const bob = Math.sin(age / 140) * 1.5;
    const x = Math.round(e.x + SZ * 0.26), y = Math.round(e.y + 16 - SZ - 6 + bob - (hop || 0));
    const w = 24, h = 26;                                                          // 말풍선 크기(월드 px) — 심사위원 거리에서 보이게
    cx.save(); cx.globalAlpha = fade; cx.translate(x, y); cx.scale(ease, ease);
    cx.fillStyle = '#fffdf5'; cx.strokeStyle = '#2a241c'; cx.lineWidth = 2;
    cx.beginPath(); cx.moveTo(-w / 2 + 4, -h); cx.lineTo(w / 2 - 4, -h); cx.quadraticCurveTo(w / 2, -h, w / 2, -h + 4);
    cx.lineTo(w / 2, -4); cx.quadraticCurveTo(w / 2, 0, w / 2 - 4, 0); cx.lineTo(-1, 0); cx.lineTo(-5, 5); cx.lineTo(-5, 0);
    cx.lineTo(-w / 2 + 4, 0); cx.quadraticCurveTo(-w / 2, 0, -w / 2, -4); cx.lineTo(-w / 2, -h + 4); cx.quadraticCurveTo(-w / 2, -h, -w / 2 + 4, -h);
    cx.closePath(); cx.fill(); cx.stroke();
    cx.fillStyle = m.color; cx.font = 'bold 17px Galmuri11, "Galmuri9", monospace'; cx.textAlign = 'center'; cx.textBaseline = 'middle';
    cx.fillText(m.sym, 0, -h / 2 + 1);
    cx.restore();
  }
  drawPortrait(canvas, e) {
    const c = canvas.getContext('2d'); c.imageSmoothingEnabled = false; c.clearRect(0, 0, canvas.width, canvas.height);
    const sheet = this.spritesReady && this.sheets[e.id], F = this.sp.frame, K = this.sp.keys;
    const sp = sheet && (sheet[K.down] || sheet[Object.keys(sheet)[0]]);
    if (sp) { c.drawImage(sp.cv, 0, 0, F, F, 0, 3, 64, 64); return; }
    c.fillStyle = e.color; c.fillRect(14, 26, 36, 30); c.fillStyle = '#ffdbac'; c.fillRect(18, 6, 28, 22);
  }
};

/* ---------- 공용 유틸 ---------- */
Sniffer.util = {
  hueOf(hex) {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex || ''); if (!m) return 210;
    const n = parseInt(m[1], 16), r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn; if (!d) return 0;
    let h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h = Math.round(h * 60); return h < 0 ? h + 360 : h;
  },
  shade(hex, n) {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex || ''); if (!m || !n) return { color: hex, filter: '' };
    const v = parseInt(m[1], 16), r = (v >> 16) & 255, g = (v >> 8) & 255, b = v & 255;
    const k = 1 + (n % 2 ? 0.22 : -0.18) * Math.ceil(n / 2);
    const cl = x => Math.max(0, Math.min(255, Math.round(x * k)));
    const color = '#' + [cl(r), cl(g), cl(b)].map(x => x.toString(16).padStart(2, '0')).join('');
    return { color, filter: `brightness(${k.toFixed(2)})` };
  },
  sleep: ms => new Promise(r => setTimeout(r, ms)),
  short: (t, n = 26) => (t && t.length > n ? t.slice(0, n - 1) + '…' : (t || '')),
};
