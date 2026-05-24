"""
Regression test for happy-eyeballs DNS race in http_client.

Run: `python -m services.test_http_client` from
`Community/coffee-community-api/`.

Scenario: a host returns two A records; one blackholes TCP-443
(simulates the reserved.co.in / Shopify-Plus multi-IP situation
that triggered the original onboarding failure). The race must
pick the good IP, cache it, and short-circuit subsequent lookups.
"""

import socket
import sys
import threading
import time
import unittest
from unittest import mock

# Run from repo root: python -m services.test_http_client.
# Or directly: `cd Community/coffee-community-api && python services/test_http_client.py`
sys.path.insert(0, ".")

from services import http_client


GOOD_IP = "192.0.2.10"   # TEST-NET-1
BAD_IP = "198.51.100.20"  # TEST-NET-2


def _fake_getaddrinfo_two(host, port, *args, **kwargs):
    """Return two A records: BAD first, GOOD second — the natural
    failure mode (bad IP is what the OS picks without happy-eyeballs)."""
    # getaddrinfo returns: (family, type, proto, canonname, sockaddr)
    return [
        (socket.AF_INET, socket.SOCK_STREAM, 6, "", (BAD_IP, port)),
        (socket.AF_INET, socket.SOCK_STREAM, 6, "", (GOOD_IP, port)),
    ]


def _fake_getaddrinfo_one(host, port, *args, **kwargs):
    return [
        (socket.AF_INET, socket.SOCK_STREAM, 6, "", (GOOD_IP, port)),
    ]


class _FakeSocket:
    """Socket double whose connect() either succeeds instantly or
    blocks past `settimeout`, depending on the IP it's pointed at."""

    def __init__(self, family=None, type=None, proto=0):
        self._timeout: float | None = None
        self._closed = False

    def settimeout(self, t):
        self._timeout = t

    def connect(self, address):
        ip, _port = address
        if ip == GOOD_IP:
            return  # Connect succeeds immediately.
        # Bad IP — simulate blackhole: sleep until timeout fires.
        budget = self._timeout if self._timeout is not None else 30.0
        time.sleep(min(budget, 5.0))
        raise socket.timeout("blackhole")

    def close(self):
        self._closed = True

    def __enter__(self):
        return self

    def __exit__(self, *args):
        self.close()


def _fake_socket_factory(family=None, type=None, proto=0):
    return _FakeSocket(family, type, proto)


def _clear_cache():
    with http_client._CACHE_LOCK:
        http_client._IP_CACHE.clear()


class HappyEyeballsTests(unittest.TestCase):

    def setUp(self):
        _clear_cache()

    def test_multi_a_record_with_one_blackhole_picks_good_ip(self):
        """The headline regression — reserved.co.in failure mode."""
        with mock.patch.object(socket, "getaddrinfo", _fake_getaddrinfo_two), \
             mock.patch.object(socket, "socket", _fake_socket_factory):
            chosen = http_client.pick_best_ip("test.example.com", 443)
        self.assertEqual(chosen, GOOD_IP,
                          f"Expected to pick {GOOD_IP}, got {chosen}")

    def test_winner_is_cached_for_subsequent_calls(self):
        """First call races; second call hits the cache and skips the race."""
        with mock.patch.object(socket, "getaddrinfo", _fake_getaddrinfo_two), \
             mock.patch.object(socket, "socket", _fake_socket_factory):
            first = http_client.pick_best_ip("cached.example.com", 443)
        # Second call: even with getaddrinfo raising, we should still
        # get the cached IP back.
        def boom(*args, **kwargs):
            raise AssertionError("getaddrinfo should not be called on cache hit")
        with mock.patch.object(socket, "getaddrinfo", boom):
            second = http_client.pick_best_ip("cached.example.com", 443)
        self.assertEqual(first, second)
        self.assertEqual(second, GOOD_IP)

    def test_single_a_record_still_probes(self):
        """One IP — still probed (poisoned-resolver case where the
        only IP returned blackholes). FakeSocket against GOOD_IP
        succeeds, so we get it back."""
        with mock.patch.object(socket, "getaddrinfo", _fake_getaddrinfo_one), \
             mock.patch.object(socket, "socket", _fake_socket_factory):
            chosen = http_client.pick_best_ip("single.example.com", 443)
        self.assertEqual(chosen, GOOD_IP)

    def test_single_bad_ip_falls_back_to_doh(self):
        """The reserved.co.in headline failure mode — local resolver
        returns ONE IP and it blackholes. DoH escalation must fire
        and find the real edge IP."""
        # OS returns just BAD_IP.
        def os_one_bad(host, port, *args, **kwargs):
            return [(socket.AF_INET, socket.SOCK_STREAM, 6, "", (BAD_IP, port))]
        # DoH returns GOOD_IP.
        def fake_doh(host, port):
            return [GOOD_IP]
        with mock.patch.object(socket, "getaddrinfo", os_one_bad), \
             mock.patch.object(socket, "socket", _fake_socket_factory), \
             mock.patch.object(http_client, "_resolve_via_doh", fake_doh):
            chosen = http_client.pick_best_ip("poisoned.example.com", 443)
        self.assertEqual(chosen, GOOD_IP,
                          f"Expected DoH fallback to pick {GOOD_IP}, got {chosen}")

    def test_ipv4_literal_returns_self(self):
        """Already an IP — no resolution needed."""
        chosen = http_client.pick_best_ip("10.20.30.40", 443)
        self.assertEqual(chosen, "10.20.30.40")

    def test_unresolvable_host_returns_none(self):
        """getaddrinfo raises → return None, caller falls through."""
        def gai_fail(*args, **kwargs):
            raise socket.gaierror("nxdomain")
        with mock.patch.object(socket, "getaddrinfo", gai_fail):
            chosen = http_client.pick_best_ip("does-not-exist.example.com", 443)
        self.assertIsNone(chosen)

    def test_chromium_arg_includes_cached_hosts(self):
        """After a successful resolve, the launch-arg helper exposes
        the IP override so Chromium navigations use it too."""
        with mock.patch.object(socket, "getaddrinfo", _fake_getaddrinfo_two), \
             mock.patch.object(socket, "socket", _fake_socket_factory):
            http_client.pick_best_ip("playwright.example.com", 443)
        arg = http_client.chromium_host_resolver_rules_arg()
        self.assertIsNotNone(arg)
        self.assertIn("MAP playwright.example.com", arg)
        self.assertIn(GOOD_IP, arg)


if __name__ == "__main__":
    unittest.main(verbosity=2)
