#!/usr/bin/env python3
"""idea#413 client-address probes (published-port REMOTE_ADDR / X-Forwarded-For).

Never prints credentials, tokens, passwords, or raw config.php.
Safe to run on a claimed pool Pi against scratch Nextcloud/Kiwix instances.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import socket
import subprocess
import sys
from pathlib import Path
from typing import Any

XFF_PROBE = "203.0.113.50"
PROBE_PHP_NAME = "i413/status.php"
PROBE_PHP = """<?php
header('Content-Type: application/json');
header('Cache-Control: no-store');
$keys = array(
    'REMOTE_ADDR', 'HTTP_X_FORWARDED_FOR', 'HTTP_X_REAL_IP',
    'SERVER_ADDR', 'SERVER_PORT', 'HTTP_USER_AGENT', 'REQUEST_URI',
);
$out = array();
foreach ($keys as $k) { $out[$k] = isset($_SERVER[$k]) ? $_SERVER[$k] : null; }
echo json_encode($out, JSON_UNESCAPED_SLASHES);
"""

FORBIDDEN_VALUE_SUBSTR = ("911!", "password", "secret", "token=", "OC_PASS")
ADDR_COL_RE = re.compile(r"addr|ip|client|remote", re.I)
TOKEN_COL_RE = re.compile(r"token|password|secret|passwd", re.I)
IP_RE = re.compile(
    r"\b(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\b"
)


def die(msg: str) -> None:
    print(f"ERROR: {msg}", file=sys.stderr)
    sys.exit(1)


def log(msg: str) -> None:
    lower = msg.lower()
    for bad in FORBIDDEN_VALUE_SUBSTR:
        if bad.lower() in lower:
            die("refusing to print a line that looks like it contains a secret")
    print(f"==> {msg}", file=sys.stderr)


def run(argv: list[str], cwd: Path | None = None, input_text: str | None = None,
        timeout: int = 60) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        argv, cwd=str(cwd) if cwd else None, input=input_text,
        stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, timeout=timeout,
    )


def compose_exec(inst: Path, service: str, argv: list[str],
                 input_text: str | None = None, timeout: int = 60) -> subprocess.CompletedProcess[str]:
    return run(["docker", "compose", "exec", "-T", service, *argv],
               cwd=inst, input_text=input_text, timeout=timeout)


def write_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def host_ips() -> dict[str, Any]:
    proc = run(["ip", "-4", "-o", "addr", "show"])
    ifaces: list[dict[str, str]] = []
    lan: list[str] = []
    tailscale: list[str] = []
    docker_gws: list[str] = []
    for line in (proc.stdout or "").splitlines():
        parts = line.split()
        if len(parts) < 4:
            continue
        name, cidr = parts[1], parts[3]
        ip = cidr.split("/")[0]
        ifaces.append({"if": name, "cidr": cidr, "ip": ip})
        if name == "lo":
            continue
        if name == "tailscale0" or ip.startswith("100."):
            # Tailscale CGNAT 100.64/10; idea03 uses 100.126.117.80.
            if name == "tailscale0" or _in_net(ip, "100.64.0.0/10"):
                tailscale.append(ip)
                continue
        if name in ("docker0",) or name.startswith("br-"):
            docker_gws.append(ip)
            continue
        if name.startswith(("eth", "en", "wl")):
            lan.append(ip)
    return {
        "interfaces": ifaces,
        "lan_ips": lan,
        "tailscale_ips": tailscale,
        "docker_gateways": docker_gws,
    }


def _ip_int(ip: str) -> int:
    a, b, c, d = (int(x) for x in ip.split("."))
    return (a << 24) | (b << 16) | (c << 8) | d


def _in_net(ip: str, cidr: str) -> bool:
    net, bits = cidr.split("/")
    mask = (0xFFFFFFFF << (32 - int(bits))) & 0xFFFFFFFF
    return (_ip_int(ip) & mask) == (_ip_int(net) & mask)


def classify(ip: str | None, ctx: dict[str, Any]) -> str:
    if not ip:
        return "missing"
    if ip == XFF_PROBE:
        return "xff_probe_203.0.113.50"
    if ip in ("127.0.0.1", "::1"):
        return "loopback"
    if ip in (ctx.get("lan_ips") or []):
        return "idea03_lan"
    if ip in (ctx.get("tailscale_ips") or []):
        return "idea03_tailscale"
    if ip in (ctx.get("docker_gateways") or []):
        return "docker_bridge_gateway"
    if _in_net(ip, "100.64.0.0/10"):
        return "tailscale_cgnat"
    if _in_net(ip, "172.16.0.0/12") or _in_net(ip, "192.168.0.0/16") or _in_net(ip, "10.0.0.0/8"):
        # Private, but not idea03's eth0 LAN and not listed as a docker gw:
        # still almost certainly a docker/container net if it's 172.16/12.
        if _in_net(ip, "172.16.0.0/12"):
            return "docker_or_rfc1918_172"
        return "other_private"
    return "other"


def cmd_host_info(args: argparse.Namespace) -> None:
    info = {
        "hostname": socket.gethostname(),
        **host_ips(),
    }
    route = run(["ip", "-4", "route", "get", "192.168.0.228"])
    info["route_get_lan"] = (route.stdout or "").strip()
    ts = (info.get("tailscale_ips") or ["100.126.117.80"])[0]
    route2 = run(["ip", "-4", "route", "get", ts])
    info["route_get_tailscale"] = (route2.stdout or "").strip()
    write_json(Path(args.out), info)
    print(json.dumps({k: info[k] for k in ("hostname", "lan_ips", "tailscale_ips", "docker_gateways")}, indent=2))


def cmd_docker_proxy_info(args: argparse.Namespace) -> None:
    daemon_paths = [
        Path("/etc/docker/daemon.json"),
        Path("/etc/docker/daemon.json.d"),
    ]
    daemon: dict[str, Any] = {"files": []}
    for p in daemon_paths:
        if p.is_file():
            try:
                text = p.read_text(encoding="utf-8")
                parsed = json.loads(text)
                keys = sorted(parsed.keys()) if isinstance(parsed, dict) else []
                ulp = parsed.get("userland-proxy") if isinstance(parsed, dict) else None
                daemon["files"].append({
                    "path": str(p),
                    "keys": keys,
                    "userland-proxy": ulp,
                    "userland-proxy-present": isinstance(parsed, dict) and "userland-proxy" in parsed,
                })
            except Exception as e:
                daemon["files"].append({"path": str(p), "error": type(e).__name__})
        elif p.is_dir():
            daemon["files"].append({"path": str(p), "entries": sorted(x.name for x in p.iterdir())})
        else:
            daemon["files"].append({"path": str(p), "exists": False})

    # Default is true when the key is absent.
    present = [f for f in daemon["files"] if f.get("userland-proxy-present")]
    if present:
        daemon["effective_userland_proxy"] = present[0].get("userland-proxy")
        daemon["effective_source"] = present[0]["path"]
    else:
        daemon["effective_userland_proxy"] = True
        daemon["effective_source"] = "docker default (key absent from daemon.json)"

    # Do not use pgrep -f. ps -C matches the process name exactly.
    ps = run(["ps", "-C", "docker-proxy", "-o", "pid=,user=,args="])
    procs = []
    for line in (ps.stdout or "").splitlines():
        line = line.strip()
        if not line:
            continue
        procs.append(line)
    daemon["docker_proxy_process_count"] = len(procs)
    daemon["docker_proxy_processes"] = procs
    daemon["docker_proxy_running"] = len(procs) > 0

    write_json(Path(args.out), daemon)
    print(json.dumps({
        "effective_userland_proxy": daemon["effective_userland_proxy"],
        "effective_source": daemon["effective_source"],
        "docker_proxy_process_count": daemon["docker_proxy_process_count"],
    }, indent=2))


def cmd_prepare_nextcloud(args: argparse.Namespace) -> None:
    inst = Path(args.dir)
    if not (inst / "compose.yaml").is_file() and not (inst / "compose.yml").is_file():
        die(f"no compose file in {inst}")
    proc = compose_exec(
        inst, "nextcloud-app",
        ["sh", "-c", "mkdir -p /var/www/html/i413 && cat > /var/www/html/i413/status.php"],
        input_text=PROBE_PHP, timeout=30,
    )
    if proc.returncode != 0:
        die(f"failed to write probe PHP ({proc.returncode}) stderr_len={len(proc.stderr or '')}")

    cfg_php = r"""
