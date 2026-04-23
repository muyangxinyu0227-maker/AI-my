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
