#!/usr/bin/env python3
"""Real-browser verification of the extension.

Loads `src/` into a real Chromium browser and checks the things that unit tests
structurally cannot: that the manifest actually loads, that the popup and
options pages render in a browser, that the capture function still works inside
a live page, and that the wake-up restore handshake round-trips.

Usage:
    python scripts/verify-in-browser.py [--channel msedge|chrome] [--port 8235] [--keep-open]

Requires: Python 3.11+, Playwright, and a desktop Chrome/Edge install.
Exits 0 only when every check passes.

Deliberately does **not** exercise `chrome.tabs.discard()`: under Playwright the
discard tears down the browser session in some environments, so the discard and
wake paths are covered by the unit/integration suite and by the manual
acceptance procedure in docs/STARTUP-SUSPEND-TEST.md.
"""

from __future__ import annotations

import argparse
import asyncio
import os
import shutil
import sys
import tempfile

from playwright.async_api import async_playwright

import _browser as B

FORM_PAGE = """<!doctype html><html><head><meta charset="utf-8">
<title>Form Probe</title><link rel="icon" href="/icon.svg"></head><body style="margin:0">
<div style="height:4000px">
  <h1 id="heading">restore probe</h1>
  <input id="field" name="field" value="">
  <textarea id="notes" name="notes"></textarea>
  <select id="pick" name="pick"><option value="a">a</option><option value="b">b</option></select>
  <input type="password" id="secret" name="secret" value="">
</div>
</body></html>"""

EXPECTED_SETTINGS = {
    "excludeAudibleTabs": True,
    "excludePinnedTabs": True,
    "preserveFormData": True,
    "preserveScrollPosition": True,
    "showBadge": True,
    "confirmSleepAll": True,
    "autoSleepEnabled": False,
    "autoSleepTimeout": 30,
    "startupSuspendEnabled": True,
    "startupIncludePinned": False,
}

EXPECTED_LOCALE_KEYS = 91


