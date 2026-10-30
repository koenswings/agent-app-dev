#!/usr/bin/env bash
# pi-guard.sh: shared host and disk guards for the unattended Pi tests (e2e-pi.sh, capacity.sh). idea#159.
# Source it after E2E_ALLOW is set. Never: kit Engines, wh/'idea', idea01 (golden), idea02.
E2E_ALLOW="${E2E_ALLOW:-}"
DENY_NAMES="happy-zebra sunny-robin kind-panda wh idea idea01 idea02 wizardly-hugle"
# wh/idea, kit Engines + routers (koenswings/idea deployments records), extendable via E2E_DENY_IPS
DENY_IPS="100.115.60.6 100.102.94.100 100.110.73.52 100.96.98.10 100.99.84.61 100.80.238.59 ${E2E_DENY_IPS:-}"
ALLOW_NAMES="idea03 idea04 $E2E_ALLOW"

# ---- guard: deny always wins; allow only by hostname ----
host_of() { local h="${1#*@}"; h="${h%%:*}"; case "$h" in *[a-z]*) echo "${h%%.*}";; *) echo "$h";; esac; }  # pi@idea04.x.ts.net -> idea04
denied() { local x; for x in $DENY_NAMES $DENY_IPS; do [ "$1" = "$x" ] && return 0; done; return 1; }
allowed() { local x; for x in $ALLOW_NAMES; do [ "$1" = "$x" ] && return 0; done; return 1; }
is_ip() { [[ "$1" =~ ^[0-9.]+$ ]]; }
# guard <target> [remote hostname]: a raw IP passes the first (local) check only if not denied; the remote
# hostname must then be allowlisted. Names must be allowlisted directly.
guard() {
  local n; n="$(host_of "$1")"
  denied "$n" && { echo "REFUSED: $1 ($n) is a kit, production, golden or client host"; return 2; }
  if [ -n "${2:-}" ]; then denied "$2" && { echo "REFUSED: $1 is $2 (kit, production, golden or client host)"; return 2; }
    allowed "$2" || { echo "REFUSED: $1 is $2, not on the allowlist ($ALLOW_NAMES)"; return 2; }
    is_ip "$n" || [ "$n" = "$2" ] || { echo "REFUSED: $1 reports hostname $2"; return 2; }; return 0; fi
  is_ip "$n" && return 0
  allowed "$n" || { echo "REFUSED: $1 is not on the allowlist ($ALLOW_NAMES)"; return 2; }
}

# Protected disks, refused BY ID (never by device name): test stick (USB bridge serial, disk serial, the old
# vfat/ext4 UUIDs) and idea03's root SSD. Docked Disk B / any /disks mount is never touched either.
PROTECTED_DISK_IDS="26A1EE83197F 3813430-532011020 3E50-902A 378383c9-0612-4c82-9c07-8c34d15253ba AA202000000000004820 AA000000000000005638 9bgojj2asocyf7gxtci ${E2E_PROTECTED_IDS:-}"
# path_guard_cmd <path>: remote shell snippet that fails unless <path> is under /home/pi or /tmp, is not
# under /disks, and lives on the root filesystem (findmnt -T -> "/"), i.e. not on any docked/protected disk.
path_guard_cmd() {
  printf '%s' "p=$1; case \$p in /disks*|*/../*) echo \"REFUSED: \$p\"; exit 2;; /home/pi/*|/tmp/*) ;; *) echo \"REFUSED: \$p not under /home/pi or /tmp\"; exit 2;; esac; d=\$p; while [ ! -e \$d ]; do d=\$(dirname \$d); done; m=\$(findmnt -n -o TARGET -T \$d); [ \"\$m\" = / ] || [ \"\$m\" = /tmp ] || { echo \"REFUSED: \$p is on \$m\"; exit 2; }"
}
# disk_ids_cmd: remote snippet listing every disk/partition ID (serials + UUIDs) for the before/after check.
disk_ids_cmd() { printf '%s' "lsblk -rno NAME,SERIAL,UUID,MOUNTPOINT | sort"; }
