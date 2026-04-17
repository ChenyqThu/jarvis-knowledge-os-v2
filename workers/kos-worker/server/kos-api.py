#!/usr/bin/env python3
"""
KOS API Server — Lightweight HTTP wrapper over kos CLI.

Runs on Mac mini, exposes kos operations to the Notion Worker.
Uses only Python stdlib (same pattern as llm-runner.py).

Usage:
  python3 kos-api.py [--port 7720] [--token YOUR_TOKEN]

Endpoints:
  POST /query    { "question": "..." }
  POST /ingest   { "url": "...", "slug": "..." }
  GET  /digest   ?since=7
  GET  /status
  GET  /health
"""

import http.server
import json
import os
import subprocess
import sys
import urllib.parse
from pathlib import Path

# ─── Config ───

KOS_ROOT = Path(__file__).resolve().parent.parent.parent.parent
KOS_CLI = KOS_ROOT / "kos"
PORT = int(os.environ.get("KOS_API_PORT", "7720"))
TOKEN = os.environ.get("KOS_API_TOKEN", "")


def strip_ansi(text: str) -> str:
    """Remove ANSI escape codes from CLI output."""
    import re
    return re.sub(r'\033\[[0-9;]*m', '', text)


def run_kos(args: list[str], timeout: int = 300) -> tuple[int, str]:
    """Run a kos CLI command and return (exit_code, output)."""
    cmd = [str(KOS_CLI)] + args
    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=timeout,
            cwd=str(KOS_ROOT),
        )
        output = strip_ansi(result.stdout + result.stderr)
        return result.returncode, output
    except subprocess.TimeoutExpired:
        return 1, f"Command timed out after {timeout}s"
    except Exception as e:
        return 1, f"Error: {e}"


class KOSHandler(http.server.BaseHTTPRequestHandler):
    def _check_auth(self) -> bool:
        if not TOKEN:
            return True
        auth = self.headers.get("Authorization", "")
        if auth == f"Bearer {TOKEN}":
            return True
        self._respond(401, {"error": "unauthorized"})
        return False

    def _respond(self, code: int, data: dict | str):
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        if isinstance(data, str):
            data = {"result": data}
        self.wfile.write(json.dumps(data, ensure_ascii=False).encode())

    def _read_body(self) -> dict:
        length = int(self.headers.get("Content-Length", 0))
        if length == 0:
            return {}
        raw = self.rfile.read(length)
        return json.loads(raw)

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        self.end_headers()

    def do_GET(self):
        if not self._check_auth():
            return

        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        params = urllib.parse.parse_qs(parsed.query)

        if path == "/health":
            self._respond(200, {"status": "ok", "kos_root": str(KOS_ROOT)})

        elif path == "/status":
            code, output = run_kos(["status"], timeout=30)
            self._respond(200 if code == 0 else 500, output)

        elif path == "/digest":
            since = params.get("since", ["7"])[0]
            code, output = run_kos(["digest", "--since", since], timeout=30)
            self._respond(200 if code == 0 else 500, output)

        else:
            self._respond(404, {"error": f"unknown endpoint: {path}"})

    def do_POST(self):
        if not self._check_auth():
            return

        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path

        if path == "/query":
            body = self._read_body()
            question = body.get("question", "")
            if not question:
                self._respond(400, {"error": "question is required"})
                return
            code, output = run_kos(["query", question], timeout=120)
            self._respond(200 if code == 0 else 500, output)

        elif path == "/ingest":
            body = self._read_body()
            url = body.get("url", "")
            if not url:
                self._respond(400, {"error": "url is required"})
                return
            args = ["ingest", url]
            slug = body.get("slug")
            if slug:
                args.append(slug)
            code, output = run_kos(args, timeout=300)
            self._respond(200 if code == 0 else 500, output)

        else:
            self._respond(404, {"error": f"unknown endpoint: {path}"})

    def log_message(self, format, *args):
        """Suppress default logging noise; only log errors."""
        if args and "404" in str(args[0]):
            super().log_message(format, *args)


def main():
    global PORT, TOKEN

    # Parse CLI args
    args = sys.argv[1:]
    i = 0
    while i < len(args):
        if args[i] == "--port" and i + 1 < len(args):
            PORT = int(args[i + 1])
            i += 2
        elif args[i] == "--token" and i + 1 < len(args):
            TOKEN = args[i + 1]
            i += 2
        else:
            i += 1

    server = http.server.HTTPServer(("127.0.0.1", PORT), KOSHandler)
    print(f"KOS API server listening on http://127.0.0.1:{PORT}")
    print(f"KOS root: {KOS_ROOT}")
    print(f"Auth: {'token required' if TOKEN else 'none (dev mode)'}")
    print(f"Endpoints: /query /ingest /digest /status /health")

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down.")
        server.server_close()


if __name__ == "__main__":
    main()
