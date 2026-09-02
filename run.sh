#!/usr/bin/env bash
# squad-sniffer 실행 (mac/linux): ./run.sh [port] [mock|live]
#   기본: 이 컴퓨터의 Backend.AI GO 앱에 사이드 앱으로 붙는다 (앱 설정 → API → 관리 API 켜기). 액세스 키를 걸었다면 AIGO_KEY=…
#   다른 서버: AIGO_BASE=https://… AIGO_KEY=… ./run.sh
cd "$(dirname "$0")"; PORT="${1:-8790}"; Q=""; [ "$2" = mock ] && Q="?source=mock"; [ "$2" = live ] && Q="?source=live"
python3 backend/proxy.py "$PORT" & PID=$!; sleep 1.5; kill -0 $PID 2>/dev/null || exit 2
URL="http://127.0.0.1:$PORT/index.html$Q"; (command -v open >/dev/null && open "$URL") || (command -v xdg-open >/dev/null && xdg-open "$URL") || echo "브라우저에서 열기: $URL"
echo "종료: Ctrl+C"; wait $PID
