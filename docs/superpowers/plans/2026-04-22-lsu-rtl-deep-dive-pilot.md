# LSU RTL Deep-Dive Documentation — Pilot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce verification-grade detailed design documentation for the `perseus_loadstore` LSU pilot (`ls_tlb` + `ls_lrq` + shared primitive `ls_age_matrix` + L1 scaffold + reusable L2 template), built from RTL as the sole source of truth, with gate-based review checkpoints.

**Architecture:** Gate-based sequential workflow (21 tasks mapping to spec §8 20 gates + setup). Each task produces specific markdown chapters, self-checks against rules R1-R7 (from spec §7), commits to git, pushes to GitHub, and pauses for user review before the next task. All RTL access is via SSH to the remote server (`192.168.20.6`) — the RTL is never copied locally. Markdown is the single authoring format; `.docx` is auto-generated at the end.

**Tech Stack:**
- SSH + shell for remote RTL access
- Markdown for authoring (native `##`/`###` headings; no manual numbering)
- `docx-js` (npm, already installed globally) for md → docx conversion at Gate 19
- Git for version control, GitHub remote `git@github.com:muyangxinyu0227-maker/AI-my.git` on branch `main`
- ASCII waveforms as default; WaveDrom JSON optional for complex timings

**Spec reference:** `/Users/m/claude code/lsu_ut/docs/superpowers/specs/design_spec/2026-04-22-lsu-rtl-deep-dive-design.md` — all 14-section L2 templates, 8-section primitive templates, 9-section L1 templates, naming conventions, and rules R1-R7 are defined there. Tasks below reference spec sections rather than repeat them.

---

## File Structure

Files to be created across all tasks:

```
/Users/m/claude code/lsu_ut/
├── .gitignore                                                  [exists]
├── docs/superpowers/
│   ├── specs/design_spec/
│   │   └── 2026-04-22-lsu-rtl-deep-dive-design.md             [exists, the spec]
│   └── plans/
│       └── 2026-04-22-lsu-rtl-deep-dive-pilot.md              [this file]
└── design_docs/
    ├── lsu_top_l1.md                                           [Task 2 = Gate 1]
    ├── TEMPLATE_L2_MODULE.md                                   [Task 3 = Gate 2]
    ├── shared_primitives/
    │   └── ls_age_matrix.md                                    [Tasks 4-6 = Gates 3-5]
    ├── submodules/
    │   ├── ls_tlb.md                                           [Tasks 7-11 = Gates 6-10]
    │   └── ls_lrq.md                                           [Tasks 12-18 = Gates 11-17]
    ├── traceability.md                                         [Task 19 = Gate 18]
    └── tools/
        └── md2docx.js                                          [Task 1 setup; used at Task 20 = Gate 19]
```

**Responsibility per file:**

| File | Owner | Responsibility |
|------|-------|----------------|
| `lsu_top_l1.md` | L1 scaffold | LSU top-level feature list (F IDs = `LSU-F<NN>`), L2 module directory with 2-4 sentence functional summaries per L2, pipeline stage map, shared primitive index, external interface group list, top-level clock/reset, key parameter table |
| `TEMPLATE_L2_MODULE.md` | Template | Reusable 14-section skeleton for any future L2 documentation, with instructional comments |
| `ls_age_matrix.md` | Shared primitive doc | 8 sections covering age-matrix pattern, parameterization, instantiation catalog (LRQ/SAB/RAR), and verification focus points |
| `ls_tlb.md` | L2 module | 14 sections covering 44-entry CAM uTLB, VMSA features, RRIP replacement, multi-hit detect, MMU interface handshake |
| `ls_lrq.md` | L2 module | 14 sections covering 16-entry load request queue with 10-state FSM, plus recursive L3 section for `ls_lrq_entry` |
| `traceability.md` | Traceability | Matrix linking L1 features to L2 feature IDs (for pilot scope) or "deferred" marker |
| `md2docx.js` | Conversion tool | docx-js based converter producing `.docx` from each md |

---

## Common Rituals (referenced by tasks below)

### Ritual 0: Context Budget Check (MUST run before every Task's Step 1)

Before starting any Task, compute the estimated context cost and decide execution mode. This prevents mid-Task context exhaustion, especially important when scaling this workflow to 20+ future L2 modules (some trivial, some heavy).

**Formula:**

```
task_tokens ≈ RTL_lines_to_read × 15
             + md_output_lines × 20
             + 12K    (fixed: pre-announce + self-check + commit + gate report + ritual refs)
```

Constants chosen empirically: SV code ≈ 15 tok/line, mixed CN/EN md ≈ 20 tok/line, 12K fixed for Ritual B/C/D overhead.

**Mode decision (single threshold = 100K):**

- `task_tokens < 100K` → **Inline** (execute in main session)
- `task_tokens ≥ 100K` → **Subagent** (dispatch via Agent tool — see Subagent Dispatch Spec below)

**Main session budget tracking (simple approach):**

Maintain a running coarse estimate throughout the session:

```
session_tokens ≈ conversation_turns × 5K
               + cumulative_written_md_lines × 20
               + cumulative_RTL_lines_read × 15
               + 45K baseline (system reminders + skills listing + spec + plan persistent)
```

**Note:** Trial run confirmed subagents start at ~45-55K due to system-reminder + skills-listing overhead (not 30K). Update baseline accordingly.

Check at the start of every Task. **When `session_tokens / 200K ≥ 95%`** (i.e. ≥ 190K), pause and prompt the user:

> "Main session at ~N% context usage (≈ NNNK / 200K). Options:
>  (a) continue anyway (risk running out mid-Task)
>  (b) start fresh session — I'll re-read spec + plan paths
>  (c) compact conversation — summarize old turns into a brief and discard"

Do NOT proceed to the Task's Step 1 without a user response at the 95% mark.

**Subagent Dispatch Spec (when Ritual 0 selects Subagent mode):**

Use the Agent tool with:
- `description`: `"Task <N>: <short title>"` (e.g. `"Task 15: ls_lrq §7-8 clock/reset + key circuits"`)
- `subagent_type`: `"general-purpose"`
- `prompt`: self-contained, must include:
  1. Path to plan file: `/Users/m/claude code/lsu_ut/docs/superpowers/plans/2026-04-22-lsu-rtl-deep-dive-pilot.md` — with exact Task <N> number the subagent should execute
  2. Path to spec file: `/Users/m/claude code/lsu_ut/docs/superpowers/specs/design_spec/2026-04-22-lsu-rtl-deep-dive-design.md` — source of rules R1-R7
  3. Exact md file path to create or modify
  4. SSH command template: `ssh -o ConnectTimeout=10 192.168.20.6 -l xy.mu "<cmd>"` for all RTL reads (ConnectTimeout prevents 75-second default TCP hang on network outage)
  5. If writing an L2 module: the 14-section structure from spec §5.1
  6. Instruction to return ONLY: {final md file path, summary of key judgments made, consolidated UNVERIFIED flags introduced, Ritual D gate report text}
  7. Subagent must NOT invoke `writing-plans`, `brainstorming`, or any other skill — it only executes the one Task given

Per-task **Step 1 always begins with Ritual 0** before any other action (estimation + mode selection + main-session-budget check).

### Ritual A: Read RTL over SSH

```bash
ssh -o ConnectTimeout=10 192.168.20.6 -l xy.mu "cat -n /home/xy.mu/N2/MP128-r0p3-00rel0-2/MP128-BU-50000-r0p3-00rel0/perseus/logical/perseus_loadstore/verilog/<FILE>.sv"
```

Always use `cat -n` so line numbers are visible for citation (spec R3). Always include `-o ConnectTimeout=10` to fail fast on network outage (default TCP timeout is 75 seconds — wasteful on retries).

For large files (`ls_lrq.sv` is 1.9MB), use line-range reads:
```bash
ssh -o ConnectTimeout=10 192.168.20.6 -l xy.mu "sed -n '<START>,<END>p' /home/xy.mu/.../<FILE>.sv | cat -n"
```

**SSH prerequisite:** The remote `192.168.20.6` is on a private network; user may need to be on VPN. If SSH fails with "Operation timed out", stop and report to user — do not retry more than once.

### Ritual B: Self-check md content against spec rules R1-R7

For each md section written, answer YES/NO:

- **R1** — Every feature in §2 cites at least one `file:L<start>-L<end>`? (If no: fix)
- **R2** — Every key `always` block quoted in full with `// file:L-L` header? (If no: fix)
- **R3** — Line citations formatted as `perseus_ls_xxx.sv:L412-L580`? (If no: fix)
- **R4** — Each key-circuit subsection answers What / How / Why? (If no: fix)
- **R5** — Any uncertain claim marked `(UNVERIFIED: <reason>)`? (If no and you inferred: fix)
- **R6** — If referencing a shared primitive, description is linked not duplicated? (If no: fix)
- **R7** — Each "important timing" (cross-cycle handshake / FSM multi-state / multi-source concurrent / exception path) has a waveform? (If no: add waveform)

### Ritual C: Commit + push

```bash
cd "/Users/m/claude code/lsu_ut"
git add <files>
git commit -m "<prefix>: <subject line>

<optional body>"
git push origin main
```

Commit prefix convention:
- `docs(l1):` for L1 scaffold changes
- `docs(template):` for template changes
- `docs(primitive):` for shared primitive changes
- `docs(tlb):` / `docs(lrq):` for L2 module changes
- `docs(trace):` for traceability matrix
- `feat(tools):` for conversion scripts
- `build:` for infrastructure

### Ritual D: Gate report to user

After committing, post a message with:
1. What sections were written in this gate
2. Key judgments made (e.g. "I classified `ls_lrq_entry` as L3 per spec §5.1 §10")
3. Any `(UNVERIFIED: ...)` flags introduced
4. RTL files and line ranges consulted
5. "Awaiting approval to proceed to Gate <N+1>"

### Ritual E: Failure Protocol

When a Step fails unexpectedly (SSH timeout, missing tool, command error, etc.):

1. **Do NOT self-troubleshoot more than once.** Run the failing command once with a diagnostic variant (e.g. add `-v` or `ConnectTimeout`) and if that also fails, stop.

2. **Check Step independence:** Is the failing Step a dependency of the remaining Steps in this Task?
   - **Yes (dependency)**: stop immediately, mark remaining Steps SKIPPED, report.
     Example: Step 2 (SSH verify) fails → Task 2+ depend on SSH reads, so stop.
   - **No (independent)**: complete the remaining independent Steps, then report all results.
     Example: Ritual A SSH test fails but Step N (purely local git commit) doesn't depend on it → run Step N.

3. **Report in gate report:** Include under "发现的问题" the failure details, command output, and reasoning for what was/wasn't completed.

4. **Never fabricate completion.** If a Step was SKIPPED because of upstream failure, say so explicitly — don't pretend the outputs exist.

---

## Task 1: Infrastructure Setup

**Goal:** Prepare directory structure, install any missing dependencies, verify toolchain.

**Files:**
- Create: `/Users/m/claude code/lsu_ut/design_docs/` (directory)
- Create: `/Users/m/claude code/lsu_ut/design_docs/shared_primitives/` (directory)
- Create: `/Users/m/claude code/lsu_ut/design_docs/submodules/` (directory)
- Create: `/Users/m/claude code/lsu_ut/design_docs/tools/` (directory)

- [ ] **Step 1: Create directory tree**

```bash
cd "/Users/m/claude code/lsu_ut"
mkdir -p design_docs/shared_primitives design_docs/submodules design_docs/tools
ls -la design_docs/
```

Expected output: three subdirectories exist (`shared_primitives`, `submodules`, `tools`).

- [ ] **Step 2: Verify SSH access to remote RTL**

```bash
ssh -o ConnectTimeout=10 192.168.20.6 -l xy.mu "head -5 /home/xy.mu/N2/MP128-r0p3-00rel0-2/MP128-BU-50000-r0p3-00rel0/perseus/logical/perseus_loadstore/verilog/perseus_loadstore.sv"
```

Expected: first 5 lines of the top-level LSU RTL print (ARM copyright header).
If this fails (likely "Operation timed out"): apply **Ritual E Failure Protocol** — do not retry more than once, but note that Step 5 (local git commit) does NOT depend on SSH, so complete it before reporting. User may need to connect VPN to reach `192.168.20.6`.

- [ ] **Step 3: Verify docx npm module available**

```bash
NODE_PATH=/Users/m/work/nodejs/node-v24.14.1-darwin-arm64/lib/node_modules node -e "require('docx'); console.log('docx OK')"
```

Expected output: `docx OK`
If failure: `npm install -g docx` then retry.

- [ ] **Step 4: Verify git remote is reachable**

```bash
cd "/Users/m/claude code/lsu_ut"
git remote -v
ssh -T git@github.com 2>&1 | head -3
```

Expected:
- Two `origin` lines with `git@github.com:muyangxinyu0227-maker/AI-my.git`
- `Hi muyangxinyu0227-maker! You've successfully authenticated, but GitHub does not provide shell access.`

- [ ] **Step 5: Commit the directory skeleton**

```bash
cd "/Users/m/claude code/lsu_ut"
# Create .gitkeep so empty dirs can be tracked
touch design_docs/.gitkeep design_docs/shared_primitives/.gitkeep design_docs/submodules/.gitkeep design_docs/tools/.gitkeep
git add design_docs/
git commit -m "build: scaffold design_docs/ directory tree for LSU pilot"
git push origin main
```

Expected: commit created, push succeeds.

- [ ] **Step 6: Gate report**

Post to user:
> "Task 1 complete — infrastructure scaffolding. SSH, docx, git all verified. Proceeding to Task 2 (Gate 1 L1 scaffold)."

No user approval required for Task 1 (pure infrastructure).

---

## Task 2 (Gate 1): Write L1 Scaffold `lsu_top_l1.md`

**Goal:** Produce the L1 scaffold document covering all 9 sections from spec §5.3.

**Files:**
- Create: `/Users/m/claude code/lsu_ut/design_docs/lsu_top_l1.md`
- Read (RTL): `perseus_loadstore.sv`, `perseus_ls_defines.sv`, `perseus_ls_params.sv`, `perseus_lsl2_defines.sv`

- [ ] **Step 1: Pre-announce scope**

