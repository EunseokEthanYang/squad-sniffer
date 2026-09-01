# HANDOFF — Taximeter Squad 시각화(squad-sniffer) 인수인계 문서

작성: 2026-08-23 새벽 (세션 1 종료 시점). 다음 세션은 이 문서와 `docs/architecture.md`만 읽으면 이어서 작업할 수 있게 쓴다.
프로젝트 루트: `C:\Users\c0106\Desktop\squad-sniffer` · 실행: `python backend/proxy.py 8790` → `http://127.0.0.1:8790/index.html`

---

## 0. 한 줄 요약

Junction 해커톤(Lablup×FuriosaAI 트랙)용 **에이전트 스쿼드 시각화 웹앱**. 픽셀아트 교실에서 에이전트(미소녀 캐릭터)들이 문제를 풀고, 막히면 손을 들어 상급자를 부르고, 비용(토큰)은 상단 택시미터에 쌓인다. 데이터는 AI:GO 서버(Railway)에서 읽기 전용으로 가져오며(로컬 프록시 경유), 서버 없이도 내장 시나리오(MOCK)로 돈다. 코드는 설정·엔진·데이터·UI로 모듈화돼 있고 스쿼드 구조가 바뀌어도 살아남게 설계됐다.

---

## 1. 배경과 목표

- **챌린지**: 작은 오픈소스 모델 여럿으로 에이전트 스쿼드를 짜서 SW 벤치마크를 풀고, 스쿼드 동작(누가 무엇을 누구에게 넘겼고, 어디서 왜 막혔는지)을 **CS 비전공 심사위원이 설명 없이 이해**할 수 있게 시각화. 시각화도 핵심 심사 요소.
- **팀 스쿼드 설계(제출 초안 "Taximeter Squad")**: 비용 캐스케이드 — 후배 Qwen3-32B(1×) → 선배 gpt-oss-120b(2×) → 선생님 K-EXAONE-236B(3×). 싼 검산(구거법 mod9 등) 먼저, Budget Manager가 "기대이득 < 임계면 손절". 초안 파일: `C:\Users\c0106\Downloads\submission_description_draft.md`. **단, 이 설계는 바뀔 수 있음** — 코드는 특정 구조에 묶지 말 것(§6).
- **호스팅 앱**: Backend.AI GO(AI:GO) 웹판 `https://aigo-web-production.up.railway.app/?k=aigo-834a73a39c9a0af596c967a1` (쿼리 `k` = 접근 키). **서버는 값 읽기 전용**으로만 쓴다(배포/쓰기 금지, 스쿼드 생성·실행 금지 — 팀장 허가 전).

## 2. 팀장(사용자)의 원칙·선호 — 반드시 지킬 것

1. **코드 4원칙: 확장성 · 가시성 · 분류성 · 완성도.** 한 파일에 몰아넣지 말고 역할별 모듈, 설정은 한 곳, 끝까지 마감.
2. **검은/어두운 UI 싫어함** → 밝은 테마가 기본. 월드 위 칩(이름표·자막·힌트)도 종이톤.
3. **은유는 교실로 통일**(후배/선배/선생님, 칠판=문제, 빨간펜 ○/✗=검증, 손들기=상위 호출, 문 열리고 선생님 등장=3× 최후심급, 교탁 평소 공석). **교실에 노선도 그리지 말 것**(한 번 만들었다가 폐기됨).
4. **쉬운 내용은 생각 박스(말풍선)로 계속**, 어려운 정보(비용 수치·판정 근거·검증 횟수)는 **확인하려 할 때만**(클릭/호버/다가가기).
5. 에이전트가 많아져도 혼란스럽지 않게(포커스 정책, pip, 이름표 자동 표시).
6. 시간표는 "벽의 시간표" 역할만(몇 교시·무슨 단계) — 흐름 표시 수단이지 노선도가 아님.
7. Codex 협업 OK(문제 없으면). 비대화형 호출: `codex exec -s workspace-write --skip-git-repo-check -C <dir> "<프롬프트>"` (`--full-auto`는 exec 옵션 아님). 사용자 Codex 앱과 동시 실행돼도 충돌 없음(계정 쿼터만 공유).
8. **포트 점유 프로세스를 확인 없이 죽이지 말 것** — 이번 세션에 Fusion360을 강제 종료하는 사고가 있었음. 내 프로세스는 커맨드라인 패턴으로만 골라 종료.
9. 직관성 근거(사용자가 중시): 스크립트 이론(교실 각본), Heider-Simmel(움직임→서사), 처리 유창성, Kindchenschema. 잡아먹힘 방지: 게임=주어·미터기=서술어, 판정 순간 숫자 카드, 장식 움직임 제로, Nerd Mode로 신뢰 마감.

## 3. 파일 구조 (자세한 건 `docs/architecture.md`)

