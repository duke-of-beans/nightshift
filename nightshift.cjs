/**
 * NIGHTSHIFT.cjs v3.0 — Brain Intelligence Nightly Maintenance
 * COGNITIVE-ORGANISM Phase 1+2 Complete
 * Run: node D:\Meta\NIGHTSHIFT.cjs
 * Schedule: Runs at Windows logon via NIGHTSHIFT_STARTUP.vbs
 *
 * Pass 1: Co-occurrence edge refresh
 * Pass 2: ACT-R decay + anti-Hebbian pruning (v2.0: replaces simple Hebbian)
 * Pass 3: Arc synthesis trigger check
 * Pass 4: Observation archival (stale + low-signal)
 * Pass 5: Entity fragmentation check
 * Pass 5B: Eye of Sauron quality scan → brain.db
 * Pass 6: Recall quality regression (50-query benchmark)
 * --- Data Sync ---
 * Pass 7-9: LIFELOG sync, FPP sync, Backup sync
 * Pass 9B: MCP Server SDK health check (protocol drift detection)
 * --- Cognitive Passes (COGNITIVE-ORGANISM-PHASE-2) ---
 * Pass 10: Structural isomorphism detection
 * Pass 11: Epistemic maintenance (TREG) — Anthropic API
 * Pass 12: Autonomous synthesis (LANTERN) — Anthropic API
 * Pass 13: Self-improvement backlog (PROMETHEUS) — Anthropic API
 * Pass 14: STATUS.md auto-freshness + enrichment (Deployed, Tests, Completion, Code Health, Yuma Health)
 * Pass 15: Observation quality backfill (PROMETHEUS-W1) — local compute, no API
 */

const Database = require('./projects/' + 'GregLite\\sidecar\\node_modules\\better-sqlite3');
const fs = require('fs');
const cp = require('child_process');
const crypto = require('crypto');
const https = require('https');

const TENANT = process.env.NIGHTSHIFT_TENANT || 'default';
const BRAIN_DB = './' + 'brain.db';
const BENCHMARK_FILE = './' + 'brain_benchmark.json';
const LOG_FILE = './' + 'NIGHTSHIFT_LOG.md';
const EOS_CLI = './projects/' + 'eye-of-sauron\\sauron-cli.js';

// Anthropic API for cognitive passes (11-13)
let ANTHROPIC_API_KEY = '';
try {
  const envContent = fs.readFileSync('./' + '.env', 'utf8');
  const match = envContent.match(/ANTHROPIC_API_KEY=(.+)/);
  if (match) ANTHROPIC_API_KEY = match[1].trim();
} catch { /* no API key available */ }

/** Call Anthropic Claude API. Returns response text or null on failure. */
function callClaude(prompt, systemPrompt, maxTokens) {
  if (!ANTHROPIC_API_KEY) return Promise.resolve(null);
  return new Promise((resolve) => {
    const body = JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: maxTokens || 1024,
      system: systemPrompt || 'You are a cognitive maintenance system analyzing a personal knowledge base.',
      messages: [{ role: 'user', content: prompt }]
    });
    const req = https.request({
      hostname: 'api.anthropic.com', port: 443, path: '/v1/messages', method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'Content-Length': Buffer.byteLength(body)
      }
    }, (res) => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => {
        try {
          const data = JSON.parse(raw);
          if (data.content && data.content[0]) resolve(data.content[0].text);
          else resolve(null);
        } catch { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.setTimeout(60000, () => { req.destroy(); resolve(null); });
    req.write(body); req.end();
  });
}

// Active codebases to scan with EoS
const EOS_TARGETS = [
  { project: 'GregLite', path: './projects/' + 'GregLite\\app\\src' },
  { project: 'KERNL', path: './projects/' + 'Project Mind\\kernl-mcp\\src' },
  { project: 'continuity-mcp', path: './projects/' + 'continuity-mcp\\src' },
  { project: 'brain-mcp', path: './projects/' + 'brain-mcp\\src' },
  { project: 'ContentStudio', path: 'D:\\Work\\ContentStudio\\src' },
];

const db = new Database(BRAIN_DB, { readonly: false });
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');

const startTime = new Date();
const log = [];

function logLine(msg) {
  const ts = new Date().toISOString().slice(11, 19);
  const line = '[' + ts + '] ' + msg;
  console.log(line);
  log.push(line);
}

const ENC = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
function ulid() {
  const ts = Date.now(); let s = '', m = ts;
  for (let i = 9; i >= 0; i--) { s = (ENC[m % 32] || '0') + s; m = Math.floor(m / 32); }
  for (let i = 0; i < 16; i++) s += ENC[Math.floor(Math.random() * 32)] || '0';
  return s;
}

// PASS 1 ─────────────────────────────────────────────────────────────────────
async function pass1() {
  logLine('PASS 1: Co-occurrence edge refresh');
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().replace('T', ' ').slice(0, 19);
  const newObs = db.prepare(
    "SELECT entity_id, created_at FROM observations WHERE tenant_id=? AND entity_id IS NOT NULL AND created_at > ? ORDER BY created_at ASC"
  ).all(TENANT, cutoff);
  if (newObs.length === 0) { logLine('  No new obs — skipping'); return 0; }

  const WINDOW_MS = 60 * 60 * 1000;
  const counts = new Map();
  const existSet = new Set();
  db.prepare('SELECT source_entity_id, target_entity_id FROM brain_edges').all()
    .forEach(r => existSet.add([r.source_entity_id, r.target_entity_id].sort().join('|')));

  for (let i = 0; i < newObs.length; i++) {
    const t = new Date(newObs[i].created_at).getTime();
    const ents = new Set([newObs[i].entity_id]);
    let j = i + 1;
    while (j < newObs.length && new Date(newObs[j].created_at).getTime() - t <= WINDOW_MS) {
      if (newObs[j].entity_id !== newObs[i].entity_id) ents.add(newObs[j].entity_id);
      j++;
    }
    const arr = Array.from(ents);
    for (let a = 0; a < arr.length; a++) for (let b = a + 1; b < arr.length; b++) {
      const k = [arr[a], arr[b]].sort().join('|');
      counts.set(k, (counts.get(k) || 0) + 1);
    }
  }

  const maxC = Math.max(...Array.from(counts.values()).filter(c => c >= 2), 1);
  const nowStr = new Date().toISOString().replace('T', ' ').slice(0, 19);
  const ins = db.prepare("INSERT OR IGNORE INTO brain_edges(id,source_entity_id,target_entity_id,relationship,weight,valid_from,source,metadata,created_at,updated_at,manually_seeded)VALUES(?,?,?,'co_mentioned',?,?,'inferred',?,?,?,0)");
  const upd = db.prepare("UPDATE brain_edges SET weight=MAX(weight,?),updated_at=? WHERE(source_entity_id=? AND target_entity_id=?)OR(source_entity_id=? AND target_entity_id=?)");

  let cr = 0, st = 0;
  db.transaction(() => {
    for (const [k, c] of counts) {
      if (c < 2) continue;
      const [s, t] = k.split('|');
      const w = Math.min(1.0, Math.max(0.15, (c / maxC) * 0.8));
      if (existSet.has(k)) { upd.run(w, nowStr, s, t, t, s); st++; }
      else { cr += ins.run(ulid(), s, t, w, nowStr, JSON.stringify({ count: c }), nowStr, nowStr).changes; }
    }
  })();
  logLine('  Created ' + cr + ' edges, strengthened ' + st + ' from ' + newObs.length + ' new obs');
  return cr;
}

// PASS 2 — ACT-R Decay + Anti-Hebbian Pruning (v2.0) ────────────────────────
// Replaces simple time-based Hebbian decay with principled ACT-R activation.
// B_i = ln(Σ t_j^(-d)) where t_j = time since j-th retrieval, d = 0.5
// Anti-Hebbian: edges where both endpoints are active but not co-occurring
// get stronger decay — they're cognitively disconnected despite being alive.
async function pass2() {
  logLine('PASS 2: ACT-R decay + anti-Hebbian pruning');
  const nowStr = new Date().toISOString().replace('T', ' ').slice(0, 19);
  const nowMs = Date.now();
  const ACT_R_D = 0.5; // standard ACT-R decay exponent

  // --- Phase 2A: Compute BLA per entity ---
  // For each entity with edges, compute base-level activation from observation retrievals
  const entities = db.prepare(
    "SELECT DISTINCT e.id FROM entities e JOIN brain_edges be ON (e.id=be.source_entity_id OR e.id=be.target_entity_id) WHERE e.tenant_id=?"
  ).all(TENANT);

  const entityBLA = new Map(); // entity_id → BLA score
  for (const ent of entities) {
    // Get retrieval timestamps for this entity's observations
    const obs = db.prepare(
      "SELECT last_accessed_at, created_at, access_count FROM observations WHERE entity_id=? AND tenant_id=? AND status='active'"
    ).all(ent.id, TENANT);

    if (obs.length === 0) { entityBLA.set(ent.id, -5.0); continue; } // no observations = very low activation

    let sumDecay = 0;
    for (const o of obs) {
      // Use last_accessed_at if available, otherwise created_at
      const refTime = o.last_accessed_at || o.created_at;
      const daysSince = Math.max(1, (nowMs - new Date(refTime).getTime()) / (24 * 60 * 60 * 1000));
      const accessCount = Math.max(1, o.access_count || 1);
      // Each access contributes t^(-d) to the sum
      sumDecay += accessCount * Math.pow(daysSince, -ACT_R_D);
    }
    entityBLA.set(ent.id, Math.log(Math.max(1e-10, sumDecay)));
  }

  // --- Phase 2B: Decay edges based on endpoint BLA ---
  const edges = db.prepare('SELECT id, source_entity_id, target_entity_id, weight, manually_seeded FROM brain_edges').all();
  let aggressive = 0, moderate = 0, stable = 0, antiHebbian = 0;

  // Prepare 30-day co-occurrence window for anti-Hebbian check
  const thirtyDaysAgo = new Date(nowMs - 30 * 24 * 60 * 60 * 1000).toISOString();
  const recentSessionEntities = new Set(
    db.prepare(
      "SELECT DISTINCT entity_id FROM observations WHERE tenant_id=? AND source='session' AND created_at>? AND entity_id IS NOT NULL"
    ).all(TENANT, thirtyDaysAgo).map(r => r.entity_id)
  );

  const updateEdge = db.prepare('UPDATE brain_edges SET weight=?, updated_at=? WHERE id=?');

  db.transaction(() => {
    for (const edge of edges) {
      const srcBLA = entityBLA.get(edge.source_entity_id) ?? -5.0;
      const tgtBLA = entityBLA.get(edge.target_entity_id) ?? -5.0;
      const meanBLA = (srcBLA + tgtBLA) / 2;
      const floor = edge.manually_seeded ? 0.10 : 0.05;

      // --- Anti-Hebbian check ---
      // Both endpoints active in sessions but NOT co-occurring = cognitively disconnected
      const srcActive = recentSessionEntities.has(edge.source_entity_id);
      const tgtActive = recentSessionEntities.has(edge.target_entity_id);
      if (srcActive && tgtActive && !edge.manually_seeded) {
        // Check if they actually co-occurred (appeared in same session window)
        const coOccur = db.prepare(
          "SELECT 1 FROM observations o1 JOIN observations o2 ON ABS(julianday(o1.created_at)-julianday(o2.created_at))<0.042 WHERE o1.entity_id=? AND o2.entity_id=? AND o1.tenant_id=? AND o1.created_at>? LIMIT 1"
        ).get(edge.source_entity_id, edge.target_entity_id, TENANT, thirtyDaysAgo);

        if (!coOccur) {
          // Anti-Hebbian: both active, never co-occurring → stronger decay
          const newWeight = Math.max(floor, edge.weight * 0.80);
          updateEdge.run(newWeight, nowStr, edge.id);
          antiHebbian++;
          continue;
        }
      }

      // --- ACT-R based decay ---
      if (meanBLA < -2.0) {
        // Low activation: aggressive decay
        const newWeight = Math.max(floor, edge.weight * 0.70);
        updateEdge.run(newWeight, nowStr, edge.id);
        aggressive++;
      } else if (meanBLA < 0) {
        // Medium activation: moderate decay
        const newWeight = Math.max(floor, edge.weight * 0.90);
        updateEdge.run(newWeight, nowStr, edge.id);
        moderate++;
      } else {
        // High activation: no decay (actively used)
        stable++;
      }
    }
  })();

  const dead = db.prepare('SELECT COUNT(*) as n FROM brain_edges WHERE weight<=0.05').get().n;
  logLine('  ACT-R decay: ' + aggressive + ' aggressive, ' + moderate + ' moderate, ' + stable + ' stable');
  logLine('  Anti-Hebbian: ' + antiHebbian + ' edges penalized (active but disconnected)');
  logLine('  Near-dead edges (<=0.05): ' + dead);
}

