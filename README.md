<img src="logo.svg" height="48" alt="" />

# hemisphere

[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](https://www.gnu.org/licenses/gpl-3.0) [![Node](https://img.shields.io/badge/node-%3E%3D18-brightgreen)](https://nodejs.org)

**Author:** [Hector Jarquin](https://hectorjarquin.com)

A persistent, searchable memory store for AI agents. Gives LLMs long-term recall across sessions using hybrid FTS + vector search, structured metadata, full CRUD, progressive summaries, and a live dashboard — no model downloads, no API keys, no Python.

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

## MCP Tools (Agent-Facing)

### `memory_store`

Store a memory observation with hybrid FTS+vector indexing.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `project` | string | yes | — | Project namespace |
| `content` | string | yes | — | Memory text |
| `kind` | string | no | `note` | Category label (`fact`, `decision`, `bug`, `note`, `plan`) |
| `status` | string | no | — | Lifecycle status (e.g. `pending`, `completed`, `approved`) |
| `related_ids` | number[] | no | — | IDs of related memories for relationship tracking |
| `metadata` | object | no | `{}` | Kind-based schema — see [Metadata](#metadata) below |

### `memory_search`

Hybrid FTS + vector search with weighted scoring.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `project` | string | yes | — | Project to search within |
| `query` | string | yes | — | Search text |
| `limit` | number | no | `10` | Max results |
| `alpha` | number | no | `0.3` | Vector weight. `0` = FTS-only, `1` = vector-only |

Returns memories sorted by relevance (score 0–1).

### `memory_context`

Same as `memory_search` but returns plain text formatted for prompt injection.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `project` | string | yes | — | Project to search within |
| `query` | string | yes | — | Search text |
| `limit` | number | no | `10` | Max results |

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
| `limit` | number | no | `20` | Max results |

### `memory_delete`

Delete a memory by ID (scoped to project).

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

## HTTP API (Dashboard-Facing)

The dashboard exposes REST endpoints:

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/projects` | List distinct project namespaces |
| `GET` | `/api/stats` | Get counts grouped by kind and project |
| `GET` | `/api/memories?project=&kind=&limit=&offset=&trash=` | Paginated memory list. `trash=1` shows soft-deleted. `search=` triggers FTS+vector. |
| `POST` | `/api/notify` | SSE event relay from MCP server (internal — called by `notifyDash()`) |
| `DELETE` | `/api/memories?project=&id=` | Soft-delete a memory (sets `deleted_at`) |
| `POST` | `/api/restore?project=&id=` | Restore a soft-deleted memory (clears `deleted_at`) |
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

Invalid status values reset to the kind default. Extraneous keys are preserved.

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
  }
}
```

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
- `memories` table (project, kind, content, metadata, related_ids, status, created_at, updated_at)
- `memories_fts` — FTS5 external content table
- `memories_vec` — `vec0` table with `float[256]`

### Memory Lifecycle

Memories flow through three protection layers before permanent removal:

1. **Soft-Delete** (`deleted_at`) — `memory_delete` sets a timestamp instead of removing the row. Memories are hidden from normal queries but recoverable via restore.
2. **Write-Count Snapshots** — Every N writes (configurable via `backup.intervalWrites`), `VACUUM INTO` creates a timestamped `.db` backup. Oldest backups are rotated when exceeding `backup.retentionCount`.
3. **Per-Kind Retention** — `enforceLiveRetention()` runs on dashboard startup and on-demand, purging active memories older than their kind's configured days. At least one `progressive_summary` is always preserved to maintain the dual-trigger threshold.

Soft-deleted memories are permanently purged after `retention.trashPurgeDays` days (default 30) via `/api/purge` or the dashboard's hourly auto-purge.

### SSE Real-Time Updates

The dashboard uses native Server-Sent Events for live updates — no polling. The MCP server calls `notifyDash()` after every `memory_store`, `memory_update`, and `memory_delete`, which POSTs to the dashboard's `/api/notify` endpoint. The dashboard broadcasts the event to all connected SSE clients via `/api/events`. If the SSE connection drops, a 30-second fallback poll resumes until the connection is re-established.

## Project Structure

```
hemisphere/
├── index.js                MCP stdio server (7 tool handlers)
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
- **Import / export** — portable memory archives across hemisphere instances

## Contributing

Open an issue or PR at [github.com/hectorjarquin/hemisphere](https://github.com/hectorjarquin/hemisphere).

## License

GNU General Public License v3.0 or later — see [LICENSE](LICENSE) for details.
