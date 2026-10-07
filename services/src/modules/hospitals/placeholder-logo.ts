import { deflateSync } from 'node:zlib';

// A small PNG logo (a white cross on a coloured badge) for seeded test
// hospitals, so each client looks different without shipping image files.

const crcTable = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  return value >>> 0;
});

function crc32(bytes: Buffer): number {
  let value = 0xffffffff;
  for (const byte of bytes) value = crcTable[(value ^ byte) & 0xff]! ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

export function placeholderLogo(
  color: readonly [number, number, number],
  shape: 'square' | 'circle',
  size = 128,
): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bits per channel
  header[9] = 6; // RGBA
  const center = (size - 1) / 2;
  const corner = size * 0.2;
  const bar = size * 0.09;
  const arm = size * 0.3;
  const inside = (x: number, y: number) => {
    if (shape === 'circle') return Math.hypot(x - center, y - center) <= size / 2;
    const dx = Math.max(corner - x, x - (size - 1 - corner), 0);
    const dy = Math.max(corner - y, y - (size - 1 - corner), 0);
    return Math.hypot(dx, dy) <= corner;
  };
  const cross = (x: number, y: number) => {
    const dx = Math.abs(x - center);
    const dy = Math.abs(y - center);
    return (dx <= bar && dy <= arm) || (dy <= bar && dx <= arm);
  };
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y += 1) {
    const row = y * (size * 4 + 1);
    for (let x = 0; x < size; x += 1) {
      const pixel = row + 1 + x * 4;
      if (!inside(x, y)) continue;
      const [red, green, blue] = cross(x, y) ? [255, 255, 255] : color;
      raw[pixel] = red;
      raw[pixel + 1] = green;
      raw[pixel + 2] = blue;
      raw[pixel + 3] = 255;
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