// PASS 3 ─────────────────────────────────────────────────────────────────────
async function pass3() {
  logLine('PASS 3: Arc synthesis check');
  const candidates = db.prepare(`
    SELECT entity_id, COUNT(*) as cnt FROM observations
    WHERE tenant_id=? AND created_at > ? AND source='session' AND entity_id IS NOT NULL
    GROUP BY entity_id HAVING cnt >= 3 ORDER BY cnt DESC LIMIT 5
  `).all(TENANT, new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString());
  if (candidates.length === 0) { logLine('  No candidates'); return; }
  logLine('  ' + candidates.length + ' candidates queued for arc synthesis:');
  const queue = candidates.map(c => {
    const e = db.prepare('SELECT name FROM entities WHERE id=?').get(c.entity_id);
    if (e) logLine('    ' + e.name + ': ' + c.cnt + ' session obs');
    return { entity_id: c.entity_id, entity_name: e ? e.name : null, count: c.cnt };
  });
  fs.writeFileSync('./' + 'synthesis_queue.json', JSON.stringify(queue, null, 2));
  logLine('  [Requires Anthropic API — queue at D:\\Meta\\synthesis_queue.json]');
}

// PASS 4 — Observation Lifecycle + Dedup Maintenance (v2.0) ─────────────────
async function pass4() {
  logLine('PASS 4: Observation lifecycle + dedup maintenance');
  const nowStr = new Date().toISOString().replace('T', ' ').slice(0, 19);
  const cutoff90 = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();

  // Phase 4A: Archive stale, never-accessed observations (ACT-R informed)
  // Criteria: >90 days old, never recalled (access_count=0 or NULL),
  // no synthesis depth, and low edge connectivity
  const toArchive = db.prepare(`
    SELECT o.id FROM observations o
    WHERE o.tenant_id=? AND o.created_at < ? AND o.status='active'
      AND (o.access_count IS NULL OR o.access_count = 0)
      AND (o.synthesis_depth = 0 OR o.synthesis_depth IS NULL)
      AND NOT EXISTS(SELECT 1 FROM brain_edges be WHERE be.source_entity_id=o.entity_id OR be.target_entity_id=o.entity_id)
    LIMIT 500
  `).all(TENANT, cutoff90);

  if (toArchive.length > 0) {
    const archiveStmt = db.prepare("UPDATE observations SET status='archived' WHERE id=?");
    db.transaction(() => { for (const o of toArchive) archiveStmt.run(o.id); })();
    logLine('  Archived ' + toArchive.length + ' stale, never-recalled observations');
  } else {
    logLine('  No stale observations to archive');
  }

  // Phase 4B: SHA-256 dedup maintenance — catch dupes from external ingest
  const newDupes = db.prepare(`
    SELECT content_hash, COUNT(*) as cnt FROM observations
    WHERE tenant_id=? AND status='active' AND content_hash IS NOT NULL
    GROUP BY content_hash HAVING cnt > 1
    ORDER BY cnt DESC LIMIT 100
  `).all(TENANT);

  let dedupArchived = 0;
  if (newDupes.length > 0) {
    const archiveStmt = db.prepare("UPDATE observations SET status='archived' WHERE id=?");
    db.transaction(() => {
      for (const group of newDupes) {
        const obs = db.prepare(
          "SELECT id FROM observations WHERE content_hash=? AND tenant_id=? AND status='active' ORDER BY created_at ASC"
        ).all(group.content_hash, TENANT);
        for (let i = 1; i < obs.length; i++) {
          archiveStmt.run(obs[i].id);
          dedupArchived++;
        }
      }
    })();
  }
  logLine('  Dedup maintenance: ' + newDupes.length + ' groups, ' + dedupArchived + ' archived');

  // Phase 4C: Backfill missing content_hash
  const missingHash = db.prepare(
    "SELECT id, content FROM observations WHERE content_hash IS NULL AND tenant_id=? AND status='active' LIMIT 1000"
  ).all(TENANT);
  if (missingHash.length > 0) {
    const hashStmt = db.prepare('UPDATE observations SET content_hash=? WHERE id=?');
    db.transaction(() => {
      for (const o of missingHash) {
        const hash = crypto.createHash('sha256').update(o.content).digest('hex');
        hashStmt.run(hash, o.id);
      }
    })();
    logLine('  Backfilled ' + missingHash.length + ' missing content_hashes');
  }
}

// PASS 5 ─────────────────────────────────────────────────────────────────────
async function pass5() {
  logLine('PASS 5: Entity fragmentation check');
  const ents = db.prepare("SELECT id, name FROM entities WHERE tenant_id=? AND status='active'").all(TENANT);
  const dupes = [];
  for (let i = 0; i < ents.length; i++) {
    for (let j = i + 1; j < ents.length; j++) {
      const a = ents[i].name.toLowerCase().replace(/[-_\s]/g, '');
      const b = ents[j].name.toLowerCase().replace(/[-_\s]/g, '');
      if (a.length < 4 || b.length < 4) continue;
      if (Math.abs(a.length - b.length) > 2) continue;
      let diff = 0;
      const short = a.length <= b.length ? a : b;
      const long = a.length <= b.length ? b : a;
      for (let k = 0; k < short.length; k++) if (short[k] !== long[k]) diff++;
      diff += long.length - short.length;
      if (diff <= 2) dupes.push([ents[i].name, ents[j].name]);
    }
  }
  if (dupes.length === 0) { logLine('  No fragmentation detected'); return; }
  logLine('  ' + dupes.length + ' potential duplicates — see D:\\Meta\\entity_review_queue.json');
  fs.writeFileSync('./' + 'entity_review_queue.json', JSON.stringify(dupes, null, 2));
}

// PASS 5B: Eye of Sauron codebase quality scan ──────────────────────────────
async function pass5b() {
  logLine('PASS 5B: Eye of Sauron quality scan → brain.db');
  if (!fs.existsSync(EOS_CLI)) { logLine('  EoS CLI not found — skipping'); return; }

  const nowStr = new Date().toISOString().replace('T', ' ').slice(0, 19);
  let scanned = 0, errors = 0;

  for (const target of EOS_TARGETS) {
    if (!fs.existsSync(target.path)) { continue; }
    try {
      const result = cp.spawnSync('node', [EOS_CLI, '--input', target.path, '--mode', 'quick', '--silent', '--output', '-'], {
        encoding: 'utf8', timeout: 60000
      });
      if (result.status !== 0 && result.status !== 1) continue;

      // Parse JSON output — EoS writes JSON to stdout when --output - is passed
      let healthScore = null;
      let criticalIssues = 0;
      let warnings = 0;
      try {
        // Strip any non-JSON prefix (e.g. stray banner lines) before parsing
        let rawOut = result.stdout || '{}';
        const jsonStart = rawOut.indexOf('{');
        if (jsonStart > 0) rawOut = rawOut.slice(jsonStart);
        const data = JSON.parse(rawOut);
        if (data.summary && typeof data.summary.healthScore === 'number') {
          healthScore = data.summary.healthScore;
          criticalIssues = data.summary.criticalIssues || 0;
          warnings = data.summary.warnings || 0;
        }
      } catch { /* couldn't parse JSON output — skip this target */ }

      if (healthScore === null) continue;

      // Find entity in brain.db
      const ent = db.prepare(
        "SELECT id FROM entities WHERE tenant_id=? AND (name LIKE ? OR slug LIKE ?) LIMIT 1"
      ).get(TENANT, '%' + target.project + '%', '%' + target.project.toLowerCase() + '%');

      if (!ent) continue;

      // Write health score as observation
      const obsId = ulid();
      const content = 'EoS quality scan: ' + target.project +
        ' health=' + healthScore.toFixed(0) + '/100' +
        ' (' + criticalIssues + ' critical, ' + warnings + ' warnings)';
      db.prepare(
        "INSERT OR IGNORE INTO observations(id,tenant_id,entity_id,content,source,tags,created_at,created_by,status,embedding_version,synthesis_depth) VALUES(?,?,'"+ent.id+"',?,'session','[\"eos_scan\"]',?,'nightshift-eos','active',1,0)"
      ).run(obsId, TENANT, content, nowStr);

      logLine('  ' + target.project + ': health=' + healthScore.toFixed(0) + '/100 (issues: ' + criticalIssues + ' critical, ' + warnings + ' warnings)');
      scanned++;
    } catch(e) {
      errors++;
      logLine('  ' + target.project + ': scan error — ' + e.message.slice(0, 60));
    }
  }
  logLine('  Scanned ' + scanned + ' projects, ' + errors + ' errors');
}

