# Submodule: `perseus_ls_lrq`

> Scope of this document: Sections §1–§2 only (Gate 11, critical).
> §3–§14 will be authored in Tasks 13–18 (Gates 12–17).

> Framing rule (per user/spec §7, R5): the design spec is the authoritative
> source-of-intent; the RTL snapshot under analysis is a delivered subset of
> that intent and may legitimately under-implement individual spec clauses.
> Where this document observes a mismatch, it records both sides as
> "spec-intent vs current RTL snapshot" without calling either side wrong.

---

## §1 Positioning

### §1.1 One-sentence role

`perseus_ls_lrq` is the **16-entry Load Request Queue** (MSHR-adjacent) that
tracks every outstanding load that has left the AGU pipeline but has not yet
produced an architectural result — L1-miss loads awaiting an L2 response,
loads waiting for older store data (STD wake-up), loads waiting for the
precommit wavefront to catch up (older-uid ordering), loads parked on an
LPT (load-pending-tag) hazard, loads parked on a fill-buffer (FB) dependency,
and loads in the various L2-response capture stages. Each of the 16 entries
is an independent 10-state FSM; the queue supports up to 3-way concurrent
allocation from the `ls0` / `ls1` / `ls2` AGU pipes and out-of-order release
keyed by the L2 response DID.

### §1.2 Pipeline position

| Stage        | LRQ activity                                                                                     |
|--------------|--------------------------------------------------------------------------------------------------|
| `a1 / a2`    | Per-pipe `lsN_block_lrq_alloc_a2_q` qualifier evaluated; `lrq_alloc_possible_a1/a2` computed      |
| `d2` (alloc) | Up to three allocates (`ls0_alloc` / `ls1_alloc` / `ls2_alloc`) into free entries on the same cycle |
| `d0` (reissue) | Entry wins `ls_tag_data_arb` to reissue its load through the LS pipe                            |
| `d3 / d4`    | `ld_accept_with_fast_byp_q`, `linked_fb_but_no_fb_match_d3` resolved; FSM-next chosen              |
| `m3 / m4`    | L2 response captured → `L2RESP_M3` / `L2RESP_M4` states; data merged with fast-bypass             |
| `iz`         | `ls_is_lrq_wakeup_iz` broadcast drives dependent-op wake-up in ICSU                                |

Reference: `perseus_ls_lrq.sv:L30-L120` (module header / top-level I/O);
`perseus_ls_lrq.sv:L3846-L3862` (`ls_is_lrq_wakeup_iz` flop at `iz`).

### §1.3 Key parameters

| Parameter                       | Value | Evidence                                        |
|---------------------------------|-------|-------------------------------------------------|
| `PERSEUS_LS_LRQ_SIZE`           | 16    | `perseus_ls_defines.sv:L721`                    |
| `PERSEUS_LS_LRQ_WAIT_ID_MAX`    | 6     | `perseus_ls_defines.sv:L737`                    |
| `PERSEUS_LS_LRQ_STATE` width    | 4 b   | `perseus_ls_defines.sv:L725` (encodes 10 states in a 4-bit field) |

### §1.4 Key collaborators (external handshake counterparties)

| Collaborator          | Role in LRQ's operation                                                                                   |
|-----------------------|-----------------------------------------------------------------------------------------------------------|
| `ls_fb`               | Fill-buffer / MSHR — owns the L1 refill slot; LRQ entries carry `ld_linked_fb_*` linkage IDs              |
| `ls_tag_data_arb`     | Pipeline arbitration at `d0`; LRQ competes with fresh AGU ops via `disable_lrq0_pick_nxt` / `disable_lrq1_pick_nxt` |
| `ls_agu`              | Supplies `precommit_uid_q` used by the `WAIT_OLD_PRECOMMIT` FSM branch                                     |
| `ls_iq` (issue queue) | Consumes `iq_older_than_lrq_a1`, `lrq_can_alloc_a2`, `lrq_full` to gate fresh load issue                  |
| `lsl2` interface      | Drives `l2_ls_spec_valid_m2/m4_q` that triggers the `L2RESP_M3/M4` capture transitions                    |

### §1.5 Spec-intent vs current RTL snapshot — age-ordering mechanism

The shared-primitive document (see
`design_docs/shared_primitives/ls_age_matrix.md:§1`) and the pilot spec
instantiation table record `age_matrix(AM_SIZE=16) → LRQ` as the intended
ordering primitive for this queue (see
`docs/superpowers/specs/design_spec/2026-04-22-lsu-rtl-deep-dive-design.md:L154`).
This reflects spec intent.

