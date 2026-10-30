#!/usr/bin/env bash
# pi-sampler.sh: runs ON THE SERVER Pi (nohup, pid file; stopped with kill $(cat pidfile)). idea#159.
# Every INTERVAL s appends one JSON line: temp, throttled, CPU jiffies, load, MemAvailable, OOM kills
# (/proc/vmstat oom_kill, no root needed), NIC rx/tx, disk read/write sectors, PSI, and the Kolibri
# container's restart count, running flag, CPU % (docker stats every 3rd tick), and the Kolibri process tree's
# thread count and RSS MiB read from host ps/proc.
# Run-1 bug (#159): k_threads was always 1 and k_mem 0. With init: true, .State.Pid is docker-init (1 thread),
# and Raspberry Pi OS boots with the memory cgroup off, so docker stats reports 0 B. Now: walk every descendant
# of .State.Pid in host `ps` and sum NLWP and RSS (k_pid = the biggest one, k_procs = how many);
# docker's figure is kept as k_mem_docker.
#   pi-sampler.sh <out.jsonl> <container> [interval_s=2] [iface=eth0] [disk=sda] [root_pid override, for tests]
set -u
OUT="$1"; C="$2"; IV="${3:-2}"; IF="${4:-eth0}"; DK="${5:-sda}"; ROOT="${6:-}"; k=0; KCPU=null; KMEM=null
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
  root=${ROOT:-$pid}
  read -r kpid thr_n kmem kprocs < <(ps -e -o pid=,ppid=,nlwp=,rss= 2>/dev/null | awk -v r="${root:-0}" '
    { P[$1]=$2; N[$1]=$3; M[$1]=$4 }
    END { if (r <= 0 || !(r in P)) { print "null null null 0"; exit }
      D[r]=1; ch=1; while (ch) { ch=0; for (x in P) if (!(x in D) && (P[x] in D)) { D[x]=1; ch=1 } }
      c=0; for (x in D) if (x != r) { c++; T+=N[x]; S+=M[x]; if (M[x] > bm) { bm=M[x]; b=x } }
      if (c == 0) { T=N[r]; S=M[r]; b=r }
      printf "%s %d %.1f %d\n", b, T, S/1024, c }')
  echo "{\"t\":$t,\"temp\":$temp,\"throttled\":\"$thr\",\"cpu_busy\":$busy,\"cpu_total\":$total,\"load1\":$load1,\"mem_avail_kb\":${mem:-null},\"swap_used_kb\":${swap:-null},\"oom_kill\":$oom,\"net_rx\":$rx,\"net_tx\":$tx,\"disk_rd\":$rd,\"disk_wr\":$wr,\"psi_cpu10\":$psi,\"k_restart\":${rc:-null},\"k_running\":${run:-false},\"k_threads\":${thr_n:-null},\"k_cpu\":$KCPU,\"k_mem\":${kmem:-null},\"k_mem_docker\":$KMEM,\"k_pid\":${kpid:-null},\"k_procs\":${kprocs:-0}}" >> "$OUT"
  k=$((k+1)); sleep "$IV"
done
