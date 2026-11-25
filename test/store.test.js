'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { load, plain } = require('./helpers/load');

// Functionality: local persistence. Raw sessions are the source of truth and
// carry a schema version; export/import is validated and migrated, so history
// is never dropped; resets can be selective.

const FT = load();
const mk = (opts) => FT.store.create(Object.assign({ adapter: FT.store.memoryAdapter() }, opts));

test('settings, profile and sessions persist through the adapter', async () => {
  const adapter = FT.store.memoryAdapter();
  const s = FT.store.create({ adapter });
  await s.saveSettings({ macros: ['th'] });
  await s.saveProfile({ frontier: 300 });
  await s.saveSession({ id: 's1', startedAt: 1, words: [] });
  const s2 = FT.store.create({ adapter });
  const d = await s2.load();
  assert.deepEqual(plain(d.settings.macros), ['th']);
  assert.equal(d.profile.frontier, 300);
  const sessions = await s2.listSessions();
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].schema, FT.SCHEMA);
});

test('export then import into an empty store restores everything', async () => {
  const a = mk();
  await a.saveSettings({ x: 1 });
  await a.saveProfile({ frontier: 250 });
  await a.saveSession({ id: 's1', startedAt: 1, words: [{ target: 'a', stream: [] }] });
  const dump = JSON.parse(JSON.stringify(await a.exportAll()));
  assert.equal(dump.format, 'lesstypos-export');
  const b = mk();
  await b.importAll(dump);
  const d = await b.load();
  assert.equal(d.settings.x, 1);
  assert.equal(d.profile.frontier, 250);
  assert.equal((await b.listSessions())[0].words[0].target, 'a');
});

test('invalid or future-version imports are rejected without changing data', async () => {
  const s = mk();
  await s.saveSettings({ keep: true });
  await assert.rejects(s.importAll({ hello: 1 }), /not a LessTypos export/);
  await assert.rejects(s.importAll({ format: 'lesstypos-export', schema: FT.SCHEMA + 1, sessions: [] }), /newer/);
  assert.equal((await s.load()).settings.keep, true);
});

test('older exports are migrated step by step', async () => {
  const migrations = { 0: (d) => { d.sessions.forEach((x) => { x.words = x.items; delete x.items; }); return d; } };
  const s = mk({ migrations });
  await s.importAll({ format: 'lesstypos-export', schema: 0, settings: {}, profile: null,
    sessions: [{ id: 'old', startedAt: 1, schema: 0, items: [{ target: 'x', stream: [] }] }] });
  const ses = await s.listSessions();
  assert.equal(ses[0].words[0].target, 'x');
  assert.equal(ses[0].schema, FT.SCHEMA);
});

test('import merges sessions by id rather than duplicating', async () => {
  const s = mk();
  await s.saveSession({ id: 's1', startedAt: 1, words: [] });
  const dump = await s.exportAll();
  await s.importAll(JSON.parse(JSON.stringify(dump)), { mode: 'merge' });
  assert.equal((await s.listSessions()).length, 1);
});

test('selective reset keeps raw sessions when only derived statistics are reset', async () => {
  const s = mk();
  await s.saveProfile({ frontier: 300 });
  await s.saveSession({ id: 's1', startedAt: 1, words: [] });
  await s.reset('profile');
  assert.equal((await s.load()).profile, null);
  assert.equal((await s.listSessions()).length, 1);
  await s.reset('all');
  assert.equal((await s.listSessions()).length, 0);
});

test('storage failures surface as errors the UI can report', async () => {
  const broken = { get: async () => { throw new Error('quota'); }, set: async () => { throw new Error('quota'); }, del: async () => {}, keys: async () => [] };
  const s = FT.store.create({ adapter: broken });
  await assert.rejects(s.saveSettings({}), /quota/);
});
