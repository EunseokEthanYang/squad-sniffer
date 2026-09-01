# AI:GO 서버에서 가져올 수 있는 값 — 데이터 카탈로그 & 활용 맵

- 서버: `https://aigo-web-production.up.railway.app`
- 인증: 모든 요청(API·에셋·SSE)에 쿼리 `?k=aigo-834a73a39c9a0af596c967a1`
- 원칙: **읽기 전용(GET + SSE 구독)**. 서버는 "값을 받아오는 용도"로만 쓴다.
- 도구: `backend/proxy.py`(**로컬 백엔드: 정적 서빙 + `/aigo/*` 프록시, 포트 8790**) · `backend/aigo_client.js`(브라우저 클라이언트, 기본 base `/aigo`) · `backend/dump_all.py`(전수 덤프) · `backend/sse_tap.py`(실시간 이벤트 탭)
- 출처: 앱 JS 번들 역분석 (`squadService-*.js`, `useServerEvent-*.js`) — 총 363개 API 경로 중 시각화 관련만 선별

## 1. 지금 당장 가져와지는 값 (2026-08-23 덤프 기준, 26/28 성공)

| 엔드포인트 | 내용 | 시각화에서의 용도 |
|---|---|---|
| `/router/status` | 백엔드 `provider-vllm-07b73081` (Furiosa vLLM) · **서빙 모델 3종**: `furiosa-ai/Qwen3-32B-FP8`, `furiosa-ai/gpt-oss-120b`, `furiosa-ai/K-EXAONE-236B-A23B-NVFP4A16` · health · request_stats | 후배/선배/선생님 ↔ 실제 모델 ID 매핑, 라우터 상태등 |
| `/providers` | 프로바이더 Furiosa (vLLM, `submission.jxc.events.lablup.ai:8445`) | 같음 |
| `/monitoring/metrics` | cpu.utilization, memory, **inference.tokensPerSecond**, contextUsed/Max | HUD 속도계(실시간 tok/s), 시스템 게이지 |
| `/stats/usage` | totalRequests/successful/failed, **totalPromptTokens/CompletionTokens/totalTokens**, avgLatencyMs, **modelStats[]**, dailyStats[] | **택시미터 총액의 1차 소스** (모델별 토큰 → 단가 1×/2×/3× 가중 합산) — 지금은 전부 0 |
| `/stats/models` | 모델별 통계 | 모델별 비용 막대 |
| `/squad-templates` | 빌트인 템플릿 5종, 각 `agents[]`: name/role/systemPrompt/tools/modelPreferences | 에이전트 역할 라벨·도구 목록 |
| `/agent-profiles` | 에이전트 프로필 4종 | 보조 |
| `/squads` | **1개 생김**: `Code Review Squad` (`9fa362e9-f9f1-4444-a08a-b7fa24a60891`, idle, 2026-08-23 03:49 KST 생성) | 아래 2절 전부 열림 (덤프 완료) |
| `/squads/tasks/summary` | 스쿼드별 태스크 카운트 | 대시보드 숫자 |
| `/tools`, `/engines`, `/system/info`, `/health`, `/version` | 도구 목록(30KB), 엔진, 시스템(linux x86_64, 48코어, 346GB), v1.12.1 | 배경 정보 |
| ❌ `/monitoring/inference-stats` (405), `/stats/router?window=1h` (500) | 미지원/오류 | — |

## 2. 스쿼드가 생기면 열리는 값 (squadService 기준, 스쿼드 ID 필요)

