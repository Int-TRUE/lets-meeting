import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { Readable } from 'node:stream';
import { allowedHttpAppOrigin } from './app-origin.ts';

export function createWebServer({ origin, httpOrigin, root, demo, relay, health }) {
  const base = new URL(origin);
  if (
    (base.protocol !== 'https:' && !allowedHttpAppOrigin(base.href, httpOrigin)) ||
    base.pathname !== '/' ||
    base.search ||
    base.hash ||
    base.username ||
    base.password
  )
    throw new Error('PUBLIC_ORIGIN must be HTTPS or the configured Tailscale HTTP origin');
  const publicRoot = resolve(root);
  const types = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.ico': 'image/x-icon',
    '.woff2': 'font/woff2',
    '.pdf': 'application/pdf',
  };
  return createServer(async (req, res) => {
    try {
      if (!req.url?.startsWith('/') || req.url.startsWith('//')) {
        res.writeHead(400).end();
        return;
      }
      const url = new URL(req.url, base);
      if (url.origin !== base.origin) {
        res.writeHead(400).end();
        return;
      }
      let response;
      if (url.pathname === '/healthz') {
        await health();
        response = Response.json({ ok: true });
      } else if (url.pathname.startsWith('/api/')) {
        const headers = new Headers();
        for (const [key, value] of Object.entries(req.headers))
          if (value) headers.set(key, Array.isArray(value) ? value.join(',') : value);
        const request = new Request(url, {
          method: req.method,
          headers,
          ...(!['GET', 'HEAD'].includes(req.method ?? 'GET')
            ? { body: Readable.toWeb(req), duplex: 'half' }
            : {}),
        });
        response =
          url.pathname === '/api/mattermost-relay'
            ? await relay(request)
            : url.pathname === '/api/demo' || url.pathname.startsWith('/api/demo/')
              ? await demo(request)
              : new Response('Not found', { status: 404 });
      } else {
        if (!['GET', 'HEAD'].includes(req.method ?? 'GET')) {
          res.writeHead(405).end();
          return;
        }
        const pathname = decodeURIComponent(url.pathname);
        if (pathname.split('/').some((part) => part.startsWith('.') || part.includes('\\'))) {
          res.writeHead(404).end();
          return;
        }
        let file = resolve(publicRoot, '.' + pathname);
        if (file !== publicRoot && !file.startsWith(publicRoot + sep)) {
          res.writeHead(404).end();
          return;
        }
        const exists = await stat(file)
          .then((s) => s.isFile())
          .catch(() => false);
        if (!exists) {
          if (extname(pathname) || pathname.startsWith('/assets/')) {
            res.writeHead(404).end();
            return;
          }
          file = resolve(publicRoot, 'index.html');
        }
        const bytes = await readFile(file);
        response = new Response(bytes, {
          headers: { 'Content-Type': types[extname(file)] ?? 'application/octet-stream' },
        });
      }
      response.headers.set('Cache-Control', 'no-store');
      response.headers.set('X-Content-Type-Options', 'nosniff');
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(req.method === 'HEAD' ? undefined : Buffer.from(await response.arrayBuffer()));
    } catch {
      if (!res.headersSent)
        res.writeHead(503, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ error: '서버 연결을 확인해주세요.' }));
    }
  });
}
