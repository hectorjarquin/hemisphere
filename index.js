#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

import { initDb, storeMemory, searchHybrid, listMemories, deleteMemory, updateMemory } from './db.js';
import { getConfig } from './config.js';
import http from 'node:http';

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
}

const db = initDb();

process.on('SIGTERM', () => { try { db.close(); } catch {} process.exit(0); });
process.on('SIGINT', () => { try { db.close(); } catch {} process.exit(0); });

const server = new Server(
  { name: 'hemisphere', version: '1.0.0' },
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
          kind: { type: 'string', description: 'Optional category label (e.g. fact, decision, bug)' },
          related_ids: { type: 'array', items: { type: 'number' }, description: 'Optional. IDs of related memories' },
          status: { type: 'string', description: 'Optional lifecycle status (e.g. pending, approved, completed, draft)' },
          metadata: { type: 'object', description: 'Optional JSON metadata. Auto-populated: created_at, updated_at. Kind schemas — fact: {}, decision: {status: proposed|approved|rejected|implemented|superseded, files?:[], rationale?:""}, bug: {status: open|in_progress|fixed|wont_fix|cant_repro, severity?:"minor"|"major"|"critical", files?:[]}, plan: {status: pending|in_progress|completed|cancelled, files?:[], steps?:[]}, note: {tags?:[], cwd?:""}', additionalProperties: true }
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
          project: { type: 'string', description: 'Project namespace to search within' },
          query: { type: 'string', description: 'Search query text' },
          limit: { type: 'number', description: 'Max results (default 10)' },
          alpha: { type: 'number', description: 'Vector weight 0-1, 0=only FTS, 1=only vector (default 0.3)' }
        },
        required: ['project', 'query']
      }
    },
    {
      name: 'memory_context',
      description: 'Search and return a formatted context string for prompt injection',
      inputSchema: {
        type: 'object',
        properties: {
          project: { type: 'string', description: 'Project namespace to search within' },
          query: { type: 'string', description: 'Search query text' },
          limit: { type: 'number', description: 'Max results (default 10)' }
        },
        required: ['project', 'query']
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
          limit: { type: 'number', description: 'Max results (default 20)' }
        },
        required: ['project']
      }
    },
    {
      name: 'memory_delete',
      description: 'Delete a memory by ID (scoped to project)',
      inputSchema: {
        type: 'object',
        properties: {
          project: { type: 'string', description: 'Project namespace' },
          id: { type: 'number', description: 'Memory ID to delete' }
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
          kind: { type: 'string', description: 'Optional new category label' },
          related_ids: { type: 'array', items: { type: 'number' }, description: 'Optional. IDs of related memories' },
          status: { type: 'string', description: 'Optional new lifecycle status' },
          content: { type: 'string', description: 'Optional new content text' },
          metadata: { type: 'object', description: 'Optional fields to update. Merged with existing metadata, re-normalized to kind schema. updated_at auto-bumped.', additionalProperties: true }
        },
        required: ['id', 'project']
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
        return {
          content: [{ type: 'text', text: JSON.stringify({ id, success: true }) }]
        };
      }

      case 'memory_search': {
        const results = searchHybrid(args);
        return {
          content: [{ type: 'text', text: JSON.stringify(results, null, 2) }]
        };
      }

      case 'memory_context': {
        const results = searchHybrid(args);
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
        const results = listMemories(args);
        return {
          content: [{ type: 'text', text: JSON.stringify(results, null, 2) }]
        };
      }

      case 'memory_delete': {
        const deleted = deleteMemory(args.project, args.id);
        if (deleted) notifyDash('memory_delete', args.id, args.project);
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
