const http = require('http');
const fs = require('fs');
const path = require('path');
const port = parseInt(process.argv[2] || '3000');
const root = process.argv[3] || '.';

const mime = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
};

http.createServer((req, res) => {
  let filePath = path.join(root, req.url === '/' ? '/preview.html' : req.url);
  if (!fs.existsSync(filePath) && req.url === '/') filePath = path.join(root, '/index.html');
  filePath = filePath.split('?')[0];
  const ext = path.extname(filePath);
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404); res.end('Not found');
    } else {
      res.writeHead(200, { 'Content-Type': mime[ext] || 'text/plain' });
      res.end(data);
    }
  });
}).listen(port, () => console.log(`Serving ${root} on http://localhost:${port}`));
