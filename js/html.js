// Markup shared by the views: tables, tiles, selects and panels. Pure string
// builders; the stylesheet and the end-to-end checks rely on this markup.
(function (FT) {
  'use strict';
  var esc = FT.fmt.esc;

  function attributes(attrs) {
    return Object.keys(attrs || {}).map(function (name) { return ' ' + name + '="' + esc(attrs[name]) + '"'; }).join('');
  }
  function idAttribute(opts) { return attributes(opts && opts.id ? { id: opts.id } : null); }
  // head: heading texts; rows: <tr> markup (see row).
  function table(head, rows, opts) {
    return '<div class="tablewrap"><table' + idAttribute(opts) + '><thead><tr>' +
      head.map(function (h) { return '<th>' + esc(h) + '</th>'; }).join('') + '</tr></thead><tbody>' + rows.join('') + '</tbody></table></div>';
  }
  function row(cells, attrs) { return '<tr' + (attrs || '') + '>' + cells.join('') + '</tr>'; }
  function cell(html, cls) { return '<td' + (cls ? ' class="' + cls + '"' : '') + '>' + html + '</td>'; }
  // items: [value, label] pairs of markup.
  function tiles(items) {
    return '<div class="tiles">' + items.map(function (t) { return '<div class="tile"><b>' + t[0] + '</b><span>' + t[1] + '</span></div>'; }).join('') + '</div>';
  }
  // options: [value, label] pairs of text; chosen: the selected value, if any.
  function select(attrs, options, chosen) {
    return '<select' + attributes(attrs) + '>' + options.map(function (o) {
      var selected = chosen != null && String(o[0]) === String(chosen);
      return '<option value="' + esc(String(o[0])) + '"' + (selected ? ' selected' : '') + '>' + esc(o[1]) + '</option>';
    }).join('') + '</select>';
  }
  function panel(title, body, opts) {
    return '<section class="panel stack"' + idAttribute(opts) + '><h2>' + title + '</h2>' + body + '</section>';
  }
  // A chart's data, folded away under the chart.
  function tableView(tableHtml) {
    return '<details class="tableview"><summary>Show as table</summary>' + tableHtml + '</details>';
  }

  FT.html = { table: table, row: row, cell: cell, tiles: tiles, select: select, panel: panel, tableView: tableView };
})(globalThis.FT);
