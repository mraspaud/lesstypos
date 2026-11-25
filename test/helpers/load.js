'use strict';
// Loads the classic browser scripts listed in index.html, in the same order,
// into a fresh vm context, so tests exercise exactly the code the browser runs.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..', '..');

function scriptList() {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  return [...html.matchAll(/<script\s+src="([^"]+)"/g)].map((m) => m[1]);
}

function load(opts = {}) {
  const sandbox = { console, Math, Date, JSON, setTimeout, clearTimeout, ...opts.globals };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  for (const src of scriptList()) {
    if (opts.skip && opts.skip.some((s) => src.includes(s))) continue;
    const file = path.join(ROOT, src);
    vm.runInContext(fs.readFileSync(file, 'utf8'), sandbox, { filename: file });
  }
  return sandbox.FT;
}

// Objects from the vm realm have foreign prototypes; normalise before deepEqual.
const plain = (x) => JSON.parse(JSON.stringify(x));

module.exports = { load, scriptList, ROOT, plain };
