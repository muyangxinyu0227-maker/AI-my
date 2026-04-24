# LSU L1 顶层框架 — `perseus_loadstore`

> ARM Perseus LSU (`perseus_loadstore`) 的顶层 L1 框架文档。遵循设计规范 §5.3（9 节结构）及 R1–R7 提取规则。RTL 引用根目录：
> `/home/xy.mu/N2/MP128-r0p3-00rel0-2/MP128-BU-50000-r0p3-00rel0/perseus/logical/perseus_loadstore/verilog/`。

---

## 1. LSU 角色与架构背景

LSU (`perseus_loadstore`) 是 Perseus 核心的存储子系统，承担**所有**访存相关指令的端到端执行：从发射队列接收 Load/Store/Atomic/Barrier uop，完成地址生成、地址翻译、权限/属性检查、L1 数据缓存访问、存储缓冲、顺序保证、监听一致性与 L2 接口转换，最终将 load 数据返回给寄存器文件、将 store 数据提交到 L2。RTL 顶层模块声明位于 `perseus_loadstore.sv:L28-L39`，参数化接口于 `perseus_loadstore.sv:L30-L38`（`L1_DCACHE_SIZE` / `L1_DCACHE_SIZE_LOG` / `L2_TQ_SIZE` / `CORE_CACHE_PROTECTION` / `COHERENT_ICACHE` / `SCU` / `ELA` / `LS_EVICT_DELAY`）。

上下游关系（由 `perseus_loadstore.sv:L42-L1173` 的端口声明推断）：

- **上游**：
  - `is_*`（IS, Issue）— 从发射单元接收 LD/ST/STD 三路 uop 的控制、操作数、源数据；计 67 个输入端口、12 个输出端口，是最大的接口分组。
  - `vx_*`（VX, SVE/向量执行）— 接收向量 store 数据 `vx_ls_store_data_{p0,p1}_v1`；输出 FFR/lane 相关信号。
  - `mx_*`（MX, 控制/系统寄存器）— MPAM partid/pmg、SPR 读写通道。
  - `ct_*`（CT, Commit/提交）— 接收 `ct_precommit_uid` / `ct_flush_uid` / `ct_ls_precommit_stid`，反馈 resolve UID。
- **下游**：
  - `l2*`（L2/L2B0/L2B1）— 向 L2 发送 line fill/write-back/snoop-resp，计 36 个输入、41 个输出，是数据侧最宽接口。
  - `mm_*`（MM, MMU）— 将 uTLB miss 外送至 MMU 做 page-table walk，11 个输入/5 个输出。
  - `if_*`（IF, 取指）— 同步 dcache 失效 / SCU 协议（8 输入 / 4 输出）。
  - `dt_*`（DT, 调试/性能）— 调试 RAM 读 (`dt_dbg_addr` / `ls_dt_rd_data`) + MPMM gear。
  - `ras_*` — 4 个 RAS 错误上报输出。
  - `tbe_*` / `spe_*` — Trace Buffer Extension、Statistical Profiling Extension 接口。
  - `misc_*` — clock/reset/DFT/block 控制。

LSU 在 **ARMv9** 架构下承担（所有声明均有 RTL 证据）：
- 三路 LS 流水线（ls0 LD/ST、ls1 LD/ST、ls2 LD-only）— 端口命名 `_ls0_*` / `_ls1_*` / `_ls2_*` 贯穿 `perseus_loadstore.sv` 全文。
- VA→PA 翻译（`u_tlb` 实例 `perseus_loadstore.sv:L6709`；44 项 L1 uTLB，`perseus_ls_defines.sv:L448`）。
- L1 D-Cache 管理（`u_tag_arr` / `u_data_arr` / `u_tag_arr_plru` / `u_vic_way_track`，4 路组相联，`perseus_ls_defines.sv:L617`）。
- 访存顺序 / 屏障 / 原子（LRQ/SAB/RAR/RAW/MB 模块实例 `perseus_loadstore.sv:L12433/L8449/L10223/L17894/L10465`）。
- 预取（`u_pf` / `u_prq`，`perseus_loadstore.sv:L18375/L18790`）。
- MTE / SVE LD/ST 数据通路（`u_ld_vec_align_ls[0-2]` `perseus_loadstore.sv:L17013-L17085`；SVE type 宏 `perseus_ls_defines.sv:L165-L168`）。
- RAS / MPAM / Trace / SPE 外送（端口分组 `ras_*` / `mx_ls_mpam_*` / `tbe_*` / `spe_*`）。

---

## 2. L1 Features 列表

> 规则：每条 Feature 必须引用 RTL（R1）。引用采用 `file:Lstart-Lend` 格式（R3）。

