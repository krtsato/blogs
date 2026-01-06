// 画像の簡易 MIME 判定と寸法チェック（JPEG/PNG/WEBP に限定）

export type ImageMeta = {
  mime: 'image/jpeg' | 'image/png' | 'image/webp';
  width?: number;
  height?: number;
};

export function detectImageMeta(buf: ArrayBuffer): ImageMeta | null {
  const u8 = new Uint8Array(buf);
  if (u8.length < 12) return null;

  // PNG
  if (u8[0] === 0x89 && u8[1] === 0x50 && u8[2] === 0x4e && u8[3] === 0x47) {
    const width = readUInt32(u8, 16);
    const height = readUInt32(u8, 20);
    return { mime: 'image/png', width, height };
  }

  // JPEG
  if (u8[0] === 0xff && u8[1] === 0xd8 && u8[2] === 0xff) {
    const size = readJpegSize(u8);
    return { mime: 'image/jpeg', width: size?.width, height: size?.height };
  }

  // WEBP
  if (u8[0] === 0x52 && u8[1] === 0x49 && u8[2] === 0x46 && u8[3] === 0x46 && u8[8] === 0x57 && u8[9] === 0x45 && u8[10] === 0x42 && u8[11] === 0x50) {
    const size = readWebpSize(u8);
    return { mime: 'image/webp', width: size?.width, height: size?.height };
  }

  return null;
}

function readUInt32(u8: Uint8Array, offset: number) {
  return (u8[offset] << 24) | (u8[offset + 1] << 16) | (u8[offset + 2] << 8) | u8[offset + 3];
}

// JPEG の SOF セグメントから幅・高さを取得
function readJpegSize(u8: Uint8Array): { width: number; height: number } | null {
  let offset = 2;
  while (offset < u8.length) {
    if (u8[offset] !== 0xff) break;
    const marker = u8[offset + 1];
    const length = (u8[offset + 2] << 8) + u8[offset + 3];
    if (marker >= 0xc0 && marker <= 0xc3) {
      const height = (u8[offset + 5] << 8) + u8[offset + 6];
      const width = (u8[offset + 7] << 8) + u8[offset + 8];
      return { width, height };
    }
    offset += 2 + length;
  }
  return null;
}

// WEBP の簡易サイズ取得（VP8X/VP8/VP8L の主要ケースのみ）
function readWebpSize(u8: Uint8Array): { width: number; height: number } | null {
  const chunkHeader = String.fromCharCode(u8[12], u8[13], u8[14], u8[15]);
  if (chunkHeader === 'VP8 ' && u8.length >= 30) {
    // https://developers.google.com/speed/webp/docs/riff_container
    const width = ((u8[26] << 8) + u8[25]) & 0x3fff;
    const height = ((u8[28] << 8) + u8[27]) & 0x3fff;
    return { width, height };
  }
  if (chunkHeader === 'VP8L' && u8.length >= 25) {
    const b0 = u8[21];
    const b1 = u8[22];
    const b2 = u8[23];
    const b3 = u8[24];
    const width = 1 + (((b1 & 0x3f) << 8) | b0);
    const height = 1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6));
    return { width, height };
  }
  if (chunkHeader === 'VP8X' && u8.length >= 30) {
    const width = 1 + (u8[24] | (u8[25] << 8) | (u8[26] << 16));
    const height = 1 + (u8[27] | (u8[28] << 8) | (u8[29] << 16));
    return { width, height };
  }
  return null;
}