Tell user: "Gate 1 will write `lsu_top_l1.md` §1-9 in full, not deep into any L2 module — each L2 gets a 2-4 sentence summary only."

- [ ] **Step 2: Read top-level RTL header and module declaration**

```bash
ssh 192.168.20.6 -l xy.mu "sed -n '1,50p' /home/xy.mu/N2/MP128-r0p3-00rel0-2/MP128-BU-50000-r0p3-00rel0/perseus/logical/perseus_loadstore/verilog/perseus_loadstore.sv | cat -n"
```

Note: copyright header, parameters, module signature.

- [ ] **Step 3: Enumerate all 80+ submodule SV files**

```bash
ssh 192.168.20.6 -l xy.mu "ls -la /home/xy.mu/N2/MP128-r0p3-00rel0-2/MP128-BU-50000-r0p3-00rel0/perseus/logical/perseus_loadstore/verilog/ | awk '{print \$NF}' | grep -E '\.sv\$'"
```

Expected: list of all `perseus_ls_*.sv` files. Save this list (it feeds §5 L2 directory).

- [ ] **Step 4: Extract all `PERSEUS_LS_*` macros for §9 key parameter table**

```bash
ssh 192.168.20.6 -l xy.mu "grep -n '^\`define PERSEUS_LS_' /home/xy.mu/N2/MP128-r0p3-00rel0-2/MP128-BU-50000-r0p3-00rel0/perseus/logical/perseus_loadstore/verilog/perseus_ls_defines.sv | head -80"
```

For each: record `file:line`, macro name, value.

- [ ] **Step 5: Read the 12 external interface groups from port declaration**

Port groups already known from session: is/l2/ct/mm/vx/mx/if/misc/dt/tbe/spe/ras. For each group, note direction mix (in/out counts).

- [ ] **Step 6: Identify pipeline stage markers in RTL**

```bash
ssh 192.168.20.6 -l xy.mu "grep -oE '_(i1|i2|a1|a2|a3|d0|d1|d2|d3|d4|d5|m1|m2|m3|m4|m5|m6|m7|m8|w1|w2|w3|iz)(_q)?\\b' /home/xy.mu/N2/MP128-r0p3-00rel0-2/MP128-BU-50000-r0p3-00rel0/perseus/logical/perseus_loadstore/verilog/perseus_loadstore.sv | sort -u | head -30"
```

Use this to validate §4 pipeline stage description — only claim stages that appear as RTL suffixes.

- [ ] **Step 7: Write `lsu_top_l1.md` §1 — LSU 角色与架构背景**

Include:
- One-sentence LSU role in CPU core
- Relationships to upstream (issue/MX/VX) and downstream (MMU/L2/IF) modules
- Which ARMv9 architecture features LSU owns (translation + cache + ordering + atomics + MTE + SVE load/store path + RAS)

File path citations required (e.g. `perseus_loadstore.sv:L1-L54` for module header).

- [ ] **Step 8: Write §2 — L1 Features 列表**

Table columns: `LSU-F<NN>` | Feature | RTL承载位置 | 说明

Features must come from RTL-observable ports/submodule instantiations. Examples:
- `LSU-F01` — 3 LS pipelines (ls0 LD/ST + ls1 LD/ST + ls2 LD) — `perseus_loadstore.sv:<port-list-lines>`
- `LSU-F02` — VA→PA translation via uTLB + MMU interface — submodule inst `u_tlb` + ports `ls_mm_tlb_miss_*`
- …continue through all externally observable capabilities

Rule R1 applies: every feature cites RTL. No feature without a citation.

- [ ] **Step 9: Write §3 — 整体框图**

ASCII block diagram showing L2 modules and their connections. Base it on the 14-L2 list from spec §5.1 and the port groups from §2.

- [ ] **Step 10: Write §4 — 流水线阶段**

Based on RTL suffix evidence from Step 6. For each stage (i1/i2/a1/a2/a3/d0..d5/m1..m8/w1..w3/iz):
- Name
- Primary function at this stage
- Which L2 modules operate here
- Example signal bearing this stage suffix

- [ ] **Step 11: Write §5 — L2 子模块目录** (most substantial section)

For each L2 submodule file (`perseus_ls_*.sv`), write a 2-4 sentence functional-implementation summary. **This is not a name list** (per user requirement) — each entry must summarize what the RTL actually implements.

Example:
> ### ls_agu — Address Generation Unit
> Generates 48-bit VAs for three parallel LS pipelines (ls0/ls1/ls2) by adding src_a (base) to shifted/extended src_b (offset) at stage a1. Implements six external injection sources (SPE/TBE/PF/Snoop/Late-resolve/Reserved) through a round-robin arbiter that can inject a bubble on any pipe. Also owns the global `precommit_uid_q` retirement pointer consumed by LRQ/SAB/RAR/TLB.
> **RTL:** `perseus_ls_agu.sv` (561 KB)
> **Pilot status:** deferred

For pilot modules (`ls_tlb`, `ls_lrq`), the summary should end with "**Pilot status:** documented in `design_docs/submodules/<name>.md`".

- [ ] **Step 12: Write §6 — 共享原语清单**

Table: primitive name | type | used by L2 modules | RTL file

Pilot includes `ls_age_matrix` (used by LRQ/SAB/RAR). Mention that additional primitives (`ls_rrip`, `ls_ecc_*`, `ls_dff*`) exist and are deferred.

- [ ] **Step 13: Write §7 — 接口分组**

Use already-known 12 groups. For each:
- Group name + connected external module
- Input/output port count
- Brief role description

- [ ] **Step 14: Write §8 — 顶层时钟复位**

Three signals: `clk`, `reset_i`, `poreset`. Describe activation (active-high async reset per RTL).

- [ ] **Step 15: Write §9 — 关键参数表**

Columns: Macro | 值 | 文件 | 行号 | 说明. Source from Step 4.

- [ ] **Step 16: Self-check rituals**

Apply Ritual B (R1-R7) to the completed `lsu_top_l1.md`. Fix any rule violations inline.

- [ ] **Step 17: Commit + push**

```bash
cd "/Users/m/claude code/lsu_ut"
git add design_docs/lsu_top_l1.md
git commit -m "docs(l1): add LSU L1 scaffold with feature list and L2 directory

- §1-9 of L1 scaffold per spec §5.3
- L1 features LSU-F01 .. LSU-F<N> with RTL citations
- L2 directory entries with 2-4 sentence functional summaries (per spec §2.1)
- Defers deep L2 content; only ls_tlb and ls_lrq are pilot-scoped"
git push origin main
```

- [ ] **Step 18: Gate 1 report to user**

Post Ritual D message including:
- Path: `design_docs/lsu_top_l1.md`
- Feature count
- Any UNVERIFIED flags
- GitHub URL of the new file
- "Awaiting Gate 1 approval before proceeding to Gate 2 (template)."

**Stop here.** Do NOT start Task 3 until user approves.

---

## Task 3 (Gate 2): Write L2 Module Template `TEMPLATE_L2_MODULE.md`

**Goal:** Produce the reusable 14-section L2 skeleton (per spec §5.1) so that any future L2 can be filled in consistently.

**Files:**
- Create: `/Users/m/claude code/lsu_ut/design_docs/TEMPLATE_L2_MODULE.md`

- [ ] **Step 1: Pre-announce scope**

Tell user: "Gate 2 writes the empty skeleton template. No new RTL read — this is pure structure definition."

- [ ] **Step 2: Write the template skeleton**

Write all 14 section headings with:
- Empty tables with column headers but no data
- `<!-- FILL-IN: ... -->` HTML comments describing what goes in each section
- Pre-filled example entries in Italic for clarity (`*Example: `TLB-F01` — 44-entry CAM lookup at a1 — `perseus_ls_tlb.sv:L200-L450`*`)
- References to spec rules R1-R7 where relevant

Content of the file (to write exactly):

```markdown
# [L2 Module Name] Detailed Design

> **Template usage:** Clone this file into `design_docs/submodules/<module>.md`, replace `[L2 Module Name]` and all `<!-- FILL-IN: ... -->` comments, remove example italic lines once real content is in.
>
> **Author must satisfy rules R1-R7 from spec `docs/superpowers/specs/design_spec/2026-04-22-lsu-rtl-deep-dive-design.md` §7.**

## 1. 模块定位

<!-- FILL-IN: One sentence functional role + position in LSU + key parameters (FSM state count, queue depth, etc.) -->

*Example: perseus_ls_xxx is the NN-entry [structure type] providing [role]; it sits at pipeline stage [stage] and interacts with [neighbors]. Parameters: `ENTRY_NUM=NN`, FSM states=M.*

## 2. Features 列表

<!-- FILL-IN: Full table. Every row must cite RTL per rule R1. -->

| ID | Feature | RTL 承载位置 | 关联 L1 Feature |
|----|---------|--------------|-----------------|
| `<ABBREV>-F01` | *e.g. 44-entry CAM lookup* | *`perseus_ls_xxx.sv:L200-L450`* | *`LSU-F02`* |
| `<ABBREV>-F02` | | | |

## 3. 微架构抽象

<!-- FILL-IN: What textbook pattern (CAM / MSHR / age matrix / NRU / RRIP / FIFO / ...) + why chosen + mathematical model if applicable. Rule R4: answer What/How/Why. -->

## 4. 整体框图

<!-- FILL-IN: ASCII or WaveDrom block diagram with data-flow layers. -->

```
Example ASCII:
      input_X  ──┐
                 ▼
         ┌──────────────┐
         │   Core Logic  │
         └──────────────┘
                 │
                 ▼
         output_Y
```

## 5. 接口列表

### 5.1 输入端口

| 信号 | 位宽 | 源模块 | 活跃阶段 | 作用 |
|------|------|--------|---------|------|
| | | | | |

### 5.2 输出端口

| 信号 | 位宽 | 目的模块 | 活跃阶段 | 作用 |
|------|------|---------|---------|------|
| | | | | |

## 6. 接口时序

<!-- FILL-IN: Waveforms for important timings only (rule R7). Important = cross-cycle handshake / FSM multi-state / multi-source concurrent / exception path. No quota; skip trivial timings. Each waveform requires per-cycle textual walkthrough. -->

### 6.1 Waveform: [场景名]

```
Cycle:                T0   T1   T2   T3
signal_a              __|‾|_____________
signal_b              ____|‾‾|__________
```

Walkthrough:
- T0: ...
- T1: ...

## 7. 时钟复位

<!-- FILL-IN: clk source, reset polarity + sync/async, any clock-gate / XPROP guards. -->

## 8. 关键电路逐层解读

<!-- FILL-IN: For each major always block / assign group:
- §8.X.1 Purpose (one-sentence functional semantics)
- §8.X.2 RTL Excerpt (with `// file:L-L` header)
- §8.X.3 Line-by-line Explanation
- §8.X.4 Design Rationale (Why this way vs alternatives)
Rule R2: full quote, no branch omission for key blocks.
Rule R4: What/How/Why.
-->

### 8.1 [Layer name, e.g. "Allocation Logic"]

**目的:**

**RTL 片段:**

```systemverilog
// perseus_ls_xxx.sv:L<start>-L<end>
<paste full always block or assign group>
```

**逐段解读:**

**设计理由:**

### 8.2 [Next layer]
...

## 9. 状态机

<!-- FILL-IN: For every FSM in the module:
- Complete state transition diagram (ASCII ok)
- Trigger condition table
- Typical lifecycle waveform (cross-ref §6)
-->

### 9.1 [FSM 名称]

**状态清单:**

| 编码 | 状态 | 含义 |
|------|------|------|
| | | |

**转移图:**

```
IDLE ──(alloc)──▶ ACTIVE ──(done)──▶ IDLE
               ╲
                ╲──(flush)──▶ IDLE
```

**转移触发条件表:**

| 源状态 | 目标状态 | 触发条件 | RTL 位置 |
|--------|---------|---------|---------|
| | | | |

## 10. 三级模块设计

<!-- FILL-IN: If L3 submodules exist, each gets its own subsection using this same 14-section structure (nested).
Shared primitives (e.g. ls_age_matrix) are NOT duplicated here — link to shared_primitives/<name>.md per rule R6. -->

### 10.1 [L3 子模块名]

[Nested 14-section content...]

### 10.2 Shared Primitive Instance: [primitive name](../shared_primitives/<file>.md)

