# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.0.2] - 2026-07-06

### Added
- `kind` filter parameter on `memory_search` and `memory_context`. Combine
  content search with kind filtering in a single call (e.g., find bugs
  about authentication).

### Removed
- `memory_delete` deprecated tool. Use `memory_trash` instead. The two
  tools routed to the same `deleteMemory()` function — removing the alias
  eliminates tool-list clutter.

### Fixed
- Stale server version string in `index.js` (was `2.0.0`, now `2.0.2`).

## [2.0.1] - 2026-06-30

### Fixed
- Memory Best Practices instructions now wrapped in a fenced code block
  for copy-paste convenience.

## [2.0.0] - 2026-06-30

### Changed
- Relicensed from GPL-3.0-only to MIT. Prior versions remain GPL-3.0-only.

### Added
- `LICENSE` file included in repository and npm package for the first time.
- Restored logo SVG in README header (removed in v1.3.2).

## [1.4.0] - 2026-06-29

### Added
- `memory_brief` tool — session-start resumption in one call. Returns a
  lightweight metadata-only overview of all projects: last progressive summary
  (with staleness flag comparing summary updated_at against non-summary memory
  timestamps), pending counts, open bug counts, and activity counts. No content
  bodies or snippets loaded — load specifics only when a project is selected
  for work. Optional `project` parameter for single-project briefs.

## [1.3.2] - 2026-06-28

### Changed
- Updated README description to emphasize self-contained AI memory engine with zero cloud dependencies and Node.js-only architecture

## [1.3.1] - 2026-06-26

### Fixed
- Excluded `test/` directory from npm package via `.npmignore` and `.gitignore`

## [1.3.0] - 2026-06-26

### Added
- Configurable kind/status schemas via `schemas` key in DEFAULTS and `~/.hemisphere/config.json`
- Per-project schema overrides: `schemas.[project].kinds` allows domain-specific vocabularies (PM, editorial, design, etc.)
- Schema validation on `memory_store` and `memory_update`: invalid status values for a known kind are rejected with an error listing valid options, giving LLM agents immediate corrective feedback

### Changed
- Kind/status schemas moved from hardcoded `db.js` constants to `config.js` DEFAULTS for user configurability
- `memory_store` and `memory_update`: `status` argument is now merged into `metadata` before validation — the DB `status` column and `metadata.status` field are a single source of truth
- `normalizeMetadata` signature changed: requires `project` parameter for schema resolution
- Tool descriptions for `memory_store` and `memory_update` updated to reference project-level schemas

### Fixed
- `deepMerge` now correctly clones new top-level keys from user config instead of silently dropping them
- Status column / metadata.status divergence eliminated: both `storeMemory` and `updateMemory` route through unified validation

### Removed
- `KIND_SCHEMAS` and `STATUS_VALUES` constants from `db.js` (ported to `config.js` DEFAULTS)
- Silent status coercion on invalid values (replaced with explicit validation rejection)

## [1.2.1] - 2026-06-20

### Added
- Kebab menu (⋮) with context-aware actions per view tier: Archive/Trash (Active), Unarchive/Trash (Archived), Restore/Archive (Trash)
- SSE broadcasts for archive, unarchive, memory reassign, project trash, and project purge operations
- Frontend SSE listeners for `memory_purge`, `memory_reassign`, `project_trash`, and `project_purge` events
- Project lifecycle SSE events: `project_new` fires when a project gains its first memory; `project_deleted` fires when the last memory is removed
- `archived` parameter on dashboard stats and search queries
- README: Updating section for npm and git workflows, SSE event table, expanded HTTP API table

### Changed
- Dashboard stats no longer count archived memories in the Active total
- `memory_archive` SSE listener now reloads the list when viewing the Archived tier (was previously ignored)

### Fixed
- `reassignMemories()` / `deleteProject()` return-value bug: callers in `index.js` and `api-handler.js` redundantly accessed `.changes` on already-unwrapped values, breaking `project_new` SSE on reassign and producing empty JSON responses (`{}`)

## [1.2.0] - 2026-06-19

### Added
- Archive tier: `memory_archive` and `memory_unarchive` tools for preserving memories with historical value outside the active/trash lifecycle
- `archived` parameter on `memory_list`, `memory_search`, `memory_context` — tier-aware filtering (mirrors `trash` toggle)
- `archived_at` database column with automatic migration for v1.1.0 users
- Dashboard: Archived tab in the view filter, archive/unarchive action buttons, SSE event handlers

### Changed
- `memory_list` active view now excludes archived memories (`deleted_at IS NULL AND archived_at IS NULL`)
- `memory_search` and `memory_context` default to active-only; pass `archived=true` for archived tier

## [1.1.0] - 2026-06-15

### Added
- `memory_trash` — soft-delete a memory (recoverable, canonical name)
- `memory_purge` — permanently hard-delete a memory (requires trash first, `force` to bypass)
- `memory_restore` — restore a soft-deleted memory from trash
- `memory_reassign` — move memories between project namespaces
- `project_list` — list all project namespaces
- `project_count` — count non-trashed memories by kind per project
- `project_trash` — soft-delete all memories in a project (refuses if already empty)
- `project_purge` — permanently delete a project (requires trash first, `force` to bypass; refuses if project doesn't exist)
- `memory_list` — added optional `trash` parameter to list soft-deleted memories
- `memory_search` — `project` parameter is now optional, enabling cross-project search

### Changed
- DB function `deleteMemory()` renamed to `trashMemory()`; `deleteMemory()` kept as deprecated wrapper
- Renamed human-facing references from "hemisphere" to "Hemisphere" (dashboard title, readme, console messages)

### Deprecated
- `memory_delete` — use `memory_trash` instead.
- `deleteMemory()` (DB function) — use `trashMemory()` instead.
