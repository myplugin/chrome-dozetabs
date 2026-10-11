#!/usr/bin/env node

/**
 * Chrome Extension Package Script (Node.js)
 * Usage: node build.js [version]
 *
 * This script packages the Chrome extension into a zip file
 * ready for Chrome Web Store submission.
 */

const fs = require('fs');
const path = require('path');

// Configuration
const PROJECT_ROOT = path.resolve(__dirname, '..');
const SRC_DIR = path.join(PROJECT_ROOT, 'src');
const DIST_DIR = path.join(PROJECT_ROOT, 'dist');
const EXTENSION_NAME = 'tab-sleep';

// Parse version from argument or manifest.json
function getVersion() {
  const argVersion = process.argv[2];
  if (argVersion) return argVersion;

  const manifestPath = path.join(SRC_DIR, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  return manifest.version;
}

// Get all files recursively
function getAllFiles(dir, baseDir = dir) {
  const files = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...getAllFiles(fullPath, baseDir));
    } else {
      files.push({
        path: fullPath,
        relativePath: path.relative(baseDir, fullPath)
      });
    }
  }
  return files;
}

// Create zip file using system tools (no external dependency).
// Uses PowerShell on Windows, zip command on Unix.
async function createZipSimple(sourceDir, outputPath) {
  const { createReadStream, createWriteStream, promises: fsp } = require('fs');
  const { pipeline } = require('stream/promises');
  const zlib = require('zlib');

  // Use PowerShell on Windows, zip command on Unix
  const { execSync } = require('child_process');

  if (process.platform === 'win32') {
    execSync(`powershell -Command "Compress-Archive -Path '${sourceDir}\\*' -DestinationPath '${outputPath}' -Force"`, {
      stdio: 'inherit'
    });
  } else {
    execSync(`cd "${sourceDir}" && zip -r "${outputPath}" .`, {
      stdio: 'inherit'
    });
  }
}

// Main build function
async function build() {
  const version = getVersion();
  const packageName = `${EXTENSION_NAME}-v${version}`;
  const packageDir = path.join(DIST_DIR, packageName);
  const zipFile = path.join(DIST_DIR, `${packageName}.zip`);

  console.log('========================================');
  console.log('Chrome Extension Package Builder');
  console.log('========================================');
  console.log(`Project: ${PROJECT_ROOT}`);
  console.log(`Version: ${version}`);
  console.log(`Package: ${packageName}`);
  console.log('========================================');

  // Step 1: Clean dist directory
  console.log('[1/4] Cleaning dist directory...');
  if (fs.existsSync(DIST_DIR)) {
    fs.rmSync(DIST_DIR, { recursive: true });
  }
  fs.mkdirSync(DIST_DIR, { recursive: true });

  // Step 2: Copy extension files
  console.log('[2/4] Copying extension files...');
  fs.mkdirSync(packageDir, { recursive: true });
  copyDir(SRC_DIR, packageDir);

  // Step 3: Remove unnecessary files
  console.log('[3/4] Removing unnecessary files...');
  removeFiles(packageDir, ['.map', '.DS_Store', 'Thumbs.db']);

  // Step 4: Create zip file
  console.log('[4/4] Creating zip file...');
  await createZipSimple(packageDir, zipFile);

  // Cleanup
  fs.rmSync(packageDir, { recursive: true });

  console.log('========================================');
  console.log('Build completed successfully!');
  console.log(`Output: ${zipFile}`);
  console.log('========================================');

  // Show file info
  const stats = fs.statSync(zipFile);
  console.log(`Size: ${(stats.size / 1024).toFixed(2)} KB`);
}

// Copy directory recursively
function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

// Remove files with specific extensions/names
function removeFiles(dir, patterns) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      removeFiles(fullPath, patterns);
    } else {
      for (const pattern of patterns) {
        if (entry.name.endsWith(pattern) || entry.name === pattern) {
          fs.unlinkSync(fullPath);
          break;
        }
      }
    }
  }
}

// Run build
build().catch(err => {
  console.error('Build failed:', err.message);
  process.exit(1);
});
