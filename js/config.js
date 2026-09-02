/* =========================================================
   config.js — 스쿼드/테마/레이아웃에 대한 "모든" 지식은 이 파일에만 둔다.
   엔진(js/engine/*)과 데이터 바인딩(js/data/*)은 여기 값만 읽고, 특정 스쿼드 구조를 가정하지 않는다.
   ========================================================= */
window.Sniffer = window.Sniffer || {};

Sniffer.config = {
  /* ---- 데이터 소스 ----
     'auto' : 프록시(/aigo)로 서버가 닿고 스쿼드가 있으면 live, 아니면 mock
     'live' : AIGO.state(실서버) 만 사용 / 'mock' : 내장 시나리오(서버 불필요) 만 사용            */
  dataSource: 'auto',
  proxyBase: '/aigo',
  squadId: null,            // null = 첫 스쿼드 자동
  pollMs: 10000,
  fastMs: 2000,
  sources: {                // 소스 종류별 표시 문구 (새 소스 추가 시 여기 + js/data/ 파일 하나)
    mock: { chip: '● MOCK · 내장 시나리오', intro: '데이터: 내장 시나리오 (서버 미연결)' },
    live: { chip: '● LIVE', intro: '데이터: 스쿼드 서버 연결됨' },
  },

  /* ---- 비용 규칙 (스쿼드 설계가 바뀌면 여기만) ----
     rates: 모델ID → 단가 배수. 정확히 같은 ID가 없으면 소문자 부분 일치(가장 긴 키 우선), 그래도 없으면 1.
     roleLabels: 단가 → 표시 라벨 (없으면 에이전트 이름). plannerLabel: 플래너(작업을 나누고 모으는 에이전트) 라벨, null 이면 단가 라벨 */
  rates: {
    'furiosa-ai/Qwen3-32B-FP8': 1,
    'furiosa-ai/gpt-oss-120b': 2,
    'furiosa-ai/K-EXAONE-236B-A23B-NVFP4A16': 3,
    /* 같은 계열 모델을 다른 프로바이더(Groq 등)로 돌릴 때: 부분 일치 키 */
    'gpt-oss-20b': 1, 'qwen3-32b': 1, 'llama-4-scout': 1, 'llama-3.1-8b': 1, 'gemma': 1,
    'gpt-oss-120b': 2, 'llama-3.3-70b': 2, 'llama-4-maverick': 2, 'qwen3-235b': 2,
    'exaone': 3, 'kimi-k2': 3, 'deepseek-r1': 3,
    /* 이 컴퓨터의 CLI 에이전트를 모델로 쓸 때(aigo-web LOCAL_AGENTS=1): 반장 claude 는 선배(2×), 일꾼 codex 는 후배(1×) */
    'claude-code': 2, 'codex-cli': 1,
  },
  roleLabels: { 1: '후배', 2: '선배', 3: '선생님' },
  plannerLabel: '반장',
  tierColors: { 1: '#3ecf6e', 2: '#4da3ff', 3: '#c77dff' },
  palette: ['#3ecf6e', '#4da3ff', '#c77dff', '#ffb020', '#ff5d5d', '#2ad4c9', '#b8ff5d', '#ff8fb0'],
  colors: { good: '#3ecf6e', bad: '#ff5d5d', warn: '#ffb020', loss: '#ff9f6e' },

  /* ---- 테마 (연출 옵션; 끄면 범용 N-에이전트 교실) ---- */
  theme: {
    name: 'classroom',
    cascade: true,              // 최상위 단가 에이전트는 평소 부재(교탁 공석), 호출/작업 시 문으로 등장
    teacherTier: 3,             // cascade일 때 교탁을 쓰는 단가 (rates에 없으면 최대 단가로 폴백)
    taximeter: true,            // 미터 단위 wtok(가중) / false면 tok
    rateLamps: true,            // 단가 램프 표시
    verdictCards: false,        // 판정 공식 카드(에스컬레이션/호출 판정 팝업) — 팀장 요청으로 일단 끔. 켜려면 true
    annotations: false,         // 하단 공지 팝업(수업 시작/접수/경고 자막) — 일단 끔. 켜려면 true (trace 에는 계속 기록)
    assemblyLineCostPerProblem: 2600, // Nerd 번다운 비교선(가상의 조립라인)
    emptySeatGhosts: false,     // 빈 책상에 '빈 자리' 라벨
    timetable: true,            // 교시별 진행 시간표 패널
    agentGauge: 'pencil',       // 에이전트별 토큰 소모 게이지: 'pencil'(연필이 닳음) | 'bar' | 'none'
    tags: 'auto',               // 이름표: 'auto'(일하는·가까운·포커스 캐릭터만) | 'always' | 'never' — 캐릭터를 따라다님
    defaultTheme: 'light',      // 첫 방문 테마 (light | default | draft)
    mockAgentBudget: 6000,      // mock 에서 에이전트당 가상 한도(tok) — live 는 budget.maxTokensPerAgent 사용
    intro: false,               // 시작 설명 오버레이(타이틀+조작법). false = 바로 등교 (팀장: 설명 없애자). true 로 두면 클릭해서 시작
    /* 머리 위 이모트(RPG 말풍선 아이콘): 이벤트 → 기호. director 가 이벤트마다 world.emote() 호출. 끄려면 enabled:false */
    emotes: {
      enabled: true, ms: 1500,
      map:    { alert: '!', question: '?', fail: '✕', ok: '✓', help: '✋', sleep: 'z', money: '$', idea: '♪' },
      colors: { alert: '#ff5d5d', question: '#4da3ff', fail: '#ff5d5d', ok: '#3ecf6e', help: '#ffb020', sleep: '#8a7f6c', money: '#ffb020', idea: '#c77dff' },
      hop:    ['alert', 'question', 'fail', 'help'],                    // 이 이모트는 캐릭터가 살짝 뛰어오름
      on: {                                                            // 이벤트 → 이모트 키 (null 이면 없음)
        taskStart: 'idea', verifyOk: 'ok', verifyFail: 'fail', retry: 'alert', escalate: 'question', handoffTo: 'alert',
        exhausted: 'sleep', budgetWarn: 'money', cutLoss: 'money', halt: 'alert', submitOk: 'ok', submitFail: 'fail',
      },
    },
  },

  /* ---- 무대 맞춤 (?fit= 로 덮어씀)
     'fill'    = 교실 전체가 보이게 맞추고, 남는 공간은 흐린 교실 배경으로 채움 (기본)
     'cover'   = 화면을 꽉 채움(위쪽 고정, 아래·옆이 잘림) · 'contain' = 전체가 보이게(여백) ---- */
  fit: 'fill',

  /* ---- 음성: 마이크로 말해서 문제 내기(STT) + 답을 읽어 주기(TTS). Web Speech API(Chrome). ?voice=1 로 켬 — Studio 교실 전체화면이 켜 준다 ---- */
  voice: {
    enabled: false, lang: 'ko-KR', hotkey: 'v',
    auto: true,                                  // 켜지면 접속 즉시 듣기 시작, 답을 읽어 준 뒤 다시 듣기 (버튼 불필요)
    rate: 1.05, maxSpeakChars: 400,             // 답 읽기: 속도, 최대 글자(그 뒤는 "… 이하 생략")
    cues: true,                                  // 접수/완료/실패 짧은 안내 멘트
    /* 에이전트가 답을 끝낼 때마다: 그 캐릭터의 미연시 대화창을 열고, 그 캐릭터 목소리로 읽는다.
       목소리는 서버의 /_tts (aigo-web LOCAL_TTS=1 → Supertonic 3) 가 있으면 그것, 없으면 브라우저 음성.
       presets: 캐릭터 세트 → Supertonic 프리셋(F1~F5 여성, M1~M5 남성) */
    agents: { enabled: true, vn: true, maxChars: 400, speed: 1.05,
              presets: { cho_mi: 'F1', no_mi: 'F2', seonsaeng: 'F4', gal_bi: 'F3', robot: 'M2' } },
    tts: { path: '/_tts/v1/tts' },
    minChars: 3,                                 // 이보다 짧은 인식 결과는 버림(잡음)
    busyTimeoutMs: 8 * 60 * 1000,               // 답이 이만큼 안 오면 다시 듣기
    prompt: '문제를 말해 주세요',
    example: '예: "HTTP/2 멀티플렉싱의 핵심을 조사하고 한국어로 정리해줘"',
  },

  /* ---- 조작: 이동은 방향키 전용(팀장 결정). WASD·게임패드는 필요할 때만 true ---- */
  controls: { arrows: true, wasd: false, gamepad: false, preventScroll: true, interact: ['Space', 'e', 'ShiftLeft'], interactLabel: 'Space' },   // interact: e.code('Space','ShiftLeft') 또는 e.key('e'). 배열이면 전부 먹힌다

  /* ---- 소리: 종소리 종류별 패턴은 engine/audio.js, 음원 파일로 바꾸려면 files 에 경로 ---- */
  audio: {
    enabled: true,
    volume: 0.5,
    files: null,                // 예: { next:'assets/sfx/next.mp3', end:'assets/sfx/end.mp3', fail:'assets/sfx/fail.mp3' }
    on: { taskStart: 'next', submitOk: 'end', submitFail: 'fail', enter: 'enter', budgetWarn: 'warn' },  // 이벤트 → 종 종류 (null 이면 무음)
  },

  /* ---- 문제 카테고리 (문제 내기 셀렉트 + mock 비트 매핑) ---- */
  taskCategories: [
    { id: 'auto', label: '분류: 자동(triage)', beat: null },
    { id: 'generic', label: 'generic', beat: 'bEasy' },
    { id: 'math', label: 'math', beat: 'bVerifyRetry' },
    { id: 'coding', label: 'coding', beat: 'bEscalate' },
  ],

  /* ---- 월드 기하 (배경 이미지 960x717 기준) ---- */
  world: {
    w: 960, h: 717,
    bounds: { x0: 84, y0: 238, x1: 896, y1: 690 },   // (구) 사각 경계 — walkable 이 있으면 무시
    walkable: [                                        // 플레이어가 설 수 있는 바닥 영역(사각형 합집합) — 벽/창문/아래쪽 벽 밖으로 못 나감
      { x: 112, y: 232, w: 773, h: 414 },              // 본 교실 바닥 (좌 창문벽 ~112, 우 가구 ~885, 아래 벽 ~646)
      { x: 490, y: 646, w: 230, h: 42 },               // 하단 중앙 알코브(문턱)
    ],
    board: { x: 463, y: 112 },
    boardPickup: { x: 372, y: 262 },        // 칠판 앞·교탁 왼쪽 복도 (교탁 위에 겹치지 않게)
    teacherDesk: { x: 412, y: 222, w: 104, h: 66 },
    teacherHome: { x: 463, y: 200 },                    // 발(y+16=216)이 교탁 그림 상판(≈204)~바닥(288) 안 = 책상 뒤에 섬(전경 조각이 하반신을 가림)
    teacherSideDX: 18,                                  // 교탁을 돌아갈 때 쓰는 좌/우 옆 통로 (목적지 쪽을 고름)
    foreground: [{ x: 412, y: 204, w: 104, h: 84 }],    // 캐릭터보다 앞에 다시 그리는 배경 조각(교탁 그림 전체 204..288) → 발이 288 위인 캐릭터를 가림
    door: { x: 830, y: 196 },
    submitSpot: { x: 475, y: 250 },
    deskGrid: { cols: [245, 382, 506, 629, 751], rows: [298, 384, 468, 552], w: 82, h: 74, sitDY: 54, solidH: 40, solidDY: -10 },   // solid: 그림 상판(rows-10)부터 40px
    seatColOrder: [1, 3, 2, 0, 4],     // 앞줄부터, 가운데 근처 먼저
    aisleX: [313, 313, 567, 690, 690], // 열별 통로 x (교탁 x 412..516 아래는 절대 안 지나게)
    corridorY: 274,                    // 맨 앞 복도: 발(y+16=290) ≥ 교탁 바닥 288 → 교탁 "앞"으로 지나감
    approach: { teacher: { dx: -70, dy: 40 }, seat: { dx: -62, dy: 0 }, doorTurnDX: 60, doorTurnDY: 30 },  // 남에게 다가갈 때 서는 위치
    furniture: [
      { x: 94, y: 139, w: 110, h: 100 }, { x: 636, y: 170, w: 138, h: 64 },
      { x: 888, y: 283, w: 70, h: 200 }, { x: 74, y: 528, w: 50, h: 96 },
    ],
    player: { x: 480, y: 640, speed: 124, color: '#ff8fb0' },
    agentSpeed: 76,
    sprite: { size: 76, frame: 64, baseHue: 210, keys: { down: 'walk_down', up: 'walk_up', side: 'walk_side', left: 'walk_left', right: 'walk_right', work: 'work' } },
    talkRadius: 84,
  },

  /* ---- 캐릭터 세트 배정 (assets/src/<set>/…): 누가 어떤 캐릭터로 보이는가 ----
     byName > byRate > fallback. tint:true 인 세트(로봇)만 색조를 에이전트 색에 맞춰 돌린다.  */
  characters: {
    sets: { robot: { tint: true }, cho_mi: {}, no_mi: {}, gal_bi: {}, seonsaeng: {} },
    byName: {},                                 // 예: { 'Planner': 'gal_bi' }
    byRate: { 1: 'cho_mi', 2: 'no_mi', 3: 'seonsaeng' },
    player: 'gal_bi',
    fallback: 'robot',
    /* 미연시 입간판(立ち絵): 세트별 전신 원화(assets/portraits/*.png, 투명 배경·여백 트림). 없는 세트(seonsaeng, robot)는 도트 스프라이트로 폴백 */
    portraits: { cho_mi: 'assets/portraits/cho_mi.png', no_mi: 'assets/portraits/no_mi.png', gal_bi: 'assets/portraits/gal_bi.png' },
  },

  /* ---- 문구 ---- */
  text: {
    title: 'TAXIMETER SQUAD',
    meterTitle: 'TAXIMETER',
    teacherAbsent: '(공석)',
    teacherAbsentSub: '호출 0회가 자랑',
    timetableTitle: '오늘의 시간표',
    period: n => n + '교시',
    ttEmpty: '예정된 문제 없음',
    introHtml: '여기는 AI 에이전트들의 교실입니다.<br>에이전트들이 문제를 나눠 풀고, 막히면 손을 들어 서로를 부릅니다.<br>' +
      '상단 미터기는 그들이 쓴 비용(토큰)을 보여줍니다.<br><br>' +
      '<span class="kbd">←↑↓→</span> 방향키로 돌아다니고, 캐릭터 옆에서 <span class="kbd">L-Shift</span>로 직접 대화하세요.<br>' +
      '좌상단 <b style="color:#ffb020">문제 내기</b>로 당신의 문제를 칠판에 올려보세요.',
    go: '▶ 클릭해서 등교하기',
  },

  /* ---- 스쿼드 엔진 이벤트 → 연출 (live.js _engineEvent) ----
     엔진(aigo-web/backend/squad_engine.py)이 GET squads/{id}/executions/{eid}/events?after=seq 로 주는 이벤트 종류:
       request · planning · plan · wave · task_start · task_retry · task_done · task_failed · aggregate · done
     live.js 가 이 어휘를 director 계약(task_start/handoff/escalate/working/verify/retry/submit …)으로 번역한다.
     timetableMax: 시간표에 보일 최근 실행(교시) 수 */
  timetableMax: 12,

  /* ---- (예비) AI:GO 자체 SSE 이벤트 이름 → 정규화 매핑. 엔진 이벤트가 있으면 쓰이지 않는다 ---- */
  eventMap: {
    // 'squad.task.assigned': { kind: 'handoff', agentId: d => d.fromAgentId || d.agentId, tokens: d => 0 },
  },

  /* ---- mock 전용: 가상 에이전트 구성 (서버 없이 데모) ---- */
  mockAgents: [
    { id: 'm-r1', name: 'Qwen3-32B', modelId: 'furiosa-ai/Qwen3-32B-FP8' },
    { id: 'm-r2', name: 'gpt-oss-120b', modelId: 'furiosa-ai/gpt-oss-120b' },
    { id: 'm-r3', name: 'K-EXAONE-236B', modelId: 'furiosa-ai/K-EXAONE-236B-A23B-NVFP4A16' },
  ],
};
