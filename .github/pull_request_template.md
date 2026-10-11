<!--
  Thanks for contributing! Keep it short and concrete — the checklist below is
  what reviewers actually use.
-->

## What and why

<!-- One or two sentences. Link the issue this closes, if any: "Closes #123". -->

## How it was verified

<!--
  Paste the commands you ran, with the outcome. `npm run check` covers
  formatting, lint, manifest/locale/message validation and the test suite.
-->

```
$ npm run check
```

For anything that only a real browser can show (startup suspend, popup flows,
wake-up state restore), describe the manual steps and what you observed.

## Checklist

- [ ] `npm run check` passes locally
- [ ] Behaviour changes are covered by a test, or the PR explains why they cannot be
- [ ] New user-visible strings exist in **both** `src/_locales/en` and `src/_locales/zh_CN`
- [ ] No new files were added to `src/` that are not referenced by the manifest or by code
- [ ] `docs/ARCHITECTURE.md` / an ADR was updated if this changes the design
- [ ] `CHANGELOG.md` has an entry under `[Unreleased]`
- [ ] No new permission was added to `src/manifest.json` — **or** the PR argues why it is unavoidable

## Screenshots

<!-- Required for popup/options changes; delete otherwise. -->
