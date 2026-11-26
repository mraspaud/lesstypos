// Books for the prose exercise: an EPUB or a Project Gutenberg text becomes
// chapters of ordinary text to type, without front matter, captions, page
// numbers or Gutenberg boilerplate. Stored as words with chapter starts.
(function (FT) {
  'use strict';
  var BODY_MIN_WORDS = 150; // design choice: shorter leading chapters are title pages and the like
  var NOT_PROSE = /project gutenberg|^(table of )?contents$|^(list of )?(illustrations|plates|figures)\b|^list of /i;

  // ---- words ----
  // Design choice: equivalence is per character (FT.text.canon), so letters
  // whose ASCII form is two letters are spelled out, as … becomes ... .
  var SPELLED = { 'æ': 'ae', 'Æ': 'AE', 'œ': 'oe', 'Œ': 'OE', 'ß': 'ss', '½': '1/2', '¼': '1/4', '¾': '3/4' };
  function cleanWord(w) {
    if (/^\[[\w*]{1,3}\]$/.test(w)) return ''; // a footnote marker
    w = w.replace(/[_{}]/g, '').replace(/[æÆœŒß½¼¾]/g, function (c) { return SPELLED[c]; });
    return /[\p{L}\p{N}]/u.test(w) ? w : '';
  }
  // Design choice: a paragraph opening with a word in capitals followed by a
  // lowercase word is a typographic flourish ("IT was the middle of winter"),
  // typed in normal case, unless the book uses that word in capitals
  // elsewhere too (NASA).
  var OPENING_CAPS = /^(\s*[“‘"']?)(\p{Lu})(\p{Lu}+)(?=[\s,;:’'”"]+\p{Ll})/u;
  function capitalsInside(paragraphs) {
    var seen = {};
    paragraphs.forEach(function (p) {
      (p.replace(OPENING_CAPS, '').match(/\b\p{Lu}{2,}\b/gu) || []).forEach(function (w) { seen[w] = true; });
    });
    return seen;
  }
  function softenOpening(paragraph, keep) {
    return paragraph.replace(OPENING_CAPS, function (m, lead, first, rest) { return keep[first + rest] ? m : lead + first + rest.toLowerCase(); });
  }
  function wordsOf(paragraphs, keep) {
    var text = paragraphs.map(function (p) { return softenOpening(p, keep); }).join('\n\n').replace(/(\d)([½¼¾])/g, '$1 $2');
    return FT.text.prepare(text).map(cleanWord).filter(Boolean);
  }

  function book(title, author, chapters) {
    var split = chapters.map(function (c) { return { title: c.title, paragraphs: c.text.split(/\n\s*\n/) }; });
    var keep = capitalsInside([].concat.apply([], split.map(function (c) { return c.paragraphs; })));
    chapters = split.map(function (c) { return { title: c.title, words: wordsOf(c.paragraphs, keep) }; })
      .filter(function (c) { return c.words.length && !NOT_PROSE.test(c.title.trim()); });
    var start = chapters.findIndex(function (c) { return c.words.length >= BODY_MIN_WORDS; });
    return { title: title, author: author, chapters: chapters, start: Math.max(0, start) };
  }

  // ---- markup ----
  var ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', mdash: '—', ndash: '–', hellip: '…',
    lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”' };
  function decode(s) {
    return s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, function (m, e) {
      if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : +e.slice(1));
      return ENTITIES[e.toLowerCase()] != null ? ENTITIES[e.toLowerCase()] : m;
    });
  }
  function attr(tag, name) { var m = new RegExp('\\s' + name + '\\s*=\\s*("([^"]*)"|\'([^\']*)\')', 'i').exec(tag); return m ? decode(m[2] != null ? m[2] : m[3]) : null; }
  function textOf(xml) { return decode(xml.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim(); }

  var BLOCK = /^(p|div|h[1-6]|li|blockquote|pre|tr|dt|dd|section|article|table|ul|ol|body)$/;
  var HEADING = /^h[1-6]$/;
  var VOID = /^(img|br|hr|meta|link|input|col|area|base|wbr)$/;
  var SKIPPED_TAG = /^(img|figure|figcaption|script|style|head|svg|sup|nav)$/;
  var SKIPPED_CLASS = /\b(fig\w*|caption|pagenum|pageno|pgheader|pg-header|pgfooter|pg-footer|pg-boilerplate|footnote|fnanchor|toc|transnote)\b/i;
  // A document as events in reading order: { anchor: id } and { text } per block.
  function readXhtml(xml) {
    var events = [], stack = [], skipping = 0, heading = 0, buf = '', re = /<(\/?)([a-zA-Z][\w:-]*)([^>]*?)(\/?)>|([^<]+)/g, m;
    function flush() { var t = buf.replace(/\s+/g, ' ').trim(); if (t && !heading) events.push({ text: decode(t) }); buf = ''; }
    xml = xml.replace(/<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!DOCTYPE[^>]*>/gi, '');
    while ((m = re.exec(xml))) {
      if (m[5] != null) { if (!skipping) buf += m[5]; continue; }
      var closing = m[1] === '/', name = m[2].toLowerCase().replace(/^\w+:/, ''), tag = m[3], selfClosing = m[4] === '/' || VOID.test(name);
      if (closing) {
        for (var i = stack.length - 1; i >= 0; i--) {
          if (stack[i].name !== name) continue;
          var gone = stack.splice(i);
          gone.forEach(function (g) { if (BLOCK.test(g.name)) flush(); if (g.skip) skipping--; if (HEADING.test(g.name)) heading--; });
          break;
        }
        continue;
      }
      var id = attr(tag, 'id');
      if (id && !skipping) { flush(); events.push({ anchor: id }); }
      if (name === 'br') { buf += ' '; continue; }
      if (selfClosing) continue;
      var skip = SKIPPED_TAG.test(name) || SKIPPED_CLASS.test(attr(tag, 'class') || '') || /^pg-(header|footer)/.test(id || '');
      if (BLOCK.test(name)) flush();
      if (skip) skipping++;
      if (HEADING.test(name)) heading++;
      stack.push({ name: name, skip: skip });
    }
    flush();
    return events;
  }

  // ---- EPUB ----
  function dirOf(p) { return p.indexOf('/') >= 0 ? p.slice(0, p.lastIndexOf('/') + 1) : ''; }
  function resolve(base, href) {
    var parts = (dirOf(base) + decodeURIComponent(href)).split('/'), out = [];
    parts.forEach(function (x) { if (x === '..') out.pop(); else if (x !== '.') out.push(x); });
    return out.join('/');
  }
  function tocEntries(files, opfPath, opf, manifest) {
    var ncxId = attr((/<spine[^>]*>/i.exec(opf) || [''])[0], 'toc');
    var ncx = ncxId && manifest[ncxId];
    if (ncx && files[ncx.path]) {
      var xml = new TextDecoder().decode(files[ncx.path]), out = [], re = /<navLabel>\s*<text>([\s\S]*?)<\/text>\s*<\/navLabel>\s*<content\s+src\s*=\s*"([^"]*)"/gi, m;
      while ((m = re.exec(xml))) out.push({ title: textOf(m[1]), src: resolve(ncx.path, m[2]) });
      return out;
    }
    var nav = Object.keys(manifest).map(function (k) { return manifest[k]; }).filter(function (it) { return /\bnav\b/.test(it.properties || ''); })[0];
    if (!nav) return [];
    var html = new TextDecoder().decode(files[nav.path]), list = [], a = /<a\s[^>]*href\s*=\s*"([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, n;
    var toc = /<nav[^>]*toc[^>]*>([\s\S]*?)<\/nav>/i.exec(html);
    while ((n = a.exec(toc ? toc[1] : html))) list.push({ title: textOf(n[2]), src: resolve(nav.path, n[1]) });
    return list;
  }
  function fromEpub(bytes) {
    return FT.zip.read(bytes).then(function (files) {
      var text = function (p) { if (!files[p]) throw new Error('This EPUB is missing ' + p); return new TextDecoder().decode(files[p]); };
      var opfPath = attr((/<rootfile\s[^>]*>/i.exec(text('META-INF/container.xml')) || [''])[0], 'full-path');
      var opf = text(opfPath), manifest = {}, it, re = /<item\s[^>]*>/gi;
      while ((it = re.exec(opf))) manifest[attr(it[0], 'id')] = { path: resolve(opfPath, attr(it[0], 'href')), properties: attr(it[0], 'properties') };
      var spine = (opf.match(/<itemref\s[^>]*>/gi) || []).filter(function (t) { return attr(t, 'linear') !== 'no'; })
        .map(function (t) { return manifest[attr(t, 'idref')]; }).filter(Boolean).map(function (x) { return x.path; });
      var title = textOf((/<dc:title[^>]*>([\s\S]*?)<\/dc:title>/i.exec(opf) || ['', ''])[1]);
      var authors = (opf.match(/<dc:creator[^>]*>[\s\S]*?<\/dc:creator>/gi) || []).map(textOf);
      // one stream of events, with each document's start as an anchor
      var events = [];
      spine.forEach(function (p) {
        events.push({ anchor: p + '#' });
        readXhtml(text(p)).forEach(function (e) { events.push(e.anchor ? { anchor: p + '#' + e.anchor } : e); });
      });
      var at = {};
      events.forEach(function (e, i) { if (e.anchor && at[e.anchor] == null) at[e.anchor] = i; });
      var entries = tocEntries(files, opfPath, opf, manifest).map(function (t) {
        var key = t.src.indexOf('#') >= 0 ? t.src : t.src + '#';
        return { title: t.title, from: at[key] };
      }).filter(function (t) { return t.from != null; }).sort(function (a, b) { return a.from - b.from; });
      var chapters = entries.map(function (t, k) {
        var to = k + 1 < entries.length ? entries[k + 1].from : events.length;
        return { title: t.title, text: events.slice(t.from, to).filter(function (e) { return e.text; }).map(function (e) { return e.text; }).join('\n\n') };
      });
      if (!chapters.length) chapters = [{ title: title || 'Text', text: events.filter(function (e) { return e.text; }).map(function (e) { return e.text; }).join('\n\n') }];
      return book(title, authors.join(', '), chapters);
    });
  }

  // ---- Project Gutenberg text ----
  function header(raw, field) { var m = new RegExp('^' + field + ':\\s*(.+)$', 'mi').exec(raw); return m ? m[1].trim() : null; }
  function bodyOf(raw) {
    var start = /^\*{3}\s*START OF.*$/mi.exec(raw), end = /^\*{3}\s*END OF.*$/mi.exec(raw);
    return raw.slice(start ? start.index + start[0].length : 0, end ? end.index : raw.length);
  }
  function stripEditorial(text) {
    return text.replace(/\[Illustration[\s\S]*?\]/gi, '')
      .replace(/^\s*Produced by[\s\S]*?(?=\n\s*\n|(?![\s\S]))/mi, '\n')
      .replace(/^\s*Transcriber['’]s Notes?[.:]?\s*\n\s*\n[\s\S]*?(?=\n\s*\n|(?![\s\S]))/mi, '\n');
  }
  var PAGE_NUMBER = /\s{2,}(\d+|[ivxlc]+|Frontispiece)\s*$/i;
  function norm(s) { return s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim(); }
  // Titles listed under "Contents": lines with a page number, or short plain
  // lines, until the body begins.
  var CONTENTS_LINE_MAX = 70, HEADING_LINE_MAX = 60;
  function contentsTitles(paragraphs) {
    var i = paragraphs.findIndex(function (p) { return /^\s*(table of )?contents\s*$/i.test(p); });
    if (i < 0) return { titles: [], at: 0, after: 0 };
    var titles = [], seen = {}, k = i + 1;
    for (; k < paragraphs.length; k++) {
      var lines = paragraphs[k].split('\n').filter(function (l) { return l.trim() && !/^\s*PAGE\s*$/i.test(l); });
      if (seen[norm(paragraphs[k])]) break;   // the first heading: the body begins
      var numbered = lines.filter(function (l) { return PAGE_NUMBER.test(l); });
      var listed = numbered.length ? numbered : lines.every(function (l) { return l.trim().length <= CONTENTS_LINE_MAX; }) ? lines : [];
      if (!listed.length) { if (titles.length || k > i + 2) break; continue; }
      listed.forEach(function (l) { var t = l.replace(PAGE_NUMBER, '').trim(); titles.push(t); seen[norm(t)] = true; });
    }
    return { titles: titles, at: i, after: k };
  }
  function isHeading(p) {
    var lines = p.split('\n');
    return lines.length <= 2 && lines.every(function (l) { return l.trim().length <= HEADING_LINE_MAX; });
  }
  function headingTitle(p) { return p.split('\n').map(function (l) { return l.trim(); }).join(' '); }
  var NUMBERED_HEADING = /^\s*(chapter|CHAPTER|Chapter|book|BOOK|Book|part|PART|Part)\s+([0-9]+|[IVXLCDM]+)(?=[.:]|\s|$)/;
  // A title page: a short paragraph followed by "by Author", near the start.
  function titlePage(paragraphs) {
    for (var j = 1; j < Math.min(paragraphs.length, 6); j++) {
      var by = /^\s*by\s+(.{2,60})$/i.exec(paragraphs[j]);
      if (by && isHeading(paragraphs[j - 1])) return { title: headingTitle(paragraphs[j - 1]), author: by[1].trim() };
    }
    return {};
  }
  function fromText(raw) {
    raw = String(raw).replace(/\r\n?/g, '\n');
    var paragraphs = stripEditorial(bodyOf(raw)).split(/\n\s*\n/).map(function (p) { return p.replace(/^\n+|\n+$/g, ''); }).filter(function (p) { return p.trim(); });
    var page = titlePage(paragraphs);
    var title = header(raw, 'Title') || page.title, author = header(raw, 'Author') || page.author;
    var contents = contentsTitles(paragraphs), headings = [], from = contents.after;
    contents.titles.forEach(function (t) {
      for (var j = from; j < paragraphs.length; j++) {
        if (isHeading(paragraphs[j]) && norm(paragraphs[j]) === norm(t)) { headings.push(j); from = j + 1; return; }
      }
    });
    if (!headings.length) {
      paragraphs.forEach(function (p, j) { if (isHeading(p) && p.indexOf('\n') < 0 && NUMBERED_HEADING.test(p)) headings.push(j); });
    }
    var inContents = function (j) { return contents.titles.length && j >= contents.at && j < contents.after; };
    var prose = function (from, to) {
      var kept = [];
      for (var j = from; j < to; j++) {
        if (!inContents(j) && !paragraphs[j].split('\n').every(function (l) { return PAGE_NUMBER.test(l) || !l.trim(); })) kept.push(paragraphs[j]);
      }
      return kept.join('\n\n');
    };
    if (!headings.length) return book(title, author, [{ title: title || 'Text', text: prose(0, paragraphs.length) }]);
    var lead = headings[0] > 0 ? [{ title: title || 'Opening', text: prose(0, headings[0]) }] : [];
    return book(title, author, lead.concat(headings.map(function (h, k) {
      return { title: headingTitle(paragraphs[h]), text: prose(h + 1, k + 1 < headings.length ? headings[k + 1] : paragraphs.length) };
    })));
  }

  // ---- stored form ----
  function toText(b, id) {
    var words = [], chapters = b.chapters.map(function (c) { var start = words.length; words.push.apply(words, c.words); return { title: c.title, start: start }; });
    return { id: id, title: b.title || (words.slice(0, 5).join(' ')), words: words, chapters: chapters,
      pos: chapters.length ? chapters[b.start].start : 0, addedAt: Date.now() };
  }
  function chapterAt(text, pos) {
    var found = null;
    (text.chapters || []).forEach(function (c) { if (c.start <= pos) found = c; });
    return found;
  }

  var BUNDLED_ID = 'alice';
  function bundled() {
    var b = FT.data && FT.data.alice;
    if (!b) return null;
    return { title: b.title, author: b.author, start: 0,
      chapters: b.chapters.map(function (c) { return { title: c.title, words: c.text.split(' ') }; }) };
  }

  FT.books = { fromEpub: fromEpub, fromText: fromText, toText: toText, chapterAt: chapterAt, readXhtml: readXhtml,
    bundled: bundled, BUNDLED_ID: BUNDLED_ID };
})(globalThis.FT);