```
squad-sniffer/
├─ index.html                껍데기(DOM + 스크립트 순서 + 테마 부트스트랩). Nerd 패널은 #game 밖 #stage 의 옆 칸
├─ css/game.css(어둠) · theme-draft.css(Codex 초안, 흑연/황동) · theme-light.css(Codex 밝음 + 내 보정, 기본값)
├─ js/config.js              ★ 스쿼드/테마/레이아웃/캐릭터 배정/소리/문구 — 모든 "지식"은 여기만
├─ js/engine/world.js        캔버스: 배경, 캐릭터 세트(SPRITE_SETS), 좌석 자동배정, 축정렬 동선(학생: 통로→앞복도, 선생님: 교탁 옆 통로), 발박스 충돌, 전경 조각(교탁이 뒤 캐릭터 하반신 가림), 얼굴 히스테리시스
├─ js/engine/director.js     ★ 이벤트→연출 계약(kind 어휘: spawn/agent_update/task_start/working/say/verify/retry/handoff/escalate/budget/enter/leave/submit/idle/note/board/meter/schedule/exhausted/halt). 현재 교시 단계·세부 추적, 종소리, 포커스 설정
├─ js/engine/ui.js           DOM 오버레이: 이름표(캐릭터 추종, auto/always/never), 말풍선 포커스 정책(+pip), 카드, 자막, 판정카드, HUD 미터/램프/통계, 시간표(+클릭 상세), ⚙메뉴(대화UI/Nerd/시간표/종소리/이름표/테마), 대화(미연시/웹), 문제 내기, 연필 게이지
├─ js/engine/audio.js        종소리 Web Audio 합성(next/end/fail/enter/warn), config.audio.files 로 mp3 교체
├─ js/engine/input.js        키보드/게임패드(조이스틱 DOM 없음), 핫키 E/N/T/M/Esc
├─ js/data/mock.js           내장 비트(BEATS: 즉답/검산재계산/상위호출/손절/최상위판정) — r1..rN 순위 참조, 소진 에이전트 건너뜀, 전원 소진 시 halt
├─ js/data/live.js           AIGO.state diff → 이벤트(첫 스냅샷은 기준선만, 활동로그 say 최근 5건, SSE seq, 예산 초과/비상정지→halt)
├─ js/main.js                부트: 소스 선택(auto/live/mock, ?source=), 루프, 핫키, ?skipIntro=1 ?nerd=1 ?theme=
├─ backend/proxy.py          로컬 백엔드: 정적 서빙(no-store) + /aigo/* 리버스 프록시(키 부착, SSE 통과) + POST /snap(캔버스 캡처)
├─ backend/aigo_client.js    REST/SSE 클라이언트(기본 base /aigo)
├─ backend/aigo_state.js     ★ 상위 변수 AIGO.state{server,squad,agents[],budget,usage,metrics,tasks,executions,activity,events,stats,meta} + ADAPT.* 어댑터 + rates/roleLabels/EVENT_MAP
├─ backend/state_viewer.html 상위 변수 실시간 뷰어 · dump_all.py(전수 덤프) · sse_tap.py(SSE raw 기록) · dump/(결과, 스냅샷)
├─ assets/src/<set>/walk_{down,up,left,right}.mov (+ robot: walk_side, work) · bg_classroom.png  ← 원본(팀 제공 MOV 20개)
├─ assets/<set>/*.png · bg_classroom.png · sprites_data.js(생성물, ~2.6MB base64)
├─ tools/build_sprites.ps1   ★ 원본→자산 전체 재생성(colorkey 검정 투명화, 64px 스트립, 배경 960×717, inject)
├─ tools/inject_sprites.ps1  PNG→sprites_data.js
└─ docs/ architecture.md · data-catalog.md · intuition-roadmap.md · flow-viz-ideation.md · design/{brief,design-draft,integration-notes,light-notes}.md · design/mockup.html · design/shots/*.png · legacy_index_v4.html · HANDOFF.md(이 문서)
```

## 4. 데이터 레이어 — 확정 사실

- **인증**: 모든 REST/에셋에 `?k=aigo-834a…`. 브라우저 다른 origin은 **CORS 차단** → 프록시 필수.
- **실시간**: `GET /api/v1/events` SSE(named event). 유휴 시 `: ping`/15초. **실행 이벤트 이름·페이로드는 아직 미관측**(스쿼드가 실제 실행된 적 없음). `backend/sse_tap.py`로 캡처 예정 → `config.eventMap`(→AIGO.EVENT_MAP) 채우면 정규화 완성.
- **핵심 엔드포인트**(squadService 번들에서 추출, 363개 중): `squads`, `squads/{id}`(agents[]: id/name/role.type/systemPrompt/toolConfig/modelPreferences.preferredModelId), `readiness`, `budget`{maxTotalTokens 100000, maxTokensPerAgent 30000, maxTokensPerTask, maxConcurrentAgents 3, maxAgentTurns, warningThresholdPercent 80…}, `budget/usage`{totalTokens, perAgentTokens{}, tasksCreated, activeAgents, exceeded, warningEmitted, emergencyStopped}, `tasks`, `tasks/graph`{tasks,waves,readyTaskIds}, `history`, `history/{eid}`, `history/{eid}/logs`, `activity-log/load`, `analytics`, `monitoring/metrics`(tokensPerSecond), `router/status`(서빙 모델 3종: Qwen3-32B-FP8 / gpt-oss-120b / K-EXAONE-236B-A23B-NVFP4A16). 쓰기: `POST squads/{id}/execute`, `POST agents/{aid}/message`(팀 승인 후).
- **서버 현황**: 팀이 만든 스쿼드 1개(이름이 "Code Review Squad"→"트래픽 분석 스쿼드"로 바뀜; Planner/트래픽 분석가/품질 검토자/리포터, 전부 Qwen). **우리 캐스케이드 스쿼드는 서버에 아직 없음.** 실행 0회.
- **"왜"(검증 실패·에스컬레이션 이유·손절 숫자)는 서버가 모른다** → 스쿼드 코드가 구조화 로그 5종(triage/verify/escalate/budget/submit)을 남겨줘야 정확해짐(`docs/data-catalog.md` 4절). 팀장 답장 대기 중.
- 브라우저 검증 완료: 프록시 경유 health·squads·squadSnapshot(13섹션)·SSE connected, LIVE 자동연결 시 실서버 에이전트 4명 스폰(전부 1×라 색 변주로 구분).

## 5. 시각화 엔진 — 현재 동작

