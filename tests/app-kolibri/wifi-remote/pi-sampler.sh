#!/usr/bin/env bash
# pi-sampler.sh: runs ON THE SERVER Pi (nohup, pid file; stopped with kill $(cat pidfile)). idea#159.
# Every INTERVAL s appends one JSON line: temp, throttled, CPU jiffies, load, MemAvailable, OOM kills
# (/proc/vmstat oom_kill, no root needed), NIC rx/tx, disk read/write sectors, PSI, and the Kolibri
# container's restart count, running flag, CPU %, memory MiB and thread count (docker stats every 3rd tick).
#   pi-sampler.sh <out.jsonl> <container> [interval_s=2] [iface=eth0] [disk=sda]
set -u
OUT="$1"; C="$2"; IV="${3:-2}"; IF="${4:-eth0}"; DK="${5:-sda}"; k=0; KCPU=null; KMEM=null
while true; do
  t=$(date +%s%3N)
  temp=$(awk '{printf "%.1f", $1/1000}' /sys/class/thermal/thermal_zone0/temp 2>/dev/null || echo null)
  thr=$(vcgencmd get_throttled 2>/dev/null | sed 's/.*=//'); thr=${thr:-unknown}
  read -r _ u n s i w q sq st _ < /proc/stat; busy=$((u+n+s+q+sq+st)); total=$((busy+i+w))
  load1=$(cut -d' ' -f1 /proc/loadavg)
  mem=$(awk '/^MemAvailable:/{print $2}' /proc/meminfo); swap=$(awk '/^SwapFree:/{f=$2} /^SwapTotal:/{t=$2} END{print t-f}' /proc/meminfo)
  oom=$(awk '/^oom_kill /{print $2}' /proc/vmstat); oom=${oom:-null}
  read -r rx tx < <(awk -v i="$IF:" '$1==i{print $2, $10}' /proc/net/dev); rx=${rx:-null}; tx=${tx:-null}
  read -r rd wr < <(awk -v d="$DK" '$3==d{print $6, $10}' /proc/diskstats); rd=${rd:-null}; wr=${wr:-null}
  psi=$(awk '/^some/{sub("avg10=","",$2); print $2; exit}' /proc/pressure/cpu 2>/dev/null); psi=${psi:-null}
  read -r rc run pid < <(docker inspect -f '{{.RestartCount}} {{.State.Running}} {{.State.Pid}}' "$C" 2>/dev/null || echo "null false 0")
  thr_n=null; [ "${pid:-0}" -gt 0 ] 2>/dev/null && thr_n=$(awk '/^Threads:/{print $2}' /proc/$pid/status 2>/dev/null); thr_n=${thr_n:-null}
  if [ $((k % 3)) -eq 0 ]; then
    read -r KCPU KMEM < <(docker stats --no-stream --format '{{.CPUPerc}} {{.MemUsage}}' "$C" 2>/dev/null | awk '{gsub("%","",$1); m=$2; v=m+0; if (m ~ /GiB/) v*=1024; if (m ~ /KiB/) v/=1024; print $1, v}')
    KCPU=${KCPU:-null}; KMEM=${KMEM:-null}
  fi
  echo "{\"t\":$t,\"temp\":$temp,\"throttled\":\"$thr\",\"cpu_busy\":$busy,\"cpu_total\":$total,\"load1\":$load1,\"mem_avail_kb\":${mem:-null},\"swap_used_kb\":${swap:-null},\"oom_kill\":$oom,\"net_rx\":$rx,\"net_tx\":$tx,\"disk_rd\":$rd,\"disk_wr\":$wr,\"psi_cpu10\":$psi,\"k_restart\":${rc:-null},\"k_running\":${run:-false},\"k_threads\":$thr_n,\"k_cpu\":$KCPU,\"k_mem\":$KMEM}" >> "$OUT"
  k=$((k+1)); sleep "$IV"
done