**实例化参数:** `.PARAM(value)`
**本模块使用:** [brief context; do not duplicate primitive's own description]

## 11. 调用者契约

<!-- FILL-IN: Assumptions about inputs (e.g. "src_older vectors must be pairwise consistent"), boundary conditions, undefined-behavior cases. -->

## 12. 验证关注点

<!-- FILL-IN: Feature → testpoint seed table. IDs = `<ABBREV>-TP-<NN>`. These seed future testpoint-gen consumption. -->

| TP ID | 验证对象 Feature | 场景描述 | 预期行为 | 备注 |
|-------|-----------------|---------|---------|------|
| `<ABBREV>-TP-01` | `<ABBREV>-F01` | | | |

## 13. 设计陷阱与注记

<!-- FILL-IN: Easily-overlooked details, potential races, known limitations, relevant chicken bits. -->

## 14. 参考资料

- RTL 文件: `perseus_ls_xxx.sv`, [related files]
- ARM ARM: *(if applicable, cite DDI0487L_b §X.Y.Z)*
- 论文 / 参考设计: *(e.g. for RRIP: Jaleel et al. "High Performance Cache Replacement Using Re-Reference Interval Prediction (RRIP)" ISCA 2010)*
- 内部交叉引用: `../lsu_top_l1.md`, `../shared_primitives/<primitive>.md`, `../traceability.md`
```

- [ ] **Step 3: Self-check**

Open the written template and verify:
- All 14 sections present
- Every `<!-- FILL-IN: ... -->` comment gives concrete guidance (not vague "add details")
- Every example Italic line shows a plausible real entry
- References to spec rules are present in the relevant sections (R1 in §2, R2 in §8, R6 in §10, R7 in §6)

- [ ] **Step 4: Commit + push**

```bash
cd "/Users/m/claude code/lsu_ut"
git add design_docs/TEMPLATE_L2_MODULE.md
git commit -m "docs(template): add reusable 14-section L2 module template

- Per spec §5.1 structure
- Empty skeleton with FILL-IN guidance comments
- Example italic lines showing expected entry shape
- Cross-reference to spec rules R1-R7"
git push origin main
```

- [ ] **Step 5: Gate 2 report to user**

Ritual D. Note: "Template is the pattern that Tasks 4-18 will instantiate. Any template structural change now is cheaper than after."

**Stop.** Wait for approval.

---

## Task 4 (Gate 3): `ls_age_matrix.md` §1-3 (定位 + 抽象 + 参数化)

**Goal:** Start the shared primitive document. Establish positioning, microarchitectural abstraction (math model), and parameter enumeration.

**Files:**
- Create: `/Users/m/claude code/lsu_ut/design_docs/shared_primitives/ls_age_matrix.md`
- Read (RTL): `perseus_ls_age_matrix.sv` (already fully read in prior session, 255 lines)

- [ ] **Step 1: Pre-announce**

Tell user: "Gate 3 writes `ls_age_matrix.md` §1-3 (positioning + abstraction + parameterization) using the primitive 8-section template per spec §5.2. Gates 4 and 5 finish §4-8."

- [ ] **Step 2: Re-read RTL in full (confirm no content drift since last session)**

```bash
ssh 192.168.20.6 -l xy.mu "cat -n /home/xy.mu/N2/MP128-r0p3-00rel0-2/MP128-BU-50000-r0p3-00rel0/perseus/logical/perseus_loadstore/verilog/perseus_ls_age_matrix.sv"
```

Expected: 255 lines, beginning with ARM copyright, module declaration at line 26, `endmodule` at line 249.

- [ ] **Step 3: Write §1 — 定位 (Positioning)**

Content:
- Primitive class: Age Matrix (microarchitecture sorting primitive)
- What LSU uses it for: ordering within any queue that needs "oldest entry" selection with concurrent allocation and out-of-order release
- Consumers (pilot): `ls_lrq` (AM_SIZE=16). Deferred consumers: `ls_sab` (AM_SIZE=24), `ls_rar` (AM_SIZE=40).
- File: `perseus_ls_age_matrix.sv` (15 KB, 255 lines)

Cite module header `perseus_ls_age_matrix.sv:L26-L54`.

- [ ] **Step 4: Write §2 — 数学模型 / 抽象**

Content (per R4 What/How/Why):
- **What:** N×N antisymmetric binary relation matrix A where `A[i][j]=1 iff entry_i younger than entry_j`.
- **How:** Only strict upper triangle stored (N(N-1)/2 flops); lower triangle derived by inversion. Oldest entry i satisfies `(row i all-zero) ∧ (column i all-one)`.
- **Why:** Chosen over FIFO pointer (doesn't support out-of-order release) and over sequence counter (counter wrap requires wrap bit + multi-source arbitration is costly). Age matrix enables O(1) oldest-query + native multi-source allocation.

Include the 4-row alternatives table from prior session content. Cite storage declaration `perseus_ls_age_matrix.sv:L62-L93`.

- [ ] **Step 5: Write §3 — 参数化 (Parameterization)**

Content:
- Single parameter `AM_SIZE` (default 4), drives all matrix dimensions.
- Derived dimensions:
  - Entry count = AM_SIZE
  - Storage rows = AM_SIZE-1
  - Storage columns per row = variable (upper triangle)
  - Total storage bits = AM_SIZE*(AM_SIZE-1)/2
- Instantiation examples (look ahead, cited from spec §5.2 §7): AM_SIZE=4 (default test), 16 (LRQ), 24 (SAB), 40 (RAR)
- Parameter location: `perseus_ls_age_matrix.sv:L26`

- [ ] **Step 6: Self-check**

Apply Ritual B. Particularly:
- R1: every statement traceable to a `.sv:L-L`
- R4: §2 answers What/How/Why fully
- No `(UNVERIFIED)` yet — everything in §1-3 is directly in RTL

- [ ] **Step 7: Commit + push**

```bash
cd "/Users/m/claude code/lsu_ut"
git add design_docs/shared_primitives/ls_age_matrix.md
git commit -m "docs(primitive): ls_age_matrix §1-3 positioning + abstraction + parameterization

- §1: primitive class, consumer modules, file location
- §2: antisymmetric relation model, upper-triangular storage, oldest-query formula
- §3: AM_SIZE parameter and instantiation sizes across LSU"
git push origin main
```

- [ ] **Step 8: Gate 3 report**

Ritual D. "Awaiting Gate 3 approval before Gate 4 (§4-6)."

**Stop.**

---

## Task 5 (Gate 4): `ls_age_matrix.md` §4-6 (接口 + 电路 + 契约)

**Goal:** Complete interface enumeration, full circuit walkthrough, and caller contract.

**Files:**
- Modify: `/Users/m/claude code/lsu_ut/design_docs/shared_primitives/ls_age_matrix.md`

- [ ] **Step 1: Pre-announce**

Tell user: "Gate 4 adds §4 port list, §5 circuit layer-by-layer (5 layers), §6 caller contract. This is the bulk of the primitive doc."

- [ ] **Step 2: Write §4 — 端口与接口**

Tables for inputs and outputs. Port names from `perseus_ls_age_matrix.sv:L28-L53`. For each port:
- Name
- Width (in terms of `AM_SIZE` — keep parameterized, do not hardcode)
- Direction
- Role (one sentence)

Example input row:
> `entry_needs_arb` | `[AM_SIZE-1:0]` | input | Per-entry flag indicating the entry wants to participate in arbitration. Gates `matrix_eff_hold` at L176.

Example output row:
> `oldest_entry` | `[AM_SIZE-1:0]` | output | 1-hot indication of the overall oldest entry among `entry_v ∧ entry_needs_arb`.

- [ ] **Step 3: Write §5 — 关键电路 (Layer-by-Layer)**

Follow the 5-layer decomposition from prior session:

**§5.1 Layer 1: Effective Valid Computation (L106-130)**
- Purpose, full RTL excerpt of `alloc_entry` + four `src*_entry_v_eff` assigns, line-by-line explanation covering the pairwise-older consistency trick, design rationale for 4-way concurrent allocation.

**§5.2 Layer 2: `age_matrix_in` Combinational (L137-146)**
- Full ternary cascade, explanation of priority order (src0 > src1 > src2 > src3 > hold), rationale.

**§5.3 Layer 3: Flop Storage (L152-168)**
- Full `always_ff`, explanation of row-level clock gate (`matrix_row_en`), async reset, XPROP guard (`PERSEUS_XPROP_FLOP`).

**§5.4 Layer 4: Masked Effective Matrix (L176-195)**
- Explain the 6 parallel variants (matrix / group_a..d / resp), the hold⊕set decomposition.

**§5.5 Layer 5: Oldest Selector (L200-244)**
- Three cases: row 0, middle rows, AM_SIZE-1 row; formula derivation; fan-in complexity.

Each layer applies Rule R2 (full excerpt) and R4 (What/How/Why).

- [ ] **Step 4: Write §6 — 调用者契约**

Explicit assumptions:
- `src{K}_older[j] = ~src{J}_older[k]` pairwise consistency (otherwise matrix loses antisymmetry)
- At most 1 source may allocate to any given row (`alloc_entry[K]` OR bit uniqueness)
- `entry_group_a/b/c/d` not required to be mutually exclusive
- Degeneracy: AM_SIZE=1 produces empty generate loops; not a supported value

Also include a subsection "Potential Pitfalls in Caller Code" listing:
- Forgetting to drive unused sources' `alloc_entry` to 0
- Driving `entry_v` high for a row without `src_alloc` (stale/undefined `age_matrix_q`)
- Reading `oldest_entry` the same cycle as a brand-new allocation (1 cycle latency; see §7 instantiation catalog for actual observed latency)

- [ ] **Step 5: Self-check**

R1-R7. Particularly R2 (no omitted branches in L1/L2/L4/L5 excerpts) and R7 (no waveforms required here yet — those come in Gate 5 timing subsection if any arise).

- [ ] **Step 6: Commit + push**

```bash
cd "/Users/m/claude code/lsu_ut"
git add design_docs/shared_primitives/ls_age_matrix.md
git commit -m "docs(primitive): ls_age_matrix §4-6 ports, 5-layer circuit, caller contract

- §4: input/output port tables with AM_SIZE parameterization
- §5: 5 layers walked (effective-valid, age_matrix_in, flop storage, masked matrix, oldest selector)
- §6: contracts including src_older pairwise consistency, alloc_entry uniqueness"
git push origin main
```

- [ ] **Step 7: Gate 4 report**

Ritual D. "Awaiting Gate 4 approval."

**Stop.**

---

## Task 6 (Gate 5): `ls_age_matrix.md` §7-8 (实例化清单 + 验证关注点)

**Goal:** Finalize the shared primitive doc and lock it as the L3 sample template.

**Files:**
- Modify: `/Users/m/claude code/lsu_ut/design_docs/shared_primitives/ls_age_matrix.md`

- [ ] **Step 1: Pre-announce**

Tell user: "Gate 5 finishes `ls_age_matrix.md` — §7 instantiation catalog, §8 verification focus. This is the last primitive gate before we move to TLB."

- [ ] **Step 2: Search RTL for all `perseus_ls_age_matrix` instantiations**

```bash
ssh 192.168.20.6 -l xy.mu "grep -rn 'perseus_ls_age_matrix' /home/xy.mu/N2/MP128-r0p3-00rel0-2/MP128-BU-50000-r0p3-00rel0/perseus/logical/perseus_loadstore/verilog/ | head -10"
```

For each instantiation found, record:
- Consumer module file + line
- `AM_SIZE` parameter value
- Instance name
- Purpose (inferred from surrounding code)

Expected: at least 3 matches (in `ls_lrq`, `ls_sab`, `ls_rar`).

- [ ] **Step 3: Write §7 — 实例化清单**

Table columns: 消费模块 | AM_SIZE | 实例名 | 作用 | 源位置 | 本 pilot 状态

Example row:
> `ls_lrq` | 16 | `u_age_mtx_lrq` *(confirm name from RTL)* | 跟踪 16 个 outstanding load miss 的相对年龄，驱动 `lrq_oldest_vld/uid` 和 L2 请求选择 | `perseus_ls_lrq.sv:L<inst-line>` | 本 pilot 文档 `../submodules/ls_lrq.md`

- [ ] **Step 4: Write §8 — 验证关注点**

Per spec R7, seed testpoints. Target at least 10 TPs, one per primitive-level behavior:

Table columns: `AGEMTX-TP-NN` | 验证场景 | 预期行为 | 对应 RTL Layer

Include minimum:
- AGEMTX-TP-01: single-source sequential allocation, observe oldest_entry tracking
- AGEMTX-TP-02: dealloc via `entry_v` clear, oldest_entry skips dealloc'd
- AGEMTX-TP-03: 4-source concurrent alloc with src_older consistency, assert antisymmetry
- AGEMTX-TP-04: dynamic group assignment, per-group oldest tracking independently
- AGEMTX-TP-05: reset release, first-cycle allocation correctness
- AGEMTX-TP-06: row clock gate — alloc only in low rows, confirm high-row outputs still valid
- AGEMTX-TP-07: XPROP mode — unallocated reads propagate X (if PERSEUS_XPROP_FLOP defined)
- AGEMTX-TP-08: concurrent alloc + dealloc in same cycle
- AGEMTX-TP-09: resp_oldest when all entries have `awaiting_resp=0` → resp_oldest_entry all-0 expected (verify this via RTL walk or mark UNVERIFIED)
- AGEMTX-TP-10: parameter AM_SIZE=16/24/40 variants (smoke)

- [ ] **Step 5: Self-check**

Apply R1-R7. Key: §7 citations must reference real instantiation lines — if Step 2's grep shows 3 matches, all 3 must appear in §7 with exact line.

- [ ] **Step 6: Commit + push**

```bash
cd "/Users/m/claude code/lsu_ut"
git add design_docs/shared_primitives/ls_age_matrix.md
git commit -m "docs(primitive): ls_age_matrix §7-8 complete with instantiation catalog and testpoint seeds

- §7: all known instantiations in LRQ/SAB/RAR with AM_SIZE and line citations
- §8: 10 testpoint seeds covering allocation, dealloc, concurrent, groups, reset, clock gate, XPROP

ls_age_matrix.md is now the reference shared-primitive sample per spec §5.2."
git push origin main
```

- [ ] **Step 7: Gate 5 report**

Ritual D. Explicitly note: "This is the L3 sample template. Gate 6+ can now reference its structure."

**Stop.**

---

## Task 7 (Gate 6): `ls_tlb.md` §1-2 (定位 + Features)

**Goal:** Start `ls_tlb.md`. Establish module role and exhaustive feature list. **This is a critical gate** per spec §8 — the feature list drives all downstream TLB content.

**Files:**
- Create: `/Users/m/claude code/lsu_ut/design_docs/submodules/ls_tlb.md`
- Read (RTL): `perseus_ls_tlb.sv` (803 KB, very large — use targeted reads)

- [ ] **Step 1: Pre-announce**

Tell user: "Gate 6 opens `ls_tlb.md` with §1 positioning + §2 full features list. Per spec R1, every TLB-F feature must cite RTL. ls_tlb.sv is 803KB so I'll read module header + submodule instantiations + key always blocks selectively."

- [ ] **Step 2: Read TLB module header and parameter declarations**

```bash
ssh 192.168.20.6 -l xy.mu "sed -n '1,300p' /home/xy.mu/N2/MP128-r0p3-00rel0-2/MP128-BU-50000-r0p3-00rel0/perseus/logical/perseus_loadstore/verilog/perseus_ls_tlb.sv | cat -n"
```

Extract: module signature, parameter list, first ports.

- [ ] **Step 3: Enumerate all TLB ports**

```bash
ssh 192.168.20.6 -l xy.mu "grep -nE '^\\s*(input|output|inout)\\s+' /home/xy.mu/N2/MP128-r0p3-00rel0-2/MP128-BU-50000-r0p3-00rel0/perseus/logical/perseus_loadstore/verilog/perseus_ls_tlb.sv | wc -l"
ssh 192.168.20.6 -l xy.mu "grep -nE '^\\s*(input|output|inout)\\s+' /home/xy.mu/N2/MP128-r0p3-00rel0-2/MP128-BU-50000-r0p3-00rel0/perseus/logical/perseus_loadstore/verilog/perseus_ls_tlb.sv | head -60"
```

Record total port count and first 60 port lines (for later §5 port tables; saved for Gate 8).

- [ ] **Step 4: Enumerate all submodule instantiations inside `ls_tlb`**

```bash
ssh 192.168.20.6 -l xy.mu "grep -nE '^\\s*perseus_ls_' /home/xy.mu/N2/MP128-r0p3-00rel0-2/MP128-BU-50000-r0p3-00rel0/perseus/logical/perseus_loadstore/verilog/perseus_ls_tlb.sv | head -30"
ssh 192.168.20.6 -l xy.mu "grep -nE '^\\s*perseus_' /home/xy.mu/N2/MP128-r0p3-00rel0-2/MP128-BU-50000-r0p3-00rel0/perseus/logical/perseus_loadstore/verilog/perseus_ls_tlb.sv | grep -vE 'define|include' | head -30"
```

Expected finds: `perseus_ls_rrip` (replacement), `perseus_ls_multi_hit_detect`, ECC wrappers. These become candidates for §10 (L3) section.

- [ ] **Step 5: Identify named FSMs/states**

```bash
ssh 192.168.20.6 -l xy.mu "grep -nE 'typedef\\s+enum|\\blocalparam\\b.*STATE|\\bparameter\\b.*STATE' /home/xy.mu/N2/MP128-r0p3-00rel0-2/MP128-BU-50000-r0p3-00rel0/perseus/logical/perseus_loadstore/verilog/perseus_ls_tlb.sv | head -20"
```

Record FSM state enumerations (will inform §9 FSM section in Gate 9).

- [ ] **Step 6: Write §1 — 模块定位**

Content:
- One sentence: "`perseus_ls_tlb` implements the 44-entry fully-associative L1 data micro-TLB shared by all three LS pipelines (ls0/ls1/ls2), providing ARMv9-VMSA-compliant VA→PA translation with stage1+stage2 merging, ASID/VMID tagging, PAN/UAO/TBI attribute handling, and MTE tag-check address path."
- Position: between AGU (supplies VA at a1) and DCache arb / LRQ (consumes PA + hit at a2).
- Parameters: `PERSEUS_LS_L1_TLB_SIZE = 44`, `PERSEUS_LS_L1_TLB_MULTI_HIT_INST.TLB_SIZE = 44`, ECC wrappers.
- Pipeline stages where active: a1 (CAM lookup), a2 (hit/perm/abort).

Cite RTL line ranges for each claim.

- [ ] **Step 7: Write §2 — Features 列表**

Iterate through identifiable external capabilities of the TLB. For each, one row with RTL citation. Aim for 20-30 features. Examples:

| ID | Feature | RTL 承载位置 | 关联 L1 Feature |
|----|---------|--------------|-----------------|
| `TLB-F01` | 44-entry fully-associative CAM lookup at a1 for 3 pipelines | `perseus_ls_tlb.sv:L<cam-block-start>-L<end>` | `LSU-F02` |
| `TLB-F02` | TLB miss signaling to MMU via `ls_mm_tlb_miss_v_a2` | `perseus_ls_tlb.sv:L<miss-gen>-L<end>` | `LSU-F02` |
| `TLB-F03` | TLB miss response capture from `mm_ls_tlb_miss_resp_*` | `perseus_ls_tlb.sv:L<resp-capture>-L<end>` | `LSU-F02` |
| `TLB-F04` | 6 page sizes supported (4K/16K/64K/256K/2M/512M) | `perseus_ls_tlb.sv:L<pagesz-decode>` | `LSU-F02` |
| `TLB-F05` | ASID tagging (EL1/EL2) + ASID-based flush | `perseus_ls_tlb.sv:L<asid>` | `LSU-F02` |
| `TLB-F06` | VMID tagging + 16-bit VMID support | `perseus_ls_tlb.sv:L<vmid>` | `LSU-F02` |
| `TLB-F07` | Stage1+Stage2 nested translation merge | `perseus_ls_tlb.sv:L<stg2>` | `LSU-F02` |
| `TLB-F08` | AP permission check (read/write/exec) | `perseus_ls_tlb.sv:L<ap>` | `LSU-F02` |
| `TLB-F09` | PAN / UAO attribute handling | `perseus_ls_tlb.sv:L<pan>` | `LSU-F02` |
| `TLB-F10` | TBI (Top-Byte-Ignore) mask | `perseus_ls_tlb.sv:L<tbi>` | `LSU-F02` |
| `TLB-F11` | TCMA tag-check-bypass | `perseus_ls_tlb.sv:L<tcma>` | `LSU-F12` (MTE) |
| `TLB-F12` | Multi-hit detection (parity) | Via `u_multi_hit_detect` instantiation | `LSU-F02` |
| `TLB-F13` | RRIP replacement policy | Via `u_rrip` instantiation | `LSU-F02` |
| `TLB-F14` | TLBI (TLB Invalidate) response to snoop | `perseus_ls_tlb.sv:L<tlbi>` | `LSU-F02`, `LSU-F08` (snoop) |
| `TLB-F15` | SPE TLB miss sampling | `perseus_ls_tlb.sv:L<spe_sample>` | — |
| `TLB-F16` | LOR (Limited Ordering Region) descriptor tables 0/1 | `perseus_ls_tlb.sv:L<lor>` | — |
| `TLB-F17` | ECC protection on TLB entries | via `PERSEUS_LS_ECC_POP_PARAM_DECL` wrapper | `LSU-F11` (RAS) |
| `TLB-F18` | MBIST interface (`cb_dftramhold`) | `perseus_ls_tlb.sv:L<mbist>` | — |
| `TLB-F19` | HW AF/DB update (Hardware Access/Dirty bit) | `stg1_hd_*`, `stg2_hd_*` signals | `LSU-F02` |
| `TLB-F20` | Per-pipeline valid sampling output `valid_sampled_xlat_uop_ls{0,1,2}_a1` | `perseus_ls_tlb.sv:L<vs>` | — |

*(Continue through RTL review — final count determined by what RTL actually exposes.)*

Each line range is obtained by RTL grep; do not fabricate. If a feature is suspected but line not found: mark `(UNVERIFIED: feature inferred from ports, specific implementation line TBD in Gate 9)`.

- [ ] **Step 8: Self-check**

R1 for every feature row. R5 for anything with `(UNVERIFIED: ...)`.

- [ ] **Step 9: Commit + push**

```bash
cd "/Users/m/claude code/lsu_ut"
git add design_docs/submodules/ls_tlb.md
git commit -m "docs(tlb): ls_tlb §1-2 positioning and features list

- §1: 44-entry fully-associative uTLB role, pipeline stages a1-a2
- §2: initial TLB-F01..TLB-F<N> features with RTL citations
- Unverified flags: <list>"
git push origin main
```

- [ ] **Step 10: Gate 6 report (critical gate)**

Ritual D, plus: "**Critical gate.** Feature list drives all TLB downstream content. If any feature row is wrong or missing, cheaper to fix now. Please scrutinize §2 carefully."

**Stop.**

---

## Task 8 (Gate 7): `ls_tlb.md` §3-4 (微架构抽象 + 框图)

**Goal:** Describe the TLB's microarchitectural pattern and draw the block diagram.

**Files:**
- Modify: `/Users/m/claude code/lsu_ut/design_docs/submodules/ls_tlb.md`

- [ ] **Step 1: Pre-announce**

"Gate 7 writes §3 (TLB microarchitecture abstraction: fully-associative CAM + RRIP) and §4 (block diagram)."

- [ ] **Step 2: Write §3 — 微架构抽象**

Content per R4:
- **What:** A fully-associative CAM-based TLB with RRIP replacement — 44 content-addressable entries, each a flop-based storage holding `{valid, VA[47:12], PA[47:12], ASID, VMID, page_size_code, AP, XN, AF, SH, memattr, reserved}`.
- **How:**
  - **Lookup:** parallel compare VA against all 44 entries; page_size_code selects which VA bits participate in compare (mask).
  - **Hit selection:** 1-hot winner from 44; multi-hit detector raises fault if more than one.
  - **Fill:** on MMU response, RRIP algorithm selects victim; entry written.
  - **Invalidation:** TLBI snoop matches via CAM (ASID/VMID/VA range); matched entries cleared.
- **Why:**
  - Fully-associative: max hit rate at the cost of 44-port CAM (OK at small size).
  - Flop-based (not SRAM): 1-cycle lookup essential for a1→a2 path.
  - RRIP over LRU: similar thrash-resistance, lower storage overhead (2-bit RRIP vs full LRU matrix).
- Cross-reference: `ls_rrip` shared primitive doc (future; deferred).

- [ ] **Step 3: Write §4 — 整体框图**

ASCII diagram showing:
- 3 parallel `va_ls{0,1,2}_a1` inputs → CAM block
- CAM → multi-hit detector → fault
- CAM → hit selector → `pa`/`attr`/`abort` outputs
- Miss generator → `ls_mm_tlb_miss_*`
- MMU response capture ← `mm_ls_tlb_miss_resp_*`
- RRIP replacement block → victim index
- ECC wrapper on entries
- MBIST path

- [ ] **Step 4: Self-check**

R4 (What/How/Why present), R6 (shared primitive references link, not duplicate), diagram matches features from §2.

- [ ] **Step 5: Commit + push**

```bash
cd "/Users/m/claude code/lsu_ut"
git add design_docs/submodules/ls_tlb.md
git commit -m "docs(tlb): ls_tlb §3-4 microarchitecture abstraction and block diagram

- §3: CAM + RRIP pattern, lookup/fill/invalidate/replacement flows, design rationale
- §4: ASCII block diagram of data/control paths, MMU interface, ECC/MBIST"
git push origin main
```

- [ ] **Step 6: Gate 7 report**

Ritual D.

**Stop.**

---

## Task 9 (Gate 8): `ls_tlb.md` §5-6 (接口 + 时序波形)

**Goal:** Port list and important-timing waveforms.

**Files:**
- Modify: `/Users/m/claude code/lsu_ut/design_docs/submodules/ls_tlb.md`

- [ ] **Step 1: Pre-announce**

"Gate 8 writes full §5 port list (from Task 7 step 3 data) and §6 waveforms — important TLB timings only (rule R7)."

- [ ] **Step 2: Complete port reading**

```bash
ssh 192.168.20.6 -l xy.mu "grep -nE '^\\s*(input|output|inout)\\s+' /home/xy.mu/N2/MP128-r0p3-00rel0-2/MP128-BU-50000-r0p3-00rel0/perseus/logical/perseus_loadstore/verilog/perseus_ls_tlb.sv"
```

All ports in one grep.

- [ ] **Step 3: Write §5 — 接口列表**

§5.1 inputs table, §5.2 outputs table. Columns: 信号 | 位宽 | 源/目的模块 | 活跃阶段 | 作用. Source/dest derived from signal naming prefix (`is_` → Issue; `ls_mm_` → MMU; `mm_ls_` → MMU response; etc.).

- [ ] **Step 4: Write §6 — 接口时序**

Apply R7. Required waveforms (judged important):

**§6.1 TLB Hit timing (baseline)** — single pipe lookup, hit on cycle a2:
```
Cycle:                   T0    T1    T2
                         a1    a2
va_ls0_a1                __|VA|____________
valid_sampled_xlat_uop_ls0_a1  ____|‾|___________
hit_ls0_a2               _________|‾|___
pa_ls0_a2                _________|PA|__
abort_ls0_a2             _________|_|___
```

**§6.2 TLB Miss → MMU walk → response** (cross-module handshake, R7 criterion 1 + 4):
Full req/resp with arbitrary walk latency.

**§6.3 Permission fault (abort path)** — exception path, R7 criterion 4.

**§6.4 Multi-hit detect** — R7 criterion 4.

**§6.5 TLBI snoop invalidation** — cross-module + state change.

**§6.6 Stage2 nested translation (2 rounds of walks)** — cross-cycle complex handshake.

Each waveform accompanied by per-cycle walkthrough.

- [ ] **Step 5: Self-check**

R7 coverage: do all 4 important-timing criteria have waveforms? R3 line citations under each waveform pointing to the RTL that generates each signal transition. R5 mark anything whose exact cycle is inferred (e.g., walk latency is environmental; mark `(UNVERIFIED: walk latency is MMU implementation-dependent)`).

- [ ] **Step 6: Commit + push**

```bash
cd "/Users/m/claude code/lsu_ut"
git add design_docs/submodules/ls_tlb.md
git commit -m "docs(tlb): ls_tlb §5 port list and §6 important-timing waveforms

- §5: complete input/output tables
- §6: 6 waveforms (hit, miss+walk, perm fault, multi-hit, TLBI snoop, stage2 nested)"
git push origin main
```

- [ ] **Step 7: Gate 8 report**

Ritual D.

**Stop.**

---

## Task 10 (Gate 9): `ls_tlb.md` §7-9 (时钟复位 + 关键电路 + FSM)

**Goal:** Clock/reset section, layered circuit walkthrough, FSM documentation.

**Files:**
- Modify: `/Users/m/claude code/lsu_ut/design_docs/submodules/ls_tlb.md`

- [ ] **Step 1: Pre-announce**

"Gate 9 is the deepest TLB gate — §8 key circuits (likely 6-10 layers for a 44-entry CAM module) + §9 all FSMs."

- [ ] **Step 2: Read key TLB `always` blocks**

Identify candidate always blocks via grep:

```bash
ssh 192.168.20.6 -l xy.mu "grep -nE '(always_ff|always_comb|always\\s*@)' /home/xy.mu/N2/MP128-r0p3-00rel0-2/MP128-BU-50000-r0p3-00rel0/perseus/logical/perseus_loadstore/verilog/perseus_ls_tlb.sv | head -40"
```

For each, fetch the full block body via sed. Identify the top 6-10 most significant by naming and scope.

- [ ] **Step 3: Write §7 — 时钟复位**

Content:
- `clk` source: top-level LSU clock
- `reset_i`: active-high, async (per RTL style)
- `cb_dftramhold`: DFT RAM hold (entry flops freeze)
- Row/bank-level clock gating if observed in RTL

- [ ] **Step 4: Write §8 — 关键电路 (each layer own subsection)**

Candidate layers (confirm against actual RTL):
- §8.1 Entry storage flops (44-entry array)
- §8.2 CAM compare logic (VA match per entry)
- §8.3 Page size mask generation
- §8.4 Hit select (1-hot priority)
- §8.5 Multi-hit detect
- §8.6 Permission check combinational logic
- §8.7 Miss request generation (→ `ls_mm_tlb_miss_v_a2`)
- §8.8 Miss response capture + entry write
- §8.9 RRIP victim select (delegates to `u_rrip`)
- §8.10 TLBI snoop match + invalidate

Each layer: Purpose + RTL excerpt + line-by-line + rationale (R2 + R4).

- [ ] **Step 5: Write §9 — 状态机**

Identify all FSMs inside `ls_tlb`:
- TLB miss-to-walk handshake FSM (if present)
- MTE address precommit FSM (prec_mte_uid_vld_q) — known from prior session

For each:
- State list with encoding
- Transition diagram (ASCII)
- Trigger condition table
- Typical lifecycle waveform (can reference §6 or add here)

If an FSM couldn't be located in RTL, mark `(UNVERIFIED: inferred; exact state machine not located in <line>)`.

- [ ] **Step 6: Self-check**

R2 (full always blocks). R3 (all cites). R4 (What/How/Why per subsection). R7 (FSM lifecycle waveforms if they qualify).

- [ ] **Step 7: Commit + push**

```bash
cd "/Users/m/claude code/lsu_ut"
git add design_docs/submodules/ls_tlb.md
git commit -m "docs(tlb): ls_tlb §7-9 clock/reset, key circuits, FSMs

- §7: clk/reset_i/poreset + dft path
- §8: ~10 circuit layers from entry storage through TLBI invalidate
- §9: TLB miss-walk FSM and MTE precommit FSM"
git push origin main
```

- [ ] **Step 8: Gate 9 report**

Ritual D.

**Stop.**

---

## Task 11 (Gate 10): `ls_tlb.md` §10-14 (L3 + 契约 + 验证 + 陷阱 + 参考)

**Goal:** Finish ls_tlb.md with L3 references, caller contract, verification seeds, pitfalls, and references.

**Files:**
- Modify: `/Users/m/claude code/lsu_ut/design_docs/submodules/ls_tlb.md`

- [ ] **Step 1: Pre-announce**

"Gate 10 finishes `ls_tlb.md` — §10 L3 refs (multi_hit_detect + rrip), §11 caller contract, §12 testpoint seeds, §13 pitfalls, §14 references."

- [ ] **Step 2: Write §10 — 三级模块设计**

TLB uses L3 submodules:
- `perseus_ls_multi_hit_detect` (parity-style multi-hit detector). Either link to a future doc or inline a brief description.
- `perseus_ls_rrip` (shared primitive — link to future `shared_primitives/ls_rrip.md`, mark deferred per R6).
- ECC wrappers (`perseus_ecc_*`) — link to future shared primitive doc, mark deferred.

For the instantiation of `perseus_ls_age_matrix`: `ls_tlb` does NOT instantiate age_matrix (verify via grep). If not used, explicitly state "No age_matrix usage in ls_tlb".

- [ ] **Step 3: Write §11 — 调用者契约**

Assumptions on inputs:
- `cur_asid_el1/el2` must be stable during a1→a2 window
- `cur_vmid` must be stable
- TCR_EL1/EL2 attributes must be coherent with the uop being translated
- `mm_ls_tlb_miss_resp_id` must correspond to a previously outstanding request ID (0-3)

Boundary conditions:
- Multi-hit: always triggers fault (no silent corruption)
- MMU fault propagation: `mm_ls_tlb_miss_resp_flt` bypasses entry write

Undefined behavior:
- ASID/VMID change mid-translation: not specified; consult ARMv9 ARM

- [ ] **Step 4: Write §12 — 验证关注点**

Seed testpoints covering every feature from §2. Minimum 15 TPs:
- `TLB-TP-01` TLB hit on all 6 page sizes
- `TLB-TP-02` TLB miss → walk → response
- `TLB-TP-03` Permission fault (AP violation)
- `TLB-TP-04` Multi-hit detection
- `TLB-TP-05` TLBI ASID broad invalidate
- `TLB-TP-06` TLBI VA specific invalidate
- `TLB-TP-07` Stage2 nested walk
- `TLB-TP-08` ASID/VMID change → hit rate drops
- `TLB-TP-09` RRIP replacement over 45 pages → 1+ miss
- `TLB-TP-10` PAN/UAO protection
- `TLB-TP-11` TBI mask (top byte ignore)
- `TLB-TP-12` TCMA tag-check bypass
- `TLB-TP-13` ECC SBE correction
- `TLB-TP-14` ECC DBE raises RAS
- `TLB-TP-15` MBIST path

- [ ] **Step 5: Write §13 — 设计陷阱与注记**

Note: items discovered during §8 walkthrough. Examples:
- Entry flop-based: large area cost; justified by 1-cycle lookup requirement
- Parity multi-hit detector may false-positive on transient X during fill (mark UNVERIFIED if uncertain)
- RRIP vs LRU tradeoff (covered in §3)
- Relevant chicken bits: `ls_disable_tlb_asid_sz_force_zero` (if present in RTL — confirm)

- [ ] **Step 6: Write §14 — 参考资料**

- RTL files: `perseus_ls_tlb.sv`, `perseus_ls_multi_hit_detect.sv`, `perseus_ls_rrip.sv`, `perseus_ls_defines.sv`, `perseus_ls_params.sv`
- ARM ARM DDI0487L_b sections: Chapter D5 (VMSA), D8.2 (TLB maintenance)
- Papers: Jaleel et al. "High Performance Cache Replacement Using Re-Reference Interval Prediction" ISCA 2010 (for RRIP)
- Internal: `../lsu_top_l1.md`, `../shared_primitives/ls_age_matrix.md` (consulted but not used)

- [ ] **Step 7: Self-check — full file review**

Go back through all 14 sections. Consolidated R1-R7 pass. Fix any rule violations.

- [ ] **Step 8: Commit + push**

```bash
cd "/Users/m/claude code/lsu_ut"
git add design_docs/submodules/ls_tlb.md
git commit -m "docs(tlb): ls_tlb §10-14 complete — L3, contract, verification, pitfalls, refs

- §10: L3 references (multi_hit_detect, rrip, ECC) — deferred links
- §11: caller contract (ASID/VMID stability, ID correspondence)
- §12: 15 testpoint seeds per feature
- §13: design pitfalls and chicken bits
- §14: full reference list

ls_tlb.md pilot module doc complete."
git push origin main
```

- [ ] **Step 9: Gate 10 report**

Ritual D, plus: "ls_tlb.md complete. First L2 pilot module done. Proceeding to ls_lrq (more complex — 7 gates)."

**Stop.**

---

## Task 12 (Gate 11): `ls_lrq.md` §1-2 (定位 + Features) — critical gate

**Goal:** Open `ls_lrq.md` with positioning and exhaustive feature list (critical per spec §8).

**Files:**
- Create: `/Users/m/claude code/lsu_ut/design_docs/submodules/ls_lrq.md`
- Read (RTL): `perseus_ls_lrq.sv` (1.9MB — targeted reads only), `perseus_ls_lrq_entry.sv` (147KB)

- [ ] **Step 1: Pre-announce**

"Gate 11 opens `ls_lrq.md` with §1 and §2 (feature list, critical gate). ls_lrq.sv is 1.9MB — will read module header + submodule instantiations + FSM declarations. Full walk deferred to Gates 14-17."

- [ ] **Step 2: Read LRQ module header + port declarations**

```bash
ssh 192.168.20.6 -l xy.mu "sed -n '1,400p' /home/xy.mu/N2/MP128-r0p3-00rel0-2/MP128-BU-50000-r0p3-00rel0/perseus/logical/perseus_loadstore/verilog/perseus_ls_lrq.sv | cat -n"
```

- [ ] **Step 3: Find all submodule instantiations in LRQ**

```bash
ssh 192.168.20.6 -l xy.mu "grep -nE '^\\s*perseus_' /home/xy.mu/N2/MP128-r0p3-00rel0-2/MP128-BU-50000-r0p3-00rel0/perseus/logical/perseus_loadstore/verilog/perseus_ls_lrq.sv | grep -v define | head -30"
```

Expected: 16 × `perseus_ls_lrq_entry`, 1 × `perseus_ls_age_matrix(16)`.

- [ ] **Step 4: Find LRQ state encoding**

```bash
ssh 192.168.20.6 -l xy.mu "grep -nE 'LRQ_STATE|localparam.*RDY|localparam.*IN_PIPE|localparam.*WAIT_' /home/xy.mu/N2/MP128-r0p3-00rel0-2/MP128-BU-50000-r0p3-00rel0/perseus/logical/perseus_loadstore/verilog/perseus_ls_defines.sv"
ssh 192.168.20.6 -l xy.mu "grep -nE 'LRQ_STATE|localparam.*RDY|localparam.*IN_PIPE|localparam.*WAIT_' /home/xy.mu/N2/MP128-r0p3-00rel0-2/MP128-BU-50000-r0p3-00rel0/perseus/logical/perseus_loadstore/verilog/perseus_ls_lrq_entry.sv"
```

Find the 10-state encoding definitions.

- [ ] **Step 5: Write §1 — 模块定位**

Content:
- "`perseus_ls_lrq` is the 16-entry Load Request Queue (MSHR-adjacent) that tracks every outstanding load that misses L1 or needs replay. Each entry is an independent 10-state FSM; the queue supports up to 3-way concurrent allocation from ls0/ls1/ls2 and out-of-order release keyed by L2 response DID."
- Pipeline position: allocates at d2 (post-hit/miss), reissues at d0, captures L2 response at m3-m4, wakes dependents at iz.
- Parameters: `PERSEUS_LS_LRQ_SIZE=16`, `PERSEUS_LS_LRQ_WAIT_ID_MAX=6`
- Key collaborators: `ls_fb` (MSHR / fill buffer), `ls_tag_data_arb` (d0 arbitration), `ls_agu` (precommit_uid_q input).

- [ ] **Step 6: Write §2 — Features 列表**

Aim 25-35 features. Examples:

| ID | Feature | RTL 承载位置 | 关联 L1 Feature |
|----|---------|--------------|-----------------|
| `LRQ-F01` | 16-entry queue with independent per-entry FSM | 16× `perseus_ls_lrq_entry` instantiation at `perseus_ls_lrq.sv:L<inst>-L<end>` | `LSU-F04` |
| `LRQ-F02` | 10-state FSM (RDY, IN_PIPE, WAIT_L2RESP, WAIT_STDATA, STDATA_SPEC_WKUP, WAIT_OLD_PRECOMMIT, L2RESP_M3, L2RESP_M4, WAIT_LPT, WAIT_FB) | `perseus_ls_defines.sv:L<state>` + `perseus_ls_lrq_entry.sv:L<fsm>` | `LSU-F04` |
| `LRQ-F03` | 3-way concurrent allocation from ls0/ls1/ls2 via age_matrix | `perseus_ls_lrq.sv:L<alloc>` + AGEMTX instance | `LSU-F04` |
| `LRQ-F04` | Pipeline reissue via d0 arb coordination | `perseus_ls_lrq.sv:L<reissue>` | `LSU-F04` |
| `LRQ-F05` | FB link management (linked miss to same line) | `perseus_ls_lrq_entry.sv:L<fb-link>` | `LSU-F04` |
| `LRQ-F06` | Store-data speculative wakeup (WAIT_STDATA → SPEC) | FSM transition at `perseus_ls_lrq_entry.sv:L<spec>` | `LSU-F05` |
| `LRQ-F07` | Precommit UID ordering wait (WAIT_OLD_PRECOMMIT) | `perseus_ls_lrq.sv:L<precommit>` | `LSU-F06` |
| `LRQ-F08` | L2 response capture at m3 → L2RESP_M3 | `perseus_ls_lrq.sv:L<m3-capture>` | `LSU-F04` |
| `LRQ-F09` | L2 response capture at m4 → L2RESP_M4 | `perseus_ls_lrq.sv:L<m4-capture>` | `LSU-F04` |
| `LRQ-F10` | Livelock detect via tick_tock_change_q | `perseus_ls_lrq.sv:L<livelock>` | — |
| `LRQ-F11` | NC/Device load tracking (`lrq_has_nc_dev_ld_q`) | `perseus_ls_lrq.sv:L<nc>` | `LSU-F04` |
| `LRQ-F12` | `lrq_full` back-pressure | `perseus_ls_lrq.sv:L<full>` | `LSU-F04` |
| `LRQ-F13` | Wake-up broadcast `ls_is_lrq_wakeup_iz` | `perseus_ls_lrq.sv:L<wakeup>` | `LSU-F04` |
| `LRQ-F14` | Flush support (ct_flush / bx_flush) | `perseus_ls_lrq_entry.sv:L<flush>` | `LSU-F06` |
| `LRQ-F15` | DVM/VA-region invalidation (va_region_clear_v/id) | `perseus_ls_lrq.sv:L<dvm>` | `LSU-F08` |
| `LRQ-F16` | Wait-ID (6 sources) tagging | `perseus_ls_lrq_entry.sv:L<waitid>` | `LSU-F04` |
| `LRQ-F17` | Timeout / wait_l2resp_timeout handling | `perseus_ls_lrq.sv:L<timeout>` | — |
| ... | | | |

Target: cover every feature observable in external signals (inputs affect entries, outputs broadcast state) + every internal FSM transition that has external effect.

- [ ] **Step 7: Self-check**

R1 exhaustive. R5 for any `(UNVERIFIED)`.

- [ ] **Step 8: Commit + push**

```bash
cd "/Users/m/claude code/lsu_ut"
git add design_docs/submodules/ls_lrq.md
git commit -m "docs(lrq): ls_lrq §1-2 positioning and features list (critical gate)

- §1: 16-entry queue role, pipeline position, parameters
- §2: ~25 LRQ-F features with RTL citations
- Unverified flags: <list>"
git push origin main
```

- [ ] **Step 9: Gate 11 report (critical)**

Ritual D + "Critical gate. Scrutinize features — they drive 6 more LRQ gates."

**Stop.**

---

## Task 13 (Gate 12): `ls_lrq.md` §3-4 (微架构抽象 + 框图)

**Goal:** Abstract the LRQ as "MSHR-adjacent miss tracker with per-entry FSM + shared age matrix" and draw block diagram.

**Files:**
- Modify: `/Users/m/claude code/lsu_ut/design_docs/submodules/ls_lrq.md`

- [ ] **Step 1: Pre-announce**

"Gate 12 writes §3 abstraction (per-entry FSM queue + age_matrix + MSHR coordination) and §4 block diagram."

- [ ] **Step 2: Write §3 — 微架构抽象**

Content per R4:
- **What:** Per-entry state-machine queue. 16 entries, each an independent 10-state FSM; entries linked to FB (MSHR) for miss coalescing; entries ordered by age_matrix(16) instance.
- **How:**
  - Allocation: at d2, when DCache reports miss or replay-needed, 1-3 entries allocated concurrently from ls0/ls1/ls2 with `src_older` fed by `precommit_uid_q` order.
  - State progression: RDY → IN_PIPE → WAIT_L2RESP → L2RESP_M3/M4 → WAIT_FB → RDY (back to pool).
  - Side paths: WAIT_STDATA + STDATA_SPEC_WKUP (store-to-load dependency), WAIT_OLD_PRECOMMIT (program-order gate), WAIT_LPT.
  - Release: implicit via age_matrix + `entry_v` clear when FSM returns to RDY.
- **Why:**
  - Per-entry FSM (vs. central queue controller): parallelism for 16 in-flight loads.
  - 10 states (not fewer): specifies where each entry is in its lifecycle — essential for replay, debug, livelock detection.
  - age_matrix (vs. FIFO pointer): supports out-of-order release (L2 responses arrive in arbitrary order) and 3-way concurrent allocation.
  - MSHR-adjacent (not MSHR-integrated): separation of "I'm waiting" (LRQ) from "I've requested the line" (FB) lets multiple LRQ entries link to one FB entry for the same line.

- [ ] **Step 3: Write §4 — 整体框图**

Show:
- 16 parallel entry FSMs
- age_matrix(16) for ordering
- Inputs from ls0/ls1/ls2 allocation
- d0 arb output for reissue
- m3/m4 response demux
- FB coupling
- Flush/precommit broadcast
- Livelock buster path

- [ ] **Step 4: Self-check + commit + push**

```bash
git add design_docs/submodules/ls_lrq.md
git commit -m "docs(lrq): ls_lrq §3-4 abstraction and block diagram"
git push origin main
```

- [ ] **Step 5: Gate 12 report** — Ritual D. **Stop.**

---

## Task 14 (Gate 13): `ls_lrq.md` §5-6 (接口 + 时序)

**Goal:** LRQ port list + important timing waveforms (FSM-rich — expect many waveforms).

**Files:**
- Modify: `/Users/m/claude code/lsu_ut/design_docs/submodules/ls_lrq.md`

- [ ] **Step 1: Pre-announce**

"Gate 13: §5 ports + §6 waveforms — at least 5-7 FSM-rich scenarios."

- [ ] **Step 2: Read all LRQ ports**

```bash
ssh 192.168.20.6 -l xy.mu "grep -nE '^\\s*(input|output|inout)\\s+' /home/xy.mu/N2/MP128-r0p3-00rel0-2/MP128-BU-50000-r0p3-00rel0/perseus/logical/perseus_loadstore/verilog/perseus_ls_lrq.sv"
```

- [ ] **Step 3: Write §5 — 接口列表**

Input/output tables per module template §5.

- [ ] **Step 4: Write §6 — 接口时序 (waveforms)**

Per R7, important timings:

**§6.1** Entry lifecycle normal: RDY → IN_PIPE → WAIT_L2RESP → L2RESP_M4 → WAIT_FB → RDY (multi-state, R7-criterion 2)

**§6.2** 3-way concurrent allocation (R7-criterion 3) — src0/src1/src2 all allocate in one cycle, age_matrix consistency

**§6.3** STDATA spec wakeup path (R7-criterion 2) — WAIT_STDATA → STDATA_SPEC_WKUP → RDY

**§6.4** ct_flush mid-lifecycle (R7-criterion 4) — all pending entries flushed

**§6.5** Livelock detection + buster trigger (R7-criterion 4)

**§6.6** LRQ full back-pressure (R7-criterion 3/4)

**§6.7** DVM / va_region_clear invalidate (R7-criterion 4)

Each with per-cycle walkthrough.

- [ ] **Step 5: Self-check + commit + push**

```bash
git add design_docs/submodules/ls_lrq.md
git commit -m "docs(lrq): ls_lrq §5-6 ports and 7 important-timing waveforms"
git push origin main
```

- [ ] **Step 6: Gate 13 report** — Ritual D. **Stop.**

---

## Task 15 (Gate 14): `ls_lrq.md` §7-8 (时钟复位 + 关键电路)

**Goal:** Clock/reset + layered circuit walkthrough. LRQ layers are the densest — may need to split across two commits.

**Files:**
- Modify: `/Users/m/claude code/lsu_ut/design_docs/submodules/ls_lrq.md`

- [ ] **Step 1: Pre-announce**

"Gate 14: §7 (brief) + §8 LRQ key circuits — multiple layers. May commit in 2 sub-commits if size is large."

- [ ] **Step 2: Write §7 — 时钟复位**

- `clk`, `reset_i` async high, `poreset` for power-on full reset of entries
- Per-entry flop reset to RDY state
- age_matrix reset to all-0 (no entries, no relations)

- [ ] **Step 3: Identify and fetch key LRQ layers**

Expected layers (confirm by RTL read):
- §8.1 Allocation arbitration (3-way concurrent from ls0/ls1/ls2)
- §8.2 Per-entry FSM state transition logic (done at entry level — link to §10 for detail)
- §8.3 L2 response demux (m3/m4 DID match)
- §8.4 FB link management (update/broadcast)
- §8.5 Precommit UID wait logic
- §8.6 Wake-up broadcast generation
- §8.7 Livelock tick-tock counter + buster signal
- §8.8 LRQ full counter + back-pressure
- §8.9 DVM / VA-region invalidate match logic
- §8.10 ct_flush / bx_flush broadcast

Fetch each with sed. Each layer: Purpose + excerpt + line-by-line + rationale.

- [ ] **Step 4: Write §8 content**

Apply R2 (full excerpt), R4 (What/How/Why per layer).

- [ ] **Step 5: Self-check + commit + push (may split)**

If total diff >1000 lines, first commit §7 + §8.1-5, second commit §8.6-10.

```bash
git add design_docs/submodules/ls_lrq.md
git commit -m "docs(lrq): ls_lrq §7-8 clock/reset and key circuits (10 layers)"
git push origin main
```

- [ ] **Step 6: Gate 14 report** — Ritual D. **Stop.**

---

## Task 16 (Gate 15): `ls_lrq.md` §9 FSM — dedicated gate for 10-state FSM

**Goal:** Fully document the 10-state LRQ entry FSM.

**Files:**
- Modify: `/Users/m/claude code/lsu_ut/design_docs/submodules/ls_lrq.md`

- [ ] **Step 1: Pre-announce**

"Gate 15 is dedicated to §9 — 10-state FSM full documentation."

- [ ] **Step 2: Read complete entry FSM RTL**

```bash
ssh 192.168.20.6 -l xy.mu "cat -n /home/xy.mu/N2/MP128-r0p3-00rel0-2/MP128-BU-50000-r0p3-00rel0/perseus/logical/perseus_loadstore/verilog/perseus_ls_lrq_entry.sv | head -400"
ssh 192.168.20.6 -l xy.mu "sed -n '400,800p' /home/xy.mu/N2/MP128-r0p3-00rel0-2/MP128-BU-50000-r0p3-00rel0/perseus/logical/perseus_loadstore/verilog/perseus_ls_lrq_entry.sv | cat -n"
```

Locate the main FSM always block. For a 147KB file, expect FSM logic between L200-L600 (estimate; confirm).

- [ ] **Step 3: Write §9.1 — State list table**

10 rows from `PERSEUS_LS_LRQ_STATE_*` defines. Columns: 编码 | 状态 | 含义.

- [ ] **Step 4: Write §9.2 — State transition diagram**

ASCII state graph. All legal transitions from each state with trigger label.

Example:
```
              alloc_v
              ┌─────┐
              │     ▼
       ┌────► RDY ◄────┐
       │      │ fsm_alloc_ok
       │      ▼
       │   IN_PIPE ──── txreq_issued ────► WAIT_L2RESP ──── l2_rvalid_m4 ────► L2RESP_M3 ──── m4_tick ────► L2RESP_M4
       │                                        ...
       │
   flush_match
```

- [ ] **Step 5: Write §9.3 — Trigger condition table**

For every transition: source state | target state | trigger signal/condition | RTL line

- [ ] **Step 6: Write §9.4 — Typical lifecycle waveform**

Full normal flow: RDY → IN_PIPE → WAIT_L2RESP → L2RESP_M3 → L2RESP_M4 → WAIT_FB → RDY

Plus speculative path: RDY → IN_PIPE → WAIT_STDATA → STDATA_SPEC_WKUP → RDY

- [ ] **Step 7: Self-check + commit + push**

```bash
git add design_docs/submodules/ls_lrq.md
git commit -m "docs(lrq): ls_lrq §9 full 10-state FSM with transitions, triggers, lifecycle waveform"
git push origin main
```

- [ ] **Step 8: Gate 15 report** — Ritual D. **Stop.**

---

## Task 17 (Gate 16): `ls_lrq.md` §10 — L3 recursion into `ls_lrq_entry`

**Goal:** Document L3 submodule `perseus_ls_lrq_entry` using the nested 14-section structure (per spec §5.1 §10). Also document the `ls_age_matrix(16)` instantiation by reference.

**Files:**
- Modify: `/Users/m/claude code/lsu_ut/design_docs/submodules/ls_lrq.md` (add §10)

- [ ] **Step 1: Pre-announce**

"Gate 16 recursively documents L3 `ls_lrq_entry` inside §10 of ls_lrq.md. Also links to shared primitive `ls_age_matrix`."

- [ ] **Step 2: Read `ls_lrq_entry.sv` comprehensively**

```bash
ssh 192.168.20.6 -l xy.mu "wc -l /home/xy.mu/N2/MP128-r0p3-00rel0-2/MP128-BU-50000-r0p3-00rel0/perseus/logical/perseus_loadstore/verilog/perseus_ls_lrq_entry.sv"
ssh 192.168.20.6 -l xy.mu "cat -n /home/xy.mu/N2/MP128-r0p3-00rel0-2/MP128-BU-50000-r0p3-00rel0/perseus/logical/perseus_loadstore/verilog/perseus_ls_lrq_entry.sv | head -200"
```

Plan 2-3 targeted sed reads to cover all always blocks.

- [ ] **Step 3: Write §10.1 — L3: `perseus_ls_lrq_entry`**

Use nested 14-section structure:
- §10.1.1 模块定位
- §10.1.2 Features (LRQENT-F01..F<N>)
- §10.1.3 微架构抽象 — "Single-entry stateful container with 10-state FSM"
- §10.1.4 框图 — smaller ASCII
- §10.1.5 接口列表
- §10.1.6 时序 (minimal — most covered by parent §6)
- §10.1.7 时钟复位
- §10.1.8 关键电路 layers (FSM combinational, FSM flop, FB-link update, wait-id tag, timeout counter, flush match, squash handling)
- §10.1.9 FSM — brief; cross-reference parent §9 for the state diagram
- §10.1.10 三级模块 — entry has no further L3s
- §10.1.11 调用者契约 — what ls_lrq guarantees to each entry
- §10.1.12 验证关注点 (LRQENT-TP-NN)
- §10.1.13 陷阱与注记
- §10.1.14 参考

Apply full spec rules R1-R7 to this nested structure.

- [ ] **Step 4: Write §10.2 — Shared Primitive: `ls_age_matrix(16)` instance**

Per R6, do NOT duplicate content from `../shared_primitives/ls_age_matrix.md`. Only write:
- Instance name (confirm from RTL)
- Instantiation line: `perseus_ls_lrq.sv:L<line>`
- Parameter: `AM_SIZE(16)`
- Role in LRQ: drives allocate-order ranking and oldest-for-reissue selection
- Input binding specifics: `entry_v` ← per-entry FSM valid, `entry_needs_arb` ← entry in WAIT_FB or IN_PIPE, `entry_group_a` ← load group, `src{0,1,2}_alloc_entry` ← ls0/ls1/ls2 allocate bits, `src{0,1,2}_older` ← precommit UID comparison result
- Output consumption: `oldest_entry` feeds wake-up + L2 selection; `resp_oldest_entry` feeds L2 response prioritization

Link: `[Shared primitive: ls_age_matrix](../shared_primitives/ls_age_matrix.md)`

- [ ] **Step 5: Self-check + commit + push**

```bash
git add design_docs/submodules/ls_lrq.md
git commit -m "docs(lrq): ls_lrq §10 L3 recursion into ls_lrq_entry + age_matrix instance link

- §10.1: 14-section nested doc for perseus_ls_lrq_entry (LRQENT-F*)
- §10.2: ls_age_matrix(16) instantiation binding without duplicating primitive doc (R6)"
git push origin main
```

- [ ] **Step 6: Gate 16 report** — Ritual D. **Stop.**

---

## Task 18 (Gate 17): `ls_lrq.md` §11-14 — finish LRQ

**Goal:** Complete LRQ with caller contract, testpoint seeds, pitfalls, references.

**Files:**
- Modify: `/Users/m/claude code/lsu_ut/design_docs/submodules/ls_lrq.md`

- [ ] **Step 1: Pre-announce**

"Gate 17 closes ls_lrq.md — §11 contract, §12 testpoints, §13 pitfalls, §14 refs."

- [ ] **Step 2: Write §11 — 调用者契约**

- `ct_precommit_uid` must be monotonically advancing or wrapped correctly
- `ct_flush_uid` / `bx_flush_uid` valid only when `ct_flush` / `bx_flush` high
- `mm_ls_tlb_miss_resp_id` must match outstanding LRQ-issued ID
- FB coupling: `fb_available` must reflect FB occupancy before LRQ expects to transition to WAIT_FB
- Boundary: LRQ full + 3-way concurrent alloc = some allocations rejected (back-pressure to upstream)

- [ ] **Step 3: Write §12 — 验证关注点**

Minimum 20 TPs:
- `LRQ-TP-01` Single load miss → full lifecycle
- `LRQ-TP-02` 3-way concurrent alloc
- `LRQ-TP-03` Spec wakeup from store data forward
- `LRQ-TP-04` Precommit UID gating
- `LRQ-TP-05` L2 response reordering (m3 vs m4 paths)
- `LRQ-TP-06` FB link (2+ entries on same line)
- `LRQ-TP-07` ct_flush purges all
- `LRQ-TP-08` Partial flush (flush_uid younger than some entries)
- `LRQ-TP-09` bx_flush path
- `LRQ-TP-10` LRQ full back-pressure
- `LRQ-TP-11` NC/Device load special path
- `LRQ-TP-12` Livelock detection triggers buster
- `LRQ-TP-13` DVM invalidate via va_region_clear
- `LRQ-TP-14` Wait_id tagging (6 sources)
- `LRQ-TP-15` Timeout for wait_l2resp
- `LRQ-TP-16` Entry stuck in WAIT_OLD_PRECOMMIT → release path
- `LRQ-TP-17` age_matrix(16) correctness under LRQ load
- `LRQ-TP-18` ls_lrq_entry FSM coverage (all 10 states visited)
- `LRQ-TP-19` L3 `ls_lrq_entry` specific bugs (LRQENT-TP-*)
- `LRQ-TP-20` Cross-LRQ interaction with FB link cap

- [ ] **Step 4: Write §13 — 设计陷阱与注记**

- Livelock busters are rare but critical — document chicken bits
- WAIT_STDATA spec wakeup + flush race
- FB credit accounting — mismatch causes stuck entry
- Precommit wrap boundary
- MSHR-adjacent vs integrated — why
- Relevant chicken bits from LSCTL (list from `perseus_ls_ctl.sv`)

- [ ] **Step 5: Write §14 — 参考资料**

- RTL: `perseus_ls_lrq.sv`, `perseus_ls_lrq_entry.sv`, `perseus_ls_age_matrix.sv`
- ARM ARM: Chapter B2 (memory ordering), D5 (translation)
- Internal: `../lsu_top_l1.md`, `../shared_primitives/ls_age_matrix.md`, `./ls_tlb.md`
- Papers: Kroft 1981 "Lockup-free instruction fetch/prefetch cache organization" (MSHR origin)

- [ ] **Step 6: Final full-file consolidated self-check**

All 14 sections. Every LRQ-F has citation. Every waveform labeled. Every `(UNVERIFIED)` justified.

- [ ] **Step 7: Commit + push**

```bash
git add design_docs/submodules/ls_lrq.md
git commit -m "docs(lrq): ls_lrq §11-14 complete — contract, 20 testpoints, pitfalls, refs

ls_lrq.md pilot module doc complete. 2 pilot L2 modules done."
git push origin main
```

- [ ] **Step 8: Gate 17 report**

Ritual D. "LRQ complete. Proceeding to traceability matrix (Gate 18)."

**Stop.**

---

## Task 19 (Gate 18): Traceability Matrix

**Goal:** Produce `traceability.md` with 100% L1 feature coverage — each `LSU-F*` mapped to pilot L2 features or explicitly deferred.

**Files:**
- Create: `/Users/m/claude code/lsu_ut/design_docs/traceability.md`

- [ ] **Step 1: Pre-announce**

"Gate 18 writes traceability matrix. Matches LSU-F* from `lsu_top_l1.md` to TLB-F* / LRQ-F* / LRQENT-F* / AGEMTX-F*, or flags 'deferred'."

- [ ] **Step 2: Extract L1 features from `lsu_top_l1.md`**

```bash
grep -E "^\|.*LSU-F[0-9]" "/Users/m/claude code/lsu_ut/design_docs/lsu_top_l1.md" | head -30
```

For each LSU-F<N>, list its short description.

- [ ] **Step 3: Extract pilot L2/L3 features**

```bash
for f in "/Users/m/claude code/lsu_ut/design_docs/submodules/ls_tlb.md" \
         "/Users/m/claude code/lsu_ut/design_docs/submodules/ls_lrq.md" \
         "/Users/m/claude code/lsu_ut/design_docs/shared_primitives/ls_age_matrix.md"; do
  echo "=== $f ==="
  grep -E "^\|.*[A-Z]+-F[0-9]" "$f" | head -40
done
```

- [ ] **Step 4: Build the matrix**

Table structure:

| L1 Feature | 描述 | 映射到 | 覆盖度 | Pilot 状态 |
|-----------|------|-------|-------|-----------|
| `LSU-F01` | 3 LS pipelines | 分散在 ls_agu/ls_tlb/ls_lrq/... | 部分 | Deferred (L2 ls_agu/ls_ldpipe_ctl) |
| `LSU-F02` | VA→PA translation | `TLB-F01..F20`, `LRQ-F07` (precommit) | 完整 | Covered by ls_tlb.md + ls_lrq.md |
| `LSU-F03` | L1 DCache hit/miss | N/A | 未覆盖 | Deferred (L2 ls_tag_data_arb, ls_tag_arr, ls_data_arr) |
| `LSU-F04` | Load miss tracking (MSHR) | `LRQ-F01..F17`, `LRQENT-F*` | 完整 | Covered by ls_lrq.md |
| `LSU-F05` | Store-to-load forwarding | `LRQ-F06` (部分) | 部分 | Deferred (L2 ls_raw) |
| `LSU-F06` | Memory ordering (DMB/DSB/LDAR) | `LRQ-F07` | 部分 | Deferred (L2 ls_rar) |
| `LSU-F07` | LSE atomic operations | N/A | 未覆盖 | Deferred (L2 ls_atomic_alu) |
| ... | ... | ... | ... | ... |

- [ ] **Step 5: Completeness check**

Every row has one of:
- 部分 / 完整 pilot coverage
- Or explicit Deferred status with named L2 owner

Verify: 100% of `LSU-F*` IDs accounted for.

- [ ] **Step 6: Self-check**

R1 (every cite real), R5 (no fabricated L2 names for deferred items — use actual RTL files).

- [ ] **Step 7: Commit + push**

```bash
cd "/Users/m/claude code/lsu_ut"
git add design_docs/traceability.md
git commit -m "docs(trace): add L1↔L2↔L3 feature traceability matrix

- 100% coverage of LSU-F* IDs
- Each mapped to pilot L2 features (TLB-F*, LRQ-F*) or explicitly deferred"
git push origin main
```

- [ ] **Step 8: Gate 18 report** — Ritual D. **Stop.**

---

## Task 20 (Gate 19): md → docx Conversion

**Goal:** Produce `.docx` versions of all four design documents from their md sources, without hand-editing.

**Files:**
- Create: `/Users/m/claude code/lsu_ut/design_docs/tools/md2docx.js`
- Create: `/Users/m/claude code/lsu_ut/design_docs/lsu_top_l1.docx`
- Create: `/Users/m/claude code/lsu_ut/design_docs/TEMPLATE_L2_MODULE.docx`
- Create: `/Users/m/claude code/lsu_ut/design_docs/submodules/ls_tlb.docx`
- Create: `/Users/m/claude code/lsu_ut/design_docs/submodules/ls_lrq.docx`
- Create: `/Users/m/claude code/lsu_ut/design_docs/shared_primitives/ls_age_matrix.docx`

Note: `.docx` files are in `.gitignore` (see `.gitignore` L14). They are regeneratable artifacts; we don't commit them.

- [ ] **Step 1: Pre-announce**

"Gate 19 builds `md2docx.js` converter and regenerates all five .docx files. Since *.docx is gitignored, commits only the converter script."

- [ ] **Step 2: Write `md2docx.js`**

Use docx-js. Input: a md file path. Output: same-directory .docx with same stem.

Key requirements:
- Parse markdown headings (#, ##, ###, ####) → Word Heading 1/2/3/4
- Parse code fences ``` → Consolas monospace paragraph with light gray shading
- Parse tables (pipe syntax) → Word Tables with borders
- Parse inline code `...` → Consolas inline
- Parse lists (- and 1. ) → bulleted/numbered paragraphs
- Use CJK-compatible font (e.g., `宋体` fallback `SimSun` / English `Times New Roman`)
- Page: A4, 1-inch margins

Use an existing md parser like `marked` (npm) and convert tokens to docx-js primitives.

Exact content to write — save as:

```javascript
#!/usr/bin/env node
// md2docx.js — convert markdown design doc to .docx
// Usage: NODE_PATH=/Users/m/work/nodejs/node-v24.14.1-darwin-arm64/lib/node_modules node md2docx.js <input.md>

const fs = require('fs');
const path = require('path');
const { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
        HeadingLevel, AlignmentType, LevelFormat, BorderStyle, WidthType,
        ShadingType, PageNumber, Header, Footer } = require('docx');

// --- input ---
const input = process.argv[2];
if (!input) { console.error('Usage: md2docx.js <input.md>'); process.exit(1); }
const md = fs.readFileSync(input, 'utf8');

// --- simple line-based parser ---
// (for full parse use `marked`; here we implement enough to handle our design doc subset)

const lines = md.split('\n');
const blocks = []; // { type: 'h1'|'h2'|'h3'|'h4'|'p'|'code'|'table'|'ul'|'ol'|'hr', content: ... }

let i = 0;
while (i < lines.length) {
    const line = lines[i];
    if (line.startsWith('# ') && !line.startsWith('## ')) { blocks.push({type:'h1', text: line.slice(2)}); i++; continue; }
    if (line.startsWith('## ') && !line.startsWith('### ')) { blocks.push({type:'h2', text: line.slice(3)}); i++; continue; }
    if (line.startsWith('### ') && !line.startsWith('#### ')) { blocks.push({type:'h3', text: line.slice(4)}); i++; continue; }
    if (line.startsWith('#### ')) { blocks.push({type:'h4', text: line.slice(5)}); i++; continue; }
    if (line.startsWith('```')) {
        // code block
        const body = [];
        i++;
        while (i < lines.length && !lines[i].startsWith('```')) { body.push(lines[i]); i++; }
        i++; // skip closing ```
        blocks.push({type:'code', text: body.join('\n')});
        continue;
    }
    if (line.startsWith('|') && line.includes('|')) {
        // table
        const tableLines = [];
        while (i < lines.length && lines[i].startsWith('|')) { tableLines.push(lines[i]); i++; }
        // parse table
        const rows = tableLines.map(tl => tl.split('|').slice(1, -1).map(c => c.trim()));
        if (rows.length >= 2 && rows[1].every(c => /^[-:]+$/.test(c))) {
            blocks.push({type:'table', header: rows[0], data: rows.slice(2)});
        } else {
            blocks.push({type:'p', text: tableLines.join('\n')});
        }
        continue;
    }
    if (line.match(/^[-*+]\s/)) { blocks.push({type:'ul', text: line.replace(/^[-*+]\s/, '')}); i++; continue; }
    if (line.match(/^\d+\.\s/)) { blocks.push({type:'ol', text: line.replace(/^\d+\.\s+/, '')}); i++; continue; }
    if (line.trim() === '---') { blocks.push({type:'hr'}); i++; continue; }
    if (line.trim() === '') { i++; continue; }
    blocks.push({type:'p', text: line});
    i++;
}

