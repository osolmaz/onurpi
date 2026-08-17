#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage:
  guarded-launch.sh [options] -- command [args...]

Options:
  --label NAME             Label shown in guard logs.
  --min-mem-gb N           Minimum MemAvailable in GiB before killing the process group. Default: 16.
  --min-swap-gb N          Minimum SwapFree in GiB before killing the process group. Default: 2.
  --poll-sec N             Poll interval in seconds. Default: 1.
  --grace-sec N            Seconds between TERM and KILL. Default: 10.
  --allow-no-earlyoom      Permit launch when earlyoom is not running.
  -h, --help               Show this help.

The command is started in a new session/process group. On memory pressure, this
script sends TERM, then KILL, to that process group and exits 137.
USAGE
}

label="inference"
min_mem_gb=16
min_swap_gb=2
poll_sec=1
grace_sec=10
require_earlyoom=1

while [[ $# -gt 0 ]]; do
  case "$1" in
    --label)
      label="${2:?missing value for --label}"
      shift 2
      ;;
    --min-mem-gb)
      min_mem_gb="${2:?missing value for --min-mem-gb}"
      shift 2
      ;;
    --min-swap-gb)
      min_swap_gb="${2:?missing value for --min-swap-gb}"
      shift 2
      ;;
    --poll-sec)
      poll_sec="${2:?missing value for --poll-sec}"
      shift 2
      ;;
    --grace-sec)
      grace_sec="${2:?missing value for --grace-sec}"
      shift 2
      ;;
    --allow-no-earlyoom)
      require_earlyoom=0
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    --)
      shift
      break
      ;;
    *)
      echo "unknown option: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

if [[ $# -eq 0 ]]; then
  echo "missing command" >&2
  usage >&2
  exit 2
fi

if [[ "$require_earlyoom" == "1" ]] && ! pgrep -x earlyoom >/dev/null 2>&1; then
  echo "refusing to launch $label: earlyoom is not running" >&2
  echo "start/enable a memory guard or pass --allow-no-earlyoom only for tiny tests" >&2
  exit 3
fi

if ! [[ "$min_mem_gb" =~ ^[0-9]+([.][0-9]+)?$ ]]; then
  echo "--min-mem-gb must be numeric" >&2
  exit 2
fi
if ! [[ "$min_swap_gb" =~ ^[0-9]+([.][0-9]+)?$ ]]; then
  echo "--min-swap-gb must be numeric" >&2
  exit 2
fi

gb_to_kb() {
  awk -v gb="$1" 'BEGIN { printf "%.0f\n", gb * 1024 * 1024 }'
}

min_mem_kb="$(gb_to_kb "$min_mem_gb")"
min_swap_kb="$(gb_to_kb "$min_swap_gb")"

mem_kb() {
  awk -v key="$1" '$1 == key ":" { print $2; exit }' /proc/meminfo
}

kill_group() {
  local pgid="$1"
  local why="$2"
  echo "guarded-launch: killing $label process group $pgid: $why" >&2
  kill -TERM -- "-$pgid" 2>/dev/null || true
  sleep "$grace_sec"
  kill -KILL -- "-$pgid" 2>/dev/null || true
}

avail_kb="$(mem_kb MemAvailable)"
swap_kb="$(mem_kb SwapFree)"

if (( avail_kb < min_mem_kb )); then
  echo "refusing to launch $label: MemAvailable ${avail_kb}KiB is below floor ${min_mem_kb}KiB" >&2
  exit 4
fi
if (( swap_kb < min_swap_kb )); then
  echo "refusing to launch $label: SwapFree ${swap_kb}KiB is below floor ${min_swap_kb}KiB" >&2
  exit 4
fi

echo "guarded-launch: starting $label"
echo "guarded-launch: memory floors: MemAvailable >= ${min_mem_gb}GiB, SwapFree >= ${min_swap_gb}GiB"
echo "guarded-launch: command: $*"

setsid "$@" &
child_pid=$!
pgid="$child_pid"
pressure_killed=0

cleanup() {
  local status=$?
  if [[ "${pressure_killed:-0}" == "0" ]] && kill -0 "$child_pid" 2>/dev/null; then
    kill_group "$pgid" "guard script exiting"
  fi
  exit "$status"
}
trap cleanup INT TERM

while kill -0 "$child_pid" 2>/dev/null; do
  avail_kb="$(mem_kb MemAvailable)"
  swap_kb="$(mem_kb SwapFree)"
  if (( avail_kb < min_mem_kb )); then
    pressure_killed=1
    kill_group "$pgid" "MemAvailable ${avail_kb}KiB below ${min_mem_kb}KiB"
    wait "$child_pid" 2>/dev/null || true
    exit 137
  fi
  if (( swap_kb < min_swap_kb )); then
    pressure_killed=1
    kill_group "$pgid" "SwapFree ${swap_kb}KiB below ${min_swap_kb}KiB"
    wait "$child_pid" 2>/dev/null || true
    exit 137
  fi
  sleep "$poll_sec"
done

wait "$child_pid"