// PASS 6 ─────────────────────────────────────────────────────────────────────
async function pass6() {
  logLine('PASS 6: Recall quality regression');
  if (!fs.existsSync(BENCHMARK_FILE)) { logLine('  Benchmark file missing'); return null; }
  const bm = JSON.parse(fs.readFileSync(BENCHMARK_FILE, 'utf8'));
  const STOP_WORDS = new Set(['what','does','when','where','have','this','that','from','about','how','the','and','for','its','was','are','did','why','who','can']);
  const res = { total: 0, passed: 0, by_domain: {}, no_entity: 0 };

  for (const q of bm.queries) {
    const d = q.domain;
    if (!res.by_domain[d]) res.by_domain[d] = { passed: 0, total: 0 };
    res.by_domain[d].total++; res.total++;
    try {
      const ent = db.prepare("SELECT id FROM entities WHERE tenant_id=? AND (name LIKE ? OR name LIKE ?) LIMIT 1")
        .get(TENANT, q.target_entity + '%', '%' + q.target_entity + '%');
      if (!ent) { res.no_entity++; continue; }
      const obsN = db.prepare("SELECT COUNT(*) as n FROM observations WHERE tenant_id=? AND entity_id=? AND status!='archived'").get(TENANT, ent.id).n;
      if (obsN === 0) continue;
      const kws = q.query.toLowerCase().replace(/[^a-z0-9 ]/g,' ').split(' ')
        .filter(w => w.length > 4 && !STOP_WORDS.has(w)).slice(0, 3);
      let found = obsN > 0;
      if (kws.length > 0) {
        try {
          const hits = db.prepare(`SELECT o.entity_id FROM observations o JOIN observations_fts fts ON o.rowid=fts.rowid WHERE o.tenant_id=? AND observations_fts MATCH ? LIMIT 10`).all(TENANT, kws.join(' OR '));
          const hitIds = new Set(hits.map(h => h.entity_id));
          if (hitIds.has(ent.id)) found = true;
          else { for (const hid of Array.from(hitIds).filter(Boolean)) { if (db.prepare("SELECT 1 FROM brain_edges WHERE(source_entity_id=? AND target_entity_id=?)OR(source_entity_id=? AND target_entity_id=?)LIMIT 1").get(hid, ent.id, ent.id, hid)) { found = true; break; } } }
        } catch { /* FTS unavailable */ }
      }
      if (found) { res.passed++; res.by_domain[d].passed++; }
    } catch { res.total--; res.by_domain[d].total--; }
  }

  const rate = res.total > 0 ? res.passed / res.total : 0;
  logLine('  Overall: ' + res.passed + '/' + res.total + ' = ' + (rate * 100).toFixed(1) + '% (no_entity: ' + res.no_entity + ')');
  for (const [d, r] of Object.entries(res.by_domain)) {
    const pct = r.total > 0 ? (r.passed / r.total * 100).toFixed(1) : 'N/A';
    const flag = r.total > 0 && r.passed / r.total < bm.pass_threshold ? ' ⚠️' : ' ✓';
    logLine('    ' + d + ': ' + r.passed + '/' + r.total + ' = ' + pct + '%' + flag);
  }
  if (rate < bm.pass_threshold) logLine('  ⚠️ BELOW THRESHOLD — investigate');
  return { overall: rate };
}

// PASS 10 — Structural Isomorphism Detection ────────────────────────────────
// Pure SQL: detect entities with similar structural patterns and create edges.
// No API needed. Finds entities that play similar roles in the portfolio.
async function pass10() {
  logLine('PASS 10: Structural isomorphism detection');
  const db2 = new Database(BRAIN_DB, { readonly: false });
  db2.pragma('journal_mode = WAL');
  try {
    // Get all active entities with their observation counts and edge patterns
    const entities = db2.prepare(`
      SELECT e.id, e.name, e.type, e.status, e.metadata,
        (SELECT COUNT(*) FROM observations o WHERE o.entity_id=e.id AND o.status='active') as obs_count,
        (SELECT COUNT(*) FROM brain_edges be WHERE be.source_entity_id=e.id OR be.target_entity_id=e.id) as edge_count,
        (SELECT AVG(be.weight) FROM brain_edges be WHERE be.source_entity_id=e.id OR be.target_entity_id=e.id) as avg_weight
      FROM entities e WHERE e.tenant_id=? AND e.status='active' AND e.type='project'
    `).all(TENANT);

    if (entities.length < 2) { logLine('  Too few entities for comparison'); return; }

    // Compare pairs for structural similarity
    let created = 0;
    const ins = db2.prepare(
      "INSERT OR IGNORE INTO brain_edges(id,source_entity_id,target_entity_id,relationship,weight,valid_from,source,metadata,created_at,updated_at,manually_seeded) VALUES(?,?,?,'structural_isomorphism',?,datetime('now'),'inferred',?,datetime('now'),datetime('now'),0)"
    );
    const existing = new Set(
      db2.prepare("SELECT source_entity_id||'|'||target_entity_id as k FROM brain_edges WHERE relationship='structural_isomorphism'").all().map(r => r.k)
    );

    db2.transaction(() => {
      for (let i = 0; i < entities.length; i++) {
        for (let j = i + 1; j < entities.length; j++) {
          const a = entities[i], b = entities[j];
          const key1 = a.id + '|' + b.id, key2 = b.id + '|' + a.id;
          if (existing.has(key1) || existing.has(key2)) continue;

          // Similarity heuristic: similar obs density + edge connectivity + type match
          let score = 0;
          const obsRatio = Math.min(a.obs_count, b.obs_count) / Math.max(a.obs_count, b.obs_count, 1);
          const edgeRatio = Math.min(a.edge_count, b.edge_count) / Math.max(a.edge_count, b.edge_count, 1);
          score += obsRatio * 0.4 + edgeRatio * 0.3;

          // Metadata similarity (phase, priority)
          try {
            const mA = JSON.parse(a.metadata || '{}'), mB = JSON.parse(b.metadata || '{}');
            if (mA.phase && mB.phase && mA.phase === mB.phase) score += 0.15;
            if (mA.priority && mB.priority && mA.priority === mB.priority) score += 0.15;
          } catch { /* skip metadata comparison */ }

          if (score >= 0.5) {
            ins.run(ulid(), a.id, b.id, Math.min(1.0, score), JSON.stringify({ obs_ratio: obsRatio.toFixed(2), edge_ratio: edgeRatio.toFixed(2) }));
            created++;
          }
        }
      }
    })();
    logLine('  Created ' + created + ' structural isomorphism edges from ' + entities.length + ' entities');
  } catch (e) { logLine('  ERROR: ' + e.message); }
  finally { try { db2.close(); } catch {} }
}

// PASS 11 — Epistemic Maintenance (TREG) ─────────────────────────────────────
// Uses Anthropic API to scan for zombie assumptions and contradictions.
// Identifies observations that may be outdated or superseded.
async function pass11() {
  logLine('PASS 11: Epistemic maintenance (TREG)');
  if (!ANTHROPIC_API_KEY) { logLine('  No API key — skipping'); return; }

  const db2 = new Database(BRAIN_DB, { readonly: false });
  db2.pragma('journal_mode = WAL');
  try {
    // Find entities with the most session observations (where contradictions are likely)
    const targets = db2.prepare(`
      SELECT e.id, e.name, COUNT(o.id) as obs_count
      FROM entities e JOIN observations o ON o.entity_id=e.id
      WHERE e.tenant_id=? AND e.status='active' AND o.status='active' AND o.source='session'
      GROUP BY e.id HAVING obs_count >= 3
      ORDER BY obs_count DESC LIMIT 3
    `).all(TENANT);

    if (targets.length === 0) { logLine('  No entities with enough session observations'); return; }

    for (const target of targets) {
      const obs = db2.prepare(
        "SELECT content, created_at FROM observations WHERE entity_id=? AND tenant_id=? AND status='active' AND source='session' ORDER BY created_at DESC LIMIT 8"
      ).all(target.id, TENANT);

      const obsText = obs.map((o, i) => `[${i+1}] (${o.created_at.slice(0,10)}) ${o.content.slice(0, 300)}`).join('\n\n');

      const result = await callClaude(
        `Analyze these chronological observations about "${target.name}" for epistemic health.\n\nObservations (newest first):\n${obsText}\n\nIdentify:\n1. Any contradictions between older and newer observations\n2. Any "zombie assumptions" — claims in older observations that newer ones implicitly supersede\n3. Any observations that appear to be outdated or stale\n\nRespond with JSON only: {"contradictions": [{"old_idx": N, "new_idx": N, "description": "..."}], "zombies": [{"idx": N, "reason": "..."}], "health_score": 0-100, "summary": "one sentence"}`,
        'You analyze a personal knowledge base for epistemic consistency. Respond with JSON only, no markdown fences.',
        512
      );

      if (!result) { logLine('  ' + target.name + ': API call failed'); continue; }

      try {
        const cleaned = result.replace(/```json|```/g, '').trim();
        const analysis = JSON.parse(cleaned);
        logLine('  ' + target.name + ': health=' + (analysis.health_score || '?') + '/100, ' +
          (analysis.contradictions?.length || 0) + ' contradictions, ' +
          (analysis.zombies?.length || 0) + ' zombies');
        if (analysis.summary) logLine('    ' + analysis.summary);

        // Persist as observation
        const obsId = ulid();
        const content = 'TREG epistemic scan: ' + target.name + ' — health=' + (analysis.health_score || '?') +
          '/100. ' + (analysis.contradictions?.length || 0) + ' contradictions, ' +
          (analysis.zombies?.length || 0) + ' zombie assumptions. ' + (analysis.summary || '');
        db2.prepare(
          "INSERT INTO observations(id,tenant_id,entity_id,content,source,tags,created_at,created_by,status,embedding_version,synthesis_depth) VALUES(?,?,?,?,'session','[\"treg_scan\"]',datetime('now'),'nightshift-treg','active',1,0)"
        ).run(obsId, TENANT, target.id, content);
      } catch (parseErr) {
        logLine('  ' + target.name + ': parse error — ' + result.slice(0, 80));
      }
    }
  } catch (e) { logLine('  ERROR: ' + e.message); }
  finally { try { db2.close(); } catch {} }
}

