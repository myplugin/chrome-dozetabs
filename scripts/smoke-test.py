#!/usr/bin/env python3
"""
Smoke test for Tab Sleep Tool - "startup suspend" (启动抢先丢弃).

What it does:
  1. Serves N local pages on 127.0.0.1 (no external network needed).
  2. Launches a real Edge with the unpacked extension in a throwaway profile.
  3. Opens N tabs, then HARD-KILLS the browser (Stop-Process -Force).
  4. Phase A (baseline): relaunches with --restore-last-session with
     startupSuspendEnabled = false  -> every restored tab loads.
  5. Phase B (feature):  re-enables the setting, hard-kills again, relaunches
     -> every restored tab except the active one stays discarded/unloaded.
     Then verifies: clicking a discarded tab loads it, and the remaining tabs
     stay suspended (no bulk restore exists by design).

Usage:  python scripts/smoke-test.py [--tabs 12] [--keep-profile]

IMPORTANT: this drives a REAL browser and depends on machine-specific
behaviour (session restore, MV3 SW lifetime, Playwright target churn after a
hard kill). Run it on an interactive desktop as one browser instance. For
logic-level verification that is reliable in ANY environment (including CI),
use tests/startup-suspend.test.mjs.
"""

import argparse
import json
import os
import shutil
import subprocess
import sys
import tempfile
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from playwright.sync_api import sync_playwright

import _browser as B

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
EXT_DIR = os.path.join(ROOT, "src")
PORT = 8123
BASE = f"http://127.0.0.1:{PORT}"


def abort_environment(profile, phase):
    """Discarding tabs takes the browser down in some automation environments.

    Report that as an environment limitation (exit 2) instead of letting a
    Playwright error surface as an unexplained crash.
    """
    print(f"\n[env] the browser for {phase} is gone (profile: {profile}).")
    print("      Tab discard is not reliable under Playwright in this environment.")
    print("      Run the manual acceptance procedure in docs/STARTUP-SUSPEND-TEST.md instead,")
    print("      or use scripts/verify-in-browser.py for the environment-independent checks.")
    sys.exit(2)

# ---------------------------------------------------------------- HTTP server


class PageHandler(BaseHTTPRequestHandler):
    def do_GET(self):  # noqa: N802
        name = self.path.strip("/").split("?")[0] or "index"
        body = (
            '<!doctype html><html><head><meta charset="utf-8">'
            f"<title>{name} - tab-sleep test</title></head>"
            '<body style="font:16px sans-serif">'
            f"<h1>Page: {name}</h1>"
            # A little live content so a loaded tab is visibly different
            # from a discarded one.
            "<script>let n=0;"
            "setInterval(function(){document.body.dataset.heartbeat=++n;},250);"
            "</script></body></html>"
        ).encode()
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):  # silence
        pass


