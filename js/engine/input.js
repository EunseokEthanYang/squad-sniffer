/* =========================================================
   engine/input.js — 키보드(+옵션 게임패드) 입력. 조이스틱 DOM 없음(요구사항).
   이동 키는 config.controls 로 결정: 기본은 방향키(←↑↓→) 전용. WASD/게임패드는 플래그로만 켬.
   ========================================================= */
window.Sniffer = window.Sniffer || {};

Sniffer.Input = class Input {
  constructor(opts) {
    const o = Object.assign({ arrows: true, wasd: false, gamepad: false, preventScroll: true }, opts || {});
    this.opts = o; this.keys = {}; this.hotkeys = {}; this._gpPressed = false;
    const ARROWS = ['arrowleft', 'arrowright', 'arrowup', 'arrowdown'];
    addEventListener('keydown', e => {
      if (this.typingNow()) { if (e.key === 'Escape' && this.hotkeys.escape) { e.preventDefault(); this.hotkeys.escape(); } return; }
      const k = e.key.toLowerCase(), c = (e.code || '').toLowerCase(); this.keys[k] = true;
      const hk = this.hotkeys[c] || this.hotkeys[k];                                   // e.code(ShiftLeft 등) 우선, 없으면 e.key
      if (o.preventScroll && ARROWS.includes(k)) e.preventDefault();                 // 방향키로 페이지가 스크롤되지 않게
      if (e.key === 'Escape' && this.hotkeys.escape) { e.preventDefault(); this.hotkeys.escape(); }
      else if (hk && !e.repeat) { e.preventDefault(); hk(); }   // 핫키로 입력창이 열려도 글자가 들어가지 않게
    });
    addEventListener('keyup', e => { this.keys[e.key.toLowerCase()] = false; });
    const clear = () => { this.keys = {}; this._gpPressed = false; };
    addEventListener('blur', clear);
    document.addEventListener('visibilitychange', () => { if (document.hidden) clear(); });
  }
  on(key, cb) { this.hotkeys[key.toLowerCase()] = cb; return this; }
  typingNow() { const t = document.activeElement && document.activeElement.tagName; return t === 'INPUT' || t === 'TEXTAREA'; }
  vec() {
    const k = this.keys, o = this.opts; let x = 0, y = 0;
    if (o.arrows) { if (k['arrowleft']) x--; if (k['arrowright']) x++; if (k['arrowup']) y--; if (k['arrowdown']) y++; }
    if (o.wasd)   { if (k['a']) x--; if (k['d']) x++; if (k['w']) y--; if (k['s']) y++; }
    const gp = o.gamepad && navigator.getGamepads && navigator.getGamepads()[0];
    if (gp) {
      if (Math.abs(gp.axes[0]) > .2) x += gp.axes[0]; if (Math.abs(gp.axes[1]) > .2) y += gp.axes[1];
      const pressed = !!(gp.buttons[0] && gp.buttons[0].pressed);
      const ik = this.hotkeys[(o.interact || 'e').toLowerCase()]; if (pressed && !this._gpPressed && ik) ik();
      this._gpPressed = pressed;
    }
    const m = Math.hypot(x, y); if (m > 1) { x /= m; y /= m; } return [x, y];
  }
};
