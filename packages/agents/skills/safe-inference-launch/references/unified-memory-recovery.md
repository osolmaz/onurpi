# Unified-memory inference recovery

Use this runbook when a large local inference launch fails on a machine where the GPU and CPU share memory, such as NVIDIA GB10. Collect evidence before resetting the GPU or rebooting the machine. Driver allocation warnings and process watchdogs can appear during the same launch.

## Evidence collection

Stop stale inference workers, then record the current state:

```bash
free -h
swapon --show
nvidia-smi
ps -eo pid,ppid,stat,etime,rss,cmd --sort=-rss | head -30
sudo fuser -v /dev/nvidia* 2>&1 || true
systemctl is-active earlyoom.service || true
pgrep -a earlyoom || true
```

Match failure timestamps across the server log and the system logs:

```bash
journalctl -k --since '10 minutes ago' --no-pager \
  | grep -E 'NVRM|Out of memory|oom-kill|Killed process'
journalctl -u earlyoom --since '10 minutes ago' --no-pager
```

`nvidia-smi` may report `Not Supported` for memory totals on unified-memory systems. Use `MemAvailable`, free swap, process RSS, the server log, and watchdog logs together.

An `NVRM: ... NV_ERR_NO_MEMORY` line does not prove that the driver killed the launch. Some loaders continue after a failed allocation and retry through another path. A matching `earlyoom` line that sends `SIGTERM` or `SIGKILL` to the inference process group identifies a separate, definitive process kill.

## Loading peaks and `earlyoom`

Quantized model loading can use much more memory temporarily than the running server. Repacking Marlin or ModelOpt weights is one example. A normal workstation `earlyoom` threshold can terminate this temporary peak while tens of GiB remain available.

Keep memory protection active during this phase:

1. Choose guarded-launch floors from the machine budget. A typical large-model floor is 24 GiB of available RAM and 4 GiB of free swap.
2. Start a temporary `earlyoom` process at or below those floors before stopping the normal `earlyoom` service.
3. Confirm the temporary process with `pgrep -a earlyoom`.
4. Stop the normal service only for the bounded loading window.
5. Start the server through `guarded-launch.sh` with the same floors.
6. Restore the normal service and stop the temporary watchdog as soon as readiness succeeds or the launch fails.
7. Confirm that steady-state available memory is above the normal service threshold.

For 24 GiB RAM and 4 GiB swap floors, this temporary watchdog uses KiB values:

```bash
sudo earlyoom \
  -r 1 \
  -M 25165824,20971520 \
  -S 4194304,3145728 \
  -g \
  --prefer '(vllm|gpu_worker|api_server|torchrun|python.*vllm)' \
  --avoid '(systemd|sshd|gnome-shell|Xorg|gdm|codex|herdr)'
```

The first value in each pair is the `SIGTERM` threshold. The second is the `SIGKILL` threshold. Adjust both pairs when the guarded-launch floors differ.

Do not pass `--allow-no-earlyoom` for a large model load. Do not leave the normal service stopped after the loading window. Use a shell trap or another bounded supervisor that restores the service on success, failure, interruption, and timeout.

If the running server remains below the normal safety threshold, stop it and reduce the configuration. Do not weaken a permanent safety policy to keep an unstable server alive without explicit approval.

## Authorized GPU reset

A GPU reset clears driver and hardware state without rebooting the machine. It can close the local graphical session because Xorg, GNOME Shell, and the display manager may hold the GPU. Explain that impact and obtain explicit approval before stopping the GUI or resetting the GPU.

First stop every inference process and container. Inspect device users with `sudo fuser -v /dev/nvidia*`. If the display stack and NVIDIA persistence are the only remaining users, the following pattern restores both services even when reset fails:

```bash
sudo bash -c '
set -Eeuo pipefail
restore() {
  systemctl start nvidia-persistenced.service || true
  systemctl start display-manager.service || true
}
trap restore EXIT

systemctl stop display-manager.service
systemctl stop nvidia-persistenced.service
sleep 5
fuser -v /dev/nvidia* 2>&1 || true
nvidia-smi --gpu-reset -i 0

restore
trap - EXIT
'
```

Change the GPU index when the target is not GPU 0. Do not run the reset while an unapproved process still uses the device. A reset can be unsupported on some hardware or while a primary display cannot release the GPU.

## Post-reset checks

Verify the machine before another model load:

```bash
nvidia-smi
systemctl is-active nvidia-persistenced.service
systemctl is-active display-manager.service
systemctl is-active earlyoom.service
sudo fuser -v /dev/nvidia* 2>&1 || true
free -h
```

Wait for the graphical stack and memory accounting to settle. Run the next inference attempt through the normal staged launch workflow. A successful reset only proves that the reset worked. Recheck the new server and system logs to find the launch outcome.

Request reboot approval only when the reset is unsupported, the driver remains unhealthy, or a clean guarded launch still has a driver-level failure with no process-kill evidence. Preserve benchmark artifacts and restore a known-good fallback endpoint before stopping work when possible.