- **소스**: `auto`(서버 닿고 스쿼드 있으면 live, 아니면 mock). ⚙ 없이 우상단 칩 클릭으로 전환(전환 시 director.reset).
- **연출(교실 각본)**: 칠판에 문제 적힘 → 후배가 교탁 왼쪽 복도(boardPickup 372,262)에서 카드 받아 자리로 → 풀이(뒷모습 들썩) → 검증 ○/✗ 도장 → 실패면 지우고 다시 → ✋ 상위 호출(판정카드 "저확신 → 2× 요금 시작") → 통로→앞복도→상대 옆으로 걸어가 카드 전달 → 불일치면 판정카드("이득 14% < 기준 25% → 손절" / "41% > 25% → 호출") → 선생님은 문에서 등장해 교탁 **옆 통로(x=534)로 돌아** 교탁 **뒤(463,200)**에 서고(전경 조각이 하반신 가림) 판정 후 같은 길로 퇴장 → 제출 시 카드 ○/✗ 교탁으로, 종소리.
- **토큰**: 택시미터(가중 wtok = 토큰×단가), 단가 램프(실제 존재하는 단가만), 에이전트별 **연필 게이지**(한도 대비 소모; live=maxTokensPerAgent, mock=6000). 소진 시 'exhausted'(말풍선 "연필이 다 닳았어요", 귀가, 이후 mock은 그 에이전트 건너뜀), 스쿼드 총예산 초과/비상정지 시 'halt'(판정카드 "실행 중단", 전원 귀가, 남은 교시 skipped).
- **정보 계층**: 말풍선(쉬운 한 줄) > 자막(사건 한 줄) > 판정카드(숫자 공식) > 시간표 행 클릭 상세(담당 흐름·검증 실패 수·상위 호출·손절·비용) > Nerd(번다운·raw trace).
- **혼잡 방지**: 포커스(카드 든 에이전트)·가까운·대화 중 에이전트만 전체 말풍선(최대 2), 나머지 pip(…/💬), 다가가면 최근 말 펼침. 이름표도 auto 모드에선 일하는/움직이는/포커스/가까운 캐릭터만.
- **캐릭터**: `config.characters` byRate {1:cho_mi, 2:no_mi, 3:seonsaeng}, player gal_bi, fallback robot(틴팅). 좌/우 클립이 있으면 반전 없이 사용. 크기 76px.
- **검증 도구**: 헤드리스 크롬 캡처 `chrome --headless=new --timeout=14000 --screenshot=… "…/index.html?skipIntro=1&source=mock[&nerd=1][&theme=light]"`(timeout 없으면 SSE 때문에 무한 대기) · 캔버스만 찍을 땐 페이지 JS에서 `fetch('/snap',{method:'POST',body:cv.toDataURL()})` → `backend/dump/snapshot.png`. 프리뷰 패널은 스크린샷 불가(숨김 상태)라 위 방법 사용.

## 6. 확장 포인트 (바뀔 것에 대비)

| 바뀌는 것 | 고치는 곳 |
|---|---|
| 모델/단가/라벨/색 | `config.rates`, `roleLabels`, `tierColors`, `colors` |
| 캐스케이드 연출 끄기 | `theme.cascade=false` (교탁 부재·문 등장 사라짐, 범용 N-에이전트 교실) |
| 미터 단위 | `theme.taximeter` |
| 캐릭터 추가/교체 | `assets/src/<세트>/<방향>.mov` + `tools/build_sprites.ps1` + `config.characters` |
| SSE 이벤트 이름 확정 | `config.eventMap` (+ 필요시 `live.js._sseToEvent`) |
| 새 데이터 소스(리플레이/로그 파일) | `js/data/<name>.js` + `Sniffer.sources.<name>={create,available}` + `config.sources` 문구 |
| 새 렌더러 | director 이벤트를 먹는 `engine/` 파일 추가 |
| 쓰기 연결(문제 내기/말 걸기) | `main.js ui.onTask` → POST execute, `live.js.reply` → POST message (팀 승인 + 데모용 스쿼드 분리 권장) |

## 7. 이번 세션의 결정 히스토리 (왜 이렇게 됐나)

1. 통합안 채택: 도트 게임이 무대, 택시미터는 HUD(초안 서사 유지).
2. 배경은 회사→**교실**로 통일(팀 제작 교실 이미지 2400×1792). 호칭 후배/선배/선생님.
3. "채팅방/영수증/노선도/당신이 심판" 등 대안 발산(16개 컨셉, 3인 심사) → 노선도 만장일치 1위였으나 **사용자 판단으로 폐기**(교실에 노선도 부자연). 시간표를 흐름 표시 수단으로.
4. 디자인 초안은 Codex가 작성(흑연/황동 테마, 정적 목업) → 사용자가 어두워서 거부 → Codex에 밝은 테마 의뢰 → **밝은 테마 기본**.
5. 적대적 리뷰 워크플로 2회(34건→23건 확정 반영: escalate→handoff 자기 큐 데드락 등; 2회차는 §8 참조).

## 8. 미해결 · 진행 중 (다음 세션이 먼저 볼 것)

