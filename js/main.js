/* =========================================================
   main.js — 부트스트랩: config → World/UI/Input/Director → 데이터 소스 선택 → 루프
   소스 종류는 Sniffer.sources 레지스트리(mock.js/live.js 가 등록) + config.sources 문구로 결정.
   ========================================================= */
(function () {
  'use strict';
  const cfg = Sniffer.config;
  /* 스쿼드 선택: URL ?squad= (Studio 가 넘겨줌) > ⚙에서 고른 기억값 > 자동(최근 갱신 스쿼드)
     Studio 안(iframe)에서는 상단 바가 스쿼드의 주인이다 — 여기 기억값을 쓰면 바와 교실이 서로 다른 스쿼드를 가리킨다 */
  const EMBEDDED = window.parent !== window;
  const urlSquad = new URLSearchParams(location.search).get('squad'), savedSquad = localStorage.getItem('sniffer_squad');
  if (urlSquad) cfg.squadId = urlSquad; else if (savedSquad && !EMBEDDED) cfg.squadId = savedSquad;
  /* 무대 맞춤(cover/contain) · 음성: URL 이 config 를 덮어쓴다 (Studio 교실 전체화면: ?voice=1) */
  { const q = new URLSearchParams(location.search); if (q.get('fit')) cfg.fit = q.get('fit'); if (q.get('voice') === '1') cfg.voice.enabled = true; if (q.get('voice') === '0') cfg.voice.enabled = false; }
  document.body.classList.toggle('fit-cover', cfg.fit === 'cover'); document.body.classList.toggle('fit-fill', cfg.fit === 'fill');
  if (cfg.fit === 'cover') cfg.world.player.y = Math.min(cfg.world.player.y, 460);   // 꽉 채우면 아래쪽이 잘리므로 플레이어는 책상 사이에서 시작
  { const bd = document.getElementById('backdrop'); if (bd && window.BG_DATA) bd.style.backgroundImage = `url(${window.BG_DATA})`; }   // fill 모드의 흐린 교실 배경
  const world = new Sniffer.World(document.getElementById('world'), cfg);
  const ui = new Sniffer.UI(world, cfg);
  const input = new Sniffer.Input(cfg.controls);
  const director = new Sniffer.Director(world, ui, cfg);
  const registry = Sniffer.sources || {};
  let source = null, sourceKind = null;

  world.setSprites(window.SPRITE_SETS || (window.SPRITE_DATA ? { robot: window.SPRITE_DATA } : {}));
  world.setBackground(window.BG_DATA || '');
  if (cfg.theme.emptySeatGhosts) ui.ghostSeats(world.emptySeats());
  if (Sniffer.Audio) Sniffer.Audio.init(cfg.audio || {});
  { const kb = document.querySelector('#talkHint .kbd'); if (kb && cfg.controls && cfg.controls.interactLabel) kb.textContent = cfg.controls.interactLabel; }   // 힌트 라벨도 config 따라감

  /* ---- Studio(부모 창) 단축키 릴레이: 교실 iframe 에 포커스가 있어도 1/2/3(화면 전환)·F(전체화면)가 통하게 ---- */
  if (EMBEDDED) addEventListener('keydown', e => {
    if (/^[123fF]$/.test(e.key) && !e.metaKey && !e.ctrlKey && !e.altKey && !/input|select|textarea/i.test(e.target.tagName)) parent.postMessage({ studioKey: e.key }, location.origin);
  });
  /* Studio 안에서는 ⚙ 의 스쿼드 고르개를 숨긴다 — 스쿼드 선택은 상단 바 하나뿐 (id 선택자가 display 를 지정하므로 hidden 속성으론 안 숨겨짐) */
  if (EMBEDDED) { const row = document.getElementById('squadRow'); if (row) row.style.display = 'none'; }

  /* ---- 입력 ---- */
  [].concat(cfg.controls.interact || 'e').forEach(k => input.on(k, () => { const a = world.nearestAgent(); if (a) ui.openChat(a); }));   // 대화 키(여러 개 가능): config.controls.interact
  input
       .on('n', () => ui.toggleNerd())
       .on('t', () => ui.openTask())
       .on('m', () => { const b = document.getElementById('bellBtn'); if (b) b.click(); })
       .on('escape', () => ui.closeAll());

  /* ---- 문제 내기 / 대화 응답 → 현재 소스에 위임 ---- */
  ui.onTask = (text, cat) => {
    if (source && source.enqueueTask) { source.enqueueTask(text, cat); ui.setQueue(source.queueLength ? source.queueLength() : 0); }
    else ui.annotate('이 데이터 소스에서는 문제를 낼 수 없습니다', 'warn');
    ui.trace({ ev: 'user_task_queued', text: Sniffer.util.short(text, 40), cat, source: sourceKind }, 'tEv');
  };
  ui.replyProvider = (a, q) => (source && source.reply ? source.reply(a, q) : '…');
  /* 말로 문제 내기: 인식된 문장 = 문제 내기와 같은 경로 */
  if (Sniffer.Voice) { Sniffer.Voice.init(cfg, text => ui.onTask(text, 'auto')); if (cfg.voice.enabled) input.on(cfg.voice.hotkey || 'v', () => Sniffer.Voice.toggle()); }

  /* ---- 루프 ---- */
  let last = performance.now();
  setInterval(() => {
    const t = performance.now(), dt = Math.min((t - last) / 1000, 1); last = t;
    world.update(dt, input.vec());
    ui.tick(world.nearestAgent());
    if (source && source.queueLength) ui.setQueue(source.queueLength());
  }, 33);
  let burnAt = 0;
  (function render(t) { world.draw(t); if (ui.nerdOpen() && t - burnAt > 500) { burnAt = t; ui.drawBurn(); } requestAnimationFrame(render); })(0);

  /* ---- 데이터 소스 선택 ---- */
  async function chooseSource() {
    const qs = new URLSearchParams(location.search).get('source');      // ?source=mock|live 로 강제 (데모/캡처용)
    const want = qs && registry[qs] ? qs : cfg.dataSource;
    if (want !== 'auto' && registry[want]) { const av = registry[want].available ? await registry[want].available(cfg) : { ok: true }; if (av.ok) return want; }
    if (registry.live) { const av = await registry.live.available(cfg); if (av.ok && (av.squads > 0 || want === 'live')) return 'live'; }
    return 'mock';
  }
  async function startSource(kind) {
    if (!registry[kind]) { console.warn('[main] unknown source', kind); kind = 'mock'; }
    if (source && source.stop) source.stop();
    director.reset();
    sourceKind = kind; source = registry[kind].create(director, cfg);
    ui.setSource(kind, (cfg.sources[kind] && cfg.sources[kind].chip) || kind);
    await source.start();
    if (kind === 'live' && window.AIGO) { const tick = () => { const n = AIGO.state.squad && AIGO.state.squad.name; if (n) ui.setSource('live', `● LIVE · ${n}`); }; setTimeout(tick, 1500); AIGO.on(tick); }
  }
  document.getElementById('srcChip').addEventListener('click', async () => {
    const kinds = Object.keys(registry), next = kinds[(kinds.indexOf(sourceKind) + 1) % kinds.length];
    const av = registry[next].available ? await registry[next].available(cfg) : { ok: true };
    startSource(av.ok ? next : 'mock');
  });

  /* ---- 시작: theme.intro=false(기본) 이면 설명 오버레이 없이 바로 등교. true 면 클릭해서 시작하는 타이틀 화면 ---- */
  const intro = document.getElementById('intro');
  const begin = kind => {
    if (intro.parentNode) intro.remove(); ui.t0 = performance.now();
    ui.trace({ ev: 'session_start', source: kind || 'mock' }, 'tEv');
    startSource(kind || 'mock');
  };
  // 오디오는 첫 사용자 제스처(클릭/키)에서 한 번만 해제 — 인트로 클릭이 없어도 종소리가 나게
  if (Sniffer.Audio) { const unlock = () => { Sniffer.Audio.unlock(); removeEventListener('pointerdown', unlock); removeEventListener('keydown', unlock); }; addEventListener('pointerdown', unlock); addEventListener('keydown', unlock); }
  chooseSource().then(k => {
    const qp = new URLSearchParams(location.search);
    if (cfg.theme.intro && !qp.get('skipIntro')) {
      intro.querySelector('h1').textContent = cfg.text.title;
      intro.querySelector('p').innerHTML = cfg.text.introHtml;
      intro.querySelector('.go').textContent = cfg.text.go;
      intro.querySelector('.src').textContent = (cfg.sources[k] && cfg.sources[k].intro) || k;
      intro.addEventListener('click', () => begin(k), { once: true });
    } else begin(k);                                                  // 설명 없이 바로 시작 (팀장: "설명 없애자, 게임 같잖아")
    if (qp.get('nerd')) setTimeout(() => ui.toggleNerd(), 300);     // ?nerd=1 이면 Nerd 패널 열린 채 시작
    if (qp.get('chat')) { const tryOpen = () => { const a = world.agents()[0]; if (!a) return setTimeout(tryOpen, 300); ui.chatMode = qp.get('chat') === 'web' ? 'web' : 'vn'; ui.openChat(a); }; setTimeout(tryOpen, 1500); }   // ?chat=vn|web 캡처용 (첫 에이전트 등장 후 대화창 자동 오픈)
  });

  Sniffer.app = { world, ui, input, director, registry, get source() { return source; }, get sourceKind() { return sourceKind; }, startSource };
})();