// PASS 12 — Autonomous Synthesis (LANTERN) ───────────────────────────────────
// Uses Anthropic API to discover cross-entity connections that aren't yet edged.
// The "wandering" pass — unfocused associative exploration.
async function pass12() {
  logLine('PASS 12: Autonomous synthesis (LANTERN)');
  if (!ANTHROPIC_API_KEY) { logLine('  No API key — skipping'); return; }

  const db2 = new Database(BRAIN_DB, { readonly: false });
  db2.pragma('journal_mode = WAL');
  try {
    // Pick 5 random active entities with observations
    const entities = db2.prepare(`
      SELECT e.id, e.name, (SELECT content FROM observations WHERE entity_id=e.id AND status='active' ORDER BY created_at DESC LIMIT 1) as latest_obs
      FROM entities e
      WHERE e.tenant_id=? AND e.status='active' AND e.type='project'
        AND EXISTS(SELECT 1 FROM observations WHERE entity_id=e.id AND status='active')
      ORDER BY RANDOM() LIMIT 5
    `).all(TENANT);

    if (entities.length < 2) { logLine('  Too few entities'); return; }

    const entitySummaries = entities.map(e =>
      `- ${e.name}: ${(e.latest_obs || '').slice(0, 200)}`
    ).join('\n');

    const result = await callClaude(
      `Here are 5 entities from a personal knowledge base / project portfolio:\n\n${entitySummaries}\n\nLook for unexpected connections, shared patterns, or insights that emerge from considering these together. What cross-cutting themes or structural parallels exist? What might someone learn by thinking about these together that they wouldn't see looking at each alone?\n\nRespond with JSON only: {"connections": [{"entities": ["name1", "name2"], "insight": "..."}], "wandering_thought": "one unexpected observation about the portfolio as a whole"}`,
      'You are a creative pattern-recognition system exploring a personal project portfolio for unexpected connections. Think laterally. Respond with JSON only, no markdown fences.',
      512
    );

    if (!result) { logLine('  API call failed'); return; }

    try {
      const cleaned = result.replace(/```json|```/g, '').trim();
      const synthesis = JSON.parse(cleaned);
      const connCount = synthesis.connections?.length || 0;
      logLine('  Found ' + connCount + ' connections across ' + entities.length + ' entities');
      if (synthesis.wandering_thought) logLine('  Wandering: ' + synthesis.wandering_thought.slice(0, 120));

      // Persist the synthesis as an observation
      const obsId = ulid();
      const content = 'LANTERN synthesis: ' + connCount + ' cross-entity connections found. ' +
        (synthesis.connections || []).map(c => c.entities.join('↔') + ': ' + c.insight).join('; ').slice(0, 500) +
        (synthesis.wandering_thought ? ' | Wandering: ' + synthesis.wandering_thought : '');
      db2.prepare(
        "INSERT INTO observations(id,tenant_id,content,source,tags,created_at,created_by,status,embedding_version,synthesis_depth) VALUES(?,?,?,'session','[\"lantern_synthesis\"]',datetime('now'),'nightshift-lantern','active',1,1)"
      ).run(obsId, TENANT, content);
    } catch (parseErr) {
      logLine('  Parse error — ' + result.slice(0, 80));
    }
  } catch (e) { logLine('  ERROR: ' + e.message); }
  finally { try { db2.close(); } catch {} }
}

// PASS 13 — Self-Improvement Backlog (PROMETHEUS) ────────────────────────────
// Uses Anthropic API to analyze the cognitive system's own patterns and gaps.
// Generates capability improvement proposals.
async function pass13() {
  logLine('PASS 13: Self-improvement backlog (PROMETHEUS)');
  if (!ANTHROPIC_API_KEY) { logLine('  No API key — skipping'); return; }

  const db2 = new Database(BRAIN_DB, { readonly: false });
  db2.pragma('journal_mode = WAL');
  try {
    // Gather system stats for self-analysis
    const stats = {
      active_obs: db2.prepare("SELECT COUNT(*) as n FROM observations WHERE tenant_id=? AND status='active'").get(TENANT).n,
      archived_obs: db2.prepare("SELECT COUNT(*) as n FROM observations WHERE tenant_id=? AND status='archived'").get(TENANT).n,
      edges: db2.prepare('SELECT COUNT(*) as n FROM brain_edges').get().n,
      entities: db2.prepare("SELECT COUNT(*) as n FROM entities WHERE tenant_id=? AND status='active'").get(TENANT).n,
      never_recalled: db2.prepare("SELECT COUNT(*) as n FROM observations WHERE tenant_id=? AND status='active' AND (access_count IS NULL OR access_count=0)").get(TENANT).n,
      top_recalled: db2.prepare("SELECT content, access_count FROM observations WHERE tenant_id=? AND status='active' AND access_count>0 ORDER BY access_count DESC LIMIT 3").all(TENANT),
      source_dist: db2.prepare("SELECT source, COUNT(*) as cnt FROM observations WHERE tenant_id=? AND status='active' GROUP BY source ORDER BY cnt DESC LIMIT 5").all(TENANT),
      recent_sessions: db2.prepare("SELECT COUNT(DISTINCT date(created_at)) as n FROM observations WHERE tenant_id=? AND source='session' AND created_at > datetime('now', '-30 days')").get(TENANT).n,
    };

    const prompt = `Analyze this cognitive memory system's health and identify improvement opportunities.

System stats:
- ${stats.active_obs} active observations, ${stats.archived_obs} archived
- ${stats.edges} graph edges, ${stats.entities} active entities
- ${stats.never_recalled} observations never recalled (${((stats.never_recalled/stats.active_obs)*100).toFixed(0)}% waste)
- ${stats.recent_sessions} active session-days in last 30 days
- Top sources: ${stats.source_dist.map(s => s.source + ':' + s.cnt).join(', ')}
- Most recalled: ${stats.top_recalled.map(o => o.content.slice(0,60) + ' (x' + o.access_count + ')').join('; ')}

What capability gaps, structural weaknesses, or improvement opportunities do you see? What would make this system dramatically more useful?

Respond with JSON only: {"proposals": [{"title": "short name", "description": "what and why", "impact": "high|medium|low", "effort": "high|medium|low"}], "health_assessment": "one sentence on system health"}`;

    const result = await callClaude(prompt,
      'You are PROMETHEUS — a self-improvement engine analyzing a personal AI memory system. Identify concrete, actionable improvements. Prioritize by force-multiplication potential. Respond with JSON only, no markdown fences.',
      768
    );

    if (!result) { logLine('  API call failed'); return; }

    try {
      const cleaned = result.replace(/```json|```/g, '').trim();
      const analysis = JSON.parse(cleaned);
      logLine('  Health: ' + (analysis.health_assessment || 'unknown'));
      const proposals = analysis.proposals || [];
      logLine('  ' + proposals.length + ' improvement proposals:');
      for (const p of proposals.slice(0, 5)) {
        logLine('    [' + (p.impact || '?') + '/' + (p.effort || '?') + '] ' + p.title);
      }

      // Persist proposals as observation
      const obsId = ulid();
      const content = 'PROMETHEUS self-assessment: ' + (analysis.health_assessment || '') + '. Proposals: ' +
        proposals.map(p => p.title + ' (' + p.impact + ' impact)').join(', ');
      db2.prepare(
        "INSERT INTO observations(id,tenant_id,content,source,tags,created_at,created_by,status,embedding_version,synthesis_depth) VALUES(?,?,?,'session','[\"prometheus_backlog\"]',datetime('now'),'nightshift-prometheus','active',1,1)"
      ).run(obsId, TENANT, content);

      // Write proposals to file for easy review
      fs.writeFileSync('./' + 'prometheus_proposals.json', JSON.stringify(analysis, null, 2));
    } catch (parseErr) {
      logLine('  Parse error — ' + result.slice(0, 80));
    }
  } catch (e) { logLine('  ERROR: ' + e.message); }
  finally { try { db2.close(); } catch {} }
}