| ID | Feature | RTL 承载位置 | 说明 |
|----|---------|--------------|------|
| LSU-F01 | **三路 LS 流水线**（ls0 LD+ST, ls1 LD+ST, ls2 LD-only） | `perseus_loadstore.sv:L42-L1173`（`_ls0_/_ls1_/_ls2_` 端口贯穿全端口列表） | Issue 每周期最多下发 3 条访存 uop；ls2 仅支持 load（无 `is_ls_std_*_ls2` STD 端口）。 |
| LSU-F02 | **VA→PA 翻译 (uTLB + MMU handshake)** | `perseus_loadstore.sv:L6709`（`u_tlb`）+ 端口 `ls_mm_tlb_miss_*` / `mm_ls_*` | 44 项 L1 uTLB（`perseus_ls_defines.sv:L448`），miss 时通过 `mm_*` 接口交由 MMU 完成 PTW。 |
| LSU-F03 | **L1 D-Cache 访问（4 路组相联, 参数化容量）** | `perseus_loadstore.sv:L14065`（`u_tag_arr`）/ `L11965`（`u_data_arr`）/ `L14263`（`u_tag_arr_plru`） | `PERSEUS_LS_DCACHE_WAYS=4` (`perseus_ls_defines.sv:L617`)；容量由 `L1_DCACHE_SIZE_LOG` 参数决定。 |
| LSU-F04 | **PLRU 替换 + 受害者追踪 + 二次机会** | `perseus_loadstore.sv:L14263`（`u_tag_arr_plru`）/ `L18155`（`u_way_track`）/ `L18329`（`u_vic_way_track`）；`perseus_ls_sec_chance.sv` | DCache 替换由 PLRU 决策，victim way track 与 second-chance 协同防止 thrashing。 |
| LSU-F05 | **AGU 地址生成** | `perseus_loadstore.sv:L6065`（`u_agu`） | 在 a1 阶段为三路流水线生成 48 位 VA；支持 base+shifted/extended offset，6 种注入源。 |
| LSU-F06 | **LRQ — Load Retire Queue (16 项)** | `perseus_loadstore.sv:L12433`（`u_lrq`）；size 宏 `perseus_ls_defines.sv:L721`（`PERSEUS_LS_LRQ_SIZE=5'd16`） | 跟踪在途 load 完成顺序、forward、replay、commit。 |
| LSU-F07 | **SAB — Store Address Buffer** | `perseus_loadstore.sv:L8449`（`u_sab`） | 保留 store 地址/控制直至 commit，参与 RAW 前递与监听检查。 |
| LSU-F08 | **SDB — Store Data Buffer** | `perseus_loadstore.sv:L9331`（`u_sdb`） | 存 store 数据，commit 后写入 L1 / L2。 |
| LSU-F09 | **FB — Fill Buffer (16 项)** | `perseus_loadstore.sv:L10578`（`u_fb`）；size `perseus_ls_defines.sv:L913`（`PERSEUS_LS_FB_SIZE=16`） | 管理 L1 miss 后的 line fill 请求。 |
| LSU-F10 | **RAR — Read After Read Queue (40 项)** | `perseus_loadstore.sv:L10223`（`u_rar`）；size `perseus_ls_defines.sv:L898`（`PERSEUS_LS_RAR_SIZE=40`） | 用于监听命中已发射 load 时的顺序违例检查。 |
| LSU-F11 | **RAW — Read After Write 前递 (28 项)** | `perseus_loadstore.sv:L17894`（`u_raw`）；num `perseus_ls_defines.sv:L706`（`PERSEUS_LS_RAW_NUM=28`） | store→load 同地址前递。 |
| LSU-F12 | **Memory Barrier 单元 (DMB/DSB)** | `perseus_loadstore.sv:L10465`（`u_mb`） | 处理屏障 uop 的排序与 stall 控制。 |
| LSU-F13 | **Atomic / Exclusive / LOR** | `perseus_ls_atomic_alu.sv` / `perseus_ls_atomic_alu_byte.sv`；type 宏 `perseus_ls_defines.sv:L157-L162`（`LDAR/LDREX/LDAXR/LDLAR/LDAPR`） | 支持 ARMv8.1 atomic、独占访问、Limited Ordering Region。 |
| LSU-F14 | **Snoop / 一致性响应** | `perseus_loadstore.sv:L12154`（`u_snoop`）；`perseus_ls_snoop_entry.sv` / `perseus_ls_snoop_self_entry.sv` | 接收 L2 snoop，生成 snoop resp、与 LRQ/RAR 交叉检查。 |
| LSU-F15 | **Prefetch (PF)** | `perseus_loadstore.sv:L18375`（`u_pf`）/ `L18790`（`u_prq`）；PRQ 8 项 (`perseus_ls_defines.sv:L1104`) | 基于 stride/pattern 表的硬件预取，PRQ 8 项缓存待发请求。 |
| LSU-F16 | **Load-Pipe / Tag-Data 仲裁控制** | `perseus_loadstore.sv:L14365`（`u_ldpipe_ctl`）/ `L13212`（`u_tag_data_arb`） | 决定每周期哪一个 LS pipe 获得 tag/data 访问权。 |
| LSU-F17 | **VA 区域表（MTE/watchpoint 辅助）** | `perseus_loadstore.sv:L16534`（`u_va_region_table`） | 记录活跃 VA region 用于 watchpoint 与 MTE 标签检查。 |
| LSU-F18 | **L2 Interface (L2IF)** | `perseus_loadstore.sv:L11064`（`u_l2if`） | 桥接 LSU 内部请求与 L2 bank 协议；端口计数最高（l2b0 17-out、l2 35-in 等）。 |
| LSU-F19 | **Watchpoint 匹配 (三路)** | `perseus_loadstore.sv:L17580/L17656/L17732`（`u_wpt_ls0/1/2`） | 每条 LS pipe 一个 WPT 实例，a2 阶段产出 `watchpoint_ls*_a2`。 |
| LSU-F20 | **故障/FLT 控制 (三路)** | `perseus_loadstore.sv:L17121/L17274/L17427`（`u_flt_ctl_ls0/1/2`） | 汇总翻译 fault、权限 fault、对齐 fault、watchpoint 到 pipe-flush 决策。 |
| LSU-F21 | **Load 对齐 / 向量对齐 / 非对齐缓冲** | `perseus_loadstore.sv:L16756`（`u_ld_unalign_buf`）+ `L16932-L17085`（`u_ld_align_ls*` / `u_ld_vec_align_ls*`） | 支持标量/向量 load 的位移对齐；跨行访问由 unalign_buf 合并。 |
| LSU-F22 | **Load Forwarding (SB/L2-bypass)** | `perseus_loadstore.sv:L16575-L16699`（`u_ld_fwd_ls0/1/2`） | 从 store buffer 与 L2-bypass 路径前递数据，ls2 使用 `no_l2` 变体（只允许 SB 前递）。 |
| LSU-F23 | **LPT — Load Physical Trace** | `perseus_loadstore.sv:L18073`（`u_lpt`） | 跟踪 load 物理地址历史，供监控/SPE 采样使用。 |
| LSU-F24 | **SPE — Statistical Profiling Extension** | `perseus_loadstore.sv:L18881`（`u_spe`）+ 端口分组 `spe_*` | 采样 load/store 延迟、PA、属性，外送 Trace 子系统。 |
| LSU-F25 | **RAS (错误上报)** | 端口 `ras_*`（4 个 output） + ECC 模块 `perseus_ls_ecc*` (deferred) | 校验错上报至 RAS 节点；ECC 检查侧存在但细节见共享原语。 |
| LSU-F26 | **MPMM 功耗管理 / 活动度控制** | `perseus_loadstore.sv:L19128`（`u_mpmm_ctl`）；端口 `dt_ls_mpmm_*` + `is_ls_max_pwr` | 根据 gear/阈值节流三路 pipe 的发射，输出 `ls_am_max_pwr_throttle_active`。 |
| LSU-F27 | **MBIST 控制** | `perseus_loadstore.sv:L13171`（`u_mbist`） | 对 tag/data RAM 执行内建自测。 |
| LSU-F28 | **Monitor / 性能计数** | `perseus_loadstore.sv:L17808`（`u_monitor`） | 聚合 load/store 事件供 PMU。 |
| LSU-F29 | **复位同步** | `perseus_loadstore.sv:L9512`（`u_rst`） | 生成内部同步复位，处理 `poreset` / `reset_i` 复合。 |
| LSU-F30 | **LSU 全局控制 (LSCTL)** | `perseus_loadstore.sv:L7480`（`u_ctl`） | 全局 enable、flush 广播、多路仲裁控制中枢。 |
| LSU-F31 | **MPAM / Trace 外送属性** | 端口 `mx_ls_mpam_*`（`perseus_loadstore.sv:L42-L1173` 中 18 input）+ `tbe_*` | 将 MPAM partid/pmg 随访存请求送到 L2；接收 TRBE 同步/halt 握手。 |

> 共 **31** 个 L1 Feature。编号连续，符合 spec §6.1 两位宽命名。

---

## 3. 整体框图