// --- convert blocks to docx children ---
const children = [];
for (const b of blocks) {
    if (b.type === 'h1') children.push(new Paragraph({heading: HeadingLevel.HEADING_1, children:[new TextRun({text:b.text, bold:true, size:32, font:'Times New Roman'})], spacing:{before:360, after:200}}));
    else if (b.type === 'h2') children.push(new Paragraph({heading: HeadingLevel.HEADING_2, children:[new TextRun({text:b.text, bold:true, size:28, font:'Times New Roman'})], spacing:{before:280, after:160}}));
    else if (b.type === 'h3') children.push(new Paragraph({heading: HeadingLevel.HEADING_3, children:[new TextRun({text:b.text, bold:true, size:24, font:'Times New Roman'})], spacing:{before:220, after:120}}));
    else if (b.type === 'h4') children.push(new Paragraph({heading: HeadingLevel.HEADING_4, children:[new TextRun({text:b.text, bold:true, size:22, font:'Times New Roman'})], spacing:{before:200, after:100}}));
    else if (b.type === 'p') children.push(new Paragraph({children:[new TextRun({text:b.text, size:21, font:'Times New Roman'})], spacing:{before:80, after:80, line:320}}));
    else if (b.type === 'code') {
        for (const ln of b.text.split('\n')) {
            children.push(new Paragraph({children:[new TextRun({text: ln || ' ', size:18, font:'Consolas'})], spacing:{line:260}, shading:{type:ShadingType.CLEAR, fill:'F2F2F2'}}));
        }
    }
    else if (b.type === 'table') {
        const border = {style: BorderStyle.SINGLE, size:4, color:'000000'};
        const cellBorders = {top:border, bottom:border, left:border, right:border};
        const totalWidth = 9026;
        const ncol = b.header.length;
        const colWidth = Math.floor(totalWidth / ncol);
        const widths = new Array(ncol).fill(colWidth);
        const headerRow = new TableRow({tableHeader:true, children: b.header.map((h,idx) => new TableCell({borders:cellBorders, width:{size:widths[idx], type:WidthType.DXA}, shading:{type:ShadingType.CLEAR, fill:'D5E8F0'}, margins:{top:80,bottom:80,left:120,right:120}, children:[new Paragraph({alignment:AlignmentType.CENTER, children:[new TextRun({text:h, bold:true, size:20, font:'Times New Roman'})]})]}))});
        const dataRows = b.data.map(row => new TableRow({children: row.map((cell,idx) => new TableCell({borders:cellBorders, width:{size:widths[idx], type:WidthType.DXA}, margins:{top:80,bottom:80,left:120,right:120}, children:[new Paragraph({children:[new TextRun({text:cell, size:19, font:'Times New Roman'})]})]}))}));
        children.push(new Table({width:{size:totalWidth, type:WidthType.DXA}, columnWidths:widths, rows:[headerRow, ...dataRows]}));
    }
    else if (b.type === 'ul') children.push(new Paragraph({numbering:{reference:'bullets', level:0}, children:[new TextRun({text:b.text, size:21, font:'Times New Roman'})], spacing:{before:40, after:40}}));
    else if (b.type === 'ol') children.push(new Paragraph({numbering:{reference:'numbers', level:0}, children:[new TextRun({text:b.text, size:21, font:'Times New Roman'})], spacing:{before:40, after:40}}));
    else if (b.type === 'hr') children.push(new Paragraph({children:[new TextRun({text:'—————————————————————————', size:18, font:'Times New Roman', color:'808080'})], alignment:AlignmentType.CENTER, spacing:{before:160, after:160}}));
}

