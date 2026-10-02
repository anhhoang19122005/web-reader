// Local production test harness. API calls go exclusively to the disposable fixture.
// Usage: node tests/pwa-server.mjs .next/<isolated-build-dir> (from web/).
import http from 'node:http';
import next from 'next';
import path from 'node:path';
import fs from 'node:fs';

process.env.NODE_ENV = 'production';
const distDir = process.argv[2] || '.next';
// Next 16's custom router loads config independently. Reuse the built config,
// as its generated standalone server does, instead of editing source config.
process.env.__NEXT_PRIVATE_STANDALONE_CONFIG = JSON.stringify(JSON.parse(fs.readFileSync(path.join(distDir, 'required-server-files.json'), 'utf8')).config);
const app = next({ dev: false, dir: path.resolve('.') });
await app.prepare();
const handle = app.getRequestHandler();
http.createServer((request, response) => {
  if (!request.url.startsWith('/api/')) return handle(request, response);
  const upstream = http.request({ hostname: '127.0.0.1', port: 8099, path: request.url, method: request.method, headers: { 'content-type': request.headers['content-type'] || 'application/json' } }, (result) => {
    response.writeHead(result.statusCode, { 'content-type': 'application/json', 'cache-control': 'no-store' }); result.pipe(response);
  });
  upstream.on('error', () => { response.writeHead(502); response.end('{}'); });
  request.pipe(upstream);
}).listen(3000,'127.0.0.1',()=>process.stdout.write('Isolated production PWA test server ready on 3000\n'));
