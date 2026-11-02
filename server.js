'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const IPTV_DEFAULT_BASE = 'http://191.96.78.246';
const publicFiles = new Set([
  '/index.html', '/styles.css', '/app.js',
  '/modules/auth.js', '/modules/api.js', '/modules/storage.js',
  '/modules/renderer.js', '/modules/player.js', '/modules/navigation.js'
]);

const server = http.createServer(function (request, response) {
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.writeHead(405, { Allow: 'GET, HEAD' });
    response.end();
    return;
  }

  let url;
  try { url = new URL(request.url, 'http://localhost'); }
  catch {
    response.writeHead(400);
    response.end();
    return;
  }

  // shortcut: only the default API is proxied; add trusted targets if another provider needs CORS support.
  if (url.pathname === '/iptv/player_api.php') {
    const upstream = http.get(IPTV_DEFAULT_BASE + '/player_api.php' + url.search, function (remote) {
      if (remote.statusCode >= 300 && remote.statusCode < 400) {
        remote.resume();
        response.writeHead(502);
        response.end('Redirecionamento do provedor recusado.');
        return;
      }
      response.writeHead(remote.statusCode, {
        'Content-Type': remote.headers['content-type'] || 'text/plain; charset=utf-8'
      });
      remote.on('error', function () { response.destroy(); });
      remote.pipe(response);
    });
    upstream.setTimeout(120000, function () { upstream.destroy(); });
    upstream.on('error', function () {
      if (response.headersSent) { response.destroy(); return; }
      response.writeHead(502);
      response.end('Nao foi possivel acessar o provedor IPTV.');
    });
    response.on('close', function () { upstream.destroy(); });
    return;
  }

  const pathname = url.pathname === '/' ? '/index.html' : url.pathname;
  if (!publicFiles.has(pathname)) {
    response.writeHead(404);
    response.end();
    return;
  }

  fs.readFile(path.join(__dirname, pathname), 'utf8', function (error, content) {
    if (error) {
      response.writeHead(500);
      response.end('Nao foi possivel carregar o app.');
      return;
    }
    const extension = path.extname(pathname);
    const contentType = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript' }[extension];
    if (pathname === '/index.html') {
      content = content.replace('<head>', '<head>\n  <script>window.IPTV_PROXY = true;</script>');
    }
    response.writeHead(200, { 'Content-Type': contentType + '; charset=utf-8' });
    response.end(request.method === 'HEAD' ? '' : content);
  });
});

if (require.main === module) {
  server.on('error', function (error) {
    console.error('Falha ao iniciar o servidor: ' + error.code);
    process.exitCode = 1;
  });
  const host = process.env.HOST || '127.0.0.1';
  server.listen(Number(process.env.PORT || 8080), host, function () {
    console.log('MPlay: http://' + host + ':' + server.address().port);
  });
}

module.exports = server;
