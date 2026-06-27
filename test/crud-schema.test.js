import { spawn } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const INDEX = join(__dirname, '..', 'index.js');
const PROJECT = 'crud-test';

let idCounter = 0;
let pendingResolve = null;
let child = null;
let buffer = '';
let testCount = 0;
let passCount = 0;
let failCount = 0;
let storeResults = {}; // label → id for use in subsequent tests

function rpc(method, args) {
  return new Promise((resolve, reject) => {
    pendingResolve = resolve;
    const id = ++idCounter;
    const req = JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/call', params: { name: method, arguments: args } });
    child.stdin.write(req + '\n');
  });
}

function waitForReady() {
  return new Promise((resolve) => {
    setTimeout(resolve, 500);
  });
}

function start() {
  return new Promise((resolve, reject) => {
    child = spawn('node', [INDEX], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, HEMISPHERE_DB_PATH: join(dirname(INDEX), '.test-memories.db') }
    });

    child.stdout.on('data', (data) => {
      buffer += data.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop(); // keep incomplete line in buffer
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line);
          if (pendingResolve && msg.id === idCounter) {
            pendingResolve(msg);
            pendingResolve = null;
          }
        } catch (e) {
          // ignore parse errors from non-JSON output
        }
      }
    });

    child.stderr.on('data', (data) => {
      // MCP server writes nothing useful to stderr; suppress
    });

    child.on('error', (e) => reject(e));
    waitForReady().then(resolve);
  });
}

function stop() {
  return new Promise((resolve) => {
    if (!child) return resolve();
    child.on('close', resolve);
    child.stdin.end();
    setTimeout(() => { child.kill(); resolve(); }, 1000);
  });
}

function pass(label) {
  testCount++;
  passCount++;
  console.log('  PASS  ' + label);
}

function fail(label, detail) {
  testCount++;
  failCount++;
  console.log('  FAIL  ' + label);
  if (detail) console.log('        ' + detail.replace(/\n/g, '\n        '));
}

function assert(label, condition, detail) {
  if (condition) {
    pass(label);
    return true;
  } else {
    fail(label, detail);
    return false;
  }
}

function getResult(res) {
  const content = res?.result?.content;
  if (!content || !content[0]) return null;
  try {
    return JSON.parse(content[0].text);
  } catch {
    return content[0].text;
  }
}

function getError(res) {
  const content = res?.result?.content;
  if (!content?.[0]?.text) return null;
  if (res.result.isError) return content[0].text;
  return null;
}

function matchesPattern(text, patterns) {
  if (Array.isArray(patterns)) {
    return patterns.every(p => {
      if (p instanceof RegExp) return p.test(text);
      return text.includes(p);
    });
  }
  if (patterns instanceof RegExp) return patterns.test(text);
  return text.includes(patterns);
}