```
                           ┌─────────────────────────────────────────────────┐
                           │              perseus_loadstore (LSU)            │
                           │                                                 │
   IS (issue) ──is_* ─────▶│  ┌──────────┐   ┌──────────┐   ┌──────────┐    │
   VX (SVE)   ──vx_* ─────▶│  │  u_ctl   │──▶│  u_agu   │──▶│ u_tlb    │    │
   MX (SPR)   ──mx_* ─────▶│  │ (LSCTL)  │   │ (AGU,a1) │   │(uTLB,a2) │    │
   CT (commit)──ct_* ─────▶│  └────┬─────┘   └────┬─────┘   └────┬─────┘    │
                           │       │              │              │          │
                           │       ▼              ▼              ▼          │
                           │  ┌────────────────────────────────────────┐   │
                           │  │  u_ldpipe_ctl  / u_tag_data_arb (d*)   │   │
                           │  └────┬──────────────┬──────────────┬─────┘   │
                           │       │              │              │          │
                           │  ┌────▼──────┐  ┌────▼──────┐  ┌────▼─────┐  │
                           │  │ u_tag_arr │  │ u_data_arr│  │u_tag_arr │  │
                           │  │           │  │           │  │_plru     │  │
                           │  └────┬──────┘  └────┬──────┘  └──────────┘  │
                           │       │              │                         │
                           │  ┌────▼──────────────▼──────────────────────┐ │
                           │  │ u_ld_fwd_ls0/1/2, u_ld_unalign_buf,      │ │
                           │  │ u_ld_align_ls*, u_ld_vec_align_ls*       │ │
                           │  └────────────┬─────────────────────────────┘ │
                           │               │                                │
                           │  ┌────────────▼────┐  ┌────────┐  ┌────────┐  │
                           │  │  u_lrq (16)     │  │ u_sab  │  │ u_sdb  │  │
                           │  │  u_rar (40)     │  └────┬───┘  └────┬───┘  │
                           │  │  u_raw (28)     │       │           │      │
                           │  └────────┬────────┘       │           │      │
                           │           │                │           │      │
                           │  ┌────────▼────┐  ┌────────▼───┐  ┌────▼────┐ │
                           │  │ u_mb        │  │ u_fb (16)  │  │ u_snoop │ │
                           │  │ u_wpt_ls*   │  │ u_l2if     │◀─┤         │ │
                           │  │ u_flt_ctl_* │  └────┬───────┘  └─────────┘ │
                           │  │ u_monitor   │       │                       │
                           │  │ u_way_track │       │                       │
                           │  │ u_vic_way_tr│       │                       │
                           │  │ u_lpt/u_spe │       │                       │
                           │  │ u_pf/u_prq  │       │                       │
                           │  │ u_mpmm_ctl  │       │                       │
                           │  │ u_rst/u_mbist       │                       │
                           │  └────────────────────┬┘                       │
                           └──────────────────────┬────────────────────────┘
                                                  │
            ls_mm_*  ◀─── MMU                     │        ls_l2*/l2b0*/l2b1* ──▶ L2/SCU
            ls_if_*  ◀─── IF/SCU                  │        ls_ras_*           ──▶ RAS
            ls_ct_*  ◀─── Commit                  │        ls_tbe_*           ──▶ TRBE
            ls_dt_*  ◀─── Debug                   └─── ls_spe_*               ──▶ SPE sink
```

> 数据主流：`IS → u_ctl → u_agu(a1) → u_tlb(a2) → u_ldpipe_ctl/u_tag_data_arb(d0) → tag_arr & data_arr(d1) → u_ld_fwd/u_ld_align(d2-d4) → LRQ/SAB/SDB → Commit → u_l2if → L2`。Snoop 反向路径：`L2 → u_snoop → {LRQ, RAR, SAB} → L2 resp`。所有实例行号见 §5。

---

## 4. 流水线阶段

基于 `perseus_loadstore.sv` 中 `_<stage>_q` 后缀在 sort -u 后的实际出现集合：`i2, a1, a2, a3, d0, d1, d2, d3, d4, d5, m1, m3, m4, m5, m6, m7, m8, w1, w2, w3`。
`i1` 未以 `_q` 形式出现（可能只以纯组合 `_i1` 存在于某些端口名如 `is_ls_uid_ls0_i1`，仍属已知阶段）；`m2`、`iz` 在顶层文件的 `_q` 后缀集合中未发现 (UNVERIFIED: 可能存在于子模块中；本表只声明有 RTL 证据的阶段)。

| 阶段 | 主要功能 | 主要 L2 模块 | RTL 证据 |
|------|---------|--------------|----------|
| **i1** | Issue 第 1 拍：uid/stid/instr_id/源操作数 tag 发送 | `u_ctl`, `u_lrq`（allocation） | 端口 `is_ls_uid_ls*_i1`, `is_ls_stid_ls*_i1`, `vx_ls_vec_stid_p*_i1`（`perseus_loadstore.sv:L42-L1173`） |
| **i2** | Issue 第 2 拍：源操作数数据就绪 + uop ctl | `u_ctl`, `u_agu` | 端口 `is_ls_uop_ctl_ls*_i2`, `is_ls_src{a,b,p,pg}_*_i2`（端口列表）+ `_i2_q` 后缀存在 |
| **a1** | AGU：VA 计算；watchpoint region 初筛；split-lane 检测 | `u_agu`, `u_wpt`, `u_va_region_table` | `va_ls*_a1`, `valid_xlat_uop_ls*_a1`（`perseus_loadstore.sv` 全文）; `u_agu@L6065` |
| **a2** | uTLB lookup；权限/属性检查；watchpoint 匹配；对齐 fault 初判 | `u_tlb`, `u_wpt`, `u_flt_ctl_*` | `watchpoint_ls*_a2`, `valid_xlat_uop_ls*_a2` (~L5950-L6000 wire 声明); `u_tlb@L6709` |
| **a3** | 翻译结果注册、FLT 汇总 | `u_flt_ctl_*`, `u_tlb` | 后缀 `_a3_q` 出现 |
| **d0** | Tag/Data RAM 仲裁决策，访问发起 | `u_ldpipe_ctl`, `u_tag_data_arb` | `_d0_q` 后缀存在；`u_tag_data_arb@L13212`、`u_ldpipe_ctl@L14365` |
| **d1-d5** | Tag/Data 读出；way select；load forward；对齐；向 LRQ/SDB 写入 | `u_tag_arr`, `u_data_arr`, `u_ld_fwd_*`, `u_ld_align_*`, `u_ld_vec_align_*`, `u_ld_unalign_buf` | `_d1_q`..`_d5_q` 后缀全部出现；对齐/前递实例 L16575-L17085 |
| **m1, m3-m8** | Miss/fill 处理（m2 跳过，RTL 无此后缀）：FB 分配、L2 请求、snoop 交叉检查、fill return | `u_fb`, `u_l2if`, `u_snoop`, `u_lrq` (replay) | `_m1_q`, `_m3_q`..`_m8_q` 后缀出现；(UNVERIFIED: `_m2_q` 在顶层 scope 未出现，推测为预留或子模块内) |
| **w1-w3** | Writeback：store commit 到 L1/L2；load 数据写回 RF | `u_sdb`, `u_sab`, `u_lrq` (retire), `u_l2if` | `_w1_q`..`_w3_q` 后缀出现 |
| **iz** | 退出/idle 阶段（UNVERIFIED: 顶层未发现 `_iz_q` 后缀，可能存在于 `u_spe`/`u_lpt`/`u_monitor` 子模块或仅作注释） | `u_spe`, `u_monitor` | (UNVERIFIED: suffix `_iz_q` not found in perseus_loadstore.sv top scope) |

