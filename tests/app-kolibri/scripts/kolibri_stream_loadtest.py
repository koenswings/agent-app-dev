#!/usr/bin/env python3
"""
Kolibri concurrent video stream load test (idea#159).

Simulates N students watching the same MP4 at roughly the video bitrate
via HTTP Range requests against Kolibri's /content/storage/… path
(Cheroot + DynamicWhiteNoise — the real classroom stream path).

Usage:
  python3 kolibri_stream_loadtest.py --url URL --n 8 --duration 90 \\
      --bitrate-bps 902541 --out-dir /path/to/logs --tag samehost-n8
"""
from __future__ import annotations

import argparse
import json
import os
import statistics
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import List, Optional


@dataclass
class ClientResult:
    client_id: int
    bytes_received: int = 0
    elapsed_s: float = 0.0
    errors: int = 0
    last_error: str = ""
    http_codes: List[int] = field(default_factory=list)
    chunk_count: int = 0

    @property
    def bytes_per_sec(self) -> float:
        return self.bytes_received / self.elapsed_s if self.elapsed_s > 0 else 0.0


def sample_host_metrics() -> dict:
    """Best-effort host metrics (Linux)."""
    out = {"ts": time.time()}
    try:
        with open("/proc/loadavg") as f:
            parts = f.read().split()
            out["loadavg_1"] = float(parts[0])
            out["loadavg_5"] = float(parts[1])
            out["loadavg_15"] = float(parts[2])
    except Exception as e:
        out["loadavg_error"] = str(e)
    try:
        mem = {}
        with open("/proc/meminfo") as f:
            for line in f:
                k, v = line.split(":")
                mem[k] = int(v.strip().split()[0])  # kB
        out["mem_total_kb"] = mem.get("MemTotal")
        out["mem_available_kb"] = mem.get("MemAvailable")
        out["mem_free_kb"] = mem.get("MemFree")
        out["swap_free_kb"] = mem.get("SwapFree")
    except Exception as e:
        out["mem_error"] = str(e)
    return out


def sample_docker_stats(container: str) -> dict:
    if not container:
        return {}
    out = {}
    try:
        raw = subprocess.check_output(
            [
                "docker",
                "stats",
                "--no-stream",
                "--format",
                "{{.CPUPerc}}\t{{.MemUsage}}\t{{.MemPerc}}\t{{.NetIO}}",
                container,
            ],
            text=True,
            timeout=10,
        ).strip()
        cpu, mem_usage, mem_perc, net_io = raw.split("\t")
        out.update({
            "cpu_perc": cpu.strip(),
            "mem_usage": mem_usage.strip(),
            "mem_perc": mem_perc.strip(),
            "net_io": net_io.strip(),
        })
    except Exception as e:
        out["error"] = str(e)
    # Host-network containers often report 0B mem; fall back to process RSS
    try:
        # Match kolibri python process (host network: docker stats mem often 0B)
        ps = subprocess.check_output(
            ["ps", "-eo", "rss=,args="],
            text=True,
            timeout=5,
        )
        rss_kb = 0
        for line in ps.splitlines():
            line = line.strip()
            if "kolibri" not in line.lower():
                continue
            parts = line.split(None, 1)
            if parts and parts[0].isdigit():
                rss_kb += int(parts[0])
        out["kolibri_rss_kb"] = rss_kb
    except Exception as e:
        out["kolibri_rss_error"] = str(e)
    return out


