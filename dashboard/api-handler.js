import { searchHybrid, trashMemory, restoreMemory, purgeExpired, doBackup, listBackups, enforceLiveRetention, deleteMemoryPermanent, trashProject, deleteProject, reassignMemories } from '../db.js';
import { getConfig } from '../config.js';

export function json(data, status = 200) {
  return { status, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) };
}

export function err(msg, status = 500) {
  return json({ error: msg }, status);
}

export function createApiHandler(db) {
  return function handleApi(path, method, params) {
    if (path === '/api/projects' && method === 'GET') {
      const rows = db.prepare('SELECT DISTINCT project FROM memories ORDER BY project').all();
      return json(rows.map(r => r.project));
    }

    if (path === '/api/stats' && method === 'GET') {
      const project = params.get('project') || '';
      let total, kinds;
      if (project) {
        total = db.prepare('SELECT COUNT(*) as c FROM memories WHERE project = ? AND deleted_at IS NULL').get(project).c;
        kinds = db.prepare('SELECT DISTINCT kind FROM memories WHERE project = ? AND deleted_at IS NULL ORDER BY kind').all(project).map(r => r.kind).filter(Boolean);
      } else {
        total = db.prepare('SELECT COUNT(*) as c FROM memories WHERE deleted_at IS NULL').get().c;
        kinds = db.prepare('SELECT DISTINCT kind FROM memories WHERE deleted_at IS NULL ORDER BY kind').all().map(r => r.kind).filter(Boolean);
      }
      return json({ total, kinds });
    }

    if (path === '/api/memories' && method === 'GET') {
      const project = params.get('project') || '';
      const kind = params.get('kind') || '';
      const search = params.get('search') || '';
      const trash = params.get('trash') === '1';
      const maxLimit = getConfig().dashboard.maxLimit;
      const limit = Math.min(parseInt(params.get('limit') || String(getConfig().dashboard.paginationLimit), 10), maxLimit);
      const offset = Math.max(parseInt(params.get('offset') || '0', 10), 0);

      if (search.trim()) {
        try {
          const rows = searchHybrid({ project, query: search, limit, alpha: getConfig().search.alpha });
          return json({ total: rows.length, rows, limit, offset, search: true });
        } catch (e) {
          return err('Search error', 400);
        }
      }

      const conditions = [];
      const sqlParams = [];
      if (project) {
        conditions.push('project = ?');
        sqlParams.push(project);
      }
      if (kind && kind !== 'all') {
        conditions.push('kind = ?');
        sqlParams.push(kind);
      }
      conditions.push(trash ? 'deleted_at IS NOT NULL' : 'deleted_at IS NULL');

      const whereClause = 'WHERE ' + conditions.join(' AND ');
      const countSql = `SELECT COUNT(*) as c FROM memories ${whereClause}`;
      const total = db.prepare(countSql).get(...sqlParams).c;
      const dataSql = `SELECT * FROM memories ${whereClause} ORDER BY COALESCE(NULLIF(updated_at, 0), created_at) DESC LIMIT ? OFFSET ?`;
      const rows = db.prepare(dataSql).all(...sqlParams, limit, offset).map(r => ({
        ...r,
        metadata: typeof r.metadata === 'string' ? JSON.parse(r.metadata) : r.metadata,
        related_ids: r.related_ids ? r.related_ids.split(',').map(Number).filter(Boolean) : [],
        status: r.status || ''
      }));

      return json({ total, rows, limit, offset });
    }

    const deleteMatch = path.match(/^\/api\/memories\/(\d+)$/);
    if (deleteMatch && method === 'DELETE') {
      const id = parseInt(deleteMatch[1], 10);
      const project = params.get('project') || '';
      if (!id || !project) return err('Missing id or project', 400);
      const deleted = trashMemory(project, id);
      return json({ deleted });
    }

    const restoreMatch = path.match(/^\/api\/memories\/(\d+)\/restore$/);
    if (restoreMatch && method === 'POST') {
      const id = parseInt(restoreMatch[1], 10);
      const project = params.get('project') || '';
      if (!id || !project) return err('Missing id or project', 400);
      const restored = restoreMemory(project, id);
      return json({ restored });
    }

    if (path === '/api/purge' && method === 'POST') {
      const days = parseInt(params.get('days') || String(getConfig().retention.trashPurgeDays), 10);
      const purged = purgeExpired(days);
      return json({ purged });
    }

    if (path === '/api/backups' && method === 'GET') {
      return json(listBackups());
    }

    if (path === '/api/backups' && method === 'POST') {
      const result = doBackup();
      return json(result);
    }

    if (path === '/api/retention' && method === 'POST') {
      const purged = enforceLiveRetention();
      return json({ purged });
    }

    const purgeMatch = path.match(/^\/api\/memories\/(\d+)\/purge$/);
    if (purgeMatch && method === 'DELETE') {
      const id = parseInt(purgeMatch[1], 10);
      const project = params.get('project') || '';
      const force = params.get('force') === '1';
      if (!id || !project) return err('Missing id or project', 400);
      try {
        const purged = deleteMemoryPermanent(project, id, force);
        return json({ purged });
      } catch (e) {
        return err(e.message, 400);
      }
    }

    if (path === '/api/project/trash' && method === 'POST') {
      const project = params.get('project') || '';
      if (!project) return err('Missing project', 400);
      try {
        const trashed = trashProject(project);
        return json({ trashed });
      } catch (e) {
        return err(e.message, 400);
      }
    }

    if (path === '/api/project/purge' && method === 'DELETE') {
      const project = params.get('project') || '';
      const force = params.get('force') === '1';
      if (!project) return err('Missing project', 400);
      try {
        const purged = deleteProject(project, force);
        return json({ purged: purged.changes });
      } catch (e) {
        return err(e.message, 400);
      }
    }

    if (path === '/api/reassign' && method === 'POST') {
      const fromProject = params.get('from') || '';
      const toProject = params.get('to') || '';
      const idsRaw = params.get('ids') || '';
      if (!fromProject || !toProject) return err('Missing from or to project', 400);
      const ids = idsRaw ? idsRaw.split(',').map(Number).filter(n => n > 0) : undefined;
      const result = reassignMemories(fromProject, toProject, ids);
      return json({ moved: result.changes });
    }

    return null;
  };
}
