// Texts for prose exercises: add, choose, delete.
(function (FT) {
  'use strict';
  if (typeof document === 'undefined') return;
  var U = FT.ui, app = U.app;
  var esc = FT.fmt.esc, pct = FT.fmt.pct, pill = FT.fmt.pill;
  // defined in other ui files
  function saveSettings() { return U.saveSettings.apply(null, arguments); }
  function setView() { return U.setView.apply(null, arguments); }
  function startExercise() { return U.startExercise.apply(null, arguments); }
  function storageError() { return U.storageError.apply(null, arguments); }

  // ---------- texts ----------
  function proseProgress(t, pos) {
    var total = t.words ? t.words.length : t.total;
    pos = Number(pos) || 0;
    return pct(total ? pos / total : 0, 0) + ' (word ' + pos.toLocaleString() + ' of ' + total.toLocaleString() + ')';
  }
  // "Start at" for a text with chapters.
  var LONG_TEXT = 2000; // words: a book, where choosing a chapter matters
  function chapterChoice(t) {
    if (!t.chapters && t.words.length > LONG_TEXT) return '<div class="muted">No chapters: add it again from its EPUB to choose where to start.</div>';
    if (!t.chapters || t.chapters.length < 2) return '';
    var here = FT.books.chapterAt(t, t.pos);
    return '<div><label class="muted">Start at <select data-chapter="' + esc(t.id) + '">' + t.chapters.map(function (c) {
      return '<option value="' + c.start + '"' + (c === here ? ' selected' : '') + '>' + esc(c.title) + '</option>';
    }).join('') + '</select></label></div>';
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
      return saveSettings();
    }).then(function () { return t; });
  }
  function bundledLabel(b) { return b.title + ' · ' + b.author; }
  // Home's way into the book: continue the current text in free reading, or
  // start the bundled one.
  function readingChoice() {
    return Promise.all([currentText(), bundledOffer()]).then(function (got) {
      var t = got[0], offer = got[1];
      if (t) {
        var c = FT.books.chapterAt(t, t.pos);
        var resume = function () {   // the place as stored now: it may have moved since home was drawn
          app.store.getText(t.id).then(U.onThisScreen(function (now) { startExercise('prose', { text: now || t, free: true }); })).catch(storageError);
        };
        var choice = { label: 'Continue reading: ' + t.title + (c ? ' · ' + c.title : ''), act: resume };
        if (c && t.pos > c.start) {
          choice.chapterStart = { label: 'Start of this chapter: ' + c.title, act: function () {
            app.store.getText(t.id).then(function (now) { now.pos = c.start; return app.store.saveText(now).then(function () { return now; }); })
              .then(U.onThisScreen(function (now) { startExercise('prose', { text: now, free: true }); })).catch(storageError);
          } };
        }
        return choice;
      }
      if (offer) return { label: 'Read ' + offer.title, act: function () { addBundled().then(function (b) { startExercise('prose', { text: b, free: true }); }).catch(storageError); } };
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
    f.addEventListener('submit', function (e) {
      e.preventDefault();
      reading.then(function () {
        var book = fromFile || FT.books.fromText(body.value);
        var t = FT.books.toText(book, 'x' + Date.now().toString(36));
        if (t.words.length < 20) { msg.textContent = 'That text is too short: paste at least a paragraph.'; return; }
        if (titleBox.value.trim()) t.title = titleBox.value.trim();
        return app.store.saveText(t).then(function () {
          app.settings.currentText = t.id;
          return saveSettings();
        }).then(function () { after(t); });
      }).catch(storageError);
    });
  }
  // A click handler that asks first: the first press arms the button, the second acts.
  function onSecondPress(button, askLabel, act) {
    return function () {
      if (!button.classList.contains('armed')) { button.classList.add('armed'); button.textContent = askLabel; return; }
      act();
    };
  }
  function viewTexts() {
    Promise.all([app.store.listTexts(), bundledOffer()]).then(U.onThisScreen(function (got) {
      var list = got[0], offer = got[1];
      var html = '<section class="stack">' + U.sectionHead('settings') + '<p class="muted">Prose exercises continue the current text from where you stopped. Texts stay in this browser and are included in backups.</p></section>';
      if (list.length) {
        html += '<div class="tablewrap"><table><thead><tr><th>Title</th><th>Words</th><th>Progress</th><th></th></tr></thead><tbody>' +
          list.map(function (t) {
            var cur = t.id === app.settings.currentText;
            return '<tr><td>' + esc(t.title) + (cur ? ' ' + pill('current') : '') + '</td><td class="num">' + t.words.length.toLocaleString() + '</td><td class="num">' +
              '<span data-progress="' + esc(t.id) + '">' + proseProgress(t, t.pos) + '</span>' + chapterChoice(t) + '</td><td><div class="row">' +
              (cur ? '' : '<button class="btn" type="button" data-use="' + esc(t.id) + '">Make current</button>') +
              (t.pos < t.words.length ? '<button class="btn" type="button" data-type="' + esc(t.id) + '">Type now</button>' +
                  (t.pos > 0 ? '<button class="btn" type="button" data-startover="' + esc(t.id) + '">Start over</button>' : '')
                : '<button class="btn" type="button" data-restart="' + esc(t.id) + '">Start over</button>') +
              '<button class="btn danger" type="button" data-del="' + esc(t.id) + '">Delete</button></div></td></tr>';
          }).join('') + '</tbody></table></div>';
      }
      if (offer) {
        html += '<div class="tablewrap"><table><thead><tr><th>Comes with the app</th><th>Words</th><th></th></tr></thead><tbody><tr><td>' + esc(bundledLabel(offer)) +
          '</td><td class="num">' + offer.words.length.toLocaleString() +
          '</td><td><button class="btn" type="button" id="usebundled">Type now</button></td></tr></tbody></table></div>';
      }
      html += '<section class="panel stack"><h2>Add a text</h2>' + textForm() + '</section>';
      setView(html);
      if (offer) document.getElementById('usebundled').onclick = function () {
        addBundled().then(U.onThisScreen(function (t) { startExercise('prose', { text: t }); })).catch(storageError);
      };
      bindTextForm(U.onThisScreen(viewTexts));
      app.$view.querySelectorAll('[data-use]').forEach(function (b) { b.onclick = function () { app.settings.currentText = b.dataset.use; saveSettings().then(U.onThisScreen(viewTexts)); }; });
      app.$view.querySelectorAll('[data-type]').forEach(function (b) {
        b.onclick = function () { app.store.getText(b.dataset.type).then(U.onThisScreen(function (t) { startExercise('prose', { text: t }); })); };
      });
      app.$view.querySelectorAll('select[data-chapter]').forEach(function (sel) {
        sel.onchange = function () {
          app.store.getText(sel.dataset.chapter).then(function (t) { t.pos = +sel.value; return app.store.saveText(t).then(function () { return t; }); })
            .then(U.onThisScreen(function (t) { sel.closest('td').querySelector('[data-progress]').textContent = proseProgress(t, t.pos); })).catch(storageError);
        };
      });
      app.$view.querySelectorAll('[data-restart]').forEach(function (b) {
        b.onclick = function () {
          app.store.getText(b.dataset.restart).then(function (t) { t.pos = 0; return app.store.saveText(t).then(function () { return t; }); })
            .then(U.onThisScreen(function (t) { startExercise('prose', { text: t }); }));
        };
      });
      app.$view.querySelectorAll('[data-startover]').forEach(function (b) {
        b.onclick = onSecondPress(b, 'Click again to start over', function () {
          app.store.getText(b.dataset.startover).then(function (t) { t.pos = 0; return app.store.saveText(t); }).then(U.onThisScreen(viewTexts)).catch(storageError);
        });
      });
      app.$view.querySelectorAll('[data-del]').forEach(function (b) {
        b.onclick = onSecondPress(b, 'Click again to delete', function () { app.store.deleteText(b.dataset.del).then(U.onThisScreen(viewTexts)); });
      });
    }));
  }

  Object.assign(U, { proseProgress: proseProgress, currentText: currentText, textForm: textForm, bindTextForm: bindTextForm, viewTexts: viewTexts,
    bundledOffer: bundledOffer, addBundled: addBundled, bundledLabel: bundledLabel, readingChoice: readingChoice });
})(globalThis.FT);
