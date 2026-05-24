"""
Happy-eyeballs-style DNS resolution for the scraper HTTP layer.

Why this exists. Python's `socket.getaddrinfo` returns every A record
the system resolver knows about. `requests` / `urllib3` blindly pick
the first one. When a multi-A-record host has one good IP and one
blackhole IP (Shopify Plus multi-region setups occasionally pin a
stale Indian BSNL IP alongside the real Shopify edge), we lose a
~10s connect timeout per request — and the bio-extraction loop in
`roaster_enricher.py` gives up before the first LLM call, aborting
the entire onboarding job.

Concrete repro: `https://www.reserved.co.in/` resolves to two A
records via `shops.myshopify.com`. One is `23.227.38.74` (real
Shopify edge, replies in ~250 ms); the other is `218.248.112.60`
(blackholes SYN to :443). Without happy-eyeballs the connect
sticks the bad one and `crema_onboard_roaster` fails with
"Couldn't fetch homepage…".

The fix patches `urllib3.util.connection.create_connection` —
the lowest layer used by `requests` and (transitively) by every
catalog-ops HTTP helper. Strategy per host:

1. Resolve every A record via `socket.getaddrinfo`.
2. If there's just one, use it (no-op).
3. If there are multiple, race a parallel TCP-443 probe with a
   short (1.5 s) budget per IP. First IP whose `connect()`
   succeeds is the winner.
4. Cache the winner per (host, port) for the runner's lifetime —
   subsequent calls skip the race.

For Playwright (Chromium reads system DNS, urllib3 patch doesn't
help), the helper `chromium_host_resolver_rules_arg()` assembles
a `--host-resolver-rules="MAP host ip"` launch arg from whatever
IPs we've cached. Wrap your `chromium.launch(...)` to include it.

The `urllib.request` stdlib path has its own connection logic and
isn't affected by the urllib3 patch — `urlopen_with_eyeballs()`
provides an equivalent.

First-call logging: every host's winning IP is printed once to
stderr, so future "why did this onboard fail" debugging doesn't
need DNS forensics.
"""

from __future__ import annotations

import os
import socket
import sys
import threading
import time
from typing import Optional

# Cache: (host, port) -> winning IP (str). Lives for the runner's lifetime.
_IP_CACHE: dict[tuple[str, int], str] = {}
_CACHE_LOCK = threading.Lock()

# Tunables (override via env if a particular network needs more headroom).
_PROBE_TIMEOUT = float(os.environ.get("CREMA_HE_PROBE_TIMEOUT", "1.5"))
_TOTAL_BUDGET = float(os.environ.get("CREMA_HE_TOTAL_BUDGET", "3.0"))


def _looks_like_ipv4(s: str) -> bool:
    try:
        socket.inet_aton(s)
        return True
    except OSError:
        return False


def _resolve_a_records(host: str, port: int) -> list[str]:
    """Return all A records for (host, port). Empty list on resolution
    failure — caller falls back to the default path."""
    try:
        infos = socket.getaddrinfo(
            host, port, socket.AF_INET, socket.SOCK_STREAM
        )
    except socket.gaierror:
        return []
    # Preserve order, dedupe.
    seen: set[str] = set()
    out: list[str] = []
    for info in infos:
        ip = info[4][0]
        if ip not in seen:
            seen.add(ip)
            out.append(ip)
    return out


def _race_connect(ips: list[str], port: int) -> Optional[str]:
    """Race a parallel TCP probe against every IP. First to succeed
    wins. Returns None when no probe succeeds within the budget.

    Note: even single-IP lists are probed (not short-circuited) — a
    poisoned local resolver may return ONE IP that blackholes, and we
    need the failure signal so `pick_best_ip` can escalate to DoH.
    """
    if not ips:
        return None

    winner: list[Optional[str]] = [None]
    lock = threading.Lock()

    def probe(ip: str) -> None:
        s = None
        try:
            s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            s.settimeout(_PROBE_TIMEOUT)
            s.connect((ip, port))
            with lock:
                if winner[0] is None:
                    winner[0] = ip
        except OSError:
            pass
        finally:
            if s is not None:
                try:
                    s.close()
                except OSError:
                    pass

    threads = [
        threading.Thread(target=probe, args=(ip,), daemon=True)
        for ip in ips
    ]
    for t in threads:
        t.start()

    deadline = time.monotonic() + _TOTAL_BUDGET
    while time.monotonic() < deadline:
        with lock:
            if winner[0] is not None:
                return winner[0]
        time.sleep(0.025)
    return winner[0]