// --- build doc ---
const doc = new Document({
    creator: 'LSU RTL Deep-Dive Pilot',
    title: path.basename(input, '.md'),
    numbering: {config: [
        {reference:'bullets', levels:[{level:0, format:LevelFormat.BULLET, text:'•', alignment:AlignmentType.LEFT, style:{paragraph:{indent:{left:720, hanging:360}}}}]},
        {reference:'numbers', levels:[{level:0, format:LevelFormat.DECIMAL, text:'%1.', alignment:AlignmentType.LEFT, style:{paragraph:{indent:{left:720, hanging:360}}}}]}
    ]},
    sections: [{
        properties: {page: {size:{width:11906, height:16838}, margin:{top:1440, right:1440, bottom:1440, left:1440}}},
        headers: {default: new Header({children:[new Paragraph({alignment:AlignmentType.CENTER, children:[new TextRun({text:path.basename(input,'.md'), size:18, font:'Times New Roman', color:'808080'})]})]})},
        footers: {default: new Footer({children:[new Paragraph({alignment:AlignmentType.CENTER, children:[new TextRun({text:'Page ', size:18, font:'Times New Roman'}), new TextRun({children:[PageNumber.CURRENT], size:18, font:'Times New Roman'}), new TextRun({text:' of ', size:18, font:'Times New Roman'}), new TextRun({children:[PageNumber.TOTAL_PAGES], size:18, font:'Times New Roman'})]})]})},
        children
    }]
});

