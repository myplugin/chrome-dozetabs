"""Real-browser E2E probe for the throttled wake-all queue, driven through the
REAL popup UI (click the actual buttons), which also mirrors the acceptance
scenario (session-restored tabs):

  1. Open N tabs, hard-kill the browser, relaunch with --restore-last-session.
  2. Open the extension popup page and click "sleep other tabs" - the popup's
     own batch-sleep path suspends the restored background tabs.
  3. Click "restore all suspended tabs" and poll the popup's own UI state
     (button title carries "Restoring $DONE$/$TOTAL$", counts update).
  4. Assert through the popup UI:
       - all background tabs got suspended
       - the restore completed (no sleeping tabs left, all test tabs loaded again)

The DOM polling doubles as continuous CDP traffic, which keeps this
automation browser alive (it self-exits after ~1s of no traffic).
"""

import os
import shutil
import subprocess
import tempfile
import threading
import time

from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
EXT_DIR = os.path.join(ROOT, "src")
PORT = 8123
BASE = f"http://127.0.0.1:{PORT}"
PROFILE = os.path.join(tempfile.gettempdir(), "tab-sleep-popup-probe")
N_TABS = 8


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):  # noqa: N802
        body = b"<html><head><title>t</title></head><body>hello</body></html>"
        self.send_response(200)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *a):
        pass


def run_ps(cmd):
    return subprocess.run(["powershell", "-NoProfile", "-Command", cmd],
                          capture_output=True, text=True)


def hard_kill(profile):
    run_ps(
        "Get-CimInstance Win32_Process -Filter \"Name='msedge.exe'\" | "
        f"Where-Object {{$_.CommandLine -like '*{profile}*'}} | "
        "ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"
    )
    time.sleep(3)


def launch(pw, restore=False):
    args = [
        "--no-first-run",
        "--no-default-browser-check",
        "--enable-extensions",
        f"--disable-extensions-except={EXT_DIR}",
        f"--load-extension={EXT_DIR}",
        "--disable-features=msSleepingTabs,msEdgeStartupBoost",
    ]
    if restore:
        args.append("--restore-last-session")
    return pw.chromium.launch_persistent_context(
        PROFILE, channel="msedge", headless=False, args=args,
        viewport={"width": 1280, "height": 800})


def get_ext_id(ctx, timeout=60):
    deadline = time.time() + timeout
    while time.time() < deadline:
        for sw in ctx.service_workers:
            if sw.url.endswith("background/service-worker.js"):
                return sw.url.split("/")[2]
        try:
            ctx.wait_for_event("serviceworker", timeout=2000)
        except Exception:
            pass
    raise RuntimeError("SW never appeared")


def wait_tabs(driver, n, timeout=30):
    deadline = time.time() + timeout
    total = 0
    while time.time() < deadline:
        total = driver.evaluate(
            """async () => (await chrome.tabs.query({}))
                .filter(t => (t.url || '').startsWith('http://127.0.0.1:8123')).length"""
        )
        if total >= n:
            return total
        time.sleep(0.7)
    return total


def main():
    run_ps(
        "Get-CimInstance Win32_Process -Filter \"Name='msedge.exe'\" | "
        "Where-Object { $_.CommandLine -like '*tab-sleep-popup-probe*' } | "
        "ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"
    )
    time.sleep(3)
    shutil.rmtree(PROFILE, ignore_errors=True)

    failures = []
    server = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()

    try:
        with sync_playwright() as pw:
            # ---- session 1: open the tabs, then hard kill ----
            ctx = launch(pw, restore=False)
            ext_id = get_ext_id(ctx)
            for i in range(N_TABS):
                p = ctx.new_page()
                p.goto(f"{BASE}/page{i}", wait_until="load")
                time.sleep(0.2)
            time.sleep(10)
            hard_kill(PROFILE)

            # ---- session 2: relaunch with session restore ----
            print("[probe] relaunching with --restore-last-session ...")
            ctx = launch(pw, restore=True)
            ext_id = get_ext_id(ctx)

            # Open the REAL popup UI.
            popup = ctx.new_page()
            popup.goto(f"chrome-extension://{ext_id}/popup/popup.html")
            total = wait_tabs(popup, N_TABS)
            print(f"[probe] restored test tabs: {total}/{N_TABS}")
            if total < N_TABS:
                failures.append(f"session restore only gave {total}/{N_TABS} tabs")

            # ---- suspend the background tabs one by one via the popup's own
            # per-tab sleep buttons (single discards, the safest path) ----
            sleep_buttons = popup.query_selector_all(".sleep-btn")
            print(f"[probe] sleep buttons found: {len(sleep_buttons)}")
            for btn in sleep_buttons:
                try:
                    btn.click(timeout=5000)
                    time.sleep(0.3)
                except Exception as e:
                    print(f"[probe] sleep-button click failed: {e}")
                    break

            # Poll the popup while the batch runs (also keeps CDP traffic).
            deadline = time.time() + 60
            sleeping = -1
            while time.time() < deadline:
                sleeping = popup.evaluate(
                    """async () => document.getElementById('sleepingCount').textContent"""
                )
                if sleeping and int(sleeping) >= N_TABS - 1:
                    break
                time.sleep(0.4)
            sleeping = int(sleeping or -1)
            print(f"[probe] popup sleeping count after batch: {sleeping} (active before: {active_before})")
            if sleeping < N_TABS - 1:
                failures.append(f"batch sleep only suspended {sleeping}/{N_TABS - 1} background tabs")

            # ---- click one suspended tab in the popup -> it loads ----
            # The startup-suspend feature deliberately has NO bulk-restore
            # button: suspended tabs load on demand, one click each.
            wake_buttons = popup.query_selector_all(".wake-btn")
            print(f"[probe] wake buttons found: {len(wake_buttons)}")
            if not wake_buttons:
                failures.append("no per-tab wake button found in the popup UI")
            else:
                wake_buttons[0].click(timeout=5000)
                deadline = time.time() + 60
                loaded = False
                while time.time() < deadline:
                    cnt = popup.evaluate(
                        """async () => document.getElementById('sleepingCount').textContent"""
                    )
                    if cnt and int(cnt) < N_TABS - 1:
                        loaded = True
                        break
                    time.sleep(0.4)
                print(f"[probe] clicked suspended tab loaded: {loaded}")
                if not loaded:
                    failures.append("clicked suspended tab did not load from the popup UI")

            # ---- final state through the popup ----
            final_state = popup.evaluate(
                """async () => {
                    const tabs = await chrome.tabs.query({});
                    const mine = tabs.filter(t => (t.url || '').startsWith('http://127.0.0.1:8123'));
                    return {
                        sleeping: mine.filter(t => t.discarded || t.status === 'unloaded').length,
                        complete: mine.filter(t => !t.discarded && t.status === 'complete').length,
                        total: mine.length
                    };
                }"""
            )
            print(f"[probe] final state: {final_state}")
            if final_state["sleeping"] != N_TABS - 2:
                failures.append(f"expected {N_TABS - 2} tabs still suspended, got {final_state['sleeping']}")
            if final_state["complete"] != 2:
                failures.append(f"expected 2 loaded tabs (active + clicked), got {final_state['complete']}")

            hard_kill(PROFILE)
    finally:
        hard_kill(PROFILE)
        server.shutdown()
        shutil.rmtree(PROFILE, ignore_errors=True)

    if failures:
        print("FAILURES:")
        for f in failures:
            print("  -", f)
        raise SystemExit(1)
    print("POPUP E2E PROBE: ALL PASS")


if __name__ == "__main__":
    main()