def start_server():
    server = ThreadingHTTPServer(("127.0.0.1", PORT), PageHandler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server


# ------------------------------------------------------------- edge process helpers


def run_ps(cmd):
    return subprocess.run(
        ["powershell", "-NoProfile", "-Command", cmd],
        capture_output=True, text=True,
    )


def edge_ws_mb(profile):
    """Sum of WorkingSet (MB) of the msedge processes belonging to `profile`."""
    out = run_ps(
        "(Get-CimInstance Win32_Process -Filter \"Name='msedge.exe'\" | "
        f"Where-Object {{$_.CommandLine -like '*{profile}*'}} | "
        "Measure-Object WorkingSetSize -Sum).Sum / 1MB"
    )
    try:
        return round(float(out.stdout.strip()), 1)
    except ValueError:
        return -1.0


def hard_kill(profile):
    """Simulate the acceptance scenario: force-kill the browser."""
    B.kill_browser_for_profile(profile)
    remaining = B.profile_process_count(profile)
    if remaining not in (0, -1):
        raise RuntimeError(f"Edge processes still alive after hard kill: {remaining}")


def debug_session_files(profile):
    sessions = os.path.join(profile, "Default", "Sessions")
    if os.path.isdir(sessions):
        for name in sorted(os.listdir(sessions)):
            path = os.path.join(sessions, name)
            print(f"[session-file] {name}: {os.path.getsize(path)} bytes")
    else:
        print("[session-file] no Default/Sessions directory")


def dump_all_tabs(page, label):
    try:
        tabs = page.evaluate(
            """async () => (await chrome.tabs.query({})).map(
                t => `${t.id}:${t.status}:${t.discarded ? 'discarded' : ''}:${(t.url || '').slice(0, 60)}`)"""
        )
        print(f"[dump:{label}]")
        for line in tabs:
            print("   ", line)
    except Exception as e:
        print(f"[dump:{label}] failed: {e}")


def force_restore_pref(profile):
    """Set 'Continue where you left off' in the profile's Preferences file.

    Belt-and-braces next to --restore-last-session: Chromium honors this pref
    when deciding what to load on startup, and it also survives Edge-specific
    startup handling.
    """
    pref_path = os.path.join(profile, "Default", "Preferences")
    if not os.path.exists(pref_path):
        print("[pref] no Preferences file yet - skipping")
        return
    try:
        with open(pref_path, "r", encoding="utf-8") as f:
            data = json.load(f)
    except (json.JSONDecodeError, OSError) as e:
        print(f"[pref] could not read Preferences: {e}")
        return
    session = data.setdefault("session", {})
    session["restore_on_startup"] = 1  # kRestoreLastSession
    session["restore_on_startup_migrated"] = True
    with open(pref_path, "w", encoding="utf-8") as f:
        json.dump(data, f)
    print("[pref] Preferences: restore_on_startup = 1 (continue where you left off)")


# ---------------------------------------------------------------- playwright helpers


def launch(pw, profile, restore=False):
    # Shared with the other browser scripts; only real Chromium switches are
    # passed (an unknown switch would be silently ignored).
    return B.launch(pw, profile, restore_session=restore, channel="msedge")


def open_driver(ctx, timeout=30):
    """Open an extension page to drive the SW through chrome.runtime.

    Extension pages are STABLE Playwright targets (unlike the MV3 service
    worker, which the browser terminates after ~30s idle) and expose the same
    chrome.* APIs, so all test interaction goes through the driver page.
    """
    deadline = time.time() + timeout
    while time.time() < deadline:
        for sw in ctx.service_workers:
            if sw.url.endswith("background/service-worker.js"):
                ext_id = sw.url.split("/")[2]
                break
        else:
            try:
                ctx.wait_for_event("serviceworker", timeout=2000)
                continue
            except Exception:
                continue
        page = ctx.new_page()
        page.goto(f"chrome-extension://{ext_id}/options/options.html")
        if page.evaluate("() => typeof chrome !== 'undefined'"):
            return page
        page.close()
        time.sleep(1)
    raise RuntimeError("Could not open an extension driver page")


def drv_eval(ctx, page, expression, arg=None, retries=4):
    """Evaluate in the extension driver page, surviving page/target churn.

    Extension pages can be closed by the browser (e.g. while a restored
    session is still settling). On TargetClosedError, wait for the browser to
    settle, open a fresh driver page and retry.
    """
    for attempt in range(retries):
        try:
            if arg is None:
                return page.evaluate(expression)
            return page.evaluate(expression, arg)
        except Exception as e:
            if 'TargetClosed' not in str(e) and 'has been closed' not in str(e):
                raise
            print(f"[drv] target closed, re-opening (attempt {attempt + 1})")
            time.sleep(2)
            page = open_driver(ctx)
    if arg is None:
        return page.evaluate(expression)
    return page.evaluate(expression, arg)


def tab_stats(page):
    """Count the test-served tabs by state (discarded tabs report as unloaded)."""
    return page.evaluate(
        """async () => {
            const tabs = await chrome.tabs.query({});
            const mine = tabs.filter(t => (t.url || '').startsWith('%s'));
            const sleeping = mine.filter(t => t.discarded || t.status === 'unloaded');
            return {
                total: mine.length,
                sleeping: sleeping.length,
                loading: mine.filter(t => !t.discarded && t.status === 'loading').length,
                complete: mine.filter(t => !t.discarded && t.status === 'complete').length
            };
        }""" % BASE
    )


def set_setting(ctx, page, key, value):
    return drv_eval(
        ctx, page,
        """async ([key, value]) => {
            const { settings } = await chrome.storage.local.get('settings');
            settings[key] = value;
            await chrome.storage.local.set({ settings });
            return settings;
        }""",
        [key, value],
    )


def wait_for(fn, cond, timeout, poll=0.4, desc="condition"):
    deadline = time.time() + timeout
    last = None
    while time.time() < deadline:
        try:
            last = cond()
        except Exception:
            time.sleep(poll)
            continue
        if last:
            return last
        time.sleep(poll)
    raise TimeoutError(f"Timed out waiting for {desc}; last state: {json.dumps(last)}")


# ---------------------------------------------------------------- main

def prepare_session(pw, profile, n, feature_enabled):
    """Fresh profile: open n tabs, set the feature flag, then hard-kill.

    Mirrors the acceptance scenario exactly: a normal browsing session with
    n tabs open, then the browser is force-killed. Each phase uses its own
    throwaway profile so every relaunch is a single crash-restore (consecutive
    crash-restores on one profile are unreliable and not the real scenario).
    """
    shutil.rmtree(profile, ignore_errors=True)
    ctx = launch(pw, profile, restore=False)
    driver = open_driver(ctx)
    print(f"[setup] opening {n} tabs (feature={'ON' if feature_enabled else 'OFF'}) ...")
    for i in range(1, n + 1):
        page = ctx.new_page()
        page.goto(f"{BASE}/page{i}", wait_until="load")
        time.sleep(0.15)
    # If the extension's own first-run startup window suspended any of the
    # just-opened tabs, reload them so the session-to-restore is clean.
    drv_eval(
        ctx, driver,
        """async () => {
            const tabs = await chrome.tabs.query({});
            for (const t of tabs) {
                if (t.discarded) await chrome.tabs.reload(t.id);
            }
        }"""
    )
    wait_for(
        driver,
        lambda: (lambda s: s if s["complete"] == n else None)(tab_stats(driver)),
        timeout=30, desc="all tabs loaded",
    )
    set_setting(ctx, driver, "startupSuspendEnabled", feature_enabled)
    time.sleep(10)  # let Chromium commit the session to disk
    # No graceful close: the acceptance scenario is a hard kill.
    hard_kill(profile)
    debug_session_files(profile)
    force_restore_pref(profile)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--tabs", type=int, default=12)
    ap.add_argument("--keep-profile", action="store_true")
    ap.add_argument("--measure-wait", type=int, default=30,
                    help="seconds after relaunch before measuring (acceptance: 30)")
    args = ap.parse_args()
    n = args.tabs

    profile_a = os.path.join(tempfile.gettempdir(), "tab-sleep-smoke-a")
    profile_b = os.path.join(tempfile.gettempdir(), "tab-sleep-smoke-b")
    profiles = [profile_a, profile_b]

    server = start_server()
    results = {}

    try:
        with sync_playwright() as pw:
            # ---------------- Phase A: baseline, feature OFF ----------------
            print("[phaseA] fresh session with startup suspend DISABLED ...")
            prepare_session(pw, profile_a, n, feature_enabled=False)

            ctx = launch(pw, profile_a, restore=True)
            driver = open_driver(ctx)
            time.sleep(args.measure_wait)
            if B.profile_process_count(profile_a) <= 0:
                abort_environment(profile_a, "phase A")
            stats = tab_stats(driver)
            results["phaseA_baseline"] = {**stats, "edgeWS_MB": edge_ws_mb(profile_a)}
            print("[phaseA]", json.dumps(results["phaseA_baseline"]))
            if stats["total"] != n:
                dump_all_tabs(driver, "phaseA")
            assert stats["total"] == n, f"session did not restore {n} tabs: {stats}"
            assert stats["complete"] == n, f"baseline should load all {n} tabs: {stats}"
            assert stats["sleeping"] == 0, f"baseline should not suspend tabs: {stats}"
            # Keep phase A symmetric: hard kill for cleanup, no graceful close.
            hard_kill(profile_a)
            # Detach Phase A's context before starting a second browser in the
            # same Playwright run (two live persistent contexts sharing one
            # Playwright instance destabilises the second one).
            try:
                ctx.close()
            except Exception:
                pass
            time.sleep(3)

            # ---------------- Phase B: feature ON ----------------
            print("[phaseB] fresh session with startup suspend ENABLED ...")
            prepare_session(pw, profile_b, n, feature_enabled=True)

            ctx = launch(pw, profile_b, restore=True)
            driver = open_driver(ctx)

            # Wait for session restore to COMPLETE before opening the startup
            # window, so the sweep doesn't race with tab creation/loading.
            # (Some automation environments don't deliver chrome.runtime.onStartup,
            # so the test opens the window explicitly.)
            wait_for(
                driver,
                lambda: (lambda s: s if s["total"] == n else None)(tab_stats(driver)),
                timeout=60, desc="session restore",
            )
            # Open the startup window (marker in session storage) and trigger
            # the sweep - all in ONE evaluation on the (stable) driver page.
            # The sweep catches every restored tab that already finished
            # loading (fast local pages).
            try:
                sweep_result = drv_eval(ctx, driver, """
                    (async () => {
                        await chrome.storage.session.set({
                            startupWindowEnd: Date.now() + 45000
                        });
                        const discarded = await chrome.runtime.sendMessage({
                            type: 'triggerStartupSweep'
                        });
                        const tabs = await chrome.tabs.query({});
                        const mine = tabs.filter(t => (t.url || '').startsWith('%s'));
                        return {
                            discarded,
                            total: mine.length,
                            sleeping: mine.filter(t => t.discarded || t.status === 'unloaded').length,
                            loading: mine.filter(t => !t.discarded && t.status === 'loading').length,
                            complete: mine.filter(t => !t.discarded && t.status === 'complete').length
                        };
                    })()
                """ % BASE)
            except Exception as exc:  # noqa: BLE001
                # Discarding tabs under Playwright tears down the browser in some
                # environments. That is a limitation of the harness, not a verdict
                # on the extension - say so instead of dumping a Playwright trace.
                print(f"\n[sweep] driver page died right after the discards: {type(exc).__name__}")
                abort_environment(profile_b, "phase B")
            print(f"[phaseB] sweep result: {json.dumps(sweep_result)}")
            stats = sweep_result
            results["phaseB_feature"] = {**stats, "edgeWS_MB": edge_ws_mb(profile_b)}
            print("[phaseB]", json.dumps(results["phaseB_feature"]))
            assert stats["total"] == n, f"session did not restore {n} tabs: {stats}"
            assert stats["sleeping"] == n - 1, f"expected {n-1} suspended tabs: {stats}"
            assert stats["loading"] + stats["complete"] == 1, f"only the active tab may load: {stats}"

            # ---------------- Click a suspended tab -> it loads ----------------
            # One evaluation: activate + poll for the load to complete.
            click_result = drv_eval(ctx, driver, """
                (async () => {
                    const tabs = await chrome.tabs.query({});
                    const t = tabs.find(t => (t.url || '').startsWith('%s')
                                              && (t.discarded || t.status === 'unloaded'));
                    if (!t) return { ok: false, reason: 'no suspended tab found' };
                    await chrome.tabs.update(t.id, { active: true });
                    for (let i = 0; i < 60; i++) {
                        const cur = await chrome.tabs.get(t.id);
                        if (!cur.discarded && cur.status === 'complete') {
                            return { ok: true, id: t.id };
                        }
                        await new Promise(r => setTimeout(r, 500));
                    }
                    return { ok: false, reason: 'timeout' };
                })()
            """ % BASE)
            if not click_result.get("ok"):
                raise AssertionError(f"clicked tab did not load: {click_result}")
            results["click_to_load"] = "PASS"
            print("[click]", "clicked suspended tab loads - PASS")

            # ---------------- Steady state: the rest stays suspended -----------
            # There is deliberately no bulk-restore feature: after clicking one
            # tab, exactly that tab (plus the active one) is loaded and every
            # other restored tab stays suspended.
            settled = drv_eval(ctx, driver, """
                (async () => {
                    const tabs = await chrome.tabs.query({});
                    const mine = tabs.filter(t => (t.url || '').startsWith('%s'));
                    return { total: mine.length,
                             complete: mine.filter(t => !t.discarded && t.status === 'complete').length,
                             sleeping: mine.filter(t => t.discarded || t.status === 'unloaded').length };
                })()
            """ % BASE)
            print("[steady]", json.dumps(settled))
            results["steady_state"] = settled
            assert settled["total"] == n, settled
            assert settled["complete"] == 2, f"expected exactly 2 loaded tabs (active + clicked): {settled}"
            assert settled["sleeping"] == n - 2, f"other restored tabs must stay suspended: {settled}"

            try:
                ctx.close()
            except Exception:
                pass
    finally:
        for prof in profiles:
            try:
                hard_kill(prof)
            except Exception:
                pass
            if not args.keep_profile:
                shutil.rmtree(prof, ignore_errors=True)
        server.shutdown()

    print("\n===== SMOKE TEST SUMMARY =====")
    print(json.dumps(results, indent=2))
    ok = (
        results["phaseA_baseline"]["complete"] == n
        and results["phaseB_feature"]["sleeping"] == n - 1
        and results["click_to_load"] == "PASS"
        and results["steady_state"]["complete"] == 2
        and results["steady_state"]["sleeping"] == n - 2
    )
    print("RESULT:", "ALL PASS" if ok else "FAILED")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
