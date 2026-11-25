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
    return pct(total ? pos / total : 0, 0) + ' (word ' + pos.toLocaleString() + ' of ' + total.toLocaleString() + ')';
  }
  function currentText() {
    return app.store.listTexts().then(function (list) {
      var t = list.filter(function (x) { return x.id === app.settings.currentText; })[0];
      return t || list.filter(function (x) { return x.pos < x.words.length; })[0] || null;
    });
  }
  function textForm() {
    return '<form class="stack" id="tform"><label for="ttitle">Title</label><input type="text" id="ttitle" placeholder="Moby-Dick, chapter 1">' +
      '<label for="tbody">Text</label><textarea id="tbody" class="mono" placeholder="Paste the text here"></textarea>' +
      '<div class="row"><input type="file" id="tfile" accept=".txt,text/plain"><button class="btn primary" type="submit" id="tsave">Add text</button></div><p class="muted" id="tmsg"></p></form>';
  }
  function bindTextForm(after) {
    var f = document.getElementById('tform');
    document.getElementById('tfile').onchange = function (e) {
      var file = e.target.files[0]; if (!file) return;
      var r = new FileReader();
      r.onload = function () {
        document.getElementById('tbody').value = String(r.result);
        if (!document.getElementById('ttitle').value) document.getElementById('ttitle').value = file.name.replace(/\.txt$/i, '');
      };
      r.readAsText(file);
    };
    f.addEventListener('submit', function (e) {
      e.preventDefault();
      var words = FT.text.prepare(document.getElementById('tbody').value), msg = document.getElementById('tmsg');
      if (words.length < 20) { msg.textContent = 'That text is too short: paste at least a paragraph.'; return; }
      var t = { id: 'x' + Date.now().toString(36), title: document.getElementById('ttitle').value.trim() || words.slice(0, 5).join(' '),
        words: words, pos: 0, addedAt: Date.now() };
      app.store.saveText(t).then(function () {
        app.settings.currentText = t.id;
        return saveSettings();
      }).then(function () { after(t); }).catch(storageError);
    });
  }
  function viewTexts() {
    app.store.listTexts().then(function (list) {
      var html = '<section class="stack"><h1>Texts</h1><p class="muted">Prose exercises continue the current text from where you stopped. Texts stay in this browser and are included in backups.</p></section>';
      if (list.length) {
        html += '<div class="tablewrap"><table><thead><tr><th>Title</th><th>Words</th><th>Progress</th><th></th></tr></thead><tbody>' +
          list.map(function (t) {
            var cur = t.id === app.settings.currentText;
            return '<tr><td>' + esc(t.title) + (cur ? ' ' + pill('current') : '') + '</td><td class="num">' + t.words.length.toLocaleString() + '</td><td class="num">' +
              proseProgress(t, t.pos) + '</td><td><div class="row">' +
              (cur ? '' : '<button class="btn" type="button" data-use="' + esc(t.id) + '">Make current</button>') +
              '<button class="btn" type="button" data-type="' + esc(t.id) + '">Type now</button>' +
              '<button class="btn danger" type="button" data-del="' + esc(t.id) + '">Delete</button></div></td></tr>';
          }).join('') + '</tbody></table></div>';
      }
      html += '<section class="panel stack"><h2>Add a text</h2>' + textForm() + '</section>';
      setView(html);
      bindTextForm(function () { viewTexts(); });
      app.$view.querySelectorAll('[data-use]').forEach(function (b) { b.onclick = function () { app.settings.currentText = b.dataset.use; saveSettings().then(viewTexts); }; });
      app.$view.querySelectorAll('[data-type]').forEach(function (b) {
        b.onclick = function () { app.store.getText(b.dataset.type).then(function (t) { startExercise('prose', { text: t }); }); };
      });
      app.$view.querySelectorAll('[data-del]').forEach(function (b) {
        b.onclick = function () {
          if (!b.classList.contains('armed')) { b.classList.add('armed'); b.textContent = 'Click again to delete'; return; }
          app.store.deleteText(b.dataset.del).then(viewTexts);
        };
      });
    });
  }

  Object.assign(U, { proseProgress: proseProgress, currentText: currentText, textForm: textForm, bindTextForm: bindTextForm, viewTexts: viewTexts });
})(globalThis.FT);
