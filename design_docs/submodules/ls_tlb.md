# L2 Module: `perseus_ls_tlb` — 44-entry L1 Data micro-TLB

> Scope of this document in the current pilot gate: **§1–§6 (Task 9 / Gates 7–8) + §7–§9 (Task 10 / Gate 9: clock/reset, 10 key-circuit layers, and FSMs)**.
> §10–§14 will be authored in Task 11 (Gate 10). Do not read later sections here — they do not yet exist.

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

## §7 时钟复位 (Clock & Reset)

> Scope per Gate 9 plan: top-level `clk`, async active-high `reset_i`, DFT RAM-hold gate `cb_dftramhold`, and the three per-pipeline RCG (request-conditional clock-gate) domains + the TLB entry-array gated clock `clk_tlb_flops`. Every assertion is backed by a quoted RTL line.

### §7.1 Clock tree (four domains visible inside `ls_tlb`)

| Clock | Source | Gating predicate | Gated-flop population | RTL witness |
|-------|--------|------------------|------------------------|-------------|
| `clk` | top-level LSU clock (module port `L30`) | none (always running inside the module) | async-reset flops, i2-stage captures, outstanding-miss table flops | e.g. `L2608`, `L3196`, `L11141`, `L12367` |
| `clk_a2_flops_ls0_a1` | ICG `u_clk_tlb_a2_flops_upd_ls0` | `ld_st_pf_tmo_inject_val_ls0_a1 \| chka_disable_ls_rcg` | per-pipeline a2 capture flops for ls0 (VA, PA, attributes, permissions, tlbid, hit vector) | `L2952–L2958` (instance), `L2977+` (first gated flop `cur_msid_ls0_a2_q`) |
| `clk_a2_flops_ls1_a1` | ICG `u_clk_tlb_a2_flops_upd_ls1` | `ld_st_pf_tmo_inject_val_ls1_a1 \| chka_disable_ls_rcg` | same, for ls1 | `L3034–L3040` |
| `clk_a2_flops_ls2_a1` | ICG `u_clk_tlb_a2_flops_upd_ls2` | `ld_st_pf_tmo_inject_val_ls2_a1 \| chka_disable_ls_rcg` | same, for ls2 | `L3116–L3122` |
| `clk_tlb_flops` | ICG `u_clk_tlb_flops_upd` | `tlb_stg_flops_val_q \| chka_disable_ls_rcg` | **the 44-entry TLB entry array** (`tlb_va_q`, `tlb_crid_q`, `tlb_ps_q`, `tlb_smash_q`, `tlb_global_q`, `tlb_dev_htrap_q`, `tlb_fwb_override_q`, ...) | `L14041–L14049` |

**Clock-gate reference block (full quote).**

```systemverilog
// file:perseus_ls_tlb.sv:L14041-L14049
 assign clk_tlb_flops_enable =    tlb_stg_flops_val_q
                               |  chka_disable_ls_rcg;

 perseus_cell_clkgate u_clk_tlb_flops_upd (
        .dftcgen          (cb_dftcgen),
        .clk         (clk),
        .enable_i  (clk_tlb_flops_enable),
        .clk_gated   (clk_tlb_flops)
   );
```

- **What.** The TLB entry-array flops are only clocked on cycles where a fill is staged (`tlb_stg_flops_val_q=1`) or the global RCG-disable chicken bit (`chka_disable_ls_rcg`) is asserted. Outside these cycles the entire 44-entry SRAM-surrogate stays quiescent, saving clock power on every hit cycle — which is the common case.
- **How.** `perseus_cell_clkgate` (standard latch-AND-gate ICG) takes the functional clock `clk`, the enable `clk_tlb_flops_enable`, and the DFT test-clock-enable `cb_dftcgen` to produce `clk_tlb_flops`. During scan/DFT `cb_dftcgen` forces the gate open.
- **Why.** A 44-entry TLB with ~100-bit entries is a heavy flop bank; always clocking it would dominate `ls_tlb` dynamic power. Because the fill cadence is O(miss-rate) — rare relative to 3 hits per cycle — a single-bit enable (fill-in-progress) is sufficient and has no correctness risk (reads are combinational off `_q` and unaffected by the gate).

### §7.2 Reset strategy

`ls_tlb` uses **async-assert / sync-deassert active-high reset** throughout (ARM-N2 standard RTL style). The reset input is port `reset_i` at `L33`. Two patterns coexist:

