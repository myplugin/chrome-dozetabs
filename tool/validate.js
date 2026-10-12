#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Repository validator — the one command that guarantees the extension is
 * internally consistent, run locally and in CI (`npm run validate`).
 *
 * It catches the class of mistakes that a browser only reports at runtime:
 * a manifest pointing at a file that no longer exists, a locale key that only
 * one language has, a message type that is declared but never handled, a version
 * that drifted between `manifest.json` and `package.json`, or a documented branch
 * name that no longer exists.
 *
 * Usage: node tool/validate.js [--only manifest|i18n|privacy|messages|branch|links] [--json]
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'src');
const LOCALES = path.join(SRC, '_locales');

const args = process.argv.slice(2);
const onlyIndex = args.indexOf('--only');
const ONLY = onlyIndex === -1 ? null : args[onlyIndex + 1];
const AS_JSON = args.includes('--json');

const errors = [];
const warnings = [];
const notes = [];

function fail(section, message) {
  errors.push(`[${section}] ${message}`);
}

function warn(section, message) {
  warnings.push(`[${section}] ${message}`);
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function walk(dir, filter) {
  // Tolerate a missing directory: the tree changes over time, and a hard crash
  // here reads like a validator bug rather than a real problem.
  if (!fs.existsSync(dir)) return [];

  const results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) results.push(...walk(full, filter));
    else if (!filter || filter(full)) results.push(full);
  }
  return results;
}

function rel(file) {
  return path.relative(ROOT, file).split(path.sep).join('/');
}

// ---------------------------------------------------------------------------
// manifest
// ---------------------------------------------------------------------------

const manifestPath = path.join(SRC, 'manifest.json');
const manifest = readJson(manifestPath);
const pkg = readJson(path.join(ROOT, 'package.json'));

function validateManifest() {
  if (manifest.manifest_version !== 3) {
    fail('manifest', `manifest_version must be 3, found ${manifest.manifest_version}`);
  }

  for (const key of ['name', 'version', 'description', 'default_locale']) {
    if (!manifest[key]) fail('manifest', `missing required key: ${key}`);
  }

  if (manifest.version !== pkg.version) {
    fail(
      'manifest',
      `version mismatch: manifest.json has ${manifest.version}, package.json has ${pkg.version}`
    );
  }

  // Only manifest *file* fields are checked — `matches`, `run_at` and friends
  // hold values that merely look like paths.
  const referenced = [];
  const push = (value) => {
    if (typeof value === 'string') referenced.push(value);
    else if (Array.isArray(value)) value.forEach(push);
    else if (value && typeof value === 'object') Object.values(value).forEach(push);
  };

  push(manifest.background?.service_worker);
  push(manifest.background?.scripts);
  push(manifest.action?.default_popup);
  push(manifest.options_page);
  push(manifest.options_ui?.page);
  push(manifest.devtools_page);
  push(manifest.icons);
  push(manifest.action?.default_icon);
  push(manifest.side_panel?.default_path);
  for (const script of manifest.content_scripts || []) {
    push(script.js);
    push(script.css);
  }
  for (const override of Object.values(manifest.chrome_url_overrides || {})) push(override);

  for (const target of referenced) {
    if (target.startsWith('__MSG_')) continue;
    const full = path.join(SRC, target);
    if (!fs.existsSync(full)) {
      fail('manifest', `referenced file does not exist: ${target}`);
      continue;
    }
    if (fs.statSync(full).size === 0) {
      fail('manifest', `referenced file is empty: ${target}`);
    }
  }

  // Every __MSG_key__ referenced by the manifest must exist in the default locale.
  const defaultLocale = readJson(path.join(LOCALES, manifest.default_locale, 'messages.json'));
  const rawManifest = fs.readFileSync(manifestPath, 'utf8');
  for (const match of rawManifest.matchAll(/__MSG_([A-Za-z0-9_]+)__/g)) {
    if (!(match[1] in defaultLocale)) {
      fail('manifest', `__MSG_${match[1]}__ is not defined in _locales/${manifest.default_locale}`);
    }
  }

  if (!manifest.minimum_chrome_version) {
    warn('manifest', 'minimum_chrome_version is not set');
  }
}

