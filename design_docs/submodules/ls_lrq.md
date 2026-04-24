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

<!-- §5 onwards deferred to Tasks 14-18 (Gates 13-17). Do not fill here. -->

## §3 微架构抽象 (Microarchitectural Abstraction)

> Framing reminder (per R5 and the document header): the design spec is the
> authoritative source-of-intent; the RTL snapshot is a delivered subset.
> Where the two diverge on *mechanism*, this section records both sides in
> parallel ("spec-intent" vs "current RTL snapshot") without marking either
> as wrong.

### §3.1 What — one-paragraph model

The `perseus_ls_lrq` is a **per-entry state-machine queue** sitting
MSHR-adjacent to the fill-buffer (`ls_fb`). Sixteen entries (`LRQ-F01`)
each run an independent 10-state FSM (`LRQ-F02`; state encoding at
`perseus_ls_defines.sv:L725-L735`, verified in Gate 11) that tracks a
single outstanding load from the moment it leaves the AGU pipe until it
has produced an architectural result and released. Entries are coupled to
the fill-buffer through per-entry linkage IDs (`ld_linked_fb_rst_id_q`,
`ld_has_linked_fb*`; `LRQ-F29` / `LRQ-F30`) so that multiple LRQ entries
chasing the same missing cache line can share one `ls_fb` slot ("miss
coalescing" in the classic MSHR sense, with LRQ playing the
"I-am-waiting" role and FB playing the "I-have-requested-the-line"
role). Relative program age among the 16 in-flight entries is supplied
by an **ordering primitive** whose mechanism differs between spec-intent
and the current RTL snapshot — see §3.4 below.

Three external contracts define the queue's behaviour from outside:
(a) at `d2`, up to three entries may be allocated in the same cycle from
`ls0` / `ls1` / `ls2` (`LRQ-F05` / `LRQ-F06`); (b) at `d0`, entries
compete with fresh AGU ops via `disable_lrq{0,1}_pick_nxt` to reissue
(`LRQ-F12`); (c) at `iz`, the `ls_is_lrq_wakeup_iz` broadcast releases
dependent ops in ICSU (`LRQ-F16`).

### §3.2 How — lifecycle of one entry

The primary lifecycle (cache-miss → L2-response → release) is:

```
  RDY ─(alloc @ d2)──▶ IN_PIPE ─(d3/d4 miss captured)──▶ WAIT_L2RESP
                                                            │
                                                            ├─(L2 spec_valid @ m2, non-NC/dev)──▶ L2RESP_M3
                                                            └─(L2 spec_valid @ m4_q, NC/dev)────▶ L2RESP_M4
                                                                                   │
                                                                                   ├─(re-arb wins d0)──▶ IN_PIPE ─▶ … ─▶ WAIT_FB
                                                                                   └─(FB not yet clear)─▶ WAIT_FB
                                                                                                             │
                                                                                                             └─(FB link cleared)──▶ RDY
```

(Evidence: FSM `casez` at `perseus_ls_lrq_entry.sv:L2341-L2407`; M2/M4
wake-up drivers at `perseus_ls_lrq.sv:L3846-L3847`; re-arb rows
`LRQ-F17`; FB-wait state `LRQ-F28`.)

Three lateral branches leave the primary line and rejoin it:

- **Store-to-load dependency branch** — `WAIT_STDATA` +
  `STDATA_SPEC_WKUP` (`LRQ-F18` / `LRQ-F19`): an entry that depends on a
  not-yet-written store parks in `WAIT_STDATA` until `ls_ld_std_wakeup`
  fires on a matching STID, optionally taking an early exit through
  `STDATA_SPEC_WKUP` when the speculative-wakeup config bit permits
  (`LRQ-F20`).
- **Program-order branch** — `WAIT_OLD_PRECOMMIT` (`LRQ-F21`): an entry
  whose UID is younger than `precommit_uid_q` is held until the commit
  frontier reaches it; the NC/device L2 wake-up path (`LRQ-F24`) is
  driven out of this state.
