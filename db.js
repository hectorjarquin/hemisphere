import Database from 'better-sqlite3';
import { load } from 'sqlite-vec';
import { createEmbedding } from './embedding.js';
import { getDbPath, getConfig } from './config.js';
import { existsSync, mkdirSync, readdirSync, unlinkSync } from 'node:fs';
import { join, sep, resolve as resolvePath } from 'node:path';

let db;

let writeCount = 0;
let lastBackupTime = 0;
const cfg = getConfig();
const RETENTION_POLICY = cfg.retention.days;


export function initDb() {
  if (db) return db;

  const path = getDbPath();
  db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 5000');
  load(db);

  db.exec(`
    CREATE TABLE IF NOT EXISTS memories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT '',
      related_ids TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT '',
      content TEXT NOT NULL,
      metadata TEXT NOT NULL DEFAULT '{}',
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
      deleted_at INTEGER DEFAULT NULL,
      archived_at INTEGER DEFAULT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_memories_project ON memories(project);
    CREATE INDEX IF NOT EXISTS idx_memories_project_created ON memories(project, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_memories_project_updated ON memories(project, updated_at DESC);

    CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
      content,
      content=memories,
      content_rowid=id,
      tokenize='unicode61'
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS memories_vec USING vec0(
      embedding float[256]
    );
  `);

  // Migration: add related_ids to existing databases (ignore if exists)
  try { db.exec('ALTER TABLE memories ADD COLUMN related_ids TEXT NOT NULL DEFAULT \'\''); } catch {}
  // Migration: add status column (ignore if exists)
  try { db.exec('ALTER TABLE memories ADD COLUMN status TEXT NOT NULL DEFAULT \'\''); } catch {}
  // Migration: add updated_at column (ignore if exists)
  try { db.exec('ALTER TABLE memories ADD COLUMN updated_at INTEGER NOT NULL DEFAULT 0'); db.prepare('UPDATE memories SET updated_at = created_at WHERE updated_at = 0').run(); } catch {}
  // Migration: add deleted_at column (ignore if exists)
  try { db.exec('ALTER TABLE memories ADD COLUMN deleted_at INTEGER DEFAULT NULL'); } catch {}
  // Migration: add archived_at column — v1.2.0 (ignore if exists)
  try { db.exec('ALTER TABLE memories ADD COLUMN archived_at INTEGER DEFAULT NULL'); } catch {}

  return db;
}

function recordWrite() {
  writeCount++;
  if (writeCount >= cfg.backup.intervalWrites) {
    doBackup();
  }
}

export function doBackup() {
  const d = initDb();
  if (!existsSync(cfg.backup.dir)) {
    mkdirSync(cfg.backup.dir, { recursive: true });
  }

  const ts = new Date().toISOString().replace('T', '-').replace(/:/g, '-').replace(/\..+/, '');
  const filename = `memories-${ts}-${Date.now() % 100000}.db`;
  const filepath = join(cfg.backup.dir, filename);

  const abs = resolvePath(filepath);
  if (!abs.startsWith(cfg.backup.dir + sep)) throw new Error('Backup path outside backup directory');
  d.exec(`VACUUM INTO '${abs.replace(/'/g, "''")}'`);

  writeCount = 0;
  lastBackupTime = Date.now();

  enforceRetention();
  return { filename, filepath };
}

function enforceRetention() {
  if (!existsSync(cfg.backup.dir)) return;
  const files = readdirSync(cfg.backup.dir)
    .filter(f => f.startsWith('memories-') && f.endsWith('.db'))
    .sort();

  while (files.length > cfg.backup.retentionCount) {
    const oldest = files.shift();
    unlinkSync(join(cfg.backup.dir, oldest));
  }
}

export function listBackups() {
  if (!existsSync(cfg.backup.dir)) return [];
  return readdirSync(cfg.backup.dir)
    .filter(f => f.startsWith('memories-') && f.endsWith('.db'))
    .sort()
    .reverse();
}

export function enforceLiveRetention() {
  const d = initDb();
  const now = Math.floor(Date.now() / 1000);
  let purged = 0;

  for (const [kind, days] of Object.entries(RETENTION_POLICY)) {
    if (days <= 0) continue;
    const cutoff = now - days * 86400;
    const result = d.prepare(
      'DELETE FROM memories WHERE kind = ? AND deleted_at IS NULL AND created_at < ?'
    ).run(kind, cutoff);
    purged += result.changes;
  }

  // Keep at least one progressive_summary (dual trigger depends on it)
  const psCount = d.prepare(
    'SELECT COUNT(*) as c FROM memories WHERE kind = ? AND deleted_at IS NULL'
  ).get('progressive_summary').c;
  if (psCount === 0) {
    const newestPs = d.prepare(
      'SELECT id FROM memories WHERE kind = ? AND deleted_at IS NOT NULL ORDER BY deleted_at DESC LIMIT 1'
    ).get('progressive_summary');
    if (newestPs) {
      d.prepare('UPDATE memories SET deleted_at = NULL WHERE id = ?').run(newestPs.id);
      purged--;
    }
  }

  if (purged > 0) {
    d.exec("INSERT INTO memories_fts(memories_fts, rank) VALUES('optimize', 0)");
  }
  return purged;
}

