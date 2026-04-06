// ============================================================
// PLURIBUS — Memory (SQLite)
// No Supabase. No Postgres. One file. Zero config.
// ============================================================

import Database from 'better-sqlite3';
import { mkdirSync } from 'fs';
import { join } from 'path';

const DB_PATH = join(process.cwd(), '.pluribus', 'memory.db');

export class Memory {
  constructor() {
    mkdirSync(join(process.cwd(), '.pluribus'), { recursive: true });
    this.db = new Database(DB_PATH);
    this.db.pragma('journal_mode = WAL');
    this._migrate();
  }

  _migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS missions (
        id TEXT PRIMARY KEY,
        objective TEXT NOT NULL,
        status TEXT DEFAULT 'running',
        plan TEXT DEFAULT '[]',
        iterations INTEGER DEFAULT 0,
        input_tokens INTEGER DEFAULT 0,
        output_tokens INTEGER DEFAULT 0,
        result TEXT,
        errors TEXT DEFAULT '[]',
        created_at TEXT DEFAULT (datetime('now')),
        completed_at TEXT
      );

      CREATE TABLE IF NOT EXISTS iterations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        mission_id TEXT NOT NULL,
        iteration INTEGER NOT NULL,
        action_type TEXT,
        reasoning TEXT,
        observation TEXT,
        tokens INTEGER DEFAULT 0,
        duration_ms INTEGER DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (mission_id) REFERENCES missions(id)
      );

      CREATE TABLE IF NOT EXISTS episodes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        mission_id TEXT,
        summary TEXT NOT NULL,
        outcome TEXT CHECK (outcome IN ('success', 'failure')),
        lessons TEXT DEFAULT '[]',
        created_at TEXT DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS conversations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        mission_id TEXT,
        created_at TEXT DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_iter_mission ON iterations(mission_id);
      CREATE INDEX IF NOT EXISTS idx_conv_mission ON conversations(mission_id);
      CREATE INDEX IF NOT EXISTS idx_episodes_outcome ON episodes(outcome);
    `);
  }

  // ─── MISSIONS ────────────────────────────────

  createMission(id, objective) {
    this.db.prepare(
      `INSERT INTO missions (id, objective) VALUES (?, ?)`
    ).run(id, objective);
  }

  updateMission(id, updates) {
    const fields = [];
    const values = [];
    for (const [key, val] of Object.entries(updates)) {
      fields.push(`${key} = ?`);
      values.push(typeof val === 'object' ? JSON.stringify(val) : val);
    }
    values.push(id);
    this.db.prepare(`UPDATE missions SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  }

  getMission(id) {
    const row = this.db.prepare(`SELECT * FROM missions WHERE id = ?`).get(id);
    if (!row) return null;
    return { ...row, plan: JSON.parse(row.plan || '[]'), errors: JSON.parse(row.errors || '[]') };
  }

  getRecentMissions(limit = 20) {
    return this.db.prepare(
      `SELECT * FROM missions ORDER BY created_at DESC LIMIT ?`
    ).all(limit).map(r => ({
      ...r, plan: JSON.parse(r.plan || '[]'), errors: JSON.parse(r.errors || '[]'),
    }));
  }

  // ─── ITERATIONS ──────────────────────────────

  logIteration(missionId, data) {
    this.db.prepare(`
      INSERT INTO iterations (mission_id, iteration, action_type, reasoning, observation, tokens, duration_ms)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(missionId, data.iteration, data.actionType, data.reasoning, data.observation, data.tokens, data.durationMs);
  }

  getIterations(missionId) {
    return this.db.prepare(`SELECT * FROM iterations WHERE mission_id = ? ORDER BY iteration`).all(missionId);
  }

  // ─── EPISODES (Long-term learning) ───────────

  recordEpisode(missionId, summary, outcome, lessons = []) {
    this.db.prepare(`
      INSERT INTO episodes (mission_id, summary, outcome, lessons) VALUES (?, ?, ?, ?)
    `).run(missionId, summary, outcome, JSON.stringify(lessons));
  }

  getRecentEpisodes(limit = 10) {
    return this.db.prepare(
      `SELECT * FROM episodes ORDER BY created_at DESC LIMIT ?`
    ).all(limit).map(r => ({ ...r, lessons: JSON.parse(r.lessons || '[]') }));
  }

  getFailurePatterns(limit = 10) {
    return this.db.prepare(
      `SELECT * FROM episodes WHERE outcome = 'failure' ORDER BY created_at DESC LIMIT ?`
    ).all(limit).map(r => ({ ...r, lessons: JSON.parse(r.lessons || '[]') }));
  }

  // ─── CONVERSATIONS ───────────────────────────

  saveMessage(role, content, missionId = null) {
    this.db.prepare(
      `INSERT INTO conversations (role, content, mission_id) VALUES (?, ?, ?)`
    ).run(role, content, missionId);
  }

  getConversation(limit = 50) {
    return this.db.prepare(
      `SELECT * FROM conversations ORDER BY created_at DESC LIMIT ?`
    ).all(limit).reverse();
  }

  // ─── STATS ───────────────────────────────────

  getStats() {
    const missions = this.db.prepare(`SELECT COUNT(*) as count FROM missions`).get();
    const completed = this.db.prepare(`SELECT COUNT(*) as count FROM missions WHERE status = 'completed'`).get();
    const failed = this.db.prepare(`SELECT COUNT(*) as count FROM missions WHERE status = 'failed'`).get();
    const tokens = this.db.prepare(`SELECT COALESCE(SUM(input_tokens + output_tokens), 0) as total FROM missions`).get();
    return {
      totalMissions: missions.count,
      completed: completed.count,
      failed: failed.count,
      totalTokens: tokens.total,
    };
  }
}
