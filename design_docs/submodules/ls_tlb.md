# L2 Module: `perseus_ls_tlb` — 44-entry L1 Data micro-TLB

> Scope of this document in the current pilot gate: **§1 (Module Role) + §2 (Features) + §3 (Microarchitectural Abstraction) + §4 (Block Diagram)**.
> §5–§14 will be authored in Tasks 9–11 (Gates 8–10). Do not read later sections here — they do not yet exist.

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

*End of §3–§4. §5–§14 will be authored in Tasks 9–11 (Gates 8–10).*

