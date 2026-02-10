#!/usr/bin/env node
/**
 * Task Server - Simple API for project-dashboard.html to read/write tasks.md
 * 
 * Endpoints:
 *   GET  /api/tasks     - Read tasks.md
 *   POST /api/tasks     - Write tasks.md
 *   GET  /              - Serve project-dashboard.html
 *   GET  /*             - Serve static files from workspace
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 3876;
const WORKSPACE = '/root/.openclaw/workspace';
const TASKS_FILE = path.join(WORKSPACE, 'tasks.md');

const MIME_TYPES = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.md': 'text/markdown',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml'
};

function sendJSON(res, status, data) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  });
  res.end(JSON.stringify(data));
}

function sendFile(res, filePath) {
  const fullPath = path.join(WORKSPACE, filePath);
  
  // Security: prevent directory traversal
  if (!fullPath.startsWith(WORKSPACE)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.readFile(fullPath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not Found');
      return;
    }
    
    const ext = path.extname(filePath);
    const mime = MIME_TYPES[ext] || 'application/octet-stream';
    res.writeHead(200, {
      'Content-Type': mime,
      'Access-Control-Allow-Origin': '*'
    });
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    });
    res.end();
    return;
  }

  const url = req.url.split('?')[0];

  // API: Read tasks.md
  if (url === '/api/tasks' && req.method === 'GET') {
    fs.readFile(TASKS_FILE, 'utf8', (err, data) => {
      if (err) {
        sendJSON(res, 500, { error: 'Failed to read tasks.md' });
        return;
      }
      sendJSON(res, 200, { content: data, path: TASKS_FILE });
    });
    return;
  }

  // API: Write tasks.md
  if (url === '/api/tasks' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const { content } = JSON.parse(body);
        fs.writeFile(TASKS_FILE, content, 'utf8', (err) => {
          if (err) {
            sendJSON(res, 500, { error: 'Failed to write tasks.md' });
            return;
          }
          sendJSON(res, 200, { success: true, path: TASKS_FILE });
        });
      } catch (e) {
        sendJSON(res, 400, { error: 'Invalid JSON' });
      }
    });
    return;
  }

  // Serve dashboard at root
  if (url === '/') {
    sendFile(res, 'project-dashboard.html');
    return;
  }

  // Serve other static files
  sendFile(res, url);
});

server.listen(PORT, () => {
  console.log(`📋 Task Server running at http://localhost:${PORT}`);
  console.log(`   Dashboard: http://localhost:${PORT}/`);
  console.log(`   Tasks API: http://localhost:${PORT}/api/tasks`);
  console.log(`   Task file: ${TASKS_FILE}`);
});
