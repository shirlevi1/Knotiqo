"""Fetch public HTML over a pinned connection and extract untrusted venue metadata.

No persistence, image requests, JavaScript execution, cookies, or environment proxies.
Image URLs are candidates only and must undergo destination validation before any
future downloader uses them.
"""

import http.client
import ipaddress
import json
import re
import socket
import ssl
import threading
import time
import zlib
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FutureTimeout
from dataclasses import dataclass
from html.parser import HTMLParser
from urllib.parse import quote, urljoin, urlsplit, urlunsplit


@dataclass(frozen=True)
class ImportLimits:
    connect_timeout: float = 5
    read_timeout: float = 5
    total_timeout: float = 15
    max_redirects: int = 3
    max_bytes: int = 1_048_576


class MetadataImportError(Exception):
    def __init__(self, code, message):
        super().__init__(message)
        self.code = code
        self.message = message


def fail(code):
    messages = {
        "invalid_url": "A valid HTTP or HTTPS website URL is required.",
        "blocked_destination": "The destination is not a public website.",
        "timeout": "The website request exceeded its time limit.",
        "inaccessible_website": "The website could not be accessed.",
        "unsupported_response": "The website did not return supported HTML.",
        "response_too_large": "The website response exceeds the size limit.",
        "too_many_redirects": "The website exceeded the redirect limit.",
        "missing_metadata": "No venue metadata was found in the HTML.",
    }
    raise MetadataImportError(code, messages[code])


def remaining(deadline):
    value = deadline - time.monotonic()
    if value <= 0:
        fail("timeout")
    return value


def public_ip(value):
    try:
        address = ipaddress.ip_address(value)
    except ValueError:
        return False
    if not address.is_global or address.is_reserved or address.is_multicast:
        return False
    if address.version == 4:
        # Cover special-use ranges classified differently across Python releases.
        return not any(address in ipaddress.ip_network(network) for network in (
            "192.0.0.0/24", "192.88.99.0/24",
        ))
    return (
        address in ipaddress.ip_network("2000::/3")
        and not any(address in ipaddress.ip_network(network) for network in (
            "2001::/23", "2002::/16", "3fff::/20",
        ))
        and address.ipv4_mapped is None
        and address.sixtofour is None
        and address.teredo is None
    )


def split_url(value):
    if not isinstance(value, str) or not value or len(value) > 4096 or re.search(
        r"[\s\x00-\x1f\x7f\\]|%(?![0-9a-fA-F]{2})", value,
    ):
        fail("invalid_url")
    try:
        return urlsplit(value)
    except ValueError:
        fail("invalid_url")


def normalize_url(value):
    parts = split_url(value)
    try:
        if parts.scheme.lower() not in ("http", "https") or not parts.hostname:
            fail("invalid_url")
        if parts.username is not None or parts.password is not None:
            fail("invalid_url")
        if not re.fullmatch(r"(?:\[[0-9a-fA-F:.]+\]|[^\[\]:]+)(?::[0-9]+)?", parts.netloc):
            fail("invalid_url")
        scheme = parts.scheme.lower()
        port = parts.port if parts.port is not None else (443 if scheme == "https" else 80)
        if port != (443 if scheme == "https" else 80):
            fail("blocked_destination")
        host = parts.hostname.encode("idna").decode("ascii").lower().removesuffix(".")
        if "%" in host:
            fail("invalid_url")
        try:
            literal = ipaddress.ip_address(host)
        except ValueError:
            literal = None
        if literal is not None:
            if not public_ip(str(literal)):
                fail("blocked_destination")
            host = str(literal)
        else:
            if len(host) > 253 or not all(
                re.fullmatch(r"[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?", label)
                for label in host.split(".")
            ):
                fail("invalid_url")
            # Reject legacy numeric IPv4 spellings that browsers and OS resolvers
            # can interpret differently from ipaddress.
            if re.fullmatch(r"(?:0x[0-9a-f]+|[0-9]+)(?:\.(?:0x[0-9a-f]+|[0-9]+))*", host):
                fail("blocked_destination")
            if "." not in host or host.endswith((
                ".localhost", ".local", ".internal", ".invalid", ".test", ".home.arpa",
            )) or host == "localhost":
                fail("blocked_destination")
        authority = f"[{host}]" if ":" in host else host
        path = quote(parts.path or "/", safe="/%:@!$&'()*+,;=-._~")
        query = quote(parts.query, safe="/?%:@!$&'()*+,;=-._~")
        return urlunsplit((scheme, authority, path, query, ""))
    except (ValueError, UnicodeError):
        fail("invalid_url")


