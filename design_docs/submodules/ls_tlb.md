# L2 Module: `perseus_ls_tlb` — 44-entry L1 Data micro-TLB

> Scope of this document in the current pilot gate: **§1 (Module Role) + §2 (Features) only**.
> §3–§14 will be authored in Tasks 8–11 (Gates 7–10). Do not read later sections here — they do not yet exist.

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

*End of §1–§2. §3 (微架构抽象) begins in Task 8 / Gate 7.*
