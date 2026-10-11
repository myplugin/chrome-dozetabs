"""Shared helpers for the real-browser scripts.

Everything here is Windows-first (Edge + PowerShell) because that is the
environment the project is developed and validated in; the browser parts work
anywhere Playwright does.

Two lessons are baked in, both learned the hard way:

1. **Never hold on to a Playwright `Worker` object.** The MV3 service worker is
   terminated when idle, which invalidates the handle. Interact through an
   *extension page* instead (`open_driver`): extension pages are stable targets
   and expose the same `chrome.*` APIs.
2. **Unknown Chromium switches are silently ignored.** Only the real flags do
   anything; `--load-extension` and `--disable-extensions-except` are the pair
   that actually loads an unpacked extension.
"""

from __future__ import annotations

import os
import subprocess
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
EXT_DIR = os.path.join(ROOT, "src")

# The extension's service worker, relative to the extension root.
SERVICE_WORKER_PATH = "background/service-worker.js"

DEFAULT_CHANNEL = "msedge"
DEFAULT_PROCESS_NAME = "msedge.exe"


# --------------------------------------------------------------------------- io


def log(message: str) -> None:
    print(message, flush=True)


def configure_stdout() -> None:
    """Make Chinese/emoji output survive a non-UTF-8 Windows console."""
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):
        pass


class Report:
    """Collects check results and turns them into an honest exit code."""

    def __init__(self) -> None:
        self.checks: list[tuple[str, bool, str]] = []

    def check(self, name: str, passed: bool, detail: str = "") -> bool:
        self.checks.append((name, bool(passed), detail))
        mark = "PASS" if passed else "FAIL"
        log(f"  {mark}  {name}" + (f"  ({detail})" if detail else ""))
        return bool(passed)

    def equal(self, name: str, actual, expected) -> bool:
        return self.check(name, actual == expected, f"expected {expected!r}, got {actual!r}")

    def finish(self) -> int:
        failed = [name for name, ok, _ in self.checks if not ok]
        log("")
        if failed:
            log(f"FAILED: {len(failed)} of {len(self.checks)} checks")
            for name in failed:
                log(f"  - {name}")
            return 1
        log(f"OK: {len(self.checks)} checks passed")
        return 0


# ------------------------------------------------------------------- processes


def run_powershell(command: str, timeout: int = 60) -> subprocess.CompletedProcess:
    return subprocess.run(
        ["powershell", "-NoProfile", "-Command", command],
        capture_output=True,
        text=True,
        timeout=timeout,
        check=False,
    )


def kill_browser_for_profile(profile: str, process_name: str = DEFAULT_PROCESS_NAME) -> None:
    """Force-kill only the browser processes belonging to `profile`.

    Matching on the profile path keeps the user's own browser windows untouched.
    """
    if sys.platform == "win32":
        run_powershell(
            f"Get-CimInstance Win32_Process -Filter \"Name='{process_name}'\" | "
            f"Where-Object {{ $_.CommandLine -like '*{profile}*' }} | "
            "ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"
        )
    else:
        subprocess.run(["pkill", "-f", profile], check=False)
    time.sleep(3)


def profile_process_count(profile: str, process_name: str = DEFAULT_PROCESS_NAME) -> int:
    if sys.platform != "win32":
        result = subprocess.run(["pgrep", "-fc", profile], capture_output=True, text=True, check=False)
        return int(result.stdout.strip() or 0)
    out = run_powershell(
        "@(Get-CimInstance Win32_Process -Filter "
        f"\"Name='{process_name}'\" | Where-Object {{ $_.CommandLine -like '*{profile}*' }}).Count"
    )
    try:
        return int(out.stdout.strip() or 0)
    except ValueError:
        return -1