| 엔드포인트 | 내용 | 시각화 매핑 |
|---|---|---|
| `/squads/{id}` | agents[] (id/name/role/model/tools), 설정 | **캐릭터 소환**: 에이전트 수만큼 도트 캐릭터 |
| `/squads/{id}/tasks`, `/tasks/graph` | 태스크 목록 + **DAG(의존 그래프)** | **흐름도/노선도의 뼈대** — 누가 무엇을 누구에게 |
| `/squads/{id}/budget`, `/budget/usage` | 예산 설정(임계치) + **사용량** | **택시미터 본체**, 손절 판정 기준선 |
| `/squads/{id}/analytics?period=` | 집계 분석 | Nerd Mode 차트 |
| `/squads/{id}/history?limit=` | **실행 이력 목록**(executionId) | 문제(P1, P2…) 카드 목록 |
| `/squads/{id}/history/{eid}` | 실행 상세 | 한 문제의 타임라인 |
| `/squads/{id}/history/{eid}/logs?agentId&minLevel&limit` | **실행 로그**(에이전트별 필터) | 말풍선·trace·"왜 막혔나" |
| `POST /history/{eid}/report` | 실행 리포트 생성(쓰기지만 부작용 경미 — 팀 허가 후) | 제출용 요약 |
| `/squads/{id}/activity-log/load?limit&offset` | **활동 로그** | 핸드오프 이벤트 후보 |
| `/squads/{id}/agents/{aid}/status` | 에이전트 상태 | 캐릭터 상태(대기/작업중) |
| `/squads/{id}/agents/{aid}/conversation`, `/sessions` | 대화 내용 | "말 걸기" 실데이터 (직접 대화는 `POST .../message` — 쓰기) |
| `/squads/{id}/memory/{aid}`, `/memory/search?q=` | 에이전트 메모리 | Nerd Mode |
| `/squads/{id}/readiness`, `/workspace/status`, `/workspace/files` | 준비 상태, 워크스페이스 | 시작 전 체크 |
| `/squads/{id}/executions/{eid}` | 진행 중 실행 상태 (폴링) | 실시간 보조 |

## 2-1. 확정된 스키마 (Code Review Squad 덤프, `backend/dump/20260823-035618/`)

- `GET /squads/{id}` → `{id,name,description,workspacePath,agents[],plannerAgentId,status:{type:'idle'},createdAt,updatedAt}`
  - `agents[]` = `{id, name, icon, role:{type:'planner'|…}, systemPrompt, instructions, toolConfig:{enabledTools[]…}, modelPreferences:{preferredModelId:'furiosa-ai/Qwen3-32B-FP8', preferredProviderId}, memoryEnabled, executionMode:'in_process'}`
  - 현재 4명(Planner/Security·Performance·Style Reviewer) 전부 Qwen3-32B-FP8 → **우리 캐스케이드 스쿼드(후배 Qwen / 선배 gpt-oss / 선생님 K-EXAONE)는 아직 서버에 없음**
- `budget` → `{maxTotalTokens:100000, maxTokensPerAgent:30000, maxTokensPerTask:10000, maxConcurrentAgents:3, maxTasksPerPlan:20, maxPlanIterations:3, maxAgentTurns:20, executionTimeoutSecs, taskTimeoutSecs, agentIdleTimeoutSecs, warningThresholdPercent:80}` — **손절/경고 임계의 실제 소스**
- `budget/usage` → `{totalTokens, perAgentTokens{agentId:tokens}, tasksCreated, planIterations, activeAgents, startedAt, exceeded, warningEmitted, emergencyStopped}` — **택시미터 본체** (perAgentTokens × 단가 = 가중토큰)
- `readiness` → `{available, routerHealthy, agents[]:{agentId,agentName,modelId,modelServed,message}}`
- `analytics?period=` → `{totalExecutions,totalTokens,perAgentTokens,successRate,avgDurationMs,dailyUsage[],completedCount,failedCount,cancelledCount}` — Nerd Mode 차트
- `tasks/graph` → `{tasks[],waves[],readyTaskIds[]}` (실행 전이라 비어 있음 — **waves = 실행 단계, 노선도의 역 배치에 그대로 쓸 수 있는 구조**)
- `activity-log/load` → `{entries[],total}` / `history` → `[]` (실행 0회)
- `agents/{aid}/status`·`memory/{aid}` → 404 (실행 전), `conversation` → `[]`

## 2-2. CORS와 로컬 백엔드 (확정)

- 서버 응답에 `Access-Control-Allow-Origin` 없음 → **다른 origin 브라우저 페이지에서 직접 fetch/SSE 불가** (실측: "Failed to fetch").
- 해결: `python backend/proxy.py 8790` → `http://127.0.0.1:8790/index.html`. 페이지는 `/aigo/api/v1/...`만 부르면 됨(키는 프록시가 붙임). SSE도 `/aigo/api/v1/events`로 청크 통과 (실측: `: ping` 수신).
- 브라우저 검증(2026-08-23): health ✓ · squads ✓ · `squadSnapshot(sid)` 13개 섹션 ✓ · SSE connected ✓

