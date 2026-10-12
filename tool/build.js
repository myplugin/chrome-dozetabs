#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createZip } from './zip.js';

/**
 * Package `src/` into a Chrome Web Store ready ZIP.
 *
 * Usage: node tool/build.js [--version <x.y.z>]
 *        npm run build
 *
 * The archive contains the extension files at its root (`manifest.json`, not
 * `dozetabs-v1.0.0/manifest.json`) — the store rejects a nested top-level
 * directory. Run `npm run check` first; this script deliberately does not
 * re-implement the validator.
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC_DIR = path.join(ROOT, 'src');
const DIST_DIR = path.join(ROOT, 'dist');
const EXTENSION_NAME = 'dozetabs';

/** Files that never belong in a store package. */
const IGNORED_SUFFIXES = ['.map', '.md', '.DS_Store', 'Thumbs.db', '.gitkeep'];

const args = process.argv.slice(2);
const versionIndex = args.indexOf('--version');

function resolveVersion() {
  const fromArgs = versionIndex === -1 ? null : args[versionIndex + 1];
  if (fromArgs) return fromArgs;
  return readManifest().version;
}

function readManifest() {
  const manifestPath = path.join(SRC_DIR, 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`src/manifest.json not found (looked in ${SRC_DIR})`);
  }
  return JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
}

function collectFiles(dir, baseDir = dir) {
  const files = [];

  for (const entry of fs
    .readdirSync(dir, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name))) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectFiles(full, baseDir));
      continue;
    }
    if (IGNORED_SUFFIXES.some((suffix) => entry.name.endsWith(suffix))) continue;
    files.push({
      name: path.relative(baseDir, full).split(path.sep).join('/'),
      data: fs.readFileSync(full),
      date: fs.statSync(full).mtime
    });
  }

  return files;
}

function build() {
  const manifest = readManifest();
  const version = resolveVersion();
  const entries = collectFiles(SRC_DIR);

  if (entries.length === 0) throw new Error('src/ contains no files to package');

  const requiredEntries = ['manifest.json'];
  for (const name of requiredEntries) {
    if (!entries.some((entry) => entry.name === name)) {
      throw new Error(`the package would be missing ${name}`);
    }
  }

  const zip = createZip(entries);
  const packageName = `${EXTENSION_NAME}-v${version}`;
  const zipPath = path.join(DIST_DIR, `${packageName}.zip`);

  console.log('========================================');
  console.log('Dozetabs — extension packager');
  console.log('========================================');
  console.log(`Manifest version : ${manifest.version}`);
  console.log(`Package version  : ${version}`);
  console.log(`Files            : ${entries.length}`);
  console.log('========================================');

  fs.rmSync(DIST_DIR, { recursive: true, force: true });
  fs.mkdirSync(DIST_DIR, { recursive: true });
  fs.writeFileSync(zipPath, zip);

  const sizeKb = (zip.length / 1024).toFixed(2);
  console.log(`Output           : ${path.relative(ROOT, zipPath).split(path.sep).join('/')}`);
  console.log(`Size             : ${sizeKb} KB`);
  console.log('========================================');
  console.log('Entries are stored at the archive root — ready to upload.');
}

try {
  build();
} catch (error) {
  console.error(`Build failed: ${error.message}`);
  process.exit(1);
}
