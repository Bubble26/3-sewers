import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.mp3': 'audio/mpeg' };

export function createServer(root = ROOT) {
  return http.createServer(async (req, res) => {
    try {
      let p = decodeURIComponent(req.url.split('?')[0]);
      if (p === '/') p = '/index.html';
      const file = join(root, normalize(p).replace(/^(\.\.[/\\])+/, ''));
      const s = await stat(file).catch(() => null);
      if (!s || !s.isFile()) { res.writeHead(404); return res.end('not found'); }
      const buf = await readFile(file);
      res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
      res.end(buf);
    } catch (e) { res.writeHead(500); res.end(String(e)); }
  });
}
export function listen(port = 0, root = ROOT) {
  const srv = createServer(root);
  return new Promise((resolve) => srv.listen(port, '127.0.0.1', () => resolve({ srv, port: srv.address().port })));
}
if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.argv[2] || 8123);
  listen(port).then(({ port }) => console.log(`stickball dev server: http://127.0.0.1:${port}/`));
}
