// Markup shared by the views: tables, tiles, selects, panels and disclosures. Pure string
// builders; the stylesheet and the end-to-end checks rely on this markup.
(function (FT) {
  'use strict';
  var esc = FT.fmt.esc;

  function attributes(attrs) {
    return Object.keys(attrs || {}).map(function (name) { return ' ' + name + '="' + esc(attrs[name]) + '"'; }).join('');
  }
  // opts.id and opts.className, where given.
  function idAndClass(opts) {
    opts = opts || {};
    return attributes(opts.id ? { id: opts.id } : null) + attributes(opts.className ? { class: opts.className } : null);
  }
  // head: heading texts; rows: <tr> markup (see row).
  function table(head, rows, opts) {
    return '<div class="tablewrap"><table' + idAndClass(opts) + '><thead><tr>' +
      head.map(function (h) { return '<th>' + esc(h) + '</th>'; }).join('') + '</tr></thead><tbody>' + rows.join('') + '</tbody></table></div>';
  }
  function row(cells, attrs) { return '<tr' + (attrs || '') + '>' + cells.join('') + '</tr>'; }
  function cell(html, cls) { return '<td' + (cls ? ' class="' + cls + '"' : '') + '>' + html + '</td>'; }
  // items: [value, label] pairs of markup; opts.plain: without their boxes.
  function tiles(items, opts) {
    return '<div class="tiles' + (opts && opts.plain ? ' plain' : '') + '">' + items.map(function (t) { return '<div class="tile"><b>' + t[0] + '</b><span>' + t[1] + '</span></div>'; }).join('') + '</div>';
  }
  // options: [value, label] pairs of text; chosen: the selected value, if any.
  function select(attrs, options, chosen) {
    return '<select' + attributes(attrs) + '>' + options.map(function (o) {
      var selected = chosen != null && String(o[0]) === String(chosen);
      return '<option value="' + esc(String(o[0])) + '"' + (selected ? ' selected' : '') + '>' + esc(o[1]) + '</option>';
    }).join('') + '</select>';
  }
  function panel(title, body, opts) {
    return '<section class="panel stack"' + idAndClass({ id: opts && opts.id }) + '><h2>' + title + '</h2>' + body + '</section>';
  }
  // Markup folded under its summary (markup); opts: id, className, open.
  function disclosure(summary, body, opts) {
    return '<details' + idAndClass(opts) + (opts && opts.open ? ' open' : '') + '><summary>' + summary + '</summary>' + body + '</details>';
  }
  // A panel folded under its title, which stays its heading; opts: id, open.
  function foldedPanel(title, body, opts) {
    return disclosure('<h2>' + title + '</h2>', body, { id: opts && opts.id, className: 'panel stack fold', open: opts && opts.open });
  }
  // A chart's data, folded away under the chart.
  function tableView(tableHtml) { return disclosure('Show as table', tableHtml, { className: 'tableview' }); }
  // One dot per step, filled for the steps done.
  function progressDots(done, total) {
    done = Math.min(done, total);
    var dots = '';
    for (var i = 0; i < total; i++) dots += i < done ? '<i class="on"></i>' : '<i></i>';
    return '<span class="dots" role="img" aria-label="' + done + ' of ' + total + ' done">' + dots + '</span>';
  }

  FT.html = { table: table, row: row, cell: cell, tiles: tiles, select: select, panel: panel, disclosure: disclosure, foldedPanel: foldedPanel, tableView: tableView, progressDots: progressDots };
})(globalThis.FT);
