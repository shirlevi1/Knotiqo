import gzip
import io
import socket
import threading
import time
from email.message import Message
from pathlib import Path
from unittest.mock import Mock, patch

from django.test import SimpleTestCase

from .metadata_import import (
    Destination, FetchedHTML, ImportLimits, MetadataImportError, PinnedConnection,
    extract_metadata, fetch_html, import_venue_metadata, normalize_url, public_ip,
    read_html, resolve_host, validate_destination,
)


BASE = "https://venue.example.com/gallery/index.html"
FIXTURES = Path(__file__).parent / "fixtures" / "metadata"


class FakeResponse:
    def __init__(self, body=b"<title>Venue</title>", status=200, headers=None):
        self.status = status
        self.headers = Message()
        for key, value in (headers or {"Content-Type": "text/html; charset=utf-8"}).items():
            self.headers[key] = value
        self.stream = io.BytesIO(body)

    def getheader(self, name, default=None):
        return self.headers.get(name, default)

    def read1(self, amount):
        return self.stream.read(amount)

    def __enter__(self):
        return self

    def __exit__(self, *args):
        self.stream.close()


class MetadataParsingTests(SimpleTestCase):
    def test_open_graph_relative_gallery_images_and_deduplication(self):
        data = extract_metadata((FIXTURES / "open_graph.html").read_text(encoding="utf-8"), BASE)
        self.assertEqual(data["name"], "אולם אמיתי")
        self.assertEqual(data["description"], "אולם & גן")
        self.assertEqual((data["address"], data["phone"]), ("", ""))
        self.assertEqual([item["image_url"] for item in data["images"]], [
            "https://venue.example.com/photos/hall.jpg",
            "https://venue.example.com/garden.jpg",
            "https://venue.example.com/gallery/reception.webp",
        ])
        self.assertEqual(data["images"][0]["alt_text"], "האולם באור יום")
        self.assertTrue(all(item["source_url"] == BASE for item in data["images"]))

    def test_json_ld_address_phone_and_image_attribution(self):
        data = extract_metadata((FIXTURES / "json_ld.html").read_text(encoding="utf-8"), BASE)
        self.assertEqual(data["name"], "Venue in JSON-LD")
        self.assertEqual(data["open_graph"]["title"], "Fallback site title")
        self.assertEqual(data["address"], "12 Main Street, Haifa, IL")
        self.assertEqual(data["phone"], "+972-4-1234567")
        image = data["images"][0]
        self.assertEqual(image["image_url"], "https://venue.example.com/images/venue.jpg")
        self.assertEqual(image["credit"], "Venue photographer")
        self.assertEqual(image["copyright"], "Copyright venue")
        self.assertEqual(image["license_url"], "https://venue.example.com/license")
        self.assertEqual(image["origins"], ["json_ld"])

    def test_fallbacks_malformed_html_and_untrusted_plain_text(self):
        html = """<title>Actual title</title><meta name=description content="Real description">
        <script type="application/ld+json">{bad json}</script>
        <meta property="og:title" content="&lt;b&gt;Real venue&lt;/b&gt;&lt;script&gt;bad()&lt;/script&gt;">
        <img src="/garden.jpg"><p><broken"""
        data = extract_metadata(html, BASE)
        self.assertEqual(data["name"], "Real venue")
        self.assertEqual(data["description"], "Real description")
        self.assertEqual(data["images"][0]["image_url"], "https://venue.example.com/garden.jpg")
        self.assertEqual(extract_metadata("<title>Only title</title>", BASE)["name"], "Only title")
        self.assertEqual(extract_metadata("<title>Venue</title><![broken]>", BASE)["name"], "Venue")
        self.assertEqual(extract_metadata("<title>Venue</title><script type></script><a href>", BASE)["name"], "Venue")

    def test_open_graph_contact_and_images_use_document_base_with_page_provenance(self):
        data = extract_metadata("""
            <template><meta property="og:title" content="Placeholder"></template>
            <meta property="og:title" content="Published title">
            <meta property="og:description" content="Published description">
            <meta property="business:contact_data:locality" content="Haifa">
            <meta property="business:contact_data:phone_number" content="+972-4-1234567">
            <base href="/media/">
            <meta property="og:image" content="hall.jpg#hero">
            <img src="hall.jpg">
        """, BASE)
        url = "https://venue.example.com/media/hall.jpg"
        self.assertEqual(data["open_graph"], {
            "title": "Published title", "description": "Published description", "image_urls": [url],
        })
        self.assertEqual((data["address"], data["phone"]), ("Haifa", "+972-4-1234567"))
        self.assertEqual(len(data["images"]), 1)
        self.assertEqual(data["images"][0]["source_url"], BASE)
        self.assertEqual(data["images"][0]["origins"], ["open_graph", "html"])

    def test_empty_metadata_returns_structured_error(self):
        with patch("venues.metadata_import.fetch_html", return_value=FetchedHTML(BASE, "<html><body></body></html>")):
            result = import_venue_metadata(BASE)
        self.assertFalse(result["ok"])
        self.assertIsNone(result["metadata"])
        self.assertEqual(result["error"]["code"], "missing_metadata")

    def test_import_success_and_unsafe_image_candidates(self):
        html = """<title>Venue</title><img src="//cdn.example.com/a.jpg">
        <img src="http://127.0.0.1/private"><img src="ftp://example.com/a">
        <img src="https://user:password@example.com/a"><img src="https://example.com:8443/a">
        <base href="http://127.0.0.1/"><img src="relative.jpg">"""
        with patch("venues.metadata_import.fetch_html", return_value=FetchedHTML(BASE, html)):
            result = import_venue_metadata(BASE)
        self.assertTrue(result["ok"])
        self.assertEqual([item["image_url"] for item in result["metadata"]["images"]], [
            "https://cdn.example.com/a.jpg", "https://venue.example.com/gallery/relative.jpg",
        ])