## 3. 실시간: `GET /api/v1/events` (SSE)

- 앱 전체가 이 **단일 SSE 채널**로 실시간 이벤트를 받는다 (EventSource, named event + JSON payload).
- 유휴 상태에서는 15초마다 `: ping`만 옴 (확인 완료). **스쿼드가 실행되는 순간 이벤트 이름·페이로드가 처음 관측된다.**
- 브라우저 `EventSource`는 이름을 미리 알아야 들을 수 있어서, `aigo_client.js`의 `tapEvents()`는 fetch 스트림을 raw 파싱해 **이름 모르는 이벤트도 전부** 잡는다 (`sse_tap.py` 동일).

## 4. 우리가 아직 모르는 것 / 팀에서 필요한 것

1. **SSE 이벤트의 실제 이름과 페이로드 스키마** — 스쿼드 실행 1회만 관측하면 확정됨. 팀이 벤치마크 돌릴 때 `python backend/sse_tap.py 600` 을 같이 켜두면 `backend/dump/sse_events.jsonl`에 전부 기록된다.
2. **history/logs/activity-log의 JSON 형태** — 같은 시점에 `python backend/dump_all.py` 한 번 더 (스쿼드가 있으면 하위 리소스 자동 수집).
3. **CORS**: 독립 페이지(다른 origin)에서 서버 API를 직접 fetch할 수 있는지 — 아래 검증 결과 참조. 막히면 `backend/`에 얇은 프록시(로컬 파이썬) 한 장이면 해결.

## 5. 시각화 이벤트 ↔ 데이터 소스 매핑 (초안)

| 시각화 이벤트 | 1차 소스 | 대안/보강 |
|---|---|---|
| 문제 접수·분류 | SSE(실행 시작 이벤트) / `history` 신규 항목 | `executions/{eid}` 폴링 |
| 풀이 중(작업 애니) | SSE 에이전트 상태 / `agents/{aid}/status` | `monitoring/metrics.inference.tokensPerSecond` 상승 |
| 검증 실패·재시도 | `history/{eid}/logs` (레벨·메시지 패턴) | activity-log |
| 에스컬레이션(핸드오프) | `tasks/graph` 엣지 + activity-log | logs의 agentId 전환 |
| 불일치 / 손절 | logs + `budget/usage` vs `budget` 임계 | 우리 스쿼드 로직이 남기는 명시적 로그 라인 권장 |
| 제출(○/✗) | history 상세의 결과 필드 | — |
| 택시미터 누적 | `budget/usage` → 없으면 `stats/usage.modelStats`(모델별 토큰×단가) | SSE 토큰 이벤트 |

## 6. 상위 변수 레이어 — `backend/aigo_state.js` (시각화가 믿어도 되는 계약)

서버 응답은 전부 `ADAPT.*` 어댑터를 거쳐 아래 **고정 키**로 들어간다. API 형태가 바뀌면 어댑터만 고치고 시각화는 손대지 않는다.

