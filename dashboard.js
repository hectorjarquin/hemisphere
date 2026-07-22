#!/usr/bin/env node

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { initDb } from './db.js';
import { getConfig } from './config.js';
import { createApiHandler, err } from './dashboard/api-handler.js';

const arg = process.argv[2] || 'start';
const PORT = getConfig().port;

function killOnPort(port) {
  try {
    const pids = execSync('lsof -ti:' + port, { encoding: 'utf-8' }).trim();
    if (!pids) return;
    for (const pid of pids.split('\n')) {
      try {
        const cmd = execSync('ps -p ' + pid + ' -o comm=', { encoding: 'utf-8' }).trim();
        if (cmd === 'node') process.kill(parseInt(pid), 'SIGTERM');
      } catch {}
    }
  } catch {}
}

if (arg === 'stop') {
  killOnPort(PORT);
  console.log('Hemisphere stopped');
  process.exit(0);
}
if (arg === 'restart') {
  killOnPort(PORT);
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(__dirname, 'dashboard', 'public');

const DB = initDb();

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml',
};

const sseClients = new Set();

const rateLimit = new Map();
function checkRate(ip, limit, windowMs) {
  const now = Date.now();
  const entry = rateLimit.get(ip) || { count: 0, reset: now + windowMs };
  if (now > entry.reset) { entry.count = 0; entry.reset = now + windowMs; }
  entry.count++;
  rateLimit.set(ip, entry);
  return entry.count <= limit;
}

function broadcast(type, data) {
  const cleanType = String(type).replace(/[\r\n]/g, '');
  const payload = `event: ${cleanType}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of sseClients) {
    client.write(payload);
  }
}

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', 'http://localhost:' + PORT);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = url.pathname;
  const params = url.searchParams;

  if (pathname === '/api/events' && req.method === 'GET') {
    if (sseClients.size >= 100) {
      res.writeHead(429, { 'Content-Type': 'text/plain' });
      res.end('Too many connections');
      return;
    }
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive'
    });
    res.write('\n');
    sseClients.add(res);
    req.on('close', () => { sseClients.delete(res); });
    return;
  }

  if (pathname === '/api/notify' && req.method === 'POST') {
    let body = '';
    let bodyBytes = 0;
    req.on('data', chunk => {
      bodyBytes += chunk.length;
      if (bodyBytes > 65536) { res.writeHead(413); res.end('Payload too large'); req.destroy(); return; }
      body += chunk.toString();
    });
    req.on('end', () => {
      try {
        const { event, id, project } = JSON.parse(body);
        broadcast(event, { id, project });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON' }));
      }
    });
    return;
  }

  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1';
  if (pathname.startsWith('/api/') && !checkRate(ip, 50, 1000)) {
    res.writeHead(429, { 'Content-Type': 'text/plain' });
    res.end('Rate limited');
    return;
  }

  try {
    if (pathname.startsWith('/api/')) {
      const handleApi = createApiHandler(DB);
      const result = handleApi(pathname, req.method, params) || err('Not found', 404);

      if (result.status === 200) {
        const restoreMatch = pathname.match(/^\/api\/memories\/(\d+)\/restore$/);
        if (restoreMatch && req.method === 'POST') {
          broadcast('memory_restore', { id: parseInt(restoreMatch[1], 10), project: params.get('project') || '' });
        }
        const deleteMatch = pathname.match(/^\/api\/memories\/(\d+)$/);
        if (deleteMatch && req.method === 'DELETE') {
          broadcast('memory_trash', { id: parseInt(deleteMatch[1], 10), project: params.get('project') || '' });
        }
        const purgeMatch = pathname.match(/^\/api\/memories\/(\d+)\/purge$/);
        if (purgeMatch && req.method === 'DELETE') {
          broadcast('memory_purge', { id: parseInt(purgeMatch[1], 10), project: params.get('project') || '' });
        }
        const archiveMatch = pathname.match(/^\/api\/memories\/(\d+)\/archive$/);
        if (archiveMatch && req.method === 'POST') {
          broadcast('memory_archive', { id: parseInt(archiveMatch[1], 10), project: params.get('project') || '' });
        }
        const unarchiveMatch = pathname.match(/^\/api\/memories\/(\d+)\/unarchive$/);
        if (unarchiveMatch && req.method === 'POST') {
          broadcast('memory_unarchive', { id: parseInt(unarchiveMatch[1], 10), project: params.get('project') || '' });
        }
        const projectPurgeMatch = pathname.match(/^\/api\/project\/purge$/);
        if (projectPurgeMatch && req.method === 'DELETE') {
          broadcast('project_purge', { id: null, project: params.get('project') || '' });
        }
        const projectTrashMatch = pathname.match(/^\/api\/project\/trash$/);
        if (projectTrashMatch && req.method === 'POST') {
          broadcast('project_trash', { id: null, project: params.get('project') || '' });
        }
        const reassignMatch = pathname.match(/^\/api\/reassign$/);
        if (reassignMatch && req.method === 'POST') {
          broadcast('memory_reassign', { from: params.get('from') || '', to: params.get('to') || '' });
        }
      }

      res.writeHead(result.status, result.headers);
      res.end(result.body);
      return;
    }

    const filePath = path.join(PUBLIC, pathname === '/' ? 'index.html' : pathname);
    const resolved = path.resolve(filePath);
    if (!resolved.startsWith(PUBLIC + path.sep)) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found');
      return;
    }
    const ext = path.extname(resolved);

    fs.readFile(resolved, (err, data) => {
      if (err) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not found');
        return;
      }
      res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
      res.end(data);
    });
  } catch (e) {
    console.error('Server error:', e);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Internal server error' }));
  }
});

let closing = false;
function shutdown() {
  if (closing) return;
  closing = true;
  for (const client of sseClients) { try { client.end(); } catch {} }
  server.close(() => {
    try { DB.close(); } catch {}
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 1000);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

server.listen(PORT, () => {
  console.log('\nHemisphere dashboard: http://localhost:' + PORT + '/\n');
});
server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.error('Port ' + PORT + ' is in use. Run "hemisphere stop" first.');
    process.exit(1);
  }
  throw e;
});
