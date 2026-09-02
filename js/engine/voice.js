/* =========================================================
   engine/voice.js — 말로 문제 내기(STT) + 답 읽어 주기(TTS). Web Speech API (Chrome/Edge; https 또는 localhost, 마이크 권한).
   켜는 법: config.voice.enabled 또는 ?voice=1 (Studio 교실 전체화면). 꺼져 있으면 안내판·버튼이 없고 소리도 없다.
   핸즈프리 루프(config.voice.auto): 접속 → 바로 듣기("문제를 말해 주세요") → 문장 끝 → 문제 내기(onSubmit) → 풀이 중 →
     live.js 가 done 에서 speakAnswer() → 답을 다 읽으면 → 다시 듣기. 버튼(🎙/V)이나 안내판 클릭은 수동 켜고 끄기.
   상태: off · idle(꺼짐) · listen(듣는 중) · busy(풀이 중) · speak(읽는 중) · denied(마이크 권한 없음) · unsupported

   지켜야 할 규칙 세 가지 (여기서 깨지면 데모 중 마이크가 죽는다)
   1) 인식 객체는 한 번에 하나: 모든 콜백은 `this._rec !== rec` 이면 즉시 무시한다(옛 객체의 뒤늦은 onend 가 새 세션을 끈다).
   2) 말하기 전에는 반드시 _abort(): 스피커로 나가는 답을 마이크가 다시 듣고 그걸 새 문제로 내는 되먹임을 막는다.
   3) 발화에는 세대 번호(_sgen): 취소된 발화의 onend 가 다음 발화/듣기를 건드리지 않게 한다.
   ========================================================= */
window.Sniffer = window.Sniffer || {};

