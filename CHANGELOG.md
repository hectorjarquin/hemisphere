# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
