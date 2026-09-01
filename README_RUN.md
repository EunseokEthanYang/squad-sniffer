# squad-sniffer — 실행 안내 (사용자 테스트용)

교실 도트게임으로 AI 에이전트 스쿼드의 문제 풀이 흐름(누가 누구에게 넘겼는지 · 어디서 막혔는지 · 비용)을 보여주는 웹앱.
빌드 없음 · 의존성 없음(Python 3.8+ 표준 라이브러리만). 서버(AI:GO)가 안 닿아도 내장 시나리오(MOCK)로 동작.

## 실행
| 환경 | 방법 |
|---|---|
| Windows | `run.bat` 더블클릭 → 브라우저 자동 오픈 (`http://127.0.0.1:8790/index.html`) |
| Windows · 서버 무시하고 MOCK 강제 | `run_mock.bat` |
| mac / linux | `./run.sh` (옵션: `./run.sh 8791 mock`) |
| 수동 | `python backend/proxy.py 8790` 후 브라우저에서 위 주소 |

- 포트가 겹치면 `run.bat 8791` 처럼 다른 포트. (기본 8790 — 8765 는 다른 앱과 충돌 이력이 있어 쓰지 않음)
- 인터넷 필요: 폰트(CDN) + LIVE 데이터(AI:GO Railway). 오프라인이면 폰트만 기본값으로 바뀌고 MOCK 으로 돎.
- `backend/proxy.py` 는 정적 서빙 + `/aigo/*` 리버스 프록시(접근 키 자동 부착, CORS 우회). 서버에 **읽기만** 한다.

## 조작
| 키 | 동작 |
|---|---|
| `← ↑ ↓ →` | 내 캐릭터 이동 (방향키 전용 · WASD/게임패드는 `js/config.js` → `controls` 에서 켬) |
| `E` | 가까운 에이전트와 대화 (미연시 대화창 · ⚙에서 웹 채팅으로 전환 가능) |
| `T` | 문제 내기 (MOCK: 내장 흐름 재생 · LIVE: 스쿼드가 실제로 실행 — `POST /execute`) |
| `N` | NERD MODE (예산 번다운 + 원시 트레이스) |
| `M` | 종소리 ON/OFF · `Esc` 닫기 |

⚙ 메뉴: 대화 UI(미연시/웹) · NERD · 시간표 · 종소리 · 이름표(자동/항상/숨김) · 테마(밝음/기본/초안) · **스쿼드 선택**(LIVE 목록에서 고르면 기억됨)

## 화면 읽는 법
- 상단 **TAXIMETER**: 스쿼드가 쓴 비용(가중 토큰). 램프 1×/2×/3× = 지금 일하는 단가.
- 칠판: 현재 문제. 캐릭터 머리 위 카드 = 들고 있는 문제. 말풍선 = 지금 무슨 일.
- 후배(1×) → 선배(2×) → 선생님(3×, 평소 공석) 순으로 막히면 손들고 넘김. 연필 게이지 = 남은 토큰.
- 좌상단 시간표: 몇 교시(문제) 진행 중인지. 행 클릭 → 상세.
- 우상단 칩: `● MOCK · 내장 시나리오` / `● LIVE · <스쿼드명>` — 클릭하면 소스 전환.

## URL 파라미터
`?source=mock|live` 소스 강제 · `?skipIntro=1` 인트로 생략 · `?theme=light|draft|default` · `?nerd=1` · `?chat=vn|web` (첫 에이전트 대화창 자동 오픈, 캡처용)

## 설정은 전부 `js/config.js`
- 팝업(하단 공지·판정 카드)은 현재 **꺼짐**: `theme.annotations`, `theme.verdictCards` 를 `true` 로 하면 복원.
- 단가표 `rates`, 역할 라벨 `roleLabels`, 캐릭터 배정 `characters`, 이동 키 `controls`, 맵 바닥 `world.walkable`.
- 구조/인수인계: `docs/HANDOFF.md`, `docs/architecture.md`, 데이터 항목: `docs/data-catalog.md`.

## 알려진 상태
- LIVE 는 우리 스쿼드 엔진(aigo-web)의 실행 이벤트 피드를 재생한다(`docs/HANDOFF.md` §12). 서버 스쿼드가 **idle** 이면 아무도 안 움직임(정상). 콘솔 Squad Chat 이나 `T` 로 요청을 보내면 칠판에 문제가 적히고 교실이 움직인다. 이미 끝난 실행은 다시 재생하지 않는다(시간표에만 ✓).
- aigo-web 안에서(`/_viz/`, `/studio`) 쓸 때는 프록시가 필요 없다(같은 origin). 이 폴더를 고치면 `aigo-web/sync-viz.sh` 로 복사.
- 폴더 안 `*.MOV`, `image 7.png` 는 원본 자료(패키지에 미포함).
