// Frame capture + packaging for cine mode (owner: cine agent, used by src/camera/cine.js).
//
//   captureFrame  canvas -> PNG/JPEG bytes (must be called in the same task as the render; the
//                 renderer runs with preserveDrawingBuffer while cine mode is on)
//   createZipStream  store-only ZIP built incrementally (one small header per frame, no recompression),
//                 so the export never holds more than the frames themselves
//   openStream    Chrome's File System Access: frames are written straight into a picked folder, so
//                 even long lossless PNG runs never sit in memory. Not available (or blocked in
//                 cross-origin iframes) -> null and the zip path is used instead.
//   saveBlob      one-click download of the finished zip

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) { let c = i; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[i] = c >>> 0; }
  return t;
})();

function crc32(bytes) {
  let c = ~0;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
  return ~c >>> 0;
}

/** PNG/JPEG bytes of the canvas as it stands right now, or null if the browser refused. */
export function captureFrame(canvas, type, quality) {
  return new Promise((resolve) => {
    try { canvas.toBlob((b) => resolve(b), type, quality); } catch { resolve(null); }
  }).then(async (b) => (b ? new Uint8Array(await b.arrayBuffer()) : null));
}

/** Store-only ZIP, fed one file at a time; finish() returns the single Blob. */
export function createZipStream() {
  const enc = new TextEncoder();
  const parts = [];   // local headers + names + file data, in order
  const central = []; // central directory records, in order
  let offset = 0;
  let count = 0;
  return {
    add(name, bytes) {
      const n = enc.encode(name);
      const crc = crc32(bytes);
      const head = new DataView(new ArrayBuffer(30));
      head.setUint32(0, 0x04034b50, true);
      head.setUint16(4, 20, true);      // version needed
      head.setUint16(6, 0x0800, true);  // flags: UTF-8 names
      head.setUint16(8, 0, true);       // method: store
      head.setUint32(14, crc, true);
      head.setUint32(18, bytes.length, true);
      head.setUint32(22, bytes.length, true);
      head.setUint16(26, n.length, true);
      parts.push(head.buffer, n, bytes);
      const cd = new DataView(new ArrayBuffer(46));
      cd.setUint32(0, 0x02014b50, true);
      cd.setUint16(4, 20, true);        // version made by
      cd.setUint16(6, 20, true);        // version needed
      cd.setUint16(8, 0x0800, true);
      cd.setUint32(16, crc, true);
      cd.setUint32(20, bytes.length, true);
      cd.setUint32(24, bytes.length, true);
      cd.setUint16(28, n.length, true);
      cd.setUint32(38, 0, true);        // external attrs
      cd.setUint32(42, offset, true);   // local header offset
      central.push(cd.buffer, n);
      offset += 30 + n.length + bytes.length;
      count++;
    },
    finish() {
      let cdSize = 0;
      for (const c of central) cdSize += c.byteLength;
      const eocd = new DataView(new ArrayBuffer(22));
      eocd.setUint32(0, 0x06054b50, true);
      eocd.setUint16(8, count, true);
      eocd.setUint16(10, count, true);
      eocd.setUint32(12, cdSize, true);
      eocd.setUint32(16, offset, true);
      return new Blob([...parts, ...central, eocd], { type: 'application/zip' });
    },
  };
}

export function canStream() {
  return typeof window.showDirectoryPicker === 'function';
}

/**
 * A folder to write frames into, on Chrome. Resolves to { write(name, bytes), close() } or
 * { cancelled: true } when the user backed out; null when the API is unavailable / blocked.
 * Must be called inside the user gesture that starts the export.
 */
export async function openStream() {
  if (!canStream()) return null;
  let dir = null;
  try {
    dir = await window.showDirectoryPicker({ id: 'papertrails-cine', mode: 'readwrite', startIn: 'downloads' });
  } catch (err) {
    if (err && (err.name === 'AbortError' || err.name === 'NotAllowedError')) return { cancelled: true };
    return null; // unsupported or blocked (e.g. cross-origin iframe): use the zip path
  }
  return {
    async write(name, bytes) {
      const ws = await (await dir.getFileHandle(name, { create: true })).createWritable();
      await ws.write(bytes);
      await ws.close();
    },
    async close() {},
  };
}

/** One-click download of a finished Blob (the zip). */
export function saveBlob(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 60000);
}
