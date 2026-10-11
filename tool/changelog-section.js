#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Print one version's section of CHANGELOG.md, for use as GitHub release notes.
 *
 * Usage: node tool/changelog-section.js 1.1.0
 *
 * Exits non-zero when the version has no section, so a release cannot silently
 * ship without notes.
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CHANGELOG = path.join(ROOT, 'CHANGELOG.md');

const version = process.argv[2];
if (!version) {
  console.error('Usage: node tool/changelog-section.js <version>');
  process.exit(2);
}

const text = fs.readFileSync(CHANGELOG, 'utf8');
const lines = text.split('\n');

const isHeadingFor = (line) => {
  const match = line.match(/^##\s+\[([^\]]+)\]/);
  return match ? match[1] === version : false;
};

const start = lines.findIndex(isHeadingFor);
if (start === -1) {
  console.error(`CHANGELOG.md has no section for version ${version}`);
  process.exit(1);
}

let end = lines.length;
for (let i = start + 1; i < lines.length; i++) {
  if (/^##\s+\[/.test(lines[i])) {
    end = i;
    break;
  }
}

const body = lines
  .slice(start + 1, end)
  .join('\n')
  .trim();
if (!body) {
  console.error(`CHANGELOG.md section for ${version} is empty`);
  process.exit(1);
}

console.log(body);
