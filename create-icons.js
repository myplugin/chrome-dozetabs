// Simple script to create placeholder PNG icons
// Run with: node create-icons.js

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// CRC32 lookup table
const crc32Table = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) {
    c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
  }
  crc32Table[n] = c;
}

function crc32(data) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < data.length; i++) {
    c = (c >>> 8) ^ crc32Table[(c ^ data[i]) & 0xFF];
  }
  return (c ^ 0xFFFFFFFF) >>> 0;
}

function createChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);

  const typeBuffer = Buffer.from(type, 'ascii');
  const crcData = Buffer.concat([typeBuffer, data]);
  const crcValue = crc32(crcData);

  const crcBuffer = Buffer.alloc(4);
  crcBuffer.writeUInt32BE(crcValue, 0);

  return Buffer.concat([length, typeBuffer, data, crcBuffer]);
}

function createMoonPNG(size, isSleeping = false) {
  // PNG signature
  const signature = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);

  // IHDR chunk
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(size, 0);     // width
  ihdrData.writeUInt32BE(size, 4);     // height
  ihdrData.writeUInt8(8, 8);           // bit depth
  ihdrData.writeUInt8(6, 9);           // color type (RGBA)
  ihdrData.writeUInt8(0, 10);          // compression
  ihdrData.writeUInt8(0, 11);          // filter
  ihdrData.writeUInt8(0, 12);          // interlace

  const ihdrChunk = createChunk('IHDR', ihdrData);

  // Create raw pixel data
  const rawData = [];
  const center = size / 2;
  const radius = size * 0.4;
  const cutoutRadius = radius * 0.55;
  const cutoutOffsetX = radius * 0.35;
  const cutoutOffsetY = -radius * 0.15;

  // Moon color
  const color = isSleeping
    ? { r: 0x76, g: 0x4B, b: 0xA2 }
    : { r: 0x66, g: 0x7E, b: 0xEA };

  for (let y = 0; y < size; y++) {
    rawData.push(0); // Filter byte (none)

    for (let x = 0; x < size; x++) {
      const dx = x - center;
      const dy = y - center;
      const dist = Math.sqrt(dx * dx + dy * dy);

      // Check if in main circle
      const inMainCircle = dist < radius;

      // Check if in cutout circle (to make crescent)
      const cutoutDist = Math.sqrt(
        (dx - cutoutOffsetX) ** 2 +
        (dy - cutoutOffsetY) ** 2
      );
      const inCutout = cutoutDist < cutoutRadius;

      if (inMainCircle && !inCutout) {
        // Moon pixel
        rawData.push(color.r, color.g, color.b, 255);
      } else {
        // Transparent
        rawData.push(0, 0, 0, 0);
      }
    }
  }

  // Compress the raw data
  const deflatedData = zlib.deflateSync(Buffer.from(rawData));
  const idatChunk = createChunk('IDAT', deflatedData);

  // IEND chunk
  const iendChunk = createChunk('IEND', Buffer.alloc(0));

  // Combine all parts
  return Buffer.concat([signature, ihdrChunk, idatChunk, iendChunk]);
}

// Main execution
const iconsDir = path.join(__dirname, 'assets', 'icons');

// Ensure directory exists
if (!fs.existsSync(iconsDir)) {
  fs.mkdirSync(iconsDir, { recursive: true });
}

const icons = [
  { name: 'icon16.png', size: 16, sleeping: false },
  { name: 'icon32.png', size: 32, sleeping: false },
  { name: 'icon48.png', size: 48, sleeping: false },
  { name: 'icon128.png', size: 128, sleeping: false },
  { name: 'icon16-sleep.png', size: 16, sleeping: true },
  { name: 'icon32-sleep.png', size: 32, sleeping: true }
];

console.log('Generating PNG icons for Tab Sleep Tool...\n');

icons.forEach(icon => {
  try {
    const png = createMoonPNG(icon.size, icon.sleeping);
    const filePath = path.join(iconsDir, icon.name);
    fs.writeFileSync(filePath, png);
    console.log(`✓ Created ${icon.name} (${icon.size}x${icon.size})`);
  } catch (err) {
    console.error(`✗ Failed to create ${icon.name}:`, err.message);
  }
});

console.log('\nIcons saved to assets/icons/');
console.log('You can now load the extension in Chrome!');