- [x] 리뷰 워크플로 2회차(18건 확정) **반영 완료**: 열별 통로(aisleX 5개, 교탁 아래 x=444 제거), corridorY 274(교탁 앞으로 지나감), 전경 조각 y=204(교탁 그림 전체), goHome 자리면 즉시 반환·통로 우선 경로, 선생님 좌/우 옆 통로 선택, 발박스 y+6..16·책상 solid -10, 소진 한도는 budgetTokens만(mock은 spawn 때 주입), working 소진 시 중단, halt 게이트(PASS_WHEN_HALTED)+resume, halt 시 선생님 퇴장·포커스 해제·제목 구분, schedule 재전송 시 skipped 보존, mock enqueue 가드·_seq 소진 컷·_pushSchedule 결과 보존, skipped 스타일. 브라우저 재검증 결과는 아래 항목 참고.
- [x] 소진/중단 **브라우저 실측 완료**(mockAgentBudget=700): r1 소진→비트 컷·미완 제출→r2가 이어받음→r2 소진→선생님이 마지막까지→전원 소진→`halt`(all_agents_exhausted), 학생 귀가·선생님 퇴장·상태 '중단'·시간표 done/fail 확정·루프 정지. 후배 동선 995샘플 중 교탁 관통 0회, 선생님 등장/퇴장 경로 관통 0회, 교탁 뒤 착석(전경 조각) 스냅샷 확인.
- [ ] 사용자 지적 "뱅글뱅글 돎": 얼굴 히스테리시스·축정렬·같은 지점 스킵·자리면 goHome 즉시 반환·열별 통로·선생님 좌/우 옆길로 고쳤으나 **사용자 눈 확인 필요**.
- ⚠ **세션 중복 주의**: 세션 1 종료 직전 다른 Claude 세션이 같은 폴더를 열고 `python -m http.server 8791`(AppData Python312)을 띄운 흔적이 있었음(파일 수정 흔적은 없음). 두 세션이 같은 파일을 동시에 편집하지 말 것 — 한 세션만 편집하고 다른 세션은 읽기/검증만.
- [ ] 실서버 스쿼드 **실행 이벤트 이름 미확보** → 팀이 캐스케이드 스쿼드를 만들어 1회 실행 시 `sse_tap.py` 켜두고 캡처 → `config.eventMap` 채우기.
- [ ] 팀장 답장 대기: 서버에서 어떤 값을 어떻게 받는지 최종 확인 → 필요 없으면 시간표/게이지 등 비활성화.
- [ ] 로드맵 미구현: 정보 없는 시간 빨리감기·이벤트 순간 줌(5), 내 문제 카드 클릭 타임라인(6), "당신이 심판" 모드(7), 30초 뮤트 테스트 실측(9), 역할별 고유 도트(10 — 미소녀 4종으로 사실상 해결).
- [ ] 디자인 세부(글꼴 크기, 여백, 이름표 스타일)는 밝은 테마 기준으로 계속 손질. 미연시/웹 대화 UI 중 선택은 미정(둘 다 유지, ⚙ 토글).
- 환경: ffmpeg(winget Gyan.FFmpeg 9.0), Chrome(헤드리스 캡처), Codex CLI 0.147, miniconda python 3.13. 프록시는 포트 **8790**(8765는 Fusion360과 충돌 — 쓰지 말 것).

---

## 9. 다음 세션 시작 프롬프트 (복사해서 붙여넣기)

```
너는 Junction 해커톤 "Taximeter Squad" 시각화 프로젝트를 이어받는다. 먼저 C:\Users\c0106\Desktop\squad-sniffer\docs\HANDOFF.md 와 docs\architecture.md 를 읽고, 메모리(junction-hackathon-squad-viz, code-principles, never-kill-by-port)를 참고해라.

지켜야 할 것: 코드 4원칙(확장성·가시성·분류성·완성도), 밝은 테마 기본(검은 UI 금지), 교실 은유 통일(노선도 금지), 쉬운 내용은 말풍선으로 계속·어려운 정보는 확인할 때만, 에이전트 수가 늘어도 안 어지럽게, 스쿼드 설계가 바뀌어도 살아남는 구조(설정은 js/config.js 한 곳), 서버(AI:GO)는 읽기 전용(쓰기·스쿼드 생성/실행 금지), 내 프로세스만 커맨드라인으로 골라 종료(포트로 죽이지 말 것), 프록시 포트 8790.

실행: python backend/proxy.py 8790 → http://127.0.0.1:8790/index.html (캡처는 chrome --headless=new --timeout=14000 --screenshot=… "?skipIntro=1&source=mock").

먼저 할 일: (1) HANDOFF §8의 리뷰 워크플로 2회차 결과(journal.jsonl)를 읽고 확정 항목을 반영, (2) 소진/중단 흐름을 mockAgentBudget 축소로 브라우저 실측, (3) 변경 후 헤드리스 캡처로 눈 확인 후 사용자에게 보고. 그 다음은 사용자가 지시하는 디자인 세부 손질 또는 로드맵(5·6·7) 항목. 작업 중 중간 보고를 자주 하고, 확인 없이 범위를 넓히지 마라.
```