async function runTests() {
  console.log('\n=== Hemisphere v1.3.0 Schema CRUD Tests ===\n');

  // ================================================================
  // CREATE (6 tests)
  // ================================================================

  // C1: Valid kind + valid status
  let res = await rpc('memory_store', {
    project: PROJECT, kind: 'bug', status: 'open', content: 'C1: valid bug with open status'
  });
  let data = getResult(res);
  if (assert('C1 - valid kind + valid status', data?.success === true && typeof data.id === 'number', JSON.stringify(res))) {
    storeResults.C1 = data.id;
  }

  // C3: Invalid status for known kind
  res = await rpc('memory_store', {
    project: PROJECT, kind: 'bug', status: 'done', content: 'C3: should reject'
  });
  let err = getError(res);
  assert('C3 - invalid status rejected',
    err && err.includes('Invalid status') && err.includes('"done"') && err.includes('bug'),
    'Error: ' + err
  );

  // C6: Unknown kind pass-through
  res = await rpc('memory_store', {
    project: PROJECT, kind: 'schedule', status: 'confirmed', content: 'C6: unknown kind schedule with confirmed status'
  });
  data = getResult(res);
  if (assert('C6 - unknown kind pass-through', data?.success === true && typeof data.id === 'number', JSON.stringify(res))) {
    storeResults.C6 = data.id;
  }

  // C7: Status arg wins over metadata.status
  res = await rpc('memory_store', {
    project: PROJECT, kind: 'bug', status: 'fixed', content: 'C7: status wins',
    metadata: { status: 'open' }
  });
  data = getResult(res);
  if (assert('C7 - status arg wins over metadata.status', data?.success === true, JSON.stringify(res))) {
    storeResults.C7 = data.id;
    // Verify by searching for this memory and checking its status
    let searchRes = await rpc('memory_search', { project: PROJECT, query: 'status wins' });
    let results = getResult(searchRes);
    let mem = Array.isArray(results) ? results.find(r => r.id === data.id) : null;
    assert('C7b - DB status column = fixed',
      mem?.status === 'fixed',
      'Expected status="fixed", got: ' + JSON.stringify(mem?.status)
    );
    assert('C7c - metadata.status = fixed',
      mem?.metadata?.status === 'fixed',
      'Expected meta.status="fixed", got: ' + JSON.stringify(mem?.metadata?.status)
    );
  }

  // C9: Empty statuses array (note) — no validation
  res = await rpc('memory_store', {
    project: PROJECT, kind: 'note', status: 'anything', content: 'C9: note with any status'
  });
  data = getResult(res);
  assert('C9 - empty statuses (note) — no validation', data?.success === true, JSON.stringify(res));

  // C10: Default status applied when no status arg
  res = await rpc('memory_store', {
    project: PROJECT, kind: 'bug', content: 'C10: bug without status gets default'
  });
  data = getResult(res);
  if (assert('C10 - default status applied', data?.success === true, JSON.stringify(res))) {
    let searchRes = await rpc('memory_search', { project: PROJECT, query: 'without status gets default' });
    let results = getResult(searchRes);
    let mem = Array.isArray(results) ? results.find(r => r.id === data.id) : null;
    assert('C10b - default status = open',
      mem?.status === 'open',
      'Expected status="open", got: ' + JSON.stringify(mem?.status)
    );
  }

  // ================================================================
  // READ (3 tests)
  // ================================================================

  // R1: Search finds unknown-kind memory
  res = await rpc('memory_search', { project: PROJECT, query: 'unknown kind schedule' });
  let results = getResult(res);
  assert('R1 - search finds unknown-kind memory',
    Array.isArray(results) && results.some(r => r.kind === 'schedule' && r.status === 'confirmed'),
    'Results: ' + JSON.stringify(results?.map(r => r.kind + '/' + r.status))
  );

  // R3: List filtered by kind
  res = await rpc('memory_list', { project: PROJECT, kind: 'bug' });
  results = getResult(res);
  assert('R3 - list filtered by kind',
    Array.isArray(results) && results.length > 0 && results.every(r => r.kind === 'bug'),
    'Got ' + (results?.length || 0) + ' results, kinds: ' + JSON.stringify(results?.map(r => r.kind))
  );

  // R4: Project count
  res = await rpc('project_count', { project: PROJECT });
  data = getResult(res);
  assert('R4 - project count grouped by kind',
    data?.bug > 0 && data?.schedule === 1 && data?.note >= 1,
    'Counts: ' + JSON.stringify(data)
  );

  // ================================================================
  // UPDATE (8 tests)
  // ================================================================

  // U1: Valid status change
  let c1Id = storeResults.C1;
  res = await rpc('memory_update', { project: PROJECT, id: c1Id, status: 'in_progress' });
  data = getResult(res);
  assert('U1 - valid status change on update', data?.updated === true, JSON.stringify(res));

  // Read back to confirm
  res = await rpc('memory_search', { project: PROJECT, query: 'C1:' });
  results = getResult(res);
  let c1Mem = Array.isArray(results) ? results.find(r => r.id === c1Id) : null;
  assert('U1b - read-back confirms in_progress',
    c1Mem?.status === 'in_progress',
    'Expected status="in_progress", got: ' + JSON.stringify(c1Mem?.status)
  );

  // U2: Invalid status on update
  res = await rpc('memory_update', { project: PROJECT, id: c1Id, status: 'done' });
  err = getError(res);
  assert('U2 - invalid status rejected on update',
    err && err.includes('Invalid status') && err.includes('bug'),
    'Error: ' + err
  );

  // U3: Change kind + status together
  res = await rpc('memory_update', { project: PROJECT, id: c1Id, kind: 'plan', status: 'completed' });
  data = getResult(res);
  assert('U3 - kind + status change', data?.updated === true, JSON.stringify(res));

  res = await rpc('memory_search', { project: PROJECT, query: 'C1:' });
  results = getResult(res);
  c1Mem = Array.isArray(results) ? results.find(r => r.id === c1Id) : null;
  assert('U3b - kind changed to plan', c1Mem?.kind === 'plan', 'Expected kind="plan", got: ' + c1Mem?.kind);
  assert('U3c - status changed to completed', c1Mem?.status === 'completed', 'Expected status="completed", got: ' + c1Mem?.status);

  // U4: Content update reindexes FTS
  res = await rpc('memory_update', { project: PROJECT, id: c1Id, content: 'unique-term-xyz-12345 updated content' });
  data = getResult(res);
  assert('U4 - content update', data?.updated === true, JSON.stringify(res));

  res = await rpc('memory_search', { project: PROJECT, query: 'unique-term-xyz-12345' });
  results = getResult(res);
  assert('U4b - FTS index updated (new term found)',
    Array.isArray(results) && results.some(r => r.id === c1Id),
    'Results: ' + JSON.stringify(results?.map(r => r.id))
  );

  // U5: Status + metadata merge unified
  let c7Id = storeResults.C7;
  res = await rpc('memory_update', { project: PROJECT, id: c7Id, status: 'wont_fix', metadata: { severity: 'critical' } });
  data = getResult(res);
  assert('U5 - status + metadata merge', data?.updated === true, JSON.stringify(res));

  res = await rpc('memory_search', { project: PROJECT, query: 'status wins' });
  results = getResult(res);
  let c7Mem = Array.isArray(results) ? results.find(r => r.id === c7Id) : null;
  assert('U5b - status = wont_fix', c7Mem?.status === 'wont_fix', 'Got: ' + c7Mem?.status);
  assert('U5c - severity = critical', c7Mem?.metadata?.severity === 'critical', 'Got: ' + c7Mem?.metadata?.severity);

  // U6: Unknown → unknown kind change
  let c6Id = storeResults.C6;
  res = await rpc('memory_update', { project: PROJECT, id: c6Id, kind: 'meeting', status: 'scheduled' });
  data = getResult(res);
  assert('U6 - unknown→unknown kind change', data?.updated === true, JSON.stringify(res));

  res = await rpc('memory_search', { project: PROJECT, query: 'C6:' });
  results = getResult(res);
  let c6Mem = Array.isArray(results) ? results.find(r => r.id === c6Id) : null;
  assert('U6b - kind = meeting', c6Mem?.kind === 'meeting', 'Got: ' + c6Mem?.kind);
  assert('U6c - status = scheduled', c6Mem?.status === 'scheduled', 'Got: ' + c6Mem?.status);

  // U7: Unknown → known with bad status
  res = await rpc('memory_update', { project: PROJECT, id: c6Id, kind: 'bug', status: 'done' });
  err = getError(res);
  assert('U7 - unknown→known with bad status rejected',
    err && err.includes('Invalid status') && err.includes('bug'),
    'Error: ' + err
  );
  // Verify unchanged
  res = await rpc('memory_search', { project: PROJECT, query: 'C6:' });
  results = getResult(res);
  c6Mem = Array.isArray(results) ? results.find(r => r.id === c6Id) : null;
  assert('U7b - kind unchanged after reject', c6Mem?.kind === 'meeting', 'Got: ' + c6Mem?.kind);
  assert('U7c - status unchanged after reject', c6Mem?.status === 'scheduled', 'Got: ' + c6Mem?.status);

  // U8: Status arg wins on update
  res = await rpc('memory_update', { project: PROJECT, id: c7Id, status: 'fixed', metadata: { status: 'open' } });
  data = getResult(res);
  assert('U8 - status arg wins on update', data?.updated === true, JSON.stringify(res));
  res = await rpc('memory_search', { project: PROJECT, query: 'status wins' });
  results = getResult(res);
  c7Mem = Array.isArray(results) ? results.find(r => r.id === c7Id) : null;
  assert('U8b - status = fixed (not open)', c7Mem?.status === 'fixed', 'Got: ' + c7Mem?.status);

  // ================================================================
  // ATOMICITY (1 test)
  // ================================================================

  // E1: Failed update does not mutate
  // Use a decision-kind memory for this test
  res = await rpc('memory_store', {
    project: PROJECT, kind: 'decision', status: 'proposed', content: 'E1: decision for atomicity test'
  });
  data = getResult(res);
  let e1Id = data.id;
  assert('E1a - stored decision', data?.success === true, JSON.stringify(res));

  res = await rpc('memory_update', { project: PROJECT, id: e1Id, status: 'nope' });
  err = getError(res);
  assert('E1b - invalid status rejected', err && err.includes('Invalid status'), 'Error: ' + err);

  res = await rpc('memory_search', { project: PROJECT, query: 'atomicity test' });
  results = getResult(res);
  let e1Mem = Array.isArray(results) ? results.find(r => r.id === e1Id) : null;
  assert('E1c - status unchanged after reject',
    e1Mem?.status === 'proposed',
    'Expected status="proposed", got: ' + JSON.stringify(e1Mem?.status)
  );

  // ================================================================
  // LIFECYCLE (4 tests)
  // ================================================================

  // L1: Soft-delete
  let noteId;
  res = await rpc('memory_store', { project: PROJECT, kind: 'note', content: 'L1: note for soft-delete test' });
  data = getResult(res);
  noteId = data.id;

  res = await rpc('memory_trash', { project: PROJECT, id: noteId });
  data = getResult(res);
  assert('L1 - soft-delete', data?.deleted === true, JSON.stringify(res));

  res = await rpc('memory_search', { project: PROJECT, query: 'soft-delete test' });
  results = getResult(res);
  assert('L1b - not in active search after trash',
    Array.isArray(results) && !results.some(r => r.id === noteId),
    'Memory still found in active search'
  );

  // L2: List trashed
  res = await rpc('memory_list', { project: PROJECT, trash: true });
  results = getResult(res);
  assert('L2 - list trashed', Array.isArray(results) && results.some(r => r.id === noteId),
    'Trashed memory not found in trashed list');

  // L4: Archive
  let archiveId;
  res = await rpc('memory_store', { project: PROJECT, kind: 'fact', content: 'L4: fact for archive test' });
  data = getResult(res);
  archiveId = data.id;

  res = await rpc('memory_archive', { project: PROJECT, id: archiveId });
  data = getResult(res);
  assert('L4 - archive', data?.archived === true, JSON.stringify(res));

  res = await rpc('memory_list', { project: PROJECT });
  results = getResult(res);
  assert('L4b - not in active list after archive',
    Array.isArray(results) && !results.some(r => r.id === archiveId),
    'Archived memory still in active list'
  );

  // L5: Unarchive
  res = await rpc('memory_unarchive', { project: PROJECT, id: archiveId });
  data = getResult(res);
  assert('L5 - unarchive', data?.unarchived === true, JSON.stringify(res));

  res = await rpc('memory_list', { project: PROJECT });
  results = getResult(res);
  assert('L5b - back in active list after unarchive',
    Array.isArray(results) && results.some(r => r.id === archiveId),
    'Unarchived memory not found in active list'
  );

  // ================================================================
  // SCHEMA RESOLUTION (1 test)
  // ================================================================

  // D1: Default schema applies for non-overridden project
  res = await rpc('memory_store', {
    project: PROJECT, kind: 'bug', status: 'open', content: 'D1: schema fallback test'
  });
  data = getResult(res);
  assert('D1 - default schema applies (no project override in config)',
    data?.success === true,
    JSON.stringify(res)
  );

  // ================================================================
  // CLEANUP (1 test)
  // ================================================================

  res = await rpc('project_purge', { project: PROJECT, force: true });
  data = getResult(res);
  assert('P2 - force-purge test project', typeof data?.purged === 'number' && data.purged > 0, JSON.stringify(res));

  // Verify project is gone
  res = await rpc('project_list', {});
  let projects = getResult(res);
  assert('P2b - project removed from list',
    Array.isArray(projects) && !projects.includes(PROJECT),
    'Project still listed: ' + JSON.stringify(projects)
  );

  // ================================================================
  // SUMMARY
  // ================================================================

  console.log('\n---');
  console.log('Results: ' + passCount + '/' + testCount + ' passed');
  if (failCount > 0) {
    console.log('        ' + failCount + ' FAILED');
    process.exitCode = 1;
  } else {
    console.log('        ALL PASSED');
  }
  console.log();
}

async function main() {
  try {
    await start();
    await runTests();
  } catch (e) {
    console.error('Test error:', e);
    process.exitCode = 1;
  } finally {
    await stop();

    // Clean up test database
    try {
      const { unlinkSync } = await import('node:fs');
      const dbPath = join(dirname(INDEX), '.test-memories.db');
      unlinkSync(dbPath);
    } catch {}
  }
}

main();