<?php
require "/var/www/html/config/config.php";
$want = array("trusted_proxies", "forwarded_for_headers", "trusted_domains",
              "overwritecondaddr", "overwritehost", "overwriteprotocol");
$out = array();
foreach ($want as $k) { $out[$k] = array_key_exists($k, $CONFIG) ? $CONFIG[$k] : null; }
$out["has_trusted_proxies_key"] = array_key_exists("trusted_proxies", $CONFIG);
$out["has_forwarded_for_headers_key"] = array_key_exists("forwarded_for_headers", $CONFIG);
echo json_encode($out, JSON_UNESCAPED_SLASHES);
"""
    cfg = compose_exec(inst, "nextcloud-app",
                       ["php", "-d", "display_errors=0", "--"],
                       input_text=cfg_php, timeout=30)
    if cfg.returncode != 0:
        die("failed to read trusted_proxies from config.php (secrets not printed)")
    try:
        config = json.loads(cfg.stdout or "{}")
    except json.JSONDecodeError:
        die("config.php reader did not return JSON")

    schema_php = r"""
<?php
require "/var/www/html/config/config.php";
$dbtype = $CONFIG["dbtype"] ?? "mysql";
$prefix = $CONFIG["dbtableprefix"] ?? "oc_";
try {
    if ($dbtype === "sqlite" || $dbtype === "sqlite3") {
        $pdo = new PDO("sqlite:" . $CONFIG["dbname"]);
    } else {
        $pdo = new PDO("mysql:host=".$CONFIG["dbhost"].";dbname=".$CONFIG["dbname"], $CONFIG["dbuser"], $CONFIG["dbpassword"]);
    }
    $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
    $tables = array();
    if ($dbtype === "sqlite" || $dbtype === "sqlite3") {
        foreach ($pdo->query("SELECT name FROM sqlite_master WHERE type='table'") as $row) $tables[] = $row[0];
    } else {
        foreach ($pdo->query("SHOW TABLES") as $row) $tables[] = $row[0];
    }
    $addr_cols = array();
    $wopi = array("table" => $prefix . "richdocuments_wopi", "present" => false, "columns" => array(), "rows" => 0, "address_columns" => array());
    foreach ($tables as $t) {
        $cols = array();
        if ($dbtype === "sqlite" || $dbtype === "sqlite3") {
            foreach ($pdo->query("PRAGMA table_info($t)") as $row) $cols[] = $row["name"];
        } else {
            foreach ($pdo->query("SHOW COLUMNS FROM `{$t}`") as $row) $cols[] = $row["Field"];
        }
        $hits = array();
        foreach ($cols as $c) {
            if (preg_match('/addr|ip|client|remote/i', $c)) $hits[] = $c;
        }
        if ($hits) $addr_cols[] = array("table" => $t, "columns" => $hits);
        if ($t === $prefix . "richdocuments_wopi") {
            $wopi["present"] = true;
            $wopi["columns"] = $cols;
            $wopi["address_columns"] = $hits;
            $wopi["rows"] = intval($pdo->query("SELECT COUNT(*) FROM `{$t}`")->fetchColumn());
        }
    }
    echo json_encode(array("address_like_columns" => $addr_cols, "wopi" => $wopi), JSON_UNESCAPED_SLASHES);
} catch (Exception $e) {
    fwrite(STDERR, "db-error\n");
    exit(3);
}
"""
    sch = compose_exec(inst, "nextcloud-app",
                       ["php", "-d", "display_errors=0", "--"],
                       input_text=schema_php, timeout=60)
    if sch.returncode != 0:
        die("failed to inspect Nextcloud schema for address columns")
    try:
        schema = json.loads(sch.stdout or "{}")
    except json.JSONDecodeError:
        die("schema reader did not return JSON")

    logloc = compose_exec(
        inst, "nextcloud-app",
        ["sh", "-c",
         "echo '--- apache CustomLog ---'; "
         "grep -R --include='*.conf' -E 'CustomLog|ErrorLog' /etc/apache2 2>/dev/null | head -n 40; "
         "echo '--- log files ---'; "
         "for f in /var/log/apache2/access.log /var/log/apache2/other_vhosts_access.log "
         "/var/log/apache2/access.log.1 /var/log/nginx/access.log /var/www/html/data/nextcloud.log; "
         "do if [ -f \"$f\" ]; then echo FILE:$f size=$(wc -c < \"$f\"); fi; done"],
        timeout=30,
    )

    out = {
        "probe_php": f"/{PROBE_PHP_NAME}",
        "config": config,
        "schema": schema,
        "log_locations_stdout": logloc.stdout or "",
    }
    write_json(Path(args.out), out)
    print(json.dumps({
        "probe_php": out["probe_php"],
        "trusted_proxies": config.get("trusted_proxies"),
        "forwarded_for_headers": config.get("forwarded_for_headers"),
        "has_trusted_proxies_key": config.get("has_trusted_proxies_key"),
        "has_forwarded_for_headers_key": config.get("has_forwarded_for_headers_key"),
        "wopi": schema.get("wopi"),
        "address_like_table_count": len((schema.get("address_like_columns") or [])),
    }, indent=2))


def cmd_prepare_kiwix(args: argparse.Namespace) -> None:
    inst = Path(args.dir)
    nginx = inst / "proxy" / "nginx.conf"
    text = nginx.read_text(encoding="utf-8", errors="replace") if nginx.is_file() else ""
    info = {
        "nginx_conf_exists": nginx.is_file(),
        "logs_remote_addr": '$remote_addr' in text and '"addr":"$remote_addr"' in text,
        "has_real_ip_header": "real_ip_header" in text,
        "has_set_real_ip_from": "set_real_ip_from" in text,
        "sets_x_real_ip_from_remote_addr": "X-Real-IP $remote_addr" in text or "X-Real-IP $remote_addr" in text,
        "sets_x_forwarded_for": "X-Forwarded-For" in text,
        "access_log_format_line": next((ln.strip() for ln in text.splitlines() if "log_format usage_json" in ln or '"addr":' in ln), ""),
    }
    write_json(Path(args.out), info)
    print(json.dumps(info, indent=2))


def _docker_logs(inst: Path, service: str, since: str | None = None) -> str:
    argv = ["docker", "compose", "logs", "--no-color"]
    if since:
        argv.extend(["--since", since])
    argv.append(service)
    proc = run(argv, cwd=inst, timeout=60)
    return proc.stdout or ""


def _grep_ua(blob: str, ua: str) -> list[str]:
    hits = []
    for line in blob.splitlines():
        if ua in line:
            hits.append(line)
    return hits


def cmd_collect_nextcloud(args: argparse.Namespace) -> None:
    inst = Path(args.dir)
    ua = args.ua
    logs = {}
    # docker logs
    dlog = _docker_logs(inst, "nextcloud-app")
    logs["docker_logs_matching_ua"] = _grep_ua(dlog, ua)
    # files inside the container
    inner = compose_exec(
        inst, "nextcloud-app",
        ["sh", "-c",
         f"for f in /var/log/apache2/access.log /var/log/apache2/other_vhosts_access.log "
         f"/var/log/nginx/access.log /var/www/html/data/nextcloud.log; do "
         f"[ -f \"$f\" ] || continue; echo FILE:$f; grep -F {json.dumps(ua)} \"$f\" | tail -n 5; done"],
        timeout=30,
    )
    logs["inner_files_raw"] = inner.stdout or ""
    # Parse nextcloud.log remoteAddr if the UA or our probe path appears
    nc_log = compose_exec(
        inst, "nextcloud-app",
        ["sh", "-c",
         "if [ -f /var/www/html/data/nextcloud.log ]; then tail -n 80 /var/www/html/data/nextcloud.log; fi"],
        timeout=30,
    )
    remote_addrs = []
    for line in (nc_log.stdout or "").splitlines():
        try:
            obj = json.loads(line)
        except json.JSONDecodeError:
            continue
        # Never print the full log object (could contain user names on other events).
        ra = None
        if isinstance(obj, dict):
            ra = obj.get("remoteAddr") or (obj.get("extra") or {}).get("remoteAddr")
        if ra:
            remote_addrs.append(ra)
    logs["nextcloud_log_recent_remoteAddr"] = remote_addrs[-10:]
    logs["nextcloud_log_recent_remoteAddr_unique"] = sorted(set(remote_addrs[-40:]))

    # Extract first IPv4 from matching apache/docker lines
    seen_ips = []
    for line in logs["docker_logs_matching_ua"] + (logs["inner_files_raw"] or "").splitlines():
        if ua not in line:
            continue
        found = IP_RE.findall(line)
        if found:
            seen_ips.append(found[0])
    logs["first_ip_on_matching_log_lines"] = seen_ips
    write_json(Path(args.out), logs)
    print(json.dumps({
        "ua": ua,
        "docker_log_hits": len(logs["docker_logs_matching_ua"]),
        "first_ip_on_matching_log_lines": seen_ips,
        "nextcloud_log_recent_remoteAddr_unique": logs["nextcloud_log_recent_remoteAddr_unique"],
    }, indent=2))


def cmd_collect_kiwix(args: argparse.Namespace) -> None:
    inst = Path(args.dir)
    marker = args.marker
    day = args.day
    # Read via compose exec so we don't depend on host-side write perms.
    proc = compose_exec(
        inst, "proxy",
        ["sh", "-c", f"if [ -f /logs/access-{day}.json ]; then cat /logs/access-{day}.json; fi"],
        timeout=30,
    )
    hits = []
    for line in (proc.stdout or "").splitlines():
        if marker not in line:
            continue
        try:
            obj = json.loads(line)
        except json.JSONDecodeError:
            hits.append({"raw_has_marker": True, "parse_error": True})
            continue
        hits.append({
            "time": obj.get("time"),
            "addr": obj.get("addr"),
            "method": obj.get("method"),
            "uri": obj.get("uri"),
            "status": obj.get("status"),
        })
    out = {"marker": marker, "day": day, "hits": hits}
    write_json(Path(args.out), out)
    print(json.dumps(out, indent=2))


def cmd_inspect_container_net(args: argparse.Namespace) -> None:
    inst = Path(args.dir)
    service = args.service
    cid_p = run(["docker", "compose", "ps", "-q", service], cwd=inst)
    cid = (cid_p.stdout or "").strip().splitlines()
    if not cid:
        die(f"no container for service {service}")
    info_p = run([
        "docker", "inspect",
        "--format",
        "{{json .NetworkSettings}}",
        cid[0],
    ])
    try:
        ns = json.loads(info_p.stdout or "{}")
    except json.JSONDecodeError:
        die("docker inspect did not return JSON")
    nets = []
    for name, n in (ns.get("Networks") or {}).items():
        nets.append({
            "name": name,
            "ip": n.get("IPAddress"),
            "gateway": n.get("Gateway"),
            "mac": n.get("MacAddress"),
        })
    ports = ns.get("Ports") or {}
    out = {"service": service, "networks": nets, "ports": ports}
    write_json(Path(args.out), out)
    print(json.dumps(out, indent=2))


def cmd_analyze(args: argparse.Namespace) -> None:
    root = Path(args.dir)
    ctx = json.loads((root / "host-info.json").read_text(encoding="utf-8"))
    docker = json.loads((root / "docker-proxy.json").read_text(encoding="utf-8"))
    requests = json.loads((root / "requests.json").read_text(encoding="utf-8"))
    rows = []
    for req in requests:
        logged = req.get("logged") or {}
        php = req.get("php") or {}
        src = req.get("source_ip")
        row = {
            "id": req.get("id"),
            "app": req.get("app"),
            "target": req.get("target"),
            "via": req.get("via"),
            "source_ip": src,
            "source_class": classify(src, ctx),
            "xff_sent": req.get("xff_sent"),
            "http_status": req.get("http_status"),
            "php_REMOTE_ADDR": php.get("REMOTE_ADDR"),
            "php_REMOTE_ADDR_class": classify(php.get("REMOTE_ADDR"), ctx),
            "php_XFF": php.get("HTTP_X_FORWARDED_FOR"),
            "php_X_REAL_IP": php.get("HTTP_X_REAL_IP"),
            "apache_or_docker_log_ips": logged.get("first_ip_on_matching_log_lines"),
            "kiwix_addrs": [h.get("addr") for h in (logged.get("hits") or [])],
        }
        if row["app"] == "nextcloud":
            seen = row["php_REMOTE_ADDR"]
        else:
            addrs = row["kiwix_addrs"]
            seen = addrs[-1] if addrs else None
        row["seen_by_app"] = seen
        row["seen_class"] = classify(seen, ctx)
        row["same_as_source"] = bool(seen and src and seen == src)
        row["same_as_xff"] = bool(seen and req.get("xff_sent") and seen == req.get("xff_sent"))
        rows.append(row)
    report = {
        "host": {"lan_ips": ctx.get("lan_ips"), "tailscale_ips": ctx.get("tailscale_ips"),
                 "docker_gateways": ctx.get("docker_gateways")},
        "userland_proxy": {
            "effective": docker.get("effective_userland_proxy"),
            "source": docker.get("effective_source"),
            "docker_proxy_process_count": docker.get("docker_proxy_process_count"),
            "docker_proxy_running": docker.get("docker_proxy_running"),
        },
        "rows": rows,
    }
    write_json(root / "analysis.json", report)
    print(json.dumps(report, indent=2))


def main() -> None:
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("host-info")
    p.add_argument("--out", required=True)
    p.set_defaults(func=cmd_host_info)
    p = sub.add_parser("docker-proxy-info")
    p.add_argument("--out", required=True)
    p.set_defaults(func=cmd_docker_proxy_info)
    p = sub.add_parser("prepare-nextcloud")
    p.add_argument("--dir", required=True)
    p.add_argument("--out", required=True)
    p.set_defaults(func=cmd_prepare_nextcloud)
    p = sub.add_parser("prepare-kiwix")
    p.add_argument("--dir", required=True)
    p.add_argument("--out", required=True)
    p.set_defaults(func=cmd_prepare_kiwix)
    p = sub.add_parser("collect-nextcloud")
    p.add_argument("--dir", required=True)
    p.add_argument("--ua", required=True)
    p.add_argument("--out", required=True)
    p.set_defaults(func=cmd_collect_nextcloud)
    p = sub.add_parser("collect-kiwix")
    p.add_argument("--dir", required=True)
    p.add_argument("--marker", required=True)
    p.add_argument("--day", required=True)
    p.add_argument("--out", required=True)
    p.set_defaults(func=cmd_collect_kiwix)
    p = sub.add_parser("inspect-net")
    p.add_argument("--dir", required=True)
    p.add_argument("--service", required=True)
    p.add_argument("--out", required=True)
    p.set_defaults(func=cmd_inspect_container_net)
    p = sub.add_parser("analyze")
    p.add_argument("--dir", required=True)
    p.set_defaults(func=cmd_analyze)
    args = ap.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
