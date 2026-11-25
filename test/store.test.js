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

test('prose texts are stored, updated, listed, exported and imported', async () => {
  const s = mk();
  await s.saveText({ id: 't1', title: 'Moby-Dick', words: ['Call', 'me', 'Ishmael.'], pos: 0, addedAt: 1 });
  await s.saveText({ id: 't2', title: 'Emma', words: ['Emma', 'Woodhouse'], pos: 0, addedAt: 2 });
  const t = (await s.listTexts()).find((x) => x.id === 't1');
  t.pos = 2;
  await s.saveText(t);
  assert.equal((await s.getText('t1')).pos, 2);
  await s.deleteText('t2');
  assert.deepEqual(plain((await s.listTexts()).map((x) => x.id)), ['t1']);
  const dump = JSON.parse(JSON.stringify(await s.exportAll()));
  assert.equal(dump.texts.length, 1);
  const b = mk();
  await b.importAll(dump);
  assert.equal((await b.getText('t1')).pos, 2);
  await b.reset('profile');
  assert.equal((await b.listTexts()).length, 1);
});

test('merging an import keeps local settings and the furthest reading position', async () => {
  const s = mk();
  await s.saveSettings({ layoutText: 'mine', currentText: 't1' });
  await s.saveText({ id: 't1', title: 'Book', words: ['a', 'b', 'c', 'd'], pos: 3, addedAt: 1 });
  const other = { format: 'lesstypos-export', schema: FT.SCHEMA, settings: { layoutText: '' }, profile: null,
    sessions: [{ id: 's9', startedAt: 9, words: [] }],
    texts: [{ id: 't1', title: 'Book', words: ['a', 'b', 'c', 'd'], pos: 1, addedAt: 1 }, { id: 't2', title: 'New', words: ['x'], pos: 0, addedAt: 2 }] };
  await s.importAll(other, { mode: 'merge' });
  const d = await s.load();
  assert.equal(d.settings.layoutText, 'mine');
  assert.equal((await s.getText('t1')).pos, 3);
  assert.ok(await s.getText('t2'));
  assert.equal((await s.listSessions()).length, 1);
});

test('imported texts without words are rejected', async () => {
  const s = mk();
  await assert.rejects(s.importAll({ format: 'lesstypos-export', schema: FT.SCHEMA, sessions: [], texts: [{ id: 'bad', title: 'x' }] }), /text/i);
});

// Functionality: sessions are stored and exported compactly (FT.codec) and
// read back exactly; older plain records and schema-1 exports still load.
const typedSession = (id, startedAt = 1) => ({
  id, startedAt, type: 'relaxed', words: [{ target: 'ab', stream: [{ k: 'c', ch: 'a', t: 10.5, g: 0 }, { k: 'c', ch: 'b', t: 120.25, g: 1 }], meta: null }],
  keys: [{ k: 'd', c: 'KeyA', t: 10 }, { k: 'u', c: 'KeyA', t: 80.5 }],
});

test('sessions are stored encoded and listed as they were saved', async () => {
  const adapter = FT.store.memoryAdapter();
  const s = FT.store.create({ adapter });
  await s.saveSession(typedSession('s1'));
  const rec = await adapter.get('session:s1');
  assert.equal(rec.enc, 1);
  const [back] = await s.listSessions();
  assert.equal(back.enc, undefined);
  assert.deepEqual(plain(back.words), plain(typedSession('s1').words));
  assert.deepEqual(plain(back.keys), plain(typedSession('s1').keys));
});

test('backups carry encoded sessions and import back exactly, replacing or merging', async () => {
  const a = mk();
  await a.saveSession(typedSession('s1'));
  const dump = JSON.parse(JSON.stringify(await a.exportAll()));
  assert.equal(dump.schema, FT.SCHEMA);
  assert.equal(dump.sessions[0].enc, 1);
  for (const mode of ['replace', 'merge']) {
    const b = mk();
    await b.saveSession(typedSession('s0', 0));
    await b.importAll(dump, { mode });
    const list = await b.listSessions();
    const s1 = list.find((x) => x.id === 's1');
    assert.deepEqual(plain(s1.words), plain(typedSession('s1').words));
    assert.equal(list.length, mode === 'merge' ? 2 : 1);
  }
});

test('a backup from before compaction (schema 1, plain sessions) imports', async () => {
  const b = mk();
  await b.importAll({ format: 'lesstypos-export', schema: 1, settings: {}, profile: null, sessions: [typedSession('old')] });
  const [s] = await b.listSessions();
  assert.deepEqual(plain(s.keys), plain(typedSession('old').keys));
});

test('compacting converts sessions stored plain and leaves encoded ones alone', async () => {
  const adapter = FT.store.memoryAdapter();
  await adapter.set('session:old', Object.assign(typedSession('old'), { schema: 1 }));
  const s = FT.store.create({ adapter });
  await s.saveSession(typedSession('new', 2));
  const before = await adapter.get('session:new');
  assert.equal(await s.compactSessions(), 1);
  assert.equal((await adapter.get('session:old')).enc, 1);
  assert.deepEqual(plain(await adapter.get('session:new')), plain(before));
  const list = await s.listSessions();
  assert.deepEqual(plain(list.find((x) => x.id === 'old').words), plain(typedSession('old').words));
});
