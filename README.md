# squad-sniffer — 스쿼드 실행을 보여 주는 픽셀 교실

[Backend.AI GO](https://go.backend.ai/ko/) 에이전트 스쿼드의 실행을 픽셀아트 교실로 그립니다. 칠판에 문제가 적히고, 학생(에이전트)이 카드를 받아 풀고, 막히면 손을 들어 선배를 부르고, 채점 뒤 제출하며, 쓴 토큰은 상단 택시미터에 쌓입니다. 학생에게 말을 걸면(Space) 그 에이전트의 모델이 자기 상황을 답합니다.

## Backend.AI GO 앱의 사이드 앱으로 쓰기

데스크톱 앱을 설치했다면 이 저장소만 받아서 바로 붙일 수 있습니다.

1. 앱에서 **설정 → API → 관리 API** 를 켭니다 (기본 `127.0.0.1:8001`). 액세스 키를 걸었다면 **API → 액세스 키** 에서 만든 값을 `AIGO_KEY` 로 줍니다.
2. `./run.sh` — 앱을 자동으로 찾아 붙고 브라우저가 열립니다. 교실은 앱의 스쿼드·실행 이력을 읽고, 말 걸기는 앱의 추론 서버(`127.0.0.1:39080`)로 갑니다.

```bash
./run.sh                                          # 이 컴퓨터의 Backend.AI GO 앱 (사이드 앱 모드)
AIGO_KEY=ak_... ./run.sh                          # 앱에 액세스 키를 걸어 둔 경우
AIGO_BASE=https://서버 AIGO_KEY=토큰 ./run.sh        # aigo-web 배포본 등 다른 서버 (게이트 토큰)
./run.sh 8790 mock                                # 서버 없이 내장 시나리오
```

앱을 못 찾으면 프록시가 켜는 방법을 안내하고 종료합니다. 필요한 것은 파이썬 3 뿐입니다(표준 라이브러리만).

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
