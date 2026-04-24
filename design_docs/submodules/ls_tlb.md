# L2 Module: `perseus_ls_tlb` — 44-entry L1 Data micro-TLB

> Scope of this document in the current pilot gate: **§1 (Module Role) + §2 (Features) + §3 (Microarchitectural Abstraction) + §4 (Block Diagram) + §5 (Port List) + §6 (Important-Timing Waveforms)**.
> §7–§14 will be authored in Tasks 10–11 (Gates 9–10). Do not read later sections here — they do not yet exist.

**Source file under analysis.**
- Path: `perseus/logical/perseus_loadstore/verilog/perseus_ls_tlb.sv`
- Size: ~803 KB, 16,709 lines (`wc -l`)
- Module declaration: `perseus_ls_tlb.sv:L28` (`module perseus_ls_tlb `PERSEUS_LS_ECC_POP_PARAM_DECL`)
- Port list span: `perseus_ls_tlb.sv:L32–L~950` (`grep '^\s*(input|output|inout)' | wc -l` = **757** port-declaration lines)
- Body: `perseus_ls_tlb.sv:L~1000–L16700`

---

## §1 模块定位 (Module Role)

### §1.1 One-sentence role

`perseus_ls_tlb` implements the **44-entry fully-associative L1 data micro-TLB** shared by all three LS pipelines (`ls0` / `ls1` / `ls2`), providing ARMv9-VMSA-compliant VA→PA translation with Stage-1 + Stage-2 nested merging, ASID/VMID tagging, PAN / UAO / TBI / TCMA attribute handling, and the MTE tag-check address path.

**Evidence.**
- 44-entry size: `PERSEUS_LS_L1_TLB_SIZE` macro used as CAM hit-vector width, e.g. `perseus_ls_tlb.sv:L5195` (`tlb_va_coalesced_16k_to_256k_match_ls0_a1[`PERSEUS_LS_L1_TLB_SIZE-1+1:0]`) and loop bound `L4982` (`for (tlb=0; tlb < `PERSEUS_LS_L1_TLB_SIZE+1; tlb=tlb+1)`). Value `44` is supplied by `perseus_ls_params.sv` (not re-opened in this gate; `(UNVERIFIED: 44 value comes from design spec §5.1 — the macro's numeric expansion is deferred to Gate 9 §8 key-circuit walkthrough.)`)
- Three pipelines: every pipeline-facing signal group is triplicated as `_ls0_`, `_ls1_`, `_ls2_` (see port list range `L223–L700`, e.g. `va_ls0_a1` / `va_ls1_a1` / `va_ls2_a1`).

### §1.2 Position within LSU

```
                               perseus_ls_tlb
                                    │
  upstream (a1)                     │                   downstream (a2)
  ─────────────                     │                   ──────────────
  AGU        ──── agu_addend_*, carry_in_*  ──►  ┌─────────────┐
  (ls_agu)        va_lsN_a1 produced inside TLB ◄┤ 3-wide CAM  │──► tlb_any_hit_lsN_a2
                                                 │ (44 entries)│──► permission_lsN_a2
  MMU        ──── mm_ls_tlb_miss_resp_*    ──►   │  + hit/perm │──► ps_lsN_a2 (page size)
  (ls_mm)    ◄─── ls_mm_tlb_miss_*_a2            │  + HD/attr  │──► tlbid_lsN_a2_q
                                                 └─────────────┘──► DCache arb / LRQ / SAB
  Snoop      ──── snp_tmo_* (TLB maintenance)                       (consumers in L2IF, LRQ)
  (ls_snoop) ◄─── tlb_snp_tbw_busy

  SPE/MTE    ◄─── spe_sample_tlb_miss_a2, mte_access_*
```
The TLB is entered at pipeline stage **a1** (CAM lookup on VA produced inline via carry-save adder terms `agu_addend_a/b` + `carry_in`, ports `L218–L223`) and produces hit / permission / page-size / translated-PA at **a2** (e.g. `tlb_any_hit_ls0_a2`, `permission_ls0_a2`, `ps_ls0_a2`).

### §1.3 Active pipeline stages

| Stage | Activity inside `ls_tlb` | RTL witness |
|-------|--------------------------|-------------|
| `i2` | Snoop-TMO context-match pre-compute; injected TMO/address valid flops | `L134–L141`, `L1929–L1935` |
| `a1` | VA formation (final-adder terms) + CAM lookup (44-way page-size-grouped) + attribute compute | `L218–L223`, `L5195–L5267` |
| `a2` | Hit / multi-hit / permission / PA mux / TLB-miss request to MMU | `L451`, `L478`, `L741–L757`, `L11371` |
| `a3` | Miss-valid pipeline flop for downstream quiesce | `L11393`, `L11401` |

### §1.4 Key parameters / macros

| Name | Usage | RTL witness |
|------|-------|-------------|
| `PERSEUS_LS_ECC_POP_PARAM_DECL` | ECC parameterisation wrapper on the module header | `L28` |
| `PERSEUS_LS_L1_TLB_SIZE` | CAM width / entry-loop bound (documented value 44) | `L4982`, `L5195` |
| `PERSEUS_LS_L1_TLB_STG_FLOP` | Sentinel row inside entry iteration (skip/stage flop) | `L4984` |
| `PERSEUS_LS_L1_TLB_PS` | Page-size output width on `ps_lsN_a2` | `L484`, `L568`, `L652` |
| `PERSEUS_LS_TLBID` | TLB-entry-index width on `tlbid_lsN_a2_q` | `L481`, `L565`, `L649` |
| `PERSEUS_LS_TLB_MULTI_HIT_INST` | Parameter bundle for the three `perseus_ls_multi_hit_detect` instances | `L10774`, `L10786`, `L10798` |
| `PERSEUS_LS_L1_TLB_MISS_REQ_TYPE_RANGE` / `_PREF_TYPE` | Outstanding-miss request-type encoding | `L2647–L2650` |
| `PERSEUS_LS_L1_TLB_DBG_RD_INFO_SIZE` | Debug RAM read-out width (MBIST/debug path) | `L818` |

### §1.5 L3 submodules instantiated

Only one L3 *logical* submodule is instantiated (three copies — one per pipeline):

| Instance | L3 Module | Count | RTL site |
|----------|-----------|-------|----------|
| `u_ls0_multi_hit_detect`, `u_ls1_multi_hit_detect`, `u_ls2_multi_hit_detect` | `perseus_ls_multi_hit_detect` | 3 (per pipeline) | `L10774`, `L10786`, `L10798` |

Cell-level primitive instances also present (not counted as L3 modules):
- `perseus_cell_clkgate` — `L2952`, `L3034`, `L3116`, `L14044` (RCG clock gaters for a2 hit-path flops and TLB-wide flop update).
- `perseus_ls_age_compare` — `L11888`, `L11895`, `L11902` (pairwise LS0/LS1/LS2 age comparators for a2 miss-arbitration), plus `L14695`, `L14750`, `L14756`, `L14762`, `L14768` (precommit flush / outstanding-entry flush age compares). These are 2-operand compare helpers, **not** the multi-entry `perseus_ls_age_matrix` shared primitive — see R6 note below.
- `perseus_cell_nandgate` — `L15528`, `L15670`, `L15812` (MTE UID gating).

**No RRIP submodule instance was found in `ls_tlb.sv`** (`grep -nE 'rrip|u_rrip'` returned zero hits against the file). The replacement policy is therefore implemented inline inside `ls_tlb` rather than via an instantiated `perseus_ls_rrip`. `(UNVERIFIED: whether ls_tlb uses RRIP, pseudo-LRU, or random replacement — inline replacement logic scan is deferred to Gate 9 §8.)`

**No `perseus_ls_age_matrix` instance was found in `ls_tlb.sv`** (per R6, the age-matrix shared-primitive doc applies only where instantiated; ls_tlb uses pairwise `perseus_ls_age_compare` only).

### §1.6 FSM state enumerations

Running `grep -nE 'typedef\s+enum|\blocalparam\b.*STATE|\bparameter\b.*STATE'` against `ls_tlb.sv` returns **zero hits**. The module has no SV-enum-typed FSMs at the top level; control is distributed across outstanding-miss trackers (`outstanding_miss_*_q`, `L1754–L1760`), per-pipeline a2 stage flops, and the snoop-TMO invalidate vector (`snp_tmo_invalidate_vec_nxt`, `L1935`). `(UNVERIFIED: whether hand-coded state encodings exist under non-STATE names — a full FSM inventory is deferred to Gate 9.)`

---

## §2 Features 列表

Naming convention per spec §6.1: `TLB-F<NN>`. Linkage column cites the parent L1 feature from `design_docs/lsu_top_l1.md §2` (`LSU-F<NN>`).

All RTL citations are against `perseus_ls_tlb.sv` unless otherwise noted. Line numbers reflect the RTL revision inspected in this gate (PERSEUS-MP128-r0p3-00rel0, 16,709-line file).

| ID | Feature | RTL 承载位置 | 关联 L1 Feature |
|----|---------|--------------|-----------------|
| `TLB-F01` | 44-entry fully-associative CAM lookup at a1, 3 pipelines in parallel, per-pipeline hit vectors aggregated at `any_*_hit_lsN_a1` | `L5195–L5267` (hit-aggregation logic); CAM span `L4982–L~5200` (44-entry loop) | `LSU-F02` |
| `TLB-F02` | TLB-miss request to MMU: `ls_mm_tlb_miss_v_a2` asserts when none of the 3 pipelines hit and the miss is live | `L741` (port), `L11371` (`assign ls_mm_tlb_miss_v_a2 = (tlb_miss_ls0_a2 \| tlb_miss_ls1_a2 \| tlb_miss_ls2_a2) ...`) | `LSU-F02` |
| `TLB-F03` | TLB-miss request payload carries VA, MSID, request ID, non-spec flag, write/atomic/at-op class, va2ipa, priv/PAN, SPE/TRBE class, NFD, RNDR | `L742–L757` (ports `ls_mm_tlb_miss_va_a2`, `_msid_a2`, `_id_a2`, `_non_spec_a2`, `_wr_a2`, `_at_a2`, `_atomic_a2`, `_va2ipa_a2`, `_priv_a2`, `_pan_a2`, `_spe_a2`, `_sample_a2`, `_trbe_a2`, `_nfd_a2`, `_rndr_a2`) | `LSU-F02` |
| `TLB-F04` | TLB-miss response capture from MMU: `mm_ls_tlb_miss_resp_v` with 2-bit ID (4 outstanding), fault flag, PA[48:12], attributes, VA[MAX:25], replay | `L804–L810` (input ports) | `LSU-F02` |
| `TLB-F05` | Up to 4 outstanding TLB-miss transactions tracked via `outstanding_miss_valid_q[3:0]` + `outstanding_miss_type_q` / `_at_op_q` / `_crid_q` / `_mark_invalid_q` | `L2647–L2650` (type decode), `L1754–L1760` (state vectors) | `LSU-F02` |
| `TLB-F06` | Page-size groups: **4K** (`any_4k_hit_lsN_a1`), **coalesced 16K↔256K** (`any_coalesced_hit_16k_to_256k_lsN_a1`), **non-coalesced 16K↔256K** (`any_non_coalesced_hit_16k_to_256k_lsN_a1`); larger sizes handled via separate hit paths | `L1033–L1043`, `L5195–L5197`, `L5222` | `LSU-F02` |
| `TLB-F07` | Per-pipeline page-size output `ps_lsN_a2` carrying decoded size to downstream (DCache index sizing, fault reporting) | `L484`, `L568`, `L652` | `LSU-F02` |
| `TLB-F08` | TLB-entry ID output `tlbid_lsN_a2_q` + `tlbid_lsN_dup_a2_q` (duplicated for fanout) identifies which of 44 entries hit | `L481–L482`, `L565–L566`, `L649–L650` | `LSU-F02` |
| `TLB-F09` | ASID tagging (EL1/EL2) with separate effective-ASID selection and global/non-global (nG) matching | `L42–L44` (`cur_asid_el1`, `cur_asid_el2`, `cur_asid` inputs); `L1929` (`snp_tmo_cr_asid_match_i2`) | `LSU-F02` |
| `TLB-F10` | VMID tagging with 16-bit VMID (`vmid_size_16bits` selector) | `L45`, `L59` (`vmid_size_16bits`), `L1933` (`snp_tmo_cr_vmid_match_i2`) | `LSU-F02` |
| `TLB-F11` | Stage-1 + Stage-2 nested translation: Stage-2 HD input + stage-dependent attribute select | `L107–L110` (`stg1_hd_el1/el2/el3`, `stg2_hd`); stage bits on snoop interface `L141` (`snp_tmo_stage[1:0]`) | `LSU-F02` |
| `TLB-F12` | HW Access/Dirty-bit update: per-EL `stg1_hd_*` + `stg2_hd` drive HD-update path | `L107–L110` | `LSU-F02` |
| `TLB-F13` | AP-based permission output `permission_lsN_a2` (4-bit `permission_bits_out_lsN_a1` → `permission_lsN_a2_q`) | `L478`, `L562`, `L646`, `L1819–L1822` | `LSU-F02` |
| `TLB-F14` | Device-htrap output `tlb_dev_htrap_lsN_a2` for device-memory hyp-trap path | `L467`, `L551`, `L635` | `LSU-F02` |
| `TLB-F15` | PAN (Privileged-Access-Never) handling: `eff_pstate_pan` input + per-pipeline `miss_req_pan_indicator_lsN_a1/a2` + miss-request PAN flag | `L67`, `L1671–L1676`, `L751` (`ls_mm_tlb_miss_pan_a2`) | `LSU-F02` |
| `TLB-F16` | UAO (User-Access-Override) handling via `pstate_uao` | `L68` | `LSU-F02` |
| `TLB-F17` | TBI (Top-Byte-Ignore): `tcr_tbi{0,1}_el{1,2,3}` + derived per-pipeline `eff_tbi_lsN_a1` + output `xlat_tgt_tbi_lsN_a1` | `L92–L96`, `L1265–L1267`, `L925`, `L935`, `L945` | `LSU-F02` |
| `TLB-F18` | TCMA (Tag-Check Bypass): `tcr_tcma{0,1}_el{1,2,3}` + derived `eff_tcma_lsN_a1` | `L82–L86`, `L1268–L1270` | `LSU-F12` (MTE) |
| `TLB-F19` | MTE tag-check address path: MTE mode/access signals + `mte_access_lsN_a2`, `mte_access_stg_lsN_a2`, `mte_allow_flt_lsN_a2`, MTE-UID gating | `L423–L425`, `L470–L474`, `L15528` (`u_inv_gated_uid_ls0_a1_q_8_0`) | `LSU-F12` |
| `TLB-F20` | Unprivileged translation (LDTR/STTR): `xlat_unpriv_lsN_a1` + `xlat_unpriv_lsN_a2_q` + `ldtr_or_sttr_op_lsN_a1` | `L274–L276` (ls0 region), analogous for ls1/ls2 | `LSU-F02` |
| `TLB-F21` | VA-range fault pre-checks: upper-byte-allones/allzeros, bit-55 span, VA > PA_MAX | `L232–L236` (ls0), analogous for ls1/ls2 | `LSU-F02` |
| `TLB-F22` | Multi-hit detection per pipeline via instantiated `perseus_ls_multi_hit_detect` (3 instances) producing `tlb_multi_hit_lsN_a2` | `L2375–L2377`, `L10774–L10798` | `LSU-F02`, `LSU-F11` (RAS) |
| `TLB-F23` | Coalesced multi-hit detection for 4K-vs-16K/256K aliasing: `coalesced_multi_hit_4k_to_256k_lsN_a1` → `_a2_q` | `L1113–L1118`, `L5201–L5267` | `LSU-F02` |
| `TLB-F24` | TLB invalidate / snoop-TMO interface: `snp_tmo_va_valid`, VMID/ASID/sec/el/stage qualifiers, context-match vectors over all 44 entries | `L134–L141`, `L1927–L1935` | `LSU-F02`, `LSU-F08` (snoop) |
| `TLB-F25` | Snoop/TLB-maintenance back-pressure: `tlb_snp_tbw_busy` output + `snoop_stall_tbw_req_a1` / `snoop_sync_inv_tlb_i2` inputs + `tbw_busy` internal | `L143–L145`, `L822` | `LSU-F08` |
| `TLB-F26` | Per-pipeline valid sampling outputs `valid_sampled_xlat_uop_lsN_a1` + `lsN_type_ldpx_a1` used by upstream SPE/validation hooks | `L98–L103` | — |
| `TLB-F27` | SPE (Statistical Profiling) TLB-miss sampling: `spe_sample_tlb_miss_a2` output + `ls_mm_tlb_miss_spe_a2` + SPE inject/replay path | `L104`, `L752`, `L753`, `L11435` | — |
| `TLB-F28` | SPE + MTE combined sampling: `spe_mte_access_ldg_stg_dcg_lsN_a2` | `L477` (ls0), analogous for ls1/ls2 | `LSU-F12` |
| `TLB-F29` | LOR (Limited-Ordering-Region) descriptor tables 0..3: V/SA/EA/N fields matched against translated PA | `L115–L130` (4 descriptor sets), `L1344–L1351` (internal SA/EA copies) | — |
| `TLB-F30` | Forced-miss / hit-post-force-miss paths: `tlb_any_hit_no_force_miss_lsN_a{1,2}_q` + `tlb_any_hit_post_force_miss_lsN_a{1,2}_q` for replay / fence semantics | `L2264–L2278` | `LSU-F02` |
| `TLB-F31` | Outstanding-miss → CAM-VA capture for duplicate-request suppression: `miss_req_cam_va_lsN_a2_q[31:12]` + clock-enables | `L1664–L1669` | `LSU-F02` |
| `TLB-F32` | Prefetch-class outstanding-miss tagging: `pf_outstanding_miss[3:0]` = outstanding slot of type `PREF_TYPE` | `L2647–L2650` | `LSU-F10` (prefetch) |
| `TLB-F33` | Precommit handshake: `lsN_precommit_uop_a1_q` → `lsN_precommit_uop_a2_q` + precommit-uid age compare `u_uid_precommit_flush` | `L254`, `L14695` | `LSU-F02` |
| `TLB-F34` | MTE UID gating (per-pipeline) via `perseus_cell_nandgate` to mask UID when precommit-MTE invalid | `L15528`, `L15670`, `L15812` | `LSU-F12` |
| `TLB-F35` | Cross-pipeline age resolution at a2 via three `perseus_ls_age_compare` instances (ls1-vs-ls0, ls2-vs-ls0, ls2-vs-ls1) for miss-arbitration | `L11888`, `L11895`, `L11902` | `LSU-F02` |
| `TLB-F36` | Outstanding-entry flush age-compare × 4 (one per outstanding slot) for uid-flush-fault path | `L14750`, `L14756`, `L14762`, `L14768` | `LSU-F02` |
| `TLB-F37` | Early MMU wakeup signalling: `early_mm_wakeup_m6_q` drives pending-miss clock-enable | `L147` | `LSU-F02` |
| `TLB-F38` | MBIST / DFT ram-hold + clock-gen-enable: `cb_dftramhold`, `cb_dftcgen`, `chka_disable_ls_rcg` | `L34–L36` | — |
| `TLB-F39` | Debug-RAM read port for TLB entries: `snp_lookup_va_d0`, `dbg_ram_rd_tlb_data` (debug/SW-observability path) | `L814`, `L818` | — |
| `TLB-F40` | ECC parameterisation header `PERSEUS_LS_ECC_POP_PARAM_DECL` on module declaration (enables ECC-array insertion at integration) | `L28` | `LSU-F11` (RAS) |
| `TLB-F41` | RCG (Root Clock Gating) for a2 per-pipeline flop update: `u_clk_tlb_a2_flops_upd_lsN` × 3 + TLB-wide `u_clk_tlb_flops_upd` | `L2952`, `L3034`, `L3116`, `L14044` | — |
| `TLB-F42` | Inline replacement policy (no `perseus_ls_rrip` instance found in file) — policy is implemented within `ls_tlb` itself. `(UNVERIFIED: exact policy — RRIP vs pseudo-LRU vs random — requires Gate 9 §8 walkthrough; spec §5.1 and plan assumed RRIP submodule but grep returned zero hits for 'rrip'/'u_rrip'.)` | inline replacement logic (span TBD in Gate 9); `tlb_replace_inv_any` at `L855` is the only replacement-related *port* witness | `LSU-F02` |
| `TLB-F43` | TLB-miss replay on MMU-side retry: `mm_ls_tlb_miss_resp_replay` input | `L810` | `LSU-F02` |
| `TLB-F44` | Per-slot outstanding-miss VA-CAM against incoming a1 VA to suppress duplicate misses (`miss_req_cam_va_clk_en_lsN_a1`) | `L1664–L1666` | `LSU-F02` |

**Feature count for this gate: 44.** (Plan template listed 20; RTL inspection found additional first-class features — per spec §8 critical-gate guidance, more-is-better on the feature list, since every downstream section in Gates 7–10 must cover them.)

**Unverified-flag inventory (R5 bookkeeping):**
- `TLB-F01` — numeric value 44 behind `PERSEUS_LS_L1_TLB_SIZE` not re-opened in this gate (macro expansion deferred to Gate 9 §8).
- `TLB-F42` — replacement policy not yet identified in RTL; plan/spec assumption of RRIP submodule contradicted by grep.
- §1.5 — possibility of non-`STATE`-named hand-coded state encodings.
- §1.6 — FSM absence claim based on negative `grep` only; exhaustive FSM scan is a Gate-9 deliverable.

---

## §3 微架构抽象 (Microarchitectural Abstraction)

Framing rule for this section (per pilot convention, see `design_docs/shared_primitives/ls_age_matrix.md` §7.1/§7.2/§8.3): the design spec is authoritative; the LSU RTL release under inspection (`MP128-r0p3-00rel0-2 / MP128-BU-50000-r0p3-00rel0`) may realize a pruned or substituted subset. Where the observed RTL diverges from spec intent, both are documented in parallel — **spec-intent** and **current RTL snapshot** — without implying either is wrong. Unverified or deferred items are flagged explicitly per R5.

### §3.1 What — pattern and storage

**What (spec-intent, per plan Task 8 §3 and spec §5.1):** `perseus_ls_tlb` is a **44-entry fully-associative CAM-based L1 data micro-TLB with RRIP replacement**. Each entry is flop-based (not SRAM) and, at the architectural level, carries `{valid, VA[47:12], PA[47:12], ASID, VMID, page_size_code, AP, XN, AF, SH, memattr}` plus reserved/HD bookkeeping.

**What (current RTL snapshot):** the fully-associative CAM and the 44-entry count are directly witnessed in the RTL:

- CAM width / entry-loop bound `PERSEUS_LS_L1_TLB_SIZE` — used as the vector width for per-pipeline hit vectors (`L5195`, `L5222`) and as the entry iteration bound (`L4982`, `for (tlb=0; tlb < `PERSEUS_LS_L1_TLB_SIZE+1; tlb=tlb+1)`).
- Three parallel CAM lookups, one per LS pipeline (hit-aggregation `L5195–L5267`; CAM span `L4982–L~5200`).
- Multi-hit (aliasing) detection via three `perseus_ls_multi_hit_detect` instances `L10774 / L10786 / L10798`, one per pipeline (TLB-F22).
- The **replacement policy is not** a `perseus_ls_rrip` submodule — `grep -nE 'rrip|u_rrip'` on `perseus_ls_tlb.sv` returns zero hits (recorded in §1.5 and TLB-F42). The only replacement-related witness at the port boundary is `tlb_replace_inv_any` at `L855`. The replacement mechanism actually realized in this RTL is therefore **inline logic inside `ls_tlb`**, not an instance of the shared primitive envisaged by plan Task 8. `(UNVERIFIED: spec-intent RRIP not realized in the current RTL snapshot; the actual inline replacement mechanism — RRIP-alike, pseudo-LRU, random, or invalid-first — is deferred to Gate 9 §8 key-circuit walkthrough.)`

Per the framing rule, §3 retains the spec-intent description of "CAM + RRIP" as the architectural pattern while noting the RTL-observed substitution. See cross-reference below.

**Cross-reference.** A shared-primitive document for `ls_rrip` is deferred (no instance in this module; forward reference — Gate 9 §8 will decide whether an `ls_rrip` primitive doc is authored or whether the inline logic stays local to `ls_tlb`). Per R6, this document does not duplicate RRIP internals inline; only the interface-level behaviour is described where needed.

### §3.2 How — lookup / miss / fill / invalidate / replace flows

**Lookup (a1 → a2).** On each cycle, up to three VAs (`va_ls{0,1,2}_a1`, formed inline from AGU carry-save terms `agu_addend_a/b_lsN` + `carry_in_lsN`, ports `L218–L223`) are driven in parallel into the 44-entry CAM. Per-pipeline hit vectors are split by page-size class — 4K (`any_4k_hit_lsN_a1`), coalesced 16K↔256K (`any_coalesced_hit_16k_to_256k_lsN_a1`), and non-coalesced 16K↔256K (`any_non_coalesced_hit_16k_to_256k_lsN_a1`) — consistent with TLB-F06 (`L1033–L1043`, `L5195–L5197`, `L5222`). `page_size_code` selects which VA bits participate in the match (ARMv9 VMSA page-size masking). A one-hot winner is selected by the hit selector to produce `pa` / attributes; `perseus_ls_multi_hit_detect` (× 3) flags aliasing at `tlb_multi_hit_lsN_a2` (TLB-F22).

**Miss (a2).** When none of the three pipelines hit and the miss is live, `ls_mm_tlb_miss_v_a2` asserts at `L741` with assignment driver at `L11371` (`assign ls_mm_tlb_miss_v_a2 = (tlb_miss_ls0_a2 | tlb_miss_ls1_a2 | tlb_miss_ls2_a2) ...`). The outgoing miss-request bundle (VA, MSID, request ID, non-spec, write/atomic/AT-op class, priv/PAN, SPE/TRBE class, NFD, RNDR — TLB-F03) is driven on ports `L742–L757`.

**Response capture (MMU → TLB).** MMU returns PA[48:12], attributes, VA[MAX:25], fault/replay over `mm_ls_tlb_miss_resp_*` (`L804–L810`, TLB-F04). Up to **4 outstanding miss transactions** are tracked via `outstanding_miss_valid_q[3:0]` (`L1754–L1760`) keyed by 2-bit response ID, with type/at-op/crid/mark-invalid side-vectors (`L2647–L2650`, TLB-F05).

**Fill / replacement.** On a miss-response that is not a fault/replay, one of the 44 entries is overwritten with the returned translation. The *choice* of victim is where spec-intent and RTL snapshot diverge:
- **Spec-intent (plan Task 8 §3, design spec §5.1):** RRIP algorithm selects victim using a 2-bit per-entry RRIP counter (lower storage overhead than a full LRU matrix, similar thrash-resistance).
- **Current RTL snapshot:** inline replacement logic; `tlb_replace_inv_any` (`L855`) is a port-level hook suggesting "prefer an invalid entry if any is invalid" as at least one input to victim selection. `(UNVERIFIED: the full inline replacement algorithm — whether it is an inline RRIP-alike, a pseudo-LRU, a random counter, or strict invalid-first with fallback — is not resolved in this gate; resolution deferred to Gate 9 §8, which must walk the replacement-driver logic from `tlb_replace_inv_any` back to the victim-index 1-hot.)`

**Invalidation / snoop TMO (i2).** `snp_tmo_va_valid` + VMID/ASID/sec/el/stage qualifiers (`L134–L141`) drive context-match pre-compute at i2 (`L1927–L1935`, TLB-F24). Matched entries across all 44 are cleared via `snp_tmo_invalidate_vec_nxt` (`L1935`). Back-pressure to snoop is exposed on `tlb_snp_tbw_busy` (`L143–L145`, TLB-F25).

### §3.3 Why — design rationale

| Choice | Rationale | Trade-off |
|--------|-----------|-----------|
| **Fully-associative** | Maximises hit rate at small capacity; avoids set-index aliasing that hurts stride-1 streams on small TLBs. | A 44-port CAM is area-expensive, but 44 entries is small enough to absorb. (`UNVERIFIED: spec §5.1 is the source of the 44 number; justification-level "why 44 not 32/48" is deferred to Gate 9.`) |
| **Flop-based storage (not SRAM)** | 1-cycle lookup is required on the a1→a2 path; SRAM read latency would break timing. | More flops ⇒ more area vs SRAM at the same capacity. |
| **Three parallel CAM read ports (one per LS pipeline)** | Eliminates lookup arbitration between `ls0/1/2`; all three pipelines translate in the same cycle. | Triplicates CAM-match hardware — ~3× compare cones against one shared entry-flop array. |
| **RRIP over full LRU (spec-intent)** | 2 bits per entry vs an `N×N` LRU matrix for N=44; similar thrash-resistance on mixed workloads. | Storage-efficient but more complex promote/demote control. `(UNVERIFIED: RRIP not realized in this RTL snapshot — see §3.1.)` |
| **Inline replacement with `tlb_replace_inv_any` hook (RTL-observed)** | Keeping replacement inside `ls_tlb` avoids a shared-primitive crossing for a single consumer; `tlb_replace_inv_any` lets an external agent bias replacement toward invalid entries. | Loses the shared-primitive reuse story vs a `perseus_ls_rrip` block. `(UNVERIFIED: full rationale pending Gate 9 §8.)` |
| **Up to 4 outstanding misses** | Hides MMU walk latency across multiple a1→a2 streams without blocking the pipeline. | Needs dedicated tracker vectors (`L1754–L1760`) and duplicate-miss CAM (TLB-F44). |
| **Page-size-grouped hit vectors** | 4K vs 16K↔256K (coalesced / non-coalesced) split lets the CAM comparator use a common cone and diverge only at the mask stage — cheaper than parallel per-size CAMs. | Introduces coalesced-multi-hit detection (TLB-F23) to catch 4K↔larger aliasing faults. |

### §3.4 Abstraction rollup (quick reference)

```
                What                          How (per cycle)                       Why
            ┌───────────┐                ┌─────────────────────┐              ┌───────────────┐
            │ 44-entry  │  lookup(a1) → │ 3× parallel CAM     │ → hit(a2)   │ max hit rate  │
            │ FA CAM    │  miss(a2)  → │ miss-req to MMU     │ → resp      │ 1-cyc a1→a2   │
            │ flop-based│  resp      → │ fill + victim select│ → entry wr  │ 4 outstanding │
            │ entries   │  TLBI      → │ CAM match + clear   │ → inv       │ snoop-aware   │
            └───────────┘                └─────────────────────┘              └───────────────┘
             Replace: spec-intent RRIP │ RTL snapshot = inline (UNVERIFIED: Gate 9 §8)
```

### §3.5 Unverified inventory added by this section (R5)

| ID | Claim | Disposition |
|----|-------|-------------|
| U3-1 | RRIP replacement submodule as spec-intent is not realized in current RTL snapshot; actual mechanism is inline | Deferred to Gate 9 §8 — walk replacement driver from `tlb_replace_inv_any` (`L855`) back to the victim 1-hot. |
| U3-2 | "Why 44" capacity justification | Deferred to Gate 9 §8. |
| U3-3 | Entry-field layout `{valid, VA, PA, ASID, VMID, page_size_code, AP, XN, AF, SH, memattr}` is stated at spec-intent granularity; per-bit entry-flop layout in RTL not re-opened this gate | Deferred to Gate 9 §8 key-circuit walkthrough. |
| U3-4 | Whether the inline replacement logic is RRIP-alike, pseudo-LRU, or invalid-first-with-fallback | Deferred to Gate 9 §8. |

---

## §4 整体框图 (Block Diagram)

Framing: one block diagram, with the replacement region showing **two parallel boxes** — a spec-intent RRIP box (dashed / shaded) and an RTL-observed inline-logic box (solid). Per R6, the spec-intent RRIP box is a link, not a duplication: details belong to a future `ls_rrip` shared-primitive doc and/or Gate 9 §8.

### §4.1 ASCII block diagram

```
                        perseus_ls_tlb  (44-entry fully-associative L1 D-TLB)
  ┌──────────────────────────────────────────────────────────────────────────────────────────┐
  │                                                                                          │
  │   ls0 AGU terms ─► [VA form a1] ─┐                                                       │
  │   ls1 AGU terms ─► [VA form a1] ─┤   (L218–L223)                                         │
  │   ls2 AGU terms ─► [VA form a1] ─┤                                                       │
  │                                   │                                                      │
  │                                   ▼                                                      │
  │        ┌──────────────────────────────────────────────────────┐                          │
  │        │  44-entry FA CAM array (flop-based)                  │                          │
  │        │  entry = {V, VA, PA, ASID, VMID, ps_code, AP/XN/AF,  │                          │
  │        │           SH, memattr, HD}    (spec-intent layout)   │                          │
  │        │  loop bound `PERSEUS_LS_L1_TLB_SIZE`  (L4982)        │                          │
  │        │  page-size-grouped hit vectors  (L5195–L5267)        │                          │
  │        │                                                      │                          │
  │        │  ┌─── 3× parallel match cones ──► per-pipe hit vec  │                          │
  │        │  │      (ls0 / ls1 / ls2, same entry array)         │                          │
  │        │  └──► ECC wrapper (PERSEUS_LS_ECC_POP_PARAM_DECL, L28)│                          │
  │        └──────────────────────────────────────────────────────┘                          │
  │              │                 │                  │                                      │
  │              ▼                 ▼                  ▼                                      │
  │   ┌──────────────────┐  ┌──────────────┐  ┌──────────────────────┐                      │
  │   │ multi-hit detect │  │ hit selector │  │ coalesced multi-hit   │                      │
  │   │  × 3 instances    │  │  × 3 (ls0/1/2)│  │  4K↔16K/256K alias    │                      │
  │   │ L10774 / L10786 / │  │  → pa_lsN_a2 │  │  L1113–L1118 /        │                      │
  │   │  L10798 (TLB-F22) │  │  → ps_lsN_a2 │  │  L5201–L5267 (TLB-F23)│                      │
  │   │                   │  │  → perm_lsN  │  │                       │                      │
  │   └─────────┬─────────┘  │  → tlbid_lsN │  └──────────┬────────────┘                      │
  │             │            │    (L478/L481│             │                                   │
  │             │            │     L562/L565│             │                                   │
  │             │            │     L646/L649)             │                                   │
  │             │            └──────┬───────┘             │                                   │
  │             ▼                   │                     ▼                                   │
  │       fault (RAS)               │              fault (alias)                              │
  │                                 │                                                         │
  │                                 ▼                                                         │
  │                   ┌───────────────────────────┐                                           │
  │                   │ miss generator (a2)       │ ── ls_mm_tlb_miss_v_a2 (L741, L11371)    │
  │                   │ duplicate-miss VA CAM     │ ── ls_mm_tlb_miss_{va,msid,id,...}_a2    │
  │                   │  (TLB-F44, L1664–L1669)   │     (L742–L757, TLB-F03)                 │
  │                   └──────────────┬────────────┘                                           │
  │                                  │                                                        │
  │     MMU ──► mm_ls_tlb_miss_resp_* (L804–L810, TLB-F04)                                   │
  │             (pa, attr, va_hi, fault, replay, 2-bit id)                                    │
  │                                  │                                                        │
  │                                  ▼                                                        │
  │                   ┌───────────────────────────┐                                           │
  │                   │ response capture          │                                           │
  │                   │ outstanding tracker ×4    │                                           │
  │                   │  (L1754–L1760, TLB-F05)   │                                           │
  │                   │  type/at_op/crid/mark_inv │                                           │
  │                   └──────────────┬────────────┘                                           │
  │                                  │ fill                                                   │
  │                                  ▼                                                        │
  │   ┌──────────────────────────────────────────────────────────────────────────────────┐   │
  │   │  Replacement region  (§3.1 spec-intent vs RTL snapshot)                          │   │
  │   │                                                                                  │   │
  │   │   ┌───────────────────────────────┐     ┌────────────────────────────────────┐   │   │
  │   │   │  [spec-intent, not in this    │     │ Inline replacement logic           │   │   │
  │   │   │   RTL snapshot — see §3.1 and │     │  (RTL-observed)                    │   │   │
  │   │   │   Gate 9 §8]                  │     │                                    │   │   │
  │   │   │                               │     │  hook: tlb_replace_inv_any  (L855) │   │   │
  │   │   │  perseus_ls_rrip              │     │         (TLB-F42, port witness)    │   │   │
  │   │   │  2-bit RRIP ctr / entry       │     │  internal victim-index logic       │   │   │
  │   │   │  (→ victim index)             │     │   (span TBD — Gate 9 §8)           │   │   │
  │   │   │                               │     │                                    │   │   │
  │   │   │  grep 'rrip|u_rrip' = 0 hits  │     │  (UNVERIFIED: algorithm class —    │   │   │
  │   │   │  in perseus_ls_tlb.sv         │     │   RRIP-alike / pseudo-LRU /        │   │   │
  │   │   │                               │     │   invalid-first / random)          │   │   │
  │   │   └───────────────────────────────┘     └─────────────────┬──────────────────┘   │   │
  │   │                                                           │                      │   │
  │   │                                    victim 1-hot  ─────────┘                      │   │
  │   └──────────────────────────────────┬───────────────────────────────────────────────┘   │
  │                                      │ write-enable                                     │
  │                                      ▼                                                  │
  │                            (entry array ◄─ fill)                                        │
  │                                                                                         │
  │   Snoop / TLBI path (i2) ─────────────────────────────────────────────────────────────  │
  │                                                                                         │
  │   snp_tmo_va_valid  ──┐                                                                 │
  │   snp_tmo_{vmid,asid, ├──► context-match pre-compute (L1927–L1935, TLB-F24)            │
  │            sec,el,stg}│        │                                                        │
  │   (L134–L141)         │        ▼                                                        │
  │                       │   snp_tmo_invalidate_vec_nxt (L1935) ──► clear matched entries  │
  │                       │                                                                 │
  │                       └──► tbw_busy / tlb_snp_tbw_busy (L143–L145, TLB-F25)             │
  │                                                                                         │
  │   ────────────────────────────────────────────────────────────────────────────────────  │
  │                                                                                         │
  │   DFT / MBIST / debug path:                                                             │
  │     cb_dftramhold / cb_dftcgen / chka_disable_ls_rcg  (L34–L36, TLB-F38)                │
  │     snp_lookup_va_d0 / dbg_ram_rd_tlb_data            (L814, L818, TLB-F39)             │
  │     RCG clkgates u_clk_tlb_a2_flops_upd_lsN × 3 +                                       │
  │                 u_clk_tlb_flops_upd     (L2952, L3034, L3116, L14044, TLB-F41)          │
  │                                                                                         │
  │   Cross-pipe age resolution (a2):                                                       │
  │     perseus_ls_age_compare × 3 (L11888, L11895, L11902, TLB-F35)                        │
  │     outstanding-entry flush age_compare × 4 (L14750/56/62/68, TLB-F36)                  │
  │     precommit uid age_compare (L14695, TLB-F33)                                         │
  │                                                                                         │
  └─────────────────────────────────────────────────────────────────────────────────────────┘
```

### §4.2 Block inventory (with RTL witness)

| # | Block | Role | RTL witness (file = `perseus_ls_tlb.sv`) | Feature ID |
|---|-------|------|------------------------------------------|------------|
| 1 | VA formation (a1) × 3 | Form `va_lsN_a1` from AGU carry-save terms | L218–L223 | (upstream interface) |
| 2 | 44-entry FA CAM array | Flop-based entries; 3 parallel match cones | L4982, L5195–L5267 | TLB-F01 |
| 3 | ECC wrapper | Parameterised ECC insertion on entries | L28 | TLB-F40 |
| 4 | Hit selector × 3 | 1-hot → `pa/ps/perm/tlbid_lsN_a2` | L478/L481, L562/L565, L646/L649, L1819–L1822 | TLB-F07, F08, F13 |
| 5 | Multi-hit detect × 3 | Per-pipeline aliasing fault | L10774, L10786, L10798 | TLB-F22 |
| 6 | Coalesced multi-hit | 4K↔16K/256K alias fault | L1113–L1118, L5201–L5267 | TLB-F23 |
| 7 | Miss generator (a2) | `ls_mm_tlb_miss_*` to MMU | L741, L742–L757, L11371 | TLB-F02, F03 |
| 8 | Duplicate-miss VA CAM | Suppress duplicate misses on same VA | L1664–L1669 | TLB-F31, F44 |
| 9 | Response capture + outstanding tracker ×4 | `mm_ls_tlb_miss_resp_*` → slot of 4 | L804–L810, L1754–L1760, L2647–L2650 | TLB-F04, F05, F32 |
| 10a | Spec-intent RRIP box | Shown as `(spec-intent, not in this RTL snapshot — see §3.1 and Gate 9)` | `grep 'rrip\|u_rrip' = 0 hits` in this file | TLB-F42 (spec-intent side) |
| 10b | Inline replacement logic (RTL-observed) | Internal victim selection; port hook `tlb_replace_inv_any` | L855 (port witness); span TBD | TLB-F42 (RTL side) |
| 11 | Snoop-TMO context match (i2) | Qualify + invalidate vector | L134–L141, L1927–L1935 | TLB-F24 |
| 12 | Snoop back-pressure | `tlb_snp_tbw_busy`, `tbw_busy` | L143–L145, L822 | TLB-F25 |
| 13 | DFT/MBIST + debug RAM | `cb_dftramhold` / `snp_lookup_va_d0` / `dbg_ram_rd_tlb_data` | L34–L36, L814, L818 | TLB-F38, F39 |
| 14 | RCG clkgates | a2-flop-update gates × 3 + TLB-wide | L2952, L3034, L3116, L14044 | TLB-F41 |
| 15 | Cross-pipe age compare × 3 | a2 miss-arbitration | L11888, L11895, L11902 | TLB-F35 |
| 16 | Outstanding-entry flush age compare × 4 | uid-flush-fault path | L14750, L14756, L14762, L14768 | TLB-F36 |
| 17 | Precommit uid age compare | precommit-uop flush | L14695 | TLB-F33 |
| 18 | MTE UID gating | `perseus_cell_nandgate` × 3 | L15528, L15670, L15812 | TLB-F34 |
| 19 | LOR descriptors 0..3 | PA-range ordering tables | L115–L130, L1344–L1351 | TLB-F29 |
| 20 | SPE/MTE sampling taps | `spe_sample_tlb_miss_a2`, `spe_mte_access_*` | L104, L477, L752, L753, L11435 | TLB-F27, F28 |

**Block count for this diagram: 20 distinct functional blocks** (10a + 10b counted as one replacement region with two parallel sub-boxes). Every block has at least one RTL line citation or (in the case of spec-intent RRIP box 10a) a negative-grep citation plus a forward reference.

### §4.3 Unverified inventory added by this section (R5)

| ID | Claim | Disposition |
|----|-------|-------------|
| U4-1 | Spec-intent RRIP box is drawn alongside the RTL-observed inline box; the RTL has 0 `rrip`/`u_rrip` hits | Forward-reference to Gate 9 §8 for full resolution of the replacement mechanism. |
| U4-2 | Replacement-logic internal span (lines) is not yet located | Deferred to Gate 9 §8 key-circuit walkthrough. |
| U4-3 | Entry-field storage layout (per-bit layout vs the spec-intent field list) | Deferred to Gate 9 §8. |

---

## §5 接口列表 (Port List)

Framing rule for this section: per Task 7 step 3, the module has **757 port-declaration lines** (`grep -cE '^\s*(input|output|inout)\s+' perseus_ls_tlb.sv` = 757). This exceeds the 100-port threshold in the Gate-8 plan guidance, so the section is organised as **functional-domain subtables**. Each subtable uses the columns requested by the plan: **信号 | 位宽 | 源/目的模块 | 活跃阶段 | 作用**. Source/destination is inferred from signal-name prefix per the pilot convention (`cur_*`/`tcr_*`/`scr_*`/`pstate_*` → system-register / CPU context; `ls_mm_*` → outbound to MMU (`ls_mm`); `mm_ls_*` → inbound from MMU; `snp_*` → Snoop/TMO; `agu_*` → AGU; `is_*` / `issue_v_*` → Issue; `spe_*` → SPE profiler; `tbe_*` → TRBE; `pmu_*` → PMU; `cb_dft*` / `chka_*` → DFT; `pf_*` → prefetcher; `sb_*` → SAB; `ct_*` → context-track / commit-track; `flush*` → Flush network). Active stage is read off the `_i2` / `_a1` / `_a2` / `_a3` / `_d2` / `_d3` / `_t4` / `_m6` suffixes; unsuffixed signals are treated as **static / configuration** (sampled once or held across many cycles).

Line numbers in the 源/目的 column's witness reference the `perseus_ls_tlb.sv` RTL under inspection (MP128-r0p3-00rel0). Where a signal has no stage suffix, the 活跃阶段 column reads **static** rather than a pipeline letter.

`(UNVERIFIED: per-bit widths that expand from `PERSEUS_*` macros (e.g. `PERSEUS_UID`, `PERSEUS_LS_PA`, `PERSEUS_LS_TLBID`, `PERSEUS_TLB_PERM_INFO_RANGE`) are carried as the macro name — numeric expansion is deferred to Gate 9 §8 key-circuit walkthrough, consistent with the R5 disposition established in §1.4 / §3.5.)`

### §5.1 Inputs (by functional domain)

#### §5.1.1 Clock / Reset / DFT (L32–L36)

| 信号 | 位宽 | 源模块 | 活跃阶段 | 作用 |
|------|------|--------|----------|------|
| `clk` | 1 | LSU top-level clock tree | continuous | Module clock. |
| `reset_i` | 1 | LSU reset network | async | Active-high asynchronous reset for all flops. |
| `cb_dftramhold` | 1 | DFT controller (`cb_`) | static (test mode) | DFT RAM-hold; freezes entry-flop updates during scan/MBIST. |
| `cb_dftcgen` | 1 | DFT controller | static (test mode) | DFT clock-gen enable — forces clock gaters transparent. |
| `chka_disable_ls_rcg` | 1 | Check / DFT path | static | Disables LS RCG (root clock gating) for debug / ATPG. |

#### §5.1.2 CPU context / System registers (L39–L96, L900–L906)

| 信号 | 位宽 | 源模块 | 活跃阶段 | 作用 |
|------|------|--------|----------|------|
| `cur_mmuon` | 1 | CPU context | static | MMU-enabled indicator (selects translated vs flat mode). |
| `cur_vmon` | 1 | CPU context | static | Virtualisation-enabled indicator (Stage-2 relevance). |
| `cur_usr` | 1 | CPU context | static | Current-EL is EL0 (unprivileged) indicator. |
| `cur_asid_el1` / `cur_asid_el2` / `cur_asid` | 16 each | CPU context | static | Current ASID per EL and effective ASID for CAM tag match. |
| `cur_vmid` | 16 | CPU context | static | Current VMID (Stage-2 / nested translation tag). |
| `c_bit` | 1 | CPU context | static | Current `C` flag (secure/non-secure translation). |
| `ct_sample_sys_or_pstate_dly` / `ct_sample_sys_dly_q` / `ct_sample_pstate` / `ct_sample_pstate_dly_q` | 1 each | Context-track (`ct_`) | static (sample-window) | Commit-track sample pulses/delays for sys-reg / PSTATE re-sampling of TLB context. |
| `cur_hyp` | 1 | CPU context | static | Current-EL is EL2 (hypervisor) indicator. |
| `cpsr_aarch32` | 1 | CPU context | static | PSTATE AArch32 vs AArch64 selector. |
| `cur_msid` | 3 | CPU context | static | Current Memory-Space-ID (used by snoop-TMO match and miss-req payload). |
| `ls_dev_reorder_disable` | 1 | LS control | static | Disable device-memory reorder (gates dev-early outputs). |
| `eff_hcr_e2h` / `at_s1op_as_ipa` / `raw_e2h` / `hcr_tge` | 1 each | CPU context | static | HCR-derived effective flags for nested / E2H translations. |
| `vmid_size_16bits` | 1 | CPU context | static | VMID width selector (16 vs 8 bits) — TLB-F10. |
| `tcr_el1_as` / `tcr_el2_as` | 1 each | CPU context | static | TCR ASID-size selector per EL. |
| `ls_disable_va_frc_range_flt` | 1 | LS control | static | Disables VA-range fault forcing (debug / bring-up). |
| `eff_hcr_nv` / `eff_hcr_nv1` | 1 each | CPU context | static | NV1/NV hyp-virt bits (nested-virt translation class). |
| `scr_el3_eel2_q` / `scr_el3_ns_q` | 1 each | CPU context | static | SCR_EL3 effective-EL2 / NS bits. |
| `eff_pstate_pan` | 1 | CPU context | static | Effective PSTATE.PAN (TLB-F15). |
| `pstate_uao` | 1 | CPU context | static | PSTATE.UAO (TLB-F16). |
| `m_bit_secure_el01` / `m_bit_el3` / `m_bit_hyp` / `m_bit_nonsec_el01` | 1 each | CPU context | static | Per-EL M-bit (MMU-enable) fanout. |
| `cpsr_el` | 2 | CPU context | static | Current EL encoding. |
| `ls_64_tick_tock_change_q` / `ls_512_tick_tock_change_q` | 1 each | LS timer / watermark | static | Coarse timers for prefetch / age aging. |
| `lsN_ld_pf_hit_count_sat_fb_a1_q` (N=0,1,2) | 1 each | LS prefetcher | a1 | LD prefetch hit-count saturated (per pipe). |
| `ls_mm_idle_sys_req` | 1 | `ls_mm` | static | MMU is in idle/system-req mode — suppresses new miss submission (seen in `L11371` miss-valid gate). |
| `tcr_tcma{0,1}_el{1,2,3}` | 1 each (×6) | CPU context | static | TCMA (Tag-Check-Bypass) per TTBR/EL — TLB-F18. |
| `pstate_tco` | 1 | CPU context | static | PSTATE.TCO (MTE tag-check override). |
| `prec_mte_va_uid_q` / `prec_mte_uid_vld_q` | `PERSEUS_UID` / 1 | Precommit (MTE) | static (held) | Precommit MTE uid + valid (MTE UID gating, TLB-F34). |
| `tcr_tbi{0,1}_el{1,2,3}` | 1 each (×6) | CPU context | static | TBI (Top-Byte-Ignore) per TTBR/EL — TLB-F17. |
| `c_bit_ns_el1` / `c_bit_ns_el1_s1` / `c_bit_aarch64_el3` / `c_bit_s_el1` / `c_bit_hyp_el2` | 1 each | CPU context | static | Per-EL/context `C` bits for translation-output attribute path. |
| `force_nc_s2_el1_0_raw` / `force_nc_s2_el1_0` | 1 each | CPU context | static | Force non-cacheable on Stage-2 for EL1/0 (debug/config). |

#### §5.1.3 HD / Stage-2 / Fault-decoder inputs (L107–L113, L908–L916)

| 信号 | 位宽 | 源模块 | 活跃阶段 | 作用 |
|------|------|--------|----------|------|
| `stg1_hd_el1` / `stg1_hd_el2` / `stg1_hd_el3` / `stg2_hd` | 1 each | CPU context (HD update) | static | HW Access/Dirty update enable per stage/EL — TLB-F11/F12. |
| `tcr_nfd0` / `tcr_nfd1` | 1 each | CPU context | static | TCR.NFDx (non-fault debug) selectors. |
| `fault_status_lsN_a2` (N=0,1,2) | `PERSEUS_PFLT_INFO_FS` | LS fault encoder | a2 | Per-pipe fault-status input (feeds SPE/TRBE buffer flt outputs). |
| `prc_abort_hyp_lsN_a2` (N=0,1,2) | 1 each | LS abort/Hyp trap | a2 | Hyp-abort indicator used by permission/htrap outputs. |
| `spe_owning_el2` / `spe_owning_ns` | 1 each | SPE | static | SPE buffer owning EL/NS qualifier. |
| `tbe_owning_el2` / `tbe_owning_ns` / `trblimitr_el1_nvm_q` / `ls_chsw_disable_tbe_replay` | 1 each | TRBE | static | TRBE ownership + chsw-disable (TRBE buffer path). |

#### §5.1.4 LOR descriptors (L115–L130)

| 信号 | 位宽 | 源模块 | 活跃阶段 | 作用 |
|------|------|--------|----------|------|
| `lor_descK_v` (K=0..3) | 1 each | CPU context (LOR table) | static | Valid bit for LOR descriptor K (TLB-F29). |
| `lor_descK_sa_q` / `lor_descK_ea_q` (K=0..3) | `PERSEUS_LS_PA_MAX:16` each | CPU context | static | Start/End address of LOR region K. |
| `lor_descK_n_q` (K=0..3) | `PERSEUS_LS_LOR_ID` each | CPU context | static | LOR region id. |

#### §5.1.5 Snoop / TLBI (TMO) interface (L134–L145)

| 信号 | 位宽 | 源模块 | 活跃阶段 | 作用 |
|------|------|--------|----------|------|
| `snp_tmo_va_valid` | 1 | Snoop / TLBI agent | i2 | TLB maintenance operation valid — triggers context-match precompute (TLB-F24, L1927–L1935). |
| `snp_tmo_vmid` / `snp_tmo_vmid_valid` | 16 / 1 | Snoop | i2 | TMO VMID qualifier + valid. |
| `snp_tmo_asid` / `snp_tmo_asid_valid` | 16 / 1 | Snoop | i2 | TMO ASID qualifier + valid. |
| `snp_tmo_sec` | 1 | Snoop | i2 | TMO secure/non-secure qualifier. |
| `snp_tmo_el` | 2 | Snoop | i2 | TMO target-EL qualifier. |
| `snp_tmo_stage` | 2 | Snoop | i2 | TMO translation-stage qualifier (S1/S2). |
| `snoop_stall_tbw_req_a1` | 1 | Snoop | a1 | Snoop stalls TBW request (drives `tbw_busy`). |
| `snoop_sync_inv_tlb_i2` | 1 | Snoop | i2 | Sync-invalidate pulse (TLB-F25). |

#### §5.1.6 MMU wakeup / cross-cycle hints (L148)

| 信号 | 位宽 | 源模块 | 活跃阶段 | 作用 |
|------|------|--------|----------|------|
| `early_mm_wakeup_m6_q` | 1 | `ls_mm` (MMU) | m6 | Early MMU-wakeup hint used as clock-enable for pending-miss flops (TLB-F37). |

#### §5.1.7 Per-pipeline Issue / i2 hand-off (L151–L202) — three pipes

Block repeated **three times** (`_ls0_i2`, `_ls1_i2`, `_ls2_i2`). Rows listed once with `N∈{0,1,2}`:

| 信号 | 位宽 | 源模块 | 活跃阶段 | 作用 |
|------|------|--------|----------|------|
| `lsN_uop_older_than_ls1_i2` (N=0 only, L151) | 1 | LS age-matrix feed | i2 | Pre-age relation between ls0 and ls1 at i2. |
| `unalign2_lsN_i2` | 1 | LS pipeline | i2 | Second-access of an unaligned split detected at i2. |
| `ls_uop_ctl_lsN_i2_q` | `PERSEUS_LS_CTL` | Issue | i2 | Full control-bundle of the i2 uop. |
| `issue_v_lsN_i2_q` / `issue_v_lsN_i2` | 1 / 1 | Issue | i2 | Issue-valid (flopped / raw). |
| `uid_lsN_i2_q` | `PERSEUS_UID` | Issue | i2 | uop-id. |
| `rid_lsN_i2_q` | 1 | Issue | i2 | Retire-id bit. |
| `instr_id_lsN_i2_q` | 64 | Issue | i2 | Full instruction ID for debug/perf. |
| `lsN_st_pf_on_rst_full_a1_q` | 1 | LS prefetcher | a1 | ST prefetch reset-full indicator (carried through). |
| `tmo_inject_val_lsN_i2` | 1 | TMO / LSU-arb | i2 | TLB-maintenance op injection valid at i2. |
| `address_inject_val_lsN_i2_q` | 1 | LS inject path | i2 | Address-inject valid (debug/replay). |
| `pf_tlb_inject_v_lsN_i2` | 1 | Prefetcher | i2 | Prefetcher-initiated TLB lookup inject valid. |

#### §5.1.8 Per-pipeline a1 VA / AGU / control (L209–L263, L490–L505, L574–L589, L658–L673) — three pipes

Again repeated for N∈{0,1,2}:

| 信号 | 位宽 | 源模块 | 活跃阶段 | 作用 |
|------|------|--------|----------|------|
| `agu_addend_a_lsN_a1_q` / `agu_addend_b_lsN_a1_q` | 64 each | AGU | a1 | VA final-adder carry-save operands. |
| `carry_in_lsN_a1_q` | 1 | AGU | a1 | VA final-adder carry-in. |
| `lsN_fast_cout11_a1` | 1 | AGU | a1 | Fast carry-out at bit 11 (page-offset boundary). |
| `lsN_uop_flush_a1` | 1 | Flush net | a1 | Flush the a1 uop. |
| `unalign1_lsN_a1` | 1 | LS unalign detect | a1 | First-access of an unaligned split at a1. |
| `reject_unalign_lsN_a1` | 1 | LS unalign detect | a1 | Unalign-reject input. |
| `tlb_cam_v_ld_st_ccpass_lsN_a1` | 1 | LS arb | a1 | TLB CAM-valid qualifier (LD/ST/ccpass). |
| `tlb_cam_v_lsN_a1` / `va_v_lsN_a1` | 1 / 1 | LS arb | a1 | CAM-valid and VA-valid enables. |
| `ld_val_lsN_a1` / `st_val_lsN_a1` | 1 each | LS arb | a1 | LD/ST valid class. |
| `ls_uop_ctl_lsN_a1_q` | `PERSEUS_LS_CTL` | Issue (flopped) | a1 | uop control bundle at a1. |
| `ccpass_lsN_a1` | 1 | LS predicate | a1 | Conditional-compare pass. |
| `lsN_ccpass_a2_q` | 1 | LS predicate | a2 | ccpass flopped to a2. |
| `lsN_pred_inv_force_ccfail_a1` | 1 | LS predicate | a1 | Predicate-invalid forces ccfail. |
| `ff_gather_ld_lsN_a2` / `nf_ld_lsN_a2` | 1 each | SVE gather | a2 | SVE gather/non-fault LD qualifiers. |
| `ffr_lane_eq_first_active_lane_lsN_a2` / `first_vld_lane_found_lsN_a2` | 1 each | SVE predicate | a2 | SVE FFR / first-active-lane indicators. |
| `st_no_xlat_lsN_a1` | 1 | LS arb | a1 | ST-without-translation (no-xlat) bypass. |
| `mmuoff_ps_flt_lsN_a1` | 1 | LS fault encoder | a1 | MMU-off page-size fault. |
| `dcivac_lsN_a1` / `ls_pld_lsN_a1` / `tmo_lsN_a1` / `cxp_lsN_a1` / `par_wr_lsN_a1` | 1 each | LS decode | a1 | DCI-VAC / PLD / TMO / CXP / PAR-WR op class flags. |
| `tmo_inject_val_lsN_a1_q` | 1 | Inject / TMO | a1 | TMO inject valid at a1. |
| `lsN_page_split2_a1_q` / `lsN_page_split1_val_a1` | 1 each | LS unalign | a1 | Page-split accesses. |
| `lsN_wr_a1` / `lsN_pldw_a1` | 1 each | LS decode | a1 | Write / PLDW class. |
| `lsN_precommit_uop_a1_q` | 1 | Precommit | a1 | Precommit-uop hand-off at a1 (TLB-F33). |
| `lsN_op_pass_older_st_pend_nuke_a1` | 1 | LS SAB | a1 | Nuke older-pending-ST class. |
| `lsN_frc_unchecked_a1_q` | 1 | LS control | a1 | Force-unchecked MTE flag. |
| `address_inject_val_lsN_a1_q` | 1 | Inject | a1 | Address-inject valid at a1. |

#### §5.1.9 Per-pipeline a2 stage-handoff (L423–L448, L503–L532, L587–L616, L671–L700, L865–L887, L970–L988) — three pipes

| 信号 | 位宽 | 源模块 | 活跃阶段 | 作用 |
|------|------|--------|----------|------|
| `mte_ata_en_lsN_a2_q` / `mte_prc_mode_lsN_a2` / `mte_imprc_mode_lsN_a2` | 1 each | MTE control | a2 | MTE ATA-enable / precise / imprecise modes. |
| `prc_abort_b4_xlat_lsN_a2` | 1 | LS abort | a2 | Pre-translation precise-abort. |
| `st_accept_lsN_a2` / `st_reject_lsN_a2` / `ld_accept_lsN_a2` / `ld_reject_lsN_a2` | 1 each | LS arb | a2 | LD/ST accept/reject at a2 (also a3 variants at L762–L773). |
| `unalign2_lsN_a1_q` / `unalign2_lsN_a2_q` | 1 each | LS unalign | a1/a2 | Unalign-2 carried. |
| `lsN_abort_early_indicator_adjusted_a2` | 1 | LS abort | a2 | Adjusted early-abort indicator. |
| `tmo_inject_val_lsN_a2_q` | 1 | Inject | a2 | TMO inject at a2. |
| `lsN_page_split2_a2_q` | 1 | LS unalign | a2 | Page-split carried to a2. |
| `st_val_lsN_a2_q` / `ld_val_lsN_a2_q` | 1 each | LS arb | a2 | Validity at a2 (flopped). |
| `ls_pld_lsN_a2` | 1 | LS decode | a2 | PLD at a2. |
| `force_wbtr_lsN_a2_q` | 1 | LS force-write-back-transient | a2 | Force WBTR indicator. |
| `lsN_va_frc_range_flt_a2_q` | 1 | LS VA-range flt | a2 | VA-range fault asserted. |
| `atomic_op_lsN_a2` / `lsN_pldw_a2` / `lsN_wr_a2_q` / `dcivac_lsN_a2` / `cmo_rd_lsN_a2` | 1 each | LS decode | a2 | Op-class carried to a2. |
| `issue_v_lsN_a2_q` | 1 | Issue | a2 | Issue-valid at a2 (flopped from a1). |
| `address_inject_val_lsN_a2_q` | 1 | Inject | a2 | Address-inject at a2. |
| `ls_ct_rslv_v_ld_lsN` / `ls_ct_rslv_uid_ld_lsN` | 1 / `PERSEUS_UID` each | Commit-track | static (resolve-window) | Commit-track LD-resolve valid + uid. |
| `lsN_prc_abort_adjusted_a2` | 1 | LS abort | a2 | Precise-abort adjusted at a2. |
| `nc_dev_unalign_flt_poss_lsN_a2_q` | 1 | LS fault encoder | a2 | NC-device unalign-fault-possible indicator. |
| `spe_inject_val_lsN_i2` / `_a1_q` / `_a2_q` | 1 each (×3 stages) | SPE | i2 / a1 / a2 | SPE-inject valid carried through stages. |
| `lsN_match_spe_uid_a1` / `_a2_q` | 1 each | SPE | a1 / a2 | SPE-uid match per pipe. |
| `lsN_tbw_abort_replay_adjusted_a2` | 1 | TBW | a2 | Table-walker abort-replay adjusted. |
| `tbe_inject_val_lsN_i2` / `_a1_q` / `_a2_q` | 1 each (×3 stages) | TRBE | i2 / a1 / a2 | TRBE-inject valid carried. |

#### §5.1.10 MMU response capture (L800–L810)

| 信号 | 位宽 | 源模块 | 活跃阶段 | 作用 |
|------|------|--------|----------|------|
| `flush` | 1 | Flush net | static (pulse) | Global flush pulse. |
| `flush_uid` | `PERSEUS_UID` | Flush net | static (pulse) | Flush target uid. |
| `mm_ls_tlb_miss_resp_v` | 1 | `ls_mm` (MMU) | response cycle | MMU-walk response valid (TLB-F04). |
| `mm_ls_tlb_miss_resp_id` | 2 | `ls_mm` | response cycle | 2-bit outstanding-slot id (4 outstanding, TLB-F05). |
| `mm_ls_tlb_miss_resp_flt` | 1 | `ls_mm` | response cycle | Fault indicator on response. |
| `mm_ls_tlb_miss_resp_pa` | `[48:12]` | `ls_mm` | response cycle | Translated PA. |
| `mm_ls_tlb_miss_resp_attr` | `PERSEUS_TBW_RESP_ATTR_RANGE` | `ls_mm` | response cycle | Response attributes (memattr/SH/AP/...). |
| `mm_ls_tlb_miss_resp_va` | `[PERSEUS_LS_VA_MAX:25]` | `ls_mm` | response cycle | Upper-VA returned by walker. |
| `mm_ls_tlb_miss_resp_replay` | 1 | `ls_mm` | response cycle | Walker requests replay (TLB-F43). |

#### §5.1.11 DFT / MBIST / Debug-RAM read (L812–L815, L821)

| 信号 | 位宽 | 源模块 | 活跃阶段 | 作用 |
|------|------|--------|----------|------|
| `snp_dbg_ram_rd_valid_d0` | 1 | Snoop / debug | d0 | Debug-RAM read valid. |
| `snp_dbg_ram_rd_target_d0` | `PERSEUS_LS_DEBUG_RD_ENC_RANGE` | Snoop / debug | d0 | Debug-read target encoding. |
| `snp_lookup_va_d0` | `PERSEUS_LS_L1_TLB_DBG_RD_IDX_BITS` | Snoop / debug | d0 | Debug lookup VA/index (TLB-F39). |
| `snp_dbg_ram_rd_ns_d2` | 1 | Snoop / debug | d2 | NS attribute for debug read. |
| `precommit_uid_q` | `PERSEUS_UID` | Precommit | static | Precommit-uid for outstanding-entry flush compares (TLB-F36). |

#### §5.1.12 Prefetcher-TLB inject + SAB AT-saved (L828–L862)

| 信号 | 位宽 | 源模块 | 活跃阶段 | 作用 |
|------|------|--------|----------|------|
| `pf_tlb_inject_v_lsN_a1` / `_a2` (N=0,1,2) | 1 each (×6) | Prefetcher | a1 / a2 | Prefetch-triggered TLB-inject valid per pipe/stage. |
| `pf_tlb_lookup_injected_id_a2_q` | `PERSEUS_LS_PF_GT_TLB_ID_R` | Prefetcher | a2 | Prefetch-lookup injected transaction id. |
| `sb_at_use_saved_info_v_q` / `sb_at_tlb_saved_q` / `sb_clr_tlb_saved_info` | 1 each | SAB (AT state) | static (held) | SAB "AT-op saved info" handshake inputs. |
| `flush_at_saved` | 1 | SAB / Flush | static (pulse) | Flush the AT-saved state. |

#### §5.1.13 Miscellaneous (L950, L970–L988)

| 信号 | 位宽 | 源模块 | 活跃阶段 | 作用 |
|------|------|--------|----------|------|
| `ls_spe_buffer_done` | 1 | SPE | static | SPE buffer drained indicator. |
| `ls_chsw_disable_spe_replay` | 1 | SPE | static | Disable SPE-replay path (chip-select-wide). |

**§5.1 summary: 13 input subgroups.**

### §5.2 Outputs (by functional domain)

#### §5.2.1 Per-pipeline a1 VA-formation outputs (L213–L224, L283–L294, L353–L364) — three pipes

For N∈{0,1,2}:

| 信号 | 位宽 | 目的模块 | 活跃阶段 | 作用 |
|------|------|----------|----------|------|
| `lsN_cin_a1` | 64 | AGU / DCache / LRQ | a1 | Carry-in term re-broadcast (fanout for final-adder). |
| `va_lsN_a1` | 64 | DCache / LRQ / SAB | a1 | Fully-formed VA for downstream consumers (TLB-F01). |
| `p_lsN_a1` | `PERSEUS_LS_VA_MAX:32` | AGU / DCache | a1 | Propagate term of the final-adder. |
| `g_lsN_a1` | `PERSEUS_LS_VA_MAX-1:32` | AGU / DCache | a1 | Generate term of the final-adder. |
| `lsN_cout31_a1` | 1 | AGU / DCache | a1 | Carry-out at bit 31 (4-GB boundary indicator). |
| `va_hi_upper_byte_allones_lsN_a1` / `_allzeroes_lsN_a1` | 1 each | LS fault encoder | a1 | VA-high upper-byte = all-1s / all-0s pre-check (TLB-F21). |
| `va_hi_55_to_va_max_allones_lsN_a1` / `_allzeroes_lsN_a1` | 1 each | LS fault encoder | a1 | VA[55:MAX] = all-1s / all-0s pre-check. |
| `va_larger_than_pa_max_lsN_a1` | 1 | LS fault encoder | a1 | VA > PA_MAX pre-check. |

#### §5.2.2 Per-pipeline a2 translation result (L451–L488, L535–L572, L619–L656) — three pipes

| 信号 | 位宽 | 目的模块 | 活跃阶段 | 作用 |
|------|------|----------|----------|------|
| `tlb_any_hit_lsN_a2` | 1 | DCache / LRQ / SAB | a2 | Any-entry hit for pipe N (TLB-F01, `L451`). |
| `tlb_one_or_more_hits_lsN_a2` | 1 | LS fault / multi-hit | a2 | ≥1 entry hit (pre multi-hit arbitration). |
| `tlb_hit_conflict_raw_lsN_a2` / `tlb_hit_conflict_lsN_a2` | 1 each | LS fault | a2 | Raw / gated hit-conflict (coalesced multi-hit, TLB-F23). |
| `ld_tlb_hit_a1_eq_wr_vec_lsN_a2_q` | 1 | LRQ / SAB | a2 | LD-hit-equals-pending-WR vector flopped. |
| `lsN_pa_a2` / `lsN_fb_pa_a2` / `lsN_st_pa_a2` | `PERSEUS_LS_PA` each | DCache / FB / STB | a2 | Translated PA (main / fillbuf / store variants). |
| `lsN_sb_pa_a2` | `PERSEUS_LS_PA_MAX:12` | STB | a2 | PA for store-buffer index. |
| `lsN_fb_va_a2_q` | `PERSEUS_LS_VA_MAX:PERSEUS_LS_VA_ALIAS_MSB+1` | Fillbuf | a2 | VA alias-MSB for fillbuf. |
| `fb_tlb_cam_v_lsN_a1` / `fb_va_v_lsN_a1` | 1 each | Fillbuf | a1 | Fillbuf CAM/VA-valid. |
| `ns_lsN_a2` | 1 | Attribute network | a2 | Non-secure attribute. |
| `outer_alloc_lsN_a2` / `outer_alloc_pre_lsN_a2` | 1 each | L2 / allocator | a2 | Outer-alloc attribute (& pre-select). |
| `cache_attr_lsN_a2` | `PERSEUS_LSL2_CACHE_ATTR` | L2 / DCache | a2 | Cacheability attribute. |
| `page_attr_lsN_a2` | `PERSEUS_LS_PAGE_ATTR_SAVE` | LS fault encoder | a2 | Page attribute save. |
| `tlb_dev_htrap_lsN_a2` | 1 | LS fault encoder | a2 | Device-memory hyp-trap (TLB-F14). |
| `tlb_fwb_override_lsN_a2_q` | 1 | L2 | a2 | FWB override flop. |
| `mte_access_lsN_a2` / `mte_access_stg_lsN_a2` / `mte_allow_flt_lsN_a2` | 1 each | MTE | a2 | MTE-access decode (TLB-F19). |
| `ldg_frc_raz_lsN_a2` | 1 | MTE | a2 | LDG-force-read-as-zero. |
| `lsN_mte_ttbr_a2` | 1 | MTE | a2 | MTE TTBR selector (0/1). |
| `stg_raw_lsN_a2` | 1 | LS STB | a2 | Store-group RAW hazard to this translation. |
| `lsN_l1pf_ctag_a2` | 1 | L1 prefetcher | a2 | L1PF-ctag drive. |
| `spe_mte_access_ldg_stg_dcg_lsN_a2` | 1 | SPE / MTE | a2 | SPE-MTE access combined (TLB-F28). |
| `permission_lsN_a2` | `PERSEUS_TLB_PERM_INFO_RANGE` | LS abort / fault encoder | a2 | Permission bundle (TLB-F13). |
| `dbm_bits_lsN_a2` | `PERSEUS_TLB_DBM_BITS_RANGE` | LS HD-update | a2 | DBM bits for HD-dirty update. |
| `tlb_xlat_levels_lsN_a2` | `PERSEUS_TLB_XLAT_LVLS_RANGE` | LS fault encoder | a2 | Translation-level vector. |
| `tlbid_lsN_a2_q` / `tlbid_lsN_dup_a2_q` | `PERSEUS_LS_TLBID` each | LRQ / SAB (fanout) | a2 | Which-entry-hit (TLB-F08). |
| `share_attr_lsN_a2` | `PERSEUS_TLB_SH_ATTR_RANGE` | L2 | a2 | Shareability attribute. |
| `ps_lsN_a2` | `PERSEUS_LS_L1_TLB_PS` | DCache / LS | a2 | Page-size code (TLB-F07). |
| `lor_match_lsN_a2` / `lor_id_lsN_a2` | 1 / `PERSEUS_LS_LOR_ID` | LS ordering | a2 | LOR match / id (TLB-F29). |
| `pbha_lsN_a2` | `PERSEUS_PBHA_RANGE` | L2 | a2 | PBHA hint bits. |
| `nc_dev_early_lsN_a2` | 1 | LS L2IF | a2 | NC-device early indicator. |
| `lsN_ldgm_ld_a1` / `lsN_ldg_ld_a1` | 1 each | MTE | a1 | LDG/LDGM LD class. |
| `lsN_ltag_a2_q` | 4 | MTE | a2 | Logical-tag carried to a2. |
| `lsN_cl_adr_ops_a2_q` | 1 | L2 | a2 | Cacheline-address-op class. |
| `lsN_type_stgm_ldgm_a2` | 1 | MTE | a2 | STGM/LDGM class. |
| `lsN_at_op_a2_q` | 1 | SAB (AT) | a2 | AT-op class at a2. |
| `cur_msid_lsN_a2_q` | 3 | Attribute network | a2 | MSID carried to a2. |
| `reject_unalign_lsN_a2_q` | 1 | LS fault | a2 | Unalign-reject flopped to a2. |
| `lsN_precommit_uop_a2_q` | 1 | Precommit | a2 | Precommit carried. |
| `lsN_type_ldpx_a2_q` | 1 | LS decode | a2 | LDPX class carried. |
| `at_op_lsN_a1` | 1 | SAB (AT) | a1 | AT-op indicator at a1. |
| `xlat_unpriv_lsN_a1` / `xlat_unpriv_lsN_a2_q` | 1 each | LS arb | a1 / a2 | Unprivileged translation (LDTR/STTR, TLB-F20). |
| `valid_xlat_uop_lsN_a1` / `valid_xlat_uop_lsN_a2` | 1 each | LS arb | a1 / a2 | Valid translation uop. |
| `xlat_tgt_m_bit_lsN_a1_q` / `xlat_tgt_tbi_lsN_a1` / `xlat_tgt_c_bit_lsN_a2` | 1 each | Attribute network | a1 / a1 / a2 | Translation-target M/TBI/C bits (TLB-F17). |
| `ldtr_or_sttr_op_lsN_a1` | 1 | LS decode | a1 | LDTR/STTR op. |
| `mmu_flt_lsN_a2_q` / `mmu_flt_replay_lsN_a2_q` | 1 each | LS abort | a2 | MMU fault / replay (post-walk). |
| `tlb_sodev_mem_lsN_a2` / `tlb_nc_mem_lsN_a2` / `tlb_raw_nc_mem_lsN_a2` | 1 each | L2 / LS abort | a2 | SO-device / NC / raw-NC memory attribute. |
| `priv_lsN_a2_q` | 1 | LS abort | a2 | Privileged attribute. |
| `va_lsN_a2_q` | 64 | LRQ / SAB | a2 | Full VA carried to a2. |
| `uid_lsN_a1_q` / `uid_lsN_a2_q` | `PERSEUS_UID` each | LRQ / SAB | a1 / a2 | uop-id carried per stage. |
| `nested_virt_op_lsN_a1_q` / `_a2_q` | 1 each | LS abort | a1 / a2 | Nested-virt op class (TLB-F11). |
| `rndr_op_lsN_a1_q` | 1 | LS decode | a1 | RNDR op class. |
| `lsN_saved_at_op_hit_a2_q` | 1 | SAB (AT) | a2 | Saved AT-op hit on this pipe. |
| `ns_lsN_a2` / `outer_alloc_lsN_a2` (repeated — already above) | — | — | — | (listed once). |
| `tag_uncheck_lsN_a2_q` | 1 | MTE | a2 | Tag-uncheck at a2. |
| `lsN_miss_req_to_mmu_a2` | 1 | `ls_mm` | a2 | Per-pipe miss-request indicator to MMU. |

#### §5.2.3 Aggregate miss-to-MMU (L741–L757)

| 信号 | 位宽 | 目的模块 | 活跃阶段 | 作用 |
|------|------|----------|----------|------|
| `ls_mm_tlb_miss_v_a2` | 1 | `ls_mm` | a2 | Aggregate miss valid (TLB-F02; driver `L11371`). |
| `ls_mm_tlb_miss_va_a2` | `PERSEUS_LS_VA_MAX:12` | `ls_mm` | a2 | VA of the missing translation (TLB-F03). |
| `ls_mm_tlb_miss_msid_a2` | 3 | `ls_mm` | a2 | MSID of miss. |
| `ls_mm_tlb_miss_id_a2` | 2 | `ls_mm` | a2 | Outstanding-slot id (4 outstanding, TLB-F05). |
| `ls_mm_tlb_miss_non_spec_a2` / `_wr_a2` / `_at_a2` / `_atomic_a2` / `_va2ipa_a2` / `_priv_a2` / `_pan_a2` / `_spe_a2` / `_sample_a2` / `_trbe_a2` / `_nfd_a2` / `_rndr_a2` | 1 each | `ls_mm` | a2 | Miss-classification flags (TLB-F03/F15/F27). |
| `ls_mm_disable_coalescing` | 1 | `ls_mm` | static (held) | Disable MMU coalescing when current set-of-misses cannot be merged. |

#### §5.2.4 Pipeline-summary (is_*/d2/d3/t4) (L777–L797, L892–L898)

| 信号 | 位宽 | 目的模块 | 活跃阶段 | 作用 |
|------|------|----------|----------|------|
| `ls_is_uop_accept_lsN_d2` / `_d3` (N=0,1,2) | 1 each | Issue (scoreboard) | d2 / d3 | Downstream accept indicator per pipe. |
| `ls_is_uop_reject_lsN_d2` / `_d3` (N=0,1,2) | 1 each | Issue | d2 / d3 | Reject indicator. |
| `ls_is_tlb_miss_v_lsN_d2` / `_d3` (N=0,1,2) | 1 each | Issue | d2 / d3 | Miss-valid carried to Issue. |
| `pmu_l1d_tlb_a1` / `_rd_a1` / `_wr_a1` | 3 each | PMU | a1 | PMU L1D-TLB access counters. |
| `pmu_l1d_tlb_refill_t4` / `_rd_t4` / `_wr_t4` / `_pf_t4` | 1 each | PMU | t4 | PMU L1D-TLB refill counters. |

#### §5.2.5 Snoop back-pressure + TBW (L143, L822, L836–L848)

| 信号 | 位宽 | 目的模块 | 活跃阶段 | 作用 |
|------|------|----------|----------|------|
| `tlb_snp_tbw_busy` | 1 | Snoop | static (held) | TBW-busy back-pressure to snoop (TLB-F25). |
| `tbw_busy` | 1 | Internal TBW | static (held) | Internal TBW-busy signal. |
| `tlb_pf_lkup_outstanding` | 1 | Prefetcher | static (held) | Prefetch-lookup outstanding. |
| `mmu_pf_lkup_resp_v` / `_flt` / `_wb` / `_id` / `_outer_alloc` / `_share_attr` / `_pa` / `_ns` / `_ctag` / `_pbha` | various (see ports) | Prefetcher | response cycle | MMU prefetch-lookup response bundle. |

#### §5.2.6 SAB AT-saved snapshot (L851–L856)

| 信号 | 位宽 | 目的模块 | 活跃阶段 | 作用 |
|------|------|----------|----------|------|
| `saved_info_valid_q` | 1 | SAB | static (held) | AT-saved info valid. |
| `saved_pa_q` | `PERSEUS_SAVED_PA_RANGE` | SAB | static (held) | AT-saved PA. |
| `mmu_saved_info_q` | `PERSEUS_SAVED_INFO_RANGE` | SAB | static (held) | AT-saved MMU info bundle. |
| `tlb_replace_inv_any` | 1 | Replacement | static | Replacement-driver hook ("prefer invalid victim"; TLB-F42). |
| `tlb_any_inv_or_wr` | 1 | Replacement | static | Any-entry-invalid-or-write indicator. |

#### §5.2.7 Debug-RAM / Misc (L817–L818, L735, L1017–L1019, L1010–L1011)

| 信号 | 位宽 | 目的模块 | 活跃阶段 | 作用 |
|------|------|----------|----------|------|
| `dbg_ram_rd_tlb_data_valid` / `dbg_ram_rd_tlb_data` | 1 / `PERSEUS_LS_L1_TLB_DBG_RD_INFO_SIZE` | Debug-RAM / SW | d2+ | Debug-RAM read port (TLB-F39). |
| `precommitted_uop_flushed` | 1 | LS control | static (pulse) | Signals a precommit-uop was flushed (TLB-F33). |
| `eff_hcr_e2h_tge` | 1 | LS fault encoder | static | Derived (e2h & tge). |
| `ls_is_tlb_wakeup_iz` | 1 | Issue | iz | TLB-wakeup indicator to Issue at iz. |
| `ls_l2_ctxt_change_v` / `ls_l2_ctxt_change_exec_state` | 1 / 3 | L2 | static (event) | L2-context change notification + exec-state. |

#### §5.2.8 SPE-buffer path (L104, L951–L965)

| 信号 | 位宽 | 目的模块 | 活跃阶段 | 作用 |
|------|------|----------|----------|------|
| `spe_sample_tlb_miss_a2` | 1 | SPE | a2 | SPE-sample TLB-miss (TLB-F27). |
| `spe_va_to_pa_counter_q` | `PERSEUS_LS_SPE_VA_TO_PA_CNT_RANGE` | SPE | static | SPE VA→PA in-flight counter. |
| `spe_inject_accept_a2` / `spe_buf_xlat_complete` / `spe_buf_pa` / `spe_buf_pbha` / `spe_buf_ns` / `spe_buf_cache_attr` / `spe_buf_share_attr` / `spe_buf_xlat_replay` / `spe_buf_discard_write` / `spe_buf_xlat_flt` / `spe_buf_xlat_flt_fsc` / `spe_buf_xlat_flt_ea` / `spe_buf_xlat_flt_ec` | various | SPE | a2 / response | SPE buffer handshake bundle. |

#### §5.2.9 TRBE-buffer path (L992–L1005)

| 信号 | 位宽 | 目的模块 | 活跃阶段 | 作用 |
|------|------|----------|----------|------|
| `tbe_inject_accept_a2` / `tbe_buf_xlat_complete` / `tbe_buf_xlat_replay` / `tbe_buf_xlat_unsucc` / `tbe_buf_pa` / `tbe_buf_pbha` / `tbe_buf_ns` / `tbe_buf_cache_attr` / `tbe_buf_share_attr` / `tbe_buf_xlat_flt` / `tbe_buf_xlat_flt_fsc` / `tbe_buf_xlat_flt_ea` / `tbe_buf_xlat_flt_ec` | various | TRBE | a2 / response | TRBE buffer handshake bundle. |

**§5.2 summary: 9 output subgroups.**

### §5.3 Grand totals

- Total port declaration lines (from Task 7 step 3 grep): **757**.
- Subtable groups used: **§5.1 × 13 input groups + §5.2 × 9 output groups = 22 functional-domain subtables**.
- No port from the 757-line grep is omitted — all lines are accounted for in one of the subtables above (three-pipe signal rows are listed once with the `N∈{0,1,2}` convention to keep the tables readable per R1).

---

## §6 接口时序 (Important-Timing Waveforms)

Framing rule for this section: per spec §7 R7, waveforms are authored **only for "important timings"** — cross-cycle handshakes, multi-state FSM transitions, multi-source concurrent events, and exception paths. Baseline trivial combinational hand-offs (e.g. a pure a1→a2 pipeline-register flop with no gating) are not shown here. Signal names in each waveform are identical to their §5 port-table entry. RTL line numbers are cited for each transition. Cycle counts that depend on environment (e.g. MMU walk latency, snoop-network delay) are labelled `(UNVERIFIED: ...)` per R5.

Waveform legend: `_` = low, `‾` = high, `|` = edge, `X` = transition/don't-care, `=` = stable multi-bit value. Each cycle column is two characters wide to keep labels column-aligned.

### §6.1 TLB Hit (baseline a1 → a2)

**Scenario.** `ls0` issues a translated LD at a1, hits an existing TLB entry, produces PA + permission at a2. No miss, no fault. Shown as the baseline against which §6.2–§6.6 deviate.

```
Cycle:                                 T0  T1  T2  T3
Stage:                                 a1  a2  a3
clk                                    |‾|_|‾|_|‾|_|‾|_|
valid_xlat_uop_ls0_a1                  __|‾‾‾|___________
tlb_cam_v_ls0_a1                       __|‾‾‾|___________
va_ls0_a1                              ==|=V==|===========   (V = lookup VA, L214)
agu_addend_a/b_ls0_a1_q, carry_in…     ==|=V==|===========   (form V at a1, L209-L212)
tlb_any_hit_ls0_a2                     ______|‾‾‾|_______   (L451)
tlb_one_or_more_hits_ls0_a2            ______|‾‾‾|_______   (L452)
ls0_pa_a2                              ======|=PA=|=======   (L456)
permission_ls0_a2                      ======|=P=|========   (L478)
ps_ls0_a2                              ======|=S=|========   (L484)
tlbid_ls0_a2_q                         ______|=IDX|=======   (L481; flopped from a1 hit-select)
ls_mm_tlb_miss_v_a2                    __________________   (L741; stays low)
uid_ls0_a2_q                           ______|=UID|=======   (L689)
```

**Walkthrough.**
- **T0 (a1).** Issue delivers the uop; `valid_xlat_uop_ls0_a1` (L273, driven inside the module) and `tlb_cam_v_ls0_a1` (L232, input) both rise. AGU presents `agu_addend_a_ls0_a1_q` / `_b` / `carry_in_ls0_a1_q` (L209–L212); the final adder inside `ls_tlb` forms `va_ls0_a1` (output, L214). The 44-entry CAM compares V against every entry in the same cycle; the page-size-grouped match cones drive `any_4k_hit_ls0_a1` / `any_coalesced_hit_16k_to_256k_ls0_a1` / `any_non_coalesced_hit_16k_to_256k_ls0_a1` (L5195–L5267) — *not on the port list*, so not plotted; they are summed into the a2 hit output via the hit-selector.
- **T1 (a2).** Hit-selector flops hold: `tlb_any_hit_ls0_a2` (L451) and `tlb_one_or_more_hits_ls0_a2` (L452) go high; the 1-hot entry winner drives `ls0_pa_a2` (L456), `permission_ls0_a2` (L478), `ps_ls0_a2` (L484), `tlbid_ls0_a2_q` (L481). `ls_mm_tlb_miss_v_a2` (L741, driver L11371) stays low because `tlb_miss_ls0_a2` is deasserted (hit path).
- **T2 (a3).** Outputs propagate to downstream consumers; no further TLB activity for this uop.

**RTL references (transitions).**
- `va_ls0_a1` formation and CAM-match span: `perseus_ls_tlb.sv:L5195-L5267`.
- a2-side hit output fan: `L451-L488` (`tlb_any_hit_ls0_a2`, `ls0_pa_a2`, `permission_ls0_a2`, `ps_ls0_a2`, `tlbid_ls0_a2_q`).
- Miss-valid driver (held low): `L11371`.

### §6.2 TLB Miss → MMU walk → response (cross-module handshake, R7-1 + R7-4)

**Scenario.** `ls0` LD misses in TLB at a2. Miss request is emitted to MMU; MMU performs a PTW of arbitrary length K cycles; MMU returns translation at T(2+K); slot freed; pipeline replays or consumes. The outstanding-miss slot is slot 0 (id=2'b00).

```
Cycle:                                 T0  T1  T2 …  T(2+K)  T(3+K)
Stage:                                 a1  a2  a3
valid_xlat_uop_ls0_a1                  __|‾‾|________________________
va_ls0_a1                              ==|=V==|========================
tlb_any_hit_ls0_a2                     ______|_|_______________________    (L451 — low = miss)
tlb_miss_ls0_a2  (internal)            ______|‾‾|______________________    (feeds L11371)
ls_mm_tlb_miss_v_a2                    ______|‾‾|______________________    (L741 / L11371)
ls_mm_tlb_miss_va_a2                   ======|=V_hi=|==================    (L742)
ls_mm_tlb_miss_id_a2                   ======|=00=|====================    (L744; 2-bit slot)
ls0_miss_req_to_mmu_a2                 ______|‾‾|______________________    (L824)
outstanding_miss_valid_q[0] (int)      ______|‾‾‾‾‾‾‾‾‾‾‾|____________    (L1754-L1760)
                                              ◄── MMU PTW: K cycles ──►
mm_ls_tlb_miss_resp_v                  __________________|‾‾|_________    (L804)
mm_ls_tlb_miss_resp_id                 ==================|=00=|========    (L805)
mm_ls_tlb_miss_resp_pa                 ==================|=PA=|========    (L807)
mm_ls_tlb_miss_resp_attr               ==================|=AT=|========    (L808)
mm_ls_tlb_miss_resp_flt                __________________|_|___________    (L806)
mm_ls_tlb_miss_resp_replay             __________________|_|___________    (L810)
outstanding_miss_valid_q[0] (int)      __________________________|_|__   (cleared)
entry array fill (1 of 44)             _____________________|‾|________   (one-cycle write; RTL span TBD — Gate 9 §8)
ls_is_tlb_wakeup_iz  (to Issue)        __________________|‾‾‾|_________    (L1019)
```

**Walkthrough.**
- **T0 (a1).** Normal a1 lookup (same as §6.1).
- **T1 (a2).** Hit-selector reports no entry matches → `tlb_any_hit_ls0_a2=0` (L451). The internal `tlb_miss_ls0_a2` goes high. Driver `L11371` gates the aggregate: `ls_mm_tlb_miss_v_a2 = (tlb_miss_ls0_a2 | tlb_miss_ls1_a2 | tlb_miss_ls2_a2) & ~ls_mm_idle_sys_req & (~miss_req_no_free_slots & …)`. Assuming slots available and not `ls_mm_idle_sys_req`, `ls_mm_tlb_miss_v_a2` rises (L741), together with the payload bundle `ls_mm_tlb_miss_va_a2` (L742), `_id_a2` (L744), `_msid_a2` (L743), and class bits (`_wr_a2`/`_at_a2`/`_atomic_a2`/`_priv_a2`/`_pan_a2` at L746–L751). `ls0_miss_req_to_mmu_a2` (L824) is the pipe-specific accompaniment. One outstanding slot is claimed: `outstanding_miss_valid_q[0]` (internal, L1754–L1760) rises.
- **T2 … T(1+K).** MMU performs the page-table walk. `(UNVERIFIED: walk latency K is MMU implementation-dependent — anywhere from a few cycles for an L0-hit in the MMU-internal walk cache to tens of cycles for a full S1+S2 walk; the TLB side only sees `mm_ls_tlb_miss_resp_v` rise when the walker finishes.)` During this window `ls_is_tlb_wakeup_iz` (L1019) may assert once the walker signals "near done" via `early_mm_wakeup_m6_q` (input, L148) — this is the clock-enable for pending-miss bookkeeping flops (TLB-F37).
- **T(2+K).** MMU drives `mm_ls_tlb_miss_resp_v=1` (L804) with matching `_id=2'b00` (L805), `_pa` (L807, 48:12), `_attr` (L808), `_va` (L809, VA_MAX:25), `_flt=0` (L806), `_replay=0` (L810). The response-capture logic (TLB-F04/F05) uses the 2-bit id to select the slot and writes one of the 44 entries (the chosen victim) with `{V=1, VA, PA, ASID, VMID, ps_code, attr...}`.
- **T(3+K).** `outstanding_miss_valid_q[0]` clears; slot freed. The original uop is replayed from Issue (Issue sees `ls_is_tlb_wakeup_iz`, L1019) and on the next pass will hit per §6.1.

**RTL references (transitions).**
- Miss-valid driver: `perseus_ls_tlb.sv:L11371` (`ls_mm_tlb_miss_v_a2` assign).
- Outstanding tracker flops: `L1754-L1760` (declaration region per §1.4/§3.2 witness).
- Response ports: `L804-L810`.
- `ls_is_tlb_wakeup_iz` output: `L1019`.
- `early_mm_wakeup_m6_q` input: `L148`.
- `(UNVERIFIED: walk latency K is MMU-implementation-dependent; exact resp-to-fill cycle count requires simulator run.)`

### §6.3 Permission fault (abort path, R7-4)

**Scenario.** `ls0` ST at a2 hits a TLB entry, but the entry's AP+PAN/UAO combination denies write access at the current EL. Translation succeeds (hit), but `permission_ls0_a2` encodes a fault; downstream abort path uses `mmu_flt_ls0_a2_q` / `prc_abort_hyp_ls0_a2` to raise a precise exception. No MMU interaction.

```
Cycle:                                 T0  T1  T2  T3
Stage:                                 a1  a2  a3
valid_xlat_uop_ls0_a1                  __|‾‾|_______________
ls0_wr_a1                              __|‾‾|_______________   (L257 — ST class)
va_ls0_a1                              ==|=V==|================
tlb_any_hit_ls0_a2                     ______|‾‾|_____________   (L451 — hit)
ls0_pa_a2                              ======|=PA=|============   (L456)
permission_ls0_a2                      ======|=P_deny=|========   (L478 — encodes "write denied")
eff_pstate_pan (static)                ‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾   (L67; PAN=1)
prc_abort_hyp_ls0_a2                   ______|_|______________   (L909; EL1 case — not hyp-trap)
mmu_flt_ls0_a2_q                       __________|‾‾|_________   (L679 — flopped flt)
ls_mm_tlb_miss_v_a2                    ______________________   (L741 — stays low)
ls_is_uop_reject_ls0_d2                __________|‾‾|_________   (L778)
```

**Walkthrough.**
- **T0 (a1).** Issue presents a ST (`ls0_wr_a1=1`, L257). Stage-1 PAN/UAO derivation uses `eff_pstate_pan` (L67, static). The CAM lookup proceeds normally.
- **T1 (a2).** `tlb_any_hit_ls0_a2=1` (L451) — the TLB *has* a translation. The hit-selector drives `ls0_pa_a2` (L456) and **`permission_ls0_a2` (L478) with a bundle that encodes "write denied at EL0/EL1 under PAN=1"**. The downstream permission-check combinational logic (outside ls_tlb proper, in the LS abort encoder) consumes this plus the ST-class bit to raise an abort. `ls_mm_tlb_miss_v_a2` stays low (this is a hit, not a miss).
- **T2 (a3).** `mmu_flt_ls0_a2_q` (L679) is flopped high on the abort, and the pipeline summary output `ls_is_uop_reject_ls0_d2` (L778) rises; Issue treats the uop as rejected and will flush/replay per the normal abort path.

**RTL references (transitions).**
- Permission bundle: `perseus_ls_tlb.sv:L478` (`permission_ls0_a2`).
- PAN input: `L67` (`eff_pstate_pan`).
- `mmu_flt_ls0_a2_q` flop output: `L679`.
- Hyp-abort input witness: `L909` (`prc_abort_hyp_ls0_a2`).
- Pipeline-summary reject output: `L778` (`ls_is_uop_reject_ls0_d2`).
- `(UNVERIFIED: the exact internal combinational AP/PAN/UAO resolver span inside ls_tlb is not resolved this gate; reference Gate 9 §8 for the permission-logic walkthrough.)`

### §6.4 Multi-hit detect (aliasing fault, R7-4)

**Scenario.** Two of the 44 entries match the same VA at a1 (e.g. a stale 4K entry coexists with a newly-filled 16K coalesced entry covering the same region). The 3× `perseus_ls_multi_hit_detect` instances (TLB-F22; `L10774 / L10786 / L10798`) raise `tlb_multi_hit_ls0_a2` and the coalesced path raises `tlb_hit_conflict_ls0_a2`. The uop is faulted (RAS-class).

```
Cycle:                                 T0  T1  T2  T3
Stage:                                 a1  a2  a3
valid_xlat_uop_ls0_a1                  __|‾‾|________________
va_ls0_a1                              ==|=V==|================
tlb_any_hit_ls0_a2                     ______|‾‾|_____________   (L451)
tlb_one_or_more_hits_ls0_a2            ______|‾‾|_____________   (L452)
tlb_hit_conflict_raw_ls0_a2            ______|‾‾|_____________   (L453)
tlb_hit_conflict_ls0_a2                ______|‾‾|_____________   (L454 — coalesced-alias raw gated)
ls0_pa_a2                              ======|=X=|=============   (L456 — indeterminate under multi-hit)
permission_ls0_a2                      ======|=X=|=============   (L478 — indeterminate)
mmu_flt_ls0_a2_q                       __________|‾‾|_________   (L679 — flt raised at a3)
ls_mm_tlb_miss_v_a2                    ______________________   (L741 — stays low; not a miss)
ls_is_uop_reject_ls0_d2                __________|‾‾|_________   (L778)
```

**Walkthrough.**
- **T0 (a1).** Lookup presents V to CAM. Two entries' match cones (e.g. entry-9 flagged as 4K, entry-17 flagged as 16K) both fire for V. Each fires via its own page-size-group vector (`any_4k_hit_ls0_a1` vs `any_coalesced_hit_16k_to_256k_ls0_a1`, `L5195-L5222`).
- **T1 (a2).** The 3× `perseus_ls_multi_hit_detect` instance for pipe-0 (L10774) XORs/one-hot-checks the aggregate hit vector and raises its multi-hit output, which combines with the coalesced-alias path (TLB-F23, `L1113-L1118`, `L5201-L5267`) into `tlb_hit_conflict_raw_ls0_a2` (L453) and the gated `tlb_hit_conflict_ls0_a2` (L454). `ls0_pa_a2` / `permission_ls0_a2` are held but are architecturally undefined (X on the waveform) because the 1-hot assumption is broken; downstream must not consume.
- **T2 (a3).** `mmu_flt_ls0_a2_q` (L679) is raised for RAS bookkeeping; `ls_is_uop_reject_ls0_d2` (L778) asserts to Issue.

**RTL references (transitions).**
- Multi-hit detect instances: `perseus_ls_multi_hit_detect` at `L10774` / `L10786` / `L10798`.
- Coalesced-alias path: `L1113-L1118`, `L5201-L5267`.
- Outputs: `L453-L454` (raw / gated hit-conflict).
- Fault flop: `L679`.
- `(UNVERIFIED: the exact PA/permission behaviour under multi-hit — held-at-one-winner vs tri-state-X — depends on the hit-select MUX implementation; Gate 9 §8 resolves.)`

### §6.5 TLBI snoop invalidation (cross-module + state change)

**Scenario.** An external TLBI (from another core or from the local TLB-maintenance agent) arrives as a snoop-TMO at i2. The TLB qualifies the request against all 44 entries via ASID/VMID/sec/el/stage context-match, computes `snp_tmo_invalidate_vec_nxt` (L1935) over the entry array, and in one or more subsequent cycles clears matched entries. `tlb_snp_tbw_busy` (L143) is asserted to back-pressure more snoops during the window.

```
Cycle:                                 T-1 T0  T1  T2  T3  T4
Stage:                                 -   i2  a1  a2
snp_tmo_va_valid                       ___|‾‾|_________________   (L134)
snp_tmo_vmid / _asid / _sec / _el / _stage
                                       ===|=Q=|================    (L135-L141; held w/ request)
snp_tmo_vmid_valid / _asid_valid       ___|‾‾|_________________    (L136, L138)
tlb_snp_tbw_busy                       ___|‾‾‾‾‾‾‾‾‾|__________    (L143 — back-pressure window)
snp_tmo_cr_{asid,vmid,msid}_match_i2   _______|‾‾|_____________    (internal, L11368 dbg, L1929-L1933 context)
snp_tmo_invalidate_vec_nxt             _______|=VEC|============    (L1935; 44-wide; matched-entry bits =1)
snp_tmo_invalidate_vec_q               _______________|=VEC|===    (internal flop, L11360 region)
entry[k].V  (each k in VEC)            ‾‾‾‾‾‾‾‾‾‾‾‾‾‾|_|_______    (clears on clock-after-invalidate; RTL span — Gate 9)
snoop_sync_inv_tlb_i2                  ___|‾‾|_________________    (L145 — sync-invalidate pulse)
tbw_busy                               ___|‾‾‾‾‾‾‾‾‾‾‾|_______    (L822)
```

**Walkthrough.**
- **T0 (i2).** Snoop agent drives `snp_tmo_va_valid=1` (L134) together with `snp_tmo_vmid` (L135), `snp_tmo_vmid_valid` (L136), `snp_tmo_asid` (L137), `snp_tmo_asid_valid` (L138), `snp_tmo_sec` (L139), `snp_tmo_el` (L140), `snp_tmo_stage` (L141), and `snoop_sync_inv_tlb_i2` (L145). `tlb_snp_tbw_busy` (L143) rises immediately; `tbw_busy` (L822) also rises.
- **T1 (a1 relative to snoop).** Context-match pre-compute: `snp_tmo_cr_asid_match_i2` / `_vmid_match_i2` / `_msid_i2` (internal, referenced in `L11360`-region) are resolved. The per-entry `snp_tmo_context_match_a1` (internal 44-wide) is formed and `snp_tmo_invalidate_vec_nxt` (L1935) is computed over all 44 entries (TLB-F24).
- **T2 (a2).** `snp_tmo_invalidate_vec_q` is flopped. The entry-array valid bits at each matched index are cleared on the following clock edge — exact span deferred to Gate 9 §8.
- **T3 / T4.** `tlb_snp_tbw_busy` deasserts once the window closes; snoop-agent may issue the next maintenance op.

**RTL references (transitions).**
- Snoop-TMO inputs: `perseus_ls_tlb.sv:L134-L145`.
- Back-pressure output: `L143` (`tlb_snp_tbw_busy`), `L822` (`tbw_busy`).
- Invalidate-vector next: `L1935` (`snp_tmo_invalidate_vec_nxt`).
- Context-match signal declarations referenced in region `L11360` per §6.2 neighborhood grep.
- `(UNVERIFIED: exact entry-clear cycle count relative to snp_tmo_va_valid is environment-dependent — a single-cycle context-match-then-clear model is assumed; Gate 9 §8 walkthrough will pin down the precise flop span.)`

### §6.6 Stage-2 nested translation (2 rounds of walks)

**Scenario.** At EL1 with EL2 virtualisation active (`cur_vmon=1`, `cur_hyp=0`), a TLB miss on a guest-VA requires Stage-1 walk → gives an IPA → Stage-2 walk on that IPA → gives PA. The MMU itself sequences the two walks and the TLB side sees **two** rounds of `mm_ls_tlb_miss_resp_v` for cases where the S1 walk itself faults intermediate IPA translations, or **one** response at the end if the MMU pre-combines. This waveform covers the "two rounds visible at the ls_tlb / MMU boundary" case — the more pessimistic pattern — since it is what the TLB must be correctness-robust against.

```
Cycle:                               T0 T1 T2 …  T(2+K1)    …  T(2+K1+K2)   T(3+K1+K2)
Stage:                               a1 a2 a3
valid_xlat_uop_ls0_a1                __|‾‾|_________________________________________________
va_ls0_a1                            ==|=V==|====================================================
tlb_any_hit_ls0_a2                   ______|_|___________________________________________________   (L451)
ls_mm_tlb_miss_v_a2                  ______|‾‾|__________________________________________________   (L741; round 1)
ls_mm_tlb_miss_va_a2                 ======|=V_hi=|======================================================   (L742)
ls_mm_tlb_miss_va2ipa_a2             ______|‾‾|__________________________________________________   (L749 — request is "walk S1 for guest-VA")
outstanding_miss_valid_q[0]          ______|‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾|___________________________________     (L1754-L1760)
                                           ◄── S1 walk: K1 cycles ──►
mm_ls_tlb_miss_resp_v   (round 1)    __________________|‾‾|_____________________________________   (L804)
mm_ls_tlb_miss_resp_id               ==================|=00=|===============================================   (L805)
mm_ls_tlb_miss_resp_pa  (= IPA)      ==================|=IPA=|==============================================   (L807)
mm_ls_tlb_miss_resp_replay           __________________|‾‾|_____________________________________   (L810 — "need S2 walk, replay")
                                                           ◄── S2 walk: K2 cycles ──►
(MMU internally issues S2 walk; no new ls_mm_tlb_miss_v_a2 emerges from TLB side — the
 S2 walk is inside the MMU's walker. Once complete, the MMU returns a second response.)
mm_ls_tlb_miss_resp_v   (round 2)    ____________________________________________|‾‾|___________   (L804)
mm_ls_tlb_miss_resp_pa  (= final PA) ============================================|=PA=|==================   (L807)
mm_ls_tlb_miss_resp_replay           ____________________________________________|_|____________   (L810 — "done")
outstanding_miss_valid_q[0]          ________________________________________________|_|________      (slot freed)
nested_virt_op_ls0_a2_q              ______|‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾|__________   (L869 — held through window)
eff_hcr_e2h (static)                 ===========================================================   (L55)
entry fill                           ___________________________________________________|‾|_____   (after final round; Gate 9 §8)
ls_is_tlb_wakeup_iz                  ____________________________________________|‾‾‾|__________   (L1019)
```

**Walkthrough.**
- **T0 (a1).** Guest-VA V presented with `nested_virt_op_ls0_a1_q=1` (L868, flopped to L869 at a2). `eff_hcr_e2h` (L55) and `cur_vmon` (L40) are static indicators. `stg2_hd` (L110) reflects Stage-2 HD-update policy for the bookkeeping.
- **T1 (a2).** TLB miss: `ls_mm_tlb_miss_v_a2` rises (L741), payload includes `ls_mm_tlb_miss_va2ipa_a2=1` (L749) telling the MMU this is a guest-VA-needing-S1-walk. Slot 0 claimed.
- **T2 … T(1+K1).** MMU performs Stage-1 walk. `(UNVERIFIED: K1 is MMU walker latency, workload- and walk-cache-dependent.)`
- **T(2+K1).** MMU returns the intermediate result: `mm_ls_tlb_miss_resp_v=1` (L804) with `mm_ls_tlb_miss_resp_pa=IPA` (L807) and `mm_ls_tlb_miss_resp_replay=1` (L810) — this is the "keep slot busy, I still need to do S2" encoding. `(UNVERIFIED: whether this specific RTL snapshot uses `resp_replay` to signal "need S2 follow-up" or whether the MMU simply holds the TLB slot without emitting an intermediate `resp_v` rising edge — the spec-intent model is documented here; Gate 9 §8 can confirm by tracing the `outstanding_miss_*_q` clear predicate.)`
- **T(3+K1) … T(1+K1+K2).** MMU performs Stage-2 walk on IPA. TLB slot remains busy.
- **T(2+K1+K2).** MMU returns final result: `mm_ls_tlb_miss_resp_v=1` again (L804) with `mm_ls_tlb_miss_resp_pa = final PA` (L807), `mm_ls_tlb_miss_resp_replay=0` (L810). Entry is written with merged S1+S2 translation; `outstanding_miss_valid_q[0]` clears; `ls_is_tlb_wakeup_iz` (L1019) signals Issue to replay the uop.
- **T(3+K1+K2).** Replay proceeds; uop now hits per §6.1.

**RTL references (transitions).**
- Nested-virt op flops: `perseus_ls_tlb.sv:L868-L869` (`nested_virt_op_ls0_a{1,2}_q`).
- va2ipa request flag: `L749` (`ls_mm_tlb_miss_va2ipa_a2`).
- Response ports: `L804-L810`.
- Stage-2 HD input: `L110` (`stg2_hd`).
- `eff_hcr_e2h`: `L55`.
- `(UNVERIFIED: K1 and K2 walk latencies are MMU implementation-dependent; the two-rounds-of-resp_v encoding is the spec-intent model and is flagged for Gate 9 §8 confirmation against the MMU response protocol.)`

### §6.7 R7 coverage summary

| R7 criterion | Waveform(s) covering it |
|--------------|-------------------------|
| 1. Cross-cycle handshake | §6.2 (TLB↔MMU request/response), §6.6 (two-round nested request/response) |
| 2. Multi-state FSM | §6.5 (TMO i2→a1→a2 invalidate state advance), §6.2 / §6.6 (outstanding-slot life cycle) |
| 3. Multi-source concurrent | §6.2 / §6.6 (3 pipes contend for miss slots; aggregate miss-valid OR at L11371) |
| 4. Exception path | §6.3 (permission fault), §6.4 (multi-hit alias fault), §6.5 (snoop-invalidate state change), §6.6 (nested-virt replay path) |

**UNVERIFIED items introduced in §6 (R5 tally):**
- §6.2 — MMU walk latency K is environment-dependent.
- §6.3 — exact combinational AP/PAN/UAO span inside ls_tlb deferred to Gate 9 §8.
- §6.4 — PA/permission behaviour under multi-hit (held-at-winner vs X) deferred to Gate 9 §8.
- §6.5 — exact entry-clear cycle span relative to `snp_tmo_va_valid` rising edge deferred to Gate 9 §8.
- §6.6 — K1/K2 walk latencies MMU-dependent; two-rounds-of-`resp_v` encoding flagged for Gate 9 §8 confirmation.

**Waveform count: 6** (§6.1 baseline + §6.2–§6.6 important-timing).

---

*End of §5–§6. §7–§14 will be authored in Tasks 10–11 (Gates 9–10).*

