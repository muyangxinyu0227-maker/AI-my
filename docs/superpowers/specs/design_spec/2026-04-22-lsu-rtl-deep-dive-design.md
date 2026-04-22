# LSU RTL Deep-Dive Design Documentation — Design Spec

**Date:** 2026-04-22
**Author:** Claude (via brainstorming session)
**Status:** Awaiting user review before implementation
**Target:** `perseus_loadstore` (ARM Neoverse N2-like LSU in PERSEUS-MP128-r0p3)
**Pilot scope:** `ls_tlb` + `ls_lrq` + shared primitive `ls_age_matrix` + L1 scaffold

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Scope & Non-scope](#2-scope--non-scope)
3. [Deliverables](#3-deliverables)
4. [Success Criteria](#4-success-criteria)
5. [Document Structure Standards](#5-document-structure-standards)
6. [Naming Conventions](#6-naming-conventions)
7. [RTL → Documentation Mapping Rules](#7-rtl--documentation-mapping-rules)
8. [Review Process (Gate-based)](#8-review-process-gate-based)
9. [Dependencies & Prerequisites](#9-dependencies--prerequisites)
10. [Risk Catalog](#10-risk-catalog)
11. [Post-Pilot Directions](#11-post-pilot-directions)

---

## 1. Project Overview

### 1.1 Goal

Build a **feature-first, hierarchy-driven, RTL-grounded** detailed design documentation set for `perseus_loadstore` (ARM Neoverse N2-like LSU). This document is the **brainstorming-output design spec** — it governs how the actual design documents will be produced. It does **not** contain the design documents themselves; it defines their structure, standards, and review process.

### 1.2 Positioning

- **Not** a refresh of the prior `LSU_Detailed_Design_Spec.docx` v1.0. That document is **discarded and not referenced**.
- **Not** a speculation or memory-based writeup of ARM architecture.
- **Is** a from-scratch documentation effort using RTL as the **sole source of truth**.
- **Is** an auditable, traceable, reproducible documentation pipeline.
- Pilot phase only: two L2 submodules (`ls_tlb`, `ls_lrq`) + one shared primitive (`ls_age_matrix`) + an L1 scaffold. The pilot exists to validate the process and establish a gold-standard template that subsequent ~20 L2 submodules can follow.

### 1.3 Out-of-Scope Activities

This project is documentation only. The following are explicitly NOT part of this effort:
- Testpoint generation (future work via `testpoint-gen` skill).
- UVM verification case development (future work via `verif-signoff-driver` skill).
- RTL bug finding / design review.
- Any non-pilot L2 submodule (`ls_agu`, `ls_fb`, `ls_sab`, `ls_sdb`, `ls_pf`, `ls_snoop`, `ls_rar`, `ls_raw`, `ls_l2if`, `ls_tag_data_arb`, `ls_ldpipe_ctl`, `ls_ctl`, `ls_atomic_alu`, `ls_rst`, `ls_flt_ctl`, `ls_spe`, `ls_wpt`, `ls_mpmm_ctl`, `ls_mb`, `ls_ld_align` …).

---

## 2. Scope & Non-scope

### 2.1 In Scope

| Item | Description |
|------|-------------|
| L1 scaffold | `perseus_loadstore` top-level: feature list + L2 submodule **directory with functional-implementation summary per L2 (2~4 sentences each)** + pipeline stages + shared primitives index |
| L2 `ls_tlb` | Full depth documentation (14 sections) |
| L2 `ls_lrq` | Full depth documentation (14 sections), including L3 `ls_lrq_entry` recursion |
| Shared primitive `ls_age_matrix` | Independent document (8 sections); referenced by `ls_lrq` (and later `ls_sab`, `ls_rar`) |
| Traceability matrix | L1 feature ↔ L2 feature ↔ L3 feature (100% of L1 features must either map to a scope-in L2 or be explicitly labeled "deferred") |
| L2 module template | Reusable standalone template file for future L2 expansion |

### 2.2 Out of Scope (Explicit Deferrals)

- All other L2 submodules (see §1.3 list above).
- Testpoint generation.
- UVM verification work.
- Design bug identification.
- SVG rendering of architecture diagrams (ASCII + WaveDrom is the default format).

### 2.3 Effort Granularity

- **No page or word count limits.** Documentation depth is determined by what the RTL actually warrants, not by an arbitrary target.
- **D2 depth** (block-level): every major `always` block and key `assign` group explained with purpose, inputs, outputs, and design rationale; FSM transitions fully enumerated; key circuits quoted with line-numbered RTL excerpts.

---

## 3. Deliverables

| ID | Path | Content | Format |
|----|------|---------|--------|
| **D1** | `docs/superpowers/specs/design_spec/2026-04-22-lsu-rtl-deep-dive-design.md` | This design spec | md |
| **D2** | `/Users/m/claude code/lsu_ut/design_docs/lsu_top_l1.md` | L1 scaffold: feature list + L2 directory with per-module functional summaries | md + docx |
| **D3** | `/Users/m/claude code/lsu_ut/design_docs/submodules/ls_tlb.md` | L2 `ls_tlb` complete document | md + docx |
| **D4** | `/Users/m/claude code/lsu_ut/design_docs/submodules/ls_lrq.md` | L2 `ls_lrq` complete document (includes L3 `ls_lrq_entry`) | md + docx |
| **D5** | `/Users/m/claude code/lsu_ut/design_docs/shared_primitives/ls_age_matrix.md` | Shared primitive `ls_age_matrix` document | md + docx |
| **D6** | `/Users/m/claude code/lsu_ut/design_docs/traceability.md` | L1↔L2↔L3 feature traceability matrix | md |
| **D7** | `/Users/m/claude code/lsu_ut/design_docs/TEMPLATE_L2_MODULE.md` | Standalone L2 module template for future expansion | md |

All md files are authored as primary source. All `.docx` are auto-generated from md via the conversion script (to be built as part of Gate 19). `md` file is the source of truth; regeneration of `.docx` should never require manual editing.

---

## 4. Success Criteria

### 4.1 Per-L2-Module Completion Criteria

A single L2 module document is considered complete when:

- [ ] Features table is exhaustive — covers all externally observable behavior in RTL.
- [ ] Every Feature ID is unique and follows naming convention (§6).
- [ ] Every feature cites at least one RTL location (file + line range).
- [ ] Every significant `always` block and critical `assign` group is explained.
- [ ] Every FSM has a complete state transition diagram (ASCII or equivalent).
- [ ] Every external interface port has width + role + source/sink module + active stage.
- [ ] Key circuits have RTL excerpts with line-numbered comments.
- [ ] Verification-focus table is present (seed for future testpoint-gen consumption).
- [ ] "Caller contract / pitfalls" section is present.
- [ ] Conversion to `.docx` produces no formatting breakage.

### 4.2 Pilot-Wide Completion Criteria

- [ ] Both L2 documents follow identical structure and terminology.
- [ ] Shared primitive is written once; both L2 documents link to it rather than duplicating content.
- [ ] Traceability matrix covers 100% of L1 features (mapped to scope-in L2 or explicitly deferred).
- [ ] `TEMPLATE_L2_MODULE.md` is usable stand-alone for future L2 documentation by someone who did not participate in the pilot.

---

## 5. Document Structure Standards

### 5.1 L2 Module Document: 14 Sections

| § | Section Title | Content Summary |
|---|---------------|-----------------|
| 1 | 模块定位 (Module Role) | One-sentence function + role within LSU + key parameters (`AM_SIZE`, FSM state count, etc.) |
| 2 | Features 列表 | `<MOD>-F<NN>` full feature table + RTL location citation + linkage to L1 features |
| 3 | 微架构抽象 (Microarchitecture Abstraction) | Textbook pattern used (CAM / MSHR / age matrix / NRU / RRIP / …) + why it was chosen + mathematical model if any |
| 4 | 整体框图 (Block Diagram) | ASCII or WaveDrom block diagram with data-flow layers |
| 5 | 接口列表 (Port List) | Input/output tables: width, role, source/sink module, active pipeline stage |
| 6 | 接口时序 (Interface Timing) | Waveforms for **important** timings only (criteria in R7 below); not every port needs a waveform |
| 7 | 时钟复位 (Clock/Reset) | Reset strategy, sync/async, row-level clock gating, XPROP semantics |
| 8 | 关键电路逐层解读 (Key Circuits, Layer by Layer) | RTL walked segment-by-segment. Each segment gives: **purpose + line-numbered code excerpt + sentence-by-sentence explanation + design rationale** |
| 9 | 状态机 (State Machines) | Full transition diagram for every FSM + trigger condition table + typical lifecycle waveform |
| 10 | 三级模块设计 (L3 Submodule Design) | If L3 submodules exist, each is recursively documented using the same template; shared primitives are linked, not duplicated |
| 11 | 调用者契约 (Caller Contract) | Input assumptions (e.g., age_matrix requires `src_older` vectors to be pairwise consistent), boundary conditions, undefined-behavior cases |
| 12 | 验证关注点 (Verification Focus Points) | Feature → testpoint seed table with `<MOD>-TP-<NN>` IDs (consumed later by testpoint-gen) |
| 13 | 设计陷阱与注记 (Design Pitfalls & Notes) | Easily-overlooked details, potential races, known limitations, relevant chicken bits |
| 14 | 参考资料 (References) | RTL files + ARM ARM sections (when applicable) + academic papers (e.g. RRIP) |

L3 module documents follow the same 14-section structure but may have thin §3 and §6.

### 5.2 Shared Primitive Document: 8 Sections

| § | Section Title | Note |
|---|---------------|------|
| 1 | 定位 (Positioning) | What primitive + which L2 modules use it |
| 2 | 数学模型 / 抽象 | Age matrix relation, RRIP re-reference interval, ECC code structure, etc. |
| 3 | 参数化 (Parameterization) | `AM_SIZE` / `NUM_ENTRIES` / `DATA_WIDTH` and derived dimensions |
| 4 | 端口与接口 | Port list |
| 5 | 关键电路 | Layered RTL walkthrough (same style as §5.1 §8) |
| 6 | 调用者契约 | Input consistency assumptions |
| 7 | 实例化清单 (Instantiation Catalog) | Each instance across LSU: parameter + consumer module + purpose (e.g. `age_matrix(16) → LRQ`, `age_matrix(24) → SAB`, `age_matrix(40) → RAR`) |
| 8 | 验证关注点 | Primitive-level testpoint seeds |

### 5.3 L1 Top-Level Scaffold: 9 Sections

| § | Section Title | Note |
|---|---------------|------|
| 1 | LSU 角色与架构背景 | LSU's position within CPU core; responsibilities toward upstream/downstream modules |
| 2 | L1 Features 列表 | `LSU-F<NN>` covering external capabilities (3 LS pipes / translation / cache / miss / store / barriers / atomics / snoop / prefetch / RAS / MTE / SVE / …) |
| 3 | 整体框图 | Top-level block diagram (L2 module level) |
| 4 | 流水线阶段 | Full pipeline view: i1/i2 → a1~a3 → d0~d5 → m1~m8 → w1~w3 → iz |
| 5 | L2 子模块目录 | Each L2 module: **2~4 sentence functional-implementation summary** + link to its standalone document. For pilot, deep docs exist only for `ls_tlb` and `ls_lrq`; others have summary only. |
| 6 | 共享原语清单 | All shared primitives listed with consumer L2 modules |
| 7 | 接口分组 | 12 external interface domains (is/ct/mm/l2/if/mx/dt/vx/tbe/spe/ras/misc) |
| 8 | 顶层时钟复位 | |
| 9 | 关键参数表 | All `PERSEUS_LS_*` constants → file + line + value |

---

## 6. Naming Conventions

### 6.1 Feature ID

- **Format:** `<MODULE-ABBREV>-F<NN>`
- **Examples:** `LSU-F01`, `LRQ-F03`, `TLB-F15`, `LRQENT-F02`, `AGEMTX-F05`
- **Numbering:** Two-digit (01~99); expand only if exceeded.
- **Levels:**
  - L1 top-level uses `LSU-F`.
  - L2 uses each module's abbreviation.
  - L3 uses its parent-derived abbreviation (e.g., `ls_lrq_entry` → `LRQENT`).
- **Stability:** Once assigned, a Feature ID never changes (ensures traceability stability).

### 6.2 Module Abbreviation Table

| Module | Abbreviation | Module | Abbreviation |
|--------|--------------|--------|--------------|
| `perseus_loadstore` (L1) | LSU | `ls_ldpipe_ctl` | LPC |
| `ls_agu` | AGU | `ls_tag_data_arb` | TDA |
| `ls_tlb` | TLB | `ls_l2if` | L2IF |
| `ls_lrq` | LRQ | `ls_pf` | PF |
| `ls_lrq_entry` | LRQENT | `ls_snoop` | SNP |
| `ls_sab` | SAB | `ls_rar` | RAR |
| `ls_sdb` | SDB | `ls_raw` | RAW |
| `ls_fb` | FB | `ls_wpt` | WPT |
| `ls_fb_entry` | FBENT | `ls_ctl` | LSCTL |
| `ls_age_matrix` | AGEMTX | `ls_rrip` | RRIP |
| `ls_atomic_alu` | AALU | `ls_ecc` | ECC |

### 6.3 Testpoint ID

- **Format:** `<MODULE-ABBREV>-TP-<NN>`
- **Example:** `LRQ-TP-04`
- Testpoint IDs may cross-reference Feature IDs but are not required 1:1.

### 6.4 Section Numbering

- In markdown, use native headings (`##`, `###`) without manual numbering.
- Section numbers (1.1, 1.1.1) are generated automatically during the `.docx` conversion.

---

## 7. RTL → Documentation Mapping Rules

These rules govern how RTL content is extracted into documentation. They are the quality guardrails for the pilot.

### R1 — Features come from RTL, not speculation

- Every feature entry in a module's §2 Features list must cite at least one RTL location (file + line range) where it is directly implemented.
- "Directly implemented" means: a named FSM state, a dedicated `always` block, a key `assign` group, a submodule instantiation, or an external interface signal group.
- Features that cannot be located in RTL are not features of this module (they may be external interface contracts documented elsewhere).

### R2 — RTL excerpt rules

- For each L2 module, all key `always` blocks must be quoted in full (no branch omission).
- Excerpts longer than ~30 lines may be abbreviated with `...` while preserving the critical skeleton.
- Every excerpt must start with a comment header `// file:line-line` identifying its origin.

### R3 — Line citation format

- **Single contiguous range:** `perseus_ls_lrq.sv:L412-L580`
- **Single file, multiple points:** `perseus_ls_lrq.sv:L412,L435,L580`
- **Cross-file:** `perseus_ls_lrq_entry.sv:L100-L200, perseus_ls_lrq.sv:L300-L310`

### R4 — Abstraction layering

Every key circuit section must answer three questions:

1. **What** — functional semantics, one sentence.
2. **How** — layered / step-by-step description.
3. **Why** — design choice rationale, comparing alternatives where insightful.

### R5 — Flag uncertainty explicitly

- If a piece of RTL is ambiguous or requires inference, mark it `(UNVERIFIED: <reason>)`. Never bluff.
- When citing ARM ARM, always include section number (e.g., `ARM ARM DDI0487L_b §D8.2.3`); never fabricate citations.

### R6 — Shared primitive reference

- When an L2 module references a shared primitive (e.g., `ls_age_matrix`), its L2 doc only describes: this instance's parameters + this usage context. Mathematical model and internal implementation are linked to the shared primitive doc.
- It is forbidden to copy-paste shared primitive content into L2 docs.

### R7 — Waveforms for important timings

- A timing is "important" if it meets at least one of the following:
  1. Involves cross-cycle handshake (req → resp).
  2. Involves FSM multi-state transitions.
  3. Involves multi-source concurrent arbitration.
  4. Involves exception paths (flush / abort / restart).
- Important timings **must** have a waveform; trivial single-signal single-cycle relationships do not.
- **Default format:** ASCII waveform using `_` / `‾` / `|` / `X` notation with column-aligned cycle labels.
- **Optional format:** WaveDrom JSON for complex scenarios (embedded as JSON block in md; rendered to SVG during docx conversion).
- Every waveform must be accompanied by a per-cycle textual walkthrough and use signal names identical to §5 port table.
- **No quota:** the number of waveforms is whatever the RTL genuinely warrants — no minimum, no maximum.
- If a waveform depicts behavior inferred from RTL without simulation validation, mark it `(UNVERIFIED: inferred from RTL)`.

---

## 8. Review Process (Gate-based)

Sequential chapter-level review (Approach A). Each gate pauses for user review before proceeding.

### 8.1 Gate List

| Gate | Content |
|------|---------|
| **Gate 0** | This design spec, user review |
| **Gate 1** | `lsu_top_l1.md` §1-9 (L1 scaffold, full) |
| **Gate 2** | `TEMPLATE_L2_MODULE.md` finalization (D7) |
| **Gate 3** | `ls_age_matrix.md` §1-3 (positioning + abstraction + parameterization) |
| **Gate 4** | `ls_age_matrix.md` §4-6 (interface + circuits + caller contract) |
| **Gate 5** | `ls_age_matrix.md` §7-8 (instantiation catalog + verification focus) — shared primitive finalized as L3 template |
| **Gate 6** | `ls_tlb.md` §1-2 (positioning + Features) — **critical gate**: Feature list drives everything downstream |
| **Gate 7** | `ls_tlb.md` §3-4 (microarchitecture abstraction + block diagram) |
| **Gate 8** | `ls_tlb.md` §5-6 (ports + timing waveforms) |
| **Gate 9** | `ls_tlb.md` §7-9 (clock/reset + key circuits + FSMs) |
| **Gate 10** | `ls_tlb.md` §10-14 (L3 + contract + verification + pitfalls + references) |
| **Gate 11** | `ls_lrq.md` §1-2 — **critical gate** |
| **Gate 12** | `ls_lrq.md` §3-4 |
| **Gate 13** | `ls_lrq.md` §5-6 |
| **Gate 14** | `ls_lrq.md` §7-8 (§8 may internally subdivide across layers) |
| **Gate 15** | `ls_lrq.md` §9 (FSM detail; LRQ 10-state FSM may warrant its own gate) |
| **Gate 16** | `ls_lrq.md` §10 (L3 `ls_lrq_entry` recursive expansion) |
| **Gate 17** | `ls_lrq.md` §11-14 |
| **Gate 18** | `traceability.md` finalization (D6) |
| **Gate 19** | md → docx conversion verification across all four documents |
| **Gate 20** | Pilot overall acceptance |

### 8.2 Per-Gate Protocol

For each gate, the workflow is:

1. Fetch relevant RTL over SSH into working context.
2. Write the md chapter content.
3. Self-check against rules R1-R7.
4. Commit the updated file to git.
5. Post a brief summary: "what I wrote / judgments I made / uncertainties I flagged".
6. Wait for user review. Possible outcomes: `approve` / `edit here` / `rewrite this block` / `discard and restart chapter`.

### 8.3 Rework Budget

- Max 1 rework cycle per gate. If a second rework is needed, escalate to a higher-level discussion rather than grinding in place.
- Before starting each gate, pre-announce "in this gate I plan to write §X-Y" — so direction errors are caught before the writing happens.

### 8.4 Effort Estimate (conversational turns)

| Phase | Gate Range | Avg turns per gate | Cumulative turns |
|-------|-----------|---------------------|------------------|
| L1 scaffold + template | 1–2 | 2 | 4 |
| Shared primitive `age_matrix` | 3–5 | 2 | 10 |
| `ls_tlb` | 6–10 | 3 | 25 |
| `ls_lrq` | 11–17 | 3 | 46 |
| Traceability + conversion + acceptance | 18–20 | 2 | 52 |

**Pilot total estimate: ~50 turns.** Imprecise; depends on review feedback volume.

---

## 9. Dependencies & Prerequisites

| Dependency | Status | Notes |
|------------|--------|-------|
| SSH `192.168.20.6 -l xy.mu` | ✅ verified | Multiple uses this session |
| RTL path `/home/xy.mu/N2/…/perseus_loadstore/verilog/` | ✅ verified | |
| Local path `/Users/m/claude code/lsu_ut/` writable | ✅ verified | |
| `docs/superpowers/specs/design_spec/` directory | ✅ created | This spec's location |
| `node` + `docx` npm module | ✅ installed | |
| md → docx conversion tool | ❓ to-plan | Likely a docx-js script (pandoc not available locally) — resolved at Gate 19 |
| git repo initialization | ❓ to-confirm | Need to verify `/Users/m/claude code/lsu_ut/` under git |
| ARM ARM DDI0487L_b reference | ✅ web-accessible | Used via WebFetch on demand; no local copy required |

---

## 10. Risk Catalog

| # | Risk | Impact | Mitigation |
|---|------|--------|------------|
| R-01 | Pilot pair doesn't exercise all LSU module patterns; template needs changes when scaled | Med | Gate 2 template deliberation covers four archetypes: CAM-heavy (`ls_tlb`) / FSM-heavy (`ls_lrq`) / pipeline-heavy / control-heavy. Later expansion may iterate template. |
| R-02 | Claude misinterprets ARM LSU microarchitecture → writes technical errors | High | R5 mandates `UNVERIFIED`; every non-trivial inference must cite RTL; Gate review is last line of defense. |
| R-03 | Missed RTL segments (missing features / always blocks) | Med | Gate 1-2 feature-list review is early defense; §8 key-circuit walkthrough is second scan. |
| R-04 | Chapter scope creep (a gate oversteps boundaries) | Low | Each gate pre-declares "this gate writes §X-Y"; on overrun, stop and ask. |
| R-05 | md → docx format degradation (tables / waveforms / code blocks) | Med | Gate 19 dedicated verification; fall back to custom docx-js if pandoc unavailable. |
| R-06 | `ls_age_matrix` as first primitive sample too idiosyncratic vs future `ls_rrip` / `ls_ecc_*` | Low | Template acknowledges shared primitives may deviate; ultimate reference is `shared_primitives/` directory. |
| R-07 | Context window overflow; LRQ 1.9MB RTL + conversation history grows large | Med-High | End-of-gate summaries; RTL is loaded per-section, not persisted; subagent dispatch for RTL reading when scale demands. |
| R-08 | Feature count exceeds estimation (e.g., LRQ has 30+ features) | Low | Accept reality, add more gates. No word limit. |
| R-09 | "Start from scratch vs old docx baseline" tension | Resolved | Old docx is discarded; start fresh from RTL. |
| R-10 | Date-sensitive paths | Low | Only this spec is date-stamped; other deliverables use static paths. |

---

## 11. Post-Pilot Directions

After pilot acceptance, optional downstream paths (not committed in this spec; knowing preferences helps micro-tune pilot form):

- **Path α:** Batch-expand remaining ~18 L2 submodules using the validated template. Estimated hundreds of turns.
- **Path β:** Feed pilot output into `testpoint-gen` skill to produce testpoint xlsx.
- **Path γ:** Feed pilot output into existing UVM env to upgrade RM precision.
- **Path δ:** Abstract the pilot process into a new skill (similar to `uvm-env-gen`) for reuse on other LSU-scale modules.

---

## 12. Appendix: Definitions

- **L1 / L2 / L3**: Module hierarchy level. L1 = LSU top (`perseus_loadstore`). L2 = major submodules (`ls_tlb`, `ls_lrq`, …). L3 = submodules within L2 (`ls_lrq_entry`) or shared primitives (`ls_age_matrix`, `ls_rrip`).
- **D2 depth**: Block-level documentation (every significant `always` / `assign` group explained). Contrast with D1 (structural-only) and D3 (signal-level, rejected as overkill for verification purposes).
- **Gate**: A review checkpoint in Approach A sequential workflow. Each gate covers 1-5 md sections and pauses for user approval.
- **RTL location citation**: File-path + line-range reference (e.g., `perseus_ls_lrq.sv:L412-L580`) enabling any claim to be traced back to source.
- **Feature**: An externally observable behavior of a module, identifiable in RTL, uniquely named with `<MOD>-F<NN>` ID, stable across document revisions.

---

*End of Design Spec.*