def _resolve_via_doh(host: str, port: int) -> list[str]:
    """Fallback resolver: query Cloudflare 1.1.1.1 over DNS-over-HTTPS.

    Used when the local resolver returns IPs that all fail the TCP
    probe. ISP DNS can be poisoned, stale, or middleware'd in ways
    that hide the real edge IPs — DoH bypasses the local stack
    entirely. We follow CNAMEs by also resolving any `type=5`
    targets we see in the response.
    """
    try:
        import urllib.request
        import urllib.parse
        import json
    except ImportError:
        return []

    def _doh_query(name: str) -> tuple[list[str], list[str]]:
        """Returns (a_records, cnames) for `name`."""
        params = urllib.parse.urlencode({"name": name, "type": "A"})
        url = f"https://1.1.1.1/dns-query?{params}"
        req = urllib.request.Request(
            url, headers={"Accept": "application/dns-json"}
        )
        try:
            with urllib.request.urlopen(req, timeout=4.0) as resp:
                data = json.loads(resp.read().decode("utf-8"))
        except Exception:
            return [], []
        a_records: list[str] = []
        cnames: list[str] = []
        for ans in data.get("Answer", []):
            t = ans.get("type")
            d = ans.get("data", "")
            if t == 1:  # A
                a_records.append(d)
            elif t == 5:  # CNAME
                cnames.append(d.rstrip("."))
        return a_records, cnames

    a_records, cnames = _doh_query(host)
    # If only CNAMEs came back, follow them one hop.
    for cname in cnames:
        if a_records:
            break
        extra_a, _ = _doh_query(cname)
        a_records.extend(extra_a)
    # Dedupe, preserve order.
    seen: set[str] = set()
    out: list[str] = []
    for ip in a_records:
        if ip and ip not in seen:
            seen.add(ip)
            out.append(ip)
    return out


def pick_best_ip(host: str, port: int = 443) -> Optional[str]:
    """Race A-record candidates for (host, port), return the winning IP.

    Resolution ladder:
      1. Cache hit.
      2. OS resolver's A records — race in parallel.
      3. If all OS-provided IPs fail the probe, fall back to Cloudflare
         DoH (1.1.1.1) and race any IPs DoH knows that the OS didn't.
         This handles poisoned / stale local resolvers — exactly the
         reserved.co.in failure mode where the ISP DNS returned a
         dead IP for shops.myshopify.com.

    Cached for the runner's lifetime. Returns None only when both the
    OS path and DoH come up empty (genuine NXDOMAIN / network down).
    """
    if _looks_like_ipv4(host):
        return host
    key = (host, port)
    with _CACHE_LOCK:
        if key in _IP_CACHE:
            return _IP_CACHE[key]

    os_ips = _resolve_a_records(host, port)
    chosen = _race_connect(os_ips, port) if os_ips else None

    if not chosen:
        # OS path failed — try DoH as a last resort.
        doh_ips = _resolve_via_doh(host, port)
        # Race only IPs the OS didn't already try (those just failed).
        fresh = [ip for ip in doh_ips if ip not in set(os_ips)]
        if fresh:
            chosen = _race_connect(fresh, port)
            if chosen:
                sys.stderr.write(
                    f"[http_client] {host}:{port} → {chosen} via DoH "
                    f"(OS resolver returned {os_ips or 'nothing'}; "
                    f"DoH found {doh_ips})\n"
                )
                sys.stderr.flush()

    if chosen:
        with _CACHE_LOCK:
            _IP_CACHE[key] = chosen
        if len(os_ips) > 1 and chosen in os_ips:
            sys.stderr.write(
                f"[http_client] {host}:{port} → {chosen} "
                f"(raced {len(os_ips)} A-records: {os_ips})\n"
            )
            sys.stderr.flush()
    return chosen


def get_cached_ips() -> dict[str, str]:
    """Return a host → ip snapshot of the cache. Used by the Playwright
    launch helper to assemble --host-resolver-rules."""
    with _CACHE_LOCK:
        return {host: ip for (host, _port), ip in _IP_CACHE.items()}


def chromium_host_resolver_rules_arg() -> Optional[str]:
    """Return a `--host-resolver-rules="MAP host ip,..."` arg for
    `chromium.launch(args=[...])` based on the current IP cache.
    None when the cache is empty (no IP overrides needed)."""
    cached = get_cached_ips()
    if not cached:
        return None
    rules = ", ".join(f"MAP {host} {ip}" for host, ip in cached.items())
    return f"--host-resolver-rules={rules}"