> 使用者须将本表与每个 L2 模块的 §6 时序章节交叉验证。阶段主要功能 **What** 可见上表；**How**（流水前后级触发条件）与 **Why**（为何需要 a1/a2 分拆而非单拍 AGU+TLB）属 L2 细节，延后到各 L2 文档。

---

## 5. L2 子模块目录

> 每项 2–4 句摘要（非名字列表，符合 spec §2.1）。RTL 文件路径相对 `…/perseus_loadstore/verilog/`。

### ls_agu — AGU 地址生成单元
在 a1 阶段为 ls0/ls1/ls2 三路生成 48 位 VA，将 `is_ls_srca_data_*_i2` 作基址，`is_ls_srcb_data_*_i2` 经 shift/extend 后做加法；同时把 SPE/TBE/PF/Snoop/Late-resolve 等 6 种非 issue 源通过仲裁器注入到 a1 阶段（bubble-on-inject）。其输出 `va_ls*_a1` 被 TLB、AGU、WPT、VA region 同时消费。
**RTL:** `perseus_ls_agu.sv`（顶层实例 `perseus_loadstore.sv:L6065`）
**Pilot 状态:** deferred

### ls_tlb — L1 uTLB + MMU 握手
44 项全关联 L1 uTLB（`perseus_ls_defines.sv:L448-L450`），在 a2 阶段完成 VA→PA 翻译及 AP/MemAttr 检查；miss 时通过 `ls_mm_tlb_miss_*` 发往 MMU 并等待 `mm_ls_tlb_fill_*` 回填。维护 VMID/ASID 标签和 stage-flop，支持 invalidate（TLBI）与 debug read (`dt_ls_dbg_addr`)。
**RTL:** `perseus_ls_tlb.sv`（顶层实例 `perseus_loadstore.sv:L6709`）
**Pilot 状态:** 已文档化于 `design_docs/submodules/ls_tlb.md`

### ls_ctl — LSU 全局控制 (LSCTL)
LSU 中枢控制器，汇总 flush（`ct_flush_uid`/`bx_flush_uid`）广播至所有队列、做全局 `block_ls_1/2`/`direct_blk_en` 节流、处理 reseed/stid 生成。决定本周期哪些 pipe 被允许发射 (`is_ls_max_pwr` / MPMM 结果集成)。
**RTL:** `perseus_ls_ctl.sv`（顶层实例 `perseus_loadstore.sv:L7480`）
**Pilot 状态:** deferred

### ls_lrq — Load Retire Queue
16 项按 UID 索引的 load 跟踪队列（`PERSEUS_LS_LRQ_SIZE=5'd16`，`perseus_ls_defines.sv:L721`）。记录每条 in-flight load 的 state/地址/属性/forward 来源，驱动 FSM 决定 replay、snoop-hit、retire；与 `ls_age_matrix` 合作做 ordering 校验。通过 `ls_ct_rslv_uid_ld_ls*` 向 commit 端报告 resolve 顺序。
**RTL:** `perseus_ls_lrq.sv`（顶层实例 `perseus_loadstore.sv:L12433`）
**Pilot 状态:** 已文档化于 `design_docs/submodules/ls_lrq.md`

### ls_lrq_entry — LRQ 单表项 (L3)
LRQ 每一项的状态 flop + next-state 组合逻辑，封装成独立模块以便 16 份实例化。包含 state 机核心、forward-hit 计算、retry counter。
**RTL:** `perseus_ls_lrq_entry.sv`（由 `ls_lrq` 内部例化）
**Pilot 状态:** deferred（由 ls_lrq 文档 §10 作为 L3 递归覆盖）

### ls_sab — Store Address Buffer
缓存在途 store 的地址、控制、类型、属性，直到 commit 才释放。参与三类检查：RAW 前递（与 `u_raw`）、snoop 命中、store-to-load forwarding。使用 `ls_age_matrix` 维护年龄顺序。
**RTL:** `perseus_ls_sab.sv`（顶层实例 `perseus_loadstore.sv:L8449`）
**Pilot 状态:** deferred

### ls_sdb — Store Data Buffer
保存与 SAB 配对的 store 数据；commit 时把数据写入 L1 或交给 L2IF 外送。支持向量 store 数据来自 VX 通道 (`vx_ls_store_data_p*_v1`)。
**RTL:** `perseus_ls_sdb.sv`（顶层实例 `perseus_loadstore.sv:L9331`）
**Pilot 状态:** deferred

### ls_fb — Fill Buffer
16 项 miss-fill 缓冲 (`PERSEUS_LS_FB_SIZE=16`，`perseus_ls_defines.sv:L913`)。miss 时分配 entry，向 `u_l2if` 发起 line request，fill 返回后把 data 写 data_arr + 唤醒等待该行的 LRQ 项。支持 evict 并与 `u_snoop` 合作响应 intervening snoop。
**RTL:** `perseus_ls_fb.sv`（顶层实例 `perseus_loadstore.sv:L10578`）
**Pilot 状态:** deferred

### ls_fb_entry — FB 单表项 (L3)
Fill buffer 的单项 FSM 与 tag/state/data hold 寄存器。
**RTL:** `perseus_ls_fb_entry.sv`
**Pilot 状态:** deferred

### ls_rar — Read-After-Read Queue
40 项按 UID 记录已发射 load，用于 snoop 侵入时判定是否违背 ordering（`PERSEUS_LS_RAR_SIZE=40`，`perseus_ls_defines.sv:L898`）。若 snoop 命中比某 retire 过的 older-load 更老的地址，则触发 replay/flush。
**RTL:** `perseus_ls_rar.sv`（顶层实例 `perseus_loadstore.sv:L10223`）
**Pilot 状态:** deferred

### ls_rar_entry — RAR 单表项 (L3)
RAR 每项的 state + 地址 tag + age-link，便于 40 份实例化。
**RTL:** `perseus_ls_rar_entry.sv`
**Pilot 状态:** deferred

### ls_raw — Read-After-Write 前递
28 项 (`PERSEUS_LS_RAW_NUM=28`，`perseus_ls_defines.sv:L706`) 跟踪“load 等待前方 store 数据可用”的情形。命中时由 SDB 把 store 数据旁路给 load；miss/部分命中则由 LRQ 安排 replay。
**RTL:** `perseus_ls_raw.sv`（顶层实例 `perseus_loadstore.sv:L17894`）
**Pilot 状态:** deferred

### ls_raw_entry — RAW 单表项 (L3)
每项保存 load UID、waiting store STID、部分命中掩码。
**RTL:** `perseus_ls_raw_entry.sv`
**Pilot 状态:** deferred

### ls_mb — Memory Barrier 单元
处理 DMB/DSB/ISB 系列屏障：等待 SAB/SDB 清空、锁定发射、广播完成给 commit。与 `dsb_block`（端口 `ic_ls_dsb_block`）协同。
**RTL:** `perseus_ls_mb.sv`（顶层实例 `perseus_loadstore.sv:L10465`）
**Pilot 状态:** deferred