function resolveSchema(project) {
  const schemas = getConfig().schemas || {};
  return schemas[project] || schemas.default;
}

function normalizeMetadata(project, kind, rawMeta, now) {
  const schema = resolveSchema(project);
  const kindSchema = schema?.kinds?.[kind];

  let meta;
  if (kindSchema) {
    meta = { ...kindSchema.defaults };
    if (rawMeta && typeof rawMeta === 'object') {
      for (const key of Object.keys(rawMeta)) {
        if (rawMeta[key] !== undefined && rawMeta[key] !== null) {
          meta[key] = rawMeta[key];
        }
      }
    }
    for (const key of (kindSchema.required || [])) {
      if (meta[key] === undefined || meta[key] === null) {
        meta[key] = kindSchema.defaults[key];
      }
    }
    const validStatuses = kindSchema.statuses || [];
    if (validStatuses.length > 0 && meta.status && !validStatuses.includes(meta.status)) {
      throw new Error(
        `Invalid status "${meta.status}" for kind "${kind}". Valid: ${validStatuses.join(", ")}`
      );
    }
  } else {
    meta = rawMeta && typeof rawMeta === 'object' ? { ...rawMeta } : {};
  }

  const ts = now || Math.floor(Date.now() / 1000);
  meta.created_at = meta.created_at || ts;
  meta.updated_at = ts;

  return meta;
}