def resolve_url(base, reference):
    parts = split_url(reference)
    if (parts.scheme or reference.startswith("//")) and not parts.netloc:
        fail("invalid_url")
    return normalize_url(urljoin(base, reference))


_DNS_EXECUTOR = ThreadPoolExecutor(max_workers=4, thread_name_prefix="venue-dns")
_DNS_SLOTS = threading.BoundedSemaphore(4)


def resolve_host(host, port, deadline):
    # OS DNS is blocking. Bound both the wait and the number of outstanding jobs.
    if not _DNS_SLOTS.acquire(timeout=remaining(deadline)):
        fail("timeout")
    try:
        future = _DNS_EXECUTOR.submit(socket.getaddrinfo, host, port, 0, socket.SOCK_STREAM)
    except Exception:
        _DNS_SLOTS.release()
        raise
    future.add_done_callback(lambda _: _DNS_SLOTS.release())
    try:
        return [entry[4][0] for entry in future.result(timeout=remaining(deadline))]
    except FutureTimeout:
        fail("timeout")
    except OSError:
        fail("inaccessible_website")


@dataclass(frozen=True)
class Destination:
    url: str
    host: str
    port: int
    ip: str
    tls: bool


def validate_destination(url, deadline, resolver=resolve_host):
    url = normalize_url(url)
    parts = urlsplit(url)
    port = 443 if parts.scheme == "https" else 80
    host = parts.hostname
    try:
        literal = ipaddress.ip_address(host)
    except ValueError:
        literal = None
    addresses = [str(literal)] if literal else resolver(host, port, deadline)
    remaining(deadline)
    if not addresses or not all(public_ip(address) for address in addresses):
        fail("blocked_destination")
    return Destination(url, host, port, str(ipaddress.ip_address(addresses[0])), parts.scheme == "https")


class BoundedResponseStream:
    """Count HTTP bytes consumed by the parser, including headers and chunk framing."""

    def __init__(self, stream, budget):
        self.stream = stream
        self.budget = budget

    def _consume(self, operation, amount):
        data = operation(min(amount, self.budget + 1))
        self.budget -= len(data)
        if self.budget < 0:
            fail("response_too_large")
        return data

    def readline(self, amount):
        return self._consume(self.stream.readline, amount)

    def read(self, amount):
        return self._consume(self.stream.read, amount)

    def read1(self, amount):
        return self._consume(self.stream.read1, amount)

    def flush(self):
        self.stream.flush()

    def close(self):
        self.stream.close()


class PinnedConnection(http.client.HTTPConnection):
    def __init__(self, destination, deadline, limits):
        super().__init__(destination.host, destination.port, timeout=limits.connect_timeout)
        self.destination = destination
        self.deadline = deadline
        self.limits = limits
        self.pinned_socket = None

    def response_class(self, *args, **kwargs):
        response = http.client.HTTPResponse(*args, **kwargs)
        # Keep a separate allowance for headers and transfer framing.
        response.fp = BoundedResponseStream(response.fp, self.limits.max_bytes + 131_072)
        return response

    def connect(self):
        target = self.destination
        family = socket.AF_INET6 if ":" in target.ip else socket.AF_INET
        self.sock = self.pinned_socket = socket.socket(family, socket.SOCK_STREAM)
        self.sock.settimeout(min(self.limits.connect_timeout, remaining(self.deadline)))
        # Numeric socket.connect performs no second hostname lookup.
        self.sock.connect((target.ip, target.port))
        if ipaddress.ip_address(self.sock.getpeername()[0]) != ipaddress.ip_address(target.ip):
            fail("blocked_destination")
        if target.tls:
            context = ssl.create_default_context()
            self.sock = self.pinned_socket = context.wrap_socket(
                self.sock, server_hostname=target.host, do_handshake_on_connect=False,
            )
            self.sock.settimeout(min(self.limits.connect_timeout, remaining(self.deadline)))
            self.sock.do_handshake()
        self.sock.settimeout(min(self.limits.read_timeout, remaining(self.deadline)))

    def interrupt(self):
        sock = self.pinned_socket
        if sock is not None:
            try:
                sock.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass
            sock.close()