class DestinationSecurityTests(SimpleTestCase):
    def test_rejects_invalid_urls_credentials_and_unsafe_ports(self):
        for url in ("file:///etc/passwd", "ftp://example.com/a", "https://u:p@example.com",
                    "http://example.com:8080", "https://example.com:0", "http://example.com:443",
                    "https://example.com\\@127.0.0.1", "https://example.com/\r\nHost:evil",
                    "https://[fe80::1%25eth0]/", "https://example.com:invalid",
                    "https://[2606:4700::1111]ignored/", "https://example.com:",
                    "https://example.com/%zz", " https://example.com/"):
            with self.subTest(url=url), self.assertRaises(MetadataImportError):
                normalize_url(url)

    def test_blocks_nonpublic_ipv4_ipv6_and_special_use_networks(self):
        for address in (
            "127.0.0.1", "10.1.2.3", "172.16.0.1", "192.168.0.1", "169.254.169.254",
            "0.0.0.0", "100.64.0.1", "192.0.0.8", "198.18.0.1", "192.0.2.1",
            "224.0.0.1", "255.255.255.255", "::1", "::", "fc00::1", "fe80::1",
            "ff02::1", "::ffff:127.0.0.1", "::ffff:8.8.8.8", "2001:db8::1",
            "2002:7f00:1::1", "64:ff9b::7f00:1", "3fff::1",
        ):
            with self.subTest(address=address):
                self.assertFalse(public_ip(address))
        self.assertTrue(public_ip("8.8.8.8"))
        self.assertTrue(public_ip("2606:4700:4700::1111"))

    def test_dns_answers_are_all_validated_and_alternative_ip_forms_cannot_bypass(self):
        resolver = Mock(return_value=["8.8.8.8", "127.0.0.1"])
        with self.assertRaises(MetadataImportError):
            validate_destination(BASE, time.monotonic() + 10, resolver)
        for host in ("127.1", "0177.0.0.1", "0x7f.0.0.1"):
            with self.subTest(host=host), self.assertRaises(MetadataImportError):
                validate_destination(f"http://{host}", time.monotonic() + 10, Mock(return_value=["127.0.0.1"]))
        for host in ("localhost", "service.localhost", "service.local", "2130706433", "0x7f000001"):
            with self.subTest(host=host), self.assertRaises(MetadataImportError):
                normalize_url(f"http://{host}")

    def test_public_ipv6_and_idna_are_canonicalized(self):
        result = validate_destination("https://[2606:4700:4700::1111]/a", time.monotonic() + 10)
        self.assertEqual(result.ip, "2606:4700:4700::1111")
        self.assertEqual(normalize_url("https://münich.example.com/אולם#fragment"),
                         "https://xn--mnich-kva.example.com/%D7%90%D7%95%D7%9C%D7%9D")

    def test_dns_rebinding_does_not_trigger_second_resolution_during_connect(self):
        resolver = Mock(side_effect=[["8.8.8.8"], ["127.0.0.1"]])
        target = validate_destination(BASE, time.monotonic() + 10, resolver)
        sock = Mock()
        sock.getpeername.return_value = ("8.8.8.8", 443)
        tls_sock = Mock()
        context = Mock()
        context.wrap_socket.return_value = tls_sock
        with (
            patch("venues.metadata_import.socket.socket", return_value=sock),
            patch("venues.metadata_import.ssl.create_default_context", return_value=context),
            patch("venues.metadata_import.socket.getaddrinfo") as dns,
        ):
            conn = PinnedConnection(target, time.monotonic() + 10, ImportLimits())
            conn.connect()
            sock.connect.assert_called_once_with(("8.8.8.8", 443))
            context.wrap_socket.assert_called_once_with(sock, server_hostname="venue.example.com", do_handshake_on_connect=False)
            tls_sock.do_handshake.assert_called_once()
            dns.assert_not_called()
            resolver.assert_called_once()
            conn.interrupt()
            tls_sock.shutdown.assert_called_once_with(socket.SHUT_RDWR)

    def test_peer_mismatch_is_rejected(self):
        sock = Mock()
        sock.getpeername.return_value = ("127.0.0.1", 80)
        target = Destination("http://example.com/", "example.com", 80, "8.8.8.8", False)
        with patch("venues.metadata_import.socket.socket", return_value=sock):
            with self.assertRaises(MetadataImportError):
                PinnedConnection(target, time.monotonic() + 10, ImportLimits()).connect()

    def test_http_parser_counts_headers_and_chunk_framing_against_wire_budget(self):
        sock = Mock()
        sock.getpeername.return_value = ("8.8.8.8", 80)
        headers = b"HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nTransfer-Encoding: chunked\r\n\r\n"
        chunk = b"1;x=" + b"x" * 60000 + b"\r\na\r\n"
        with patch("venues.metadata_import.socket.socket", return_value=sock):
            sock.makefile.return_value = io.BytesIO(headers + b"3\r\nabc\r\n0\r\n\r\n")
            self.assertEqual(fetch_html("http://8.8.8.8").html, "abc")
            sock.makefile.return_value = io.BytesIO(headers + chunk * 3 + b"0\r\n\r\n")
            with self.assertRaises(MetadataImportError) as caught:
                fetch_html("http://8.8.8.8", limits=ImportLimits(max_bytes=100))
            self.assertEqual(caught.exception.code, "response_too_large")

    def test_system_dns_failure_is_structured(self):
        with patch("venues.metadata_import.socket.getaddrinfo", side_effect=socket.gaierror):
            with self.assertRaises(MetadataImportError) as caught:
                resolve_host("example.com", 443, time.monotonic() + 5)
        self.assertEqual(caught.exception.code, "inaccessible_website")

    def test_slow_dns_is_bounded_by_the_same_deadline(self):
        release = threading.Event()
        finished = threading.Event()

        def slow_dns(*args):
            try:
                release.wait(timeout=1)
                return []
            finally:
                finished.set()

        with patch("venues.metadata_import.socket.getaddrinfo", side_effect=slow_dns):
            try:
                with self.assertRaises(MetadataImportError) as caught:
                    resolve_host("example.com", 443, time.monotonic() + 0.03)
                self.assertEqual(caught.exception.code, "timeout")
            finally:
                release.set()
                self.assertTrue(finished.wait(timeout=1))