# ── urllib3 monkeypatch ─────────────────────────────────────────────

_INSTALLED = False
_INSTALL_LOCK = threading.Lock()


def install_urllib3_patch() -> None:
    """Patch `urllib3.util.connection.create_connection` so every
    requests / urllib3 call goes through our happy-eyeballs resolver.
    Idempotent."""
    global _INSTALLED
    with _INSTALL_LOCK:
        if _INSTALLED:
            return
        try:
            from urllib3.util import connection as _conn
        except ImportError:
            return  # No urllib3 installed — caller's HTTP stack is on its own.

        original = _conn.create_connection

        def eyeballs_create_connection(address, *args, **kwargs):
            host, port = address[0], address[1]
            if _looks_like_ipv4(host):
                return original(address, *args, **kwargs)
            chosen = pick_best_ip(host, port)
            if chosen and chosen != host:
                return original((chosen, port), *args, **kwargs)
            return original(address, *args, **kwargs)

        _conn.create_connection = eyeballs_create_connection
        _INSTALLED = True
        sys.stderr.write(
            "[http_client] happy-eyeballs DNS race installed at urllib3 layer\n"
        )
        sys.stderr.flush()


# ── stdlib urllib.request helper ────────────────────────────────────


def urlopen_with_eyeballs(req_or_url, *, timeout: float = 8.0,
                            headers: Optional[dict] = None):
    """Drop-in replacement for `urllib.request.urlopen` that pre-resolves
    the host via our happy-eyeballs race before opening the connection.

    The stdlib's `urllib.request` doesn't use urllib3, so it bypasses
    the monkeypatch. This helper does the IP override manually by
    rewriting the URL's host to the chosen IP and setting the `Host`
    header to the original. SSL verification still works because the
    Python ssl module honors the `server_hostname` kwarg via SNI when
    using HTTPSConnection directly.

    Accepts either a URL string or a `urllib.request.Request`. Returns
    the same object `urlopen` does.
    """
    import urllib.request
    from urllib.parse import urlsplit, urlunsplit

    if isinstance(req_or_url, urllib.request.Request):
        url = req_or_url.full_url
        req_headers = dict(req_or_url.headers) if hasattr(req_or_url, "headers") else {}
        method = req_or_url.get_method() if hasattr(req_or_url, "get_method") else "GET"
    else:
        url = req_or_url
        req_headers = dict(headers or {})
        method = "GET"

    parts = urlsplit(url)
    host = parts.hostname
    port = parts.port or (443 if parts.scheme == "https" else 80)
    if not host or _looks_like_ipv4(host):
        # Nothing to override.
        if isinstance(req_or_url, urllib.request.Request):
            return urllib.request.urlopen(req_or_url, timeout=timeout)
        req = urllib.request.Request(url, headers=req_headers, method=method)
        return urllib.request.urlopen(req, timeout=timeout)

    chosen = pick_best_ip(host, port)
    if not chosen or chosen == host:
        if isinstance(req_or_url, urllib.request.Request):
            return urllib.request.urlopen(req_or_url, timeout=timeout)
        req = urllib.request.Request(url, headers=req_headers, method=method)
        return urllib.request.urlopen(req, timeout=timeout)

    # For HTTPS, SNI matters — the stdlib opener doesn't make it easy
    # to inject SNI when we rewrite the URL host. The path of least
    # resistance: ensure the urllib3 patch is installed and call
    # requests instead. We import lazily so this module doesn't have
    # a hard dep on requests.
    try:
        import requests
        install_urllib3_patch()
        resp = requests.request(method, url, headers=req_headers, timeout=timeout)
        # Wrap into a urllib-ish object — most callers just want
        # .read() and .status. Use a small shim.
        return _RequestsResponseShim(resp)
    except ImportError:
        # No requests installed — fall back to unmodified stdlib path.
        if isinstance(req_or_url, urllib.request.Request):
            return urllib.request.urlopen(req_or_url, timeout=timeout)
        req = urllib.request.Request(url, headers=req_headers, method=method)
        return urllib.request.urlopen(req, timeout=timeout)


class _RequestsResponseShim:
    """Minimal urllib-style wrapper around a requests.Response so call
    sites that did `resp.read()` keep working."""

    def __init__(self, resp):
        self._resp = resp
        self.status = resp.status_code
        self.headers = resp.headers

    def read(self, amt: Optional[int] = None) -> bytes:
        if amt is None:
            return self._resp.content
        return self._resp.content[:amt]

    def __enter__(self):
        return self

    def __exit__(self, *args):
        self._resp.close()