def profile_memory_mb(profile: str, process_name: str = DEFAULT_PROCESS_NAME) -> float:
    """Working-set total (MB) for the browser processes of one profile.

    Scoped to the profile on purpose: summing every browser process on the
    machine over-reports when the user has other windows open.
    """
    out = run_powershell(
        "(Get-CimInstance Win32_Process -Filter "
        f"\"Name='{process_name}'\" | Where-Object {{ $_.CommandLine -like '*{profile}*' }} | "
        "Measure-Object WorkingSetSize -Sum).Sum / 1MB"
    )
    try:
        return round(float(out.stdout.strip()), 1)
    except ValueError:
        return -1.0


# ----------------------------------------------------------------------- http


class _Handler(BaseHTTPRequestHandler):
    page = b"<!doctype html><title>probe</title><h1>probe</h1>"

    def do_GET(self):  # noqa: N802 - BaseHTTPRequestHandler API
        body = self.server.page_for(self.path)
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):
        pass


class LocalServer:
    """Throwaway localhost server, so no probe depends on the public network."""

    def __init__(self, port: int, pages: dict[str, bytes] | None = None, default: bytes | None = None):
        self.port = port
        self._pages = pages or {}
        self._default = default or b"<!doctype html><title>plain</title><h1>plain</h1>"
        self._server: ThreadingHTTPServer | None = None

    def page_for(self, path: str) -> bytes:
        for prefix, body in self._pages.items():
            if path.startswith(prefix):
                return body
        return self._default

    def __enter__(self) -> "LocalServer":
        server = ThreadingHTTPServer(("127.0.0.1", self.port), _Handler)
        server.page_for = self.page_for  # type: ignore[attr-defined]
        self._server = server
        threading.Thread(target=server.serve_forever, daemon=True).start()
        return self

    def __exit__(self, *exc) -> None:
        if self._server is not None:
            self._server.shutdown()

    def url(self, path: str = "/") -> str:
        return f"http://127.0.0.1:{self.port}{path}"


# ------------------------------------------------------------------- browser


def launch(pw, profile: str, *, restore_session: bool = False, channel: str = DEFAULT_CHANNEL,
           extra_args: tuple[str, ...] = ()):
    """Launch a persistent browser context with the unpacked extension loaded."""
    args = [
        f"--disable-extensions-except={EXT_DIR}",
        f"--load-extension={EXT_DIR}",
        "--no-first-run",
        "--no-default-browser-check",
        # Keep the browser's own tab sleeping out of the measurement.
        "--disable-features=msSleepingTabs,msEdgeStartupBoost",
        *extra_args,
    ]
    if restore_session:
        args.append("--restore-last-session")

    return pw.chromium.launch_persistent_context(
        profile,
        channel=channel,
        headless=False,  # extensions require a headed browser
        args=args,
        viewport={"width": 1280, "height": 800},
    )


def find_service_worker(ctx, timeout: float = 30.0):
    """Return the extension's service worker *once*, for reading its URL only.

    Do not keep the returned object: use `open_driver` for interaction.
    """
    deadline = time.time() + timeout
    while time.time() < deadline:
        for worker in ctx.service_workers:
            if worker.url.endswith(SERVICE_WORKER_PATH):
                return worker
        time.sleep(0.25)
    return None


async def open_driver(ctx, timeout: float = 30.0):
    """Open an extension page to act as a stable control surface.

    Returns `(page, extension_id)`. The page is an ordinary extension page, so
    `chrome.tabs`, `chrome.storage` and `chrome.scripting` are all available —
    and unlike the service worker it will not be recycled under us.
    """
    import asyncio

    worker = None
    deadline = time.time() + timeout
    while time.time() < deadline:
        worker = find_service_worker(ctx, timeout=1)
        if worker:
            break
        await asyncio.sleep(0.25)

    if worker is None:
        raise RuntimeError("Extension service worker never appeared")

    ext_id = worker.url.split("/")[2]
    driver = await ctx.new_page()
    await driver.goto(f"chrome-extension://{ext_id}/options/options.html")
    return driver, ext_id