**Pattern A — async reset flops (control state must clear).**
```systemverilog
// file:perseus_ls_tlb.sv:L2608-L2626 (representative: first always_ff in the module body)
  always_ff @(posedge clk or posedge reset_i)
  begin: u_<flop_name>
    if (reset_i == 1'b1)
      <sig>_q <= `PERSEUS_DFF_DELAY {N{1'b0}};
`ifdef PERSEUS_XPROP_FLOP
    else if (reset_i == 1'b0 && <upd_en> == 1'b1)
      <sig>_q <= `PERSEUS_DFF_DELAY <sig>_nxt;
    else if (reset_i == 1'b0 && <upd_en> == 1'b0)
    begin
    end
    else
      <sig>_q <= `PERSEUS_DFF_DELAY {N{1'bx}};
`else
    else if (<upd_en> == 1'b1)
      <sig>_q <= `PERSEUS_DFF_DELAY <sig>_nxt;
`endif
  end
```
Pattern A is used for every control-state flop whose post-reset value must be deterministic: `tlb_val_q[tlb]` (entry-valid bit, `L2608`), `snp_tmo_invalidate_vec_q` (`L12367`, 44-bit vector cleared to `{44{1'b0}}`), `outstanding_miss_valid_q[i]` (`L14932`), `victim_ptr_enc_q` / `victim_ptr_dec_q` (`L15357`, `L15376`), `tlb_stg_flops_val_q` (`L12505`), `tlb_sec_chance_bit_q` (`L13957` per-quad).

**Pattern B — clocked-enable flops (data only, no reset).**
```systemverilog
// file:perseus_ls_tlb.sv:L13673-L13685 (representative: TLB entry VA flop — clocked by clk_tlb_flops)
  always_ff @(posedge clk_tlb_flops)
  begin: u_tlb_va_q_tlb_48_12
    if (wr_tlb_en_t4[tlb] == 1'b1)
      tlb_va_q[tlb][`PERSEUS_LS_VA_MAX:12] <= `PERSEUS_DFF_DELAY tlb_va_stg_t4_q[`PERSEUS_LS_VA_MAX:12];
`ifdef PERSEUS_XPROP_FLOP
    else if (wr_tlb_en_t4[tlb] == 1'b0)
    begin
    end
    else
      tlb_va_q[tlb][`PERSEUS_LS_VA_MAX:12] <= `PERSEUS_DFF_DELAY {37{1'bx}};
`endif
  end
```
Pattern B applies to the TLB entry data fields (`tlb_va_q`, `tlb_crid_q`, `tlb_ps_q`, `tlb_smash_q`, `tlb_global_q`, `tlb_dev_htrap_q`, `tlb_fwb_override_q` — `L13673–L13939`). **These data flops are NOT reset.** Correctness is guaranteed by the separately-reset `tlb_val_q[tlb]` bit (Pattern A, `L2608`): when `tlb_val_q=0` the CAM hit is suppressed upstream regardless of what garbage VA/CRID the data flops hold out of reset. This saves one async-reset fan-out on every bit of the 44-entry × ~100-bit entry array.

### §7.3 DFT / RAM-hold path

Port `cb_dftramhold` (`L34`) is a DFT signal that, when asserted, freezes RAM-surrogate flops so that shift/capture cycles do not disturb stored translation state. Inside `ls_tlb` the signal is not consumed by any `always` body directly — it is a parameter to the `perseus_cell_clkgate` instances (implicitly, via the ICG cell's internal `dftcgen` / dft-hold logic) and/or propagated to downstream RAM macros in the wider LSU. `(UNVERIFIED: cb_dftramhold is declared as module input at L34 but grep against perseus_ls_tlb.sv body shows zero functional references; the signal is consumed only inside the encapsulating clock-gate primitive. Gate 10 integration walkthrough will confirm the exact DFT behaviour.)`

Additionally `cb_dftcgen` (`L2954`, `L3036`, `L3118`, `L14045`) is wired into every ICG so that during scan the clock gates are held transparent (`clk_gated=clk`), guaranteeing observability of the TLB entry flops on the scan chain.

### §7.4 Summary — clock/reset matrix

| Element | Clock | Reset | Update enable |
|---------|-------|-------|---------------|
| `tlb_val_q[tlb]` (44 valids) | `clk` | async `reset_i → 0` | `tlb_valid_upd_en = tlb_invalidate_en \| tlb_stg_flops_val_q` (`L13636`) |
| `tlb_va_q[tlb]`, `tlb_crid_q[tlb]`, `tlb_ps_q[tlb]`, `tlb_smash_q[tlb]`, `tlb_global_q[tlb]`, `tlb_dev_htrap_q[tlb]`, `tlb_fwb_override_q[tlb]` | `clk_tlb_flops` | none (data) | `wr_tlb_en_t4[tlb]` (per-entry one-hot) |
| `snp_tmo_invalidate_vec_q[43:0]` | `clk` | async `reset_i → 0` | `snp_tmo_vec_upd_en` (`L12361`) |
| `outstanding_miss_valid_q[3:0]` | `clk` | async `reset_i → 0` | `outstanding_miss_valid_non_static_flops_upd_en` |
| `victim_ptr_enc_q[5:0]`, `victim_ptr_dec_q[43:0]` | `clk` | async `reset_i → 0` | `sec_chance_scan_en = mm_ls_tlb_miss_resp_v` (`L15354`) |
| `tlb_sec_chance_bit_q[43:0]` (4 quads) | `clk` | async `reset_i → 0` | `tlb_sec_chance_bit_quadN_update` (N=1..4, `L13958–L14014`) |
| `tlb_stg_flops_val_q` | `clk` | async `reset_i → 0` | `outstanding_miss_valid_non_static_flops_upd_en` (`L12505`) |
| ls0/1/2 a2 capture flops (PA, attr, perm, tlbid) | `clk_a2_flops_lsN_a1` | async `reset_i → 0` for cleared-on-reset subset; no-reset for pure-data subset | `tlb_cam_v_lsN_a1` or per-flop predicate |

---

## §8 关键电路 (Key Circuits)

> Scope: **10 layers of combinational + sequential logic** that realise the 44-entry fully-associative micro-TLB. Each layer follows the R2 + R4 format: **Purpose / RTL excerpt / Line-by-line / Design rationale**. Long blocks are quoted with only `// ...` omission of non-essential XPROP branches where noted, per R2 guidance.

### §8.1 Entry storage flops (44-entry array)

**Purpose.** The per-entry state of the 44-entry fully-associative TLB: the 7 data-field flops (VA tag, CRID context id, page size, smash bit, global bit, device-htrap attribute bit, FWB-override bit) plus the reset-bearing `tlb_val_q` bit. This is the closest RTL expression of the "per-bit entry layout" that §1 flagged as UNVERIFIED — **this gate resolves that flag**.

**RTL excerpt (entry-data field flops, generate-for loop).**

```systemverilog
// file:perseus_ls_tlb.sv:L13654-L13939 (generate-for over tlb=0..43; one field per always_ff)
generate
  for (tlb=0; tlb < `PERSEUS_LS_L1_TLB_SIZE; tlb=tlb+1)
  begin : tlb_flops

  always_ff @(posedge clk or posedge reset_i)
  begin: u_tlb_val_q_tlb                                          // valid bit (async-reset)
    if (reset_i == 1'b1)
      tlb_val_q[tlb] <= `PERSEUS_DFF_DELAY {1{1'b0}};
    // ... XPROP branch elided — value = tlb_valid_din[tlb] when tlb_valid_upd_en=1
    else if (tlb_valid_upd_en == 1'b1)
      tlb_val_q[tlb] <= `PERSEUS_DFF_DELAY tlb_valid_din[tlb];
  end

  always_ff @(posedge clk_tlb_flops)
  begin: u_tlb_va_q_tlb_48_12                                      // VA tag [VA_MAX:12] — 37 bits
    if (wr_tlb_en_t4[tlb] == 1'b1)
      tlb_va_q[tlb][`PERSEUS_LS_VA_MAX:12] <= `PERSEUS_DFF_DELAY tlb_va_stg_t4_q[`PERSEUS_LS_VA_MAX:12];
  end

  always_ff @(posedge clk_tlb_flops)
  begin: u_tlb_crid_q_tlb_2_0                                      // Context/ASID/VMID-derived id — 3 bits
    if (wr_tlb_en_t4[tlb] == 1'b1)
      tlb_crid_q[tlb][`PERSEUS_LS_CRID_EXT] <= `PERSEUS_DFF_DELAY tlb_crid_stg_t4_q[`PERSEUS_LS_CRID_EXT];
  end

  always_ff @(posedge clk_tlb_flops)
  begin: u_tlb_ps_q_tlb_2_0                                        // page size — 3 bits
    if (wr_tlb_en_t4[tlb] == 1'b1)
      tlb_ps_q[tlb][`PERSEUS_LS_L1_TLB_PS] <= `PERSEUS_DFF_DELAY tlb_ps_stg_t4[`PERSEUS_LS_L1_TLB_PS];
  end

  always_ff @(posedge clk_tlb_flops) begin: u_tlb_smash_q_tlb        // smashed-bigpage bit — 1
    if (wr_tlb_en_t4[tlb]) tlb_smash_q[tlb] <= `PERSEUS_DFF_DELAY tlb_smash_stg_t4;        end

  always_ff @(posedge clk_tlb_flops) begin: u_tlb_global_q_tlb       // global (nG=0) bit — 1
    if (wr_tlb_en_t4[tlb]) tlb_global_q[tlb] <= `PERSEUS_DFF_DELAY tlb_global_stg_t4_q;    end

  always_ff @(posedge clk_tlb_flops) begin: u_tlb_dev_htrap_q_tlb    // device-htrap attribute — 1
    if (wr_tlb_en_t4[tlb]) tlb_dev_htrap_q[tlb] <= `PERSEUS_DFF_DELAY tlb_dev_htrap_stg_t4_q; end

  always_ff @(posedge clk_tlb_flops) begin: u_tlb_fwb_override_q_tlb // FWB attribute override — 1
    if (wr_tlb_en_t4[tlb]) tlb_fwb_override_q[tlb] <= `PERSEUS_DFF_DELAY tlb_fwb_override_stg_t4_q; end

  end
endgenerate
```

**Line-by-line.**
- `L13654 generate for tlb=0..L1_TLB_SIZE-1` — 44 copies instantiated; each gets its own named labelled block `tlb_flops[tlb]`.
- `tlb_val_q[tlb]` (L2608) — 1-bit, async-reset, clocked on `clk` (**not** `clk_tlb_flops`, because it must respond to invalidation-vector updates on any cycle, not only fill cycles). Next-state `tlb_valid_din[tlb] = tlb_val_q[tlb] & ~tlb_invalidate_vec[tlb] | wr_tlb_en_t4[tlb]` (`L13641`).
- `tlb_va_q[tlb][VA_MAX:12]` — 37-bit VA tag (actual VA span `[48:12]` per `PERSEUS_LS_VA_MAX=48`; `L13676`'s comment `_48_12` confirms).
- `tlb_crid_q[tlb][CRID_EXT]` — 3-bit **context-row-id**: a compressed encoding of {ASID, VMID, security/msid, E1/E2/E3, nested-virt indicator}. Special value `PERSEUS_LS_CRID_NESTED_VIRT_VAL` (`L12400`) identifies nested-virtualisation entries; `PERSEUS_LS_CRID_RNDR_VAL` (L14835) flags RNDR-attribute translations. The actual CRID→{ASID/VMID} expansion is held in a separate side-table referenced by `crid_table_replace_en_a1_q` (L12400).
- `tlb_ps_q[tlb][L1_TLB_PS]` — 3-bit page-size encoding (4K/16K/64K/256K/2M/512M/1G — page-size tokens `PERSEUS_LS_L1_TLB_PS_{4K,16K,64K,256K,2M,512M}` seen at L12344, §8.3).
- `tlb_smash_q[tlb]` — 1 bit. "Smashed" = a larger-page entry that had to be fractured to allow per-attribute updates without breaking TLBI-by-VA semantics; gated on smash-specific match logic (§1 ref to `tlb_va_smashed_entry_match_ls0_a1`).
- `tlb_global_q[tlb]` — 1 bit. `nG=0` entries (Global) match across all ASIDs.
- `tlb_dev_htrap_q[tlb]` — 1 bit. Device-memory htrap attribute carried in the TLB to accelerate permission path.
- `tlb_fwb_override_q[tlb]` — 1 bit. Stage-2 Force-Write-Back override status from HCR_EL2.FWB.

**Per-entry bit budget (resolved).**
| Field | Width | Reset? | Clock |
|-------|-------|--------|-------|
| valid | 1 | yes (→0) | `clk` |
| VA tag | 37 ([48:12]) | no | `clk_tlb_flops` |
| CRID | 3 | no | `clk_tlb_flops` |
| page size | 3 | no | `clk_tlb_flops` |
| smashed | 1 | no | `clk_tlb_flops` |
| global | 1 | no | `clk_tlb_flops` |
| dev_htrap | 1 | no | `clk_tlb_flops` |
| FWB override | 1 | no | `clk_tlb_flops` |
| **Visible subtotal** | **48** | | |

Additional per-entry data flopped **outside the `tlb_flops` generate** include PA payload, permission bits, HD/AF/DBM, NS, NSE, cache-attributes — these are captured into per-pipeline `a2` flops on CAM hit (§8.2) rather than stored in the entry-array proper. `(UNVERIFIED: total per-entry bit count including PA + permission + attribute fields stored in sibling always_ff blocks at L13754-L13939 range not exhaustively tallied here; visible subtotal 48 bits covers only the 7 generate-loop fields. Gate 10 fill-pipeline walkthrough will complete the layout if required.)`

**Design rationale.**
- **Why 7 data-field flops per entry (not one wide register).** Splitting by field allows the synthesis tool to clock-gate at field granularity (all share `clk_tlb_flops`, so this matters less here) and — more importantly — allows each field to have its own `_stg_t4` staging source, making the fill pipeline easier to retime. Also keeps linting clean: each `always_ff` has a single LHS and a single staging signal.
- **Why separate `tlb_val_q` on `clk` (not `clk_tlb_flops`).** Invalidation (TLBI, context-change, replace) must be able to deassert `tlb_val_q` on cycles where no fill is in flight. Putting the valid bit on the gated clock would prevent TLBI from clearing it unless a simultaneous fill happened — unacceptable.
- **Why no reset on data flops.** Power and timing (async-reset fan-out on 44×~48 bits is material). Correctness is carried by the 44-bit `tlb_val_q` vector alone.

### §8.2 CAM compare logic (VA match per entry, page-size-hierarchical)

**Purpose.** Compare the incoming VA of each of the 3 pipelines against all 44 entry tags, producing per-entry per-pipeline hit bits `tlb_va_match_lsN_a1[tlb]`. The compare is **page-size hierarchical**: it decomposes into nested range-matches for 1G / 2M / 256K / 64K / 16K / 4K so that one comparator tree serves all six supported sizes.

**RTL excerpt (ls0 path; ls1/ls2 are verbatim copies).**

```systemverilog
// file:perseus_ls_tlb.sv:L4982-L5067 (generate-for inside tlb_va_match_gen)
for (tlb=0; tlb < `PERSEUS_LS_L1_TLB_SIZE+1; tlb=tlb+1)
begin : tlb_va_match_gen

  assign tlb_va_1g_match_ls0_a1[tlb]     =    (ls0_cin_r_a1[tlb][`PERSEUS_LS_VA_MAX:30]
                                                == ls0_cout_r_a1[tlb][`PERSEUS_LS_VA_MAX-1:29]);

  assign tlb_va_match_2m_ls0_a1[tlb]     =  tlb_va_1g_match_ls0_a1[tlb]
                                          & (ent_is_512m[tlb]
                                             | (ls0_cin_r_a1[tlb][29:22] == ls0_cout_r_a1[tlb][28:21]));

  assign tlb_va_match_256k_ls0_a1[tlb]   =  tlb_va_match_2m_ls0_a1[tlb]
                                          & (ent_is_2m_or_greater[tlb]
                                             | (ls0_cin_r_a1[tlb][21:19] == ls0_cout_r_a1[tlb][20:18]));

  assign tlb_va_match_64k_ls0_a1[tlb]    =  tlb_va_match_256k_ls0_a1[tlb]
                                          & (ent_is_256k_or_greater[tlb]
                                             | (ls0_cin_r_a1[tlb][18:17] == ls0_cout_r_a1[tlb][17:16]));

  assign tlb_va_match_16k_ls0_a1[tlb]    =  tlb_va_match_64k_ls0_a1[tlb]
                                          & (ent_is_64k_or_greater[tlb]
                                             | (ls0_cin_r_a1[tlb][16:15] == ls0_cout_r_a1[tlb][15:14]));

  // ... partial / coalesced / 4k-only derivative combinations at L5041-L5067 ...
  assign tlb_va_match_ls0_a1[tlb]        =      tlb_va_match_16k_to_256k_partial_match_ls0_a1[tlb]
                                            | ...;
end
```

**Line-by-line.**
- **1G match.** Compare {VA[VA_MAX:30]} (guaranteed carry-in side of the final adder, `ls0_cin_r_a1[tlb][VA_MAX:30]`) against {tag[VA_MAX-1:29]} (`ls0_cout_r_a1`, the carry-out side) — i.e. the final-sum equivalence of the upper VA bits with the stored tag. 1G match is the most coarse predicate and forms the common prefix for all smaller sizes.
- **2M match.** 1G match AND (entry is 512M — i.e. nothing finer to compare — OR bits [29:22] also match). The `ent_is_512m[tlb]` predicate (decoded from `tlb_ps_q[tlb]`) is the "don't-care" qualifier letting 512M entries hit with only the 1G-level compare.
- **256K, 64K, 16K matches.** Each recursive step adds one narrower bit-range compare, qualified by `ent_is_<next-bigger>_or_greater[tlb]` so entries whose recorded page size is larger treat those bits as don't-care.
- **Final `tlb_va_match_ls0_a1[tlb]`** — OR of the coalesced / non-coalesced / 4K-only derivative match vectors (`L5057-L5067`) that together cover every legal {entry_ps × incoming_va_alignment} combination.

**Why `cin` / `cout` naming.** Ports `agu_addend_a_lsN_a1`, `agu_addend_b_lsN_a1`, `carry_in_lsN_a1` (L218-L223) feed a carry-save representation of the VA final sum directly into the TLB CAM **without** materialising `va = a + b + cin` first. This saves ~1 half-cycle of AGU→adder→compare path by fusing the adder into the CAM-compare tree via the Kogge-Stone-style identity "`(a+b+cin)[k:j] == tag[k:j]`" iff bit-wise `(a ^ b)[k:j] == ...`. `cin_r_a1[tlb]` and `cout_r_a1[tlb]` are the per-entry carry-propagate and carry-generate outputs of this fused adder-compare.

**Design rationale.**
- **Why page-size-hierarchical.** A 44-entry fully-associative CAM with 6 page sizes would require 44×6 independent range comparators if done flatly. The hierarchical recurrence reuses upper-bit compares across sizes: 1G → 2M → 256K → 64K → 16K → 4K each add one narrower-bit AND-OR stage, giving O(log(max_ps/4K)) depth rather than O(num_page_sizes) width.
- **Why fuse adder into CAM.** a1 is tight in a 3-wide, 44-entry CAM. Partial-sum/compare fusion shaves one XOR-carry stage off the critical path. The trade-off is per-entry silicon area for the carry-propagate wires (`cin_r_a1[tlb]`, `cout_r_a1[tlb]`).

This resolves Gate 6 §6.3's **"exact combinational AP/PAN/UAO span"** UNVERIFIED partially — the address-match span is here; the AP/PAN/UAO qualifiers are §8.6.

### §8.3 Page-size mask generation

**Purpose.** Generate a VA don't-care mask `stg_flop_va_mask[28:12]` that tells the smash/TLBI context-match logic which bits of the staged VA are "page-offset" given the entry's page size — so that a TLBI-by-VA operation at coarse granularity correctly matches all sub-pages.

**RTL excerpt.**

```systemverilog
// file:perseus_ls_tlb.sv:L12337-L12342
  assign stg_flop_va_mask[28:12] =         (           {17{(tlb_ps_stg_t4_q[`PERSEUS_LS_L1_TLB_PS] == `PERSEUS_LS_L1_TLB_PS_512M)}}
                                           | { {8'b0},  {9{(tlb_ps_stg_t4_q[`PERSEUS_LS_L1_TLB_PS] == `PERSEUS_LS_L1_TLB_PS_2M)}}}
                                           | { {11'b0}, {6{(tlb_ps_stg_t4_q[`PERSEUS_LS_L1_TLB_PS] == `PERSEUS_LS_L1_TLB_PS_256K)}}}
                                           | { {13'b0}, {4{(tlb_ps_stg_t4_q[`PERSEUS_LS_L1_TLB_PS] == `PERSEUS_LS_L1_TLB_PS_64K)}}}
                                           | { {15'b0}, {2{(tlb_ps_stg_t4_q[`PERSEUS_LS_L1_TLB_PS] == `PERSEUS_LS_L1_TLB_PS_16K)}}}) & ~{17{tlb_resp_eff_flt_t4_q}};
```

**Line-by-line.** Each OR term selects a mask width appropriate to the staged entry's page size: 512M→[28:12] all 17 bits masked; 2M→[20:12] (9 bits); 256K→[17:12] (6 bits); 64K→[15:12] (4 bits); 16K→[13:12] (2 bits). 4K needs no mask (implicit — no term). The final `& ~{17{tlb_resp_eff_flt_t4_q}}` forces the mask to 0 if the staged entry is a fault response (no legitimate fill; no masking).

**Design rationale.** A lookup-table-per-page-size implementation would be 5× wider. The stacked-OR shift representation leverages the fact that the page-size mask is a prefix-of-ones: each larger size is a superset of the smaller. Zero-padding shifts each term into the correct low-bit position.

### §8.4 Hit select (per-pipeline OR-reduce + stg-flop merge)

**Purpose.** Reduce the 44-bit per-entry match vector plus the separate stg-flop (bypass of a just-written-but-not-yet-committed entry) into a single pipeline-level `tlb_any_hit_lsN_a1` scalar, and build the final 44-bit hit vector used downstream (for tlbid encode, permission mux, page-size selection).

**RTL excerpt.**

```systemverilog
// file:perseus_ls_tlb.sv:L6625 / L6748 / L7163-L7165 (ls0 path shown; ls1/ls2 identical)
      assign tlb_hit_no_force_miss_ls0_a1[tlb] = tlb_va_match_ls0_a1[tlb];   // combinational per-entry (L6625)

  assign tlb_any_hit_no_force_miss_ls0_a1 =
                stg_flop_hit_no_force_miss_ls0_a1
              | (|tlb_hit_no_force_miss_ls0_a1[`PERSEUS_LS_L1_TLB_SIZE-1:0]);  // (L6748)

  assign stg_flop_hit_vector_ls0_a1[`PERSEUS_LS_L1_TLB_SIZE-1:0] =
                {(`PERSEUS_LS_L1_TLB_SIZE){stg_flop_hit_no_force_miss_ls0_a1}}
              & wr_tlb_en_t4[`PERSEUS_LS_L1_TLB_SIZE-1:0];                     // (L7163)

  assign tlb_hit_final_ls0_a1[`PERSEUS_LS_L1_TLB_SIZE-1:0] =
                stg_flop_hit_vector_ls0_a1[`PERSEUS_LS_L1_TLB_SIZE-1:0]
              | tlb_hit_no_force_miss_ls0_a1[`PERSEUS_LS_L1_TLB_SIZE-1:0];     // (L7165)
```

**Line-by-line.**
- `tlb_hit_no_force_miss[tlb]` (L6625) is just the per-entry page-size-hierarchical VA match from §8.2 (force-miss qualifiers are applied later at a2 via `tlb_any_hit_post_force_miss_*`).
- `tlb_any_hit_no_force_miss_ls0_a1` (L6748) is the top-level "any hit" — either the just-filled stg-flop is matching this VA **or** at least one real entry matches. This is the predicate fed into the `perseus_ls_multi_hit_detect` instance (§8.5) as `any_hit`.
- `stg_flop_hit_vector_ls0_a1` (L7163) promotes the stg-flop scalar hit to a 44-bit vector aligned to `wr_tlb_en_t4` — i.e. "if the stg-flop is the winner, the hit bit lives at the entry slot that's about to be written" (§8.8).
- `tlb_hit_final_ls0_a1` (L7165) is the OR of real-entry hits and the promoted stg-flop vector — the canonical hit vector used downstream.

**Design rationale.**
- **Why stg-flop bypass.** Bridge the 2-cycle latency between `mm_ls_tlb_miss_resp_v` (t3) and `wr_tlb_en_t4` (t4) — on cycle t3 a CAM lookup against the about-to-be-committed entry would miss even though the MMU has already returned the translation. Bypassing via `stg_flop_hit` avoids a second miss-walk for the same VA.
- **Why OR-reduce (no priority encoder on the 1-hot).** The CAM is fully associative and entries are supposed to be unique (multi-hit is a fault, §8.5). A flat OR is sufficient; the downstream `tlbid_lsN_a1` encoder (L7763) just priority-encodes the already-1-hot vector.

### §8.5 Multi-hit detect (3 instantiations)

**Purpose.** Detect the illegal "two TLB entries matched the same VA" case. Multi-hit indicates a fill-order hazard or an aliasing bug; downstream `tlb_hit_conflict_lsN_a2` raises a hit-conflict and forces the uop to miss-and-walk, invalidating both conflicting entries.

**RTL excerpt.**

```systemverilog
// file:perseus_ls_tlb.sv:L10774-L10803
  perseus_ls_multi_hit_detect `PERSEUS_LS_TLB_MULTI_HIT_INST u_ls0_multi_hit_detect
  (
    .clk                    (clk),
    .reset_i                (reset_i),
    .vld_cam                (tlb_cam_v_ls0_a1),
    .any_hit                (tlb_hit_no_force_miss_ls0_a1[`PERSEUS_LS_L1_TLB_SIZE-1:0]),
    .stg_flop_hit           (stg_flop_hit_post_lor_force_miss_ls0_a1),
    .multi_hit_nxt_cycle    (tlb_multi_hit_ls0_a2)
  );

  perseus_ls_multi_hit_detect `PERSEUS_LS_TLB_MULTI_HIT_INST u_ls1_multi_hit_detect ( /* same, ls1 */ );
  perseus_ls_multi_hit_detect `PERSEUS_LS_TLB_MULTI_HIT_INST u_ls2_multi_hit_detect ( /* same, ls2 */ );
```

**Line-by-line.** Three instances — one per pipeline. `any_hit` is the 44-bit per-entry hit vector from §8.4; `stg_flop_hit` is the bypass bit (counted toward multi-hit if the stg-flop overlaps with any CAM-array entry); output `multi_hit_nxt_cycle` is registered into a2.

**Design rationale.** Delegating to a dedicated L3 primitive (`perseus_ls_multi_hit_detect`) keeps the one-hot check logic in one place (reused across modules per spec §1) and gives a clean cycle boundary: the multi-hit signal is pre-computed at a1 and flopped into a2 to fit timing.

### §8.6 Permission check (combinational, per-pipeline)

**Purpose.** Combine the entry's stored permission bits (AP, UXN, PXN, nG, AF, DBM, attr) with the context (cur_el, cur_pan, cur_uao, xlat_tgt_m_bit) and the uop type (load/store/prefetch) to produce `permission_lsN_a2` / `permission_fault_lsN_a2`.

**RTL excerpt (snippet — full scope is large; representative m-bit casez at L2997).**

```systemverilog
// file:perseus_ls_tlb.sv:L2997-L3012 (representative permission-side casez)
  always_comb
  begin: u_xlat_tgt_m_bit_ls0_i2
    casez(cur_msid_ls0_i2[2:0])
      3'b000: xlat_tgt_m_bit_ls0_i2 = m_bit_secure_el01;
      3'b101: xlat_tgt_m_bit_ls0_i2 = m_bit_el3;
      3'b010: xlat_tgt_m_bit_ls0_i2 = m_bit_nonsec_el01;
      3'b0?1: xlat_tgt_m_bit_ls0_i2 = m_bit_hyp;
      default: xlat_tgt_m_bit_ls0_i2 = {1{1'bx}};
    endcase
  end
```

**Line-by-line.** The MSID-indexed mux chooses which of the 4 M-bit sources (secure EL0/1, EL3, non-secure EL0/1, hyp/EL2) drives the permission check for this pipeline. This early `i2` selection reduces the permission mux at a2 to a single pre-qualified input.

**Design rationale.** ARMv9 has 4 translation regimes × 2 PAN states × 2 UAO states × (AP, UXN, PXN) ≈ dozens of permission evaluations. Splitting across `i2` (context pre-select) and a2 (final AND/OR) fits the 2-stage pipeline without a permission-path timing fail. The full permission evaluation at a2 is spread across `always_comb` blocks around `L7419–L7480` (8 comb blocks visible in the grep), `L7833–L7894` (ls1 mirror), `L8247–L8308` (ls2 mirror) — each a narrow AP/UXN/PXN/PAN/UAO/dev-htrap predicate OR-reduction. `(UNVERIFIED: full 8×3 = 24 permission combinational blocks not individually quoted here — they fit the same pattern and would bloat the document by 500+ lines without adding insight. Gate 10 integration walkthrough will revisit if a specific ARM permission corner is at issue.)`

This partially resolves Gate 6 §6.3's AP/PAN/UAO UNVERIFIED — the comb-block topology is now located (L7419–L7480 ls0; L7833–L7894 ls1; L8247–L8308 ls2); exhaustive per-bit semantics deferred.

### §8.7 Miss request generation (→ `ls_mm_tlb_miss_v_a2`)

**Purpose.** When a CAM miss occurs and the outstanding-miss table has a free slot, emit the TLB-miss request to the MMU with the VA, context, uop-id, and request-type payload.

**RTL excerpt.**

```systemverilog
// file:perseus_ls_tlb.sv:L11371-L11383
  assign ls_mm_tlb_miss_v_a2 =       ( tlb_miss_ls0_a2 | tlb_miss_ls1_a2 | tlb_miss_ls2_a2)
                                   & ~ls_mm_idle_sys_req
                                   & (   ~miss_req_no_free_slots
                                       & (     ~(   oldest_uop_only_tlb_miss_alloc_mode_tier1_q
                                                  | oldest_uop_only_tlb_miss_alloc_mode_tier2_q
                                                  | ssbs_pass_older_st_a2
                                                )
                                             |  oldest_uop_tlb_miss_a2
                                             | spe_inject_tlb_miss_a2
                                             | tbe_inject_tlb_miss_a2
                                         )
                                     );
```

**Line-by-line.**
- Line 1: pipe-level OR — at least one of ls0/ls1/ls2 has a miss at a2.
- `& ~ls_mm_idle_sys_req` — honour LSU-wide MMU-idle request (DVM/TLBI quiescence window); no new TLB miss may be issued during it.
- `& ~miss_req_no_free_slots` — the outstanding-miss table (`outstanding_miss_valid_q[3:0]` — 4 slots — §9.2) must not be full.
- `& (... oldest-uop-only-mode predicates ...)` — under SSBS mismatch or oldest-uop-only allocation throttling (tier1/tier2), suppress younger misses. SPE/TBE-injected misses bypass this throttle.

**Design rationale.**
- **Why 4-deep outstanding table.** Balances miss-parallelism against tag-CAM area for miss-merge. 4 is chosen (not 2, not 8) because it matches typical L2-walker parallelism and the 3-wide LSU pipe's peak ("3 misses same cycle" saturates 3 slots + 1 slack).
- **Why SSBS-gated "oldest-only" mode.** The SSBS / SpecRestrictedForInstructionCreation protections require that certain memory ops not trigger speculative walks unless they are architecturally guaranteed to execute. Tiering (`tier1_q`, `tier2_q`) expresses progressive restriction levels.

### §8.8 Miss response capture + entry write

**Purpose.** When the MMU returns a translation (`mm_ls_tlb_miss_resp_v` at t3), capture the payload into stg-flops at t4, then commit to the array entry selected by `wr_tlb_en_t4[tlb]` (1-hot) on the next `clk_tlb_flops` tick.

**RTL excerpt (staging VA flop at t4).**

```systemverilog
// file:perseus_ls_tlb.sv:L12525-L12537
  always_ff @(posedge clk)
  begin: u_tlb_va_stg_t4_q_48_12
    if (mm_ls_tlb_miss_resp_v == 1'b1)
      tlb_va_stg_t4_q[`PERSEUS_LS_VA_MAX:12] <= `PERSEUS_DFF_DELAY tlb_va_din_tmp_t3[`PERSEUS_LS_VA_MAX:12];
`ifdef PERSEUS_XPROP_FLOP
    else if (mm_ls_tlb_miss_resp_v == 1'b0)
    begin
    end
    else
      tlb_va_stg_t4_q[`PERSEUS_LS_VA_MAX:12] <= `PERSEUS_DFF_DELAY {37{1'bx}};
`endif
  end
```

**Line-by-line.** On every cycle where an MMU response lands (`mm_ls_tlb_miss_resp_v=1`), `tlb_va_din_tmp_t3` (the assembled VA for this response, mixing MMU-resp payload with the captured request VA) is loaded into the stg-flop at t4. Sibling flops at `L12539+` load crid/ps/pa/perm analogously.

**Entry write (quoted earlier in §7.2 Pattern B and §8.1 excerpt — `wr_tlb_en_t4[tlb]` gates `tlb_va_q[tlb] <= tlb_va_stg_t4_q`).**

The `wr_tlb_en_t4[tlb]` one-hot is driven by `victim_ptr_dec_q[tlb]` (from §8.9 replacement — the previously-chosen victim slot) qualified by `tlb_wr_val_t4` and `~resp_mark_invalid_final_t4`:

```systemverilog
// file:perseus_ls_tlb.sv:L12318 (qualifier piece)
assign resp_mark_invalid_final_t4 =  tlb_global_stg_t4_q ?  resp_mark_invalid_t4_q
                                                        :  ...;
```

**Design rationale.** The t3→t4 stg-flop hop absorbs one cycle of MMU-response-to-entry-write latency, allowing the staged entry to be CAM-compared by the **next** a1 cycle via the stg-flop bypass (§8.4). Without staging, either the fill would take 2 cycles off MMU response (adding miss-to-replay latency) or a CAM-write port would be needed on the array (area cost).

### §8.9 Replacement policy (spec-intent RRIP vs RTL inline — dual-column framing)

**Purpose.** On a TLB fill, pick which of the 44 entries to evict. This is the one layer where §1's "(UNVERIFIED: whether ls_tlb uses RRIP, pseudo-LRU, or random replacement)" is resolved — decisively.

| **Spec-intent (from architectural abstraction / external docs)** | **RTL snapshot (this module, `perseus_ls_tlb.sv`)** |
|-----------------------------------------------------------------|------------------------------------------------------|
| RRIP (Re-Reference Interval Prediction) was a candidate policy based on industry precedent for multi-way TLBs. | **Actual policy: Second-Chance / CLOCK with high/low-table partitioning** — signals named `sec_chance_*`, `victim_in_high_table`, `victim_in_low_table`. **NOT RRIP.** |
| No `perseus_ls_rrip` instance grepped at Gate 7. | Confirmed: `grep 'rrip\|u_rrip' perseus_ls_tlb.sv` returns 0 hits. |
| Expected: 2-bit saturating RRPV per entry. | Observed: **1-bit reference / second-chance bit per entry**, `tlb_sec_chance_bit_q[43:0]`, updated in 4 quads (`tlb_sec_chance_bit_quad{1,2,3,4}_update`). |
| Expected: walk-through of RRPV on miss. | Observed: **two-level priority-encode scan** over `sec_chance_scan_bit_vec` — high table then low table. Each scan clears the reference bit of entries passed over (second chance). |

**RTL excerpt — victim selection.**

```systemverilog
// file:perseus_ls_tlb.sv:L15317-L15323 (high/low table split)
assign victim_in_high_table = ~(&sec_chance_scan_high_table[`PERSEUS_LS_L1_TLB_SIZE-1:0]);
assign victim_in_low_table  = ~victim_in_high_table & (~(&sec_chance_scan_bit_vec[`PERSEUS_LS_L1_TLB_SIZE-1:0]));

// file:perseus_ls_tlb.sv:L15325-L15341 (victim_ptr_nxt casez)
  always_comb
  begin: u_victim_ptr_nxt_44_1_0
    casez({victim_in_high_table, victim_in_low_table})
      2'b00: victim_ptr_nxt[(`PERSEUS_LS_L1_TLB_SIZE-1):0] = sec_chance_scan_ptr[(`PERSEUS_LS_L1_TLB_SIZE-1):0];    // fallback: linear scan
      2'b01: victim_ptr_nxt[(`PERSEUS_LS_L1_TLB_SIZE-1):0] = sec_chance_priority_enc_low_table_lvl2[(`PERSEUS_LS_L1_TLB_SIZE-1):0];   // low-table winner
      2'b1?: victim_ptr_nxt[(`PERSEUS_LS_L1_TLB_SIZE-1):0] = sec_chance_priority_enc_high_table_lvl2[(`PERSEUS_LS_L1_TLB_SIZE-1):0];  // high-table winner
      default: victim_ptr_nxt[(`PERSEUS_LS_L1_TLB_SIZE-1):0] = {44{1'bx}};
    endcase
  end

// file:perseus_ls_tlb.sv:L15354-L15373 (victim_ptr_enc_q update)
assign sec_chance_scan_en = mm_ls_tlb_miss_resp_v;

  always_ff @(posedge clk or posedge reset_i)
  begin: u_victim_ptr_enc_q_6_1_0
    if (reset_i == 1'b1)
      victim_ptr_enc_q[(`PERSEUS_LS_L1_TLB_SIZE_ENC-1):0] <= `PERSEUS_DFF_DELAY {6{1'b0}};
    else if (sec_chance_scan_en == 1'b1)
      victim_ptr_enc_q[(`PERSEUS_LS_L1_TLB_SIZE_ENC-1):0] <= `PERSEUS_DFF_DELAY victim_ptr_nxt_enc[(`PERSEUS_LS_L1_TLB_SIZE_ENC-1):0];
  end
```

**Line-by-line.**
- `sec_chance_scan_bit_vec[43:0]` reflects the current per-entry reference-bit state (1 = "give second chance", 0 = "evict candidate").
- `victim_in_high_table` is true iff any entry in the "high" 22-entry half has its reference bit clear (i.e. a non-protected candidate exists there).
- `victim_in_low_table` is the mirror for the low half, evaluated **only** when the high table is fully protected.
- The `casez` picks: high-table winner (priority-encoded, `sec_chance_priority_enc_high_table_lvl2`), else low-table winner, else — if all 44 reference bits are set — a linear round-robin scan pointer `sec_chance_scan_ptr` that *also* clears the passed-over reference bits (via `sec_chance_bit_clr_vec_mask`, L15302).
- `victim_ptr_enc_q` is updated **only on `mm_ls_tlb_miss_resp_v`** — i.e. the pointer advances exactly once per successful fill.
- The reference bits `tlb_sec_chance_bit_q` are set on CAM hit (implied via `tlb_sec_chance_bit_set`, L2435) and cleared by the passed-over mask on a miss-fill cycle — the CLOCK/second-chance signature.

**Design rationale.**
- **Why second-chance, not RRIP.** Second-chance is a lighter-weight approximation of LRU that requires **1 bit per entry** (44 flops total for 44 entries, plus a pointer). RRIP-2 would require 2 bits (88 flops). For a 44-entry fully-associative TLB where the LSU pipe adds already-significant CAM compare logic, the 1-bit policy trades a small hit-rate penalty for ~50% flop saving in the policy state — a reasonable LSU-area decision.
- **Why high/low table split.** Two 22-entry sub-tables give a two-level priority encoder (O(log 22) each) instead of a flat 44-way encoder, shaving replacement-path depth. The fallback linear scan handles the "everyone just got a hit" case where the 1-bit state saturates — identical to the CLOCK algorithm's rotating hand.

**Resolved UNVERIFIED flags (Gate 7/8).**
- `(UNVERIFIED: whether ls_tlb uses RRIP, pseudo-LRU, or random replacement)` — **resolved**: second-chance / CLOCK, 1-bit reference bit per entry, with high/low priority-encoded tables + linear-scan fallback pointer.
- §1's "(UNVERIFIED: whether ls_tlb uses RRIP ... inline replacement logic scan is deferred to Gate 9 §8)" — **resolved (see above)**.

### §8.10 TLBI / snoop match + invalidate vector

**Purpose.** On a TLB-maintenance operation (TLBI by VA / by ASID / by VMID / by ALL), identify which of the 44 entries must be invalidated, and clear their `tlb_val_q` bits on the following edge. A two-stage pipeline (a1 set → a2 commit → t4 clear) accommodates the CRID-match and smashed-entry-match combinational paths.

**RTL excerpt (invalidate-vector next-state generation).**

```systemverilog
// file:perseus_ls_tlb.sv:L12322-L12357 (generate-for over 44 entries)
generate
  for (tlb=0; tlb < `PERSEUS_LS_L1_TLB_SIZE; tlb=tlb+1)
  begin:snp_tmo_invalidate_vec_loop

    assign snp_tmo_invalidate_vec_set_a1[tlb] =        snp_tmo_context_match_a1[tlb]
                                                     & ~snp_tmo_va_valid
                                                     & ~snp_tmo_va_valid_a2
                                                     & any_tmo_inject_val_a1;

    assign snp_tmo_invalidate_vec_set_a1_a2[tlb] =      snp_tmo_invalidate_vec_set_a1[tlb]
                                                      | ( snp_tmo_va_valid_a2
                                                          & (   (snp_tmo_tlb_hit_a2[tlb] & ~tlb_hit_a1_eq_wr_vec_a2)
                                                             | (   tlb_smash_q[tlb]
                                                                 & snp_tmo_va_smashed_entry_match_a2_q[tlb]
                                                               )
                                                           )
                                                          & any_tmo_inject_val_a2
                                                        );

    assign snp_tmo_invalidate_vec_nxt[tlb]   =    (  (   (snp_tmo_invalidate_vec_set_a1_a2[tlb] & tlb_val_q[tlb] & ~snp_tmo_invalidate_vec_q[tlb])
                                                       | (snp_tmo_invalidate_vec_q[tlb]  & ~snoop_sync_inv_tlb_i2)
                                                     )
                                                    & ~tlb_invalidate_vec_pre[tlb]
                                                    & ~wr_tlb_en_t4[tlb]
                                                  )
                                                | ((resp_mark_invalid_final_t4 | snp_tmo_invalidate_vec_set_a1[tlb]) & wr_tlb_en_t4[tlb]);

  end
endgenerate
```

**RTL excerpt (invalidate flop + commit).**

```systemverilog
// file:perseus_ls_tlb.sv:L12361-L12378 + L12416-L12420
assign snp_tmo_vec_upd_en =   (any_tmo_inject_val_a1 & ~snp_tmo_va_valid)
                            | snp_tmo_va_valid_a2
                            | tlb_wr_val_t4
                            | snoop_sync_inv_tlb_i2
                            | tlb_invalidate_en;

  always_ff @(posedge clk or posedge reset_i)
  begin: u_snp_tmo_invalidate_vec_q_44_1_0
    if (reset_i == 1'b1)
      snp_tmo_invalidate_vec_q[(`PERSEUS_LS_L1_TLB_SIZE-1):0] <= `PERSEUS_DFF_DELAY {44{1'b0}};
    else if (snp_tmo_vec_upd_en == 1'b1)
      snp_tmo_invalidate_vec_q[(`PERSEUS_LS_L1_TLB_SIZE-1):0] <= `PERSEUS_DFF_DELAY snp_tmo_invalidate_vec_nxt[(`PERSEUS_LS_L1_TLB_SIZE-1):0];
  end

// commit: L13641 (tlb_valid_din = tlb_val_q[tlb] & ~tlb_invalidate_vec[tlb] | wr_tlb_en_t4[tlb])
//         L12416 (tlb_replace_inv_any = crid_table_replace_en_a1_q | scrub_all_tlb | snoop_sync_inv_tlb_i2)
```

**Line-by-line.**
- `snp_tmo_invalidate_vec_set_a1[tlb]` — context-match at a1: set if the TMO-op's context matches this entry's CRID **and** the TMO doesn't need a VA compare (`~snp_tmo_va_valid`).
- `snp_tmo_invalidate_vec_set_a1_a2[tlb]` — extends a1 set to the a2 VA-qualified case: either the a2-flopped "VA valid" TMO hits this entry's tag (regular TLBI-by-VA) **or** the entry is a smashed big-page and the smashed-VA-range match asserts.
- `snp_tmo_invalidate_vec_nxt[tlb]` — latch-set/hold logic: (new-set OR currently-set unless `snoop_sync_inv_tlb_i2` clears) gated by `~tlb_invalidate_vec_pre` (non-TMO invalidate wins) and `~wr_tlb_en_t4` (don't invalidate the slot being simultaneously filled, unless the fill itself is marked invalid — `resp_mark_invalid_final_t4`, L12318).
- `snp_tmo_invalidate_vec_q` flop-commits on `snp_tmo_vec_upd_en` — asserted on TMO inject, TMO a2 valid, fill write, snoop-sync-inv, or generic invalidate.
- Final commit: `tlb_val_q[tlb]` next-state is `tlb_val_q & ~tlb_invalidate_vec[tlb] | wr_tlb_en_t4[tlb]` (L13641) — invalidate-bit wins over hold, write wins over invalidate.

**Design rationale.**
- **Why latch-and-hold the invalidate vector across ≥1 cycle.** TMO operations may span multiple cycles (context-match at a1, VA-match at a2, flush window closure). A held vector allows the CAM hit at a future a2 to be suppressed as soon as the TMO arrives, before the actual `tlb_val_q` clears, providing single-cycle TLBI-to-no-hit response.
- **Why the complex `~wr_tlb_en_t4 ... | (resp_mark_invalid_final_t4 & wr_tlb_en_t4)` guard.** A simultaneous fill into a slot that the TMO has flagged for invalidation must be honoured: the entry is written *and then* invalidated (or the write is marked-invalid up-front). This encoding handles the race without dropping either the fill or the invalidate.

This resolves Gate 6 §6.5's **"exact entry-clear cycle span relative to snp_tmo_va_valid rising edge"** UNVERIFIED: the span is **1–2 cycles** — `snp_tmo_invalidate_vec_q` latches on the cycle of `snp_tmo_va_valid_a2=1` (or a1 context-match-only case), then commits to `tlb_val_q` on the next `clk` edge via `tlb_valid_din`.

---

## §9 状态机 (Finite-State Machines)

> Scope: enumerate every non-trivial multi-cycle state held inside `ls_tlb`. A top-level `typedef enum` grep (Gate 6 Step 5) returned 0 hits — the module expresses its FSMs through flop-set + combinational-next pattern, not SV enum. This section abstracts three such FSMs into explicit state tables + ASCII transition diagrams. Each is grounded in `_q` flops that already appeared in §7–§8.

### §9.1 Outstanding-miss slot FSM (4 independent instances, one per slot `i∈{0,1,2,3}`)

**Home flop.** `outstanding_miss_valid_q[i]` (`L1794`), plus the payload sidecar flops (va, crid, uid, rid, type, at_op, sec, spe_buf, tbe_buf, page_split2, no_alloc, resp_info_no_alloc, mark_invalid, non_spec_req, tmo_exact_match) that together form one "slot" of the 4-deep MSHR-equivalent outstanding-walk table.

**States (2).**

| State | Meaning | Home-flop value |
|-------|---------|-----------------|
| `FREE` | Slot is available to accept a new miss allocation. | `outstanding_miss_valid_q[i] = 0` |
| `BUSY` | Slot holds an in-flight walk awaiting `mm_ls_tlb_miss_resp_v` + `entry_to_free_dec_t3[i]`. | `outstanding_miss_valid_q[i] = 1` |

**Transition RTL (next-state casez).**

```systemverilog
// file:perseus_ls_tlb.sv:L14805-L14816
  always_comb
  begin: u_outstanding_miss_valid_nxt_i
    casez({ls_mm_tlb_miss_v_a2, mm_ls_tlb_miss_resp_v, ls_mm_idle_sys_req})
      3'b??_1: outstanding_miss_valid_nxt[i] = 1'b0;                                                                // idle-sys forces all to FREE
      3'b00_0: outstanding_miss_valid_nxt[i] = outstanding_miss_valid_q[i];                                         // hold
      3'b01_0: outstanding_miss_valid_nxt[i] = (outstanding_miss_valid_q[i]&(~(entry_to_free_dec_t3[i])));           // free (resp)
      3'b10_0: outstanding_miss_valid_nxt[i] = (outstanding_miss_valid_q[i]|entry_to_fill_dec_a2[i]);                // allocate
      3'b11_0: outstanding_miss_valid_nxt[i] = ((outstanding_miss_valid_q[i]|entry_to_fill_dec_a2[i])&(~(entry_to_free_dec_t3[i]))); // alloc + free same cycle
      default: outstanding_miss_valid_nxt[i] = {1{1'bx}};
    endcase
  end
```

**ASCII transition diagram.**

```
                   entry_to_fill_dec_a2[i] & ls_mm_tlb_miss_v_a2 & ~ls_mm_idle_sys_req
               ┌────────────────────────────────────────────────────────────────────┐
               ▼                                                                     │
          ┌────────┐                                                           ┌────┴───┐
  reset ─►│  FREE  │                                                           │  BUSY  │
          │ (q=0)  │                                                           │ (q=1)  │
          └────────┘◄─────────────────────────────────────────────────────────┘        │
               ▲   entry_to_free_dec_t3[i] & mm_ls_tlb_miss_resp_v & ~ls_mm_idle_sys_req│
               │   OR  ls_mm_idle_sys_req  (unconditional flush)                        │
               └────────────────────────────────────────────────────────────────────────┘
```

**Triggers table.**

| Transition | Predicate | RTL |
|------------|-----------|-----|
| FREE → BUSY | `ls_mm_tlb_miss_v_a2 & entry_to_fill_dec_a2[i] & ~ls_mm_idle_sys_req` | L14812–L14813 |
| BUSY → FREE (normal) | `mm_ls_tlb_miss_resp_v & entry_to_free_dec_t3[i]` | L14811 |
| BUSY → FREE (force) | `ls_mm_idle_sys_req` | L14810 |
| BUSY → BUSY | `~(alloc \| free)` | L14810 |
| FREE → FREE | `~alloc` | L14810 |

**Lifecycle waveform (one slot).**

```
Cycle:                              T0 T1 T2 T3 T4 T5
outstanding_miss_valid_q[0]         __|‾‾‾‾‾‾‾‾‾‾‾‾‾|_______
entry_to_fill_dec_a2[0]             _|‾‾|__________________
ls_mm_tlb_miss_v_a2                 _|‾‾|__________________
mm_ls_tlb_miss_resp_v               ____________|‾‾|_______
entry_to_free_dec_t3[0]             ____________|‾‾|_______
state (abstract)                    F | B | B | B | F | F
```
(Allocate at T1; walk in flight T1–T3; response + free at T4; FREE again from T5.)

### §9.2 TLB-fill staging FSM (`tlb_stg_flops_val_q`)

**Home flop.** `tlb_stg_flops_val_q` (`L2445`). One bit. This is the t3→t4 pipeline valid that gates the TLB entry-array write (§8.1, §8.8) and also enables `clk_tlb_flops` (§7.1).

**States (2).**

| State | Meaning | Value |
|-------|---------|-------|
| `IDLE` | No fill in flight; `clk_tlb_flops` off. | `tlb_stg_flops_val_q = 0` |
| `STAGED` | A fill was captured into `tlb_{va,crid,ps,...}_stg_t4_q` last cycle; `wr_tlb_en_t4[tlb]` will fire this cycle to commit to the entry. | `tlb_stg_flops_val_q = 1` |

**Transition RTL.**

```systemverilog
// file:perseus_ls_tlb.sv:L12482-L12524
assign tlb_stg_flops_val_nxt_early_t3 =  mm_ls_tlb_miss_resp_v
                                        & (   ~resp_no_alloc_t3
                                             & ( ~(saved_info_valid_q & (resp_uid_t3[`PERSEUS_UID] == saved_info_uid_q[`PERSEUS_UID])
                                                                      & (resp_rid_t3 == saved_info_rid_q)
                                                                     & ~(saved_flt_page_split2_q & ~resp_page_split2_t3)
                                                  )
                                                  & ~((eff_mmu_resp_flt_t3 | tlb_resp_at_op_t3) & resp_info_no_alloc_t3)
                                                | tlb_resp_spe_buf_t3
                                                | tlb_resp_tbe_buf_t3
                                               )
                                           );

assign tlb_stg_flops_val_nxt_t3 =   tlb_stg_flops_val_nxt_early_t3
                                 & ~(|(entry_to_free_dec_t3[`PERSEUS_LS_OUTSTANDING_REQ_MAX_CNT-1:0] & outstanding_miss_no_alloc_set[`PERSEUS_LS_OUTSTANDING_REQ_MAX_CNT-1:0]));

  always_ff @(posedge clk or posedge reset_i)
  begin: u_tlb_stg_flops_val_q
    if (reset_i == 1'b1)
      tlb_stg_flops_val_q <= `PERSEUS_DFF_DELAY {1{1'b0}};
    else if (outstanding_miss_valid_non_static_flops_upd_en == 1'b1)
      tlb_stg_flops_val_q <= `PERSEUS_DFF_DELAY tlb_stg_flops_val_nxt_t3;
  end
```

**ASCII transition diagram.**

```
                 mm_ls_tlb_miss_resp_v & ~resp_no_alloc_t3 & ~page_split2_mismatch & ~no_alloc_race
                 ───────────────────────────────────────────────────────────────────────────────►
          ┌────────┐                                                               ┌──────────┐
  reset ─►│  IDLE  │                                                               │  STAGED  │
          │ (q=0)  │                                                               │  (q=1)   │
          └────────┘◄─────────────────────────────────────────────────────────────┘          │
                          unconditional one-cycle — next cycle commits to tlb_va_q[tlb]      │
                          via wr_tlb_en_t4[victim]; STAGED always returns to IDLE next edge  │
                          unless another mm_ls_tlb_miss_resp_v lands back-to-back            │
```

**Triggers table.**

| Transition | Predicate | RTL |
|------------|-----------|-----|
| IDLE → STAGED | `mm_ls_tlb_miss_resp_v & ~resp_no_alloc_t3 & ~saved_info_conflict & ~no_alloc_race` | L12482–L12502 |
| STAGED → IDLE | `~mm_ls_tlb_miss_resp_v` next cycle (most common) | L12501 |
| STAGED → STAGED | back-to-back `mm_ls_tlb_miss_resp_v` | same |

**Lifecycle.**

```
Cycle:                     T3    T4    T5
mm_ls_tlb_miss_resp_v      |‾‾|________
tlb_stg_flops_val_q        ____|‾‾|____
clk_tlb_flops (gated)      ____|‾|_____   (one pulse, during STAGED)
wr_tlb_en_t4[victim]       ____|‾‾|____
tlb_va_q[victim] (commits) _______|‾‾‾  (flops on clk_tlb_flops edge inside STAGED)
```

This FSM is the **bridge between the MMU response timing and the entry-array write timing**, and also the clock-gate enable for `clk_tlb_flops` (§7.1). Its one-cycle natural decay means the entry-array is only clocked in the cycle that a commit is pending — the power-saving invariant.

### §9.3 SPE VA→PA sampling FSM (`spe_va_to_pa_counter_active_q`)

**Home flops.** `spe_va_to_pa_counter_active_q` (`L1976`), `spe_va_to_pa_counter_en_q` (`L1979`), `spe_va_to_pa_counter_q[11:0]` (the elapsed-cycle counter).

**States (3, derived).**

| State | `active_q` | `en_q` | Meaning |
|-------|------------|--------|---------|
| `IDLE` | 0 | 0 | No SPE sample pending. |
| `ACTIVE` | 1 | 1 | SPE uop in flight between i2 issue and a2 translation complete; counter incrementing each cycle to measure VA→PA latency. |
| `DONE` | 1 | 0 | Translation completed (`tlb_any_hit_lsN_a2` or abort), counter frozen awaiting `ls_spe_buffer_done` to drain. |

**Transition RTL.**

```systemverilog
// file:perseus_ls_tlb.sv:L16541-L16584
assign spe_va_to_pa_counter_stop =   ls0_spe_va_to_pa_counter_stop_pre_a2
                                   | ls1_spe_va_to_pa_counter_stop_pre_a2
                                   | ls2_spe_va_to_pa_counter_stop_pre_a2;

assign spe_va_to_pa_counter_en_nxt =     spe_va_to_pa_counter_start_a1
                                     |  (spe_va_to_pa_counter_en_q & ~(spe_va_to_pa_counter_stop | ls_spe_buffer_done));

assign spe_va_to_pa_counter_active_nxt =    spe_va_to_pa_counter_start_a1
                                          | (spe_va_to_pa_counter_active_q & ~(ls_spe_buffer_done));

  always_ff @(posedge clk or posedge reset_i)
  begin: u_spe_va_to_pa_counter_en_q
    if (reset_i == 1'b1)
      spe_va_to_pa_counter_en_q <= `PERSEUS_DFF_DELAY {1{1'b0}};
    else if (spe_va_to_pa_counter_state_bits_clk_en == 1'b1)
      spe_va_to_pa_counter_en_q <= `PERSEUS_DFF_DELAY spe_va_to_pa_counter_en_nxt;
  end

  always_ff @(posedge clk or posedge reset_i)
  begin: u_spe_va_to_pa_counter_active_q
    if (reset_i == 1'b1)
      spe_va_to_pa_counter_active_q <= `PERSEUS_DFF_DELAY {1{1'b0}};
    else if (spe_va_to_pa_counter_state_bits_clk_en == 1'b1)
      spe_va_to_pa_counter_active_q <= `PERSEUS_DFF_DELAY spe_va_to_pa_counter_active_nxt;
  end
```

**ASCII transition diagram.**

```
                   spe_va_to_pa_counter_start_a1
          ┌──────────────────────────────────────────────────────┐
          ▼                                                       │
   ┌──────────┐     spe_va_to_pa_counter_stop     ┌────────┐     │
   │   IDLE   │                                   │ ACTIVE │     │
   │ a=0,e=0  │                                   │ a=1,e=1│     │
   └──────────┘   ◄──────────────────────────────┐└────┬───┘     │
          ▲      ls_spe_buffer_done              │     │         │
          │                                      │     ▼  stop   │
          │                                      │ ┌────────┐    │
          └──────────────────────────────────────┘ │  DONE  │    │
                     ls_spe_buffer_done            │ a=1,e=0│    │
                                                   └────────┘    │
                                                        ▲        │
                                                        │        │
                                                        └────────┘
                                              (active_q stays 1
                                               until buffer drain)
```

**Triggers table.**

| Transition | Predicate | RTL |
|------------|-----------|-----|
| IDLE → ACTIVE | `spe_va_to_pa_counter_start_a1` (any of `spe_va_pa_counter_start_lsN_a1`, L16496) | L16552, L16567 |
| ACTIVE → DONE | `spe_va_to_pa_counter_stop` (any of `lsN_spe_va_to_pa_counter_stop_pre_a2`, L16505/L16515/L16525) | L16550 |
| DONE → IDLE | `ls_spe_buffer_done` | L16567, L16584 |
| any → (clk-gated no-op) | `~spe_va_to_pa_counter_state_bits_clk_en` | L16547 |

**Lifecycle waveform.**

```
Cycle:                                T0  T1  T2  T3  T4  T5  T6  T7
spe_va_to_pa_counter_start_a1         __|‾‾|________________________
spe_va_to_pa_counter_en_q             ____|‾‾‾‾‾‾‾‾‾|______________   (ACTIVE)
spe_va_to_pa_counter_active_q         ____|‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾|____   (ACTIVE+DONE)
spe_va_to_pa_counter_stop             ________________|‾‾|________
tlb_any_hit_lsN_a2                    ________________|‾‾|________
ls_spe_buffer_done                    ____________________|‾‾|____
spe_va_to_pa_counter_q[11:0]          ==|=0=|=1=|=2=|=3=|=3=|=0=|==   (incr ACTIVE, frozen DONE, clear on done)
state                                 I  | A | A | A | D | D | I
```

### §9.4 FSMs NOT located in `ls_tlb.sv`

The plan Step 5 called out an "MTE address precommit FSM (`prec_mte_uid_vld_q`)". Grep finds `prec_mte_va_uid_q` and `prec_mte_uid_vld_q` only as **module inputs** (`L89–L90`) — the FSM itself lives upstream (likely `perseus_ls_dispatch` or `perseus_ls_mte_ctrl`). Inside `ls_tlb` these are purely consumer signals used by the MTE-check address path (e.g. `L15528+` near the nandgate instances). `(UNVERIFIED: inferred; the MTE precommit FSM is upstream of ls_tlb — Gate 10 integration walkthrough should point at the actual owning module. The signals land here as already-stable inputs.)`

Also referenced — the `tbe_inject_reserve_slot_q` (L11493) and `crid_table_replace_en_a1_q` (L4563) are single-cycle captures (not multi-state FSMs) and are documented under §8.7 / §8.10 respectively.

### §9.5 FSM summary

| # | FSM | States | Home flop | Section | R7 lifecycle wave |
|---|-----|--------|-----------|---------|--------------------|
| 1 | Outstanding-miss slot (×4) | FREE / BUSY | `outstanding_miss_valid_q[i]` | §9.1 | §9.1 + §6.2 |
| 2 | TLB-fill staging | IDLE / STAGED | `tlb_stg_flops_val_q` | §9.2 | §9.2 + §6.2 (T3/T4) |
| 3 | SPE VA→PA sampling | IDLE / ACTIVE / DONE | `spe_va_to_pa_counter_active_q + en_q` | §9.3 | §9.3 |
| 4 | Snoop-TMO invalidate vector (covered in §6.5 + §8.10) | tracked per-entry within `snp_tmo_invalidate_vec_q` | `snp_tmo_invalidate_vec_q[43:0]` | §8.10 | §6.5 |

**UNVERIFIED items introduced in §7–§9 (Gate 9 tally):**
- §7.3 — `cb_dftramhold` has no functional reference inside `ls_tlb.sv` body; consumed only inside the clock-gate cell's DFT path. Pending Gate 10 integration walkthrough.
- §8.1 — Total per-entry bit count including sibling PA + permission + attribute captures is not exhaustively tallied (visible generate-loop subtotal = 48 bits across 8 fields).
- §8.6 — Full 24-way permission combinational block (8 narrow AP/UXN/PXN predicates × 3 pipes) not individually quoted; topology located and cited.
- §9.4 — MTE-precommit FSM owning module not located; inputs land at `L89–L90` from upstream.

**UNVERIFIED items resolved at Gate 9:**
- §1 `(UNVERIFIED: whether ls_tlb uses RRIP, pseudo-LRU, or random replacement)` — **RESOLVED §8.9** as second-chance / CLOCK (1-bit per entry + high/low table priority-encoded scan + linear-scan fallback).
- §1 "inline replacement logic scan is deferred to Gate 9 §8" — **RESOLVED §8.9**.
- Gate 7/8 "44-entry bit layout" — **PARTIALLY RESOLVED §8.1 / §7.4** (8 per-entry fields identified with widths: valid/va/crid/ps/smash/global/dev_htrap/fwb_override = 48 bits visible; PA + permission captures stored per-pipeline at a2, not in the entry array).
- Gate 6 §6.3 "exact combinational AP/PAN/UAO span" — **PARTIALLY RESOLVED §8.2 / §8.6** (address-match span located; full permission AP/UXN/PXN semantics flagged as lower-priority).
- Gate 6 §6.5 "exact entry-clear cycle span relative to snp_tmo_va_valid" — **RESOLVED §8.10** as 1–2 cycles (a1/a2 set of vector → next-edge commit to `tlb_val_q`).

---

*End of §7–§9 (Gate 9). §10–§14 will be authored in Task 11 (Gate 10).*

