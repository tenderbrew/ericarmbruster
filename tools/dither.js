#!/usr/bin/env node
/*
  tools/dither.js — dither an image into the v3 site palette
  -----------------------------------------------------------
  Converts any image into crunchy ordered-dither pixel art using the four
  pixel-base.css colors, so every photo on the site shares one palette.

  Usage:
    npm install sharp        # one-time, node_modules is gitignored
    node tools/dither.js input.jpg output.png [width]

  width = output width in *art pixels* (default 160). Keep it small and
  scale up in HTML/CSS with image-rendering: pixelated; the small PNG is
  the asset.
*/

const sharp = require('sharp');

const PALETTE = [
  [0xF3, 0xEE, 0xDF], // paper
  [0x1A, 0x1A, 0x18], // ink
  [0x2E, 0x6F, 0xBF], // pool
  [0xE8, 0x74, 0x3B], // sunset
];

// 4x4 Bayer matrix, normalized to [-0.5, 0.5)
const BAYER = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
].map((row) => row.map((v) => v / 16 - 0.5));

const DITHER_STRENGTH = 96; // how far the threshold pushes each channel

function nearest(r, g, b) {
  let best = 0;
  let bestDist = Infinity;
  for (let i = 0; i < PALETTE.length; i++) {
    const [pr, pg, pb] = PALETTE[i];
    const dist = (r - pr) ** 2 + (g - pg) ** 2 + (b - pb) ** 2;
    if (dist < bestDist) {
      bestDist = dist;
      best = i;
    }
  }
  return PALETTE[best];
}

async function main() {
  const [input, output, widthArg] = process.argv.slice(2);
  if (!input || !output) {
    console.error('usage: node tools/dither.js input.jpg output.png [width=160]');
    process.exit(1);
  }
  const width = parseInt(widthArg || '160', 10);

  const { data, info } = await sharp(input)
    .resize({ width, kernel: 'lanczos3' })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const out = Buffer.alloc(info.width * info.height * 3);
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      const i = (y * info.width + x) * 3;
      const t = BAYER[y % 4][x % 4] * DITHER_STRENGTH;
      const [r, g, b] = nearest(
        Math.min(255, Math.max(0, data[i] + t)),
        Math.min(255, Math.max(0, data[i + 1] + t)),
        Math.min(255, Math.max(0, data[i + 2] + t)),
      );
      out[i] = r;
      out[i + 1] = g;
      out[i + 2] = b;
    }
  }

  await sharp(out, { raw: { width: info.width, height: info.height, channels: 3 } })
    .png({ palette: true, colors: 8 })
    .toFile(output);

  console.log(`${output}: ${info.width}x${info.height}, 4-color dither`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
