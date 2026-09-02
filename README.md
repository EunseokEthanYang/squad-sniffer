# squad-sniffer — 스쿼드 실행을 보여 주는 픽셀 교실

[Backend.AI GO](https://go.backend.ai/ko/) 에이전트 스쿼드의 실행을 픽셀아트 교실로 그립니다. 칠판에 문제가 적히고, 학생(에이전트)이 카드를 받아 풀고, 막히면 손을 들어 선배를 부르고, 채점 뒤 제출하며, 쓴 토큰은 상단 택시미터에 쌓입니다. 학생에게 말을 걸면(Space) 그 에이전트의 모델이 자기 상황을 답합니다.

## 데이터 소스 — 데스크톱 앱은 아직 지원하지 않습니다

**Backend.AI GO 데스크톱 앱(1.12.1)은 지원 대상이 아닙니다.** 앱이 관리 API(`/api/v1/squads` 등, 포트 8001)를 외부에 열지 않기 때문입니다 — 설정에 스위치가 없고, 액세스 키를 만들어도 열리지 않습니다(라우터 39080 만 열립니다). 앱이 관리 API를 노출하는 버전이 나오면 `./run.sh` 가 그대로 붙도록 코드는 준비돼 있습니다(`127.0.0.1:8001` 자동 감지, `X-API-Key`).

지금 붙는 곳:

```bash
AIGO_BASE=http://127.0.0.1:1001 ./run.sh                 # 로컬 aigo-web 컨테이너 (LOCAL_AGENTS=1 ./run-local.sh)
AIGO_BASE=https://서버 AIGO_KEY=게이트토큰 ./run.sh         # aigo-web 배포본
AIGO_BASE=http://127.0.0.1:8001 AIGO_KEY=액세스키 ./run.sh   # 헤드리스 aigo-server
./run.sh 8790 mock                                       # 서버 없이 내장 시나리오
```

필요한 것은 파이썬 3 뿐입니다(표준 라이브러리만).

## aigo-web 안에서

[aigo-web](https://github.com/EunseokEthanYang/aigo-web) 은 이 저장소를 submodule 로 넣고 `./sync-viz.sh` 로 `viz/` 에 가공해 컨테이너 안에서 같은 오리진으로 서빙합니다. 그쪽에서는 프록시가 필요 없고, 두 경우 모두 이 저장소가 원본입니다. 고치는 순서: 여기서 커밋 → aigo-web 에서 `./sync-viz.sh` → `viz/` 와 submodule 포인터를 함께 커밋.

조작법·화면 읽는 법·URL 파라미터는 [README_RUN.md](README_RUN.md) 에 있습니다.

## 구조

| 경로 | 역할 |
|---|---|
| `js/config.js` | 스쿼드·테마·캐릭터·목소리·단가 등 모든 설정 |
| `js/engine/` | 캔버스 월드, 연출(director), UI 오버레이, 음성 루프 |
| `js/data/` | 데이터 소스: `live.js`(AI:GO 이벤트 재생), `mock.js`(내장 시나리오) |
| `backend/proxy.py` | 로컬 정적 서버 + AI:GO 리버스 프록시 (사이드 앱 모드) |
| `assets/` | 캐릭터 스프라이트·입간판·교실 배경 |
| `docs/HANDOFF.md` | 인수인계 문서 (설계·규칙·검증 이력) |
| `tools/voice-test.js` | 음성 루프 회귀 테스트 (`node tools/voice-test.js`) |
