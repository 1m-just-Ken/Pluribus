// ============================================================
// PLURIBUS — Server v2
// File upload/download, cancel, streaming events
// ============================================================

import { readFileSync, existsSync, mkdirSync, readdirSync, createReadStream } from 'fs';
import { writeFile } from 'fs/promises';
import { fileURLToPath } from 'url';
import { dirname, join, basename } from 'path';
import express from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { LLMProvider } from '../providers/llm.js';
import { CenturionLoop } from '../core/centurion.js';
import { Memory } from '../core/memory.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '../..');
const WORKSPACE = join(ROOT, '.pluribus', 'workspace');
const UPLOAD_DIR = join(WORKSPACE, 'uploads');

// Load .env
const envPath = join(ROOT, '.env');
if (existsSync(envPath)) {
  readFileSync(envPath, 'utf-8').split('\n').forEach(line => {
    const t = line.trim();
    if (!t || t.startsWith('#')) return;
    const eq = t.indexOf('=');
    if (eq === -1) return;
    const k = t.slice(0, eq).trim(), v = t.slice(eq + 1).trim();
    if (!process.env[k]) process.env[k] = v;
  });
}

const PORT = process.env.PORT || 3000;

async function main() {
  console.log('');
  console.log('  ╔═══════════════════════════════════╗');
  console.log('  ║         P L U R I B U S           ║');
  console.log('  ║       E Pluribus Unum             ║');
  console.log('  ╚═══════════════════════════════════╝');
  console.log('');

  const llm = new LLMProvider();
  await llm.init();
  const info = llm.getInfo();
  console.log(`  Provider: ${info.provider}`);
  console.log(`  Model:    ${info.model}`);
  if (info.precision) console.log(`  Precision: ${info.precision} (${info.size})`);

  if (['ollama', 'bonsai'].includes(info.provider)) {
    try {
      await llm.ensureModel();
      console.log('  Status:   Ready');
    } catch (err) {
      console.error(`\n  ${err.message}`);
      console.error('  Install Ollama: https://ollama.ai\n');
      process.exit(1);
    }
  }

  const memory = new Memory();
  console.log('  Memory:   SQLite ready');

  mkdirSync(WORKSPACE, { recursive: true });
  mkdirSync(UPLOAD_DIR, { recursive: true });

  const app = express();
  const server = createServer(app);
  const wss = new WebSocketServer({ server });

  app.use(express.json({ limit: '50mb' }));

  const broadcast = (type, data) => {
    const msg = JSON.stringify({ type, data, ts: Date.now() });
    wss.clients.forEach(c => { if (c.readyState === 1) c.send(msg); });
  };

  const centurion = new CenturionLoop(llm, memory, (type, data) => broadcast(type, data));

  // ─── WEBSOCKET ──────────────────────────────────────────

  wss.on('connection', ws => {
    ws.send(JSON.stringify({
      type: 'init',
      data: {
        stats: memory.getStats(),
        provider: llm.getInfo(),
        running: centurion.isRunning(),
        missionId: centurion.getMissionId(),
        history: memory.getConversation(30),
      },
    }));

    ws.on('message', async raw => {
      let msg;
      try { msg = JSON.parse(raw); } catch { return; }

      // ── SEND MESSAGE / START MISSION ──
      if (msg.type === 'message') {
        const text = msg.content?.trim();
        if (!text) return;

        memory.saveMessage('user', text);
        broadcast('message', { role: 'user', content: text });

        if (centurion.isRunning()) {
          broadcast('message', { role: 'centurion', content: 'I am on a mission. Stand by, or cancel with the abort button.' });
          return;
        }

        broadcast('message', { role: 'centurion', content: 'Mission acknowledged. Executing now...' });
        broadcast('mission.active', { running: true });

        try {
          const result = await centurion.executeMission(text, msg.files || []);
          const reply = result.success ? result.summary : `Mission failed: ${result.summary}`;
          memory.saveMessage('centurion', reply);
          broadcast('message', { role: 'centurion', content: reply });

          // Report created files
          if (result.files?.length > 0) {
            broadcast('mission.files', { files: result.files });
          }

          broadcast('stats', memory.getStats());
        } catch (err) {
          const errMsg = `Critical error: ${err.message}`;
          memory.saveMessage('centurion', errMsg);
          broadcast('message', { role: 'centurion', content: errMsg });
        }

        broadcast('mission.active', { running: false });
      }

      // ── ABORT MISSION ──
      if (msg.type === 'abort') {
        if (centurion.isRunning()) {
          centurion.abort();
          broadcast('message', { role: 'centurion', content: 'Abort requested. Standing down after current action.' });
        }
      }

      // ── STATS ──
      if (msg.type === 'get_stats') {
        ws.send(JSON.stringify({ type: 'stats', data: memory.getStats() }));
      }

      // ── MISSION HISTORY ──
      if (msg.type === 'get_missions') {
        ws.send(JSON.stringify({ type: 'missions', data: memory.getRecentMissions() }));
      }

      // ── MISSION DETAIL ──
      if (msg.type === 'get_iterations' && msg.missionId) {
        ws.send(JSON.stringify({
          type: 'iterations',
          data: memory.getIterations(msg.missionId),
        }));
      }
    });
  });

  // ─── FILE UPLOAD ────────────────────────────────────────

  app.post('/api/upload', async (req, res) => {
    try {
      const { filename, content } = req.body; // content is base64
      if (!filename || !content) return res.status(400).json({ error: 'filename and content required' });

      const safe = basename(filename).replace(/[^a-zA-Z0-9._-]/g, '_');
      const filepath = join(UPLOAD_DIR, safe);
      const buffer = Buffer.from(content, 'base64');
      await writeFile(filepath, buffer);

      res.json({ success: true, filename: safe, size: buffer.length, path: `uploads/${safe}` });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ─── FILE DOWNLOAD ──────────────────────────────────────

  app.get('/api/files/:filename', (req, res) => {
    const safe = basename(req.params.filename);
    const filepath = join(WORKSPACE, safe);
    if (!existsSync(filepath)) return res.status(404).json({ error: 'File not found' });
    res.download(filepath, safe);
  });

  // ─── LIST WORKSPACE FILES ───────────────────────────────

  app.get('/api/files', (_, res) => {
    try {
      const files = readdirSync(WORKSPACE, { withFileTypes: true })
        .filter(f => f.isFile())
        .map(f => ({ name: f.name, path: `/api/files/${f.name}` }));
      const uploads = existsSync(UPLOAD_DIR)
        ? readdirSync(UPLOAD_DIR, { withFileTypes: true })
            .filter(f => f.isFile())
            .map(f => ({ name: f.name, path: `/api/files/uploads/${f.name}`, uploaded: true }))
        : [];
      res.json([...files, ...uploads]);
    } catch (err) {
      res.json([]);
    }
  });

  app.get('/api/files/uploads/:filename', (req, res) => {
    const safe = basename(req.params.filename);
    const filepath = join(UPLOAD_DIR, safe);
    if (!existsSync(filepath)) return res.status(404).json({ error: 'File not found' });
    res.download(filepath, safe);
  });

  // ─── API ────────────────────────────────────────────────

  app.get('/api/stats', (_, res) => res.json(memory.getStats()));
  app.get('/api/missions', (_, res) => res.json(memory.getRecentMissions()));
  app.get('/api/provider', (_, res) => res.json(llm.getInfo()));

  // ─── STATIC + SPA ──────────────────────────────────────

  app.use(express.static(join(__dirname, '../ui')));
  app.get('*', (_, res) => res.sendFile(join(__dirname, '../ui/index.html')));

  // ─── START ──────────────────────────────────────────────

  server.listen(PORT, () => {
    console.log('');
    console.log(`  Ready: http://localhost:${PORT}`);
    console.log('');
    console.log('  Give your orders, Commander.');
    console.log('');
  });

  const shutdown = () => {
    console.log('\n  Standing down. Ave atque vale.\n');
    wss.close(); server.close(); process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch(err => { console.error('  Fatal:', err.message); process.exit(1); });
