// Texts for prose exercises: add, choose a chapter, start over, delete; and
// home's way into the book.
(function (FT) {
  'use strict';
  if (typeof document === 'undefined') return;
  var U = FT.ui, app = U.app;
  var esc = FT.fmt.esc, pill = FT.fmt.pill, H = FT.html, button = U.button, onSecondPress = U.onSecondPress;

  // "Start at" for a text with chapters.
  var LONG_TEXT = 2000; // words: a book, where choosing a chapter matters
  function chapterChoice(t) {
    if (!t.chapters && t.words.length > LONG_TEXT) return '<div class="muted">No chapters: add it again from its EPUB to choose where to start.</div>';
    if (!t.chapters || t.chapters.length < 2) return '';
    var here = FT.books.chapterAt(t, t.pos);
    return '<div><label class="muted">Start at ' + H.select({ 'data-chapter': t.id }, t.chapters.map(function (c) { return [c.start, c.title]; }), here && here.start) + '</label></div>';
  }
  function currentText() {
    return app.store.listTexts().then(function (list) {
      var unfinished = function (x) { return x.pos < x.words.length; };
      var t = list.filter(function (x) { return x.id === app.settings.currentText; })[0];
      return t && unfinished(t) ? t : list.filter(unfinished)[0] || null;
    });
  }
  // The book that comes with the app, offered until the user has texts of their own.
  function bundledOffer() {
    var b = FT.books.bundledText();
    if (!b) return Promise.resolve(null);
    return app.store.getText(FT.books.BUNDLED_ID).then(function (stored) { return stored ? null : b; });
  }
  function addBundled() {
    var t = FT.books.bundledText();
    return app.store.saveText(t).then(function () {
      app.settings.currentText = t.id;
      return U.saveSettings();
    }).then(function () { return t; });
  }
  function bundledLabel(b) { return b.title + ' · ' + b.author; }
  // Free reading of a text from its place as stored now (it may have moved
  // since home was drawn), after an optional change; a text deleted
  // meanwhile is not brought back: home is drawn again without it.
  function readOn(id, change) {
    return app.store.getText(id).then(function (now) {
      if (!now) return null;
      return Promise.resolve(change && change(now)).then(function () { return now; });
    }).then(U.onThisScreen(function (now) {
      if (now) { U.startExercise('prose', { text: now, free: true }); return; }
      app.reading = null;
      U.go('home');
      U.flash('That text is no longer stored.');
    })).catch(U.storageError);
  }
  // Home's way into the book: continue the current text in free reading, or
  // start the bundled one.
  function readingChoice() {
    return Promise.all([currentText(), bundledOffer()]).then(function (got) {
      var t = got[0], offer = got[1];
      if (t) {
        var c = FT.books.chapterAt(t, t.pos);
        var choice = { label: 'Continue reading: ' + t.title + (c ? ' · ' + c.title : ''), act: function () { return readOn(t.id); } };
        if (c && t.pos > c.start) {
          choice.chapterStart = { label: 'Start of this chapter: ' + c.title, act: function () {
            return readOn(t.id, function (now) { now.pos = c.start; return app.store.saveText(now); });
          } };
        }
        return choice;
      }
      if (offer) return { label: 'Read ' + offer.title, act: function () { return addBundled().then(U.onThisScreen(function (b) { U.startExercise('prose', { text: b, free: true }); })).catch(U.storageError); } };
      return null;
    });
  }
  function textForm() {
    return '<form class="stack" id="tform"><label for="ttitle">Title</label><input type="text" id="ttitle" placeholder="Moby-Dick, chapter 1">' +
      '<label for="tbody">Text</label><textarea id="tbody" class="mono" placeholder="Paste the text here"></textarea>' +
      '<div class="row"><input type="file" id="tfile" accept=".epub,.txt,application/epub+zip,text/plain" aria-label="Add from a file (EPUB or text)">' +
      '<button class="btn primary" type="submit" id="tsave">Add text</button></div>' +
      '<p class="muted">An EPUB gives the cleanest text, with its chapters; a Project Gutenberg text file works too.</p><p class="muted" id="tmsg" role="status"></p></form>';
  }
  function describeBook(b) {
    var n = b.chapters.length;
    return 'Read: ' + (b.title || 'untitled') + (b.author ? ' by ' + b.author : '') + ', ' + n + ' chapter' + (n === 1 ? '' : 's') +
      (n > 1 ? ', starting at ' + b.chapters[b.start].title : '') + '.';
  }
  function bindTextForm(after) {
    var f = document.getElementById('tform'), fromFile = null, reading = Promise.resolve(), picks = 0;
    var msg = document.getElementById('tmsg'), titleBox = document.getElementById('ttitle'), body = document.getElementById('tbody');
    function readFile(file) {
      if (/\.epub$/i.test(file.name) || file.type === 'application/epub+zip') {
        return file.arrayBuffer().then(function (b) { return FT.books.fromEpub(new Uint8Array(b)); });
      }
      return file.text().then(function (raw) { body.value = raw; return FT.books.fromText(raw); });
    }
    document.getElementById('tfile').onchange = function (e) {
      var file = e.target.files[0]; if (!file) return;
      var pick = ++picks;
      fromFile = null;
      msg.textContent = 'Reading ' + file.name + '…';
      reading = readFile(file).then(function (book) {
        if (pick !== picks) return;   // a later file was chosen meanwhile
        fromFile = book;
        if (!titleBox.value && book.title) titleBox.value = book.title;
        msg.textContent = describeBook(book);
      }, function (err) {
        if (pick === picks) msg.textContent = 'This file could not be read (' + err.message + ').';
      });
    };
    body.addEventListener('input', function () { fromFile = null; });
    function save() {
      return reading.then(function () {
        var book = fromFile || FT.books.fromText(body.value);
        var t = FT.books.toText(book, 'x' + Date.now().toString(36));
        if (t.words.length < 20) { msg.textContent = 'That text is too short: paste at least a paragraph.'; return; }
        if (titleBox.value.trim()) t.title = titleBox.value.trim();
        return app.store.saveText(t).then(function () {
          app.settings.currentText = t.id;
          return U.saveSettings();
        }).then(function () { after(t); });
      }).catch(U.storageError);
    }
    U.onSubmit(f, save);
  }
  function storedText(id, change) {
    return app.store.getText(id).then(function (t) { change(t); return app.store.saveText(t).then(function () { return t; }); });
  }
  function typeText(t) { U.startExercise('prose', { text: t }); }
  function textRow(t) {
    var current = t.id === app.settings.currentText, unfinished = t.pos < t.words.length;
    var fromStart = function (t) { t.pos = 0; };
    var actions =
      (current ? '' : button('Make current', function () { app.settings.currentText = t.id; return U.saveSettings().then(U.onThisScreen(U.redraw)); })) +
      (unfinished ? button('Type now', function () { return app.store.getText(t.id).then(U.onThisScreen(typeText)); }) +
          (t.pos > 0 ? button('Start over', onSecondPress('Click again to start over', function () {
            return storedText(t.id, fromStart).then(U.onThisScreen(U.redraw)).catch(U.storageError);
          })) : '')
        : button('Start over', function () { return storedText(t.id, fromStart).then(U.onThisScreen(typeText)); })) +
      button('Delete', onSecondPress('Click again to delete', function () { return app.store.deleteText(t.id).then(U.onThisScreen(U.redraw)); }), 'danger');
    return H.row([H.cell(esc(t.title) + (current ? ' ' + pill('current') : '')), H.cell(t.words.length.toLocaleString(), 'num'),
      H.cell('<span data-progress="' + esc(t.id) + '">' + FT.fmt.textProgress(t, t.pos) + '</span>' + chapterChoice(t), 'num'),
      H.cell('<div class="row">' + actions + '</div>')]);
  }
  function viewTexts() {
    U.screen('settings/texts', { render: function () {
      Promise.all([app.store.listTexts(), bundledOffer()]).then(U.onThisScreen(function (got) {
        var list = got[0], offer = got[1];
        var html = '<section class="stack">' + U.sectionHead('settings') + '<p class="muted">Prose exercises continue the current text from where you stopped. Texts stay in this browser and are included in backups.</p></section>';
        if (list.length) html += H.table(['Title', 'Words', 'Progress', ''], list.map(textRow));
        if (offer) {
          html += H.table(['Comes with the app', 'Words', ''], [H.row([H.cell(esc(bundledLabel(offer))), H.cell(offer.words.length.toLocaleString(), 'num'),
            H.cell(U.keyButton({ label: 'Type now', id: 'usebundled', onClick: function () { return addBundled().then(U.onThisScreen(typeText)).catch(U.storageError); } }))])]);
        }
        html += H.panel('Add a text', textForm());
        U.paint(html);
        bindTextForm(U.onThisScreen(U.redraw));
        app.$view.querySelectorAll('select[data-chapter]').forEach(function (sel) {
          sel.onchange = function () {
            storedText(sel.dataset.chapter, function (t) { t.pos = +sel.value; })
              .then(U.onThisScreen(function (t) { sel.closest('td').querySelector('[data-progress]').textContent = FT.fmt.textProgress(t, t.pos); })).catch(U.storageError);
          };
        });
      }));
    } });
  }

  U.route('settings/texts', viewTexts);
  Object.assign(U, { currentText: currentText, textForm: textForm, bindTextForm: bindTextForm, viewTexts: viewTexts,
    bundledOffer: bundledOffer, addBundled: addBundled, bundledLabel: bundledLabel, readingChoice: readingChoice });
})(globalThis.FT);
