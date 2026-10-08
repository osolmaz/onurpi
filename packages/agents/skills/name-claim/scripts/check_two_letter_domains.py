#!/usr/bin/env python3
import concurrent.futures
import json
import re
import socket
import subprocess
import time
from pathlib import Path

TLDS = "ac ai bz ca cc ch cm co cx de es eu fm fr gg id in io is la li me mx nl nu nz pe ph pw sg sh so to tv uk us vc ws".split()
LABELS = [f"o{i}" for i in range(1, 10)] + ["os", "oo"]
UA = "name-claim availability check"


def port43(host: str, query: str, timeout: float = 10.0) -> str:
    with socket.create_connection((host, 43), timeout=timeout) as sock:
        sock.settimeout(timeout)
        sock.sendall((query + "\r\n").encode())
        chunks = []
        size = 0
        while size < 200_000:
            try:
                chunk = sock.recv(65_536)
            except socket.timeout:
                break
            if not chunk:
                break
            chunks.append(chunk)
            size += len(chunk)
    return b"".join(chunks).decode("utf-8", errors="replace")


def iana_server(tld: str) -> str | None:
    text = port43("whois.iana.org", tld, 8)
    match = re.search(r"(?im)^whois:\s*(\S+)", text)
    return match.group(1).strip() if match else None


def has_dns(domain: str) -> bool:
    for record in ("NS", "A", "AAAA"):
        proc = subprocess.run(
            ["dig", "+time=2", "+tries=1", "+short", domain, record],
            capture_output=True,
            text=True,
            timeout=8,
            check=False,
        )
        if proc.stdout.strip():
            return True
    return False


def compact(text: str, domain: str) -> str:
    lines = []
    for raw in text.splitlines():
        line = raw.strip()
        if not line or line.startswith("%") or line.lower().startswith("terms of use"):
            continue
        line = re.sub(re.escape(domain), "DOMAIN", line, flags=re.I)
        line = re.sub(r"\d{4}-\d{2}-\d{2}T[0-9:.+-]+Z?", "TIMESTAMP", line)
        lines.append(line)
        if len(lines) >= 8:
            break
    return " | ".join(lines)[:1000]


FREE_PATTERNS = [
    r"\bnot found\b",
    r"\bno match\b",
    r"\bno entries found\b",
    r"\bno data found\b",
    r"\bno such domain\b",
    r"\bno object found\b",
    r"\bno domain records? (?:was|were) found\b",
    r"\bstatus:\s*(?:free|available)\b",
    r"\bis available\b",
    r"\bavailable for registration\b",
    r"\bdomain is available\b",
]
UNKNOWN_PATTERNS = [
    r"rate limit",
    r"quota exceeded",
    r"too many requests",
    r"access denied",
    r"temporarily unavailable",
    r"service unavailable",
    r"query limit",
    r"invalid query",
]


def classify(text: str, domain: str) -> str:
    low = text.lower()
    if not text.strip():
        return "unknown"
    if any(re.search(p, low) for p in UNKNOWN_PATTERNS):
        return "unknown"
    if "reserved" in low:
        return "reserved"
    if any(re.search(p, low) for p in FREE_PATTERNS):
        return "free"
    if domain.lower() in low and any(
        marker in low
        for marker in (
            "domain name:",
            "domain:",
            "registrar:",
            "creation date:",
            "created:",
            "registered on:",
            "holder:",
            "status:",
        )
    ):
        return "taken"
    return "unknown"


def scan_tld(tld: str, server: str | None):
    rows = []
    for label in LABELS:
        domain = f"{label}.{tld}"
        try:
            if has_dns(domain):
                rows.append({"domain": domain, "status": "taken", "signal": "dns"})
                continue
        except Exception:
            pass
        if not server:
            rows.append({"domain": domain, "status": "unknown", "signal": "no-whois"})
            continue
        try:
            text = port43(server, domain, 10)
            status = classify(text, domain)
            rows.append(
                {
                    "domain": domain,
                    "status": status,
                    "signal": "whois",
                    "summary": compact(text, domain),
                }
            )
        except Exception as exc:
            rows.append(
                {
                    "domain": domain,
                    "status": "unknown",
                    "signal": "whois-error",
                    "error": type(exc).__name__,
                }
            )
        time.sleep(0.25)
    return rows


def main():
    servers = {}
    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
        future_to_tld = {pool.submit(iana_server, tld): tld for tld in TLDS}
        for future in concurrent.futures.as_completed(future_to_tld):
            tld = future_to_tld[future]
            try:
                servers[tld] = future.result()
            except Exception:
                servers[tld] = None

    rows = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
        futures = {pool.submit(scan_tld, tld, servers[tld]): tld for tld in TLDS}
        for future in concurrent.futures.as_completed(futures):
            rows.extend(future.result())

    rows.sort(key=lambda row: row["domain"].split(".")[1:] + [row["domain"].split(".")[0]])
    result = {"labels": LABELS, "tlds": TLDS, "servers": servers, "results": rows}
    Path("/tmp/two-letter-domain-scan.json").write_text(json.dumps(result, indent=2) + "\n")
    counts = {}
    for row in rows:
        counts[row["status"]] = counts.get(row["status"], 0) + 1
    print(json.dumps(counts, sort_keys=True))
    for status in ("free", "reserved", "unknown"):
        names = [row["domain"] for row in rows if row["status"] == status]
        print(status.upper(), len(names))
        print(" ".join(names))


if __name__ == "__main__":
    main()