def fetch_size(url: str, timeout: float = 30.0) -> int:
    req = urllib.request.Request(url, method="HEAD")
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        cl = resp.headers.get("Content-Length")
        if cl:
            return int(cl)
    # fallback GET first byte
    req = urllib.request.Request(url, headers={"Range": "bytes=0-0"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        cr = resp.headers.get("Content-Range", "")
        # bytes 0-0/TOTAL
        if "/" in cr:
            return int(cr.split("/")[-1])
    raise RuntimeError("could not determine content length")


def client_worker(
    client_id: int,
    url: str,
    file_size: int,
    duration_s: float,
    target_bps: float,
    chunk_bytes: int,
    results: List[ClientResult],
    stop_event: threading.Event,
) -> None:
    """
    Read the video in a looping Range-chunk fashion at ~target_bps for duration_s.
    Uses sequential Ranges wrapping at EOF (simulates continuous playback/rebuffer).
    """
    res = ClientResult(client_id=client_id)
    results[client_id] = res
    # Stagger start slightly to avoid thundering herd
    time.sleep(min(0.05 * client_id, 2.0))
    target_Bps = target_bps / 8.0
    offset = (client_id * chunk_bytes * 7) % max(file_size - chunk_bytes, 1)
    t0 = time.monotonic()
    deadline = t0 + duration_s

    while not stop_event.is_set() and time.monotonic() < deadline:
        end = min(offset + chunk_bytes - 1, file_size - 1)
        if offset >= file_size:
            offset = 0
            end = min(chunk_bytes - 1, file_size - 1)
        headers = {"Range": f"bytes={offset}-{end}", "User-Agent": f"i159-loadtest/{client_id}"}
        chunk_t0 = time.monotonic()
        try:
            req = urllib.request.Request(url, headers=headers)
            with urllib.request.urlopen(req, timeout=30) as resp:
                code = resp.getcode()
                res.http_codes.append(code)
                data = resp.read()
                got = len(data)
                res.bytes_received += got
                res.chunk_count += 1
                if code not in (200, 206):
                    res.errors += 1
                    res.last_error = f"HTTP {code}"
        except Exception as e:
            res.errors += 1
            res.last_error = str(e)[:200]
            time.sleep(0.5)
            continue

        offset = end + 1
        # Pace to target bitrate
        expected = got / target_Bps if target_Bps > 0 else 0
        elapsed_chunk = time.monotonic() - chunk_t0
        sleep_for = expected - elapsed_chunk
        if sleep_for > 0:
            # wake early if stopping
            stop_event.wait(timeout=sleep_for)

    res.elapsed_s = time.monotonic() - t0


def run_one(
    url: str,
    n: int,
    duration: float,
    bitrate_bps: float,
    chunk_bytes: int,
    container: str,
    sample_interval: float,
) -> dict:
    file_size = fetch_size(url)
    results: List[Optional[ClientResult]] = [None] * n  # type: ignore
    stop_event = threading.Event()
    threads = []
    metrics_timeline = []

    def sampler():
        while not stop_event.is_set():
            m = sample_host_metrics()
            m["docker"] = sample_docker_stats(container)
            metrics_timeline.append(m)
            stop_event.wait(timeout=sample_interval)

    sampler_t = threading.Thread(target=sampler, daemon=True)
    sampler_t.start()

    t_wall0 = time.time()
    for i in range(n):
        t = threading.Thread(
            target=client_worker,
            args=(i, url, file_size, duration, bitrate_bps, chunk_bytes, results, stop_event),
            daemon=True,
        )
        threads.append(t)
        t.start()

    for t in threads:
        t.join()
    stop_event.set()
    sampler_t.join(timeout=5)
    t_wall1 = time.time()

    # Finalize any None (shouldn't happen)
    clients = [r for r in results if r is not None]
    if bitrate_bps <= 0:
        # Unpaced: success = no errors and mean rate > 50 KB/s (got real data)
        target_Bps = 0.0
        usable_threshold = 50_000.0
    else:
        target_Bps = bitrate_bps / 8.0
        # Usable = achieved average >= 85% of target over the run
        usable_threshold = 0.85 * target_Bps
    usable = [c for c in clients if c.bytes_per_sec >= usable_threshold and c.errors == 0]
    # Soft-fail: slow but no hard errors
    slow = [
        c
        for c in clients
        if c.bytes_per_sec < usable_threshold and c.errors == 0
    ]
    hard_fail = [c for c in clients if c.errors > 0]

    bps_list = [c.bytes_per_sec for c in clients]
    summary = {
        "n": n,
        "url": url,
        "file_size": file_size,
        "duration_requested_s": duration,
        "wall_s": t_wall1 - t_wall0,
        "bitrate_bps": bitrate_bps,
        "target_Bps": target_Bps,
        "usable_threshold_Bps": usable_threshold,
        "clients_total": len(clients),
        "clients_usable": len(usable),
        "clients_slow": len(slow),
        "clients_hard_fail": len(hard_fail),
        "success_rate": (len(usable) / len(clients)) if clients else 0.0,
        "bps_mean": statistics.mean(bps_list) if bps_list else 0,
        "bps_p50": statistics.median(bps_list) if bps_list else 0,
        "bps_min": min(bps_list) if bps_list else 0,
        "bps_max": max(bps_list) if bps_list else 0,
        "total_bytes": sum(c.bytes_received for c in clients),
        "total_errors": sum(c.errors for c in clients),
        "metrics_timeline": metrics_timeline,
        "clients": [asdict(c) for c in clients],
    }
    return summary


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", required=True)
    ap.add_argument("--n", type=int, required=True)
    ap.add_argument("--duration", type=float, default=90.0)
    ap.add_argument("--bitrate-bps", type=float, default=902541.0)
    ap.add_argument("--chunk-bytes", type=int, default=256 * 1024)
    ap.add_argument("--container", default="i159-kolibri")
    ap.add_argument("--sample-interval", type=float, default=5.0)
    ap.add_argument("--out-dir", required=True)
    ap.add_argument("--tag", required=True)
    ap.add_argument("--unpaced", action="store_true",
                    help="Download as fast as possible (no bitrate pacing)")
    args = ap.parse_args()

    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    pre = sample_host_metrics()
    pre["docker"] = sample_docker_stats(args.container)
    print(json.dumps({"event": "start", "n": args.n, "tag": args.tag, "pre": pre}), flush=True)

    bitrate = 0.0 if args.unpaced else args.bitrate_bps
    summary = run_one(
        url=args.url,
        n=args.n,
        duration=args.duration,
        bitrate_bps=bitrate,
        chunk_bytes=args.chunk_bytes,
        container=args.container,
        sample_interval=args.sample_interval,
    )
    post = sample_host_metrics()
    post["docker"] = sample_docker_stats(args.container)
    summary["pre"] = pre
    summary["post"] = post
    summary["tag"] = args.tag
    summary["ts"] = time.strftime("%Y-%m-%dT%H:%M:%S%z")

    out_path = out_dir / f"{args.tag}.json"
    out_path.write_text(json.dumps(summary, indent=2))
    # Compact one-line summary for ramp logs
    line = {
        "tag": args.tag,
        "n": summary["n"],
        "success_rate": round(summary["success_rate"], 4),
        "usable": summary["clients_usable"],
        "slow": summary["clients_slow"],
        "hard_fail": summary["clients_hard_fail"],
        "bps_mean": round(summary["bps_mean"], 1),
        "bps_min": round(summary["bps_min"], 1),
        "loadavg_1_post": post.get("loadavg_1"),
        "mem_available_kb_post": post.get("mem_available_kb"),
        "docker_cpu_post": (post.get("docker") or {}).get("cpu_perc"),
        "docker_mem_post": (post.get("docker") or {}).get("mem_usage"),
    }
    print(json.dumps({"event": "done", **line}), flush=True)
    (out_dir / "ramp_summary.jsonl").open("a").write(json.dumps(line) + "\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