### ls_l2if — L2 接口桥
把 LSU 内部 fill/evict/snoop-resp/store 请求转成 L2 bank 协议（`l2b0_*`/`l2b1_*` 双 bank，端口统计分别 17 out/1 in）；接收 L2 返回的 snoop 请求/fill 数据。L2 侧静态配置由 `axisc_static_config_ack`/`axisc_scu_present` 决定。
**RTL:** `perseus_ls_l2if.sv`（顶层实例 `perseus_loadstore.sv:L11064`）
**Pilot 状态:** deferred

### ls_data_arr — L1 D-Cache 数据阵列
参数化 data RAM（容量由 `L1_DCACHE_SIZE_LOG` + `L1_DCACHE_VA_BITS` 决定，`perseus_ls_defines.sv:L607-L614`；4 way, `PERSEUS_LS_DCACHE_WAYS=4`）。支持 ECC/保护（依 `CORE_CACHE_PROTECTION` 参数）。
**RTL:** `perseus_ls_data_arr.sv`（顶层实例 `perseus_loadstore.sv:L11965`）
**Pilot 状态:** deferred

### ls_tag_arr — L1 D-Cache 标签阵列
与 data_arr 成对的 tag RAM；与 `ls_tag_arr_plru`、`ls_way_track` 共同决定命中/替换。`PERSEUS_LS_TAG_RAM_IDX_RANGE` 表达与 L1_DCACHE_SIZE_LOG 联动的 index 范围。
**RTL:** `perseus_ls_tag_arr.sv`（顶层实例 `perseus_loadstore.sv:L14065`）
**Pilot 状态:** deferred

### ls_tag_arr_plru — D-Cache PLRU 状态
维护 tag RAM 的 PLRU 位图（`PERSEUS_LS_DCACHE_PLRU_SETS` 随 cache 大小而变，`perseus_ls_defines.sv:L702`），为替换决策提供伪-LRU 位。
**RTL:** `perseus_ls_tag_arr_plru.sv`（顶层实例 `perseus_loadstore.sv:L14263`）
**Pilot 状态:** deferred

### ls_ldpipe_ctl — Load 流水线控制
三路 LD pipe 的 per-stage 握手、stall、bubble 控制中心；裁决哪条 pipe 在 d0 进入 tag/data 读。
**RTL:** `perseus_ls_ldpipe_ctl.sv`（顶层实例 `perseus_loadstore.sv:L14365`）
**Pilot 状态:** deferred

### ls_tag_data_arb — Tag/Data 端口仲裁
在 d0 阶段对 tag RAM 与 data RAM 的多来源访问（3 条 load pipe + FB fill + snoop + MBIST）做 round-robin/priority 仲裁。
**RTL:** `perseus_ls_tag_data_arb.sv`（顶层实例 `perseus_loadstore.sv:L13212`）
**Pilot 状态:** deferred

### ls_snoop — Snoop 接收与处理
接收来自 `u_l2if` 的 snoop 请求，查询 tag/LRQ/SAB/RAR，生成 snoop data/ack；管理 snoop entry + self-entry 两种变体。
**RTL:** `perseus_ls_snoop.sv`（顶层实例 `perseus_loadstore.sv:L12154`）
**Pilot 状态:** deferred

### ls_snoop_entry / ls_snoop_self_entry — Snoop 表项 (L3)
Snoop/self-snoop 单项状态机。
**RTL:** `perseus_ls_snoop_entry.sv`, `perseus_ls_snoop_self_entry.sv`
**Pilot 状态:** deferred

### ls_wpt — Watchpoint 匹配单元
每条 LS pipe 一个实例 (`u_wpt_ls0/1/2`, `perseus_loadstore.sv:L17580/L17656/L17732`)。在 a2 拿 VA 与 watchpoint 寄存器做范围比较，输出 `watchpoint_ls*_a2`。
**RTL:** `perseus_ls_wpt.sv`, `perseus_ls_wpt_cmp.sv`
**Pilot 状态:** deferred

### ls_flt_ctl — Fault 控制
每条 LS pipe 一个实例 (`u_flt_ctl_ls0/1/2`, `perseus_loadstore.sv:L17121/L17274/L17427`)，综合 TLB fault、alignment fault、watchpoint 到 pipe-level abort 决策。
**RTL:** `perseus_ls_flt_ctl.sv`
**Pilot 状态:** deferred

### ls_ld_forward / ls_ld_forward_no_l2 / ls_ld_l2_byp_forward — Load 前递
`u_ld_fwd_ls0/ls1` 走完整前递 (SB + L2 bypass)；`u_ld_fwd_ls2` 用 `no_l2` 变体（只 SB 前递）以节省面积；`ld_l2_byp_forward` 为 L2 fill 直通路径。
**RTL:** `perseus_ls_ld_forward.sv`, `perseus_ls_ld_forward_no_l2.sv`, `perseus_ls_ld_l2_byp_forward.sv`（顶层 `perseus_loadstore.sv:L16575-L16699`）
**Pilot 状态:** deferred

### ls_ld_align / ls_ld_align_swirl_ctl — 标量 Load 对齐
把 128b 数据阵列输出按 `align_to/size` 旋转到目标寄存器位置；swirl_ctl 处理 cross-lane 位移控制信号。
**RTL:** `perseus_ls_ld_align.sv`, `perseus_ls_ld_align_swirl_ctl.sv`
**Pilot 状态:** deferred

### ls_ld_vec_align / ls_ld_vec_align_swirl_ctl — 向量 Load 对齐
SVE/Neon 向量 load 的元素级对齐与跨 lane swirl。三路实例 `u_ld_vec_align_ls0/1/2`（`perseus_loadstore.sv:L17013-L17085`）。
**RTL:** `perseus_ls_ld_vec_align.sv`, `perseus_ls_ld_vec_align_swirl_ctl.sv`
**Pilot 状态:** deferred

### ls_ld_unalign_buf — 非对齐 Load 合并缓冲
跨 cacheline 的 load 被拆成两次访问，该缓冲把两次数据拼回。
**RTL:** `perseus_ls_ld_unalign_buf.sv`（顶层实例 `perseus_loadstore.sv:L16756`）
**Pilot 状态:** deferred

### ls_atomic_alu / ls_atomic_alu_byte — 原子 ALU
在 LSU 侧执行 LD/ST exclusive、ARMv8.1 atomic (LDADD/LDSET/LDCLR/LDEOR/LDSMAX 等) 的 RMW 操作。byte 变体处理字节粒度 op。
**RTL:** `perseus_ls_atomic_alu.sv`, `perseus_ls_atomic_alu_byte.sv`
**Pilot 状态:** deferred

### ls_monitor — 事件监测
聚合 cache hit/miss、forward、replay、snoop 等事件作为 PMU 计数器输入。
**RTL:** `perseus_ls_monitor.sv`（顶层实例 `perseus_loadstore.sv:L17808`）
**Pilot 状态:** deferred