| 상위 변수 | 내용 | 원천 |
|---|---|---|
| `AIGO.state.server` | ok/status/version/routerHealthy/models[]/providers[] | health, version, router/status, providers |
| `AIGO.state.squad` | id/name/status/plannerAgentId/agentCount/available | squads/{id}, readiness |
| `AIGO.state.agents[]` | id/name/icon/roleType/modelId/**rate(단가)**/**label(후배·선배·선생님)**/tools[]/status/**tokens**/**weightedTokens**/isPlanner/available/modelServed | squads/{id}.agents + readiness + budget/usage |
| `AIGO.state.budget` | maxTotalTokens/maxTokensPerAgent/…/warningPercent | squads/{id}/budget |
| `AIGO.state.usage` | totalTokens/**weightedTokens**/perAgentTokens/perAgentWeighted/**percentOfBudget**/activeAgents/exceeded/warningEmitted/emergencyStopped/startedAt | squads/{id}/budget/usage (+단가 계산) |
| `AIGO.state.metrics` | cpuPct/memPct/tokensPerSecond/contextUsed/contextMax | monitoring/metrics |
| `AIGO.state.tasks` | list[]/waves[]/readyTaskIds[]/count | tasks, tasks/graph |
| `AIGO.state.executions` | current/currentId/history[]/count | history, executions/{eid} |
| `AIGO.state.activity[]` | t/agentId/agentName/kind/message | activity-log |
| `AIGO.state.events[]` | SSE 정규화: t/name/**kind**(handoff·verify_fail·budget·done·working·error·info)/agentId/tokens/data | /api/v1/events |
| `AIGO.state.stats` | totalRequests/totalTokens/avgLatencyMs/modelStats[] | stats/usage |
| `AIGO.state.meta` | lastRefresh/refreshMs/sse 상태/errors[]/eventNamesSeen{} | — |

- 단가표 `AIGO.rates` = `{Qwen3-32B-FP8:1, gpt-oss-120b:2, K-EXAONE-236B:3}` (configure({rates})로 교체), 라벨 `AIGO.roleLabels` = `{1:'후배',2:'선배',3:'선생님'}`
- `AIGO.EVENT_MAP` — SSE 이벤트 이름이 확정되면 `{ '<이벤트명>': {kind, agentId: d=>…, tokens: d=>…} }` 만 채우면 정규화 완성
- API: `configure({base,key,squadId,rates})` · `start({pollMs,fastMs,sse})` · `stop()` · `refreshAll()` · `refreshFast()` · `on(cb)` · `pickSquad(id)` · `toJSON()` · `agentByLabel('후배')`
- 뷰어: `http://127.0.0.1:8790/backend/state_viewer.html` (전체 상위 변수 JSON 실시간)

## 7. 스쿼드 엔진 이벤트 피드 (2026-08-29 · aigo-web `backend/squad_engine.py`)

서버: 우리 배포 `https://aigo-web-production.up.railway.app` (같은 origin 이라 프록시 불필요 · 접근 게이트 쿠키). `/api/v1/squads/*` 는 엔진이 가로채고, 엔진에 기록이 없는 스쿼드는 aigo-server 로 통과.

| 엔드포인트 | 내용 | 시각화 |
|---|---|---|
| `GET squads/{sid}/executions/{eid}/events?after=N` | `{executionId, phase, seq, events:[…]}` — seq > N 인 것만 | **재생의 원천** (`aigo_state.refreshFast` 가 2초마다) |
| `GET squads/{sid}/history?limit=12` | 최신순. `no`(스쿼드의 n번째 실행), `phase`(planning/executing/aggregating/completed/failed/cancelled), `tasks[]`, `tokenUsage`, `durationMs` | 시간표(교시), 현재 실행 감지, Studio 상태 줄 |
| `GET squads/{sid}/executions/{eid}` | 진행 중 실행 상세(status.type=phase, status.data.currentWave/totalWaves, plan.tasks[].status) | Studio "k/m단계 · 담당" |
| `GET squads/{sid}/budget/usage` | **스쿼드 누적**(모든 실행 합) totalTokens/perAgentTokens, currentExecutionId, executions | 택시미터·연필 게이지 |
| `POST squads/{sid}/execute` `{request, autoApprove:true}` | 실행 시작 → `{executionId}` | 문제 내기(T) |

이벤트 `{seq, t(ms), kind, …}`:

| kind | 필드 | 뜻 |
|---|---|---|
| `request` | text | 요청 접수 |
| `planning` | agent | 플래너가 계획 중 (DEMO=0 일 때만) |
| `plan` | title, planner, plannedBy?, waves, tasks[{id,title,agent,agentName,dependsOn[],wave}] | 계획 확정 |
| `wave` | index, total, tasks[] | 단계 시작 |
| `task_start` | task, agent, title, dependsOn[], fromAgents[] | 담당이 작업 시작 (fromAgents = 앞 단계 담당들) |
| `task_retry` | task, agent, text | 에이전트 세션 실패 → 직접 추론 재시도 |
| `task_done` / `task_failed` | task, agent, text(결과/오류 앞부분), tokens | 작업 끝 |
| `aggregate` | agent, tasks | 플래너가 결과 종합 (작업 2개 이상) |
| `done` | ok, phase, agent(최종 답 작성자), text, tokens, durationMs | 실행 종료 |
| `awaiting_approval` · `approved` · `cancel` | — / text | 승인 흐름 |