// PASS 15 — Observation Quality Backfill (PROMETHEUS-W1) ─────────────────────
// Local-compute pass. Computes quality_score for unscored active observations.
// Mirrors brain-tools.ts computeQualityScore — no Anthropic API, pure stats
// (k=5 NN embedding distance + grounding/source weights + compression ratio
// + same-entity prediction error). Quality is a re-ranker, never a gate.
// National Razor: no observation is ever excluded based on score.
//
// Options: { dryRun: true } processes only 10 observations for testing.
async function pass15(options) {
  options = options || {};
  logLine('PASS 15: Observation quality backfill' + (options.dryRun ? ' (DRY RUN, 10 obs)' : ''));

  const Database2 = require('./projects/' + 'GregLite\\sidecar\\node_modules\\better-sqlite3');
  const db15 = new Database2(BRAIN_DB, { readonly: false });
  db15.pragma('journal_mode = WAL');
  db15.pragma('foreign_keys = OFF');

  let vecOk = false;
  try {
    const sqliteVec = require('./projects/' + 'GregLite\\sidecar\\node_modules\\sqlite-vec');
    sqliteVec.load(db15);
    vecOk = true;
  } catch { /* BM25-only fallback — surprisal/prediction_error stay neutral */ }

  const SOURCE_W = {
    session: 1.00, treg_scan: 0.95, imprint: 0.90, markdown_index: 0.85,
    lantern_synthesis: 0.70, greglite_scan: 0.50,
  };
  const GROUNDING_W = {
    empirical: 1.00, verified: 1.00, theoretical: 0.75, partial: 0.75,
    speculative: 0.50, weak: 0.50, unknown: 0.50,
  };

  function scoreRow(row) {
    // 1. Surprisal: k=5 global NN avg cosine distance
    let surprisal = 0.5;
    if (vecOk && row.embedding) {
      try {
        const emb = new Float32Array(
          row.embedding.buffer,
          row.embedding.byteOffset,
          row.embedding.byteLength / 4
        );
        const queryJson = JSON.stringify(Array.from(emb));
        const rows = db15.prepare(
          "SELECT vec_distance_cosine(embedding, vec_f32(?)) AS dist FROM observations WHERE tenant_id=? AND embedding IS NOT NULL AND status='active' AND typeof(embedding)='blob' AND length(embedding)=3072 AND id != ? ORDER BY dist ASC LIMIT 5"
        ).all(queryJson, TENANT, row.id);
        if (rows.length > 0) {
          const avg = rows.reduce((s, r) => s + r.dist, 0) / rows.length;
          surprisal = Math.min(1, Math.max(0, avg / 2));
        }
      } catch { /* neutral */ }
    }

    const gw = GROUNDING_W[(row.grounding_tier || 'unknown').toLowerCase()] || 0.5;
    const sw = SOURCE_W[(row.source || '').toLowerCase()] || 0.6;

    // 4. Compression ratio: structural density
    const content = row.content || '';
    const tokens = content.split(/\s+/).filter(Boolean);
    const tokenCount = Math.max(1, tokens.length);
    const pathM = (content.match(/[A-Za-z]:\\[^\s]+|\/[A-Za-z0-9_./\-]+(?:\.[a-z]+)?/g) || []).length;
    const versionM = (content.match(/\bv?\d+\.\d+(?:\.\d+)?\b/g) || []).length;
    const entityLike = new Set();
    for (const t of tokens) {
      if (/^[A-Z][a-z]+[A-Z][A-Za-z]+$/.test(t)) entityLike.add(t.toLowerCase());
      else if (/^[A-Z]{3,}$/.test(t)) entityLike.add(t.toLowerCase());
    }
    const cr = Math.min(1, ((entityLike.size + pathM + versionM) / tokenCount) * 3);

    // 5. Prediction error: same-entity divergence
    let pe = 0.5;
    if (vecOk && row.embedding && row.entity_id) {
      try {
        const emb = new Float32Array(
          row.embedding.buffer,
          row.embedding.byteOffset,
          row.embedding.byteLength / 4
        );
        const queryJson = JSON.stringify(Array.from(emb));
        const rows = db15.prepare(
          "SELECT vec_distance_cosine(embedding, vec_f32(?)) AS dist FROM observations WHERE tenant_id=? AND entity_id=? AND embedding IS NOT NULL AND status='active' AND typeof(embedding)='blob' AND length(embedding)=3072 AND id != ? ORDER BY dist ASC LIMIT 3"
        ).all(queryJson, TENANT, row.entity_id, row.id);
        if (rows.length > 0) {
          const avg = rows.reduce((s, r) => s + r.dist, 0) / rows.length;
          pe = Math.min(1, Math.max(0, avg / 2));
        } else {
          pe = 0.3; // first observation for this entity
        }
      } catch { /* neutral */ }
    }

    const q = (surprisal + gw + sw + cr + pe) / 5;
    const r4 = x => Math.round(x * 10000) / 10000;
    return { quality_score: r4(q), surprisal: r4(surprisal), compression_ratio: r4(cr) };
  }

  const BATCH = 100;
  const upd = db15.prepare(
    "UPDATE observations SET quality_score=?, surprisal=?, compression_ratio=? WHERE id=?"
  );

  let totalScored = 0;
  const allQualities = [];
  const bySource = new Map();
  let iterations = 0;
  const MAX_ITER = 200; // safety cap (200 * 100 = 20k obs)

  while (iterations < MAX_ITER) {
    iterations++;
    const limit = options.dryRun ? 10 : BATCH;
    const batch = db15.prepare(
      "SELECT id, content, source, entity_id, embedding, grounding_tier FROM observations WHERE tenant_id=? AND status='active' AND quality_score IS NULL ORDER BY created_at ASC LIMIT ?"
    ).all(TENANT, limit);
    if (batch.length === 0) break;

    const tx = db15.transaction(() => {
      for (const row of batch) {
        const s = scoreRow(row);
        upd.run(s.quality_score, s.surprisal, s.compression_ratio, row.id);
        totalScored++;
        allQualities.push(s.quality_score);
        const src = row.source || 'unknown';
        if (!bySource.has(src)) bySource.set(src, []);
        bySource.get(src).push(s.quality_score);
      }
    });
    tx();

    if (options.dryRun) break;
  }

  if (allQualities.length > 0) {
    allQualities.sort((a, b) => a - b);
    const min = allQualities[0];
    const max = allQualities[allQualities.length - 1];
    const median = allQualities[Math.floor(allQualities.length / 2)];
    const mean = allQualities.reduce((s, x) => s + x, 0) / allQualities.length;
    logLine('  Scored: ' + totalScored + ' obs | min=' + min.toFixed(3) + ' max=' + max.toFixed(3) + ' median=' + median.toFixed(3) + ' mean=' + mean.toFixed(3));
    const srcLines = [];
    for (const [src, vals] of bySource) {
      const sm = vals.reduce((s, x) => s + x, 0) / vals.length;
      srcLines.push(src + ' n=' + vals.length + ' μ=' + sm.toFixed(3));
    }
    logLine('  By source: ' + srcLines.join(' | '));
  } else {
    logLine('  No unscored observations. All caught up.');
  }

  db15.close();
  return totalScored;
}


// PASS 16 — Entity Community Detection (PROMETHEUS-W4) ────────────────────────
// Pure SQL + local compute, no API. Label propagation over brain_edges.
// 3-run dampening: only set stable=1 after 3 consecutive identical assignments.
async function pass16() {
  logLine('PASS 16: Entity community detection (label propagation)');
  const db16 = new Database(BRAIN_DB, { readonly: false });
  db16.pragma('journal_mode = WAL');
  try {
    // Ensure schema exists
    db16.exec(`
      CREATE TABLE IF NOT EXISTS entity_communities (
        entity_id TEXT PRIMARY KEY, community_id INTEGER NOT NULL,
        confidence REAL DEFAULT 0.0, consecutive_assignments INTEGER DEFAULT 1,
        last_computed_at TEXT DEFAULT (datetime('now')), stable INTEGER DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS community_metadata (
        community_id INTEGER PRIMARY KEY, label TEXT DEFAULT NULL,
        member_count INTEGER DEFAULT 0, density REAL DEFAULT 0.0,
        computed_at TEXT DEFAULT (datetime('now'))
      );
    `);

    // Get all active entities that participate in at least one edge
    const entities = db16.prepare(`
      SELECT DISTINCT e.id, e.name FROM entities e
      WHERE e.tenant_id = ? AND e.status = 'active'
        AND (EXISTS (SELECT 1 FROM brain_edges be WHERE be.source_entity_id = e.id)
          OR EXISTS (SELECT 1 FROM brain_edges be WHERE be.target_entity_id = e.id))
    `).all(TENANT);

    if (entities.length < 3) {
      logLine('  Too few entities with edges (' + entities.length + ') — skipping');
      return;
    }
    logLine('  Entities with edges: ' + entities.length);

    // Build adjacency map: entity_id -> [{neighbor_id, weight}]
    const adj = new Map();
    for (const e of entities) adj.set(e.id, []);

    const edges = db16.prepare(`
      SELECT source_entity_id, target_entity_id, weight
      FROM brain_edges WHERE valid_to IS NULL OR valid_to > datetime('now')
    `).all();
    for (const e of edges) {
      const s = adj.get(e.source_entity_id), t = adj.get(e.target_entity_id);
      if (s) s.push({ nb: e.target_entity_id, w: e.weight });
      if (t) t.push({ nb: e.source_entity_id, w: e.weight });
    }
    logLine('  Loaded ' + edges.length + ' active edges');

    // Initialize: each entity gets its own community (sequential int)
    const entityIds = entities.map(e => e.id);
    const community = new Map();
    entityIds.forEach((id, i) => community.set(id, i));

    // Label propagation iterations
    const MAX_ROUNDS = 20;
    let converged = false;
    let rounds = 0;

    for (let r = 0; r < MAX_ROUNDS; r++) {
      rounds++;
      let changed = 0;
      // Shuffle to avoid order bias
      const shuffled = [...entityIds];
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }
      for (const eid of shuffled) {
        const neighbors = adj.get(eid) || [];
        if (neighbors.length === 0) continue;
        // Tally weighted votes per community
        const votes = new Map();
        for (const n of neighbors) {
          const nc = community.get(n.nb);
          if (nc === undefined) continue;
          votes.set(nc, (votes.get(nc) || 0) + n.w);
        }
        if (votes.size === 0) continue;
        // Pick community with highest weighted vote
        let bestC = community.get(eid), bestW = -1;
        for (const [c, w] of votes) {
          if (w > bestW) { bestW = w; bestC = c; }
        }
        if (bestC !== community.get(eid)) {
          community.set(eid, bestC);
          changed++;
        }
      }
      if (changed === 0) { converged = true; break; }
    }
    logLine('  Converged: ' + converged + ' after ' + rounds + ' rounds');

    // AUTHORITY CHECK: all-one-cluster or over-fragmentation
    const uniqueC = new Set(community.values());
    if (uniqueC.size <= 1) {
      logLine('  STOP: All entities in one cluster — algorithm failure');
      return;
    }
    if (uniqueC.size > 50 && entities.length < 40) {
      logLine('  STOP: Over-fragmentation (' + uniqueC.size + ' clusters for ' + entities.length + ' entities)');
      return;
    }
    logLine('  Communities found: ' + uniqueC.size);

    // 3-run dampening: compare new vs stored, increment or reset
    let reassigned = 0, stabilized = 0, newEntries = 0;
    const getExisting = db16.prepare('SELECT community_id, consecutive_assignments, stable FROM entity_communities WHERE entity_id = ?');
    const upsert = db16.prepare(`
      INSERT INTO entity_communities (entity_id, community_id, confidence, consecutive_assignments, last_computed_at, stable)
      VALUES (?, ?, ?, ?, datetime('now'), ?)
      ON CONFLICT(entity_id) DO UPDATE SET
        community_id = excluded.community_id,
        confidence = excluded.confidence,
        consecutive_assignments = excluded.consecutive_assignments,
        last_computed_at = excluded.last_computed_at,
        stable = excluded.stable
    `);

    db16.transaction(() => {
      for (const eid of entityIds) {
        const newC = community.get(eid);
        const existing = getExisting.get(eid);
        if (!existing) {
          // First run — new entry, consecutive=1, not stable yet
          upsert.run(eid, newC, 0, 1, 0);
          newEntries++;
        } else if (existing.community_id === newC) {
          // Same assignment — increment consecutive
          const newConsec = existing.consecutive_assignments + 1;
          const isStable = newConsec >= 3 ? 1 : 0;
          if (isStable && !existing.stable) stabilized++;
          upsert.run(eid, newC, 0, newConsec, isStable);
        } else {
          // Different assignment — reset
          upsert.run(eid, newC, 0, 1, 0);
          reassigned++;
        }
      }
    })();
    logLine('  Dampening: ' + newEntries + ' new, ' + reassigned + ' reassigned, ' + stabilized + ' newly stabilized');

    // Compute community_metadata
    db16.exec('DELETE FROM community_metadata');
    const communityGroups = new Map();
    for (const [eid, cid] of community) {
      if (!communityGroups.has(cid)) communityGroups.set(cid, []);
      communityGroups.get(cid).push(eid);
    }
    const nameMap = new Map(entities.map(e => [e.id, e.name]));
    const insM = db16.prepare(
      "INSERT INTO community_metadata (community_id, label, member_count, density, computed_at) VALUES (?, ?, ?, ?, datetime('now'))"
    );
    db16.transaction(() => {
      for (const [cid, members] of communityGroups) {
        const n = members.length;
        // Density = intra-community edges / possible edges
        let intraEdges = 0;
        const memberSet = new Set(members);
        for (const eid of members) {
          const neighbors = adj.get(eid) || [];
          for (const nb of neighbors) {
            if (memberSet.has(nb.nb)) intraEdges++;
          }
        }
        intraEdges = intraEdges / 2; // counted both directions
        const possibleEdges = n > 1 ? (n * (n - 1)) / 2 : 1;
        const density = parseFloat((intraEdges / possibleEdges).toFixed(4));
        // Label: top 3 entity names by obs count (or just first 3)
        const label = members.slice(0, 3).map(id => nameMap.get(id) || id.slice(0, 8)).join(', ');
        insM.run(cid, label, n, density);
      }
    })();

    // Log community sizes
    const sizes = [...communityGroups.entries()]
      .map(([cid, m]) => ({ cid, n: m.length }))
      .sort((a, b) => b.n - a.n);
    logLine('  Largest: ' + sizes[0].n + ' members (community ' + sizes[0].cid + ')');
    logLine('  Smallest: ' + sizes[sizes.length - 1].n + ' members');
    logLine('  Top 5 communities:');
    for (const s of sizes.slice(0, 5)) {
      const members = communityGroups.get(s.cid);
      const names = members.slice(0, 4).map(id => nameMap.get(id) || id.slice(0, 8)).join(', ');
      logLine('    C' + s.cid + ' (' + s.n + '): ' + names + (members.length > 4 ? '...' : ''));
    }

    // Summary stats
    const totalStable = db16.prepare('SELECT COUNT(*) as n FROM entity_communities WHERE stable = 1').get().n;
    logLine('  Total stable entities: ' + totalStable + '/' + entities.length);

  } catch (e) { logLine('  ERROR: ' + e.message); }
  finally { try { db16.close(); } catch {} }
}


