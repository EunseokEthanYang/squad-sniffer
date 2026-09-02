# 포트가 이미 잡혀 있으면 누가 쓰는지 보여 주고 물어본다: 죽이고 계속 / 다른 포트 / 그만.
# 자동으로 죽이지 않는다 — 남의 서버일 수 있다. 터미널이 아니면(파이프·CI) 묻지 못하니 안내하고 실패한다.
#   source backend/portguard.sh; ensure_port PORT "용도"   →  PORT 변수가 바뀔 수 있다 (다른 포트를 고른 경우)
port_owner() { lsof -nP -iTCP:"$1" -sTCP:LISTEN 2>/dev/null | awk 'NR>1 {print $2" "$1; exit}'; }
port_free_wait() { local i; for i in $(seq 1 25); do [ -z "$(port_owner "$1")" ] && return 0; sleep 0.2; done; return 1; }
ensure_port() {
  local var=$1 label=$2 port owner pid pname key new container
  port=${!var}
  while :; do
    owner=$(port_owner "$port"); [ -z "$owner" ] && return 0
    pid=${owner%% *}; pname=${owner#* }
    container=""
    if command -v docker >/dev/null 2>&1 && echo "$pname" | grep -qiE "docker|orbstack|com\.docke|vpnkit|limactl|colima"; then
      container=$(docker ps --filter "publish=$port" --format '{{.Names}}' 2>/dev/null | head -1)
    fi
    [ -n "$container" ] && [ "$container" = "${PORTGUARD_IGNORE_CONTAINER:-}" ] && return 0   # 우리 컨테이너면 곧 갈아치울 것이라 묻지 않는다
    if [ ! -t 0 ]; then
      echo "port $port ($label) is in use by ${container:-$pname (pid $pid)}. Not a terminal, so I cannot ask - pass another port." >&2
      return 1
    fi
    printf '\n\033[1m┌─ port %s is already in use ─────────────────────────────\033[0m\n' "$port"
    if [ -n "$container" ]; then printf '│  docker container \033[1m%s\033[0m publishes %s   (for: %s)\n' "$container" "$port" "$label"
    else printf '│  \033[1m%s\033[0m (pid %s) is listening on %s   (for: %s)\n' "$pname" "$pid" "$port" "$label"; fi
    printf '│\n│  [k] %s and continue     [p] use another port     [q] quit\n' "$([ -n "$container" ] && echo "stop that container" || echo "kill it")"
    printf '\033[1m└─\033[0m choose (k/p/q): '
    read -rsn1 key; echo
    case "$key" in
      k|K)
        if [ -n "$container" ]; then docker stop "$container" >/dev/null 2>&1 || docker rm -f "$container" >/dev/null 2>&1
        else kill "$pid" 2>/dev/null; port_free_wait "$port" || kill -9 "$pid" 2>/dev/null; fi
        port_free_wait "$port" && { echo "   freed $port"; return 0; }
        echo "   still busy - try again";;
      p|P)
        printf '   new port for %s: ' "$label"; read -r new
        case "$new" in ''|*[!0-9]*) echo "   not a number";; *) port=$new; printf -v "$var" '%s' "$port"; echo "   using $port";; esac;;
      q|Q|$'\e') echo "   stopped"; return 1;;
    esac
  done
}
