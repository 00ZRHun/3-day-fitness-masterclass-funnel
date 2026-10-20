#!/usr/bin/env python3
"""Local development server + reservation endpoint for the ApexFitness funnel.

Zero third-party dependencies. Serves the static site and accepts reservations
at POST /api/reserve, appending each lead to data/leads.jsonl.

    python3 server.py --port 4173
"""

from __future__ import annotations

import argparse
import json
import re
import time
import uuid
from collections import defaultdict, deque
from datetime import datetime, timezone
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parent
LEADS_FILE = ROOT / "data" / "leads.jsonl"
MAX_BODY = 32 * 1024
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]{2,}$")
ALLOWED_GOALS = {
    "get-stronger",
    "master-technique",
    "move-pain-free",
    "build-consistency",
}
ALLOWED_EXPERIENCE = {"new", "intermediate", "advanced"}
ALLOWED_PLANS = {"full", "installments"}

# Very small in-memory rate limiter. Good enough for a single-instance demo.
RATE_LIMIT: dict[str, deque[float]] = defaultdict(deque)
RATE_WINDOW_SECONDS = 60
RATE_MAX_REQUESTS = 8

BLOCKED_PREFIXES = ("/.", "/data", "/tools", "/api/")


def clean(value: object, max_length: int) -> str:
    """Return a trimmed string with control characters removed."""
    if not isinstance(value, str):
        return ""
    value = "".join(ch for ch in value if ch >= " " or ch in "\n\t").strip()
    return value[:max_length]


def validate(payload: dict) -> tuple[dict | None, str | None]:
    if not isinstance(payload, dict):
        return None, "Invalid request."

    # Honeypot: real people never fill this field.
    if clean(payload.get("company"), 100):
        return None, "Invalid request."

    name = clean(payload.get("name"), 80)
    email = clean(payload.get("email"), 160).lower()
    phone = clean(payload.get("phone"), 32)
    note = clean(payload.get("note"), 800)
    goal = clean(payload.get("goal"), 40)
    experience = clean(payload.get("experience"), 20)
    plan = clean(payload.get("plan"), 20) or "full"

    if len(name) < 2:
        return None, "Please enter your full name."
    if not EMAIL_RE.match(email):
        return None, "Please enter a valid email address."
    if goal and goal not in ALLOWED_GOALS:
        return None, "Please choose a training goal."
    if experience and experience not in ALLOWED_EXPERIENCE:
        return None, "Please choose your experience level."
    if plan not in ALLOWED_PLANS:
        plan = "full"
    if payload.get("consent") is not True:
        return None, "Please accept the cancellation policy to continue."

    return {
        "name": name,
        "email": email,
        "phone": phone,
        "note": note,
        "goal": goal or None,
        "experience": experience or None,
        "plan": plan,
        "cohort": "014",
    }, None


class FunnelHandler(SimpleHTTPRequestHandler):
    server_version = "ApexFunnel/1.0"

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def translate_path(self, path: str) -> str:
        path = urlparse(path).path
        if any(path.startswith(prefix) for prefix in BLOCKED_PREFIXES):
            return str(ROOT / "__not_found__")
        return super().translate_path(path)

    def end_headers(self) -> None:
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "strict-origin-when-cross-origin")
        self.send_header("X-Frame-Options", "SAMEORIGIN")
        self.send_header(
            "Permissions-Policy", "camera=(), microphone=(), geolocation=()"
        )
        if self.path.startswith("/assets/"):
            self.send_header("Cache-Control", "public, max-age=86400")
        else:
            self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def send_json(self, status: int, payload: dict) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:  # noqa: N802 - stdlib naming
        path = urlparse(self.path).path
        if path == "/api/health":
            self.send_json(HTTPStatus.OK, {"ok": True, "service": "apex-reserve"})
            return
        if path.startswith("/api/"):
            self.send_json(HTTPStatus.NOT_FOUND, {"ok": False, "error": "Not found."})
            return
        super().do_GET()

    def do_POST(self) -> None:  # noqa: N802 - stdlib naming
        if urlparse(self.path).path != "/api/reserve":
            self.send_json(HTTPStatus.NOT_FOUND, {"ok": False, "error": "Not found."})
            return
        ip = self.client_address[0]
        now = time.monotonic()
        bucket = RATE_LIMIT[ip]
        while bucket and now - bucket[0] > RATE_WINDOW_SECONDS:
            bucket.popleft()
        if len(bucket) >= RATE_MAX_REQUESTS:
            self.send_json(
                HTTPStatus.TOO_MANY_REQUESTS,
                {"ok": False, "error": "Too many attempts. Please try again shortly."},
            )
            return
        bucket.append(now)

        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            length = 0
        if length <= 0 or length > MAX_BODY:
            self.send_json(
                HTTPStatus.BAD_REQUEST, {"ok": False, "error": "Invalid request."}
            )
            return

        try:
            payload = json.loads(self.rfile.read(length).decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            self.send_json(
                HTTPStatus.BAD_REQUEST, {"ok": False, "error": "Invalid request."}
            )
            return

        lead, error = validate(payload)
        if error:
            self.send_json(HTTPStatus.UNPROCESSABLE_ENTITY, {"ok": False, "error": error})
            return

        reservation_id = f"APX-{uuid.uuid4().hex[:6].upper()}"
        record = {
            "id": reservation_id,
            "received_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            **lead,
        }

        LEADS_FILE.parent.mkdir(parents=True, exist_ok=True)
        with LEADS_FILE.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(record) + "\n")

        self.send_json(
            HTTPStatus.CREATED,
            {
                "ok": True,
                "id": reservation_id,
                "emailSent": False,
                "message": "Reservation received.",
            },
        )

    def send_error(self, code, message=None, explain=None):
        # Serve the branded 404 for missing pages. Missing assets and API
        # responses keep the standard, machine-readable error.
        path = urlparse(getattr(self, "path", "/")).path
        if code == 404 and not path.startswith(("/assets/", "/api/")):
            body = (ROOT / "404.html").read_bytes()
            self.send_response(HTTPStatus.NOT_FOUND)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            if self.command != "HEAD":
                self.wfile.write(body)
            return
        super().send_error(code, message, explain)

    def log_message(self, fmt: str, *args) -> None:
        # Keep mailbox addresses and request bodies out of the console.
        print(f"[{self.log_date_time_string()}] {self.address_string()} {fmt % args}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Serve the ApexFitness funnel.")
    parser.add_argument("--port", type=int, default=4173)
    parser.add_argument("--bind", default="127.0.0.1")
    args = parser.parse_args()

    server = ThreadingHTTPServer((args.bind, args.port), FunnelHandler)
    print(f"ApexFitness funnel running at http://{args.bind}:{args.port}")
    print("Reservations append to data/leads.jsonl")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down.")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
