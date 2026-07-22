#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

import { initDb, storeMemory, searchHybrid, listMemories, trashMemory, updateMemory, restoreMemory, archiveMemory, unarchiveMemory, listProjects, countProject, trashProject, deleteProject, deleteMemoryPermanent, reassignMemories, getBrief } from './db.js';
import { getConfig } from './config.js';
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const DASH_PORT = getConfig().port;

function notifyDash(event, id, project) {
  const body = JSON.stringify({ event, id, project: project || '' });
  const req = http.request(`http://127.0.0.1:${DASH_PORT}/api/notify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
  });
  req.on('error', () => {});
  req.write(body);
  req.end();

  const subscribers = getConfig().notifySubscribers;
  if (!subscribers.length) return;

  for (const name of subscribers) {
    try {
      const manifestPath = join(homedir(), '.' + name, 'manifest.json');
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
      if (manifest.notifyEndpoint) {
        const ext = http.request(manifest.notifyEndpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
        });
        ext.on('error', () => {});
        ext.write(body);
        ext.end();
      }
    } catch {}
  }
}

const db = initDb();

process.on('SIGTERM', () => { try { db.close(); } catch {} process.exit(0); });
process.on('SIGINT', () => { try { db.close(); } catch {} process.exit(0); });

const server = new Server(
  { name: 'hemisphere', version: '2.1.0' },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'memory_store',
      description: 'Store a memory observation with hybrid FTS+vector indexing',
      inputSchema: {
        type: 'object',
        properties: {
          project: { type: 'string', description: 'Project namespace for the memory' },
          content: { type: 'string', description: 'Memory content text' },
          kind: { type: 'string', description: 'Optional category label. Default schema: fact, decision, bug, plan, note. Custom schemas supported per project via ~/.hemisphere/config.json.' },
          related_ids: { type: 'array', items: { type: 'number' }, description: 'Optional. IDs of related memories' },
          status: { type: 'string', description: 'Optional lifecycle status. Validated against kind+project schema. Invalid values rejected with a list of valid options.' },
          metadata: { type: 'object', description: 'Optional JSON metadata. Auto-populated: created_at, updated_at. Schema-driven defaults and validation per kind+project.', additionalProperties: true }
        },
        required: ['project', 'content']
      }
    },
    {
      name: 'memory_search',
      description: 'Hybrid FTS + vector search across stored memories',
      inputSchema: {
        type: 'object',
        properties: {
          project: { type: 'string', description: 'Project namespace to search within. Omit for cross-project search.' },
          query: { type: 'string', description: 'Search query text' },
          limit: { type: 'number', description: 'Max results (default 10)' },
          alpha: { type: 'number', description: 'Vector weight 0-1, 0=only FTS, 1=only vector (default 0.3)' },
          archived: { type: 'boolean', description: 'If true, search archived memories instead of active ones' },
          trash: { type: 'boolean', description: 'If true, search soft-deleted (trashed) memories' },
          kind: { type: 'string', description: 'Optional. Filter by memory kind (fact, decision, bug, plan, note)' }
        },
        required: ['query']
      }
    },
    {
      name: 'memory_context',
      description: 'Search and return a formatted context string for prompt injection',
      inputSchema: {
        type: 'object',
        properties: {
          project: { type: 'string', description: 'Project namespace to search within. Omit for cross-project search.' },
          query: { type: 'string', description: 'Search query text' },
          limit: { type: 'number', description: 'Max results (default 10)' },
          archived: { type: 'boolean', description: 'If true, return context from archived memories instead of active ones' },
          trash: { type: 'boolean', description: 'If true, return context from soft-deleted (trashed) memories' },
          kind: { type: 'string', description: 'Optional. Filter by memory kind (fact, decision, bug, plan, note)' }
        },
        required: ['query']
      }
    },
    {
      name: 'memory_list',
      description: 'List recent memories for a project, optionally filtered by kind',
      inputSchema: {
        type: 'object',
        properties: {
          project: { type: 'string', description: 'Project namespace' },
          kind: { type: 'string', description: 'Optional kind filter' },
          trash: { type: 'boolean', description: 'If true, list soft-deleted memories instead of active ones' },
          archived: { type: 'boolean', description: 'If true, list archived memories instead of active ones' },
          limit: { type: 'number', description: 'Max results (default 20, max 200)' }
        },
        required: ['project']
      }
    },
    {
      name: 'memory_trash',
      description: 'Soft-delete a memory by ID (scoped to project). Sets deleted_at; recoverable via memory_restore.',
      inputSchema: {
        type: 'object',
        properties: {
          project: { type: 'string', description: 'Project namespace' },
          id: { type: 'number', description: 'Memory ID to soft-delete' }
        },
        required: ['project', 'id']
      }
    },
    {
      name: 'memory_update',
      description: 'Update an existing memory by ID (scoped to project). Pass only the fields to change.',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'number', description: 'Memory ID to update' },
          project: { type: 'string', description: 'Project namespace for scoping' },
          kind: { type: 'string', description: 'Optional new category label. Default schema: fact, decision, bug, plan, note. Custom schemas supported per project.' },
          related_ids: { type: 'array', items: { type: 'number' }, description: 'Optional. IDs of related memories' },
          status: { type: 'string', description: 'Optional new lifecycle status. Validated against kind+project schema. Invalid values rejected with a list of valid options.' },
          content: { type: 'string', description: 'Optional new content text' },
          metadata: { type: 'object', description: 'Optional fields to update. Merged with existing metadata, validated and re-normalized to kind+project schema. updated_at auto-bumped.', additionalProperties: true }
        },
        required: ['id', 'project']
      }
    },
    {
      name: 'memory_purge',
      description: 'Permanently delete a memory by ID. By default requires the memory to be in trash first (use force=true to bypass).',
      inputSchema: {
        type: 'object',
        properties: {
          project: { type: 'string', description: 'Project namespace' },
          id: { type: 'number', description: 'Memory ID to permanently delete' },
          force: { type: 'boolean', description: 'If true, bypass trash requirement and delete immediately' }
        },
        required: ['project', 'id']
      }
    },
    {
      name: 'memory_restore',
      description: 'Restore a soft-deleted memory from trash.',
      inputSchema: {
        type: 'object',
        properties: {
          project: { type: 'string', description: 'Project namespace' },
          id: { type: 'number', description: 'Memory ID to restore' }
        },
        required: ['project', 'id']
      }
    },
    {
      name: 'memory_archive',
      description: 'Archive a memory by ID (scoped to project). Sets archived_at; archived memories are excluded from default list/search/context. Restorable via memory_unarchive.',
      inputSchema: {
        type: 'object',
        properties: {
          project: { type: 'string', description: 'Project namespace' },
          id: { type: 'number', description: 'Memory ID to archive' }
        },
        required: ['project', 'id']
      }
    },
    {
      name: 'memory_unarchive',
      description: 'Restore an archived memory back to active.',
      inputSchema: {
        type: 'object',
        properties: {
          project: { type: 'string', description: 'Project namespace' },
          id: { type: 'number', description: 'Memory ID to unarchive' }
        },
        required: ['project', 'id']
      }
    },
    {
      name: 'memory_reassign',
      description: 'Move memories from one project to another. If ids is provided, only moves those specific memories.',
      inputSchema: {
        type: 'object',
        properties: {
          from_project: { type: 'string', description: 'Source project namespace' },
          to_project: { type: 'string', description: 'Destination project namespace' },
          ids: { type: 'array', items: { type: 'number' }, description: 'Optional. Specific memory IDs to move. If omitted, moves all memories from from_project.' }
        },
        required: ['from_project', 'to_project']
      }
    },
    {
      name: 'project_list',
      description: 'List all project namespaces with stored memories.',
      inputSchema: {
        type: 'object',
        properties: {},
        required: []
      }
    },
    {
      name: 'project_count',
      description: 'Count non-trashed memories in a project, grouped by kind.',
      inputSchema: {
        type: 'object',
        properties: {
          project: { type: 'string', description: 'Project namespace' }
        },
        required: ['project']
      }
    },
    {
      name: 'project_trash',
      description: 'Soft-delete all non-trashed memories in a project (recoverable). Refuses if the project already has no non-trashed memories.',
      inputSchema: {
        type: 'object',
        properties: {
          project: { type: 'string', description: 'Project namespace to trash' }
        },
        required: ['project']
      }
    },
    {
      name: 'project_purge',
      description: 'Permanently delete a project and all its memories. By default requires all memories to be in trash first (use force=true to bypass). Refuses if the project does not exist.',
      inputSchema: {
        type: 'object',
        properties: {
          project: { type: 'string', description: 'Project namespace to purge' },
          force: { type: 'boolean', description: 'If true, bypass trash requirement and permanently delete immediately' }
        },
        required: ['project']
      }
    },
    {
      name: 'memory_progressive_summary',
      description: 'Generate structured memory data for progressive summarization. Returns fresh data when the dual threshold is met (context pressure ≤20% OR ≥10 turns since last summary), or the last summary when still current. The agent must synthesize a concise summary (200-500 words, organized as State / Recent Decisions / Pending / Next) from the structured data, inject the synthesized summary into its prompt, and call memory_store with kind "progressive_summary" to persist it.',
      inputSchema: {
        type: 'object',
        properties: {
          project: { type: 'string', description: 'Project namespace to summarize' },
          turns_since_last: { type: 'number', description: 'Number of conversation turns since last summary (agent tracks)' },
          context_remaining_pct: { type: 'number', description: 'Percentage of context window remaining (agent tracks, e.g. 40 means 40% free)' }
        },
        required: ['project']
      }
    },
    {
      name: 'memory_brief',
      description: 'Get a structured session-start brief across all projects. Returns last progressive summary (with staleness flag), pending counts, open bug counts, and activity counts. One call to resume from the last known state.',
      inputSchema: {
        type: 'object',
        properties: {
          project: { type: 'string', description: 'Optional. Single project. Omit for all projects with activity.' },
          decisions_per_project: { type: 'number', description: 'How many recent decisions/plans per project (default 3)' }
        },
        required: []
      }
    }
  ]
}));

function extractTitle(content, kind) {
  const heading = content.match(/^##\s+(.+?)(?:\n|$)/m);
  if (heading) return heading[1].trim();
  const firstLine = content.split('\n')[0].replace(/^#+\s*/, '').trim();
  if (firstLine) return firstLine;
  return `(${kind})`;
}

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case 'memory_store': {
        const id = storeMemory(args);
        notifyDash('memory_new', id, args.project);
        if (countProject(args.project).total === 1) {
          notifyDash('project_new', null, args.project);
        }
        return {
          content: [{ type: 'text', text: JSON.stringify({ id, success: true }) }]
        };
      }

      case 'memory_search': {
        const { rows: results } = searchHybrid(args);
        return {
          content: [{ type: 'text', text: JSON.stringify(results, null, 2) }]
        };
      }

      case 'memory_context': {
        const { rows: results } = searchHybrid(args);
        if (results.length === 0) {
          return {
            content: [{ type: 'text', text: 'No relevant memories found.' }]
          };
        }
        const ctx = results.map((r, i) =>
          `[${i + 1}] (${r.kind || 'note'}) ${r.content}`
        ).join('\n');
        return {
          content: [{ type: 'text', text: ctx }]
        };
      }

      case 'memory_list': {
        const results = listMemories({ ...args, trash: args.trash || false, archived: args.archived || false });
        return {
          content: [{ type: 'text', text: JSON.stringify(results, null, 2) }]
        };
      }

      case 'memory_trash': {
        const deleted = trashMemory(args.project, args.id);
        if (deleted) notifyDash('memory_trash', args.id, args.project);
        return {
          content: [{ type: 'text', text: JSON.stringify({ deleted }) }]
        };
      }

      case 'memory_update': {
        const updated = updateMemory(args);
        if (updated) notifyDash('memory_update', args.id, args.project);
        return {
          content: [{ type: 'text', text: JSON.stringify({ updated }) }]
        };
      }

      case 'memory_purge': {
        const purged = deleteMemoryPermanent(args.project, args.id, args.force || false);
        if (purged) {
          notifyDash('memory_purge', args.id, args.project);
          if (countProject(args.project).total === 0) {
            notifyDash('project_deleted', null, args.project);
          }
        }
        return {
          content: [{ type: 'text', text: JSON.stringify({ purged }) }]
        };
      }

      case 'memory_restore': {
        const restored = restoreMemory(args.project, args.id);
        if (restored) notifyDash('memory_restore', args.id, args.project);
        return {
          content: [{ type: 'text', text: JSON.stringify({ restored }) }]
        };
      }

      case 'memory_archive': {
        const archived = archiveMemory(args.project, args.id);
        if (archived) notifyDash('memory_archive', args.id, args.project);
        return {
          content: [{ type: 'text', text: JSON.stringify({ archived }) }]
        };
      }

      case 'memory_unarchive': {
        const unarchived = unarchiveMemory(args.project, args.id);
        if (unarchived) notifyDash('memory_unarchive', args.id, args.project);
        return {
          content: [{ type: 'text', text: JSON.stringify({ unarchived }) }]
        };
      }

      case 'memory_reassign': {
        const moved = reassignMemories(args.from_project, args.to_project, args.ids);
        notifyDash('memory_reassign', null, args.to_project);
        const srcCounts = countProject(args.from_project);
        if (srcCounts.total === 0) {
          notifyDash('project_deleted', null, args.from_project);
        }
        const dstCounts = countProject(args.to_project);
        if (dstCounts.total === moved) {
          notifyDash('project_new', null, args.to_project);
        }
        return {
          content: [{ type: 'text', text: JSON.stringify({ moved: moved }) }]
        };
      }

      case 'project_list': {
        const projects = listProjects();
        return {
          content: [{ type: 'text', text: JSON.stringify(projects, null, 2) }]
        };
      }

      case 'project_count': {
        const counts = countProject(args.project);
        return {
          content: [{ type: 'text', text: JSON.stringify(counts, null, 2) }]
        };
      }

      case 'project_trash': {
        const trashed = trashProject(args.project);
        if (trashed > 0) notifyDash('project_trash', null, args.project);
        return {
          content: [{ type: 'text', text: JSON.stringify({ trashed }) }]
        };
      }

      case 'project_purge': {
        const purged = deleteProject(args.project, args.force || false);
        if (purged > 0) {
          notifyDash('project_purge', null, args.project);
          notifyDash('project_deleted', null, args.project);
        }
        return {
          content: [{ type: 'text', text: JSON.stringify({ purged: purged }) }]
        };
      }

      case 'memory_progressive_summary': {
        const { project } = args;
        const turns = args.turns_since_last || 0;
        const ctxPct = args.context_remaining_pct || 100;
        const thresholdTurns = getConfig().summary.turnThreshold;
        const thresholdCtx = getConfig().summary.contextThreshold;

        const lastSummary = listMemories({ project, kind: 'progressive_summary', limit: 1 })[0];
        const since = lastSummary ? lastSummary.created_at : 0;

        const recentMemories = listMemories({ project, limit: getConfig().summary.recentLimit });
        const newMemories = recentMemories.filter(m =>
          m.created_at > since && m.kind !== 'progressive_summary' && m.status !== 'superseded'
        );

        const needsNew = ctxPct <= thresholdCtx || turns >= thresholdTurns;

        if (!needsNew && lastSummary) {
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                up_to_date: true,
                content: lastSummary.content,
                summary_id: lastSummary.id
              })
            }]
          };
        }

        const memoryItems = newMemories.map(m => ({
          id: m.id,
          kind: m.kind,
          status: m.status || '',
          title: extractTitle(m.content, m.kind)
        }));

        const template = `### State
- (describe current project state — what's built, what's operational)

### Recent Decisions
${memoryItems.filter(m => m.status === 'completed' || m.status === 'implemented').map(m => `- ${m.title}`).join('\n') || '(none)'}

### Pending
${memoryItems.filter(m => m.status === 'pending' || m.status === 'in_progress').map(m => `- ${m.title} (#${m.id})`).join('\n') || '(none)'}

### Next
- (suggest the highest-value next step based on pending items)`;

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              needs_store: true,
              memories: memoryItems,
              synthesis_template: template,
              new_memory_count: newMemories.length,
              new_memory_ids: newMemories.map(m => m.id),
              last_summary_id: lastSummary ? lastSummary.id : null,
              trigger: ctxPct <= thresholdCtx ? 'context_pressure' : 'turn_interval'
            })
          }]
        };
      }

      case 'memory_brief': {
        const results = getBrief(args);
        return {
          content: [{ type: 'text', text: JSON.stringify(results, null, 2) }]
        };
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (err) {
    const msg = err.message && err.message.includes('/') ? 'Internal error' : err.message;
    return {
      content: [{ type: 'text', text: `Error: ${msg}` }],
      isError: true
    };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