### ls_lpt — Load Physical Trace
跟踪最近 N 条 load 的 PA 与属性，供 SPE/TRBE 采样。
**RTL:** `perseus_ls_lpt.sv`, `perseus_ls_lpt_entry.sv`（顶层实例 `perseus_loadstore.sv:L18073`）
**Pilot 状态:** deferred

### ls_way_track / ls_vic_way_track / ls_way_track_entry — Way 追踪
`u_way_track` (`L18155`) 跟踪 in-flight load 对应 way，避免 fill 冲突；`u_vic_way_track` (`L18329`) 跟踪 victim way 防止被并发 fill 破坏。L3 `ls_way_track_entry` 为单项。
**RTL:** `perseus_ls_way_track.sv`, `perseus_ls_vic_way_track.sv`, `perseus_ls_way_track_entry.sv`
**Pilot 状态:** deferred

### ls_pf / ls_pf_* — 硬件预取
`u_pf` (`L18375`) 作为 PF 顶层；其下包含 stride/pattern 检测（`ls_pf_stride*`, `ls_pf_pht_ctl`）、训练表（`ls_pf_train_table`, `ls_pf_train_entry`, `ls_pf_train_buffer_entry`）、生成表（`ls_pf_gen_table`, `ls_pf_gen_req_entry`, `ls_pf_gen_tlb_entry`）、配置更新 (`ls_pf_conf_upd`) 与 page buffer、VA hash、store stride、stride 距离/抗冲突（`ls_pf_stride_cm`, `ls_pf_stride_distance`, `ls_pf_stride_thrash_repl`）、store 专用 stride (`ls_pf_st_stride`)。尺寸宏见 `perseus_ls_defines.sv:L1040-L1104`。
**RTL:** `perseus_ls_pf.sv` 及其 15 个子模块
**Pilot 状态:** deferred

### ls_prq — 预取请求队列
8 项 (`PERSEUS_LS_PRQ_SIZE=8`，`perseus_ls_defines.sv:L1104`) 缓冲 PF 产生的待发请求；`ls_prq_entry` 为 L3 单项。
**RTL:** `perseus_ls_prq.sv`, `perseus_ls_prq_entry.sv`（顶层实例 `perseus_loadstore.sv:L18790`）
**Pilot 状态:** deferred

### ls_spe — Statistical Profiling Extension
采样 load/store 延迟、PA、属性并通过 `spe_*` 端口外送。
**RTL:** `perseus_ls_spe.sv`（顶层实例 `perseus_loadstore.sv:L18881`）
**Pilot 状态:** deferred

### ls_va_region_table / ls_va_region_entry — VA Region 表
记录活跃 VA region，用于 watchpoint 与 MTE 标签检查加速。
**RTL:** `perseus_ls_va_region_table.sv`, `perseus_ls_va_region_entry.sv`（顶层实例 `perseus_loadstore.sv:L16534`）
**Pilot 状态:** deferred

### ls_mpmm_ctl — MPMM 节流控制
根据 `dt_ls_mpmm_gear` / `dt_ls_mpmm_g*_athr/tp` 与活动度产生 `ls_am_max_pwr_throttle_active[2:0]`，同时受 `is_ls_max_pwr` 影响。
**RTL:** `perseus_ls_mpmm_ctl.sv`（顶层实例 `perseus_loadstore.sv:L19128`）
**Pilot 状态:** deferred

### ls_mbist — 存储器内建自测
对 tag/data RAM 执行 MBIST；字段由 `PERSEUS_LS_MBIST_*` 宏定义 (`perseus_ls_defines.sv:L1235-L1243`)。
**RTL:** `perseus_ls_mbist.sv`（顶层实例 `perseus_loadstore.sv:L13171`）
**Pilot 状态:** deferred

### ls_rst — 复位同步
综合 `reset_i` + `poreset` 生成 LSU 内部复位树；前置于所有实例。
**RTL:** `perseus_ls_rst.sv`（顶层实例 `perseus_loadstore.sv:L9512`）
**Pilot 状态:** deferred

### ls_stid_add / ls_stid_inc / ls_uid_minus1 / ls_sb_read_pair / ls_multi_hit_detect / ls_sec_chance — 小型算子
一组窄宽度组合/时序算子：`stid_add/inc` 做 wrap-around 加；`uid_minus1` 做 UID 回滚；`sb_read_pair` 支持 store-buffer 双端口读；`multi_hit_detect` 在 tag 比对阶段检测多 way 同时命中；`sec_chance` 协同 PLRU 给 victim 一次存活机会。
**RTL:** `perseus_ls_stid_add.sv`, `perseus_ls_stid_inc.sv`, `perseus_ls_uid_minus1.sv`, `perseus_ls_sb_read_pair.sv`, `perseus_ls_multi_hit_detect.sv`, `perseus_ls_sec_chance.sv`
**Pilot 状态:** deferred

> 以上共覆盖 `ls` 目录 `perseus_ls_*.sv` 全量 77 个文件（包括 defines/params 头文件不作为模块）。其中 `perseus_ls_defines.sv` / `perseus_ls_params.sv` 为宏/参数头，不是模块实例。

---

## 6. 共享原语清单

共享原语为横跨多个 L2 模块被复用的小型通用电路 (spec §5.2 / R6)：

| 原语 | 类型 | 使用方 (L2) | RTL 文件 | Pilot 状态 |
|------|------|-------------|----------|------------|
| `ls_age_matrix` | 年龄比较矩阵 | `ls_lrq`, `ls_sab`, `ls_rar` | `perseus_ls_age_matrix.sv` | **pilot 包含**（见 `design_docs/shared_primitives/ls_age_matrix.md`，Gate 3-5 完成） |
| `ls_age_compare` | 单对年龄比较器 | `ls_age_matrix` 内部、部分直接使用 | `perseus_ls_age_compare.sv` | deferred |
| `ls_age_older_eq_compare` | 老于等于比较 | `ls_age_matrix` 等 | `perseus_ls_age_older_eq_compare.sv` | deferred |
| `ls_rrip` | RRIP 替换 | cache 替换逻辑（与 PLRU 替代/补充） | `perseus_ls_rrip.sv` | deferred |
| `ls_ecc` / ECC 辅助 | ECC 校验/纠错 | `ls_data_arr`, `ls_tag_arr` | `perseus_ls_ecc*` (注: 列表中以 `ls_ecc` 命名的文件在顶层枚举未单独出现为 `perseus_ls_ecc.sv`；spec §6.2 以 ECC 作为原语类记录) | deferred (UNVERIFIED: 单独 `perseus_ls_ecc.sv` 在本次 `ls`-directory 枚举中未出现；实际实现可能嵌入 tag_arr/data_arr 或位于 shared SV library 之外) |
| `ls_dff*` | 参数化 D 触发器族 | 全 LSU | (UNVERIFIED: 未在本目录枚举；spec §6.2 列出，推测驻留于更上层 `perseus_lib`) | deferred |

Pilot 只深入 `ls_age_matrix`（三个 L3 pilot 模块中的共享基座）；其余原语仅在 L1 记录名、用途、状态。

