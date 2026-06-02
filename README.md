# NIGHTSHIFT

**13-pass autonomous memory maintenance daemon for AI cognitive systems.**

![Status](https://img.shields.io/badge/status-production-brightgreen)
![Runtime](https://img.shields.io/badge/runtime-~13_min-blue)
![License](https://img.shields.io/badge/license-MIT-green)

---

## The problem

AI memory systems degrade without maintenance. Observations accumulate noise. Edges between entities decay or become stale. Duplicate content inflates retrieval results. Fragmented entities split what should be unified. And without active synthesis, the system never forms higher-order connections from raw observations.

Most AI memory projects handle the write path (store memories) and the read path (retrieve memories). Almost none handle the maintenance path — what happens to memory *between* sessions.

## What NIGHTSHIFT does

A single Node.js script that runs 13 autonomous passes over a [brain.db](https://github.com/duke-of-beans/Brain.db) memory store, organized in three tiers:

### Core maintenance (Passes 1–6)

| Pass | Name | What it does |
|------|------|-------------|
| 1 | **Co-occurrence refresh** | Entities mentioned near each other in recent observations get relationship edges created or strengthened |
| 2 | **ACT-R decay + anti-Hebbian pruning** | Retrieval-weighted temporal decay. Edges between active-but-disconnected entities get penalized. Floor of 0.10 prevents total edge death. |
| 3 | **Arc synthesis** | Entities with enough observations get queued for narrative synthesis — compress raw observations into coherent summaries |
| 4 | **Observation lifecycle** | ACT-R-informed archival of decayed observations + SHA-256 dedup maintenance |
| 5 | **Entity fragmentation** | Detect duplicate or fragmented entities (same thing, different names) and flag for merge |
| 5B | **Code quality scan** | Eye of Sauron AST-level health check across active codebases |
| 6 | **Recall benchmark** | Run 50-query gold set across 4 domains (dev, research, personal, business). Alert on regression. |

### Data sync (Passes 7–9)

| Pass | Name | What it does |
|------|------|-------------|
| 7 | **LIFELOG sync** | Ingest life record observations |
| 8 | **Research sync** | Ingest external research context |
| 9 | **Backup sync** | Critical files to backup destination |

### Cognitive passes (Passes 10–13) — require Anthropic API

| Pass | Name | What it does |
|------|------|-------------|
| 10 | **Structural isomorphism** | Detect entities with similar structural roles across different domains. Create typed edges. "What else has this shape?" |
| 11 | **TREG epistemic maintenance** | Scan for contradictions, zombie assumptions, epistemic health scoring. Calibration against [15 reference cases](https://github.com/duke-of-beans/cognitive-stack/tree/main/calibration). |
| 12 | **LANTERN autonomous synthesis** | Random cross-entity association. Creative wandering. The [Signal Diversity](https://github.com/duke-of-beans/signal-diversity) engine applied to memory. |
| 13 | **PROMETHEUS self-improvement** | Capability gap analysis. Generate improvement proposals. Detect own limitations. |

## The math

### ACT-R decay (Pass 2)

```
B_i = ln(Σ t_j^(-d))    where d = 0.5
```

`B_i` is the base-level activation of observation `i`. `t_j` is the time since the `j`-th retrieval. Observations that are retrieved frequently and recently have high activation; those that aren't decay toward archival. The decay parameter `d = 0.5` was tuned for LLM observation stores — slower than the standard ACT-R `d = 0.5` because AI memory access patterns are burstier than human memory.

### Anti-Hebbian pruning (Pass 2)

Edges between entities that are both active but never co-retrieved get *weakened*. This prevents the graph from calcifying around historical connections that are no longer relevant. The floor of 0.10 ensures edges are never fully severed — a dormant connection can always be reactivated.

### SHA-256 dedup (Pass 4)

Content hashing with a 5-minute window: identical content within 5 minutes is deduplicated (same session noise). Identical content after 5 minutes is treated as a legitimate re-observation (different context).

## Measured results

| Metric | Value |
|--------|-------|
| Total runtime | ~13 minutes |
| Observations maintained | ~2,645 curated (post-purge from 78k noise) |
| Graph edges | 7,500+ |
| Recall@5 benchmark | 88.0% (50-query gold set) |
| Scheduling | Daily at logon via Task Scheduler |
| Embedding model | nomic-embed-text via Ollama (local, zero API cost) |

## Production status

In production since April 2026. Runs daily across a 38-project portfolio. The system's memory graph self-organizes overnight — you come back to a system that has synthesized, pruned, and cross-connected its own knowledge.

## Prior art

- **ACT-R** — Anderson (2007), base-level activation and decay
- **Anti-Hebbian learning** — Bhatt et al. (2020), competitive unlearning
- **Memory consolidation** — sleep-dependent memory processing (Diekelmann & Born 2010)
- **Graph maintenance** — entity resolution and graph quality (Getoor & Machanavajjhala 2012)

## Part of the cognitive stack

- [Brain.db](https://github.com/duke-of-beans/Brain.db) — the memory store NIGHTSHIFT maintains
- [KERNL](https://github.com/duke-of-beans/KERNL) — provides the MCP tools NIGHTSHIFT's cognitive passes use
- [Signal Diversity](https://github.com/duke-of-beans/signal-diversity) — Pass 12 implements the LANTERN novelty engine
- [Cognitive Stack](https://github.com/duke-of-beans/cognitive-stack) — the full 10-system architecture

---

*Built by [David Kirsch](https://github.com/duke-of-beans). MIT License.*
