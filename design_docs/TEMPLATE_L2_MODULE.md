# [L2 Module Name] Detailed Design

> **模板使用说明:** 将本文件复制到 `design_docs/submodules/<module>.md`，替换 `[L2 Module Name]` 以及所有 `<!-- FILL-IN: ... -->` 注释；填入真实内容后，请删除示例性的斜体行。
>
> **作者必须满足 spec `docs/superpowers/specs/design_spec/2026-04-22-lsu-rtl-deep-dive-design.md` §7 中的 R1-R7 规则。**

## 1. 模块定位

<!-- FILL-IN: 用一句话描述功能角色 + 在 LSU 中的位置 + 关键参数（FSM 状态数、队列深度等） -->

*示例: perseus_ls_xxx 是一个 NN 项的 [结构类型]，提供 [角色]；位于流水线第 [stage] 级，与 [邻接模块] 交互。参数: `ENTRY_NUM=NN`，FSM 状态数=M。*

## 2. Features 列表

<!-- FILL-IN: 完整表格。按规则 R1，每一行都必须引用对应 RTL 位置。 -->

| ID | Feature | RTL 承载位置 | 关联 L1 Feature |
|----|---------|--------------|-----------------|
| `<ABBREV>-F01` | *例如: 44 项 CAM 查找* | *`perseus_ls_xxx.sv:L200-L450`* | *`LSU-F02`* |
| `<ABBREV>-F02` | | | |

## 3. 微架构抽象

<!-- FILL-IN: 采用了哪种教科书模式（CAM / MSHR / age matrix / NRU / RRIP / FIFO / ...）+ 选型理由 + 若适用则给出数学模型。规则 R4: 回答 What/How/Why。 -->

## 4. 整体框图

<!-- FILL-IN: 使用 ASCII 或 WaveDrom 绘制分层数据流框图。 -->

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

<!-- FILL-IN: 仅对重要时序画波形（规则 R7）。重要 = 跨周期握手 / FSM 多状态切换 / 多源并发 / 异常路径。不设配额；琐碎时序可跳过。每张波形都需配有逐周期的文字说明。 -->

### 6.1 Waveform: [场景名]

```
Cycle:                T0   T1   T2   T3
signal_a              __|‾|_____________
signal_b              ____|‾‾|__________
```

逐周期说明:
- T0: ...
- T1: ...

## 7. 时钟复位

<!-- FILL-IN: 时钟来源、复位极性以及同步/异步方式，以及任何门控时钟 / XPROP 保护。 -->

## 8. 关键电路逐层解读

<!-- FILL-IN: 对每一个主要的 always 块 / assign 组:
- §8.X.1 目的（一句话描述其功能语义）
- §8.X.2 RTL 片段（带 `// file:L-L` 头部标注）
- §8.X.3 逐行解读
- §8.X.4 设计理由（为什么这样做 vs. 其他备选方案）
规则 R2: 关键块必须完整引用，不得省略分支。
规则 R4: What/How/Why。
-->

### 8.1 [层名称，例如 "分配逻辑"]

**目的:**

**RTL 片段:**

```systemverilog
// perseus_ls_xxx.sv:L<start>-L<end>
<paste full always block or assign group>
```

**逐段解读:**

**设计理由:**

### 8.2 [下一层]
...

## 9. 状态机

<!-- FILL-IN: 对模块中每一个 FSM:
- 完整的状态转移图（ASCII 即可）
- 触发条件表
- 典型生命周期波形（与 §6 交叉引用）
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

<!-- FILL-IN: 若存在 L3 子模块，每个子模块使用同样的 14 节结构（嵌套）单独成小节。
共享原语（例如 ls_age_matrix）不要在此处重复描述 —— 按规则 R6 链接到 shared_primitives/<name>.md。 -->

### 10.1 [L3 子模块名]

[嵌套的 14 节内容...]

### 10.2 共享原语实例: [primitive name](../shared_primitives/<file>.md)

**实例化参数:** `.PARAM(value)`
**本模块使用:** [简要说明使用场景；不要重复原语自身的描述]

## 11. 调用者契约

<!-- FILL-IN: 对输入的假设（例如 "src_older 向量必须两两一致"）、边界条件、未定义行为场景。 -->

## 12. 验证关注点

<!-- FILL-IN: Feature → testpoint 种子表。ID 采用 `<ABBREV>-TP-<NN>`。这些条目作为后续 testpoint-gen 消费的种子。 -->

| TP ID | 验证对象 Feature | 场景描述 | 预期行为 | 备注 |
|-------|-----------------|---------|---------|------|
| `<ABBREV>-TP-01` | `<ABBREV>-F01` | | | |

## 13. 设计陷阱与注记

<!-- FILL-IN: 容易被忽略的细节、潜在竞争、已知限制、相关 chicken bits。 -->

## 14. 参考资料

- RTL 文件: `perseus_ls_xxx.sv`, [相关文件]
- ARM ARM: *(若适用，引用 DDI0487L_b §X.Y.Z)*
- 论文 / 参考设计: *(例如 RRIP: Jaleel et al. "High Performance Cache Replacement Using Re-Reference Interval Prediction (RRIP)" ISCA 2010)*
- 内部交叉引用: `../lsu_top_l1.md`, `../shared_primitives/<primitive>.md`, `../traceability.md`