class FetchSecurityTests(SimpleTestCase):
    def setUp(self):
        self.resolver = Mock(return_value=["8.8.8.8"])
        self.connection = self.enterContext(patch("venues.metadata_import.PinnedConnection"))
        self.client = self.connection.return_value
        self.client.getresponse.return_value = FakeResponse()

    def fetch(self, **kwargs):
        return fetch_html(BASE, resolver=self.resolver, **kwargs)

    def test_success_uses_plain_get_with_no_environment_proxy_or_cookies(self):
        result = self.fetch()
        self.assertEqual(result.html, "<title>Venue</title>")
        self.assertEqual(result.source_url, BASE)
        request = self.client.request.call_args
        self.assertEqual(request.args, ("GET", "/gallery/index.html"))
        self.assertEqual(request.kwargs["headers"]["Host"], "venue.example.com")
        self.assertNotIn("Cookie", request.kwargs["headers"])

    def test_redirect_to_internal_destination_is_blocked_before_connection(self):
        self.client.getresponse.return_value = FakeResponse(status=302, headers={"Location": "http://127.0.0.1/"})
        with self.assertRaises(MetadataImportError) as caught:
            self.fetch()
        self.assertEqual(caught.exception.code, "blocked_destination")
        self.assertEqual(self.connection.call_count, 1)

    def test_malformed_redirect_fails_before_resolving_a_second_destination(self):
        self.client.getresponse.return_value = FakeResponse(status=302, headers={"Location": "https:/broken"})
        with self.assertRaises(MetadataImportError) as caught:
            self.fetch()
        self.assertEqual(caught.exception.code, "invalid_url")
        self.resolver.assert_called_once()
        self.connection.assert_called_once()

    def test_each_redirect_resolves_again_and_blocks_changed_dns(self):
        self.client.getresponse.return_value = FakeResponse(status=302, headers={"Location": "/new"})
        self.resolver.side_effect = [["8.8.8.8"], ["10.0.0.1"]]
        with self.assertRaises(MetadataImportError) as caught:
            self.fetch()
        self.assertEqual(caught.exception.code, "blocked_destination")
        self.assertEqual(self.connection.call_count, 1)

    def test_safe_relative_redirect_and_redirect_count_limit(self):
        self.client.getresponse.side_effect = [
            FakeResponse(status=302, headers={"Location": "../home"}),
            FakeResponse(),
        ]
        self.assertEqual(self.fetch().source_url, "https://venue.example.com/home")
        self.assertEqual(self.resolver.call_count, 2)
        self.client.getresponse.side_effect = lambda: FakeResponse(status=302, headers={"Location": "/loop"})
        with self.assertRaises(MetadataImportError) as caught:
            self.fetch(limits=ImportLimits(max_redirects=1))
        self.assertEqual(caught.exception.code, "too_many_redirects")

    def test_only_html_is_accepted_and_access_denials_are_not_bypassed(self):
        for status, headers, code in (
            (403, {}, "inaccessible_website"),
            (429, {}, "inaccessible_website"),
            (200, {"Content-Type": "application/json"}, "unsupported_response"),
            (200, {"Content-Type": "text/html", "Content-Encoding": "br"}, "unsupported_response"),
        ):
            with self.subTest(status=status, headers=headers):
                self.client.getresponse.return_value = FakeResponse(status=status, headers=headers)
                with self.assertRaises(MetadataImportError) as caught:
                    self.fetch()
                self.assertEqual(caught.exception.code, code)

    def test_timeout_and_total_deadline_are_structured(self):
        self.client.request.side_effect = socket.timeout
        with self.assertRaises(MetadataImportError) as caught:
            self.fetch()
        self.assertEqual(caught.exception.code, "timeout")
        self.client.request.side_effect = None
        with patch("venues.metadata_import.time.monotonic", side_effect=[10, 100]):
            with self.assertRaises(MetadataImportError) as caught:
                self.fetch(limits=ImportLimits(total_timeout=1))
        self.assertEqual(caught.exception.code, "timeout")

    def test_size_limits_cover_wire_and_gzip_decompression(self):
        limits = ImportLimits(max_bytes=100)
        for body, headers in (
            (b"x" * 101, {"Content-Type": "text/html"}),
            (b"", {"Content-Type": "text/html", "Content-Length": "101"}),
            (gzip.compress(b"x" * 5000), {"Content-Type": "text/html", "Content-Encoding": "gzip"}),
        ):
            with self.subTest(headers=headers):
                self.client.getresponse.return_value = FakeResponse(body=body, headers=headers)
                with self.assertRaises(MetadataImportError) as caught:
                    self.fetch(limits=limits)
                self.assertEqual(caught.exception.code, "response_too_large")
        self.client.getresponse.return_value = FakeResponse(
            body=gzip.compress(b"<title>Venue</title>"),
            headers={"Content-Type": "text/html", "Content-Encoding": "gzip"},
        )
        self.assertEqual(self.fetch().html, "<title>Venue</title>")

    def test_streaming_deadline_checks_after_each_read(self):
        response = FakeResponse()
        with patch("venues.metadata_import.time.monotonic", side_effect=[1, 50]):
            with self.assertRaises(MetadataImportError) as caught:
                read_html(response, 10, ImportLimits())
        self.assertEqual(caught.exception.code, "timeout")

    def test_truncated_and_ambiguous_response_framing_is_rejected(self):
        for headers in (
            {"Content-Length": "100"},
            {"Content-Length": "0", "Transfer-Encoding": "chunked"},
            {"Transfer-Encoding": "gzip, chunked"},
        ):
            with self.subTest(headers=headers):
                self.client.getresponse.return_value = FakeResponse(
                    headers={"Content-Type": "text/html", **headers},
                )
                with self.assertRaises(MetadataImportError) as caught:
                    self.fetch()
                self.assertEqual(caught.exception.code, "unsupported_response")

    def test_deadline_timer_interrupts_header_wait(self):
        interrupted = threading.Event()
        self.client.interrupt.side_effect = interrupted.set

        def wait_for_headers():
            if not interrupted.wait(timeout=1):
                self.fail("Total deadline did not interrupt the connection")
            raise OSError("Socket interrupted")

        self.client.getresponse.side_effect = wait_for_headers
        with self.assertRaises(MetadataImportError) as caught:
            self.fetch(limits=ImportLimits(total_timeout=0.03))
        self.assertEqual(caught.exception.code, "timeout")