- **LPT-hazard branch** — `WAIT_LPT` (`LRQ-F26`): an entry with a pending
  load-pending-tag conflict parks until the 7-bit `lpt_wait_id_q`
  vector's AND-reduce (`ld_lpt_wait_on_all`) fires.

Allocation is **spatial** (parallel, not pointered): at `d2` the three
allocators `ls{0,1,2}_alloc` choose among free entries (`entry_vld_q=0`)
under the qualifiers `ls{0,1,2}_block_lrq_alloc_a2_q`. Cross-pipe age
tie-breaks come from the `*_uop_older_than_*_a1_q` hints and three
`perseus_ls_age_compare` cells (`LRQ-F06`;
`perseus_ls_lrq.sv:L5026-L5038`). Per-allocator vs per-entry pairwise
age is computed by 48 `perseus_ls_age_older_eq_compare` cells
(`LRQ-F07`; `perseus_ls_lrq.sv:L4636-L5012`). Release is **implicit**:
when an entry's FSM returns to `RDY` and `entry_vld_q` clears, the slot
is immediately available for re-allocation; there is no explicit "free
pointer."

### §3.3 Why — design rationale

- **Per-entry FSM vs. central controller.** 16 independent FSMs allow
  all 16 in-flight loads to progress simultaneously through unrelated
  states (one in `WAIT_L2RESP`, another in `WAIT_STDATA`, another in
  `L2RESP_M4`, etc.). A single central controller would need to
  sequence these, serialising wake-ups and defeating the purpose of a
  16-entry miss tracker.
- **10 states, not fewer.** Each state names a distinct *reason* the
  load is parked (`WAIT_L2RESP` = line not yet back; `WAIT_STDATA` =
  older store's data not ready; `WAIT_OLD_PRECOMMIT` = program-order
  gate; `WAIT_LPT` = tag hazard; `WAIT_FB` = FB not yet freed;
  `L2RESP_M3/M4` = in-flight response capture). Collapsing them would
  hide the reason from replay/debug/livelock detection
  (`trigger_mid_range_livelock_buster`, `LRQ-F38`) and from the
  two-edged timeout scheme (`LRQ-F36`).
- **Age-primitive ordering vs. FIFO pointer.** L2 responses return in
  arbitrary order (cache-line granularity, coalescing, NC vs cacheable
  paths) and three allocators can insert on one cycle, so a single
  head/tail pointer cannot express "oldest live entry." An age primitive
  answers that in one cycle regardless of the underlying storage order.
  This rationale holds for **both** the spec-intent mechanism and the
  current RTL snapshot mechanism discussed in §3.4.
- **MSHR-adjacent (not MSHR-integrated).** LRQ tracks "I am a load that
  is waiting"; FB tracks "there is one request outstanding for this
  line." Keeping them in separate structures — with `ld_linked_fb_*`
  linkage IDs — lets several LRQ entries share one FB slot (classic
  miss coalescing) and lets an LRQ entry stay alive across FB
  re-allocation, which a single combined structure could not.

### §3.4 Ordering mechanism — spec-intent vs current RTL snapshot

> This subsection is the Gate 12 restatement of the Gate 11 observation
> recorded at `§1.5` and feature `LRQ-F53`. Per the pilot framing rule,
> both sides are recorded in parallel.

- **Spec-intent mechanism.** The pilot design spec
  (`docs/superpowers/specs/design_spec/2026-04-22-lsu-rtl-deep-dive-design.md:L154`)
  and the shared-primitive document
  (`design_docs/shared_primitives/ls_age_matrix.md:§1` / `§7.1`) record
  the LRQ's ordering primitive as **`perseus_ls_age_matrix`** with
  `AM_SIZE=16`: a single matrix cell holding the full younger-than
  relation among all 16 entries, answering "oldest live entry"
  (optionally class-filtered) in one cycle every cycle. Under this
  model, every LRQ entry is a *row and column* of one shared matrix,
  and the "oldest" reducer is the matrix's per-row AND of older-than
  bits masked by `entry_vld_q`.
