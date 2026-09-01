# squad-sniffer 구조 (v5, 모듈형)

실행: `python backend/proxy.py 8790` → `http://127.0.0.1:8790/index.html`
(프록시가 없으면 MOCK 모드로만 동작 — 서버 값은 CORS 때문에 프록시 경유 필수)

```
squad-sniffer/
├─ index.html                 껍데기: DOM + 스크립트 로드 순서만
├─ css/game.css               스타일 전부
├─ js/
│  ├─ config.js               ★ 스쿼드/테마/레이아웃 지식은 여기만 (단가표·라벨·테마 플래그·좌표·문구·EVENT_MAP)
│  ├─ engine/
│  │  ├─ world.js             캔버스 월드: 배경·스프라이트(틴팅)·엔티티·좌석 자동배정·이동/동선·충돌·렌더
│  │  ├─ input.js             키보드/게임패드 (조이스틱 DOM 없음)
│  │  ├─ audio.js             종소리(Web Audio 합성; config.audio.files 로 음원 교체 가능)
│  │  ├─ ui.js                DOM 오버레이: 라벨·말풍선·카드·자막·판정카드·HUD 미터·대화(미연시/웹)·문제내기·Nerd
│  │  └─ director.js          ★ 이벤트 → 연출. 데이터와 화면 사이의 유일한 계약(kind 어휘). 현재 교시의 단계/세부(담당 흐름·검증 실패·상위 호출·손절·비용) 갱신
│  ├─ data/
│  │  ├─ mock.js              서버 없이 도는 데모 비트(이벤트 나열). 에이전트 수와 무관(r1..rN 순위 참조). Sniffer.sources.mock 등록
│  │  └─ live.js              AIGO.state diff → 이벤트. 서버가 주는 사실만 번역(첫 스냅샷은 기준선만). Sniffer.sources.live 등록
│  └─ main.js                 부트: 소스 선택(auto/live/mock) · 루프 · 핫키 · 문제내기 연결
├─ backend/
│  ├─ proxy.py                로컬 백엔드: 정적 서빙 + /aigo/* 리버스 프록시(키 부착, SSE 통과) + POST /snap
│  ├─ aigo_client.js          REST/SSE 클라이언트 (기본 base /aigo)
│  ├─ aigo_state.js           ★ 상위 변수 스토어 AIGO.state (ADAPT.* 어댑터)
│  ├─ state_viewer.html       상위 변수 실시간 뷰어
│  ├─ dump_all.py / sse_tap.py 조사·기록 도구
│  └─ dump/                   덤프 결과
├─ assets/                    <set>/<key>.png 스프라이트 스트립(세트별 폴더: robot, cho_mi, no_mi, gal_bi, seonsaeng), 배경 PNG, sprites_data.js(생성물: window.SPRITE_SETS)
│  └─ src/<set>/<key>.mov     ★ 캐릭터 원본(정면 walk_down / 뒷면 walk_up / 왼쪽 walk_left / 오른쪽 walk_right / 측면 walk_side / 작업 work) + bg_classroom.png
├─ tools/build_sprites.ps1    ★ assets/src/<key>.mov|mp4 + bg_classroom.png → 스트립 PNG/배경 → sprites_data.js (캐릭터 수정 시 이것만 재실행)
├─ tools/inject_sprites.ps1   assets/*.png → assets/sprites_data.js
└─ docs/                      이 문서, data-catalog.md, flow-viz-ideation.md, intuition-roadmap.md, legacy_index_v4.html
```