In the current RTL snapshot under analysis (`PERSEUS-MP128-r0p3-00rel0`,
`perseus_ls_lrq.sv`), the `perseus_ls_age_matrix` cell is **not instantiated**
inside `perseus_ls_lrq` nor inside `perseus_ls_lrq_entry`:

- `grep -c 'age_matrix\|age.*matrix' perseus_ls_lrq.sv` → 0 hits
- `grep -c 'age_matrix\|age.*matrix' perseus_ls_lrq_entry.sv` → 0 hits
  (confirmed during Gate 11 RTL probe)

The ordering mechanism actually present in this RTL snapshot is a
**pairwise age-compare farm** built from two distinct primitive cells:

- `perseus_ls_age_older_eq_compare` — instantiated 48 times
  (3 allocation ports × 16 candidate entries) at
  `perseus_ls_lrq.sv:L4636-L5012` (block named `u_lrq_age_compare_ls{0,1,2}_alloc_entry{0..15}`).
- `perseus_ls_age_compare` — instantiated 3 times for the cross-port
  allocator-vs-allocator ordering at `perseus_ls_lrq.sv:L5026-L5038`
  (`u_lrq_age_compare_ls1_alloc_ls0_alloc`,
  `u_lrq_age_compare_ls1_alloc_ls2_alloc`,
  `u_lrq_age_compare_ls2_alloc_ls0_alloc`).

Whether this pairwise-comparator construction is functionally equivalent to
a 16-wide `age_matrix` under the LRQ's usage pattern — and the precise
semantics of "oldest LRQ entry" (`lrq_oldest_vld`, `lrq_overall_oldest_vld`,
`lrq_entry_oldest_vld[15:0]`) — is deferred to Gates 12–15, where §3–§5
will derive the model and §8 will walk the surrounding RTL.

**(UNVERIFIED: `perseus_ls_age_matrix(16)` is called out as an LRQ consumer
in the pilot spec / primitive doc but is not realised in the current RTL
snapshot; the realised ordering mechanism is a pairwise-comparator farm
(`perseus_ls_age_older_eq_compare` × 48 + `perseus_ls_age_compare` × 3).
Functional-equivalence argument to the matrix model, and the naming of the
"oldest" reducer, will be constructed in Gates 12–15.)**

### §1.6 File under analysis

- Path: `perseus/logical/perseus_loadstore/verilog/perseus_ls_lrq.sv`
- Size: ~1.9 MB, 29 965 lines (includes 16 copies of the per-entry
  instantiation plus the 48-way pairwise comparator farm and
  allocator-side arbitration).
- Companion file: `perseus_ls_lrq_entry.sv`, ~147 KB, 3 155 lines —
  a single entry's worth of FSM, data flops, flush / wait-id / linked-FB /
  LPT logic. Instantiated 16× at
  `perseus_ls_lrq.sv:L13505, L14006, L14507, L15008, L15509, L16010, L16511, L17012, L17513, L18014, L18515, L19016, L19517, L20018, L20519, L21020`
  (`u_lrq_entry_0` … `u_lrq_entry_15`).
- Constants file: `perseus_ls_defines.sv` — `L721-L737` (size + 10 FSM
  state encodings) and matching `undef` block at `L1813-L1827`.

---

## §2 Features

> Convention: every row cites at least one `file:L<start>-L<end>` per rule R1.
> `(UNVERIFIED: …)` flags (rule R5) are used where the feature is asserted
> by spec-intent but not located in the current RTL snapshot, or where the
> underlying mechanism is named in RTL but its full semantic model is
> deferred to a later gate. Coverage target per Gate 11 plan: 25–35 entries.

### §2.1 Feature table