// ---------------------------------------------------------------------------
// i18n
// ---------------------------------------------------------------------------

function collectUsedKeys() {
  const used = new Map(); // key -> first file that uses it

  const record = (key, file) => {
    if (!used.has(key)) used.set(key, rel(file));
  };

  const rawManifest = fs.readFileSync(manifestPath, 'utf8');
  for (const match of rawManifest.matchAll(/__MSG_([A-Za-z0-9_]+)__/g)) {
    record(match[1], manifestPath);
  }

  const sources = walk(SRC, (file) => /\.(html|js)$/.test(file));

  for (const file of sources) {
    const source = fs.readFileSync(file, 'utf8');

    // data-i18n, data-i18n-title, data-i18n-placeholder and any future variant
    for (const match of source.matchAll(/data-i18n(?:-[a-z]+)?="([A-Za-z0-9_]+)"/g)) {
      record(match[1], file);
    }

    // t('key'), t("key"), chrome.i18n.getMessage('key')
    for (const match of source.matchAll(/\bt\(\s*['"]([A-Za-z0-9_]+)['"]/g)) {
      record(match[1], file);
    }
    for (const match of source.matchAll(/getMessage\(\s*['"]([A-Za-z0-9_]+)['"]/g)) {
      record(match[1], file);
    }
  }

  return { used, sources };
}

function validateI18n() {
  const localeDirs = fs
    .readdirSync(LOCALES, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);

  if (localeDirs.length === 0) {
    fail('i18n', 'no locale directories found');
    return;
  }

  /** @type {Object<string, Object>} */
  const locales = {};
  for (const locale of localeDirs) {
    const file = path.join(LOCALES, locale, 'messages.json');
    if (!fs.existsSync(file)) {
      fail('i18n', `_locales/${locale}/messages.json is missing`);
      continue;
    }
    locales[locale] = readJson(file);
  }

  const reference = locales[manifest.default_locale] || locales[localeDirs[0]];
  const referenceKeys = Object.keys(reference);

  for (const [locale, messages] of Object.entries(locales)) {
    if (locale === manifest.default_locale) continue;
    const keys = new Set(Object.keys(messages));

    for (const key of referenceKeys) {
      if (!keys.has(key)) fail('i18n', `${locale} is missing key "${key}"`);
    }
    for (const key of keys) {
      if (!referenceKeys.includes(key)) {
        fail(
          'i18n',
          `${locale} defines "${key}", which is missing from ${manifest.default_locale}`
        );
      }
      if (!messages[key].message) fail('i18n', `${locale}: "${key}" has an empty message`);
    }
  }

  const { used } = collectUsedKeys();
  const defined = new Set(referenceKeys);

  for (const [key, file] of used) {
    if (!defined.has(key)) fail('i18n', `key "${key}" used in ${file} is not defined`);
  }

  // Keys referenced indirectly (e.g. through a mapping table of string
  // literals) would otherwise look unused; that is debt, not breakage.
  const allLiterals = new Set();
  for (const file of walk(SRC, (f) => f.endsWith('.js'))) {
    const source = fs.readFileSync(file, 'utf8');
    for (const match of source.matchAll(/['"]([A-Za-z0-9_]+)['"]/g)) allLiterals.add(match[1]);
  }

  const unused = referenceKeys.filter((key) => !used.has(key) && !allLiterals.has(key));
  if (unused.length > 0) {
    warn('i18n', `defined but never referenced: ${unused.join(', ')}`);
  }

  notes.push(
    `i18n: ${referenceKeys.length} keys, ${localeDirs.length} locales (${localeDirs.join(', ')})`
  );
}

// ---------------------------------------------------------------------------
// privacy invariants
// ---------------------------------------------------------------------------

/**
 * Strip comments so that prose *about* network calls never trips the gate.
 *
 * Heuristic on purpose: it skips `//` that follows a `:` so that `https://…`
 * survives. It may therefore leave an unusual literal untouched — that errs
 * toward reporting, which is the safe direction for a gate.
 * @param {string} source
 * @returns {string}
 */
function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

/**
 * The extension promises (README, PRIVACY.md, and the Chrome Web Store privacy
 * declaration) that it makes **no network requests**. A promise nobody checks is
 * a promise that eventually breaks — so check it here.
 */
function validatePrivacy() {
  const sources = walk(SRC, (file) => file.endsWith('.js'));

  for (const file of sources) {
    const source = stripComments(fs.readFileSync(file, 'utf8'));

    if (/\bfetch\s*\(/.test(source)) {
      fail('privacy', `${rel(file)} calls fetch() — the extension must not make network requests`);
    }
    if (/\bXMLHttpRequest\b|\bnew\s+WebSocket\b|\bnavigator\.sendBeacon\b/.test(source)) {
      fail('privacy', `${rel(file)} can open a network connection`);
    }
  }

  // The built-in favicon endpoint only works with the matching permission.
  const manifestText = stripComments(fs.readFileSync(manifestPath, 'utf8'));
  const declaresFavicon = manifestText.includes('"favicon"');
  const usesFaviconEndpoint = sources.some((file) =>
    stripComments(fs.readFileSync(file, 'utf8')).includes('/_favicon/')
  );

  if (usesFaviconEndpoint && !declaresFavicon) {
    fail(
      'privacy',
      'src/ uses /_favicon/ but manifest.json does not declare the "favicon" permission'
    );
  }
  if (declaresFavicon && !usesFaviconEndpoint) {
    warn('privacy', 'the "favicon" permission is declared but /_favicon/ is never used');
  }

  notes.push('privacy: no network calls in src/, favicon served by the browser');
}

// ---------------------------------------------------------------------------
// message protocol
// ---------------------------------------------------------------------------

function validateMessages() {
  const constantsFile = path.join(SRC, 'utils', 'constants.js');
  const constants = fs.readFileSync(constantsFile, 'utf8');

  const block = constants.match(/export const MESSAGE_TYPES = \{([\s\S]*?)\n\};/);
  if (!block) {
    fail('messages', 'could not find MESSAGE_TYPES in src/utils/constants.js');
    return;
  }

  /** @type {Map<string, string>} name -> wire value */
  const declared = new Map();
  for (const match of block[1].matchAll(/^\s*([A-Z_]+):\s*'([^']+)'/gm)) {
    declared.set(match[1], match[2]);
  }

  const routerFile = path.join(SRC, 'background', 'router.js');
  const router = fs.readFileSync(routerFile, 'utf8');

  const handled = new Set();
  for (const match of router.matchAll(/\[MESSAGE_TYPES\.([A-Z_]+)\]/g)) {
    handled.add(match[1]);
    if (!declared.has(match[1])) {
      fail('messages', `router handles MESSAGE_TYPES.${match[1]}, which is not declared`);
    }
  }

  for (const name of declared.keys()) {
    if (!handled.has(name)) {
      fail('messages', `MESSAGE_TYPES.${name} is declared but never handled in router.js`);
    }
  }

  // The content script was removed (ADR-0008): every page-context function is now
  // injected from the worker, so there is no longer any file that cannot import
  // constants.js — and with it, no place for a message literal to drift.
  notes.push(`messages: ${declared.size} message types, all handled`);
}

// ---------------------------------------------------------------------------
// branch references
// ---------------------------------------------------------------------------

/**
 * Git plumbing, or null when this is not a checkout (an exported tarball, a
 * container that ships the sources only, …). Every git-based check below
 * degrades to a skip rather than a failure.
 * @param {string[]} args
 * @returns {string|null}
 */
function git(args) {
  try {
    return execFileSync('git', args, {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    });
  } catch {
    return null;
  }
}

/** @type {string|null|undefined} */
let trackedCache;
/**
 * Tracked files, one per line, or null outside a checkout. Memoised because the
 * repository-wide sections below all need the same list.
 * @returns {string|null}
 */
function trackedFiles() {
  if (trackedCache === undefined) trackedCache = git(['ls-files']);
  return trackedCache;
}

/**
 * Docs and workflow config name a branch in a few purely mechanical places:
 * `github.com/<owner>/<repo>/blob/<branch>/…` links, `git push origin <branch>`
 * commands, `refs/heads/<branch>` refspecs. A wrong name there survives review
 * because it looks completely ordinary — the link 404s and the copy-pasted
 * command dies with `src refspec <branch> does not match any`. (This rule exists
 * because exactly that shipped: seven references said `main` while the repository
 * default was `master`, including the documented release command.)
 *
 * Deliberately narrow: it only inspects positions where a branch name is
 * unambiguous, so prose like "cut a `feat/xxx` branch" is not mistaken for one.
 */
function validateBranches() {
  const patterns = [
    /(?<![\w.-])github\.com\/[^\s/]+\/[^\s/]+\/(?:blob|tree|raw)\/([A-Za-z0-9._/-]+?)\//g,
    /git push +[A-Za-z0-9_.-]+ +([A-Za-z0-9._/-]+)/g,
    /refs\/heads\/([A-Za-z0-9._/-]+)/g
  ];

  const listing = trackedFiles();
  if (listing === null) {
    notes.push('branch: skipped (not a git checkout)');
    return;
  }

  const files = listing
    .split('\n')
    .filter((name) => /\.(md|ya?ml)$/i.test(name))
    .map((name) => path.join(ROOT, name));

  /** @type {Map<string, string>} branch name -> first place that names it */
  const referenced = new Map();
  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8');
    for (const pattern of patterns) {
      for (const match of source.matchAll(pattern)) {
        if (!referenced.has(match[1])) referenced.set(match[1], rel(file));
      }
    }
  }

  if (referenced.size === 0) {
    notes.push('branch: no branch references to check');
    return;
  }

  const fallback = defaultBranch();
  const known = knownBranches();

  if (fallback === null && known === null) {
    notes.push('branch: skipped (this checkout cannot tell which branches exist)');
    return;
  }

  for (const [branch, file] of referenced) {
    const ok = branch === fallback || (known !== null && known.has(branch));
    if (!ok) {
      fail(
        'branch',
        `${file} names the branch "${branch}", which does not exist in this repository`
      );
    }
  }

  notes.push(`branch: ${referenced.size} reference(s) point at existing branches`);
}

/**
 * The repository's default branch as this checkout knows it, or null.
 *
 * Two sources, in order of authority:
 *
 * 1. **`DEFAULT_BRANCH`** — CI passes `github.event.repository.default_branch`.
 *    A CI checkout fetches a *single* ref, so its branch list is useless for
 *    deciding anything, but this value is exactly the ground truth the rule needs.
 * 2. **`refs/remotes/<remote>/HEAD`** — the symref a normal `git clone` sets.
 *    Absent in CI checkouts and in `git init` repositories, which is precisely why
 *    it is a usable signal for "this is a real clone".
 *
 * Enumerating branches is deliberately *not* the primary evidence. It was, and it
 * broke CI twice in a row: a CI checkout contains only the ref it fetched, so
 * `master` looked like a name that "does not exist" on every pull request **and**
 * on every push to a feature branch — the rule would have blocked all
 * contributions while passing locally, where a full clone masks the problem.
 * A gate that cannot be certain must not fail.
 * @returns {string|null}
 */
function defaultBranch() {
  const fromEnv = (process.env.DEFAULT_BRANCH || '').trim();
  if (fromEnv) return fromEnv;

  const remotes = configuredRemotes();
  const refs = git(['for-each-ref', '--format=%(refname:short) %(symref)', 'refs/remotes']);

  for (const line of (refs || '').split('\n')) {
    const [name, symref] = line.trim().split(/\s+/);
    if (!symref) continue;
    const remote = (name || '').match(/^([^/]+)\/HEAD$/);
    if (!remote || !remotes.includes(remote[1])) continue;
    const target = symref.match(/^refs\/remotes\/[^/]+\/(.+)$/);
    if (target) return target[1];
  }

  return null;
}

/** @returns {string[]} configured remote names */
function configuredRemotes() {
  return (git(['remote']) || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

/**
 * Remote-tracking branches of *configured* remotes — i.e. the branches this
 * checkout can be trusted to know about, or null when it cannot answer at all.
 *
 * Used to accept legitimate references to a *non-default* branch (say a long-lived
 * `blob/release-1.x/` link). It is never used on its own to conclude that a branch
 * is missing; see `defaultBranch()` for why.
 * @returns {Set<string>|null}
 */
function knownBranches() {
  const remotes = configuredRemotes();
  if (remotes.length === 0) return null;

  const refs = git(['for-each-ref', '--format=%(refname)', 'refs/remotes']);

  const known = new Set();
  for (const ref of (refs || '').split('\n')) {
    const match = ref.trim().match(/^refs\/remotes\/([^/]+)\/(.+)$/);
    if (!match) continue;
    if (!remotes.includes(match[1])) continue; // e.g. refs/remotes/pull/4/merge
    if (match[2] === 'HEAD') continue;
    known.add(match[2]);
  }

  return known.size > 0 ? known : null;
}

// ---------------------------------------------------------------------------
// documentation links
// ---------------------------------------------------------------------------

/**
 * Relative links between Markdown files are the connective tissue of the docs,
 * and the easiest thing to break: deleting a file or renaming a section leaves
 * every pointer to it silently dead, and a dead pointer costs a reader exactly
 * the thing the docs existed to give them. (This rule exists because exactly that
 * shipped — ADR-0004 still linked to `src/content/content-script.js` long after
 * ADR-0008 deleted it.)
 *
 * Only relative paths are resolved against the filesystem. External URLs are
 * deliberately **not** fetched: a validator that talks to the network fails when
 * the network does, and `npm run validate` must stay offline.
 */
function validateLinks() {
  const listing = trackedFiles();
  if (listing === null) {
    notes.push('links: skipped (not a git checkout)');
    return;
  }

  const files = listing.split('\n').filter((name) => /\.md$/i.test(name));

  let checked = 0;
  for (const name of files) {
    const file = path.join(ROOT, name);
    const source = fs.readFileSync(file, 'utf8');

    for (const match of source.matchAll(/\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
      // Skip absolute URLs (`https:`, `mailto:`, …) and pure anchors.
      if (/^(?:[a-z][a-z0-9+.-]*:|#)/i.test(match[1])) continue;

      const target = match[1].split('#')[0];
      if (!target) continue;

      checked++;
      const resolved = path.resolve(path.dirname(file), decodeURIComponent(target));
      if (!fs.existsSync(resolved)) {
        fail('links', `${name} links to "${target}", which does not exist`);
      }
    }
  }

  notes.push(`links: ${checked} relative link(s) in ${files.length} Markdown file(s) resolve`);
}

// ---------------------------------------------------------------------------
// runner
// ---------------------------------------------------------------------------

const SECTIONS = {
  manifest: validateManifest,
  i18n: validateI18n,
  privacy: validatePrivacy,
  messages: validateMessages,
  branch: validateBranches,
  links: validateLinks
};

if (ONLY && !SECTIONS[ONLY]) {
  console.error(`Unknown section "${ONLY}". Expected one of: ${Object.keys(SECTIONS).join(', ')}`);
  process.exit(2);
}

const selected = ONLY ? { [ONLY]: SECTIONS[ONLY] } : SECTIONS;

for (const run of Object.values(selected)) {
  run();
}

if (AS_JSON) {
  console.log(JSON.stringify({ errors, warnings, notes }, null, 2));
} else {
  for (const note of notes) console.log(`  ok    ${note}`);
  for (const message of warnings) console.log(`  warn  ${message}`);
  for (const message of errors) console.error(`  FAIL  ${message}`);
  console.log(
    `\n${errors.length} error(s), ${warnings.length} warning(s) — validate ${ONLY || 'all'}`
  );
}

process.exit(errors.length > 0 ? 1 : 0);