## UI 정리 원칙 (2026-08-23)
- 좌상단은 **주 행동 1개(문제 내기) + ⚙ 설정 메뉴**만. 대화 UI·Nerd·시간표·종소리·테마 토글은 메뉴 안으로.
- **시간표 = 교실 벽 시간표**: 몇 교시·무슨 단계인지만 보이고, 담당 흐름/검증 실패/상위 호출/손절/비용 같은 어려운 정보는 **행을 클릭했을 때만**(#ttDetail).
- **생각 박스 포커스 정책**(ui.js): 카드를 든 에이전트(focus)·플레이어가 가까이 간 에이전트·대화 중인 에이전트만 전체 말풍선, 동시 전체 말풍선은 `theme.maxBubbles`(기본 2)까지, 나머지는 머리 위 작은 점(`.pip`: … / 💬). 다가가면 최근 말을 펼치고 떠나면 접힘 → 에이전트 N이 늘어도 화면이 안 어지러움.
- 단계 추적은 "현재 교시 1개" 모델(`director._cur()`): 라이브에서 동시 실행 태스크가 여러 개면 단계 표시가 섞일 수 있음 → 서버 이벤트에 task id가 실리면 `_stage(taskId, …)`로 확장.

## 검증 이력
- **v6 정리(2026-08-23)**: 캐릭터 76px, E 힌트는 캐릭터 옆(말풍선과 분리), Nerd 패널은 `#stage` 의 게임 옆 칸(body.nerd-open 시 게임 축소), 이름표는 캐릭터를 따라다니며 `theme.tags`(auto/always/never) 정책으로 표시, 교탁 분필 메모(선생님 부재 시만), 밝은 테마 기본(`theme.defaultTheme`), 데모용 쿼리 `?skipIntro=1&source=mock|live&nerd=1&theme=…`.
- 2026-08-23 v5: 3렌즈 적대적 리뷰(34건 → 확정 23건) 반영. 브라우저 실측: LIVE 자동연결·스폰, MOCK 전 비트(에스컬레이션 40s·최상위 호출 68s) 완주, 소스 전환 리셋, 교탁 등장/퇴장.

## 데이터 흐름

```
스쿼드 엔진(aigo-web/backend/squad_engine.py) ──REST──▶ aigo_client.js ──▶ aigo_state.js (AIGO.state 상위 변수)
   · squads/{id}, budget, budget/usage(누적), history(no 번호)              state.executions.events = 실행 이벤트 피드
   · executions/{eid}/events?after=seq  ← 실행의 이야기(request→plan→task_start→task_done→done)      │ 직렬 재생
                                                                                                    ▼
                     mock.js (내장 비트) ──▶  director.dispatch({kind,...})  ◀── live.js (_replay → _engineEvent)
                                                     │
                                          world.js(움직임) + ui.js(DOM)
(독립 실행: backend/proxy.py 가 /aigo/* 를 서버로 중계 · aigo-web 안에서는 같은 origin 이라 viz-bridge.js 가 proxyBase='/' 로 바꿈)
```

## 이벤트 계약 (director.js 상단 주석이 원본)

`spawn · task_start · working · say · verify · retry · handoff · escalate · budget · enter · leave · submit · idle · note · meter`
— 어떤 스쿼드 구조든 이 어휘로 번역되면 화면이 나온다. 새 연출은 director에 kind 하나를 추가하고, 새 데이터 소스는 `data/` 에 파일 하나를 추가한다.

엔진 쪽 어휘(서버가 주는 사실): `request · planning · plan · wave · task_start · task_retry · task_done · task_failed · aggregate · done` — `live.js _engineEvent` 가 위 director 어휘로 번역한다(한 실행 = 한 교시 = 카드 한 장, 작업 간 이동 = 카드 넘김). 표는 `data-catalog.md` §7, 결정 배경은 `HANDOFF.md` §12.

## 확장 포인트

| 바꾸고 싶은 것 | 고치는 곳 |
|---|---|
| 모델/단가/라벨 | `config.rates`, `config.roleLabels`, `config.tierColors` |
| 캐스케이드 연출 끄기(범용 N-에이전트) | `config.theme.cascade=false` (교탁 부재·문 등장 사라짐) |
| 미터 단위 wtok→tok | `config.theme.taximeter=false` |
| 좌석/배경 교체 | `config.world.*` + `assets/bg_*.png` + 주입 스크립트 |
| 엔진 이벤트 종류 추가 | `squad_engine.py` 에서 `ex.emit(kind, …)` 한 줄 + `live.js _engineEvent` 에 case 하나 |
| 새 시각화 뷰(노선도 등) | director와 같은 이벤트를 먹는 `engine/` 파일 추가 — 데이터 레이어 재사용 |
| 새 데이터 소스(리플레이/로그 파일 등) | `js/data/<name>.js` 하나 + `Sniffer.sources.<name> = {create, available}` 등록 + `config.sources.<name>` 문구 |
| 접근 지점/스프라이트 키/문제 카테고리/색상 | `config.world.approach`, `config.world.sprite`, `config.taskCategories`, `config.colors` |
| 디자인 테마 비교 | `index.html?theme=draft` → `css/theme-draft.css`(Codex 초안), `?theme=default` → `css/game.css` (localStorage `sniffer_theme`에 기억) |
| 캐릭터/배경 교체·추가 | `assets/src/<세트>/<방향>.mov` 넣고 `tools/build_sprites.ps1` → `config.characters`(byName/byRate/player/fallback)로 누가 어떤 캐릭터인지 배정. 좌/우 클립이 있으면 반전 없이 사용, 없으면 walk_side 반전 |
| 에이전트별 토큰 게이지 | `config.theme.agentGauge` ('pencil'/'bar'/'none'), live 한도 = budget.maxTokensPerAgent, mock 한도 = `theme.mockAgentBudget` |
| 테마 | ⚙ 메뉴 테마 순환 기본→초안→밝음 (`css/game.css`·`theme-draft.css`·`theme-light.css`), `?theme=default|draft|light` |
| 플레이어 충돌 | 책상 상판만(`deskGrid.solidH`), 발 박스 충돌 — 줄 사이 통로 이동 가능 |
| 종소리 종류/음원 | `config.audio.on`(이벤트→종), `config.audio.files`(mp3 경로) · 패턴은 `engine/audio.js` |
| 시간표 패널 | `config.theme.timetable`, 이벤트 `schedule` (mock: BEATS, live: tasks.list) |
| 문제 내기(쓰기) | `live.js.enqueueTask` → `POST squads/{id}/execute` (우리 엔진; 콘솔 Squad Chat 과 같은 경로). 대화(`reply`)는 읽기 전용 응답 |
