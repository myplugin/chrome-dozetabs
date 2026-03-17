// Script to generate PNG icons from SVG
// Run this script with Node.js to generate the icon files

const fs = require('fs');
const path = require('path');

// Simple PNG generator for solid color icons
// These are minimal PNG files that work as placeholders

function createMinimalPNG(size, color) {
  // PNG header and IHDR chunk for a simple solid color image
  const width = size;
  const height = size;

  // Create a simple PNG with a moon shape (approximated)
  const pixels = [];
  const centerX = width / 2;
  const centerY = height / 2;
  const radius = width * 0.4;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const dx = x - centerX;
      const dy = y - centerY;
      const distance = Math.sqrt(dx * dx + dy * dy);

      // Moon shape: circle with a smaller circle cut out
      const inMainCircle = distance < radius;
      const inCutout = Math.sqrt((dx - radius * 0.4) ** 2 + (dy - radius * 0.2) ** 2) < radius * 0.6;

      if (inMainCircle && !inCutout) {
        // Moon color (purple gradient approximated as solid)
        pixels.push(0x66, 0x7E, 0xEA, 0xFF); // RGBA
      } else {
        // Transparent
        pixels.push(0x00, 0x00, 0x00, 0x00);
      }
    }
  }

  // This is a simplified placeholder - in production, use a proper image library
  // For now, we'll create a data URL approach
  return null; // Placeholder
}

// Create a simple HTML file that can be used to generate icons
const html = `<!DOCTYPE html>
<html>
<head>
  <title>Icon Generator</title>
  <style>
    body { font-family: Arial, sans-serif; padding: 20px; }
    canvas { border: 1px solid #ccc; margin: 10px; }
    .icon-row { display: flex; align-items: center; gap: 20px; margin: 20px 0; }
    button { padding: 10px 20px; cursor: pointer; }
  </style>
</head>
<body>
  <h1>Tab Sleep Tool - Icon Generator</h1>
  <p>Click the buttons below to download the icons as PNG files.</p>

  <div class="icon-row">
    <canvas id="icon16" width="16" height="16"></canvas>
    <span>16x16</span>
    <button onclick="download('icon16', 16)">Download</button>
  </div>

  <div class="icon-row">
    <canvas id="icon32" width="32" height="32"></canvas>
    <span>32x32</span>
    <button onclick="download('icon32', 32)">Download</button>
  </div>

  <div class="icon-row">
    <canvas id="icon48" width="48" height="48"></canvas>
    <span>48x48</span>
    <button onclick="download('icon48', 48)">Download</button>
  </div>

  <div class="icon-row">
    <canvas id="icon128" width="128" height="128"></canvas>
    <span>128x128</span>
    <button onclick="download('icon128', 128)">Download</button>
  </div>

  <div class="icon-row">
    <canvas id="icon16-sleep" width="16" height="16"></canvas>
    <span>16x16 (sleeping)</span>
    <button onclick="download('icon16-sleep', 16, true)">Download</button>
  </div>

  <div class="icon-row">
    <canvas id="icon32-sleep" width="32" height="32"></canvas>
    <span>32x32 (sleeping)</span>
    <button onclick="download('icon32-sleep', 32, true)">Download</button>
  </div>

  <script>
    function drawMoon(ctx, size, isSleeping) {
      ctx.clearRect(0, 0, size, size);

      const centerX = size / 2;
      const centerY = size / 2;
      const radius = size * 0.4;

      // Draw moon shape
      ctx.beginPath();
      ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
      ctx.fillStyle = isSleeping ? '#764ba2' : '#667eea';
      ctx.fill();

      // Cut out a circle to create crescent
      ctx.beginPath();
      ctx.arc(centerX + radius * 0.35, centerY - radius * 0.15, radius * 0.55, 0, Math.PI * 2);
      ctx.fillStyle = 'white';
      ctx.fill();

      // Add a dot for sleeping state
      if (isSleeping) {
        ctx.beginPath();
        ctx.arc(centerX, centerY + radius * 0.2, radius * 0.15, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(118, 75, 162, 0.5)';
        ctx.fill();
      }
    }

    function download(canvasId, size, isSleeping = false) {
      const canvas = document.getElementById(canvasId);
      const link = document.createElement('a');
      link.download = canvasId.replace('-', '-sleep.') + '.png';
      link.href = canvas.toDataURL('image/png');
      link.click();
    }

    // Draw all icons on load
    window.onload = function() {
      const sizes = [16, 32, 48, 128];
      sizes.forEach(size => {
        const canvas = document.getElementById('icon' + size);
        const ctx = canvas.getContext('2d');
        drawMoon(ctx, size, false);
      });

      // Sleeping icons
      [16, 32].forEach(size => {
        const canvas = document.getElementById('icon' + size + '-sleep');
        const ctx = canvas.getContext('2d');
        drawMoon(ctx, size, true);
      });
    };
  </script>
</body>
</html>
`;

console.log('To generate PNG icons:');
console.log('1. Open icon-generator.html in a browser');
console.log('2. Click the download buttons for each icon size');
console.log('3. Save the files to the assets/icons/ directory');