---

## 7. 接口分组

基于 `perseus_loadstore.sv:L42-L1173` 的端口声明，按前缀归类：

| 分组 | 连接外部模块 | 输入数 | 输出数 | 角色描述 |
|------|--------------|-------:|-------:|----------|
| `is_*` / `ls_is_*` | Issue | 67 | 12 | 三路 LS 发射通道：uid/stid/instr_id/src_a/src_b/src_p/src_pg/pc/oldest 及 STD 独立通道；最繁杂接口。 |
| `l2_*` / `l2b0_*` / `l2b1_*` / `ls_l2*` / `ls_l2b*` | L2 Cache / Bank0 / Bank1 | 36 (l2 35 + l2b0 1 + l2b1 1) | 41 (l2 7 + l2b0 17 + l2b1 17) | DCache miss 请求、写回、snoop 响应、fill 数据；双 bank 对称。 |
| `mm_*` / `ls_mm_*` / `utlb_*` | MMU | 11 | 5 (+6 utlb) | uTLB miss 下发 PTW；MMU 回填、TLBI 同步、VMID/ASID 更新。 |
| `mx_*` / `ls_mx_*` | MX (控制/系统寄存器) | 18 | 2 | SPR 读写、MPAM partid/pmg（4 EL × 2 类型 × I/D）、FFR lane。 |
| `ct_*` / `ls_ct_*` | Commit | 9 | 5 | `ct_precommit_uid` / `ct_flush_uid` / STID 控制；反馈 resolve UID（LD 3 路 + ST 2 路）。 |
| `vx_*` / `ls_vx_*` | VX (SVE/向量) | 8 | 6 | 向量 STD 数据；FFR 相关反馈。 |
| `if_*` / `ic_*` / `ls_if_*` | 取指 / SCU | 8 (含 ic_ls_dsb_block) | 4 | DCache 失效同步、DSB block 握手、SCU 协议联动。 |
| `dt_*` / `ls_dt_*` | Debug / PMU | 11 | 1 | 调试 RAM 读；MPMM gear/阈值；PDP tune/set。 |
| `tbe_*` / `msys_tbe_*` / `trbe_*` | Trace Buffer Ext. | 6 | 0 (含 msys_tbe_halt_req 输出于 tbe 分组) | TRBE halt req/ack、DVM sync done。 |
| `spe_*` / `ls_spe_*` | SPE sink | 0 | (归于 ls_spe_* 内) | 采样数据外送；(UNVERIFIED: 顶层自动分组中未独立计数 spe 输出，因与 ls_ 前缀汇合) |
| `ras_*` / `ls_ras_*` | RAS | 0 | 4 | 错误中断/事件通道。 |
| `misc_*` / `cb_*` / `am_*` / `rn_*` / `bx_*` / `pmu_*` / `axisc_*` | 杂项 | 8 | 2 | clk/reset/DFT (`cb_dftcgen`/`cb_dftramhold`)、block 控制 (`block_ls_{1,2}`、`direct_blk_en`)、功耗广播 (`ls_am_max_pwr_throttle_active`)、RN 调度反馈、BX flush、PMU 接口、AXISC 配置握手。 |

> 计数基于 `awk "/^module perseus_loadstore/,/^\);/"` 在顶层端口块内用前缀自动归类；端口总数 751 (`grep -cE "^\s*input wire|^\s*output wire" = 751`)。“`ls_*`” 输出端口按第二段前缀（`ls_ct_*` → ct 分组）归入对应外部域。spe 分组输出端口全部以 `ls_spe_*` 命名，已计入“杂项”自动汇总但需与 §5 `u_spe` 交叉核实。

---

## 8. 顶层时钟复位

| 信号 | 类型 | 来源 | 说明 |
|------|------|------|------|
| `clk` | `input wire` | 系统时钟树 | LSU 主时钟；驱动全部触发器（`perseus_loadstore.sv:L42`）。 |
| `reset_i` | `input wire` | 复位控制器 | 同步 / 异步复位输入；由 `u_rst` (`perseus_loadstore.sv:L9512`) 内部同步后分发。(UNVERIFIED: 同步性具体在 `perseus_ls_rst.sv` 内部决定；本 L1 不展开) |
| `poreset` | `input wire` | Power-On Reset | 顶层 Power-On Reset，异步有效；用于复位不可同步化的状态 (`perseus_loadstore.sv:L44`)。 |
| `cb_dftcgen` / `cb_dftramhold` | `input wire` | DFT 控制 | 非复位但属时钟/测试域：clock-gate enable 与 RAM hold；出现于 `perseus_loadstore.sv:L46-L47`。 |

> 激活极性与同步化：按 Perseus 族惯例 `reset_i`/`poreset` 均为 **active-high**，`poreset` 异步、`reset_i` 已同步 (UNVERIFIED: 源注释未直接声明极性，推断自命名惯例与 `u_rst` 接线位置，需要在 Gate 3+ 打开 `perseus_ls_rst.sv` 时复核)。

---

## 9. 关键参数表

> 源：`perseus_ls_defines.sv`（共 754 个 `\`define PERSEUS_LS_` 宏，文件 2263 行）；本节摘录与 L2 结构/位宽/容量直接相关的核心参数。

