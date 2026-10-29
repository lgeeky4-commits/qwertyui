// Optional dependency-free HTTP server for Render Web Services.
// A Render Static Site is preferred and does not need this server.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname);
const port = Number(process.env.PORT || 10000);
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8'
};

function send(res, code, body, type='text/plain; charset=utf-8') {
  res.writeHead(code, {'Content-Type': type, 'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'no-cache', 'Referrer-Policy': 'strict-origin-when-cross-origin'});
  res.end(body);
}

const server = http.createServer((req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed');
  let pathname;
  try { pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); }
  catch { return send(res, 400, 'Bad request'); }
  if (pathname === '/healthz') return send(res, 200, 'ok');
  if (pathname === '/') pathname = '/index.html';
  // Limit public files to a small explicit list: no project source/config exposure.
  const allowed = new Set(['/index.html', '/app.js', '/motion.js', '/tracking.js', '/styles.css', '/favicon.svg']);
  if (!allowed.has(pathname)) return send(res, 404, 'Not found');
  const file = path.resolve(root, pathname.slice(1));
  fs.readFile(file, (error, data) => {
    if (error) return send(res, 404, 'Not found');
    const contentType = types[path.extname(file)] || 'application/octet-stream';
    res.writeHead(200, {
      'Content-Type': contentType,
      'Content-Length': data.length,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'no-cache',
      'Referrer-Policy': 'strict-origin-when-cross-origin'
    });
    if (req.method === 'HEAD') res.end(); else res.end(data);
  });
});
server.listen(port, '0.0.0.0', () => console.log(`Vision Sentinel serving on 0.0.0.0:${port}`));
