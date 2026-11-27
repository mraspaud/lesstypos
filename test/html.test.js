'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./helpers/load');

// Functionality: the views build their tables, tiles, selects and panels from
// one set of pure helpers, whose markup the stylesheet and the end-to-end
// checks rely on.
const FT = load();
const H = FT.html;

test('a table sits in a scrolling wrapper, with escaped headings and the rows as given', () => {
  assert.equal(H.table(['Day', 'A & B'], ['<tr><td>1</td></tr>']),
    '<div class="tablewrap"><table><thead><tr><th>Day</th><th>A &amp; B</th></tr></thead><tbody><tr><td>1</td></tr></tbody></table></div>');
});

test('a table can carry an id', () => {
  assert.match(H.table(['When'], [], { id: 'alltable' }), /^<div class="tablewrap"><table id="alltable"><thead>/);
});

test('a row joins its cells and takes optional attributes; a cell takes an optional class', () => {
  assert.equal(H.row([H.cell('a'), H.cell('2', 'num')]), '<tr><td>a</td><td class="num">2</td></tr>');
  assert.equal(H.row([H.cell('x')], ' class="clickable"'), '<tr class="clickable"><td>x</td></tr>');
});

test('tiles show a value over its label', () => {
  assert.equal(H.tiles([['42', 'WPM'], ['99%', 'accuracy']]),
    '<div class="tiles"><div class="tile"><b>42</b><span>WPM</span></div><div class="tile"><b>99%</b><span>accuracy</span></div></div>');
});

test('a select marks the chosen value and escapes attributes, values and labels', () => {
  assert.equal(H.select({ id: 'theme' }, [['light', 'Canvas (light)'], ['dark', 'Ink & dark']], 'dark'),
    '<select id="theme"><option value="light">Canvas (light)</option><option value="dark" selected>Ink &amp; dark</option></select>');
  assert.equal(H.select({ 'data-chapter': 'a"b' }, [[0, 'One'], [12, 'Two']], 12),
    '<select data-chapter="a&quot;b"><option value="0">One</option><option value="12" selected>Two</option></select>');
});

test('a select without a chosen value selects nothing', () => {
  assert.doesNotMatch(H.select({ id: 'impmode' }, [['replace', 'Replace'], ['merge', 'Merge']]), /selected/);
});

test('a panel is a titled section, optionally with an id', () => {
  assert.equal(H.panel('Export', '<p>Save</p>'), '<section class="panel stack"><h2>Export</h2><p>Save</p></section>');
  assert.equal(H.panel('Add', '', { id: 'add' }), '<section class="panel stack" id="add"><h2>Add</h2></section>');
});

test('a table view folds a table under "Show as table"', () => {
  assert.equal(H.tableView('<div class="tablewrap"></div>'),
    '<details class="tableview"><summary>Show as table</summary><div class="tablewrap"></div></details>');
});

test('a disclosure folds its body under a summary, closed unless asked open', () => {
  assert.equal(H.disclosure('About this measure', '<p>How</p>'), '<details><summary>About this measure</summary><p>How</p></details>');
  assert.equal(H.disclosure('Add a text', '', { id: 'addtext', className: 'panel stack', open: true }),
    '<details id="addtext" class="panel stack" open><summary>Add a text</summary></details>');
});

test('a folded panel keeps its title as a heading, in its summary', () => {
  assert.equal(H.foldedPanel('Rebuild and reset', '<p>Rebuild</p>', { id: 'rebuildreset' }),
    '<details id="rebuildreset" class="panel stack fold"><summary><h2>Rebuild and reset</h2></summary><p>Rebuild</p></details>');
  assert.equal(H.foldedPanel('Add a text', '', { id: 'addtext', open: true }),
    '<details id="addtext" class="panel stack fold" open><summary><h2>Add a text</h2></summary></details>');
});

test('tiles can be plain: the same values and labels without their boxes', () => {
  assert.equal(H.tiles([['42', 'WPM']], { plain: true }), '<div class="tiles plain"><div class="tile"><b>42</b><span>WPM</span></div></div>');
});

test('a table can carry a class', () => {
  assert.match(H.table(['Error'], [], { id: 'check', className: 'compact' }), /^<div class="tablewrap"><table id="check" class="compact"><thead>/);
});

test('progress dots mark the steps done out of all, and name the count for assistive technology', () => {
  assert.equal(H.progressDots(1, 3), '<span class="dots" role="img" aria-label="1 of 3 done"><i class="on"></i><i></i><i></i></span>');
  assert.equal(H.progressDots(4, 3), '<span class="dots" role="img" aria-label="3 of 3 done"><i class="on"></i><i class="on"></i><i class="on"></i></span>');
});
