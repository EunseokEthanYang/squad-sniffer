#!/usr/bin/env bash
# squad-sniffer 실행 (mac/linux): ./run.sh [port] [mock|live]
cd "$(dirname "$0")"; PORT="${1:-8790}"; Q=""; [ "$2" = mock ] && Q="?source=mock"; [ "$2" = live ] && Q="?source=live"
python3 backend/proxy.py "$PORT" & PID=$!; sleep 1
URL="http://127.0.0.1:$PORT/index.html$Q"; (command -v open >/dev/null && open "$URL") || (command -v xdg-open >/dev/null && xdg-open "$URL") || echo "브라우저에서 열기: $URL"
echo "종료: Ctrl+C"; wait $PID
