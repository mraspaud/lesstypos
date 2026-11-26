// Inline index.html's stylesheet and scripts into one self-contained HTML file.
// Usage: node tools/bundle.mjs [out.html] [--fragment]
//   --fragment  omit doctype/html/head/body wrappers (for hosts that add their own)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const fragment = args.includes('--fragment');
const out = args.find((a) => !a.startsWith('--')) || path.join(root, 'dist', 'lesstypos.html');
let html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

html = html.replace(/<link rel="stylesheet" href="(css\/[^"]+)">/g, (_, p) => '<style>\n' + read(p) + '\n</style>');
html = html.replace(/<script src="([^"]+)"><\/script>/g, (_, p) => '<script>\n' + read(p).replace(/<\/script/gi, '<\\/script') + '\n</script>');
if (fragment) {
  const head = html.match(/<head>([\s\S]*?)<\/head>/)[1].replace(/<meta charset[^>]*>\n?|<meta name="viewport"[^>]*>\n?/g, '');
  const body = html.match(/<body>([\s\S]*?)<\/body>/)[1];
  html = '<meta name="claude:viewport-fit-sides" content="cover">\n' + head + body;
}
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, html);
console.log(out, (html.length / 1024).toFixed(0) + ' KB');
