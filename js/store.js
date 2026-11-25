// Local-first persistence.
// Raw sessions are the source of truth (derived statistics can be rebuilt from
// them); every record carries the schema version. Export/import is validated
// and migrated step by step (migrations[n] upgrades schema n to n+1).
// Adapters: IndexedDB in the browser, memory for tests / fallback.
(function (FT) {
  'use strict';
  var FORMAT = 'lesstypos-export';
  var MIGRATIONS = {};

  function clone(x) { return x == null ? x : JSON.parse(JSON.stringify(x)); }

  function memoryAdapter() {
    var m = new Map();
    return {
      get: function (k) { return Promise.resolve(clone(m.get(k))); },
      set: function (k, v) { m.set(k, clone(v)); return Promise.resolve(); },
      del: function (k) { m.delete(k); return Promise.resolve(); },
      keys: function () { return Promise.resolve(Array.from(m.keys())); },
      kind: 'memory',
    };
  }

  function idbAdapter(name) {
    var dbp = new Promise(function (res, rej) {
      var req = indexedDB.open(name || 'lesstypos', 1);
      req.onupgradeneeded = function () { req.result.createObjectStore('kv'); };
      req.onsuccess = function () { res(req.result); };
      req.onerror = function () { rej(req.error); };
    });
    function tx(mode, fn) {
      return dbp.then(function (db) {
        return new Promise(function (res, rej) {
          var t = db.transaction('kv', mode), s = t.objectStore('kv'), out;
          var r = fn(s);
          if (r) r.onsuccess = function () { out = r.result; };
          t.oncomplete = function () { res(out); };
          t.onerror = t.onabort = function () { rej(t.error || new Error('IndexedDB transaction failed')); };
        });
      });
    }
    return {
      get: function (k) { return tx('readonly', function (s) { return s.get(k); }); },
      set: function (k, v) { return tx('readwrite', function (s) { return s.put(v, k); }); },
      del: function (k) { return tx('readwrite', function (s) { return s.delete(k); }); },
      keys: function () { return tx('readonly', function (s) { return s.getAllKeys(); }); },
      kind: 'indexeddb',
    };
  }

  function create(opts) {
    opts = opts || {};
    var db = opts.adapter || memoryAdapter();
    var migrations = Object.assign({}, MIGRATIONS, opts.migrations);

    function load() {
      return Promise.all([db.get('settings'), db.get('profile'), db.get('meta')]).then(function (r) {
        return { settings: r[0] || {}, profile: r[1] || null, meta: r[2] || { schema: FT.SCHEMA } };
      });
    }
    function saveSettings(s) { return db.set('settings', s); }
    function saveProfile(p) { return db.set('profile', p).then(function () { return db.set('meta', { schema: FT.SCHEMA }); }); }
    function saveSession(s) {
      var rec = Object.assign({}, s, { schema: s.schema != null ? s.schema : FT.SCHEMA });
      return db.set('session:' + s.id, rec);
    }
    function listSessions() {
      return db.keys().then(function (keys) {
        var ks = keys.filter(function (k) { return String(k).indexOf('session:') === 0; });
        return Promise.all(ks.map(function (k) { return db.get(k); }));
      }).then(function (list) {
        return list.filter(Boolean).sort(function (a, b) { return a.startedAt - b.startedAt; });
      });
    }
    function exportAll() {
      return Promise.all([load(), listSessions()]).then(function (r) {
        return { format: FORMAT, schema: FT.SCHEMA, app: FT.version, exportedAt: new Date().toISOString(),
          settings: r[0].settings, profile: r[0].profile, sessions: r[1] };
      });
    }
    function migrate(d) {
      var v = d.schema;
      while (v < FT.SCHEMA) {
        if (!migrations[v]) throw new Error('No migration from schema ' + v);
        d = migrations[v](d);
        v++;
        d.schema = v;
      }
      d.sessions.forEach(function (s) { s.schema = FT.SCHEMA; });
      return d;
    }
    function importAll(data, o) {
      var mode = (o && o.mode) || 'replace';
      return Promise.resolve().then(function () {
        if (!data || data.format !== FORMAT || !Array.isArray(data.sessions) || typeof data.schema !== 'number') {
          throw new Error('This file is not a LessTypos export');
        }
        if (data.schema > FT.SCHEMA) throw new Error('This export comes from a newer version (schema ' + data.schema + ')');
        var d = migrate(clone(data));
        var p = mode === 'replace' ? reset('all') : Promise.resolve();
        return p.then(function () {
          var writes = d.sessions.map(saveSession);
          if (mode === 'replace' || d.settings) writes.push(saveSettings(d.settings || {}));
          if (mode === 'replace') writes.push(d.profile ? saveProfile(d.profile) : db.del('profile'));
          return Promise.all(writes);
        }).then(function () { return d; });
      });
    }
    function reset(what) {
      return db.keys().then(function (keys) {
        var del = keys.filter(function (k) {
          k = String(k);
          if (what === 'all') return true;
          if (what === 'profile') return k === 'profile';
          if (what === 'sessions') return k.indexOf('session:') === 0;
          if (what === 'settings') return k === 'settings';
          return false;
        });
        return Promise.all(del.map(function (k) { return db.del(k); }));
      });
    }

    return { load: load, saveSettings: saveSettings, saveProfile: saveProfile, saveSession: saveSession,
      listSessions: listSessions, exportAll: exportAll, importAll: importAll, reset: reset, kind: db.kind };
  }

  FT.store = { create: create, memoryAdapter: memoryAdapter, idbAdapter: idbAdapter, FORMAT: FORMAT, migrations: MIGRATIONS };
})(globalThis.FT);