@dataclass(frozen=True)
class FetchedHTML:
    source_url: str
    html: str


def read_html(response, deadline, limits):
    media_type = response.headers.get_content_type()
    if media_type not in ("text/html", "application/xhtml+xml"):
        fail("unsupported_response")
    encoding = response.getheader("Content-Encoding", "identity").lower().strip()
    if encoding not in ("identity", "gzip"):
        fail("unsupported_response")
    length = response.getheader("Content-Length")
    transfer = response.getheader("Transfer-Encoding")
    if transfer is not None and (transfer.lower().strip() != "chunked" or length is not None):
        fail("unsupported_response")
    expected_size = None
    if length is not None:
        if not re.fullmatch(r"[0-9]+", length):
            fail("unsupported_response")
        digits = length.lstrip("0") or "0"
        if len(digits) > len(str(limits.max_bytes)) or int(digits) > limits.max_bytes:
            fail("response_too_large")
        expected_size = int(digits)
    decoder = zlib.decompressobj(16 + zlib.MAX_WBITS) if encoding == "gzip" else None
    output = bytearray()
    wire_size = 0
    while True:
        remaining(deadline)
        chunk = response.read1(min(16384, limits.max_bytes + 1 - wire_size))
        remaining(deadline)
        if not chunk:
            break
        wire_size += len(chunk)
        if wire_size > limits.max_bytes:
            fail("response_too_large")
        decoded = decoder.decompress(chunk, limits.max_bytes + 1 - len(output)) if decoder else chunk
        output.extend(decoded)
        if len(output) > limits.max_bytes:
            fail("response_too_large")
        if decoder and decoder.unused_data:
            fail("unsupported_response")
    if (expected_size is not None and wire_size != expected_size) or (decoder and not decoder.eof):
        fail("unsupported_response")
    charset = response.headers.get_content_charset() or "utf-8"
    try:
        return output.decode(charset, errors="replace")
    except (LookupError, ValueError):
        return output.decode("utf-8", errors="replace")


def fetch_html(url, *, limits=ImportLimits(), resolver=resolve_host):
    deadline = time.monotonic() + limits.total_timeout
    current_url = url
    for hop in range(limits.max_redirects + 1):
        target = validate_destination(current_url, deadline, resolver)
        connection = PinnedConnection(target, deadline, limits)
        timer = threading.Timer(remaining(deadline), connection.interrupt)
        timer.daemon = True
        timer.start()
        try:
            parts = urlsplit(target.url)
            path = parts.path + (f"?{parts.query}" if parts.query else "")
            connection.request("GET", path, headers={
                "Host": parts.netloc, "User-Agent": "Knotiqo-Metadata/1.0",
                "Accept": "text/html, application/xhtml+xml", "Accept-Encoding": "gzip",
                "Connection": "close",
            })
            with connection.getresponse() as response:
                remaining(deadline)
                if response.status in (301, 302, 303, 307, 308):
                    locations = response.headers.get_all("Location", [])
                    if len(locations) != 1 or not locations[0]:
                        fail("unsupported_response")
                    if hop == limits.max_redirects:
                        fail("too_many_redirects")
                    current_url = resolve_url(target.url, locations[0])
                    continue
                if response.status != 200:
                    fail("inaccessible_website")
                html = read_html(response, deadline, limits)
                remaining(deadline)
                return FetchedHTML(target.url, html)
        except (TimeoutError, socket.timeout):
            fail("timeout")
        except (OSError, http.client.HTTPException, zlib.error, ValueError):
            remaining(deadline)
            fail("inaccessible_website")
        finally:
            timer.cancel()
            connection.interrupt()
            connection.close()
    fail("too_many_redirects")