- **Current RTL snapshot mechanism.** In the
  `PERSEUS-MP128-r0p3-00rel0` snapshot of `perseus_ls_lrq.sv`, the
  `perseus_ls_age_matrix` cell is not instantiated (Gate 11 grep
  evidence, §1.5). Instead the same logical question ("for allocator X,
  which of the 16 live entries is older?") is answered by a **pairwise
  comparator farm** built from two primitive cells:
  - 48 × `perseus_ls_age_older_eq_compare` at
    `perseus_ls_lrq.sv:L4636-L5012` — one per (allocator, entry) pair,
    i.e. 3 allocators × 16 entries.
  - 3 × `perseus_ls_age_compare` at `perseus_ls_lrq.sv:L5026-L5038` —
    one per cross-allocator pair (`ls1_alloc` vs `ls0_alloc`,
    `ls1_alloc` vs `ls2_alloc`, `ls2_alloc` vs `ls0_alloc`).
  Each entry also drives `lrq_entry_oldest_vld[i]` / `lrq_oldest_vld` /
  `lrq_overall_oldest_vld` wires (`LRQ-F08`;
  `perseus_ls_lrq.sv:L1060, L3200, L3259`) that re-expose an
  "oldest-entry" summary to the issue-queue priority logic at
  `perseus_ls_lrq.sv:L4068-L4080`.

Both mechanisms share the same **design rationale** bullet in §3.3
("age-primitive ordering vs FIFO pointer"): the reason the LRQ needs
age-based ordering is independent of which cell implements it.
Functional-equivalence of the two mechanisms under the LRQ's specific
usage pattern, and the precise semantics of the "oldest" reducer wires,
are deferred to §5 (Gate 13) and §8 (Gate 15).

**(UNVERIFIED: §3.4 restates the Gate 11 snapshot observation
(`LRQ-F53`); functional-equivalence between the `age_matrix(16)`
spec-intent model and the 48+3 pairwise-comparator farm realised in RTL
has not yet been proved in this document — forward reference to §5 and
§8.)**

---

## §4 整体框图 (Block Diagram)

> ASCII block diagram of the LRQ's top-level structure. Every block
> carries an RTL line reference per rule R1. The **ordering primitive
> block** is drawn as two parallel columns to honour the §3.4 framing
> rule: the spec-intent column names the intended cell but is
> annotated "not in this RTL snapshot"; the RTL-observed column names
> the cells that are actually instantiated.

### §4.1 Top-level block diagram

```
                                                                              ┌───────────────────────────────────────────────┐
                                                                              │ Flush / precommit broadcast                   │
                                                                              │   flush_v, flush_uid (pipe → entries)         │
                                                                              │   precommit_uid_q (AGU → every entry)         │
                                                                              │ Ref: perseus_ls_lrq.sv:L86                    │
                                                                              │      perseus_ls_lrq_entry.sv:L163-L165        │
                                                                              └─────────────────┬─────────────────────────────┘
                                                                                                │ (broadcast to all 16 entries)
                                                                                                ▼
┌──────────────────────────┐     ┌──────────────────────────────────────────────────────────────────────────────────────────────┐
│ 3-way allocation inputs  │     │                         16 × perseus_ls_lrq_entry  (10-state FSM each)                       │
│  ls0_alloc, ls1_alloc,   │     │                                                                                              │
│  ls2_alloc   (at d2)     │     │  u_lrq_entry_0  @ L13505    u_lrq_entry_1  @ L14006    u_lrq_entry_2  @ L14507                │
│  older-than hints:       │     │  u_lrq_entry_3  @ L15008    u_lrq_entry_4  @ L15509    u_lrq_entry_5  @ L16010                │
│   ls0_uop_older_than_    │────▶│  u_lrq_entry_6  @ L16511    u_lrq_entry_7  @ L17012    u_lrq_entry_8  @ L17513                │
│   ls1_a1_q   (+ 2 more)  │     │  u_lrq_entry_9  @ L18014    u_lrq_entry_10 @ L18515    u_lrq_entry_11 @ L19016                │
│  Ref: perseus_ls_lrq.sv  │     │  u_lrq_entry_12 @ L19517    u_lrq_entry_13 @ L20018    u_lrq_entry_14 @ L20519                │
│       :L70-L72           │     │  u_lrq_entry_15 @ L21020                                                                     │
└────────────┬─────────────┘     │                                                                                              │
             │                   │  State flop: lrq_state_q[3:0]  (perseus_ls_lrq_entry.sv:L368)                                │
             │ alloc-possible    │  casez next-state: perseus_ls_lrq_entry.sv:L2341-L2407                                       │
             │ predicates        │                                                                                              │
             │ lrq_alloc_        │  Per-entry side flops: entry_vld_q, lpt_wait_id_q[6:0], ld_linked_fb_rst_id_q[5:0],          │
             │  possible_a{1,2}_ │                        ld_linked_fb_rst_id_unalign2_q, ld_big_endian_q, ld_accept_with_      │
             │  {hi,lo}          │                        fast_byp_q, …                                                         │
             │ (L1365-L1370)     │                                                                                              │
             ▼                   └───┬─────────────────────────────┬─────────────────────────────┬────────────────────────────┘
    ┌──────────────────────┐         │                             │                             │
    │ Ordering primitive   │         │ per-entry "oldest" taps     │ linked-FB IDs               │ FSM status
    │ (see two columns ▼)  │         │ lrq_entry_oldest_vld[15:0]  │ ld_linked_fb_rst_id_q,      │ ld_has_nc_dev_ld,
    └──────────────────────┘         │ lrq_oldest_vld,             │ ld_has_linked_fb,           │ ld_accept_with_
                                     │ lrq_overall_oldest_vld      │ clr_fb_link,                │ fast_byp_q,
                                     │ (L1060, L3200, L3259)       │ clr_fb_link_unalign2        │ ld_page_split2_*,
                                     ▼                             ▼                             ▼
           ┌───────────────────────────────────────┬────────────────────────────────────────────────────────┐
           │ Spec-intent column                    │ RTL-observed column                                    │
           │ (not in this RTL snapshot)            │ (realised in perseus_ls_lrq.sv)                        │
           ├───────────────────────────────────────┼────────────────────────────────────────────────────────┤
           │ perseus_ls_age_matrix(AM_SIZE=16)     │ Pairwise age-compare farm:                             │
           │   single cell holding the full        │   • 48 × perseus_ls_age_older_eq_compare               │
           │   16-wide younger/older relation;     │       u_lrq_age_compare_ls{0,1,2}_alloc_entry{0..15}   │
           │   one-cycle "oldest live entry"       │       perseus_ls_lrq.sv:L4636-L5012                    │
           │   reducer per R1-R5 of spec §5.2.     │   • 3 × perseus_ls_age_compare                         │
           │                                       │       u_lrq_age_compare_ls1_alloc_ls0_alloc,           │
           │ Spec refs:                            │       u_lrq_age_compare_ls1_alloc_ls2_alloc,           │
           │   docs/superpowers/specs/design_spec/ │       u_lrq_age_compare_ls2_alloc_ls0_alloc            │
           │   2026-04-22-lsu-rtl-deep-dive-       │       perseus_ls_lrq.sv:L5026-L5038                    │
           │   design.md:L154                      │                                                        │
           │   design_docs/shared_primitives/      │ (UNVERIFIED bridge: functional-equivalence to the      │
           │   ls_age_matrix.md:§1                 │  spec-intent column deferred to §5 / §8.)              │
           └───────────────────────────────────────┴────────────────────────────────────────────────────────┘

                       (per-entry FSM arcs out of the 16× block, drawn once)

  ┌───────────────────────────────┐      ┌──────────────────────────────┐      ┌──────────────────────────────┐
  │ d0 reissue arbitration        │      │ m3 / m4 L2-response demux    │      │ ls_fb coupling (MSHR-adjacent)│
  │  disable_lrq0_pick_nxt,       │      │  l2_ls_spec_valid_m2         │      │  lrq_fb_ptr_q per entry,      │
  │  disable_lrq1_pick_nxt        │      │    & ~lrq_has_nc_dev_ld      │      │  ld_linked_fb_rst_id_q[5:0],  │
  │  lrq{0,1}_ld_won_arb_d1       │      │    → L2RESP_M3               │      │  ld_linked_fb_rst_id_         │
  │                               │      │  l2_ls_spec_valid_m4_q       │      │    unalign2_q,                │
  │  Ref: perseus_ls_lrq.sv:      │      │    & lrq_has_nc_dev_ld       │      │  ld_nc_dev_linked_fb_entry    │
  │       L73-L74, L1283, L1358   │      │    → L2RESP_M4               │      │    [15:0],                    │
  │                               │      │                              │      │  clr_fb_link,                 │
  │ Output to ls_tag_data_arb:    │      │  Broadcast to iz:            │      │  clr_fb_link_unalign2         │
  │  winning LRQ entry's op re-   │      │   ls_is_lrq_wakeup_iz        │      │                               │
  │  enters pipe at d1            │      │   flop @ L3852-L3862         │      │  Ref: perseus_ls_lrq_entry.sv:│
  │                               │      │                              │      │       L454-L463, L498-L499    │
  └───────────────────────────────┘      │  Ref: perseus_ls_lrq.sv:     │      └──────────────────────────────┘
                                         │       L3707, L3846-L3847     │
                                         └──────────────────────────────┘

  ┌───────────────────────────────┐      ┌──────────────────────────────┐      ┌──────────────────────────────┐
  │ Livelock buster path          │      │ L2-response timeout          │      │ Queue-status exports          │
  │  trigger_mid_range_livelock_  │      │  ls_lrq_timeout_tick_tock_   │      │  lrq_full (output L104),      │
  │    buster                     │      │    change_q,                 │      │  lrq_avail_nxt_cnt[4:0]       │
  │  → lrq_hazard_reset_vld       │      │  ls_tick_tock_q              │      │    (L1382-L1383, L29016),     │
  │                               │      │  → set_first_tick_tock_      │      │  lrq_has_nc_dev_ld_q,         │
  │  Ref: perseus_ls_lrq.sv:L90   │      │      change_seen →           │      │  lrq_has_nc_dev_ld_above_     │
  │       perseus_ls_lrq_entry    │      │    set_lrq_entry_wait_       │      │    threshold_q,               │
  │       .sv:L2314               │      │      l2resp_timeout          │      │  iq{0,1,2}_oldest_a1_mod      │
  │                               │      │                              │      │                               │
  │  Forces hazard-reset path     │      │  Ref: perseus_ls_lrq.sv:     │      │  Ref: perseus_ls_lrq.sv:      │
  │  into FSM next-state logic    │      │       L65-L66                │      │       L104, L113,             │
  │                               │      │       perseus_ls_lrq_entry.  │      │       L3228-L3229,            │
  │                               │      │       sv:L2248-L2252         │      │       L4068-L4080             │
  └───────────────────────────────┘      └──────────────────────────────┘      └──────────────────────────────┘
```

### §4.2 Block inventory (cross-reference table)

| # | Block                              | Role                                                 | Primary RTL reference                                      |
|---|------------------------------------|------------------------------------------------------|------------------------------------------------------------|
| 1 | 3-way allocation inputs            | Three AGU pipes inject up to 3 alloc/cycle at `d2`   | `perseus_ls_lrq.sv:L70-L72, L1365-L1370`                   |
| 2 | 16 × `perseus_ls_lrq_entry`        | Per-entry 10-state FSMs + side flops                 | `perseus_ls_lrq.sv:L13505, L14006, …, L21020` (16 sites); FSM `perseus_ls_lrq_entry.sv:L2341-L2407` |
| 3 | Ordering primitive — spec-intent   | `age_matrix(16)` named by spec §5.2 / primitive doc  | Spec: `docs/superpowers/specs/design_spec/2026-04-22-lsu-rtl-deep-dive-design.md:L154`; primitive: `design_docs/shared_primitives/ls_age_matrix.md:§1, §7.1` — **not instantiated in this RTL snapshot** |
| 4 | Ordering primitive — RTL-observed  | 48 × `age_older_eq_compare` + 3 × `age_compare`      | `perseus_ls_lrq.sv:L4636-L5012` (48 pairwise); `perseus_ls_lrq.sv:L5026-L5038` (3 cross-allocator) |
| 5 | "Oldest" tap-outs                  | 16-bit + two scalar "oldest" reducers                | `perseus_ls_lrq.sv:L1060, L3200, L3259`; consumer at `L4068-L4080` |
| 6 | d0 reissue arbitration             | LRQ vs fresh AGU competition at pipe `d0`            | `perseus_ls_lrq.sv:L73-L74, L1283, L1358`                   |
| 7 | m3 / m4 L2-response demux          | Cacheable → `L2RESP_M3`; NC/dev → `L2RESP_M4`        | `perseus_ls_lrq.sv:L3707, L3846-L3847, L3852-L3862`         |
| 8 | `ls_fb` coupling (MSHR-adjacent)   | Per-entry linked-FB IDs + clear paths                | `perseus_ls_lrq_entry.sv:L454-L463, L498-L499`              |
| 9 | Flush / precommit broadcast        | `flush_v` / `flush_uid` / `precommit_uid_q` fan-out  | `perseus_ls_lrq.sv:L86`; `perseus_ls_lrq_entry.sv:L163-L165, L512-L513` |
| 10 | Livelock buster path              | `trigger_mid_range_livelock_buster` → hazard reset   | `perseus_ls_lrq.sv:L90`; `perseus_ls_lrq_entry.sv:L2314`    |
| 11 | L2-response timeout detect         | `tick_tock_change_q` two-edged timer                 | `perseus_ls_lrq.sv:L65-L66`; `perseus_ls_lrq_entry.sv:L2248-L2252` |
| 12 | Queue-status exports               | `lrq_full`, `lrq_avail_nxt_cnt`, NC/dev trackers     | `perseus_ls_lrq.sv:L104, L113, L3228-L3229, L1382-L1383, L29016` |

### §4.3 Diagram caveats

- The 16 per-entry FSM arcs (to/from d0-arb, m3/m4 demux, FB coupling,
  flush, livelock, timeout, status) are drawn once at the bottom of the
  diagram rather than 16 times, to keep the figure legible. Each of the
  16 entries has its own copy of these connections — the FSM is
  genuinely per-entry, not centralised.
- The ordering-primitive block is the one place where this diagram
  *deliberately* shows two realisations side by side. Later sections
  (§5 Gate 13, §8 Gate 15) will discuss whether the two are
  functionally equivalent under the LRQ's usage; at the abstraction
  level of §3/§4 they are drawn as parallel alternatives per the pilot
  framing rule.
- `lrq_fb_ptr_q` is used as a shorthand in the FB-coupling block for
  the family `ld_linked_fb_rst_id_q` / `ld_linked_fb_rst_id_unalign2_q`
  / `ld_nc_dev_linked_fb_entry`; the exact per-entry pointer-vs-vector
  shape is detailed in §6 (Gate 13).

---

<!-- §5 onwards deferred to Tasks 14-18 (Gates 13-17). Do not fill here. -->
