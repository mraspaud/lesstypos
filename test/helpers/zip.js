'use strict';
// Builds zip archives and EPUBs in memory for tests.
const zlib = require('node:zlib');

const STORED = 0, DEFLATED = 8;

// files: { name: string | Buffer }; opts.method: 0 stored, 8 deflated, or any
// other code; opts.zip64: sizes written as 0xFFFFFFFF.
function buildZip(files, opts = {}) {
  const method = opts.method ?? STORED;
  const locals = [], centrals = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const raw = Buffer.from(content), nameBytes = Buffer.from(name);
    const data = method === DEFLATED ? zlib.deflateRawSync(raw) : raw;
    const size = opts.zip64 ? 0xffffffff : data.length;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(method, 8);
    local.writeUInt32LE(size, 18); local.writeUInt32LE(opts.zip64 ? 0xffffffff : raw.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(method, 10);
    central.writeUInt32LE(size, 20); central.writeUInt32LE(opts.zip64 ? 0xffffffff : raw.length, 24);
    central.writeUInt16LE(nameBytes.length, 28); central.writeUInt32LE(offset, 42);
    locals.push(local, nameBytes, data);
    centrals.push(central, nameBytes);
    offset += 30 + nameBytes.length + data.length;
  }
  const directory = Buffer.concat(centrals), count = Object.keys(files).length;
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(count, 8); end.writeUInt16LE(count, 10);
  end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...locals, directory, end]));
}

const xhtml = (body) => `<?xml version="1.0" encoding="utf-8"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>x</title></head><body>${body}</body></html>`;

// An EPUB with chapters { href, body } and a table of contents given as
// either nav (EPUB 3) or ncx (EPUB 2) markup listing entries, and an
// optional ncx page list (printed page numbers).
function buildEpub({ chapters, nav, ncx, pageList = '', spineExtra = '' }) {
  const items = chapters.map((c, i) => `<item id="c${i}" href="${c.href}" media-type="application/xhtml+xml"/>`).join('');
  const files = {
    mimetype: 'application/epub+zip',
    'META-INF/container.xml': '<?xml version="1.0"?><container><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
    'OEBPS/content.opf': `<package><metadata><dc:title>Test Book</dc:title><dc:creator>A. Writer</dc:creator></metadata><manifest>${items}` +
      (nav ? '<item id="nav" href="nav.xhtml" properties="nav" media-type="application/xhtml+xml"/>' : '') +
      (ncx ? '<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>' : '') +
      `</manifest><spine${ncx ? ' toc="ncx"' : ''}>${chapters.map((c, i) => `<itemref idref="c${i}"/>`).join('')}${spineExtra}</spine></package>`,
  };
  for (const c of chapters) if (!c.missing) files['OEBPS/' + decodeURIComponentSafe(c.href)] = xhtml(c.body);
  if (nav) files['OEBPS/nav.xhtml'] = xhtml(`<nav epub:type="toc"><ol>${nav}</ol></nav>`);
  if (ncx) files['OEBPS/toc.ncx'] = `<?xml version="1.0"?><ncx><navMap>${ncx}</navMap>${pageList && `<pageList>${pageList}</pageList>`}</ncx>`;
  return buildZip(files);
}
function decodeURIComponentSafe(s) { try { return decodeURIComponent(s); } catch { return s; } }

module.exports = { buildZip, buildEpub, STORED, DEFLATED };