Packer.toBuffer(doc).then(buf => {
    const output = input.replace(/\.md$/, '.docx');
    fs.writeFileSync(output, buf);
    console.log(`Generated: ${output} (${buf.length} bytes)`);
}).catch(e => { console.error('Error:', e); process.exit(1); });
```

- [ ] **Step 3: Test the converter on a small file first**

```bash
cd "/Users/m/claude code/lsu_ut/design_docs"
NODE_PATH=/Users/m/work/nodejs/node-v24.14.1-darwin-arm64/lib/node_modules node tools/md2docx.js shared_primitives/ls_age_matrix.md
```

Expected: `shared_primitives/ls_age_matrix.docx` created with non-zero size.

- [ ] **Step 4: Validate the generated docx**

```bash
cd "/Users/m/claude code/lsu_ut/design_docs"
unzip -p shared_primitives/ls_age_matrix.docx word/document.xml | head -50
```

Expected: valid XML starts with `<?xml version="1.0"` and contains `<w:p>` etc. No parse error.

- [ ] **Step 5: Convert all 5 md files**

```bash
cd "/Users/m/claude code/lsu_ut/design_docs"
for f in lsu_top_l1.md TEMPLATE_L2_MODULE.md submodules/ls_tlb.md submodules/ls_lrq.md shared_primitives/ls_age_matrix.md; do
  NODE_PATH=/Users/m/work/nodejs/node-v24.14.1-darwin-arm64/lib/node_modules node tools/md2docx.js "$f"