async def run(args: argparse.Namespace) -> int:
    report = B.Report()
    profile = os.path.join(tempfile.gettempdir(), "tab-sleep-browser-verify")
    shutil.rmtree(profile, ignore_errors=True)

    B.kill_browser_for_profile(profile)

    ICON_SVG = (
        b'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16">'
        b'<rect width="16" height="16" fill="#188038"/></svg>'
    )

    with B.LocalServer(
        args.port,
        pages={"/form": FORM_PAGE.encode("utf-8"), "/icon.svg": ICON_SVG},
    ) as server:
        async with async_playwright() as pw:
            ctx = await B.launch(pw, profile, channel=args.channel)
            page_errors: list[str] = []
            ctx.on("page", lambda page: page.on("pageerror", lambda e: page_errors.append(str(e))))

            try:
                driver, ext_id = await B.open_driver(ctx)
                B.log(f"extension id: {ext_id}")

                # ---------------------------------------------------- boot
                manifest = await driver.evaluate("() => chrome.runtime.getManifest()")
                report.check("manifest loads with a version", bool(manifest.get("version")), manifest.get("version"))
                report.equal("manifest is MV3", manifest.get("manifest_version"), 3)
                # ADR-0008: nothing may be injected into every page any more. The
                # restore script is injected on demand, once a tab has loaded.
                report.check(
                    "no permanently-injected content script",
                    "content_scripts" not in manifest,
                    str(manifest.get("content_scripts")),
                )

                # ------------------------------------------------- defaults
                stored = await driver.evaluate(
                    "async () => (await chrome.storage.local.get('settings')).settings || {}"
                )
                for key, expected in EXPECTED_SETTINGS.items():
                    report.equal(f"default {key}", stored.get(key), expected)

                whitelist = await driver.evaluate(
                    "async () => (await chrome.storage.local.get('whitelist')).whitelist || []"
                )
                report.check("whitelist is seeded", len(whitelist) > 0, f"{len(whitelist)} entries")

                session_keys = await driver.evaluate(
                    "async () => Object.keys(await chrome.storage.session.get(null))"
                )
                report.check("chrome.storage.session is usable", isinstance(session_keys, list))

                # --------------------------------------------------- popup
                form_page = await ctx.new_page()
                form_page.on("pageerror", lambda e: page_errors.append(str(e)))
                await form_page.goto(server.url("/form"), wait_until="load")

                popup = await ctx.new_page()
                popup.on("pageerror", lambda e: page_errors.append(str(e)))
                await popup.goto(f"chrome-extension://{ext_id}/popup/popup.html")
                await asyncio.sleep(2)

                popup_state = await popup.evaluate(
                    """() => ({
                        rows: document.querySelectorAll('.tab-item').length,
                        sleepButtons: document.querySelectorAll('.sleep-btn').length,
                        lockButtons: document.querySelectorAll('.lock-btn').length,
                        brand: (document.querySelector('.brand') || {}).textContent || '',
                        refreshTitle: (document.getElementById('refreshList') || {}).title || '',
                        viewLabels: [...document.querySelectorAll('.view-tab .tab-label')].map(e => e.textContent),
                        activeCount: (document.getElementById('activeCount') || {}).textContent,
                    })"""
                )
                report.check("popup renders at least one tab row", popup_state["rows"] >= 1, str(popup_state["rows"]))
                report.equal("popup renders one sleep button per row", popup_state["sleepButtons"], popup_state["rows"])
                report.equal("popup renders one lock button per row", popup_state["lockButtons"], popup_state["rows"])
                report.check("popup applies translations", bool(popup_state["brand"]) and popup_state["brand"] != "extName", popup_state["brand"])
                report.check("popup translates tooltips", bool(popup_state["refreshTitle"]) and popup_state["refreshTitle"] != "refresh")
                report.check("popup translates the view tabs", all(label.strip() for label in popup_state["viewLabels"]), str(popup_state["viewLabels"]))

                # ---------------------------------------------- favicons
                # The privacy promise is "zero network requests". Icons must come
                # from the browser's own _favicon endpoint, never a remote fetch.
                favicon_state = await popup.evaluate(
                    """async () => {
                        const endpoint = chrome.runtime.getURL('/_favicon/');
                        const images = [...document.querySelectorAll('.tab-favicon')];
                        const probe = new Image();
                        const loaded = await new Promise((resolve) => {
                            probe.onload = () => resolve(true);
                            probe.onerror = () => resolve(false);
                            const url = new URL(endpoint);
                            url.searchParams.set('pageUrl', location.href);
                            url.searchParams.set('size', '32');
                            probe.src = url.toString();
                            setTimeout(() => resolve(false), 3000);
                        });
                        return {
                            images: images.length,
                            allLocal: images.every(i => i.src.startsWith(endpoint) || i.src.startsWith('data:')),
                            anyRemote: images.some(i => /^https?:/i.test(i.src)),
                            hasFaviconPermission: chrome.runtime.getManifest().permissions.includes('favicon'),
                            probeLoaded: loaded,
                        };
                    }"""
                )
                report.check(
                    "popup never loads an icon over the network",
                    favicon_state["allLocal"] and not favicon_state["anyRemote"],
                    str(favicon_state),
                )
                report.check(
                    "manifest declares the favicon permission",
                    favicon_state["hasFaviconPermission"],
                )
                report.check(
                    "the built-in favicon endpoint serves an image",
                    favicon_state["probeLoaded"],
                    "Chrome returned an icon for this page",
                )

                # ------------------------------------------------- options
                options = await ctx.new_page()
                options.on("pageerror", lambda e: page_errors.append(str(e)))
                await options.goto(f"chrome-extension://{ext_id}/options/options.html")
                await asyncio.sleep(1.5)

                options_state = await options.evaluate(
                    """() => ({
                        toggles: document.querySelectorAll('input[type=checkbox]').length,
                        hasConfirmToggle: !!document.getElementById('confirmSleepAll'),
                        version: (document.getElementById('versionText') || {}).textContent || '',
                        whitelistRows: document.querySelectorAll('.whitelist-item').length,
                        sections: document.querySelectorAll('.settings-section h2').length,
                    })"""
                )
                report.check("options renders every toggle", options_state["toggles"] == len(EXPECTED_SETTINGS) - 1, str(options_state["toggles"]))
                report.check("options has the confirm-before-batch toggle", options_state["hasConfirmToggle"])
                report.equal("options shows the manifest version", options_state["version"], f"v{manifest['version']}")
                report.equal("options lists the seeded whitelist", options_state["whitelistRows"], len(whitelist))
                report.check("options renders its sections", options_state["sections"] >= 5, str(options_state["sections"]))

                # ------------------------------------------------- capture
                tab_id = await driver.evaluate(
                    "async (url) => { const [t] = await chrome.tabs.query({ url }); return t ? t.id : null; }",
                    server.url("/form"),
                )
                report.check("found the form tab", isinstance(tab_id, int), str(tab_id))

                await form_page.fill("#field", "captured-value")
                await form_page.fill("#notes", "captured notes")
                await form_page.select_option("#pick", "b")
                await form_page.fill("#secret", "must-not-be-stored")
                await form_page.evaluate("window.scrollTo(0, 900)")
                await asyncio.sleep(0.4)

                # The real module, through the real API, in a real page.
                captured = await driver.evaluate(
                    """async (tabId) => {
                        const mod = await import('../background/tab-state.js');
                        const results = await chrome.scripting.executeScript({
                            target: { tabId },
                            func: mod.captureTabState,
                            args: [true, true]
                        });
                        return results[0].result;
                    }""",
                    tab_id,
                )
                report.equal("capture reads the scroll position", captured.get("scrollPosition"), {"x": 0, "y": 900})
                report.equal("capture reads a text input", captured["formData"].get("field"), "captured-value")
                report.equal("capture reads a textarea", captured["formData"].get("notes"), "captured notes")
                report.equal("capture reads a select", captured["formData"].get("pick"), "b")
                report.check("capture never stores passwords", "secret" not in captured["formData"], str(sorted(captured["formData"])))

                # ------------------------------------------- restore handshake
                await driver.evaluate(
                    """async ([tabId, state]) => {
                        const store = await chrome.storage.local.get('sleepingTabs');
                        const sleepingTabs = store.sleepingTabs || {};
                        sleepingTabs[tabId] = state;
                        await chrome.storage.local.set({ sleepingTabs });
                    }""",
                    [
                        tab_id,
                        {
                            "tabId": tab_id,
                            "originalUrl": server.url("/form"),
                            "title": "Form Probe",
                            "sleptAt": 1,
                            "scrollPosition": {"x": 0, "y": 1200},
                            "formData": {"field": "restored-value", "notes": "restored notes", "pick": "a"},
                        },
                    ],
                )

                await form_page.reload(wait_until="load")
                await asyncio.sleep(2.5)

                restored = await form_page.evaluate(
                    """() => ({
                        scrollY: window.scrollY,
                        field: document.getElementById('field').value,
                        notes: document.getElementById('notes').value,
                        pick: document.getElementById('pick').value,
                    })"""
                )
                report.equal("wake restores the scroll position", restored["scrollY"], 1200)
                report.equal("wake restores an input", restored["field"], "restored-value")
                report.equal("wake restores a textarea", restored["notes"], "restored notes")
                report.equal("wake restores a select", restored["pick"], "a")

                remaining = await driver.evaluate(
                    "async (id) => ((await chrome.storage.local.get('sleepingTabs')).sleepingTabs || {})[id] ?? null",
                    tab_id,
                )
                report.check("captured state is consumed exactly once", remaining is None, str(remaining))

                await form_page.reload(wait_until="load")
                await asyncio.sleep(2)
                replayed = await form_page.evaluate("() => document.getElementById('field').value")
                report.check("a later reload does not replay stale input", replayed != "restored-value", repr(replayed))

                # -------------------------------------------------- hygiene
                report.check("no uncaught page errors", not page_errors, "; ".join(page_errors[:3]))

                if args.keep_open:
                    B.log("\n--keep-open: leaving the browser up for 60s")
                    await asyncio.sleep(60)
            finally:
                await ctx.close()

            B.kill_browser_for_profile(profile)

    exit_code = report.finish()
    return exit_code


def main() -> int:
    B.configure_stdout()
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--channel", default=B.DEFAULT_CHANNEL, help="Playwright browser channel (default: msedge)")
    parser.add_argument("--port", type=int, default=8235, help="localhost port for the probe pages")
    parser.add_argument("--keep-open", action="store_true", help="leave the browser open for a minute")
    args = parser.parse_args()

    B.log("Tab Sleep - real-browser verification")
    B.log(f"extension: {B.EXT_DIR}")
    B.log("")
    return asyncio.run(run(args))


if __name__ == "__main__":
    sys.exit(main())