export function storeMemory({ project, kind, content, metadata, related_ids, status }) {
  const d = initDb();
  if (content && content.length > 100000) {
    throw new Error('Content exceeds maximum size (100,000 characters)');
  }
  const finalKind = kind || 'note';

  const metaInput = { ...(metadata || {}) };
  if (status !== undefined && status !== null) {
    metaInput.status = status;
  }

  const meta = normalizeMetadata(project, finalKind, metaInput);
  const metaStr = JSON.stringify(meta);
  const rids = Array.isArray(related_ids) ? related_ids.join(',') : String(related_ids || '');
  const now = Math.floor(Date.now() / 1000);
  const result = d.prepare(
    'INSERT INTO memories (project, kind, related_ids, status, content, metadata, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(project, finalKind, rids, meta.status || '', content, metaStr, now, now);

  const id = Number(result.lastInsertRowid);

  d.prepare('INSERT INTO memories_fts (rowid, content) VALUES (?, ?)').run(id, content);

  const embedding = createEmbedding(content);
  d.prepare('INSERT INTO memories_vec (rowid, embedding) VALUES (CAST(? AS INTEGER), ?)').run(id, Buffer.from(embedding.buffer));

  recordWrite();
  return Number(id);
}

function sanitizeFtsQuery(query) {
  const cleaned = query
    .toLowerCase()
    .replace(/[*"()\-:^~[\]{}!&|<>+=]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!cleaned) return '';

  return cleaned
    .split(/\s+/)
    .map(t => t.length >= 3 ? t + '*' : t)
    .join(' ');
}

export function searchHybrid({ project, query, limit = 10, alpha = 0.3, archived, kind }) {
  const d = initDb();
  if (alpha < 0) alpha = 0;
  if (alpha > 1) alpha = 1;
  limit = Math.min(limit, 5000);
  const K = limit * 3;
  const useVector = alpha > 0;

  const ftsQuery = sanitizeFtsQuery(query);
  if (!ftsQuery) return [];

  let queryEmbedding, queryBuf;
  if (useVector) {
    queryEmbedding = createEmbedding(query);
    queryBuf = Buffer.from(queryEmbedding.buffer);
  }

  let deletedClause, lookupClause;
  if (archived) {
    deletedClause = 'AND m.archived_at IS NOT NULL AND m.deleted_at IS NULL';
    lookupClause = 'archived_at IS NOT NULL AND deleted_at IS NULL';
  } else {
    deletedClause = 'AND m.deleted_at IS NULL AND m.archived_at IS NULL';
    lookupClause = 'deleted_at IS NULL AND archived_at IS NULL';
  }

  const ftsParams = [ftsQuery];
  const ftsProjectClause = project ? 'AND m.project = ?' : '';
  if (project) ftsParams.push(project);
  const ftsKindClause = kind && kind.trim().length > 0 ? 'AND m.kind = ?' : '';
  if (kind && kind.trim().length > 0) ftsParams.push(kind);
  ftsParams.push(K);

  const ftsResults = d.prepare(`
    SELECT m.id, m.project, m.kind, m.related_ids, m.status, m.content, m.metadata, m.created_at, m.updated_at, m.deleted_at, m.archived_at,
           f.rank as raw_rank
    FROM (SELECT rowid, rank FROM memories_fts WHERE memories_fts MATCH ?) f
    JOIN memories m ON m.id = f.rowid
    WHERE 1=1 ${deletedClause} ${ftsProjectClause} ${ftsKindClause}
    ORDER BY raw_rank
    LIMIT ?
  `).all(...ftsParams);

  const ftsRawScores = ftsResults.map(r => -r.raw_rank);
  const maxFtsScore = ftsRawScores.length > 0 ? Math.max(...ftsRawScores) : 1;

  const ftsMap = new Map();
  for (let i = 0; i < ftsResults.length; i++) {
    const r = ftsResults[i];
    const norm = maxFtsScore > 0 ? ftsRawScores[i] / maxFtsScore : 0;
    r.fts_score = Math.max(0, Math.min(1, norm));
    r.vec_score = 0;
    ftsMap.set(r.id, r);
  }

  if (useVector) {
    const vecResults = d.prepare(`
      SELECT rowid, distance
      FROM memories_vec
      WHERE embedding MATCH ?
      ORDER BY distance
      LIMIT ?
    `).all(queryBuf, K);

    const vecMap = new Map();
    for (const r of vecResults) {
      const norm = 1 - Math.min(1, r.distance / 2);
      vecMap.set(r.rowid, norm);
    }

    for (const [id, norm] of vecMap) {
      if (ftsMap.has(id)) {
        ftsMap.get(id).vec_score = norm;
      } else {
        const lookupKindClause = kind && kind.trim().length > 0 ? ' AND kind = ?' : '';
        const lookupSql = project
          ? `SELECT * FROM memories WHERE id = ? AND project = ?${lookupKindClause} AND ${lookupClause}`
          : `SELECT * FROM memories WHERE id = ?${lookupKindClause} AND ${lookupClause}`;
        const lookupParams = [id];
        if (project) lookupParams.push(project);
        if (kind && kind.trim().length > 0) lookupParams.push(kind);
        const m = d.prepare(lookupSql).get(...lookupParams);
        if (m) {
          m.fts_score = 0;
          m.vec_score = norm;
          if (typeof m.metadata === 'string') {
            m.metadata = JSON.parse(m.metadata);
          }
          ftsMap.set(m.id, m);
        }
      }
    }
  }

  const results = Array.from(ftsMap.values())
    .map(r => ({
      id: r.id,
      project: r.project,
      kind: r.kind,
      related_ids: r.related_ids ? r.related_ids.split(',').map(Number).filter(Boolean) : [],
      status: r.status || '',
      content: r.content,
      metadata: typeof r.metadata === 'string' ? JSON.parse(r.metadata) : r.metadata,
      created_at: r.created_at,
      updated_at: r.updated_at,
      score: alpha * r.vec_score + (1 - alpha) * r.fts_score
    }))
    .filter(r => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  return results;
}

export function listMemories({ project, kind, trash, archived, limit = 20 }) {
  const d = initDb();
  let sql = 'SELECT * FROM memories WHERE project = ?';
  const params = [project];

  if (kind && kind.trim().length > 0) {
    sql += ' AND kind = ?';
    params.push(kind);
  }

  if (archived) {
    sql += ' AND archived_at IS NOT NULL AND deleted_at IS NULL';
  } else if (trash) {
    sql += ' AND deleted_at IS NOT NULL';
  } else {
    sql += ' AND deleted_at IS NULL AND archived_at IS NULL';
  }

  sql += ' ORDER BY COALESCE(NULLIF(updated_at, 0), created_at) DESC LIMIT ?';
  params.push(limit);

  return d.prepare(sql).all(...params).map(r => ({
    ...r,
    metadata: JSON.parse(r.metadata || '{}'),
    related_ids: r.related_ids ? r.related_ids.split(',').map(Number).filter(Boolean) : [],
    status: r.status || ''
  }));
}

export function updateMemory({ id, project, kind, content, metadata, related_ids, status }) {
  const d = initDb();

  const existing = d.prepare('SELECT id, kind, metadata FROM memories WHERE id = ? AND project = ? AND deleted_at IS NULL').get(id, project);
  if (!existing) return false;

  const sets = [];
  const params = [];

  const effectiveKind = kind !== undefined && kind !== null ? kind : existing.kind;

  if (kind !== undefined && kind !== null) {
    sets.push('kind = ?');
    params.push(kind);
  }
  if (content !== undefined && content !== null) {
    sets.push('content = ?');
    params.push(content);
  }
  if (related_ids !== undefined) {
    const rids = Array.isArray(related_ids) ? related_ids.join(',') : String(related_ids || '');
    sets.push('related_ids = ?');
    params.push(rids);
  }

  sets.push('updated_at = unixepoch()');

  const existingMeta = JSON.parse(existing.metadata || '{}');
  const incomingMeta = metadata !== undefined && metadata !== null ? { ...metadata } : {};
  if (typeof incomingMeta === 'string') {
    try { metadata = JSON.parse(incomingMeta); } catch { metadata = {}; }
  }
  if (status !== undefined && status !== null) {
    incomingMeta.status = status;
  }
  const mergedMeta = normalizeMetadata(project, effectiveKind, { ...existingMeta, ...incomingMeta });
  sets.push('status = ?');
  params.push(mergedMeta.status || '');
  sets.push('metadata = ?');
  params.push(JSON.stringify(mergedMeta));

  params.push(id, project);
  const result = d.prepare(`UPDATE memories SET ${sets.join(', ')} WHERE id = ? AND project = ?`).run(...params);

  if (result.changes > 0) {
    if (content !== undefined && content !== null) {
      d.prepare('UPDATE memories_fts SET content = ? WHERE rowid = ?').run(content, id);

      const embedding = createEmbedding(content);
      d.prepare('DELETE FROM memories_vec WHERE rowid = CAST(? AS INTEGER)').run(id);
      d.prepare('INSERT INTO memories_vec (rowid, embedding) VALUES (CAST(? AS INTEGER), ?)').run(id, Buffer.from(embedding.buffer));
    }
    recordWrite();
    return true;
  }

  return false;
}

export function trashMemory(project, id) {
  const d = initDb();
  const result = d.prepare('UPDATE memories SET deleted_at = unixepoch() WHERE id = ? AND project = ? AND deleted_at IS NULL').run(id, project);
  if (result.changes > 0) recordWrite();
  return result.changes > 0;
}

export function deleteMemory(project, id) {
  return trashMemory(project, id);
}

export function listProjects() {
  const d = initDb();
  return d.prepare('SELECT DISTINCT project FROM memories ORDER BY project').all().map(r => r.project);
}

export function getBrief({ project, decisionsPerProject = 3 } = {}) {
  const d = initDb();

  const projects = project
    ? [project]
    : d.prepare('SELECT DISTINCT project FROM memories ORDER BY project').all().map(r => r.project);

  const results = [];

  for (const proj of projects) {
    let lastSummary = null;

    const summaryRow = d.prepare(
      "SELECT id, updated_at FROM memories WHERE project = ? AND kind = 'progressive_summary' AND deleted_at IS NULL AND archived_at IS NULL ORDER BY created_at DESC LIMIT 1"
    ).get(proj);
    if (summaryRow) {
      lastSummary = { id: summaryRow.id, stale: false };
      const newer = d.prepare(
        "SELECT COUNT(*) as c FROM memories WHERE project = ? AND deleted_at IS NULL AND archived_at IS NULL AND kind != 'progressive_summary' AND updated_at > ? LIMIT 1"
      ).get(proj, summaryRow.updated_at);
      lastSummary.stale = newer.c > 0;
    }

    const pendingCount = d.prepare(
      "SELECT COUNT(*) as c FROM memories WHERE project = ? AND deleted_at IS NULL AND archived_at IS NULL AND kind = 'plan' AND status IN ('pending','approved','in_progress')"
    ).get(proj).c;

    const openBugsCount = d.prepare(
      "SELECT COUNT(*) as c FROM memories WHERE project = ? AND deleted_at IS NULL AND archived_at IS NULL AND kind = 'bug' AND status IN ('open','in_progress')"
    ).get(proj).c;

    const activityCount = d.prepare(
      'SELECT COUNT(*) as c FROM memories WHERE project = ? AND deleted_at IS NULL AND archived_at IS NULL'
    ).get(proj).c;

    results.push({
      project: proj,
      last_summary: lastSummary,
      pending: pendingCount,
      open_bugs: openBugsCount,
      activity_count: activityCount
    });
  }

  return results;
}

export function countProject(project) {
  const d = initDb();
  const rows = d.prepare(
    'SELECT kind, COUNT(*) as count FROM memories WHERE project = ? AND deleted_at IS NULL GROUP BY kind'
  ).all(project);
  const counts = {};
  let total = 0;
  for (const r of rows) {
    counts[r.kind || '(empty)'] = r.count;
    total += r.count;
  }
  counts.total = total;
  return counts;
}

export function trashProject(project) {
  const d = initDb();
  const active = d.prepare(
    'SELECT COUNT(*) as c FROM memories WHERE project = ? AND deleted_at IS NULL'
  ).get(project);
  if (active.c === 0) {
    throw new Error(
      `Project '${project}' has no non-trashed memories to trash.`
    );
  }
  const result = d.prepare(
    'UPDATE memories SET deleted_at = unixepoch() WHERE project = ? AND deleted_at IS NULL'
  ).run(project);
  d.exec("INSERT INTO memories_fts(memories_fts, rank) VALUES('optimize', 0)");
  recordWrite();
  return result.changes;
}

export function deleteProject(project, force) {
  const d = initDb();

  const total = d.prepare(
    'SELECT COUNT(*) as c FROM memories WHERE project = ?'
  ).get(project);
  if (total.c === 0) {
    throw new Error(`Project '${project}' has no memories.`);
  }

  if (!force) {
    const active = d.prepare(
      'SELECT COUNT(*) as c FROM memories WHERE project = ? AND deleted_at IS NULL'
    ).get(project);
    if (active.c > 0) {
      throw new Error(
        `Project '${project}' has ${active.c} non-trashed memories. Trash them first or use force=true.`
      );
    }
  }

  const result = d.prepare('DELETE FROM memories WHERE project = ?').run(project);
  d.exec("INSERT INTO memories_fts(memories_fts, rank) VALUES('optimize', 0)");
  recordWrite();
  return result.changes;
}

export function deleteMemoryPermanent(project, id, force) {
  const d = initDb();
  if (!force) {
    const existing = d.prepare(
      'SELECT id FROM memories WHERE id = ? AND project = ? AND deleted_at IS NOT NULL'
    ).get(id, project);
    if (!existing) {
      throw new Error(
        `Memory #${id} is not in trash. Trash it first or use force=true.`
      );
    }
  }
  const result = d.prepare('DELETE FROM memories WHERE id = ? AND project = ?').run(id, project);
  if (result.changes > 0) {
    d.exec("INSERT INTO memories_fts(memories_fts, rank) VALUES('optimize', 0)");
    recordWrite();
  }
  return result.changes > 0;
}

export function reassignMemories(fromProject, toProject, ids) {
  const d = initDb();
  let result;
  if (ids && Array.isArray(ids) && ids.length > 0) {
    const placeholders = ids.map(() => '?').join(',');
    result = d.prepare(
      `UPDATE memories SET project = ?, updated_at = unixepoch() WHERE project = ? AND id IN (${placeholders})`
    ).run(toProject, fromProject, ...ids);
  } else {
    result = d.prepare(
      'UPDATE memories SET project = ?, updated_at = unixepoch() WHERE project = ?'
    ).run(toProject, fromProject);
  }
  if (result.changes > 0) recordWrite();
  return result.changes;
}

export function restoreMemory(project, id) {
  const d = initDb();
  const result = d.prepare('UPDATE memories SET deleted_at = NULL WHERE id = ? AND project = ? AND deleted_at IS NOT NULL').run(id, project);
  return result.changes > 0;
}

export function archiveMemory(project, id) {
  const d = initDb();
  const result = d.prepare('UPDATE memories SET archived_at = unixepoch() WHERE id = ? AND project = ? AND deleted_at IS NULL AND archived_at IS NULL').run(id, project);
  if (result.changes > 0) recordWrite();
  return result.changes > 0;
}

export function unarchiveMemory(project, id) {
  const d = initDb();
  const result = d.prepare('UPDATE memories SET archived_at = NULL WHERE id = ? AND project = ? AND archived_at IS NOT NULL').run(id, project);
  if (result.changes > 0) recordWrite();
  return result.changes > 0;
}

export function purgeExpired(retentionDays = 30) {
  const d = initDb();
  const cutoff = Math.floor(Date.now() / 1000) - retentionDays * 86400;
  const result = d.prepare('DELETE FROM memories WHERE deleted_at IS NOT NULL AND deleted_at < ?').run(cutoff);
  if (result.changes > 0) {
    d.exec("INSERT INTO memories_fts(memories_fts, rank) VALUES('optimize', 0)");
  }
  return result.changes;
}