class PlainText(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts = []
        self.hidden = 0

    def handle_starttag(self, tag, attrs):
        if tag in ("script", "style"):
            self.hidden += 1

    def handle_endtag(self, tag):
        if tag in ("script", "style") and self.hidden:
            self.hidden -= 1

    def handle_data(self, data):
        if not self.hidden:
            self.parts.append(data)


def plain(value, limit=4000):
    if not isinstance(value, str):
        return ""
    parser = PlainText()
    try:
        parser.feed(value[:16384])
    except (AssertionError, ValueError):
        pass
    return " ".join(" ".join(parser.parts).split())[:limit]


class MetadataHTMLParser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.meta = {}
        self.title = []
        self.in_title = False
        self.json_scripts = []
        self.script = None
        self.images = []
        self.open_graph_images = []
        self.inert_tags = []
        self.base_href = None

    def handle_starttag(self, tag, attrs):
        if self.inert_tags:
            if tag == "template" and self.inert_tags[-1] == "template":
                self.inert_tags.append(tag)
            return
        if tag in ("template", "textarea", "noscript", "xmp", "iframe"):
            self.inert_tags.append(tag)
            return
        attrs = dict(attrs)
        if tag == "base" and self.base_href is None and attrs.get("href"):
            self.base_href = attrs["href"]
        if tag == "title":
            self.in_title = True
        if tag == "script" and (attrs.get("type") or "").lower() == "application/ld+json":
            self.script = []
        if tag == "meta":
            key = (attrs.get("property") or attrs.get("name") or "").lower()
            content = attrs.get("content", "")
            self.meta.setdefault(key, []).append(content)
            if key in ("og:image", "og:image:url", "og:image:secure_url") and len(self.open_graph_images) < 100:
                self.open_graph_images.append({"url": content, "kind": "open_graph"})
            elif key == "og:image:alt" and self.open_graph_images:
                self.open_graph_images[-1]["alt_text"] = content
        if tag == "img" and len(self.images) < 100:
            url = attrs.get("src") or attrs.get("data-src")
            if url:
                self.images.append({"url": url, "alt_text": attrs.get("alt", ""), "kind": "html"})
        if tag == "a" and len(self.images) < 100:
            href = attrs.get("href") or ""
            if re.search(r"\.(?:jpe?g|png|webp|avif)(?:[?#]|$)", href, re.IGNORECASE):
                self.images.append({"url": href, "alt_text": attrs.get("title", ""), "kind": "html"})

    def handle_endtag(self, tag):
        if self.inert_tags:
            if tag == self.inert_tags[-1]:
                self.inert_tags.pop()
            return
        if tag == "title":
            self.in_title = False
        if tag == "script" and self.script is not None:
            self.json_scripts.append("".join(self.script))
            self.script = None

    def handle_data(self, data):
        if self.inert_tags:
            return
        if self.in_title:
            self.title.append(data)
        if self.script is not None:
            self.script.append(data)


BUSINESS_TYPES = {
    "LocalBusiness", "EventVenue", "CivicStructure", "Place", "Organization",
    "Restaurant", "Hotel", "Resort", "FoodEstablishment", "LodgingBusiness",
}


def business_nodes(scripts):
    found = []
    for script in scripts[:30]:
        try:
            value = json.loads(script)
        except (ValueError, RecursionError):
            continue
        queue = [(value, 0)]
        visited = 0
        while queue and visited < 1000:
            item, depth = queue.pop()
            visited += 1
            if depth > 20:
                continue
            if isinstance(item, list):
                queue.extend((child, depth + 1) for child in reversed(item[:1000]))
            elif isinstance(item, dict):
                types = item.get("@type", [])
                types = [types] if isinstance(types, str) else types
                if isinstance(types, list) and any(
                    isinstance(kind, str) and kind.rsplit("/", 1)[-1].rsplit(":", 1)[-1] in BUSINESS_TYPES for kind in types
                ):
                    found.append(item)
                # Only traverse graph/main entities, never unrelated reviews or offers.
                for key in ("@graph", "mainEntity"):
                    if key in item:
                        queue.append((item[key], depth + 1))
    return found


def candidate_url(value, base):
    if not isinstance(value, str) or not value.strip():
        return ""
    try:
        return resolve_url(base, value.strip())
    except MetadataImportError:
        return ""


def extract_metadata(html, source_url):
    source_url = normalize_url(source_url)
    parser = MetadataHTMLParser()
    try:
        parser.feed(html)
        parser.close()
    except (AssertionError, ValueError):
        pass
    nodes = business_nodes(parser.json_scripts)
    business = next((node for node in nodes if "EventVenue" in str(node.get("@type", ""))), nodes[0] if nodes else {})

    def meta(key):
        return next(filter(None, map(plain, parser.meta.get(key, []))), "")

    og_title = meta("og:title")
    og_description = meta("og:description")
    name = plain(business.get("name"), 150) or og_title[:150] or plain(" ".join(parser.title), 150)
    description = plain(business.get("description")) or og_description or meta("description")
    address = business.get("address")
    if isinstance(address, dict):
        country = address.get("addressCountry")
        if isinstance(country, dict):
            country = country.get("name")
        address = ", ".join(filter(None, [
            plain(address.get("streetAddress")), plain(address.get("addressLocality")),
            plain(address.get("addressRegion")), plain(address.get("postalCode")),
            plain(country),
        ]))
    address = plain(address) or ", ".join(filter(None, (
        meta("business:contact_data:street_address"), meta("business:contact_data:locality"),
        meta("business:contact_data:region"), meta("business:contact_data:postal_code"),
        meta("business:contact_data:country_name"),
    )))
    phone = plain(business.get("telephone"), 100) or meta("business:contact_data:phone_number")[:100]
    image_base = candidate_url(parser.base_href, source_url) or source_url
    raw_images = parser.open_graph_images + parser.images
    for node in nodes:
        images = node.get("image", [])
        images = images if isinstance(images, list) else [images]
        for item in images[:100]:
            if isinstance(item, str):
                raw_images.append({"url": item, "kind": "json_ld"})
            elif isinstance(item, dict):
                creator = item.get("creator", "")
                if isinstance(creator, dict):
                    creator = creator.get("name", "")
                raw_images.append({
                    "url": item.get("contentUrl") or item.get("url"), "kind": "json_ld",
                    "alt_text": item.get("caption") or item.get("description", ""),
                    "credit": item.get("creditText") or creator,
                    "copyright": item.get("copyrightNotice", ""),
                    "license_url": candidate_url(item.get("license"), image_base),
                })
    images = {}
    for raw in raw_images:
        url = candidate_url(raw.get("url"), image_base)
        if not url or (url not in images and len(images) >= 100):
            continue
        candidate = images.setdefault(url, {
            "image_url": url, "source_url": source_url, "alt_text": "",
            "credit": "", "copyright": "", "license_url": "", "origins": [],
        })
        for field in ("alt_text", "credit", "copyright", "license_url"):
            value = raw.get(field, "") if field == "license_url" else plain(raw.get(field))
            candidate[field] = candidate[field] or value
        if raw["kind"] not in candidate["origins"]:
            candidate["origins"].append(raw["kind"])
    metadata = {
        "source_url": source_url, "name": name, "description": description,
        "address": address, "phone": phone, "images": list(images.values()),
        "open_graph": {
            "title": og_title, "description": og_description,
            "image_urls": [url for url, image in images.items() if "open_graph" in image["origins"]],
        },
    }
    if not any((name, description, address, phone, images)):
        fail("missing_metadata")
    return metadata


def import_venue_metadata(url, *, limits=ImportLimits()):
    """Return {ok, metadata, error}; extracted text and URLs remain untrusted."""
    try:
        fetched = fetch_html(url, limits=limits)
        metadata = extract_metadata(fetched.html, fetched.source_url)
        return {"ok": True, "metadata": metadata, "error": None}
    except MetadataImportError as error:
        return {"ok": False, "metadata": None, "error": {"code": error.code, "message": error.message}}