// MAIN ───────────────────────────────────────────────────────────────────────
async function main() {
  // Same-day guard: prevent double-runs (Task Scheduler + Startup folder)
  const today = new Date().toISOString().slice(0, 10);
  if (fs.existsSync(LOG_FILE)) {
    const logContent = fs.readFileSync(LOG_FILE, 'utf8');
    const todayRuns = logContent.split('\n').filter(l => l.includes('## ' + today + ' NIGHTSHIFT'));
    if (todayRuns.length > 0) {
      console.log('[NIGHTSHIFT] Already ran today (' + today + ') — skipping. Force with: node NIGHTSHIFT.cjs --force');
      if (!process.argv.includes('--force')) return;
      console.log('[NIGHTSHIFT] --force flag detected, running anyway.');
    }
  }

  logLine('=== NIGHTSHIFT BEGIN ===');
  const obsN = db.prepare("SELECT COUNT(*) as n FROM observations WHERE tenant_id=?").get(TENANT).n;
  const edgeN = db.prepare("SELECT COUNT(*) as n FROM brain_edges").get().n;
  const entN = db.prepare("SELECT COUNT(*) as n FROM entities WHERE tenant_id=? AND status='active'").get(TENANT).n;
  logLine('brain.db: ' + obsN + ' obs | ' + edgeN + ' edges | ' + entN + ' entities | avg_degree: ' + ((edgeN * 2) / entN).toFixed(1));
  try { await pass1(); } catch(e) { logLine('PASS 1 ERROR: ' + e.message); }
  try { await pass2(); } catch(e) { logLine('PASS 2 ERROR: ' + e.message); }
  try { await pass3(); } catch(e) { logLine('PASS 3 ERROR: ' + e.message); }
  try { await pass4(); } catch(e) { logLine('PASS 4 ERROR: ' + e.message); }
  try { await pass5(); } catch(e) { logLine('PASS 5 ERROR: ' + e.message); }
  try { await pass5b(); } catch(e) { logLine('PASS 5B ERROR: ' + e.message); }
  try { await pass6(); } catch(e) { logLine('PASS 6 ERROR: ' + e.message); }
  // Pass 7: LIFELOG sync — ingest new/changed Throwbak files into brain.db
  try {
    logLine('PASS 7: LIFELOG sync');
    db.close(); // release db lock before lifelog_sync opens it
    const result = cp.execSync('node D:\\Meta\\lifelog_sync.cjs --nightshift --embed', { timeout: 120000, encoding: 'utf8' });
    const lines = result.trim().split('\n').filter(l => l.includes('TOTALS') || l.includes('EMBEDDED') || l.includes('ERROR'));
    lines.forEach(l => logLine('  ' + l.trim()));
  } catch(e) { logLine('PASS 7 ERROR: ' + e.message); }
  // Pass 8: FPP sync — ingest Fine Print research + external context into brain.db
  try {
    logLine('PASS 8: FPP sync');
    const result2 = cp.execSync('node D:\\Meta\\fpp_sync.cjs --embed', { timeout: 120000, encoding: 'utf8' });
    const lines2 = result2.trim().split('\n').filter(l => l.includes('TOTALS') || l.includes('EMBEDDED') || l.includes('ERROR'));
    lines2.forEach(l => logLine('  ' + l.trim()));
  } catch(e) { logLine('PASS 8 ERROR: ' + e.message); }
  // Pass 9: Automated backup — sync critical D:\ folders to OneDrive
  try {
    logLine('PASS 9: Backup sync');
    cp.execSync('./' + 'backup_sync.bat', { timeout: 600000, encoding: 'utf8', stdio: 'pipe' });
    logLine('  Backup sync complete');
  } catch(e) { logLine('PASS 9 ERROR: ' + e.message); }
  // Pass 9B: MCP Server SDK health check — detect protocol drift before silent timeouts
  try {
    logLine('PASS 9B: MCP Server SDK health check');
    const hcResult = cp.execSync('node D:\\Meta\\mcp-health-check.js', { timeout: 30000, encoding: 'utf8' });
    const hcLines = hcResult.trim().split('\n').filter(l => l.includes('✅') || l.includes('❌') || l.includes('⚠') || l.includes('Latest SDK'));
    hcLines.forEach(l => logLine('  ' + l.trim()));
    if (hcResult.includes('issue(s) found')) {
      logLine('  ⚠ MCP SDK drift detected — run: node D:\\Meta\\mcp-health-check.js --fix');
    }
  } catch(e) { logLine('PASS 9B ERROR: ' + e.message); }
  // --- Cognitive Passes (Phase 2) ---
  try { await pass10(); } catch(e) { logLine('PASS 10 ERROR: ' + e.message); }
  try { await pass11(); } catch(e) { logLine('PASS 11 ERROR: ' + e.message); }
  try { await pass12(); } catch(e) { logLine('PASS 12 ERROR: ' + e.message); }
  try { await pass13(); } catch(e) { logLine('PASS 13 ERROR: ' + e.message); }
  // --- Pass 15: Observation quality backfill (PROMETHEUS-W1) ---
  try { await pass15(); } catch(e) { logLine('PASS 15 ERROR: ' + e.message); }
  // --- Pass 16: Entity community detection (PROMETHEUS-W4) ---
  try { await pass16(); } catch(e) { logLine('PASS 16 ERROR: ' + e.message); }
  // --- Pass 14: STATUS.md auto-freshness + enrichment (NIGHTSHIFT-STATUS-01) ---
  try {
    logLine('PASS 14: STATUS.md auto-freshness + enrichment');
    const graphYaml = require('js-yaml');
    const pathMod = require('path');
    const graphRaw = fs.readFileSync('./' + 'PRODUCT_GRAPH.yaml', 'utf8');
    const gData = graphYaml.load(graphRaw.replace(/"([^"\n]*)"/g, (m, inner) =>
      inner.includes('\\') ? '"' + inner.replace(/\\/g, '/') + '"' : m
    ));
    const allProj = Object.assign({}, gData.products || {}, gData.ventures || {});
    let updated = 0, skipped = 0, created = 0;
    let enrichDeployed = 0, enrichTests = 0, enrichCompletion = 0, enrichHealth = 0, enrichYuma = 0;

    // Open brain.db readonly for enrichment queries (signals + eos_scan)
    const brainDb14 = new Database(BRAIN_DB, { readonly: true });
    brainDb14.pragma('journal_mode = WAL');

    // --- Helper: patch or insert a **Field:** value line in STATUS.md ---
    function patchField(content, fieldName, value) {
      const escapedName = fieldName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp('\\*\\*' + escapedName + ':\\*\\*[^\\n]*', 'i');
      const newLine = '**' + fieldName + ':** ' + value;
      if (regex.test(content)) {
        const replaced = content.replace(regex, newLine);
        return { content: replaced, changed: replaced !== content };
      }
      // Insert after Last Updated line
      if (/Last Updated/i.test(content)) {
        return { content: content.replace(/((?:\*\*)?Last Updated(?:\*\*)?[:\s]+[^\n]*)/i, '$1\n' + newLine), changed: true };
      }
      // Insert after Status line
      if (content.includes('**Status:**')) {
        return { content: content.replace(/(\*\*Status:\*\*[^\n]*)/i, '$1\n' + newLine), changed: true };
      }
      // Insert after first heading
      return { content: content.replace(/^(#[^\n]+\n)/, '$1\n' + newLine + '\n'), changed: true };
    }

    // --- Helper: find entity_id in brain.db for a project name ---
    function findEntityId(projectName) {
      if (!projectName) return null;
      const slug = projectName.toLowerCase().replace(/\s+/g, '-');
      const bySlug = brainDb14.prepare(
        "SELECT id FROM entities WHERE tenant_id=? AND slug=? LIMIT 1"
      ).get(TENANT, slug);
      if (bySlug) return bySlug.id;
      const byName = brainDb14.prepare(
        "SELECT id FROM entities WHERE tenant_id=? AND name LIKE ? LIMIT 1"
      ).get(TENANT, '%' + projectName + '%');
      return byName ? byName.id : null;
    }

    // --- Helper: compute completion % from STATUS.md task markers ---
    function computeCompletion(content) {
      // Count [x] (done) vs [ ] (pending) task markers
      const done = (content.match(/- \[x\]/gi) || []).length;
      const pending = (content.match(/- \[ \]/gi) || []).length;
      const total = done + pending;
      if (total === 0) return null;
      return Math.round((done / total) * 100);
    }

    for (const [id, info] of Object.entries(allProj)) {
      if (!info.path || info.path === 'null' || !fs.existsSync(info.path)) continue;
      const statusPath = pathMod.join(info.path, 'STATUS.md');

      // Get most recent git commit date
      let lastCommitDate = null;
      let lastCommitMsg = null;
      try {
        const gitLog = cp.execSync('git log -1 --format="%aI|||%s"', {
          cwd: info.path, timeout: 5000, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe']
        }).trim();
        if (gitLog) {
          const [dateStr, msg] = gitLog.split('|||');
          lastCommitDate = dateStr ? dateStr.trim() : null;
          lastCommitMsg = msg ? msg.trim() : null;
        }
      } catch { /* no git repo */ }

      if (!fs.existsSync(statusPath)) {
        // Create minimal STATUS.md for projects that don't have one
        if (lastCommitDate) {
          const dateOnly = lastCommitDate.substring(0, 10);
          const label = info.name || id;
          const stub = [
            '# ' + label + ' — STATUS',
            '',
            '**Status:** active',
            '**Last Updated:** ' + dateOnly + ' (auto — last git commit)',
            '',
            '---',
            '',
            '## Current State',
            '',
            '_STATUS.md auto-created by NIGHTSHIFT. Update with current project state._',
            ''
          ].join('\n');
          fs.writeFileSync(statusPath, stub, 'utf8');
          created++;
        }
        continue;
      }

      // Read existing STATUS.md
      let content = fs.readFileSync(statusPath, 'utf8');
      let dirty = false;

      // ── Last Updated patch (existing logic) ──────────────────────────────
      if (lastCommitDate) {
        const gitDate = new Date(lastCommitDate);
        const gitDateOnly = lastCommitDate.substring(0, 10);
        const lastUpdM = content.match(/Last Updated[:\s]+([^\n(]+)/i);
        let existingDate = null;
        if (lastUpdM) {
          const parsed = new Date(lastUpdM[1].trim().replace(/\*+/g, ''));
          if (!isNaN(parsed.getTime())) existingDate = parsed;
        }

        if (!existingDate || gitDate > existingDate) {
          const annotation = lastCommitMsg ? ' (auto — ' + lastCommitMsg.substring(0, 60) + ')' : ' (auto — git)';
          if (lastUpdM) {
            content = content.replace(
              /Last Updated[:\s]+[^\n]+/i,
              'Last Updated: ' + gitDateOnly + annotation
            );
          } else if (content.includes('**Status:**')) {
            content = content.replace(
              /(\*\*Status:\*\*[^\n]*)/i,
              '$1\n**Last Updated:** ' + gitDateOnly + annotation
            );
          } else {
            content = content.replace(
              /^(#[^\n]+\n)/,
              '$1\n**Last Updated:** ' + gitDateOnly + annotation + '\n'
            );
          }
          dirty = true;
        }
      }

      // ── ENRICHMENT 1: Deployed (from brain.db signals table) ─────────────
      try {
        const entityId = findEntityId(info.name || id);
        if (entityId) {
          const signal = brainDb14.prepare(
            "SELECT value FROM signals WHERE tenant_id=? AND source='vercel_deploy_hash' AND entity_id=? ORDER BY polled_at DESC LIMIT 1"
          ).get(TENANT, entityId);
          if (signal) {
            const val = JSON.parse(signal.value);
            let deployStatus;
            if (val.state === 'READY') deployStatus = 'yes';
            else if (val.state === 'ERROR' || val.status === 'error') deployStatus = 'error';
            else if (val.status === 'no_deployments') deployStatus = 'none';
            else deployStatus = 'no';
            const deployLine = deployStatus + ' (auto)';
            const p = patchField(content, 'Deployed', deployLine);
            if (p.changed) { content = p.content; dirty = true; enrichDeployed++; }
          }
        }
      } catch { /* signal query failed — skip enrichment */ }

      // ── ENRICHMENT 2: Tests (run npm test for package.json projects) ─────
      try {
        const pkgPath = pathMod.join(info.path, 'package.json');
        if (fs.existsSync(pkgPath)) {
          const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
          const testScript = pkg.scripts && pkg.scripts.test;
          if (testScript && !testScript.includes('no test specified') && !testScript.includes('exit 1')) {
            const testResult = cp.spawnSync('npm', ['test', '--', '--passWithNoTests'], {
              cwd: info.path, timeout: 60000, encoding: 'utf8',
              stdio: ['pipe', 'pipe', 'pipe'], shell: true,
              env: Object.assign({}, process.env, { CI: 'true', FORCE_COLOR: '0', NODE_ENV: 'test' })
            });
            const output = (testResult.stdout || '') + '\n' + (testResult.stderr || '');
            let testLine = null;

            // Parse common test output patterns
            // Jest: "Tests: X passed, Y total" or "X passed, Y failed, Z total"
            const jestMatch = output.match(/Tests:\s+(?:(\d+)\s+failed,\s+)?(\d+)\s+passed,\s+(\d+)\s+total/i);
            if (jestMatch) {
              const failed = parseInt(jestMatch[1] || '0', 10);
              const passed = parseInt(jestMatch[2], 10);
              const total = parseInt(jestMatch[3], 10);
              testLine = passed + '/' + total + ' passing' + (failed > 0 ? ' (' + failed + ' failed)' : '');
            }

            // Vitest: "Tests  X passed (Y)" or "X passed | Y failed"
            if (!testLine) {
              const vitestMatch = output.match(/(\d+)\s+passed/i);
              const vitestFail = output.match(/(\d+)\s+failed/i);
              if (vitestMatch) {
                const passed = parseInt(vitestMatch[1], 10);
                const failed = vitestFail ? parseInt(vitestFail[1], 10) : 0;
                testLine = passed + '/' + (passed + failed) + ' passing' + (failed > 0 ? ' (' + failed + ' failed)' : '');
              }
            }

            // Generic: "X passing" or "X tests passed"
            if (!testLine) {
              const genericMatch = output.match(/(\d+)\s+(?:passing|tests?\s+passed)/i);
              if (genericMatch) {
                testLine = genericMatch[1] + ' passing';
              }
            }

            // Pytest: "X passed" optionally with "Y failed"
            if (!testLine) {
              const pytestMatch = output.match(/(\d+)\s+passed/);
              const pytestFail = output.match(/(\d+)\s+failed/);
              if (pytestMatch) {
                const passed = parseInt(pytestMatch[1], 10);
                const failed = pytestFail ? parseInt(pytestFail[1], 10) : 0;
                testLine = passed + '/' + (passed + failed) + ' passing' + (failed > 0 ? ' (' + failed + ' failed)' : '');
              }
            }

            // Fallback: exit code only
            if (!testLine) {
              testLine = testResult.status === 0 ? 'passing (auto)' : 'failing (exit ' + testResult.status + ')';
            } else {
              testLine += ' (auto)';
            }

            const p = patchField(content, 'Tests', testLine);
            if (p.changed) { content = p.content; dirty = true; enrichTests++; }
          }
        }
      } catch { /* test run failed — skip */ }

      // ── ENRICHMENT 3: Completion % (from task markers in STATUS.md) ──────
      try {
        const pct = computeCompletion(content);
        if (pct !== null) {
          const completionLine = pct + '% (auto — ' + (content.match(/- \[x\]/gi) || []).length + ' done, ' + (content.match(/- \[ \]/gi) || []).length + ' pending)';
          const p = patchField(content, 'Completion', completionLine);
          if (p.changed) { content = p.content; dirty = true; enrichCompletion++; }
        }
      } catch { /* completion calc failed — skip */ }

      // ── ENRICHMENT 4: Code Health (from EoS scan in brain.db) ────────────
      try {
        const entityId = findEntityId(info.name || id);
        if (entityId) {
          // Find most recent eos_scan observation for this entity
          const eosObs = brainDb14.prepare(
            "SELECT content FROM observations WHERE tenant_id=? AND entity_id=? AND tags LIKE '%eos_scan%' AND status='active' ORDER BY created_at DESC LIMIT 1"
          ).get(TENANT, entityId);
          if (eosObs && eosObs.content) {
            // Parse: "EoS quality scan: ProjectName health=XX/100 (Y critical, Z warnings)"
            const healthMatch = eosObs.content.match(/health=(\d+)\/100/);
            const critMatch = eosObs.content.match(/(\d+)\s+critical/);
            const warnMatch = eosObs.content.match(/(\d+)\s+warnings?/);
            if (healthMatch) {
              const score = parseInt(healthMatch[1], 10);
              const crit = critMatch ? parseInt(critMatch[1], 10) : 0;
              const warn = warnMatch ? parseInt(warnMatch[1], 10) : 0;
              const healthLine = score + '/100' + (crit > 0 ? ' (' + crit + ' critical' + (warn > 0 ? ', ' + warn + ' warnings' : '') + ')' : warn > 0 ? ' (' + warn + ' warnings)' : '') + ' (auto — EoS)';
              const p = patchField(content, 'Code Health', healthLine);
              if (p.changed) { content = p.content; dirty = true; enrichHealth++; }
            }
          }
        }
      } catch { /* EoS query failed — skip */ }

      // ── ENRICHMENT 5: Yuma Health (from KERNL test_specs) ────────────────
      try {
        const kernlDb = new Database('./projects/' + 'Project Mind\\kernl-mcp\\data\\project-mind.db', { readonly: true });
        // Map project name to KERNL project ID (kebab-case)
        const projId = (info.name || id).toLowerCase().replace(/[^a-z0-9]+/g, '-');
        const specs = kernlDb.prepare('SELECT * FROM test_specs WHERE project_id = ?').all(projId);
        if (specs.length > 0) {
          const passing = specs.filter(s => s.last_result === 'pass').length;
          const failing = specs.filter(s => s.last_result === 'fail' || s.last_result === 'error').length;
          const neverRun = specs.filter(s => !s.last_run).length;
          const hasRun = specs.filter(s => s.last_run);
          const coverage = ((specs.length - neverRun) / specs.length) * 100;
          const passRate = hasRun.length > 0 ? (passing / hasRun.length) * 100 : 0;
          const score = Math.round((coverage * 0.5) + (passRate * 0.5));
          const band = score >= 90 ? 'GREEN' : score >= 70 ? 'YELLOW' : score >= 50 ? 'ORANGE' : 'RED';
          const yumaLine = score + '/100 ' + band + ' (' + specs.length + ' specs, ' + passing + ' pass' + (failing > 0 ? ', ' + failing + ' fail' : '') + ') (auto — Yuma)';
          const p = patchField(content, 'Yuma Health', yumaLine);
          if (p.changed) { content = p.content; dirty = true; enrichYuma++; }
        }
        kernlDb.close();
      } catch { /* Yuma query failed — skip */ }

      // ── Write if anything changed ────────────────────────────────────────
      if (dirty) {
        fs.writeFileSync(statusPath, content, 'utf8');
        updated++;
      } else {
        skipped++;
      }
    }

    try { brainDb14.close(); } catch { /* already closed */ }
    logLine('  Updated: ' + updated + ', Created: ' + created + ', Skipped (unchanged): ' + skipped);
    logLine('  Enriched — Deployed: ' + enrichDeployed + ', Tests: ' + enrichTests + ', Completion: ' + enrichCompletion + ', Code Health: ' + enrichHealth + ', Yuma: ' + enrichYuma);
  } catch(e) { logLine('PASS 14 ERROR: ' + e.message); }
  const elapsed = ((Date.now() - startTime.getTime()) / 1000).toFixed(1);
  logLine('=== NIGHTSHIFT COMPLETE in ' + elapsed + 's ===');
  const header = '\n## ' + startTime.toISOString().slice(0, 10) + ' NIGHTSHIFT\n';
  fs.appendFileSync(LOG_FILE, header + log.join('\n') + '\n');

  // ── MORNING BRIEFING generation (post-pass, uses everything above) ──────
  // This is the compounding mechanism: each NIGHTSHIFT run writes a briefing
  // that Greg reads on the next dashboard open. Includes git recency, pass
  // findings, priorities, and session-over-session trajectory.
  try {
    logLine('BRIEFING: Generating MORNING_BRIEFING.md');
    const briefDb = new Database(BRAIN_DB, { readonly: true });
    const bNow = new Date();
    const bIso = bNow.toISOString().slice(0, 10);
    const bDay = bNow.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
    const bTime = bNow.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });

    const bLines = [];
    bLines.push('# MORNING BRIEFING — ' + bDay + ', ' + bTime);
    bLines.push('> Generated by NIGHTSHIFT v3.0 | Load at session start');
    bLines.push('');

    // P0/P1 from PORTFOLIO_STATE
    try {
      const yaml = require('js-yaml');
      const psRaw = fs.readFileSync('./' + 'PORTFOLIO_STATE.yaml', 'utf8');
      const ps = yaml.load(psRaw.replace(/"([^"\n]*)"/g, (m, inner) =>
        inner.includes('\\') ? '"' + inner.replace(/\\/g, '/') + '"' : m
      ));
      const projects = ps && ps.projects ? ps.projects : {};
      const p0Items = [], p1Items = [];
      for (const [id, proj] of Object.entries(projects)) {
        const p = proj;
        (p.p0_items || []).forEach(item => {
          const text = typeof item === 'string' ? item : (item.text || '');
          p0Items.push('- **[' + (p.label || id) + ']** ' + text);
        });
        (p.p1_items || []).forEach(item => {
          const text = typeof item === 'string' ? item : (item.text || '');
          p1Items.push('- **[' + (p.label || id) + ']** ' + text);
        });
      }
      bLines.push('## 🔴 BLOCKING NOW (P0)');
      if (p0Items.length > 0) p0Items.forEach(l => bLines.push(l));
      else bLines.push('No P0 items. Clear runway.');
      bLines.push('');
      bLines.push('## 🟠 THIS WEEK (P1 — top items)');
      if (p1Items.length > 0) p1Items.slice(0, 8).forEach(l => bLines.push(l));
      else bLines.push('No P1 items.');
      bLines.push('');
      bLines.push('## 📊 PORTFOLIO COUNTS');
      const summary = ps && ps.summary ? ps.summary : {};
      bLines.push('P0: ' + (summary.total_p0 || 0) + ' | P1: ' + (summary.total_p1 || 0) +
        ' | P2: ' + (summary.total_p2 || 0) + ' | P3: ' + (summary.total_p3 || 0));
      bLines.push('');
    } catch (e) { bLines.push('(Portfolio state unavailable: ' + e.message + ')'); bLines.push(''); }

    // Yuma health scores for registered projects
    try {
      const yumaDb = new Database('./projects/' + 'Project Mind\\kernl-mcp\\data\\project-mind.db', { readonly: true });
      const yumaProjects = yumaDb.prepare("SELECT DISTINCT project_id FROM test_specs").all();
      if (yumaProjects.length > 0) {
        bLines.push('## 🛡️ YUMA HEALTH');
        for (const row of yumaProjects) {
          const pid = row.project_id;
          const specs = yumaDb.prepare('SELECT * FROM test_specs WHERE project_id = ?').all(pid);
          const passing = specs.filter(s => s.last_result === 'pass').length;
          const failing = specs.filter(s => s.last_result === 'fail' || s.last_result === 'error').length;
          const neverRun = specs.filter(s => !s.last_run).length;
          const hasRun = specs.filter(s => s.last_run);
          const coverage = ((specs.length - neverRun) / specs.length) * 100;
          const passRate = hasRun.length > 0 ? (passing / hasRun.length) * 100 : 0;
          const score = Math.round((coverage * 0.5) + (passRate * 0.5));
          const band = score >= 90 ? 'GREEN' : score >= 70 ? 'YELLOW' : score >= 50 ? 'ORANGE' : 'RED';
          const icon = band === 'GREEN' ? '🟢' : band === 'YELLOW' ? '🟡' : band === 'ORANGE' ? '🟠' : '🔴';
          bLines.push(icon + ' **' + pid.toUpperCase() + ':** ' + score + '/100 (' + specs.length + ' specs, ' + passing + ' pass' + (failing > 0 ? ', ' + failing + ' FAIL' : '') + ')');
        }
        bLines.push('');
      }
      yumaDb.close();
    } catch { /* Yuma db unavailable */ }

    // Git commits in last 24h across all portfolio projects
    try {
      const graphYaml = require('js-yaml');
      const graphRaw = fs.readFileSync('./' + 'PRODUCT_GRAPH.yaml', 'utf8');
      const graph = graphYaml.load(graphRaw.replace(/"([^"\n]*)"/g, (m, inner) =>
        inner.includes('\\') ? '"' + inner.replace(/\\/g, '/') + '"' : m
      ));
      const allItems = Object.assign({}, graph.products || {}, graph.ventures || {});

      bLines.push('## 🔧 COMMITS IN LAST 24H');
      let totalCommits = 0;
      for (const [id, info] of Object.entries(allItems)) {
        const p = info;
        if (!p.path || p.path === 'null') continue;
        try {
          const gitLog = cp.execSync(
            'git log --since="24 hours ago" --format="%h %s" --no-merges',
            { cwd: p.path, timeout: 5000, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
          ).trim();
          if (gitLog) {
            const commits = gitLog.split('\n').filter(Boolean);
            totalCommits += commits.length;
            bLines.push('**' + (p.name || id) + ':**');
            commits.slice(0, 5).forEach(c => bLines.push('  ' + c));
            if (commits.length > 5) bLines.push('  ... and ' + (commits.length - 5) + ' more');
          }
        } catch { /* no git repo or no commits */ }
      }
      if (totalCommits === 0) bLines.push('No commits in the last 24 hours.');
      else bLines.push('\n**Total: ' + totalCommits + ' commits across portfolio**');
      bLines.push('');
    } catch { bLines.push('(Git scan unavailable)'); bLines.push(''); }

    // Recent brain observations (last 24h) — session activity
    try {
      const cutoff24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().replace('T', ' ').slice(0, 19);
      const recentObs = briefDb.prepare(
        "SELECT o.content, e.name as entity_name FROM observations o LEFT JOIN entities e ON o.entity_id = e.id WHERE o.tenant_id = ? AND o.created_at > ? AND o.status = 'active' AND o.source != 'markdown_index' ORDER BY o.created_at DESC LIMIT 15"
      ).all(TENANT, cutoff24h);
      if (recentObs.length > 0) {
        bLines.push('## 🧠 RECENT BRAIN ACTIVITY (last 24h)');
        for (const obs of recentObs) {
          const prefix = obs.entity_name ? '[' + obs.entity_name + '] ' : '';
          bLines.push('- ' + prefix + (obs.content || '').slice(0, 150));
        }
        bLines.push('');
      }
    } catch { /* db read error */ }

    // NIGHTSHIFT findings summary (from this run's log)
    const nightshiftFindings = log.filter(l =>
      l.includes('isomorphism') || l.includes('contradiction') ||
      l.includes('zombie') || l.includes('LANTERN') ||
      l.includes('Health:') || l.includes('health=') ||
      l.includes('PASS 1') && l.includes('Created')
    ).slice(0, 8);
    if (nightshiftFindings.length > 0) {
      bLines.push('## 🌙 NIGHTSHIFT FINDINGS (this run)');
      nightshiftFindings.forEach(l => {
        // Strip timestamp prefix
        const clean = l.replace(/^\[\d{2}:\d{2}:\d{2}\]\s*/, '').trim();
        if (clean) bLines.push('- ' + clean);
      });
      bLines.push('');
    }

    // Trajectory: compare with previous briefing if it exists
    try {
      const prevBriefing = fs.readFileSync('./' + 'MORNING_BRIEFING.md', 'utf8');
      const prevP0Match = prevBriefing.match(/P0:\s*(\d+)/);
      const prevP1Match = prevBriefing.match(/P1:\s*(\d+)/);
      const prevCommitMatch = prevBriefing.match(/Total:\s*(\d+)\s*commits/);
      const prevP0 = prevP0Match ? parseInt(prevP0Match[1]) : null;
      const prevP1 = prevP1Match ? parseInt(prevP1Match[1]) : null;
      const prevCommits = prevCommitMatch ? parseInt(prevCommitMatch[1]) : null;
      const yaml2 = require('js-yaml');
      const ps2 = yaml2.load(fs.readFileSync('./' + 'PORTFOLIO_STATE.yaml', 'utf8').replace(/"([^"\n]*)"/g, (m, inner) =>
        inner.includes('\\') ? '"' + inner.replace(/\\/g, '/') + '"' : m
      ));
      const curP0 = ps2?.summary?.total_p0 || 0;
      const curP1 = ps2?.summary?.total_p1 || 0;

      const deltas = [];
      if (prevP0 !== null && curP0 !== prevP0) deltas.push('P0: ' + prevP0 + ' → ' + curP0 + (curP0 < prevP0 ? ' ✓' : ' ⚠'));
      if (prevP1 !== null && curP1 !== prevP1) deltas.push('P1: ' + prevP1 + ' → ' + curP1 + (curP1 < prevP1 ? ' ✓' : ''));
      if (deltas.length > 0) {
        bLines.push('## 📈 TRAJECTORY (vs previous briefing)');
        deltas.forEach(d => bLines.push('- ' + d));
        bLines.push('');
      }
    } catch { /* no previous briefing or parse error — skip */ }

    bLines.push('---');
    bLines.push('*NIGHTSHIFT ran: ' + bNow.toISOString() + ' | Next run: logon or Task Scheduler*');

    fs.writeFileSync('./' + 'MORNING_BRIEFING.md', bLines.join('\n'), 'utf8');
    logLine('BRIEFING: Written to D:\\Meta\\MORNING_BRIEFING.md (' + bLines.length + ' lines)');
    briefDb.close();
  } catch (e) {
    logLine('BRIEFING ERROR: ' + e.message);
  }

  try { db.close(); } catch(e) { /* already closed for Pass 7 */ }
}

if (require.main === module) {
  main().catch(console.error);
} else {
  // When required from a test harness, expose individual passes.
  module.exports = { pass15, pass16 };
}
