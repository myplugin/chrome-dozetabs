#!/bin/bash

# Chrome Extension Package Script
# Usage: ./build.sh [version]

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
SRC_DIR="$PROJECT_ROOT/src"
DIST_DIR="$PROJECT_ROOT/dist"

# Get version from argument or manifest.json
if [ -n "$1" ]; then
    VERSION="$1"
else
    VERSION=$(grep '"version"' "$SRC_DIR/manifest.json" | sed 's/.*"version": *"\([^"]*\)".*/\1/')
fi

EXTENSION_NAME="tab-sleep"
PACKAGE_NAME="${EXTENSION_NAME}-v${VERSION}"
PACKAGE_DIR="$DIST_DIR/$PACKAGE_NAME"
ZIP_FILE="$DIST_DIR/${PACKAGE_NAME}.zip"

echo "========================================"
echo "Chrome Extension Package Builder"
echo "========================================"
echo "Project: $PROJECT_ROOT"
echo "Version: $VERSION"
echo "Package: $PACKAGE_NAME"
echo "========================================"

# Clean dist directory
echo "[1/4] Cleaning dist directory..."
rm -rf "$DIST_DIR"
mkdir -p "$DIST_DIR"

# Copy extension files
echo "[2/4] Copying extension files..."
mkdir -p "$PACKAGE_DIR"
cp -r "$SRC_DIR"/* "$PACKAGE_DIR/"

# Remove unnecessary files (if any)
echo "[3/4] Removing unnecessary files..."
find "$PACKAGE_DIR" -name "*.map" -delete 2>/dev/null || true
find "$PACKAGE_DIR" -name ".DS_Store" -delete 2>/dev/null || true
find "$PACKAGE_DIR" -name "Thumbs.db" -delete 2>/dev/null || true

# Create zip file
echo "[4/4] Creating zip file..."
cd "$DIST_DIR"
zip -r "$ZIP_FILE" "$PACKAGE_NAME"

# Cleanup
rm -rf "$PACKAGE_DIR"

echo "========================================"
echo "Build completed successfully!"
echo "Output: $ZIP_FILE"
echo "========================================"

# Show file info
ls -lh "$ZIP_FILE"