Sniffer.Voice = {
  enabled: false, supported: false, state: 'off', auto: false,
  _rec: null, _voice: null, _busyTimer: null, _restartTimer: null, _permTimer: null, _sgen: 0, _netFails: 0, _wasAuto: false,

  init(cfg, onSubmit) {
    const V = this.cfg = cfg.voice || {}; this.onSubmit = onSubmit; this.enabled = !!V.enabled; this.auto = !!V.auto;
    const $ = id => document.getElementById(id);
    this.btn = $('micBtn'); this.panel = $('voicePanel'); this.main = $('voiceMain'); this.txt = $('voiceText'); this.hint = $('voiceHint');
    if (!this.enabled || !this.panel) return this;
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    this.supported = !!SR; this.panel.hidden = false; if (this.btn) this.btn.hidden = false;
    if ('speechSynthesis' in window) { const pick = () => { const vs = speechSynthesis.getVoices(); this._voice = vs.find(v => /^ko/i.test(v.lang) && /Google|Yuna|Premium|Natural/i.test(v.name)) || vs.find(v => /^ko/i.test(v.lang)) || null; }; pick(); speechSynthesis.onvoiceschanged = pick; }
    if (!SR) { this._set('unsupported', '이 브라우저는 음성 입력이 안 돼요', '', 'Chrome 이나 Edge 에서 열어 주세요 · 문제는 ＋ 문제 내기 로'); if (this.btn) { this.btn.disabled = true; this.btn.textContent = '🎙 음성 입력 불가'; } return this; }
    this.panel.addEventListener('click', () => this.toggle());
    if (this.btn) this.btn.addEventListener('click', () => this.toggle());
    /* 탭을 벗어나면 마이크와 소리를 멈춘다(발표자 슬라이드 위로 새는 것 방지), 돌아오면 다시 듣는다 */
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) { if (this.state === 'off' || this.state === 'denied' || this.state === 'unsupported') return; this._wasAuto = this.auto && (this.state === 'listen' || this.state === 'speak'); this.silence(); clearTimeout(this._busyTimer); this._set('idle', '잠시 멈췄어요', '', '이 창으로 돌아오면 다시 듣습니다'); }
      else if (this._wasAuto) { this._wasAuto = false; this.listen(); }
    });
    addEventListener('pagehide', () => this.silence());
    if (this.auto) { this._set('idle', V.prompt || '문제를 말해 주세요', '', '마이크를 여는 중… 권한 창이 뜨면 허용을 눌러 주세요'); setTimeout(() => this.listen(), 500); }   // 접속 즉시
    else this._set('idle', '🎙 말로 문제 내기', '', '여기를 누르거나 V 키');
    return this;
  },

  /* ---- 상태 → 안내판/버튼 ---- */
  _set(state, main, text, hint) {
    this.state = state;
    if (this.panel) { this.panel.className = state; this.main.textContent = main || ''; this.txt.textContent = text ? `「${text}」` : ''; this.hint.textContent = hint || ''; }
    if (this.btn) { this.btn.classList.toggle('listening', state === 'listen'); this.btn.textContent = state === 'listen' ? '🎙 듣는 중… (누르면 멈춤)' : '🎙 말로 내기'; }
  },
  toggle() { if (!this.enabled || !this.supported) return; if (this.state === 'listen') this.stop(); else this.listen(); },   // 읽는 중에 누르면 건너뛰고 바로 듣기

  /* ---- 마이크·소리 즉시 정지 (화면 문구는 건드리지 않음) ---- */
  _abort() { clearTimeout(this._restartTimer); clearTimeout(this._permTimer); const r = this._rec; this._rec = null; if (r) { r.onstart = r.onresult = r.onerror = r.onend = null; try { r.abort(); } catch (e) {} } },
  _hush() { this._sgen++; if ('speechSynthesis' in window) speechSynthesis.cancel(); const au = this._audio; this._audio = null; if (au) { try { au.onended = au.onerror = null; au.pause(); au.src = ''; } catch (e) {} } },   // 진행 중 발화(브라우저 음성·서버 오디오) 취소 + 그 콜백 무효화
  silence() { this._abort(); this._hush(); },

  /* ---- 듣기 ---- */
  listen() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR || !this.enabled || this.state === 'denied' || this.state === 'unsupported') return;
    this.silence();                                            // 옛 인식·발화를 확실히 끊고 시작 (중복 시작 금지)
    const V = this.cfg, rec = this._rec = new SR(); rec.lang = V.lang || 'ko-KR'; rec.interimResults = true; rec.continuous = false; rec.maxAlternatives = 1;
    let finalText = '', gotAny = false;
    const mine = () => this._rec === rec;                      // 옛 인식 객체의 뒤늦은 콜백은 전부 무시
    rec.onstart = () => { if (!mine()) return; clearTimeout(this._permTimer); this._set('listen', V.prompt || '문제를 말해 주세요', '', V.example || ''); };
    clearTimeout(this._permTimer); this._permTimer = setTimeout(() => { if (mine() && this.state !== 'listen') this._set('idle', '마이크를 여는 중…', '', '권한 창이 뜨면 허용을 눌러 주세요'); }, 1800);
    rec.onresult = e => {
      if (!mine()) return; this._netFails = 0;
      let interim = ''; for (let i = e.resultIndex; i < e.results.length; i++) { const r = e.results[i]; if (r.isFinal) finalText += r[0].transcript; else interim += r[0].transcript; }
      gotAny = true; this._set('listen', '듣고 있어요…', finalText || interim, finalText ? '' : '말이 끝나면 바로 보냅니다');
    };
    rec.onerror = e => {
      if (!mine()) return; clearTimeout(this._permTimer);
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') { this._rec = null; this._set('denied', '마이크 권한이 필요해요', '', '주소창 왼쪽 🔒 → 마이크 허용 → 새로고침. 그동안은 ＋ 문제 내기 로'); }
      else if (e.error === 'audio-capture') { this._rec = null; this._set('denied', '마이크를 찾을 수 없어요', '', '마이크를 연결하고 새로고침'); }
      else if (e.error === 'network') this._netFails++;         /* no-speech / aborted / network: onend 에서 다시 듣는다 */
    };
    rec.onend = () => {
      if (!mine()) return; this._rec = null;
      if (this.state === 'denied' || this.state === 'unsupported') return;
      const t = finalText.trim();
      if (t.length >= (V.minChars || 3)) return this._submit(t);
      if (this.state !== 'listen') return;                      // 사용자가 멈췄거나 이미 다른 상태
      if (!this.auto) return this._set('idle', '🎙 말로 문제 내기', '', '여기를 누르거나 V 키');
      /* 인터넷이 끊기면(크롬 음성 인식은 클라우드) 빠르게 되풀이하지 말고 물러선다 */
      const net = this._netFails > 2, wait = net ? Math.min(8000, 350 * Math.pow(2, this._netFails - 2)) : 350;
      this._set('listen', V.prompt || '문제를 말해 주세요', '',
        net ? '인터넷이 불안정해 음성 인식이 쉬는 중 — 문제는 ＋ 문제 내기 로' : (gotAny ? '잘 못 들었어요 — 다시 말해 주세요' : (V.example || '')));
      this._restartTimer = setTimeout(() => this.listen(), wait);
    };
    try { rec.start(); } catch (e) { this._rec = null; this._set('idle', '마이크를 시작할 수 없어요', '', String(e.message || e)); }
  },
  stop() { this.silence(); this._set('idle', '🎙 말로 문제 내기', '', this.auto ? '멈췄어요 — 여기를 누르거나 V 키로 다시' : '여기를 누르거나 V 키'); },

  /* ---- 문제 내기 → 풀이 중 ---- */
  _submit(text) {
    this._abort();
    this._set('busy', '접수했어요 — 교실을 보세요', text, '스쿼드가 풀면 답을 읽어 드릴게요');
    if (this.onSubmit) this.onSubmit(text);
    this.cue(`"${Sniffer.util.short(text, 40)}" 문제로 냈어요. 스쿼드가 풀기 시작합니다.`);
    /* 실서버(live)가 아니면 답이 올 리 없다 — 8분씩 벙어리로 기다리지 않고 곧 사실대로 말하고 다시 듣는다 */
    const live = !(Sniffer.app && Sniffer.app.sourceKind && Sniffer.app.sourceKind !== 'live');
    clearTimeout(this._busyTimer);
    this._busyTimer = setTimeout(() => {
      if (this.state !== 'busy') return;
      if (live) return this._after();
      this._set('busy', '지금은 연습 모드예요', '', '서버가 붙으면 답을 읽어 드릴게요');
      this.speak('지금은 연습 모드라 답은 못 읽어 드려요. 다시 말해 주세요.', { onend: () => this._after() });
    }, live ? (this.cfg.busyTimeoutMs || 480000) : 10000);
  },
  _after() { if (this.auto) this.listen(); else this._set('idle', '🎙 말로 문제 내기', '', '여기를 누르거나 V 키'); },

  /* ---- 읽어 주기 ---- */
  clean(text) {
    return String(text || '').replace(/```[\s\S]*?```/g, ' 코드 생략 ').replace(/\\\[|\\\]|\\\(|\\\)|\$+/g, ' ').replace(/\\boxed\{([^}]*)\}/g, '$1')
      .replace(/[#*_`>|~]+/g, ' ').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/https?:\/\/\S+/g, ' 링크 ').replace(/\s+/g, ' ').trim();
  },
  /* 실패 사유: 엔진 원문(영어·파이썬 예외)을 그대로 읽지 않는다. 화면에는 원문이 그대로 남는다 */
  why(raw) {
    const r = String(raw || '');
    if (/timed?\s?out|timeout|no reply within|deadline exceeded/i.test(r)) return '응답 시간이 초과됐어요.';
    if (/\b50\d\b|unavailable|bad gateway|connection refused|fetch failed|no backend/i.test(r)) return '모델 서버가 응답하지 않았어요.';
    if (/\b429\b|rate limit/i.test(r)) return '요청 한도를 넘었어요.';
    if (/all tasks failed/i.test(r)) return '모든 작업이 실패했어요.';
    if (/context (length|window)|too long|maximum/i.test(r)) return '문제가 너무 길었어요.';
    if (/server restarted/i.test(r)) return '서버가 재시작됐어요.';
    return '콘솔에서 이유를 확인해 주세요.';
  },
  /* 음성 루프(마이크)와 무관하게 아무 때나 읽기. 서버 TTS(/_tts, Supertonic) 가 있으면 그 목소리로,
     없거나 실패하면 브라우저 음성으로. opts: { voice: 'F2', speed, onend } */
  say(text, opts) {
    opts = opts || {}; text = (text || '').trim();
    if (!text) { if (opts.onend) opts.onend(); return; }
    this._hush();
    const g = this._sgen, cfg = this.cfg || {}, T = cfg.tts || {};
    const fin = () => { if (this._sgen !== g) return; if (opts.onend) opts.onend(); };
    if (T.path && this._ttsDown !== true && window.fetch) {
      const body = { text: text.slice(0, (cfg.agents && cfg.agents.maxChars) || 400), voice: opts.voice || T.voice, speed: opts.speed || (cfg.agents && cfg.agents.speed) || cfg.rate };
      fetch(T.path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
        .then(r => { if (!r.ok) throw new Error('tts ' + r.status); return r.blob(); })
        .then(blob => {
          if (this._sgen !== g) return;
          const au = new Audio(URL.createObjectURL(blob)); this._audio = au;
          au.onended = () => { if (this._audio === au) this._audio = null; URL.revokeObjectURL(au.src); fin(); };
          au.onerror = () => { if (this._audio === au) this._audio = null; this._sayBrowser(text, g, fin); };
          au.play().catch(() => { if (this._audio === au) this._audio = null; this._sayBrowser(text, g, fin); });   // 자동재생 차단 → 브라우저 음성
        })
        .catch(err => {                                        // 서비스가 없다: 한동안 묻지 않고 브라우저 음성으로
          this._ttsDown = true; setTimeout(() => { this._ttsDown = false; }, 60000);
          if (this._sgen === g) this._sayBrowser(text, g, fin);
        });
      return;
    }
    this._sayBrowser(text, g, fin);
  },
  _sayBrowser(text, g, fin) {
    if (!('speechSynthesis' in window) || this._sgen !== g) { fin(); return; }
    const u = new SpeechSynthesisUtterance(text);
    u.lang = (this.cfg && this.cfg.lang) || 'ko-KR'; u.rate = (this.cfg && this.cfg.rate) || 1; if (this._voice) u.voice = this._voice;
    let done = false; const end = () => { if (done) return; done = true; fin(); };
    u.onend = end; u.onerror = end; setTimeout(end, Math.min(120000, 400 + text.length * 180));
    speechSynthesis.speak(u);
  },
  /* 에이전트가 답을 끝냈을 때: 그 캐릭터 세트의 프리셋 목소리로 */
  speakFor(ent, text) {
    const A = (this.cfg && this.cfg.agents) || {};
    if (A.enabled === false || !ent) return;
    const voice = (A.presets || {})[ent.charSet] || A.voice;
    this.say(this.clean(text), { voice, speed: A.speed });
  },
  speak(text, opts) {
    opts = opts || {};
    if (!this.enabled || !text) { if (opts.onend) opts.onend(); return; }
    this._abort();                                             // 스피커 소리를 마이크가 되먹지 않게
    if ((this.cfg.tts || {}).path) return this.say(text, opts);   // 서버 목소리가 있으면 답 읽기도 그것으로
    if (!('speechSynthesis' in window)) { if (opts.onend) opts.onend(); return; }
    this._hush();                                              // 앞 발화 취소 + 그 콜백 무효화
    const g = this._sgen, u = new SpeechSynthesisUtterance(text);
    u.lang = this.cfg.lang || 'ko-KR'; u.rate = this.cfg.rate || 1; if (this._voice) u.voice = this._voice;
    let done = false; const fin = () => { if (done || this._sgen !== g) return; done = true; if (opts.onend) opts.onend(); };
    u.onend = fin; u.onerror = fin; setTimeout(fin, Math.min(120000, 400 + text.length * 180));   // onend 가 안 오는 브라우저 대비
    speechSynthesis.speak(u);
  },
  cue(text) { if (this.cfg.cues !== false) this.speak(text); },
  /* 답 읽기: 앞부분만(maxSpeakChars). 다 읽으면 자동 모드는 다시 듣는다 */
  speakAnswer(text, ok) {
    const max = this.cfg.maxSpeakChars || 400, body = this.clean(text), cut = body.length > max ? body.slice(0, max) + ' … 이하 생략.' : body;
    clearTimeout(this._busyTimer);
    this._set('speak', ok ? '답을 읽어 드릴게요' : '이번 문제는 실패했어요', Sniffer.util.short(body, 60), this.auto ? '다 읽으면 다시 들을게요 · 누르면 건너뜀' : '');
    this.speak(ok ? (cut ? '다 풀었어요. 답은: ' + cut : '다 풀었어요.') : '이번 문제는 실패했어요. ' + this.why(text),
      { onend: () => { if (this.state === 'speak') this._after(); } });
  },
};
