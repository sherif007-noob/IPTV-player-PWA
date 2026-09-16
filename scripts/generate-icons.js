import fs from 'fs';
import zlib from 'zlib';

function createPNG(width, height, isMaskable = false) {
  // RGBA buffer with scanline filter byte 0
  const rowSize = 1 + width * 4;
  const rawBuffer = Buffer.alloc(rowSize * height);

  const cx = width / 2;
  const cy = height / 2;
  const radius = isMaskable ? width * 0.48 : width * 0.44;

  for (let y = 0; y < height; y++) {
    const rowOffset = y * rowSize;
    rawBuffer[rowOffset] = 0; // Filter: None

    for (let x = 0; x < width; x++) {
      const pixelOffset = rowOffset + 1 + x * 4;

      // Distance from center
      const dx = x - cx;
      const dy = y - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);

      // Background gradient: deep dark navy #0b0e14 to #0284c7 (bottom right)
      const gradFactor = (x / width + y / height) / 2;
      let r = Math.round(11 + (2 - 11) * gradFactor);
      let g = Math.round(14 + (132 - 14) * gradFactor);
      let b = Math.round(20 + (199 - 20) * gradFactor);
      let a = 255;

      if (!isMaskable) {
        // Rounded corner mask
        const cornerR = width * 0.22;
        const inLeft = x < cornerR;
        const inRight = x > width - cornerR;
        const inTop = y < cornerR;
        const inBottom = y > height - cornerR;

        if ((inLeft || inRight) && (inTop || inBottom)) {
          const cornerX = inLeft ? cornerR : width - cornerR;
          const cornerY = inTop ? cornerR : height - cornerR;
          const cDist = Math.hypot(x - cornerX, y - cornerY);
          if (cDist > cornerR) {
            a = 0;
          }
        }
      }

      if (a > 0) {
        // TV box area: normalized coordinates (0..1)
        const nx = (x - cx) / (width * 0.35);
        const ny = (y - cy) / (height * 0.26);

        // TV outline
        if (Math.abs(nx) <= 1 && Math.abs(ny) <= 1) {
          // Inside TV screen area
          const isBorder = Math.abs(nx) > 0.85 || Math.abs(ny) > 0.85;
          if (isBorder) {
            // Cyan/Sky glowing border
            r = 56;
            g = 189;
            b = 248;
          } else {
            // Dark screen
            r = 3;
            g = 7;
            b = 18;

            // Play Triangle in center: nx in [-0.25, 0.35], |ny| <= (0.35 - nx)*0.7
            if (nx >= -0.22 && nx <= 0.32) {
              const halfH = (0.32 - nx) * 0.65;
              if (Math.abs(ny) <= halfH) {
                // Play icon color: Vibrant sky/indigo
                r = 56;
                g = 189;
                b = 248;
              }
            }
          }
        }

        // TV Stand base
        if (Math.abs(nx) <= 0.4 && ny >= 1.15 && ny <= 1.35) {
          r = 56;
          g = 189;
          b = 248;
        }
      }

      rawBuffer[pixelOffset] = r;
      rawBuffer[pixelOffset + 1] = g;
      rawBuffer[pixelOffset + 2] = b;
      rawBuffer[pixelOffset + 3] = a;
    }
  }

  // PNG Construction
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  // IHDR chunk
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData[8] = 8; // Bit depth: 8
  ihdrData[9] = 6; // Color type: RGBA (6)
  ihdrData[10] = 0; // Compression: Deflate
  ihdrData[11] = 0; // Filter: Standard
  ihdrData[12] = 0; // Interlace: None

  const ihdrChunk = createChunk('IHDR', ihdrData);

  // IDAT chunk
  const compressedData = zlib.deflateSync(rawBuffer);
  const idatChunk = createChunk('IDAT', compressedData);

  // IEND chunk
  const iendChunk = createChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([signature, ihdrChunk, idatChunk, iendChunk]);
}

function createChunk(type, data) {
  const len = data.length;
  const chunk = Buffer.alloc(12 + len);
  chunk.writeUInt32BE(len, 0);
  chunk.write(type, 4, 4, 'ascii');
  data.copy(chunk, 8);

  const crc = crc32(chunk.subarray(4, 8 + len));
  chunk.writeUInt32BE(crc >>> 0, 8 + len);
  return chunk;
}

// CRC32 table
const crcTable = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) {
    if (c & 1) c = 0xedb88320 ^ (c >>> 1);
    else c = c >>> 1;
  }
  crcTable[n] = c;
}

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return c ^ 0xffffffff;
}

// Generate all target icon files
console.log('Generating PWA and App icons...');

fs.writeFileSync('public/pwa-192x192.png', createPNG(192, 192, false));
fs.writeFileSync('public/pwa-512x512.png', createPNG(512, 512, false));
fs.writeFileSync('public/pwa-maskable-512x512.png', createPNG(512, 512, true));
fs.writeFileSync('public/apple-touch-icon.png', createPNG(180, 180, false));
fs.writeFileSync('public/icon.png', createPNG(192, 192, false));
fs.writeFileSync('public/largeIcon.png', createPNG(512, 512, false));

// Also write to root in case of legacy references
fs.writeFileSync('icon.png', createPNG(192, 192, false));
fs.writeFileSync('largeIcon.png', createPNG(512, 512, false));

console.log('Icons generated successfully!');
