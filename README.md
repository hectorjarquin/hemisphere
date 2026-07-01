<img src="logo.svg" height="48" alt="" />

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT) [![Node](https://img.shields.io/badge/node-%3E%3D18-brightgreen)](https://nodejs.org)

# Hemisphere

A self-contained AI memory engine that uses hybrid vector search and MCP to give models long-term recall without cloud dependencies.

Built entirely in Node.js, Hemisphere gives LLMs persistent, session-spanning recall using a localized hybrid FTS + vector search architecture, structured metadata validation, progressive summary synthesis, and a live dashboard — with zero model downloads, zero external API keys, and no Python runtime required.

## Quick Start

```bash
npm install -g hemisphere
```

Once installed, run the dashboard:

```bash
hemisphere
# → http://localhost:3456
```

### CLI commands

```bash
hemisphere              # Start the dashboard
hemisphere stop         # Stop a running instance
hemisphere restart      # Stop then restart
```

### MCP server

Add to `opencode.json`:

```json
{
  "mcp": {
    "hemisphere": {
      "type": "local",
      "command": ["node", "/home/user/.nvm/versions/node/v22.22.0/lib/node_modules/hemisphere/index.js"],
      "enabled": true
    }
  }
}
```

Find your exact path with `npm root -g` — append `/hemisphere/index.js` (e.g. `/usr/lib/node_modules/hemisphere/index.js`).

Now your agent can store and retrieve memories:

```
Store: "the database uses pg-bouncer for pooling"
Search: "what's our connection pooling setup?"
```

### Dashboard

Browse, search and manage memories visually at `http://localhost:3456`.

Port configurable via `~/.hemisphere/config.json` or `HEMISPHERE_PORT`.

**Features:** dark/light theme toggle with SVG icon, WCAG 2.1 AA accessibility (keyboard navigation, ARIA labels, focus-visible outlines), real-time SSE updates (no polling), toast notifications, skeleton loading, search with debounce and prefix matching, project and kind filters, View dropdown (Active / Deleted), expandable detail rows, delete with native `<dialog>` confirmation, restore and permanent purge of soft-deleted memories, on-demand backups.

## Installation

### Prerequisites

- Node.js 18+
- C++ build tools (`build-essential` on Debian/Ubuntu, Xcode CLI tools on macOS) — required to compile `better-sqlite3`

### From npm (recommended)

```bash
npm install -g hemisphere
```

The `hemisphere` CLI is now available globally. The MCP server runs via your AI client — see [Configuration](#configuration-1).

### From git

```bash
git clone https://github.com/hectorjarquin/hemisphere.git ~/hemisphere
cd ~/hemisphere
npm install
npm link  # creates global `hemisphere` command
```

### Configuration

```json
{
  "mcp": {
    "hemisphere": {
      "type": "local",
      "command": ["node", "/usr/lib/node_modules/hemisphere/index.js"],
      "enabled": true
    }
  }
}
```

Find your exact path with `npm root -g` — append `/hemisphere/index.js`. For nvm users the path is typically `~/.nvm/versions/node/vX/lib/node_modules/hemisphere/index.js`.

Memories are scoped by **project** — searching under `my-plugin` won't return memories from `my-theme`.

## Memory Best Practices

Add these instructions to your `CLAUDE.md`, `AGENTS.md`, or `.opencode/`
instruction file.

Scope all memories to a project. Use the repo name as the project name.

At session start, call `memory_brief` to get a lightweight overview of
all projects — summary staleness, pending counts, open bug counts, and
activity levels. No content is loaded. Load specifics only when a
project is selected for work.

Store facts, decisions, and bugs with `memory_store` at the moment they
happen. Capture rationale, tradeoffs, and root causes.

Run `memory_search` before touching unfamiliar or stalled code.

Keep statuses updated. Trash only items with no remaining value. Archive
completed work — don't delete decisions or rationale.

After fixing a bug, store the root cause, fix, and affected files.
Before implementing a feature, search for related past decisions.

When you discover a reusable pattern, store it. Don't duplicate what
existing skills or documentation already cover.

## Updating

### npm

```bash
npm install -g hemisphere@latest
```

Then restart your MCP client (or OpenCode) to pick up the new tools, and run `hemisphere restart` to refresh the dashboard.

Database migrations run automatically on first launch — no manual steps required.

### From git

```bash
cd ~/hemisphere
git pull
npm install
npm link
hemisphere restart
```

## MCP Tools (Agent-Facing)

### `memory_store`

Store a memory observation with hybrid FTS+vector indexing.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `project` | string | yes | — | Project namespace |
| `content` | string | yes | — | Memory text |
| `kind` | string | no | `note` | Category label. Default: `fact`, `decision`, `bug`, `note`, `plan`. Custom schemas extend via config. |
| `status` | string | no | — | Lifecycle status. Validated against kind+project schema. Invalid values rejected. |
| `related_ids` | number[] | no | — | IDs of related memories for relationship tracking |
| `metadata` | object | no | `{}` | Kind-based schema — see [Metadata](#metadata) below |

### `memory_search`

Hybrid FTS + vector search with weighted scoring.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `project` | string | no | — | Project to search within. Omit for cross-project search. |
| `query` | string | yes | — | Search text |
| `limit` | number | no | `10` | Max results |
| `alpha` | number | no | `0.3` | Vector weight. `0` = FTS-only, `1` = vector-only |
| `archived` | boolean | no | `false` | If true, search archived memories instead of active ones |

Returns memories sorted by relevance (score 0–1).

### `memory_context`

Same as `memory_search` but returns plain text formatted for prompt injection.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `project` | string | no | — | Project to search within. Omit for cross-project search. |
| `query` | string | yes | — | Search text |
| `limit` | number | no | `10` | Max results |
| `archived` | boolean | no | `false` | If true, search archived memories instead of active ones |

Output:
```
[1] (fact) The application uses Node.js with Express framework
[2] (decision) Use pg-bouncer for connection pooling
```

### `memory_list`

List recent memories, optionally filtered by kind.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `project` | string | yes | — | Project namespace |
| `kind` | string | no | — | Optional kind filter |
| `trash` | boolean | no | `false` | If true, list soft-deleted memories |
| `archived` | boolean | no | `false` | If true, list archived memories |
| `limit` | number | no | `20` | Max results |

### `memory_trash`

Soft-delete a memory by ID (scoped to project). Sets `deleted_at`; recoverable via `memory_restore`.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `project` | string | yes | — | Project namespace |
| `id` | number | yes | — | Memory ID to soft-delete |

### `memory_delete` (deprecated)

**DEPRECATED:** Use `memory_trash` instead. Will be removed in v3.0.0.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `project` | string | yes | — | Project namespace |
| `id` | number | yes | — | Memory ID to delete |

### `memory_update`

Update an existing memory by ID (scoped to project). Pass only the fields to change. Content updates automatically re-index FTS + vector.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `id` | number | yes | — | Memory ID to update |
| `project` | string | yes | — | Project namespace for scoping |
| `kind` | string | no | — | New category label |
| `content` | string | no | — | New content text |
| `related_ids` | number[] | no | — | New set of related memory IDs |
| `status` | string | no | — | New lifecycle status |
| `metadata` | object | no | — | Fields to merge (existing metadata merged, re-normalized to kind schema, `updated_at` auto-bumped) |

Returns `{ updated: true/false }`.

### `memory_purge`

Permanently delete a memory by ID. By default requires the memory to be in trash first.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `project` | string | yes | — | Project namespace |
| `id` | number | yes | — | Memory ID to permanently delete |
| `force` | boolean | no | `false` | Bypass trash requirement |

### `memory_restore`

Restore a soft-deleted memory from trash.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `project` | string | yes | — | Project namespace |
| `id` | number | yes | — | Memory ID to restore |

### `memory_archive`

Archive a memory by ID. Sets `archived_at`; archived memories are excluded from default list/search/context. Restorable via `memory_unarchive`.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `project` | string | yes | — | Project namespace |
| `id` | number | yes | — | Memory ID to archive |

### `memory_unarchive`

Restore an archived memory back to active.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `project` | string | yes | — | Project namespace |
| `id` | number | yes | — | Memory ID to unarchive |

### `memory_reassign`

Move memories from one project to another.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `from_project` | string | yes | — | Source project namespace |
| `to_project` | string | yes | — | Destination project namespace |
| `ids` | number[] | no | — | Specific IDs to move. Omit to move all. |

### `project_list`

List all project namespaces with stored memories. No parameters.

### `project_count`

Count non-trashed memories in a project, grouped by kind.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `project` | string | yes | — | Project namespace |

Returns `{ total: N, kind1: N1, kind2: N2, ... }`.

### `project_trash`

Soft-delete all non-trashed memories in a project (recoverable). Refuses if the project already has no non-trashed memories.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `project` | string | yes | — | Project namespace to trash |

### `project_purge`

Permanently delete a project and all its memories.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `project` | string | yes | — | Project namespace to purge |
| `force` | boolean | no | `false` | Bypass trash requirement |

### `memory_progressive_summary`

Returns structured memory data for progressive summarization. Uses a dual threshold trigger: returns fresh data when **context pressure ≤ 20%** OR **≥ 10 turns** have passed since the last summary. Returns the last summary when still current. The agent must synthesize a concise summary (200-500 words, organized as State / Recent Decisions / Pending / Next) from the structured data, inject the synthesized summary into its prompt, and persist it via `memory_store` with `kind: "progressive_summary"`.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `project` | string | yes | — | Project namespace |
| `turns_since_last` | number | no | `0` | Conversation turns since last summary (agent tracks) |
| `context_remaining_pct` | number | no | `100` | Percentage of context window free (agent tracks, e.g. `40` = 40% free) |

Returns either:
- **Fresh data** — `{ needs_store: true, memories: [{id, kind, status, title}], synthesis_template: "...", trigger: "turn_interval"|"context_pressure" }` → agent synthesizes a summary from the structured data and stores it
- **Current summary** — `{ up_to_date: true, content: "...", summary_id: N }` → use the existing summary

### `memory_brief`

Get a structured session-start brief across all projects. Returns last
progressive summary (with staleness flag), pending counts, open bug counts,
and activity counts. No content loaded — one call to resume from the last
known state.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `project` | string | no | — | Optional. Single project. Omit for all projects. |
| `decisions_per_project` | number | no | `3` | (Reserved, future use) |

Returns an array of projects, each with:
```json
{
  "project": "compend",
  "last_summary": { "id": 347, "stale": false },
  "pending": 0,
  "open_bugs": 1,
  "activity_count": 21
}
```

## HTTP API (Dashboard-Facing)

The dashboard exposes REST endpoints:

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/projects` | List distinct project namespaces |
| `GET` | `/api/stats` | Get counts grouped by kind and project |
| `GET` | `/api/memories?project=&kind=&limit=&offset=&trash=` | Paginated memory list. `trash=1` shows soft-deleted. `search=` triggers FTS+vector. |
| `POST` | `/api/notify` | SSE event relay from MCP server (internal — called by `notifyDash()`) |
| `DELETE` | `/api/memories/:id?project=` | Soft-delete a memory (sets `deleted_at`) |
| `POST` | `/api/memories/:id/restore?project=` | Restore a soft-deleted memory (clears `deleted_at`) |
| `DELETE` | `/api/memories/:id/purge?project=&force=` | Permanently delete a memory |
| `POST` | `/api/memories/:id/archive?project=` | Archive a memory |
| `POST` | `/api/memories/:id/unarchive?project=` | Unarchive a memory |
| `POST` | `/api/project/trash?project=` | Trash all memories in a project |
| `DELETE` | `/api/project/purge?project=&force=` | Permanently delete a project |
| `POST` | `/api/reassign?from=&to=&ids=` | Move memories between projects |
| `POST` | `/api/purge?days=` | Permanently delete memories soft-deleted longer than `days` ago (default from config or `30`) |
| `GET` | `/api/backups` | List backup `.db` files |
| `POST` | `/api/backups` | Trigger an on-demand backup |
| `GET` | `/api/events` | SSE (Server-Sent Events) stream for real-time dashboard updates |

## Metadata

Metadata is auto-populated with `created_at` and `updated_at` Unix timestamps on every store and update. Each kind has a schema with defaults filled automatically:

| Kind | Required fields | Defaults |
|------|----------------|----------|
| `fact` | — | — |
| `decision` | `status` | `files: []`, `rationale: ""` |
| `bug` | `status` | `severity: "minor"`, `files: []` |
| `plan` | `status` | `files: []`, `steps: []` |
| `note` | — | `tags: []`, `cwd: ""` |
| `progressive_summary` | — | — |

**Status values:**
- `decision`: `proposed` → `approved` → `rejected` → `implemented` → `superseded`
- `bug`: `open` → `in_progress` → `fixed` → `wont_fix` → `cant_repro`
- `plan`: `pending` → `in_progress` → `completed` → `cancelled`

Invalid status values are **rejected** with an error listing valid options, giving LLM agents immediate corrective feedback. Extraneous keys are preserved.

Custom schemas can define project-specific kinds and statuses — see [Custom Schemas](#custom-schemas) below.

## Configuration

### Config File (`~/.hemisphere/config.json`)

Create an optional JSON config file to customize operational settings. All keys are optional — missing keys use the code defaults.

**Priority chain** (highest wins): code defaults < config file < environment variables.

```json
{
  "port": 3456,
  "dbPath": "~/.hemisphere/memories.db",
  "backup": {
    "dir": "./backups",
    "intervalWrites": 50,
    "retentionCount": 10
  },
  "retention": {
    "days": {
      "note": 30,
      "plan": 180,
      "decision": 0,
      "fact": 0,
      "bug": 180,
      "progressive_summary": 90
    },
    "trashPurgeDays": 30
  },
  "search": {
    "limit": 10,
    "alpha": 0.3
  },
  "list": {
    "limit": 20
  },
  "summary": {
    "turnThreshold": 10,
    "contextThreshold": 20,
    "recentLimit": 50
  },
  "dashboard": {
    "paginationLimit": 50,
    "maxLimit": 200
  },
  "schemas": {
    "default": {
      "kinds": {}
    }
  }
}
```
> See [Custom Schemas](#custom-schemas) for per-project kind and status vocabularies.

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `port` | number | `3456` | Dashboard HTTP server port |
| `dbPath` | string | `~/.hemisphere/memories.db` | SQLite database file path (supports `~`) |
| `backup.dir` | string | `./backups` | Directory for automatic backup `.db` files |
| `backup.intervalWrites` | number | `50` | Write operations before auto-backup triggers |
| `backup.retentionCount` | number | `10` | Maximum backup files kept on disk |
| `retention.days.*` | number | varies by kind | Days before automatic expiry. `0` = forever. |
| `retention.trashPurgeDays` | number | `30` | Days before soft-deleted memories are permanently purged |
| `search.limit` | number | `10` | Default search result count |
| `search.alpha` | number | `0.3` | Vector weight in hybrid search (0–1) |
| `list.limit` | number | `20` | Default list result count |
| `summary.turnThreshold` | number | `10` | Turns since last summary before new one triggered |
| `summary.contextThreshold` | number | `20` | Context free % at or below which summary triggered |
| `summary.recentLimit` | number | `50` | Max memories retrieved for summary context |
| `dashboard.paginationLimit` | number | `50` | Default page size for dashboard API |
| `dashboard.maxLimit` | number | `200` | Hard cap on API page size |

### Environment Variables

Environment variables **override** the config file and code defaults at the highest priority. Set any of these to skip the config file entirely:

| Variable | Equivalent Config Key | Default |
|----------|----------------------|---------|
| `HEMISPHERE_PORT` | `port` | `3456` |
| `HEMISPHERE_DB_PATH` | `dbPath` | `~/.hemisphere/memories.db` |
| `BACKUP_DIR` | `backup.dir` | `./backups` |
| `BACKUP_INTERVAL_WRITES` | `backup.intervalWrites` | `50` |
| `BACKUP_RETENTION_COUNT` | `backup.retentionCount` | `10` |
| `RETENTION_POLICY` | `retention.days` | `{"note":30,...}` |

`RETENTION_POLICY` accepts a JSON object like `{"note": 15, "bug": 365}`. Values can be `"forever"`, `0`, or `"0"` for indefinite retention. Missing kinds inherit from defaults.

### Custom Schemas

Define project-specific kind and status vocabularies in `~/.hemisphere/config.json`. The built-in default schema (`fact`, `decision`, `bug`, `plan`, `note`) is always available. Per-project schemas override and extend it.

```json
{
  "schemas": {
    "project-management": {
      "kinds": {
        "meeting":   { "statuses": ["scheduled","in_progress","completed","cancelled"] },
        "email":     { "statuses": ["draft","sent","replied","forwarded"] },
        "milestone": { "statuses": ["planned","active","blocked","delivered"] }
      }
    }
  }
}
```

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `schemas.default.kinds` | object | built-in set | Kind definitions with `statuses`, `defaults`, and `required` fields |
| `schemas.[project].kinds` | object | — | Per-project kind overrides. Falls back to `schemas.default` if not set. |

Each kind entry supports:
- `statuses`: `string[]` — valid status values. Empty array = no status validation.
- `defaults`: `object` — fields auto-populated on store/update
- `required`: `string[]` — fields that receive defaults if missing

Unknown kinds (not declared in any schema) pass through without validation — existing data is never affected.

## Architecture

### Embedding

MurmurHash3 (32-bit x86) applied to word unigrams and bigrams, accumulated into a 256-bin `Float32Array`, then L2-normalized. Runs in ~2µs per text with no external dependencies. Collisions are inherent to feature hashing and don't materially affect retrieval quality at this dimension count.

### Hybrid Search

Three indexing layers work together:

1. **FTS5** — SQLite full-text search with BM25 ranking (`unicode61` tokenizer)
2. **Vector** — `sqlite-vec` virtual table with 256-dim float vectors, cosine distance
3. **Merge** — Weighted combination: `score = alpha * vec + (1 - alpha) * fts`. Both sides are normalized to 0–1 before merging.

### Database

- WAL journal mode for concurrent reads, `busy_timeout=5000ms` for write-contention safety across processes
- `memories` table (project, kind, content, metadata, related_ids, status, created_at, updated_at, deleted_at, archived_at)
- `memories_fts` — FTS5 external content table
- `memories_vec` — `vec0` table with `float[256]`

### Memory Lifecycle

Memories move through four tiers:

| Tier | Column | Filter | Tools |
|------|--------|--------|-------|
| **Active** | `deleted_at IS NULL AND archived_at IS NULL` | Default | `memory_store`, `memory_search`, `memory_list`, `memory_update` |
| **Archived** | `archived_at IS NOT NULL AND deleted_at IS NULL` | `archived=true` | `memory_archive`, `memory_unarchive`, search/list/context with `archived=true` |
| **Trashed** | `deleted_at IS NOT NULL` | `trash=true` | `memory_trash`, `memory_restore`, list with `trash=true` |
| **Purged** | Row deleted | — | `memory_purge` |

Protection layers:

1. **Archive** (`archived_at`) — `memory_archive` preserves memories with historical value outside the active set. Not subject to retention auto-purge. Restorable to active via `memory_unarchive`.
2. **Soft-Delete** (`deleted_at`) — `memory_trash` sets a timestamp instead of removing the row. Memories are hidden from normal queries but recoverable via restore.
3. **Write-Count Snapshots** — Every N writes (configurable via `backup.intervalWrites`), `VACUUM INTO` creates a timestamped `.db` backup.
4. **Per-Kind Retention** — `enforceLiveRetention()` purges active memories older than their kind's configured days. At least one `progressive_summary` is always preserved.

Soft-deleted memories are permanently purged after `retention.trashPurgeDays` days (default 30) via `/api/purge` or the dashboard's hourly auto-purge. Archived memories are not subject to retention auto-purge.

### SSE Real-Time Updates

The dashboard uses Server-Sent Events for live updates — no polling. Events flow through a three-hop chain:

MCP server (index.js) → `notifyDash()` → dashboard `/api/notify` → `broadcast()` → SSE clients → `app.js` listeners

| Event | Source | Frontend Behavior |
|---|---|---|
| `memory_new` | `memory_store` | Toast + reload list |
| `memory_update` | `memory_update` | Reload if row visible |
| `memory_trash` | `memory_trash` | Animate row removal |
| `memory_purge` | `memory_purge` | Animate row removal |
| `memory_restore` | `memory_restore` | Remove from trash / reload active |
| `memory_archive` | `memory_archive` | Remove from active / reload archived |
| `memory_unarchive` | `memory_unarchive` | Remove from archived / reload active |
| `memory_reassign` | `memory_reassign` | Reload list + projects if affected |
| `project_new` | `memory_store`, `memory_reassign` | Refresh project dropdown |
| `project_deleted` | `project_purge`, `memory_purge`, `memory_reassign` | Clear current project + refresh dropdown |
| `project_trash` | `project_trash` | Reload list if affected |
| `project_purge` | `project_purge` | Clear current project + refresh dropdown |

If the SSE connection drops, a 30-second fallback poll resumes.

## Project Structure

```
hemisphere/
├── index.js                MCP stdio server (9 tool handlers)
├── dashboard.js            HTTP dashboard + SSE broadcast server
├── dashboard/
│   ├── api-handler.js      Dashboard REST API routes
│   └── public/
│       ├── index.html      Dashboard HTML + ARIA structure
│       ├── style.css       Full theme (dark/light), toast, dialog, skeleton
│       └── app.js          Frontend SSE client, keyboard nav, WCAG 2.1 AA
├── db.js                   SQLite init, CRUD, hybrid FTS+vec search, lifecycle
├── embedding.js            MurmurHash3 → 256-dim float vector
├── config.js               Config loader (defaults ← config.json ← env vars)
├── package.json
└── README.md
```

## Development

### Scripts

For local development (after `git clone`):

```bash
npm start           # Start dashboard server (same as `hemisphere`)
npm run stop        # Stop running instance (same as `hemisphere stop`)
npm run restart     # Stop then start
```

For installed users, the global `hemisphere` CLI handles these — see [Quick Start](#quick-start).

### Testing the MCP server

Test with the MCP Inspector:

```bash
npx @modelcontextprotocol/inspector node index.js
```

## Roadmap

- **Auth / access control** — API keys for multi-client deployments
- **PostgreSQL backend** — configurable backend for serverless and production
- **Connection pooling** — WAL-mode write queue for concurrent agent access
- **Rate limiting / resource governance** — per-project limits and content caps
- **Multi-agent collaboration** — shared memory spaces with access controls
- **Import / export** — portable memory archives across Hemisphere instances

## Contributing

Open an issue or PR at [github.com/hectorjarquin/hemisphere](https://github.com/hectorjarquin/hemisphere).

## License
MIT License — see [LICENSE](LICENSE) for details.
