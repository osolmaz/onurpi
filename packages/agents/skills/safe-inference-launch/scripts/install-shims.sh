#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage:
  install-shims.sh [options]

Options:
  --bin-dir DIR           Install PATH shims here. Default: ~/.local/bin.
  --tools CSV             Comma-separated PATH shim names.
                          Default: vllm,llama-server,llama-cli,llama-bench,sglang,trtllm-serve,text-generation-launcher
  --wrap PATH             Wrap an existing executable in place. May be repeated.
  --min-mem-gb N          Default guard MemAvailable floor for generated shims. Default: 24.
  --min-swap-gb N         Default guard SwapFree floor for generated shims. Default: 4.
  --guard PATH            guarded-launch.sh path. Default: sibling guarded-launch.sh.
  --dry-run               Print actions without writing.
  --force                 Replace existing non-managed PATH shims.
  --uninstall             Remove managed PATH shims and unwrap managed in-place wrappers.
  -h, --help              Show this help.

PATH shims resolve the real executable by scanning PATH while skipping their own
directory. In-place wrappers move an executable to PATH.real and replace PATH
with a guarded wrapper, so absolute calls are protected too.
USAGE
}

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
bin_dir="$HOME/.local/bin"
tools_csv="vllm,llama-server,llama-cli,llama-bench,sglang,trtllm-serve,text-generation-launcher"
min_mem_gb=24
min_swap_gb=4
guard="$script_dir/guarded-launch.sh"
dry_run=0
force=0
uninstall=0
wrap_paths=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --bin-dir)
      bin_dir="${2:?missing value for --bin-dir}"
      shift 2
      ;;
    --tools)
      if [[ $# -lt 2 ]]; then
        echo "missing value for --tools" >&2
        exit 2
      fi
      tools_csv="$2"
      shift 2
      ;;
    --wrap)
      wrap_paths+=("${2:?missing value for --wrap}")
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
    --guard)
      guard="${2:?missing value for --guard}"
      shift 2
      ;;
    --dry-run)
      dry_run=1
      shift
      ;;
    --force)
      force=1
      shift
      ;;
    --uninstall)
      uninstall=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "unknown option: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

if [[ ! -x "$guard" ]]; then
  echo "guard script is missing or not executable: $guard" >&2
  exit 2
fi

say() {
  printf '%s\n' "$*"
}

run() {
  if [[ "$dry_run" == "1" ]]; then
    say "dry-run: $*"
  else
    "$@"
  fi
}

is_managed_shim() {
  local path="$1"
  [[ -f "$path" ]] && grep -q "safe-inference-launch managed shim" "$path" 2>/dev/null
}

write_path_shim() {
  local tool="$1"
  local shim_path="$bin_dir/$tool"
  local env_name
  env_name="$(printf 'SAFE_INFERENCE_REAL_%s' "$tool" | tr '[:lower:]-' '[:upper:]_')"

  if [[ -e "$shim_path" ]] && ! is_managed_shim "$shim_path"; then
    if [[ "$force" != "1" ]]; then
      echo "refusing to replace non-managed file: $shim_path" >&2
      echo "pass --force to replace it" >&2
      exit 5
    fi
  fi

  say "installing PATH shim: $shim_path"
  if [[ "$dry_run" == "1" ]]; then
    return
  fi

  mkdir -p "$bin_dir"
  cat >"$shim_path" <<SHIM
#!/usr/bin/env bash
# safe-inference-launch managed shim
set -euo pipefail

tool="$tool"
guard="\${SAFE_INFERENCE_GUARD:-$guard}"
min_mem="\${SAFE_INFERENCE_MIN_MEM_GB:-$min_mem_gb}"
min_swap="\${SAFE_INFERENCE_MIN_SWAP_GB:-$min_swap_gb}"
real="\${$env_name:-}"

if [[ -z "\$real" ]]; then
  shim_dir="\$(cd "\$(dirname "\${BASH_SOURCE[0]}")" && pwd)"
  IFS=: read -r -a path_parts <<< "\$PATH"
  for dir in "\${path_parts[@]}"; do
    [[ -z "\$dir" ]] && dir="."
    candidate="\$dir/\$tool"
    [[ "\$dir" == "\$shim_dir" ]] && continue
    [[ -x "\$candidate" && ! -d "\$candidate" ]] || continue
    if grep -q "safe-inference-launch managed shim" "\$candidate" 2>/dev/null; then
      continue
    fi
    real="\$candidate"
    break
  done
fi

if [[ -z "\$real" ]]; then
  echo "safe-inference-launch: could not resolve real executable for \$tool" >&2
  echo "set $env_name=/path/to/\$tool or put the real binary later in PATH" >&2
  exit 127
fi

exec "\$guard" \\
  --label "\$tool" \\
  --min-mem-gb "\$min_mem" \\
  --min-swap-gb "\$min_swap" \\
  -- "\$real" "\$@"
SHIM
  chmod +x "$shim_path"
}

write_in_place_wrapper() {
  local target="$1"
  local real_path="${target}.real"

  if [[ ! -e "$target" ]]; then
    echo "cannot wrap missing path: $target" >&2
    exit 6
  fi
  if [[ ! -x "$target" ]]; then
    echo "cannot wrap non-executable path: $target" >&2
    exit 6
  fi
  if is_managed_shim "$target"; then
    say "already wrapped: $target"
    return
  fi
  if [[ -e "$real_path" ]]; then
    echo "refusing to overwrite existing real path: $real_path" >&2
    exit 7
  fi

  say "wrapping executable: $target -> $real_path"
  if [[ "$dry_run" == "1" ]]; then
    return
  fi

  mv "$target" "$real_path"
  cat >"$target" <<SHIM
#!/usr/bin/env bash
# safe-inference-launch managed shim
set -euo pipefail

guard="\${SAFE_INFERENCE_GUARD:-$guard}"
min_mem="\${SAFE_INFERENCE_MIN_MEM_GB:-$min_mem_gb}"
min_swap="\${SAFE_INFERENCE_MIN_SWAP_GB:-$min_swap_gb}"
real="\${BASH_SOURCE[0]}.real"
label="\$(basename "\${BASH_SOURCE[0]}")"

exec "\$guard" \\
  --label "\$label" \\
  --min-mem-gb "\$min_mem" \\
  --min-swap-gb "\$min_swap" \\
  -- "\$real" "\$@"
SHIM
  chmod --reference="$real_path" "$target" 2>/dev/null || chmod +x "$target"
}

uninstall_path_shim() {
  local tool="$1"
  local shim_path="$bin_dir/$tool"
  if is_managed_shim "$shim_path"; then
    say "removing PATH shim: $shim_path"
    run rm -f "$shim_path"
  fi
}

unwrap_in_place_wrapper() {
  local target="$1"
  local real_path="${target}.real"
  if is_managed_shim "$target" && [[ -e "$real_path" ]]; then
    say "unwrapping executable: $target"
    if [[ "$dry_run" == "1" ]]; then
      return
    fi
    rm -f "$target"
    mv "$real_path" "$target"
  fi
}

IFS=, read -r -a tools <<< "$tools_csv"

if [[ "$uninstall" == "1" ]]; then
  for tool in "${tools[@]}"; do
    [[ -n "$tool" ]] && uninstall_path_shim "$tool"
  done
  for path in "${wrap_paths[@]}"; do
    unwrap_in_place_wrapper "$path"
  done
  exit 0
fi

for tool in "${tools[@]}"; do
  [[ -n "$tool" ]] && write_path_shim "$tool"
done

for path in "${wrap_paths[@]}"; do
  write_in_place_wrapper "$path"
done