done
ls -la lsu_top_l1.docx TEMPLATE_L2_MODULE.docx submodules/*.docx shared_primitives/*.docx
```

All 5 .docx files should exist with reasonable size (>10KB each).

- [ ] **Step 6: Spot-check one docx by opening**

User will need to open one in Word/WPS/Pages to verify no rendering breakage. If breakage found: fix md2docx.js and re-run.

- [ ] **Step 7: Commit converter (not the docx output)**

```bash
cd "/Users/m/claude code/lsu_ut"
git add design_docs/tools/md2docx.js
git commit -m "feat(tools): add md2docx converter for design doc generation

- docx-js based converter supporting headings, tables, code blocks, lists, horizontal rules
- A4 page, Times New Roman for text, Consolas for code
- CJK-compatible font fallback
- Page headers with document title, footers with page numbers
- .docx files remain in .gitignore; converter regenerates on demand"
git push origin main
```

- [ ] **Step 8: Gate 19 report**

Ritual D, plus summary: "5 .docx files generated from md. Converter at `design_docs/tools/md2docx.js`. .docx files not committed (.gitignore rule). Re-run anytime with `node tools/md2docx.js <file.md>`."

**Stop.**

---

## Task 21 (Gate 20): Pilot Acceptance

**Goal:** Final consolidated review. Verify all success criteria from spec §4 are met. Produce a PILOT_COMPLETE.md summary.

**Files:**
- Create: `/Users/m/claude code/lsu_ut/design_docs/PILOT_COMPLETE.md`

- [ ] **Step 1: Pre-announce**

"Gate 20 is pilot acceptance. I'll verify every spec §4 bullet against what we produced, then write PILOT_COMPLETE.md summarizing the pilot, known limitations, and recommended next steps."

- [ ] **Step 2: Run per-module acceptance checklist**

For each of `ls_tlb.md`, `ls_lrq.md`, `ls_age_matrix.md`:

- [ ] Features table exhaustive?
- [ ] Every Feature ID unique, format `<MOD>-F<NN>`?
- [ ] Every feature cites `file:L-L`?
- [ ] Every significant always block explained?
- [ ] Every FSM has diagram?
- [ ] Every external port has width + role + source/sink + stage?
- [ ] Key circuits have RTL excerpts?
- [ ] Verification-focus table present?
- [ ] "Caller contract" present?
- [ ] md-to-docx conversion produces no formatting breakage? (check manually from Gate 19)

Record results in a checklist.

- [ ] **Step 3: Run pilot-wide acceptance checklist**

- [ ] Both L2 docs follow identical structure?
- [ ] Shared primitive written once only?
- [ ] Traceability covers 100% of L1 features?
- [ ] `TEMPLATE_L2_MODULE.md` usable stand-alone?

- [ ] **Step 4: Write `PILOT_COMPLETE.md`**

Content:
- Pilot scope recap
- Files produced (with sizes / line counts)
- Checklist results (from Steps 2-3)
- Known `(UNVERIFIED)` markers — consolidated list (grep for UNVERIFIED across all files)
- Recommended next steps per spec §11 (paths α/β/γ/δ)

```bash
cd "/Users/m/claude code/lsu_ut"
grep -rn "UNVERIFIED" design_docs/ | tee /tmp/unverified.txt
wc -l design_docs/**/*.md design_docs/*.md
```

- [ ] **Step 5: Commit + push**

```bash
cd "/Users/m/claude code/lsu_ut"
git add design_docs/PILOT_COMPLETE.md
git commit -m "docs: pilot acceptance summary

- All spec §4 success criteria verified
- Consolidated UNVERIFIED markers catalogued
- Next steps recommendations per spec §11"
git push origin main
```

- [ ] **Step 6: Final user message**

> "**Pilot complete.**
>
> All 20 gates passed. 5 design documents + traceability + template + converter produced.
>
> Files on GitHub: <https://github.com/muyangxinyu0227-maker/AI-my/tree/main/design_docs>
>
> Next step options (spec §11):
> - **α** Batch-expand remaining ~18 L2 submodules
> - **β** Feed pilot into testpoint-gen
> - **γ** Feed pilot into UVM env for RM upgrade
> - **δ** Abstract pilot process into a new skill
>
> Which (if any) to pursue next?"

**End of plan.**

---

## Appendix A: Per-Task Mode Estimate (pre-computed under 100K threshold)

Estimates computed at plan-write time using Ritual 0 formula. Actual Task execution should re-check — real RTL read/md output may vary (Ritual 0 runs at the start of each Task regardless).

| Task | Gate | RTL (lines) | md (lines) | Est tokens | Per-task Mode |
|------|------|-------------|-----------|-----------|------|
| 1 | — | 0 | 0 | 8K | Inline |
| 2 | 1 | 1000 | 500 | 37K | Inline |
| 3 | 2 | 0 | 300 | 18K | Inline |
| 4 | 3 | 85 (cached) | 200 | 17K | Inline |
| 5 | 4 | 170 (cached) | 400 | 23K | Inline |
| 6 | 5 | grep only | 200 | 16K | Inline |
| 7 | 6 | 800 | 400 | 32K | Inline |
| 8 | 7 | 0 | 300 | 18K | Inline |
| 9 | 8 | 500 | 500 | 30K | Inline |
| 10 | 9 | 2000 | 800 | 58K | Inline |
| 11 | 10 | 500 | 600 | 32K | Inline |
| 12 | 11 | 1000 | 500 | 37K | Inline |
| 13 | 12 | 200 | 300 | 21K | Inline |
| 14 | 13 | 500 | 500 | 30K | Inline |
| 15 | 14 | 3000 | 1000 | 77K | Inline (close to threshold) |
| 16 | 15 | 1500 | 600 | 45K | Inline |
| 17 | 16 | 2000 | 800 | 58K | Inline |
| 18 | 17 | 300 | 500 | 26K | Inline |
| 19 | 18 | 0 | 200 | 16K | Inline |
| 20 | 19 | 0 | ~200 scripting | 20K | Inline |
| 21 | 20 | 0 | 200 | 16K | Inline |

**Per-task verdict:** Under the 100K single-task threshold, all 21 Tasks are pre-computed **Inline**. No individual gate breaks 100K.

**Cumulative main-session trajectory** (coarse estimate, ignoring compaction):

| Checkpoint | Cumulative tokens | 95% trigger? |
|-----------|-------------------|--------------|
| Start of execution | ~200K (already used by design spec + plan + this session's brainstorming) | ⚠️ already close |
| After Task 1 | ~210K | likely fired |
| After Task 5 | ~260K | definitely fired |
| After Task 10 | ~370K | — |
| After Task 15 | ~500K | — |
| After Task 21 | ~650K | — |

**Reality:** The 95% prompt will likely fire **before Task 1 starts** because the current session has accumulated a lot of brainstorming context. At that point user will choose:

- **(a) continue** — risk running out; practically not viable past Task 3-5
- **(b) fresh session** — recommended; new session starts at ~30K, plenty of headroom, Tasks all Inline
- **(c) compact** — mid-option; preserves continuity, hands summary back, can continue Inline for several Tasks

**Expected operating mode:** start a fresh session for execution (option b), then Inline all Tasks with 95% re-check between Tasks 10-15; only switch to Subagent if a specific Task's re-estimate crosses 100K or cumulative prompts fire repeatedly.

**Future expansion note:** When this workflow is reused for other microarchitecture modules (per spec §11 Path α):
- **Trivial modules** (e.g. `ls_age_compare.sv` 40 lines, `ls_stid_add.sv` 100 lines): whole module ~15K tokens, all Inline in one session, no gates needed.
- **Medium modules** (e.g. `ls_wpt.sv` 500 lines, `ls_snoop_entry.sv`): per-gate ~20-40K, all Inline unless session budget tight.
- **Heavy modules** (e.g. `ls_ldpipe_ctl.sv` 1.48MB, `ls_sab.sv` 1.2MB, `ls_fb.sv` 524KB): **some individual Tasks will cross 100K** → per-Task Subagent dispatch, main session stays light.

Ritual 0 is the single gating mechanism; no special handling per module class.

---

## Self-Review Notes (author-side pass)

Applied the writing-plans self-review:

**1. Spec coverage:**
- Spec §5.1 L2 14-section structure → covered in Task 3 (template) + Tasks 7-18 (instances)
- Spec §5.2 shared primitive 8-section → Tasks 4-6
- Spec §5.3 L1 9-section → Task 2
- Spec §6 naming conventions → enforced throughout, referenced in template
- Spec §7 R1-R7 → Ritual B + per-task self-check steps
- Spec §8 gate-based review → 20 gates map 1:1 with Tasks 2-21 (Task 1 is infrastructure prelude)
- Spec §4 success criteria → Task 21 explicit checklist pass

Coverage: complete.

**2. Placeholder scan:**
- No "TBD" / "fill in later" strings found.
- Several `(UNVERIFIED: ...)` placeholders appear inside **task content** (example outputs) — these are how the spec R5 expects authors to mark uncertainty; they are not plan-failure placeholders. Confirmed intentional.
- `<N>` appears in feature ID examples and is intentional — authors replace with actual integer.
- "continue through RTL review" appears once — OK in context where the exact count is RTL-dependent.

**3. Type consistency:**
- Feature ID format `<MOD>-F<NN>` consistent across tasks
- Module abbreviations consistent with spec §6.2
- Ritual names (0/A/B/C/D) consistent — Ritual 0 (Context Budget) added at top, referenced in per-Task Step 1 via "always begins with Ritual 0"
- File paths consistent (`/Users/m/claude code/lsu_ut/...` absolute throughout)
- Ritual B refers to R1-R7 — all defined in spec §7; consistent

No inconsistencies found.

**4. Ritual 0 coverage (post-amendment):**
- Ritual 0 defined with formula, threshold (100K), main-session tracking (95% trigger), and Subagent Dispatch Spec
- Appendix A provides pre-computed per-Task estimates — all 21 Inline under 100K threshold
- Appendix A documents expected main-session trajectory and the likely "start fresh session" decision at the outset
- Per-Task Step 1 wording ("Pre-announce") is kept as-is but spec in Ritual 0 says "Step 1 always begins with Ritual 0" — executor must estimate + check before announcing

**5. Reusability for future L2 modules:**
- Appendix A §"Future expansion note" extends Ritual 0 applicability to trivial / medium / heavy module classes
- No per-class special handling — Ritual 0 is the single gating mechanism
