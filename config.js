import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';

const DEFAULTS = {
  port: 3456,
  dbPath: join(homedir(), '.hemisphere', 'memories.db'),
  backup: {
    dir: join(homedir(), '.hemisphere', 'backups'),
    intervalWrites: 50,
    retentionCount: 10
  },
  retention: {
    days: {
      note: 30,
      plan: 180,
      decision: 0,
      fact: 0,
      bug: 180,
      progressive_summary: 90
    },
    trashPurgeDays: 30
  },
  search: {
    limit: 10,
    alpha: 0.3
  },
  list: {
    limit: 20
  },
  summary: {
    turnThreshold: 10,
    contextThreshold: 20,
    recentLimit: 50
  },
  dashboard: {
    paginationLimit: 50,
    maxLimit: 200
  },
  schemas: {
    default: {
      kinds: {
        fact:     { statuses: [], defaults: {} },
        decision: { statuses: ["proposed","approved","rejected","implemented","superseded"],
                    required: ["status"],
                    defaults: { status: "proposed", files: [], rationale: "" } },
        bug:      { statuses: ["open","in_progress","fixed","wont_fix","cant_repro"],
                    required: ["status"],
                    defaults: { status: "open", severity: "minor", files: [] } },
        plan:     { statuses: ["pending","in_progress","completed","cancelled"],
                    required: ["status"],
                    defaults: { status: "pending", files: [], steps: [] } },
        note:     { statuses: [], defaults: { tags: [], cwd: "" } }
      }
    }
  }
};

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function deepMerge(target, source) {
  for (const key of Object.keys(source)) {
    if (!Object.hasOwn(target, key)) {
      target[key] = JSON.parse(JSON.stringify(source[key]));
      continue;
    }
    const tv = target[key];
    const sv = source[key];
    if (isObject(tv) && isObject(sv)) {
      deepMerge(tv, sv);
    } else {
      target[key] = sv;
    }
  }
  return target;
}

function readConfigFile() {
  try {
    const filePath = join(homedir(), '.hemisphere', 'config.json');
    if (!existsSync(filePath)) return {};
    const raw = readFileSync(filePath, 'utf-8').trim();
    if (!raw) return {};
    return JSON.parse(raw);
  } catch (e) {
    console.warn('Hemisphere: config.json parse error \u2014 using defaults:', e.message);
    return {};
  }
}

function resolveTilde(p) {
  if (typeof p === 'string' && p.startsWith('~')) {
    return join(homedir(), p.slice(1));
  }
  return p;
}

function applyEnvOverrides(cfg) {
  if (process.env.HEMISPHERE_PORT && process.env.HEMISPHERE_PORT.trim()) {
    cfg.port = parseInt(process.env.HEMISPHERE_PORT.trim(), 10) || cfg.port;
  }
  if (process.env.HEMISPHERE_DB_PATH && process.env.HEMISPHERE_DB_PATH.trim()) {
    cfg.dbPath = resolveTilde(process.env.HEMISPHERE_DB_PATH.trim());
  }
  if (process.env.BACKUP_DIR && process.env.BACKUP_DIR.trim()) {
    cfg.backup.dir = process.env.BACKUP_DIR.trim();
  }
  if (process.env.BACKUP_INTERVAL_WRITES && process.env.BACKUP_INTERVAL_WRITES.trim()) {
    cfg.backup.intervalWrites = parseInt(process.env.BACKUP_INTERVAL_WRITES.trim(), 10) || cfg.backup.intervalWrites;
  }
  if (process.env.BACKUP_RETENTION_COUNT && process.env.BACKUP_RETENTION_COUNT.trim()) {
    cfg.backup.retentionCount = parseInt(process.env.BACKUP_RETENTION_COUNT.trim(), 10) || cfg.backup.retentionCount;
  }
  if (process.env.RETENTION_POLICY && process.env.RETENTION_POLICY.trim()) {
    try {
      const parsed = JSON.parse(process.env.RETENTION_POLICY.trim());
      const days = {};
      for (const [k, v] of Object.entries(parsed)) {
        if (v === 'forever' || v === 0 || v === '0' || String(v) === '0') {
          days[k] = 0;
        } else {
          days[k] = parseInt(v, 10) || cfg.retention.days[k] || 0;
        }
      }
      Object.assign(cfg.retention.days, days);
    } catch (e) {
      console.warn('Hemisphere: RETENTION_POLICY parse error \u2014 using defaults:', e.message);
    }
  }
}

let _cfg = null;

export function getConfig() {
  if (_cfg) return _cfg;
  const defaults = JSON.parse(JSON.stringify(DEFAULTS));
  _cfg = deepMerge(defaults, readConfigFile());
  applyEnvOverrides(_cfg);
  _cfg.dbPath = resolveTilde(_cfg.dbPath);
  return _cfg;
}

export function getDbPath() {
  const path = getConfig().dbPath;
  const dir = dirname(path);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return path;
}