## 10. 2026-08-23 추가 변경 (팀장 요청 4건: 스쿼드 선택 · 시간표 스크롤 제거 · 맵 탈출 · 미연시 리디자인)
- **스쿼드 선택**: ⚙ 메뉴 안 `<select id="squadSel">` — `ui.loadSquadList()` 가 `/aigo/api/v1/squads` 목록을 채움. 선택 시 `localStorage.sniffer_squad` 저장 → `cfg.squadId` → `startSource('live')`. main.js 부트 시 저장값 복원. 소스칩은 `● LIVE · <스쿼드명>` 으로 표시.
- **시간표 창(windowed)**: 스크롤바 제거. 이전 1개 + 현재 + 다음 4개만 렌더, 넘치는 건 `.tt-more`("▲ 이전 n개 / ▼ 다음 n개") 라벨. CSS `#timetable{max-height:none;overflow:visible}`.
- **맵 탈출 수정**: `config.world.walkable` 사각형 합집합(본 바닥 112..885 × 232..646 + 하단 중앙 알코브 490..720 × 646..688). `world.update()` 에서 `_collide` + `walkable` 둘 다 통과해야 이동. 검증: 좌벽 x=118 정지, 하단 측면 y=643 정지, 알코브 y=687 까지 허용. (`walkable` 비우면 구 `bounds` 로 폴백)
- **미연시 대화창 리디자인**(레퍼런스 스샷 기준): 입간판(#vnPortrait, 오른쪽 8%·높이 54%) + 보라 이름패(#vnName, 좌측) + 하단 전체폭 대사창(#vnMain 24%) + 메뉴 줄(AUTO/LOG/CLOSE). AUTO = 타자 효과 끄고 즉시 표시(`ui._vnAuto`), LOG = 웹 채팅 모드로 전환(기록 보기). 세 테마(css/game.css, theme-draft.css, theme-light.css) 모두에 동일 블록이 **파일 끝에 append** 되어 있음 — 이전 테마의 `#vnClose{position:absolute}` / `#vnPortrait{left:14px}` 를 뒤에서 덮어씀. VN 열린 동안 `#subs` 는 숨김(`#game:has(#vnBox.open) #subs`).
- **캡처용 쿼리**: `?chat=vn|web` → 첫 에이전트 등장 후 대화창 자동 오픈 (헤드리스 스샷용). 예: `chrome --headless=new --timeout=11000 --screenshot=… "index.html?skipIntro=1&source=mock&chat=vn"` → docs/design/shots/app_vn.png
- **팝업 잠시 끔(팀장 요청)**: `config.theme.annotations:false`(하단 공지 자막 `ui.annotate`) · `config.theme.verdictCards:false`(에스컬레이션/호출 판정 카드 `ui.showVerdict`). 두 값을 `true` 로 돌리면 즉시 복원. 말풍선(대사)·이름표·시간표는 그대로.

## 11. 2026-08-23 오후 추가 (팀장 요청 6건: 방향키 · 인트로 제거 · L-Shift · 이모트 · 전신 입간판 · 시간표 스크롤/기어메뉴 겹침)
- **조작 = 방향키 전용**: `config.controls {arrows:true, wasd:false, gamepad:false, preventScroll:true, interact:'ShiftLeft', interactLabel:'L-Shift'}`. `Input(opts)` 가 읽음. 방향키는 preventDefault(페이지 스크롤 방지). 대화창 닫으면 `closeAll()` 이 포커스를 blur → 바로 이동 가능. **상호작용(대화) = 왼쪽 Shift**(`e.code` 우선 매칭, 오른쪽 Shift 는 무시). `#talkHint` 라벨은 `interactLabel` 로 자동.
- **시작 설명 오버레이 제거**: `theme.intro:false`(기본) → `chooseSource()` 뒤 바로 `begin(kind)`. 오디오는 첫 pointerdown/keydown 에서 unlock. `theme.intro:true` 면 예전 타이틀+클릭 시작. `?skipIntro=1` 은 계속 동작.
- **머리 위 이모트(RPG 말풍선)**: `theme.emotes {enabled, ms, map, colors, hop, on}` — `on` 이 이벤트키→이모트키 (taskStart♪ · verifyOk✓ · verifyFail✕ · retry! · escalate? · exhausted z · budgetWarn/cutLoss $ · halt !(전원) · submitOk✓/submitFail✕). 구현: `world.emote(ent, sym, {color, ms, hop})` + `_drawEmote`(팝인·바운스·페이드, 캔버스에 그림) + `_hopDY`(hop 이모트면 캐릭터 점프 7px). 호출은 `director._emote(ent, evKey, ms)` 한 군데만. 끄려면 `emotes.enabled:false`.
- **미연시 입간판 = 전신 원화**: `characters.portraits {cho_mi, no_mi, gal_bi → assets/portraits/<set>.png}` (원본 assets/<set>/<uuid>.png 2048px 을 높이 1200·알파 bbox 트림으로 변환; 재생성은 ffmpeg scale + alphaextract bbox). `ui._vnPortrait()` 가 세트에 원화 있으면 `<img #vnPortraitImg>`(오른쪽 5%, 높이 90%, 대사창 뒤 z1), 없으면(seonsaeng, robot) 도트 캔버스 폴백. **seonsaeng 전신 원화는 아직 없음** → 팀장이 주면 `assets/portraits/seonsaeng.png` 로 넣고 config 한 줄.
- **시간표**: 전체 행을 `#ttRows`(max-height `--tt-rows-h:168px`, overflow auto, **스크롤바 CSS 숨김**, 가장자리 페이드 마스크)에 렌더. 휠/드래그 + `#ttUp/#ttDown`(▲ 이전 n개 / ▼ 다음 n개, 클릭=2행 스크롤). 현재 교시가 바뀌면 그 행이 둘째 줄에 오도록 smooth 추적, 단 사용자가 만진 뒤 8초(`_ttUserAt`)는 추적 쉼. `_ttNav()` 가 라벨 갱신.
- **⚙ 메뉴 ↔ 시간표 겹침**: 메뉴 열리면 `#timetable/#ttDetail` 을 `translateY(메뉴 실측 높이+6)` 로 내림(`_wireGear` 의 `shift()`), 닫히면 복귀. 항목이 늘어도 실측이라 OK.
- **팝업(하단 공지·판정 카드) 끔**: `theme.annotations:false`, `theme.verdictCards:false` (§10 참조).
- 참고: Downloads 의 Gemini 이미지 2장은 Backend.AI GO 로봇 마스코트 스프라이트 시트(24컷) — 나중에 `robot` 세트 교체용 후보.
- **패키징(2026-08-23)**: `run.bat`(Windows, 포트/모드 인자) · `run_mock.bat` · `run.sh` · `README_RUN.md` 추가. proxy 기본 포트 8765→8790. 배포 zip: `Desktop/squad-sniffer_2026-08-23.zip` (assets/src·backend/dump·docs/design·원본 MOV 제외). 조작은 방향키 전용(`config.controls`).

## 12. 2026-08-29 스쿼드 엔진 ↔ 시각화 연결 완료 (aigo-web · Studio)

이제 시각화의 LIVE 소스는 **우리 스쿼드 엔진**(`decomposition/aigo-web/backend/squad_engine.py`, Railway `aigo-web-production`)을 본다. 팀 공용 AI:GO 서버(읽기 전용 규칙)가 아니라 우리 배포이므로 **문제 내기(T) = 실제 실행(POST execute)** 이다.

- **한 줄 구조**: 엔진이 실행의 이야기를 이벤트 로그로 남김 → `GET /api/v1/squads/{sid}/executions/{eid}/events?after=seq` → `aigo_state.js`(state.executions.events) → `live.js`가 **직렬 재생**(이벤트 한 건씩 await) → director 계약(task_start/handoff/escalate/working/verify/retry/submit). 콘솔(원본 Backend.AI GO UI)은 손대지 않았다.
- **엔진 이벤트 어휘**(원본 주석: squad_engine.py `Execution.emit`): `request · planning · plan · wave · task_start · task_retry · task_done · task_failed · aggregate · done` (+ `awaiting_approval · approved · cancel`). 필드: `seq, t, kind, agent?, task?, title?, dependsOn?, fromAgents?, text?, tokens?, ok?, phase?, tasks?(plan)`. 자세한 표는 `docs/data-catalog.md` §7.
- **교실 번역 규칙**(live.js `_engineEvent`): 한 실행 = 한 교시 = 카드 한 장. `planning`/첫 `task_start` → 담당이 칠판에서 카드 받음. 다음 담당의 `task_start` → 카드 넘김(받는 쪽 단가가 높으면 `escalate` = 손들고 호출, 아니면 `handoff`; 같은 단계 병렬 작업이면 "저도 같이 맡을게요"). `task_done` → ○ 채점 + 결과 한 줄 말풍선, `task_failed` → ✗, `task_retry` → 다시 풀기. `aggregate` → 반장에게 넘김·"종합 중". `done` → 제출 ○/✗(제출자 = 마지막 카드 소지자), 선생님 단가면 퇴장.
- **재생 원칙**: 처음 봤을 때 이미 끝난 실행은 재생하지 않음(기준선). 진행 중 실행은 seq 0부터. 교실이 엔진보다 느려도 순서 보존(직렬 루프; 다음 이벤트가 없으면 풀이 중인 담당들에게 working 틱). 새 실행이 보이면 이전 재생은 남은 큐를 버리고 새 실행으로.
- **시간표 = 실행 이력**(`history?limit=12`, `no` = 스쿼드의 n번째 실행 → 카드 라벨 `P{no}`). 가장 최근 실행만 ▶, 그보다 오래된 미완료는 –(건너뜀). 택시미터/연필 게이지 = 엔진 `budget/usage`(스쿼드 **누적**: 모든 실행 합, 에이전트별 합).
- **config 변경**: `rates` 부분 일치 키(`'gpt-oss-20b':1, 'gpt-oss-120b':2, 'exaone':3 …` — Groq 등 다른 프로바이더의 같은 계열 모델), `plannerLabel:'반장'`(플래너 = 작업을 나누고 모으는 에이전트; null 이면 단가 라벨), `timetableMax:12`. `roleLabels`(후배/선배/선생님)·`byRate` 캐릭터 배정은 그대로.
- **스쿼드 선택 우선순위**(main.js): URL `?squad=`(Studio 가 넘김) > ⚙ 기억값(localStorage) > 자동(최근 갱신 스쿼드). `aigo_client.js` 에 `post()` 추가(문제 내기용).
- **Studio**(`aigo-web/shell/studio.html`, `/studio`): 상단 바 = 교실 벽의 출석부 한 줄(반=스쿼드 선택 · 픽셀 "3교시" 칸 · 빈차/수업 중 도장 · 연필 밑줄 히어로 "2/2단계 · Writer 풀이 중" · 진행 중 초 표시 · 콘솔/교실/함께 보기 인덱스 탭, 항상 60px, 어두운 면 없음) + 종이 위 두 화면(콘솔 iframe `/squad/{id}#chat`, 교실 iframe `/_viz/index.html?squad={id}`). `history?limit=1` + `executions/{eid}` 를 2.5초마다 읽는다. 시안 3개 → 심사 3렌즈 → 종합으로 정했고 기록은 `aigo-web/shell/studio-bar-design.md`.
- **작업 흐름**: 시각화 수정은 `squad-sniffer/` 에서 → `aigo-web/sync-viz.sh` 로 `viz/` 에 복사(viz-bridge.js 자동 주입) → 배포는 `aigo-web` 에서 `railway up`. 서버 없이 전체 흐름 보기: `python3 backend/dev_stub_api.py 8611` + `AIGO_WEBUI_PORT=8610 AIGO_API_PORT=8611 AIGO_WEBUI_AUTOLOGIN=0 AIGO_SQUAD_DEMO=sim AIGO_SQUAD_SPLIT=1 python3 backend/webui_proxy.py` → `http://127.0.0.1:8610/studio` (README 참고).
- **엔진 모드와 교실**: `AIGO_SQUAD_DEMO=1`(기본, 고정 계획·작업 1개·실제 모델) → 담당 한 명이 받아 풀고 제출. `AIGO_SQUAD_SPLIT=1` → 조사→작성 2단계 = 카드 넘김. `AIGO_SQUAD_DEMO=0` → 반장이 계획(`planning`)하고 나눠 주고(`aggregate`) 모아 제출. `sim` → 모델 호출 없이 시뮬레이션(결과에 [시뮬레이션] 표기).
- 이전 §4·§8 의 "SSE 이벤트 이름 미확보 → eventMap 채우기" 항목은 **더 이상 필요 없음**(엔진 피드가 대체). `eventMap` 은 예비로 남김. 이벤트 피드가 없는 서버(404)면 예전 토큰 diff 폴백(`live.js _fallback`).
- **2026-08-29 배포 후 보정**: 시간표 행은 서버 실행 번호(`schedule` item `no`)로 "n교시"를 부른다(Studio 바와 같은 번호; mock 은 순번). 교시 열은 `grid-template-columns:auto` + `nowrap`(두 자리 교시). Studio 바는 `durationMs` 가 0이면 시간을 생략. 배포: `aigo-web` 에서 `railway up --service aigo-web --detach` → `railway status --json` 으로 상태 확인.

## 13. 2026-08-29 밤 추가 (Studio 라우트 분리 · 교실 꽉 채우기 · 음성)
- **라우트**(aigo-web `webui_proxy.local_file`): `/studio` = 입구(`shell/index.html`, 문 두 개) · `/studio/split` = 분할 · `/studio/classroom` = 교실 전체화면. 둘 다 `shell/studio.html` 이고 경로로 `MODE` 를 정한다(전체화면: view 고정 'viz', 콘솔/함께 보기 탭은 분할 화면으로 이동, 교실 iframe 에 `voice=1`).
- **꽉 채우기**(`config.fit`, 기본 `cover`): `index.html` 에서 캔버스+`#overlay`+`#talkHint` 를 `#scene` 으로 감쌌다(`world.gameEl` = `#scene` 이라 `toScreen` 배율이 그대로 맞음). `body.fit-cover` 면 `#game` 이 뷰포트 전체(`container-type:size`), `#scene` 은 `max(100cqw, 100cqh×960/717)` 로 덮고 **위쪽 고정**. HUD(#hud/#ctrl/#timetable/…)는 `#game` 에 남아 잘리지 않는다. 플레이어 시작 y 는 460 으로(아래가 잘려서). `?fit=contain` 으로 되돌림. 세 테마 CSS 끝에 같은 블록.
- **음성**(`js/engine/voice.js`, `config.voice`, `?voice=1`): 🎙 `#micBtn`(#ctrl) / `V` → `webkitSpeechRecognition`(ko-KR, 중간 결과를 `#voiceLive` 종이 자막으로) → 최종 문장 → `ui.onTask(text)`(= 문제 내기) + "…로 냈어요" 멘트. `live.js` `done` 에서 `Voice.speakAnswer(e.text, ok)` (마크다운/수식 제거, 400자 컷, 실패면 이유). 브라우저가 STT 를 지원하지 않으면 버튼이 "음성 입력 불가"로 비활성. 소리는 `?voice=1` 일 때만.
- **보정(같은 날 밤)**: `config.fit` 기본을 `fill`(교실 전체 보이기 + 흐린 교실 배경 `#backdrop`, `main.js` 가 `BG_DATA` 를 넣음)로. 음성은 `config.voice.auto`(기본 true)면 접속 즉시 듣기 → 접수 → 답 읽기 → 다시 듣기 루프; 안내판 `#voicePanel`(상태 idle/listen/busy/speak/denied/unsupported, 클릭 = 켜고 끄기). Studio 교실 전체화면에 ⛶ 전체화면(F).
- **분할 화면에 교실만 보이던 버그(2026-09-01)**: 교실 전체화면이 `S.view='viz'` 를 localStorage(`aigo_studio`)에 저장해, 분할 화면이 그 값을 복원하며 콘솔 창을 숨겼다. 이제 **어느 화면을 볼지는 저장하지 않는다** — `?view=`(go|viz|both 검증) > 모드(classroom→viz) > 분할 기본 `both`. 저장하는 건 `ratio`·`squad` 뿐. 1/2/3 키 선택은 `syncUrl()` 이 주소에만 남기므로 새로고침에는 유지되고 다음 방문에는 초기화된다.
- **실패 사유 문구**: 엔진 원문이 `POST /api/v1/squads/{id}/… -> HTTP 500: {…}` 형태라 그대로 새던 것을 `plainError()` 가 메서드+경로를 벗기고 HTTP 코드로 옮기도록 고침(5xx→서버 오류/모델 응답 없음, 429→한도, 404→대상 없음…). 원문은 계속 `title` 에.

## 14. 2026-09-01 적대적 감사 반영 (Studio ↔ 교실 상태 누수 · 음성 안정화)
세 렌즈(상태 누수 · 교실 화면 · 음성 루프)로 감사한 결과를 반영했다. 요지: **Studio 안에서는 상단 바가 주인**이고, 교실은 자기 기억(sniffer_*)으로 바를 배신하면 안 된다.
- **분할 화면에 교실만 보이던 버그**: §13 참고(화면 선택은 저장하지 않는다).
- **목록 요청 하나에 전부 멈추던 것**(블로커): 두 iframe 의 src 는 `loadSquads()` 안에서만 정해졌고 `api()` 에 시간 제한이 없어, 응답이 끝내 안 오는 요청 하나면 화면이 영원히 비고 폴링도 죽었다. 이제 (1) 목록을 기다리지 않고 `apply()` 를 먼저 불러 두 화면을 띄우고, (2) `api()` 는 5초 AbortController 제한, (3) 목록조차 못 받으면 뒤 요청을 생략하고 첫 실패에 바로 `서버 연결 안 됨`(이미 받아 본 뒤라면 한 번은 봐줌). 서버가 돌아오면 자동 복구. 시험: `AIGO_STUB_HANG=/api/v1/squads python3 backend/dev_stub_api.py 8611`.
- **스쿼드가 둘로 갈리던 것**: 교실 ⚙ 의 스쿼드 고르개는 `sniffer_squad` 에 따로 기억해 바와 어긋났다 → Studio 안(iframe)에서는 그 행을 숨기고(`main.js`, id 선택자가 display 를 정하므로 `style.display='none'`), 기억값도 쓰지 않는다(`savedSquad && !EMBEDDED`).
- **교실이 검게 남던 것**: ⚙ 테마를 한 번 누르면 `sniffer_theme` 에 남아 크림색 Studio 안에서 계속 어두웠다 → `vizSrc()` 가 `theme=light` 를 붙인다(교실 부팅이 `?theme` 를 기억값에 되써서 이미 어두워진 것도 복구).
- **새 창이 마이크를 같이 잡던 것**: `vizSrc(withVoice)` 로 나눠 액자 안 교실만 `voice=1`, `교실 새 창 ↗` 은 소리 없음(두 창이 같은 말을 듣고 두 번 실행되던 문제).
- **칸이 좁아지면 교실 HUD 가 넘치던 것**: 드래그를 비율(0.15/0.85) 대신 **칸 최소 480px** 로 제한 + `#meterBox { max-width: max(182px, …) }`.
- **F(전체화면)·1/2/3 키**: 교실에 포커스가 있으면 안 먹던 것 → `main.js` 릴레이를 `[123fF]` 로 넓히고 studio 가 `f` 를 받아 전체화면 버튼을 누른다.
- **미리보기 배지**: `?preview=` 로 본 뒤 실제 상태로 돌아오면 `clearPreview()` 로 붉은 PREVIEW 표시를 지운다.
- **음성 루프 안정화**(`js/engine/voice.js`, 시험 `tools/voice-test.js` — `node tools/voice-test.js`, 14개):
  · 인식 객체는 하나만(`this._rec !== rec` 이면 모든 콜백 무시) — 답을 건너뛰려고 안내판을 누르면 마이크가 영영 죽던 것
  · 말하기 전 `_abort()` — 스피커로 나간 답을 마이크가 다시 듣고 그 답을 새 문제로 내던 되먹임
  · 발화 세대 번호(`_sgen`) — 답이 연달아 오면 뒤 답이 안 읽히고 마이크가 문장 중간에 열리던 것
  · 실패는 `why()` 로 한국어 한 마디(영어 원문·파이썬 예외를 읽지 않음; 화면에는 원문 유지)
  · 탭을 벗어나면 마이크·소리 정지(`visibilitychange`/`pagehide`), 돌아오면 재개
  · 인터넷 끊김(`network`)은 350ms 되풀이 대신 지수 후퇴 + 안내
  · 실서버가 아니면(mock) 8분 벙어리 대신 10초 뒤 "지금은 연습 모드예요"

## 15. 2026-09-01 다중 에이전트 모드 켜짐 (AIGO_SQUAD_DEMO=0)
- **환경변수**: Railway `aigo-web` 의 `AIGO_SQUAD_DEMO` 를 `1` → **`0`** 으로. 이제 플래너가 요청을 실제로 쪼개고(최대 8작업), 단계(wave)별로 실행한 뒤 결과를 종합한다. 되돌리려면 `railway variable set AIGO_SQUAD_DEMO=1 --service aigo-web`.
- **함께 필요했던 코드 수정 3가지** (이것 없이는 환경변수만 바꿔도 계속 "작업 1개"로 강등된다):
  1. `_plan` 에 직접 추론 대체 경로 — 이 배포의 **에이전트 세션 경로가 죽어 있다**(`session state=error`, 라우터가 "no backend"라고 답함). 작업 실행에만 있던 우회를 계획에도 넣었다. 계획 JSON 은 1.3k 토큰쯤 되므로 작업용 512 상한 대신 `AIGO_SQUAD_PLAN_MAX_TOKENS`(2000).
  2. `_aggregate` 에도 같은 우회(`AIGO_SQUAD_AGGREGATE_MAX_TOKENS`, 1500) + 계획 때 죽은 세션이면 아예 건너뜀.
  3. `Execution.dead_sessions` — 한 번 죽은 세션은 이 실행 동안 다시 만지지 않는다(작업마다 15초씩 같은 실패 반복 방지). 그리고 빈 답(`returned no assistant text`)은 추론에 상한을 다 쓴 것이므로 `AIGO_SQUAD_EMPTY_RETRY_MAX_TOKENS`(2048)로 **한 번 더** 시도한 뒤에만 실패로 본다.
- **실측**(멀티태스크 데모 스쿼드, 3명): "1~1000 중 자리수 합이 소수인 수 세고 두 방법으로 검증" → 작업 4개·3단계·**71초·8,570 tok**, 답 340(직접 계산과 일치). 이벤트 16개(request→planning→plan→wave×3→task×8→aggregate→done)가 그대로 교실 재생용으로 나온다.
- **같은 단계라도 같은 사람에게 두 작업을 맡기면 순차**로 돈다(`_agent_lock`: 한 에이전트는 동시에 한 작업). 동시에 여러 명이 붙는 그림을 보여 주려면 일꾼이 여러 명인 스쿼드(예: 트래픽 분석 4명)를 쓸 것.
- 주의: 스쿼드마다 시스템 프롬프트가 전문화돼 있다(트래픽 분석 스쿼드는 로그 파일 분석 전용이라 수학 문제를 거부한다). 범용 데모는 **멀티태스크 데모 스쿼드**(Planner·Researcher·Writer)로.

## 16. 2026-09-01 대화 키 · 에이전트가 자기 모델로 답하기 · 요금 한도 재시도
- **대화 키**: `config.controls.interact` 가 배열이 됐다 — `['Space', 'e', 'ShiftLeft']`(라벨 `Space`). `main.js` 가 `[].concat(...)` 로 전부 등록하므로 예전 L-Shift 습관도 그대로 통한다. 힌트 칩도 Space.
- **에이전트 대화 = 진짜 모델 호출**(`live.js reply`): 말을 걸면 그 에이전트의 `modelId` 로 `POST /v1/chat/completions` 를 보낸다. 시스템 프롬프트 = (원래 역할 지침 300자) + "너는 교실 속 <라벨>이고 친구가 말을 걸었다 · 두 문장 이내 · 아래 사실만" + **지금 상황**(반 이름, 진행 중 교시와 문제, 내가 맡은 작업, 지금 하는 일, 내 토큰/단가/반 전체, 최근 이벤트 4개, 마지막으로 한 말 — `_selfContext`).
  · gpt-oss 계열은 사고에 상한을 다 쓰면 **본문이 빈 채로** 온다 → `reasoning_effort:'low'` + `max_tokens:400`, 비면 900 으로 한 번 더, 그래도 비면 `_canned`(상위 변수만 보고 답하는 예전 규칙)로 조용히 내려앉는다.
  · 엔진의 에이전트 세션(`agents/{id}/message`)이 아니라 별도 채팅 호출이라 실행 중에도 방해하지 않는다.
  · `ui.sendChat` 은 이제 문자열/Promise 둘 다 받는다 — Promise 면 "…" 를 먼저 놓고 도착하면 그 자리를 갈아 끼운다. `aigo_state.js` 는 `systemPrompt` 를 상위 변수에 담는다.
  · 실측 답: "Method 2 Count를 진행 중이에요. 지금까지 2,042개의 토큰을 사용했어요."
- **요금 한도(429) 재시도**(`squad_engine._chat`): 한 단계에서 3명이 동시에 모델을 부르면 Groq 분당 한도에 같이 걸린다. 제공자가 알려 주는 대기 시간("try again in 5 seconds")을 파싱해 기다렸다가 재시도(`AIGO_SQUAD_RATE_LIMIT_RETRIES` 3회, 최대 대기 `..._MAX_WAIT` 30초). 이 수정 전 코드리뷰 스쿼드 실행에서 보안 검토 1건이 429로 ✗ 났고, 수정 후 같은 문제로 재실행하니 4작업 전원 성공(43초·15.3k tok).