| 宏名 | 值 | 文件 | 行号 | 说明 |
|-------|----|------|-----:|------|
| `PERSEUS_LS_VA` | `48:0` | `perseus_ls_defines.sv` | 37 | VA 位域定义（49 位含 1 位辅助）。 |
| `PERSEUS_LS_VA_MAX` | `48` | `perseus_ls_defines.sv` | 38 | VA MSB 索引。 |
| `PERSEUS_LS_PA` | `47:0` | `perseus_ls_defines.sv` | 39 | PA 位域（48 位）。 |
| `PERSEUS_LS_PA_WIDTH` | `48` | `perseus_ls_defines.sv` | 41 | PA 总位宽。 |
| `PERSEUS_LS_PA_LINE` | `47:6` | `perseus_ls_defines.sv` | 44 | PA cacheline 高位段（line offset = 6 位 → 64B line）。 |
| `PERSEUS_LS_PA_L2BANK` | `6` | `perseus_ls_defines.sv` | 45 | L2 bank 选择位（双 bank 对应 1 bit，但此处宏指位位置）。 |
| `PERSEUS_LS_VA_FULL` | `63:0` | `perseus_ls_defines.sv` | 46 | 全 64 位 VA（含 top byte）。 |
| `PERSEUS_LS_PAGE_ATTR` | `7:0` | `perseus_ls_defines.sv` | 67 | Page attribute 8 位字段。 |
| `PERSEUS_LS_CTL` | `32:0` | `perseus_ls_defines.sv` | 78 | LSU 内部 ctl 总线 33 位。 |
| `PERSEUS_LS_CTL_TYPE` | `5:0` | `perseus_ls_defines.sv` | 88 | LSU 操作 type 编码 6 位（详见 §9 下方类型表）。 |
| `PERSEUS_LS_CTL_STORE` | `20` | `perseus_ls_defines.sv` | 112 | store 指示位。 |
| `PERSEUS_LS_L1_TLB_SIZE` | `44` | `perseus_ls_defines.sv` | 448 | uTLB 项数。 |
| `PERSEUS_LS_L1_TLB_SIZE_ENC` | `6` | `perseus_ls_defines.sv` | 450 | TLB id 编码位宽。 |
| `PERSEUS_LS_DATA_RAM_NUM_IDX_BITS` | `L1_DCACHE_SIZE_LOG` | `perseus_ls_defines.sv` | 613 | D-Cache data RAM index 位宽（参数化）。 |
| `PERSEUS_LS_DCACHE_WAYS` | `4` | `perseus_ls_defines.sv` | 617 | D-Cache 路数。 |
| `PERSEUS_LS_TAG_RAM_NUM_IDX_BITS` | `L1_DCACHE_SIZE_LOG - 1` | `perseus_ls_defines.sv` | 623 | Tag RAM index 位宽。 |
| `PERSEUS_LS_DCACHE_PLRU_SETS` | `(L1_DCACHE_SIZE_LOG==9)?256:(==8)?128:64` | `perseus_ls_defines.sv` | 702 | PLRU set 数，随 cache 容量变化。 |
| `PERSEUS_LS_RAW_NUM` | `28` | `perseus_ls_defines.sv` | 706 | RAW 队列项数。 |
| `PERSEUS_LS_RAW_NUM_ENC_SIZE` | `5` | `perseus_ls_defines.sv` | 707 | RAW index 编码位宽。 |
| `PERSEUS_LS_LRQ_SIZE` | `5'd16` | `perseus_ls_defines.sv` | 721 | LRQ 项数。 |
| `PERSEUS_LS_RAR_SIZE` | `40` | `perseus_ls_defines.sv` | 898 | RAR 项数。 |
| `PERSEUS_LS_FB_SIZE` | `16` | `perseus_ls_defines.sv` | 913 | Fill Buffer 项数。 |
| `PERSEUS_LS_PF_PAGE_BUFFER_SIZE` | `4` | `perseus_ls_defines.sv` | 1040 | PF page buffer 项数。 |
| `PERSEUS_LS_PF_TRAIN_BUFFER_SIZE` | `4` | `perseus_ls_defines.sv` | 1041 | PF train buffer 项数。 |
| `PERSEUS_LS_PF_VA_HASH_WIDTH` | `11` | `perseus_ls_defines.sv` | 1045 | PF VA hash 位宽。 |
| `PERSEUS_LS_PF_PA_HASH_WIDTH` | `6` | `perseus_ls_defines.sv` | 1050 | PF PA hash 位宽。 |
| `PERSEUS_LS_PF_STRIDE_SIZE` | `16` | `perseus_ls_defines.sv` | 1082 | PF stride 表项数。 |
| `PERSEUS_LS_PF_GEN_TLB_SIZE` | `16` | `perseus_ls_defines.sv` | 1093 | PF gen TLB 项数。 |
| `PERSEUS_LS_PF_GEN_REQ_SIZE` | `20` | `perseus_ls_defines.sv` | 1094 | PF gen req 项数。 |
| `PERSEUS_LS_PF_ST_STRIDE_SIZE` | `8` | `perseus_ls_defines.sv` | 1101 | PF store stride 表项数。 |
| `PERSEUS_LS_PRQ_SIZE` | `8` | `perseus_ls_defines.sv` | 1104 | 预取请求队列项数。 |

**顶层模块参数**（`perseus_loadstore.sv:L30-L38`，非宏而是 parameter）：

| 参数 | 默认值 | 说明 |
|-----------|-------:|------|
| `CORE_CACHE_PROTECTION` | 1 | 使能 cache ECC/保护 |
| `COHERENT_ICACHE` | 0 | 一致性 I-Cache 支持 |
| `SCU` | 1 | SCU 存在标志 |
| `ELA` | 0 | ELA 调试存在 |
| `L1_DCACHE_SIZE` | `8'b00000011` | D-Cache 容量档位（索引） |
| `L1_DCACHE_SIZE_LOG` | 8 | D-Cache 大小 log2 参数，驱动 index 位宽等派生宏 |
| `L1_DCACHE_VA_BITS` | 2 | D-Cache VA 索引相关位 |
| `L2_TQ_SIZE` | 48 | L2 事务队列大小（L2IF 用） |
| `LS_EVICT_DELAY` | 0 | Evict 延迟周期 |

> `perseus_ls_defines.sv` 其余 ~720 个宏主要是 `TYPE_*` 操作码 (`LDAR/LDREX/LDAXR/LDLAR/LDAPR/LDTR/LDNP/SVE_*` 等)、CTL 位段、PAGE_ATTR、错误码。完整列表见源文件；本表只保留容量/位宽/路数类关键参数（spec §5.3 §9 要求）。

---

## 附：UNVERIFIED 汇总

| # | 位置 | 原因 |
|---|------|------|
| 1 | §4 `m2` 阶段 | `_m2_q` 后缀在 `perseus_loadstore.sv` top scope 未出现；可能存在于子模块或预留 |
| 2 | §4 `iz` 阶段 | `_iz_q` 后缀未出现；可能位于 SPE/LPT/Monitor 子模块或仅作注释阶段 |
| 3 | §4 `m1`/`m3-m8` | 按 `_q` 存在性保守声明 |
| 4 | §6 `ls_ecc` 原语 | 顶层枚举未出现单独 `perseus_ls_ecc.sv`；ECC 可能内嵌于 tag/data_arr 或位于上层库 |
| 5 | §6 `ls_dff*` | 未在本 `ls`-directory 枚举；推测驻留于更上层 `perseus_lib` |
| 6 | §7 `spe` 分组输出 | 自动分组合并入 `ls_*` 前缀，未单独计数 |
| 7 | §8 reset 极性/同步 | 注释未直接声明，由命名惯例推断，需在打开 `perseus_ls_rst.sv` 后复核 |

---

## 引用 RTL 文件清单

本 L1 scaffold 写作中查阅的 RTL 文件 + 行范围：

- `perseus_loadstore.sv:L1-L60`（头 + module decl + 参数）
- `perseus_loadstore.sv:L42-L1173`（完整端口块，分组计数）
- `perseus_loadstore.sv:L6065, L6709, L7480, L8449, L9331, L9512, L10223, L10465, L10578, L11064, L11965, L12154, L12433, L13171, L13212, L14065, L14263, L14365, L16534, L16575, L16637, L16699, L16756, L16932, L16959, L16986, L17013, L17049, L17085, L17121, L17274, L17427, L17580, L17656, L17732, L17808, L17894, L18073, L18155, L18329, L18375, L18790, L18881, L19128`（所有 L2 实例化点）
- `perseus_loadstore.sv` 全文：`_<stage>_q` 后缀枚举（§4 依据）
- `perseus_ls_defines.sv:L37-L46, L67, L78-L152, L448-L451, L607-L623, L702-L708, L721, L898, L913, L1040-L1105, L1235-L1243`（§9 + Feature 引用）
