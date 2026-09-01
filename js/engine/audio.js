/* =========================================================
   engine/audio.js — 종소리. 파일 없이 Web Audio 로 합성(오프라인 동작), 나중에 음원 파일로 교체 가능.
   kinds: 'next'(다음 task 시작) · 'end'(task 종료/제출 성공) · 'fail'(제출 실패) · 'enter'(등장) · 'warn'(경고)
   사용: Sniffer.Audio.init(cfg.audio) → 첫 사용자 제스처 후 Sniffer.Audio.bell('end')
   ========================================================= */
window.Sniffer = window.Sniffer || {};

Sniffer.Audio = {
  ctx: null, master: null, enabled: true, volume: 0.5, cfg: null,
  /* 패턴: [주파수Hz, 시작(초), 길이(초), 게인] — 학교 종(딩-동-댕-동), 짧은 알림 등 */
  patterns: {
    next:  [[1318.5, 0.00, 0.45, 0.45], [1568.0, 0.16, 0.60, 0.45]],                                   // 띵-동 (E6→G6)
    end:   [[1046.5, 0.00, 1.10, 0.50], [880.0, 0.42, 1.10, 0.45], [698.5, 0.84, 1.10, 0.45], [523.3, 1.26, 1.60, 0.50]], // 딩-동-댕-동
    fail:  [[261.6, 0.00, 0.40, 0.40], [196.0, 0.20, 0.55, 0.40]],                                     // 낮은 두 음
    enter: [[659.3, 0.00, 0.35, 0.35], [659.3, 0.22, 0.35, 0.35], [880.0, 0.44, 0.70, 0.40]],          // 똑똑-띵
    warn:  [[440.0, 0.00, 0.25, 0.35], [440.0, 0.30, 0.25, 0.35]],
  },
  init(cfg) {
    this.cfg = cfg || {}; this.volume = this.cfg.volume != null ? this.cfg.volume : 0.5;
    const saved = localStorage.getItem('sniffer_audio');
    this.enabled = saved != null ? saved === 'on' : (this.cfg.enabled !== false);
    if (this.cfg.files) this.files = this.cfg.files;     // { next:'assets/sfx/next.mp3', ... } 주면 합성 대신 재생
    return this;
  },
  setEnabled(on) { this.enabled = !!on; localStorage.setItem('sniffer_audio', on ? 'on' : 'off'); if (on) this._ensure(); },
  _ensure() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return false;
      this.ctx = new AC(); this.master = this.ctx.createGain(); this.master.gain.value = this.volume; this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
    return true;
  },
  /* 사용자 제스처(인트로 클릭) 직후 한 번 호출해 오토플레이 정책 해제 */
  unlock() { this._ensure(); },
  bell(kind) {
    if (!this.enabled) return false;
    if (this.files && this.files[kind]) { try { const a = new Audio(this.files[kind]); a.volume = this.volume; a.play().catch(() => {}); return true; } catch (e) { /* fall through */ } }
    if (!this._ensure()) return false;
    const P = this.patterns[kind] || this.patterns.next, t0 = this.ctx.currentTime + 0.01;
    for (const [f, s, d, g] of P) this._tone(f, t0 + s, d, g);
    return true;
  },
  _tone(freq, t, dur, gain) {
    const c = this.ctx, env = c.createGain();
    env.gain.setValueAtTime(0.0001, t); env.gain.exponentialRampToValueAtTime(gain, t + 0.012); env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    env.connect(this.master);
    const o1 = c.createOscillator(); o1.type = 'sine'; o1.frequency.value = freq;                 // 기음
    const o2 = c.createOscillator(); o2.type = 'sine'; o2.frequency.value = freq * 2.76;          // 종 특유의 비조화 배음
    const g2 = c.createGain(); g2.gain.value = 0.25; o2.connect(g2); g2.connect(env); o1.connect(env);
    o1.start(t); o2.start(t); o1.stop(t + dur + 0.05); o2.stop(t + dur + 0.05);
  },
};
