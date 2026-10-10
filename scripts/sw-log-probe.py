"""One-off probe: does the extension SW initialise cleanly in a real Edge?

Attaches to the already-running Edge (launched with
--user-data-dir=<profile> --load-extension=src), finds the extension service
worker, dumps its console messages and evaluates a small status snippet.
"""

import asyncio
import os
import sys

from playwright.async_api import async_playwright

PROFILE = os.path.join(os.environ["TEMP"], "tab-sleep-ycheck-probe")

# A fresh profile must NOT be locked by another Edge instance.
import subprocess
subprocess.run(
    ["powershell", "-NoProfile", "-Command",
     'Get-CimInstance Win32_Process -Filter "Name=\'msedge.exe\'" | '
     'Where-Object { $_.CommandLine -like "*tab-sleep-ycheck-probe*" } | '
     'ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }'],
    capture_output=True,
)
import time
time.sleep(3)

if os.path.isdir(PROFILE):
    import shutil
    shutil.rmtree(PROFILE, ignore_errors=True)


async def main():
    async with async_playwright() as pw:
        ctx = await pw.chromium.launch_persistent_context(
            PROFILE,
            channel="msedge",
            headless=False,
            args=[
                "--no-first-run",
                "--no-default-browser-check",
                # re-enable the extension loading Playwright disables by default
                "--enable-extensions",
                f"--disable-extensions-except={os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'src')}",
                f"--load-extension={os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'src')}",
            ],
            viewport={"width": 1280, "height": 800},
        )
        logs = []
        ctx.on("console", lambda m: logs.append(f"[{m.type}] {m.text}"))

        # Wait for the extension's service worker to appear.
        sw = None
        for _ in range(60):
            for w in ctx.service_workers:
                if w.url.endswith("background/service-worker.js"):
                    sw = w
                    break
            if sw:
                break
            await asyncio.sleep(0.5)
        if not sw:
            print("SERVICE WORKER NOT FOUND")
            await ctx.close()
            sys.exit(1)

        print(f"service worker: {sw.url}")

        # Give the SW a moment to finish its top-level init, then probe state.
        await asyncio.sleep(2)
        try:
            info = await sw.evaluate(
                """async () => {
                    const [settings, session, lastErr] = await Promise.all([
                        chrome.storage.local.get('settings'),
                        chrome.storage.session.get(null),
                        Promise.resolve(chrome.runtime.lastError)
                    ]);
                    const activeTabs = await chrome.tabs.query({});
                    return {
                        startupSuspendEnabled: settings?.settings?.startupSuspendEnabled,
                        startupIncludePinned: settings?.settings?.startupIncludePinned,
                        autoSleepEnabled: settings?.settings?.autoSleepEnabled,
                        session,
                        tabCount: activeTabs.length,
                    };
                }"""
            )
            print("STATE:", info)
        except Exception as e:
            print("EVALUATE FAILED:", e)

        # Badge update should not throw.
        try:
            badge = await sw.evaluate("""async () => {
                await new Promise(r => {
                    chrome.action.getBadgeText({}, txt => r(txt));
                });
                return chrome.runtime.lastError?.message ?? null;
            }""")
            print("BADGE OK, lastError:", badge)
        except Exception as e:
            print("BADGE CHECK FAILED:", e)

        print("\n--- SW console messages ---")
        for line in logs:
            print(line)

        await ctx.close()


asyncio.run(main())
