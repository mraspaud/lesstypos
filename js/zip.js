// Reading a zip archive (an EPUB is one): the files it holds, by name.
// Stored entries are sliced; deflated ones are inflated by the platform
// (DecompressionStream 'deflate-raw', also in Node 22).
(function (FT) {
  'use strict';
  var END_OF_DIRECTORY = 0x06054b50, DIRECTORY_ENTRY = 0x02014b50, STORED = 0, DEFLATED = 8;

  function inflate(bytes) {
    var stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Response(stream).arrayBuffer().then(function (b) { return new Uint8Array(b); });
  }
  function findEndOfDirectory(view) {
    for (var i = view.byteLength - 22; i >= Math.max(0, view.byteLength - 65557); i--) {
      if (view.getUint32(i, true) === END_OF_DIRECTORY) return i;
    }
    throw new Error('This is not a zip archive');
  }

  // bytes: Uint8Array -> Promise of { name: Uint8Array }
  function read(bytes) {
    var view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), names = new TextDecoder();
    var end = findEndOfDirectory(view), count = view.getUint16(end + 10, true), at = view.getUint32(end + 16, true);
    var pending = [], files = {};
    for (var n = 0; n < count; n++) {
      if (view.getUint32(at, true) !== DIRECTORY_ENTRY) throw new Error('This zip archive is damaged');
      var method = view.getUint16(at + 10, true), size = view.getUint32(at + 20, true);
      var nameLength = view.getUint16(at + 28, true), extra = view.getUint16(at + 30, true), comment = view.getUint16(at + 32, true);
      var local = view.getUint32(at + 42, true);
      var name = names.decode(bytes.subarray(at + 46, at + 46 + nameLength));
      var start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
      var data = bytes.subarray(start, start + size);
      if (method === STORED) files[name] = data;
      else if (method === DEFLATED) pending.push(inflate(data).then(function (k) { return function (out) { files[k] = out; }; }(name)));
      at += 46 + nameLength + extra + comment;
    }
    return Promise.all(pending).then(function () { return files; });
  }

  FT.zip = { read: read };
})(globalThis.FT);
