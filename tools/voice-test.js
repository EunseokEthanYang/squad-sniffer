/* voice.js 상태 기계 시험: 가짜 마이크(SpeechRecognition)·가짜 스피커(speechSynthesis) */
const fs = require('fs'), path = '/Users/eunseokyang/Documents/Junction Asia Hackathon/squad-sniffer/js/engine/voice.js';
const els = {}; const mk = () => ({ textContent: '', className: '', hidden: true, disabled: false, classList: { toggle(){}, add(){}, remove(){} }, addEventListener(t, f) { this._h = f; }, click() { this._h && this._h(); } });
for (const id of ['micBtn','voicePanel','voiceMain','voiceText','voiceHint']) els[id] = mk();
const listeners = {};
global.document = { getElementById: id => els[id] || null, addEventListener: (t, f) => (listeners[t] = f), hidden: false };
global.addEventListener = (t, f) => (listeners[t] = f);

let live = [];                                    // 살아 있는 인식 객체 (여러 개면 중복 시작 = 버그)
class FakeSR {
  constructor() { this.aborted = false; live.push(this); }
  start() { this.started = true; setTimeout(() => { if (!this.aborted && this.onstart) this.onstart(); }, 1); }
  abort() { this.aborted = true; live = live.filter(r => r !== this); setTimeout(() => this.onend && this.onend(), 1); }
  say(text) { this.onresult && this.onresult({ resultIndex: 0, results: [Object.assign([{ transcript: text }], { isFinal: true })] }); this.onend && this.onend(); live = live.filter(r => r !== this); }
  err(kind) { this.onerror && this.onerror({ error: kind }); this.onend && this.onend(); live = live.filter(r => r !== this); }
}
global.SpeechRecognition = FakeSR; global.window = global;
let spoken = [], utterances = [];
global.SpeechSynthesisUtterance = class { constructor(t) { this.text = t; utterances.push(this); } };
global.speechSynthesis = {
  speaking: false, getVoices: () => [{ lang: 'ko-KR', name: 'Yuna' }],
  speak(u) { spoken.push(u.text); this.cur = u; setTimeout(() => { if (this.cur === u && u.onend) u.onend(); }, 5); },   // 5ms 뒤 다 읽음
  cancel() { this.cur = null; },
};
global.fetch = () => Promise.reject(new Error('no server'));
global.localStorage = { _m: {}, getItem(k) { return this._m[k] ?? null; }, setItem(k, v) { this._m[k] = String(v); } };
global.Sniffer = { util: { short: (s, n) => String(s).slice(0, n) }, app: { sourceKind: 'live' } };
eval(fs.readFileSync(path, 'utf8'));
const V = Sniffer.Voice, cfg = { voice: { enabled: true, auto: true, agents: { enabled: true }, lang: 'ko-KR', minChars: 3, cues: true, prompt: '문제를 말해 주세요', busyTimeoutMs: 480000 } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
let submitted = [];
const fail = [];
const check = (name, cond, extra) => { console.log((cond ? '  ok   ' : '  FAIL ') + name + (extra ? '  ' + extra : '')); if (!cond) fail.push(name); };

(async () => {
  V.init(cfg, t => submitted.push(t));
  await sleep(520);
  check('접속하면 바로 듣는다', V.state === 'listen' && live.length === 1, 'state=' + V.state + ' recs=' + live.length);

  live[0].say('HTTP 멀티플렉싱을 정리해줘');
  await sleep(20);
  check('말하면 문제로 접수', submitted.length === 1 && V.state === 'busy', 'state=' + V.state);
  check('접수 멘트를 말한다', spoken.some(t => /문제로 냈어요/.test(t)));
  check('말하는 동안 마이크는 꺼진다 (되먹임 방지)', live.length === 0, 'recs=' + live.length);

  spoken = [];
  V.speakAnswer('## 답\n`0.70s` 입니다 https://x.test', true);
  await sleep(3);
  check('답 읽는 중', V.state === 'speak');
  V.toggle();                                        // 안내판 클릭 = 건너뛰기 (예전엔 여기서 마이크가 죽었다)
  await sleep(30);
  check('건너뛰면 곧바로 다시 듣는다', V.state === 'listen', 'state=' + V.state);
  check('인식 객체는 하나만 산다', live.length === 1, 'recs=' + live.length);
  check('마크다운·링크는 읽지 않는다', spoken[0] && !/```|https?:/.test(spoken[0]), spoken[0] && spoken[0].slice(0, 40));

  /* 답 두 개가 연달아 올 때: 뒤 답이 끝까지 읽히고 마이크는 한 번만 다시 열린다 */
  spoken = []; live.forEach(r => r.abort()); await sleep(5);
  V.speakAnswer('첫 번째 답', true); await sleep(1); V.speakAnswer('두 번째 답', true);
  await sleep(40);
  check('나중 답이 끝까지 읽힌다', spoken.length === 2 && /두 번째 답/.test(spoken[1]), JSON.stringify(spoken));
  check('그 뒤 마이크는 한 번만 열린다', live.length === 1 && V.state === 'listen', 'recs=' + live.length + ' state=' + V.state);

  /* 실패는 영어 원문을 읽지 않는다 */
  spoken = [];
  V.speakAnswer('agent stub-writer produced no reply within 300s', false);
  await sleep(3);
  check('실패 사유는 한국어로', /응답 시간이 초과/.test(spoken[0] || '') && !/agent|within/.test(spoken[0] || ''), spoken[0]);
  await sleep(40);

  /* 마이크 권한 거부 → 되풀이하지 않는다 */
  live.forEach(r => r.abort()); await sleep(10); V.listen(); await sleep(5);
  live[0].err('not-allowed'); await sleep(400);
  check('권한 거부면 멈추고 안내', V.state === 'denied' && live.length === 0, 'state=' + V.state + ' recs=' + live.length);

  /* 탭을 벗어나면 멈춘다 */
  V.state = 'listen'; V._rec = null; global.document.hidden = true; listeners.visibilitychange();
  check('탭을 벗어나면 마이크를 끈다', V.state === 'idle' && live.length === 0, 'state=' + V.state);

  /* 연습(mock) 모드면 8분이 아니라 곧 사실대로 */
  Sniffer.app.sourceKind = 'mock'; V.state = 'idle'; V._submit('연습 문제입니다');
  check('연습 모드에서도 접수 표시', V.state === 'busy');

  /* ---- 말 줄 세우기: 뒷사람이 앞사람 말을 끊지 않는다, 긴 글은 문장 단위로 차례로 ---- */
  V.silence(); spoken = [];
  const ent = { charSet: 'cho_mi' };
  let ended = 0;
  V.speakFor(ent, '첫 번째 학생의 답입니다. 두 문장이에요.', { onend: () => ended++ });
  V.speakFor(ent, '두 번째 학생의 답입니다.', { onend: () => ended++ });
  await sleep(60);
  check('두 학생 말이 모두 끝까지 나온다', spoken.length >= 2 && spoken.some(t => t.includes('첫 번째')) && spoken.some(t => t.includes('두 번째')), JSON.stringify(spoken));
  check('앞 말이 먼저, 뒷 말이 나중', spoken.findIndex(t => t.includes('첫 번째')) < spoken.findIndex(t => t.includes('두 번째')));
  check('각 말이 끝나면 onend 가 한 번씩', ended === 2, 'ended=' + ended);
  spoken = []; ended = 0;
  const long = Array.from({ length: 6 }, (_, i) => `이것은 ${i + 1}번째 문장이고 꽤 길게 이어져서 한 덩어리로는 다 못 읽을 정도로 길어요.`).join(' ');
  V.speakFor(ent, long, { onend: () => ended++ });
  await sleep(120);
  check('긴 답은 여러 덩어리로 나뉘어 전부 읽힌다', spoken.length >= 2 && spoken.join(' ').includes('6번째'), 'chunks=' + spoken.length);
  check('덩어리가 다 끝난 뒤에만 onend', ended === 1, 'ended=' + ended);

  /* ---- 풀이 중 마이크 붙잡기 ---- */
  V.silence(); V.auto = true; V.hold();
  check('풀이 시작: 마이크가 꺼진다', V.state === 'busy' && V.held && live.length === 0, 'state=' + V.state + ' recs=' + live.length);
  V.listen(); await sleep(5);
  check('붙잡힌 동안은 다시 듣지 않는다', live.length === 0, 'recs=' + live.length);
  V.release(); await sleep(520);
  check('실행이 끝나면 다시 듣는다', !V.held && V.state === 'listen' && live.length === 1, 'state=' + V.state + ' recs=' + live.length);
  console.log(fail.length ? '\n실패 ' + fail.length + '건: ' + fail.join(', ') : '\n모두 통과');
  process.exit(fail.length ? 1 : 0);
})();