| ID | Feature | RTL evidence | Linked L1 feature |
|----|---------|--------------|-------------------|
| `LRQ-F01` | 16-entry queue, one independent FSM per entry | 16 × `perseus_ls_lrq_entry` instantiations at `perseus_ls_lrq.sv:L13505, L14006, L14507, L15008, L15509, L16010, L16511, L17012, L17513, L18014, L18515, L19016, L19517, L20018, L20519, L21020`; size constant `perseus_ls_defines.sv:L721` (`PERSEUS_LS_LRQ_SIZE = 5'd16`) | `LSU-F04` |
| `LRQ-F02` | 10-state per-entry FSM: `RDY`, `IN_PIPE`, `WAIT_L2RESP`, `WAIT_STDATA`, `STDATA_SPEC_WKUP`, `WAIT_OLD_PRECOMMIT`, `L2RESP_M3`, `L2RESP_M4`, `WAIT_LPT`, `WAIT_FB` | State-encoding defines `perseus_ls_defines.sv:L725-L735`; entry-side state flop signature `perseus_ls_lrq_entry.sv:L368` (`lrq_state_q[`PERSEUS_LS_LRQ_STATE]`); main `casez` next-state at `perseus_ls_lrq_entry.sv:L2341-L2407` | `LSU-F04` |
| `LRQ-F03` | 4-bit state-field width (10 states encoded in 4 bits, leaving 6 unused codes) | `perseus_ls_defines.sv:L725` (`PERSEUS_LS_LRQ_STATE = 3:0`); enumerated values `L726-L735` | `LSU-F04` |
| `LRQ-F04` | Per-entry valid storage (`entry_vld_q`) gating every timer / wait qualifier | `perseus_ls_lrq_entry.sv:L2248, L2252` (`entry_vld_q & …`) | `LSU-F04` |
| `LRQ-F05` | Up to 3-way concurrent allocation from `ls0` / `ls1` / `ls2` AGU pipes | Per-pipe block qualifier inputs `perseus_ls_lrq_entry.sv:L118, L178, L238` (`ls{0,1,2}_block_lrq_alloc_a2_q`); allocation-possible aggregator `perseus_ls_lrq.sv:L1365-L1370` (`lrq_alloc_possible_a{1,2}_{hi,lo}`) | `LSU-F04` |
| `LRQ-F06` | Cross-pipe age tie-break among up-to-3 same-cycle allocators (older-than hints `ls0_uop_older_than_ls1_a1_q`, `ls1_uop_older_than_ls2_a1_q`, `ls0_uop_older_than_ls2_a1_q`) | Header declarations `perseus_ls_lrq.sv:L70-L72`; cross-port age primitive instances `perseus_ls_lrq.sv:L5026-L5038` (`perseus_ls_age_compare u_lrq_age_compare_ls1_alloc_ls0_alloc / ls1_alloc_ls2_alloc / ls2_alloc_ls0_alloc`) | `LSU-F04` |
| `LRQ-F07` | Per-entry pairwise age ordering vs each allocator (48 comparators total, 3 pipes × 16 entries) | `perseus_ls_age_older_eq_compare u_lrq_age_compare_ls{0,1,2}_alloc_entry{0..15}` at `perseus_ls_lrq.sv:L4636-L5012` | `LSU-F04` |
| `LRQ-F08` | "Oldest LRQ entry" vector export (`lrq_entry_oldest_vld[15:0]`, `lrq_oldest_vld`, `lrq_overall_oldest_vld`) consumed by issue-queue priority logic | `perseus_ls_lrq.sv:L1060, L3200, L3259`; usage at `perseus_ls_lrq.sv:L4068-L4080` (`iq{0,1,2}_oldest_a1_mod`) | `LSU-F04` |
| `LRQ-F09` | `lrq_full` back-pressure (queue-full signal exported to IQ / AGU alloc gating) | Output declaration `perseus_ls_lrq.sv:L104`; consumer `perseus_ls_lrq.sv:L4070` (in `iq{0,1,2}_oldest_a1_mod`) | `LSU-F04` |
| `LRQ-F10` | Free-slot count tracking `lrq_avail_nxt_cnt[4:0]` (supports "at-least-1 / 2 / 3 can alloc" predicates used by the IQ) | `perseus_ls_lrq.sv:L1382-L1383` (declarations); `perseus_ls_lrq.sv:L29016` (`lrq_avail_nxt_cnt = PERSEUS_LS_LRQ_SIZE − …`) | `LSU-F04` |
| `LRQ-F11` | `%4` non-multiple guard block (compile-time sanity on `PERSEUS_LS_LRQ_SIZE`) | `perseus_ls_lrq.sv:L7269` (generate block `g_lrq_not_multiple_of_4`) | — |
| `LRQ-F12` | Pipeline reissue via `d0` arbitration (per-half picker enables `disable_lrq0_pick_nxt` / `disable_lrq1_pick_nxt`) | Header `perseus_ls_lrq.sv:L73-L74`; `d1`-stage won-arb capture `perseus_ls_lrq.sv:L1283, L1358` (`lrq{0,1}_ld_won_arb_d1`) | `LSU-F04` |
| `LRQ-F13` | Per-pipe IQ-ld-won-arb tap-in at `d2` (`ls{0,1,2}_iq_ld_won_arb_d2`) drives allocation-completion update | `perseus_ls_lrq.sv:L3342, L3474, L3604` | `LSU-F04` |
| `LRQ-F14` | L2 "spec valid" capture at `m2` → state `L2RESP_M3` (non-NC-dev path) | Entry `casez` row `perseus_ls_lrq_entry.sv:L2352` (`L2RESP_M3` target); wake-up driver `perseus_ls_lrq.sv:L3846` (`l2_ls_spec_valid_m2 & ~lrq_has_nc_dev_ld`) | `LSU-F04` |
| `LRQ-F15` | L2 "spec valid" capture at `m4_q` → state `L2RESP_M4` (NC/device path) | Wake-up driver `perseus_ls_lrq.sv:L3847` (`l2_ls_spec_valid_m4_q & lrq_has_nc_dev_ld`); state-transition rows `perseus_ls_lrq_entry.sv:L2354-L2355, L2366` | `LSU-F04` |
| `LRQ-F16` | `iz`-stage wake-up broadcast `ls_is_lrq_wakeup_iz` (union of M2 and M4 paths) to dependent ops | Output `perseus_ls_lrq.sv:L100`; combinational driver `perseus_ls_lrq.sv:L3707, L3846-L3847`; flop `perseus_ls_lrq.sv:L3852-L3862` | `LSU-F04` |
| `LRQ-F17` | `L2RESP_M3/M4 → IN_PIPE` re-arb transitions (load wins reissue after L2 data lands) | `perseus_ls_lrq_entry.sv:L2353-L2354` (`…_L2RESP_M3 → IN_PIPE`, `…_L2RESP_M4 → IN_PIPE`) | `LSU-F04` |
| `LRQ-F18` | Store-data wake-up path: `WAIT_STDATA` entry releases on `ls_ld_std_wakeup` + STID match | `perseus_ls_lrq_entry.sv:L2643, L2657` (`lrq_in_stdata_spec_wkup`, `ld_std_wakeup`) | `LSU-F05` |
| `LRQ-F19` | Store-data speculative wake-up (`STDATA_SPEC_WKUP` state) — early release before the store actually retires | FSM state `perseus_ls_defines.sv:L730`; detector `perseus_ls_lrq_entry.sv:L2643` (`lrq_in_stdata_spec_wkup = (state == STDATA_SPEC_WKUP)`); squash path `perseus_ls_lrq_entry.sv:L2655` | `LSU-F05` |
| `LRQ-F20` | Store-data speculative-wakeup kill (`ls_disable_precise_stdata_wakeup` config bit) | Header `perseus_ls_lrq.sv:L46` (input declaration) | `LSU-F05` |
| `LRQ-F21` | Older-precommit wait (`WAIT_OLD_PRECOMMIT` state) — enforces program-order release against `precommit_uid_q` | FSM state `perseus_ls_defines.sv:L731`; ingress of `precommit_uid_q` at `perseus_ls_lrq.sv:L86` and `perseus_ls_lrq_entry.sv:L165`; transition rows `perseus_ls_lrq_entry.sv:L2343` | `LSU-F06` |
| `LRQ-F22` | NC / device load in-flight tracker `lrq_has_nc_dev_ld_q` and above-threshold escalation `lrq_has_nc_dev_ld_above_threshold_q` | Output `perseus_ls_lrq.sv:L113`; internal wires `perseus_ls_lrq.sv:L3228-L3229`; flop blocks `perseus_ls_lrq.sv:L4275-L4298` | `LSU-F04` |
| `LRQ-F23` | NC/device-in-LRQ gates every new-alloc candidate via `ld_can_alloc_when_nc_dev_in_lrq_en` | `perseus_ls_lrq.sv:L4245-L4247` | `LSU-F04` |
| `LRQ-F24` | NC/device-specific L2 wake-up path (`ld_nc_dev_wakeup`) driven from `WAIT_OLD_PRECOMMIT` | `perseus_ls_lrq_entry.sv:L2202-L2203` | `LSU-F04` |
| `LRQ-F25` | NC-speculative request kill switch (`ls_disable_nc_spec_req`) | Header `perseus_ls_lrq.sv:L39` | `LSU-F04` |
| `LRQ-F26` | LPT-hazard wait (`WAIT_LPT` state) + per-entry `lpt_wait_id_q[6:0]` STID tracker | FSM state `perseus_ls_defines.sv:L734`; flop `perseus_ls_lrq_entry.sv:L638, L2028-L2036`; all-waiters reduce `perseus_ls_lrq_entry.sv:L2452` (`ld_lpt_wait_on_all = &lpt_wait_id_q`) | `LSU-F04` |
| `LRQ-F27` | LPT-wait-ID range guard (`PERSEUS_LS_LRQ_WAIT_ID_MAX` vs `PERSEUS_STID_WRAP_LSB`) | `perseus_ls_lrq_entry.sv:L1852` (generate `g_lrq_wait_id_gt_stid_non_wrap`); define `perseus_ls_defines.sv:L737` (`PERSEUS_LS_LRQ_WAIT_ID_MAX = 6`) | `LSU-F04` |
| `LRQ-F28` | FB-hazard wait (`WAIT_FB` state) — load parked until a specific fill buffer clears | FSM state `perseus_ls_defines.sv:L735`; `casez` rows `perseus_ls_lrq_entry.sv:L2361-L2364, L2368` | `LSU-F04` |
| `LRQ-F29` | Linked-FB ID capture (`ld_linked_fb_rst_id_q[5:0]`, `ld_linked_fb_rst_id_unalign2_q`) for multi-FB fills | Entry outputs `perseus_ls_lrq_entry.sv:L454-L456` | `LSU-F04` |
| `LRQ-F30` | Has-linked-FB status flags (speculative and any) — `ld_has_linked_fb`, `ld_has_linked_fb_spec`, `ld_has_any_linked_fb` | `perseus_ls_lrq_entry.sv:L460-L463` | `LSU-F04` |
| `LRQ-F31` | NC-device linked-FB 16-bit vector (`ld_nc_dev_linked_fb_entry[15:0]`) | `perseus_ls_lrq_entry.sv:L456` | `LSU-F04` |
| `LRQ-F32` | `clr_fb_link` / `clr_fb_link_unalign2` — asynchronous FB-link clear paths | `perseus_ls_lrq_entry.sv:L498-L499` | `LSU-F04` |
| `LRQ-F33` | Multi-FB-link-1 kill switch (`ls_disable_multi_fb_link1`) | Header `perseus_ls_lrq.sv:L49` | — |
| `LRQ-F34` | Load-no-FB-link oldest tag (`oldest_ld_no_fb_link_vld`) for ordering decisions | Entry input `perseus_ls_lrq_entry.sv:L167` | `LSU-F04` |
| `LRQ-F35` | `linked_fb_but_no_fb_match_d3` — pipeline-late mismatch signal feeding the FSM `casez` | `perseus_ls_lrq_entry.sv:L637, L2341` | `LSU-F04` |
| `LRQ-F36` | L2-response timeout detection via two-edged `tick_tock_change_q` scheme | Inputs `perseus_ls_lrq.sv:L65-L66` (`ls_lrq_timeout_tick_tock_change_q`, `ls_tick_tock_q`); entry-level timer `perseus_ls_lrq_entry.sv:L2248-L2252` (`set_first_tick_tock_change_seen`, `set_lrq_entry_wait_l2resp_timeout`) | — |
| `LRQ-F37` | L2-response-timeout kill switch (`ls_disable_lrq_wait_l2resp_timeout`) plus "to-FU" variant enable | Header `perseus_ls_lrq.sv:L45-L47` | — |
| `LRQ-F38` | Mid-range livelock-buster trigger (`trigger_mid_range_livelock_buster`) forces hazard-reset path | Header `perseus_ls_lrq.sv:L90`; hazard-reset gating `perseus_ls_lrq_entry.sv:L2314` (`lrq_hazard_reset_vld & …`) | — |
| `LRQ-F39` | Flush support (`flush_v` / `flush_uid` port + `flush_lrq_entry` / `flush_precommit_uid` entry locals) | `perseus_ls_lrq_entry.sv:L163-L164, L512-L513` | `LSU-F06` |
| `LRQ-F40` | Page-split second-half tracking (`ld_page_split2_dev`, `ld_page_split2_nc`, `ld_page_split_align_cross_16_byte_q`) | `perseus_ls_lrq_entry.sv:L592-L595, L820` | `LSU-F06` |
| `LRQ-F41` | Page-split-2 gather family inputs (`lrq_page_split2_{nc,dev,alloc_nc,alloc_dev,ccpass,ccpass_din}`) | `perseus_ls_lrq_entry.sv:L355-L360` | `LSU-F06` |
| `LRQ-F42` | VA-region invalidation (`va_region_clear_v` + `va_region_clear_id[PERSEUS_LS_VA_REGION_ID_R]`) | Top-level inputs `perseus_ls_lrq.sv:L109-L110` | `LSU-F08` |
| `LRQ-F43` | Big-endian effective-endianness flop per entry (`ld_big_endian_q`) | `perseus_ls_lrq_entry.sv:L133, L435` | `LSU-F06` |
| `LRQ-F44` | Nested-virt opcode bits per pipe (`nested_virt_op_ls{0,1,2}_a2_q`) forwarded to entry | Top-level inputs `perseus_ls_lrq.sv:L60-L62` | `LSU-F06` |
| `LRQ-F45` | `SCTLR_EL2.EE` endianness control forwarded from system-control layer | `perseus_ls_lrq.sv:L58` | `LSU-F06` |
| `LRQ-F46` | Fast-bypass accept path (`ld_accept_with_fast_byp_q`) gates `L2RESP_M4` termination so a fast-bypassed load does not re-enter WAIT | `perseus_ls_lrq_entry.sv:L515-L516, L1883, L1907, L2834-L2842` | `LSU-F04` |
| `LRQ-F47` | Store-buffer raw-dealloc and write-MB pointer inputs (`sb_raw_dealloc_ptr`, `sb_wr_mb_ptr_stid_w3_q`) feed LPT/STDATA wait-id resolution | Top-level inputs `perseus_ls_lrq.sv:L82-L84` | `LSU-F05` |
| `LRQ-F48` | Oldest-load-delay-for-DVM-sync export (`tofu_oldest_ld_delay_dvm_sync`) used by DVM / synchronisation layer | Output `perseus_ls_lrq.sv:L101` | `LSU-F08` |
| `LRQ-F49` | Top-of-function-unit UID tracking (`ct_tofu_uid_q` + `ct_tofu_uid_changed_q`) — detects commit-frontier motion | Outputs `perseus_ls_lrq.sv:L99, L105` | — |
| `LRQ-F50` | NC-device FB-credit pending flag (`nc_fb_credit_return_pending_q`) gates new NC allocations | Top-level input `perseus_ls_lrq.sv:L94` | `LSU-F04` |
| `LRQ-F51` | DCG (design-for-clock-gating) alloc inhibit via `ls_disable_lrq_alloc_dg` | Top-level input `perseus_ls_lrq.sv:L55` | — |
| `LRQ-F52` | RCG (register-clock-gating) CHKA test disable (`chka_disable_ls_rcg`) | Top-level input `perseus_ls_lrq.sv:L38` | — |
| `LRQ-F53` | `spec §5.2` / primitive-doc intent: LRQ consumes `perseus_ls_age_matrix(AM_SIZE=16)` for "oldest among all live entries" selection. **(UNVERIFIED: spec §5.2 / primitive-doc §1 intent; not realised in current RTL snapshot — `grep age_matrix` in `perseus_ls_lrq.sv` and `perseus_ls_lrq_entry.sv` = 0 hits. The realised ordering is the pairwise-comparator farm described by `LRQ-F06` / `LRQ-F07`; functional-equivalence analysis deferred to Gates 12–15.)** | (spec) `docs/superpowers/specs/design_spec/2026-04-22-lsu-rtl-deep-dive-design.md:L154`; (primitive) `design_docs/shared_primitives/ls_age_matrix.md:§1`; (RTL counter-evidence) `perseus_ls_lrq.sv` full-file grep, `perseus_ls_lrq_entry.sv` full-file grep — both 0 matches | `LSU-F04` |

### §2.2 Feature-ID hygiene notes

- Feature IDs `LRQ-F01` … `LRQ-F53` are intended to be stable; later gates
  (§3–§14) will refer to them by ID.
- The single UNVERIFIED feature (`LRQ-F53`) is retained deliberately in the
  features list so that the spec-intent ↔ RTL-snapshot gap is
  first-class and must be closed (or re-classified) before Gate 17
  sign-off; per the framing rule this is a *snapshot* observation, not a
  spec defect.
- Five of the 10 FSM states (`LRQ-F02`, `-F14`, `-F15`, `-F17`, `-F18`,
  `-F19`, `-F21`, `-F26`, `-F28`) are each called out separately because
  each introduces an independently testable wait / release behaviour; the
  full transition matrix will be tabulated in §6 (Gate 13).

---

<!-- §3 onwards deferred to Tasks 13-18 (Gates 12-17). Do not fill here. -->
