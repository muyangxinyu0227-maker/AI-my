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

## §5 接口列表 (Interface List)

> Ports are taken verbatim from the module header of
> `perseus_ls_lrq.sv` (lines 35-1105 in the
> `PERSEUS-MP128-r0p3-00rel0` snapshot). Because the module has on the
> order of ~460 ports (three load pipes × many per-uop signals + L2
> response + pipeline d0 issue + FB/FSM/DFT), we group them by
> functional domain rather than list them in declaration order. Widths
> are given as declared (parameter macros kept symbolic); stages use
> Perseus LS stage names (i1/i2/i3, a1/a2/a3, d0/d1, m2/m3/m4/m5). For
> signals whose "active stage" is not literally part of the suffix,
> the active stage is inferred from the usage and flagged
> `UNVERIFIED`.
>
> **Snapshot qualifier.** Exact line numbers, group sizes, and the
> existence/absence of specific debug/MBIST pins are all taken from the
> `PERSEUS-MP128-r0p3-00rel0` snapshot; a different release tag may
> differ.

### §5.1 Input ports

#### §5.1.1 Clock / reset / DFT / chicken-bits

| Signal | Width | Source | Active stage | Purpose |
|---|---|---|---|---|
| `clk` | 1 | SoC clocking | all | Module clock. `perseus_ls_lrq.sv:L35` |
| `cb_dftcgen` | 1 | DFT controller | all | Clock-gate cell DFT override. `L36` |
| `reset_i` | 1 | SoC reset | sync | Synchronous reset (all `_q` state cleared). `L37` |
| `chka_disable_ls_rcg` | 1 | Chicken reg | all | Disable LS regional clock-gating. `L39` |
| `ls_disable_nc_spec_req` | 1 | Chicken reg | a2/d0 | Disable speculative NC/Device requests. `L40` |
| `ls_gre_ldnp_overread_disable` | 1 | Chicken reg | d0 | Suppress GRE LDNP over-read. `L42` |
| `ls_enable_serialize_gather` | 1 | Chicken reg | a2 | Serialise SVE gather instead of LRQ-parallel. `L43` |
| `ls_disable_lrq_wait_l2resp_timeout` | 1 | Chicken reg | any | Disable `WAIT_L2RESP` timeout. `L45` |
| `ls_enable_lrq_wait_l2resp_tofu_timeout` | 1 | Chicken reg | any | Enable TOFU-scoped `WAIT_L2RESP` timeout. `L46` |
| `ls_disable_precise_stdata_wakeup` | 1 | Chicken reg | any | Force non-precise STDATA wakeup. `L47` |
| `ls_disable_multi_fb_link1` | 1 | Chicken reg | d0 | Disable multi-FB linking for unalign1. `L49` |
| `ls_enable_spot_fix1` / `ls_enable_spot_fix2` | 1 each | Chicken reg | any | Spot-fix enables. `L51-52` |
| `ls_revert_lrq_link_clr_to_arb` | 1 | Chicken reg | d0 | Revert link-clear to arb-time behaviour. `L53` |
| `ls_disable_lrq_alloc_dg` | 1 | Chicken reg | a2 | Disable alloc data-gating. `L55` |

#### §5.1.2 Global state / system-config

| Signal | Width | Source | Active stage | Purpose |
|---|---|---|---|---|
| `eff_big_endian_q` | 1 | Sys-reg | any | Effective big-endian for load data. `L57` |
| `sctlr_el2_ee` | 1 | Sys-reg | any | EL2 endianness override. `L59` |
| `nested_virt_op_ls{0,1,2}_a2_q` | 1 each | Sys-reg / decode | a2 | Nested-virt per-pipe flag. `L61-63` |
| `ls_lrq_timeout_tick_tock_change_q` | 1 | Timeout FSM | any | Tick-tock change event (livelock/timeout). `L65` |
| `ls_tick_tock_q` | 1 | Global counter | any | Global tick-tock phase. `L66` |
| `fb_empty` | 1 | FB unit | any | Fill-buffer completely empty. `L67` |

#### §5.1.3 Age / ordering (pipeline-level)

> These are allocator-pair "younger-than" signals — per §3.4, the LRQ
> does **not** instantiate `age_matrix(16)` in this RTL snapshot; the
> 3-way allocator age uses these inputs plus the pairwise comparator
> farm at `perseus_ls_lrq.sv:L4636-L5038`.

| Signal | Width | Source | Active stage | Purpose |
|---|---|---|---|---|
| `ls0_uop_older_than_ls1_a1_q` | 1 | AGE matrix (outside LRQ) | a1 | Pipe-pair ordering used by allocator. `L69` |
| `ls1_uop_older_than_ls2_a1_q` | 1 | AGE matrix | a1 | Pipe-pair ordering. `L70` |
| `ls0_uop_older_than_ls2_a1_q` | 1 | AGE matrix | a1 | Pipe-pair ordering. `L71` |
| `disable_lrq1_pick_nxt` / `disable_lrq0_pick_nxt` | 1 | Arb control | d0 | Force d0 picker to skip lrq0/lrq1 this cycle. `L72-73` |
| `block_ls_1` / `block_ls_2` | 1 | Upstream | a2 | Block ls1/ls2 allocation. `L74-75` |
| `direct_blk_en` | 1 | Upstream | a2 | Direct block enable. `L76` |

#### §5.1.4 SB / precommit / tofu / retirement

| Signal | Width | Source | Active stage | Purpose |
|---|---|---|---|---|
| `sb_raw_dealloc_ptr` | `STID` | SB | any | Store-buffer RAW dealloc pointer. `L78` |
| `sb_wr_mb_ptr_stid_w3_q` | `STID` | SB | w3 | SB write-MB pointer (stid). `L80` |
| `precommit_uid_q` | `UID` | Retire | any | Global precommit UID pointer. `L83` |
| `ct_tofu_vld`, `ct_tofu_uid` | 1, `UID` | Commit | any | Commit-side "take-over-from-LS" event. `L86-87` |
| `ct_ls_oldest_unrslvd_is_ld` | 1 | Commit | any | Oldest unresolved op at retire is a load. `L88` |
| `ls_prevent_load_pass_store_a2_q` | 1 | Order ctrl | a2 | Block load-passes-store at alloc. `L102` |

#### §5.1.5 Livelock / FB / credit

| Signal | Width | Source | Active stage | Purpose |
|---|---|---|---|---|
| `trigger_mid_range_livelock_buster` | 1 | Livelock detect | any | External livelock buster trigger. `L90` |
| `fb_available` | 1 | FB | any | At least one FB entry free. `L92` |
| `nc_fb_credit_return_pending_q` | 1 | FB | any | NC FB credit return in flight. `L93` |
| `evict_rd_req_v_d0`, `capacity_evict_rd_req_v_d0` | 1 | d0 arb | d0 | Evict-read arb conflict hints. `L94-95` |
| `fb_any_valid_nc_dev_entry_dly_q` | 1 | FB | any | Any NC/Dev FB entry live (delayed). `L681` |
| `fdb_holding_credit_q` | 1 | FDB | any | FDB holds credit. `L683` |
| `fb_fill_wb_mem_m4` | 1 | FB/L2 | m4 | FB fill WB-memory at m4. `L698` |
| `fill_resp_rst_index_m4`, `fb_fill_index_m4` | 1,1 | FB | m4 | Fill response/fill index bit (line-offset select). `L700-701` |

#### §5.1.6 ls0 pipeline inputs — i2/a1/a2 allocation stage

> The ls0/ls1/ls2 groups mirror each other; only ls0 is tabulated in
> detail, with a "mirror" row for ls1/ls2.

| Signal | Width | Source | Active stage | Purpose |
|---|---|---|---|---|
| `ls0_uid_a1_q` | `UID` | Rename/IS | a1 | Load uop UID at a1. `L115` |
| `ls0_block_lrq_alloc_a2_q` | 1 | ls0 pipe | a2 | Block LRQ alloc for ls0. `L118` |
| `uid_ls0_i2_q`, `issue_ld_val_ls0_i2` | `UID`, 1 | IS | i2 | i2 UID + valid. `L120-121` |
| `ld_val_ls0_a2_q`, `ld_val_ls0_a2` | 1,1 | a2 | a2 | Load valid a2 (reg/comb). `L125, L129` |
| `ls0_ld_cross_16_32_byte_a2_q`, `ls0_ld_cross_32_byte_a2_q` | 1,1 | a2 | a2 | Cross-boundary flags. `L126-127` |
| `issue_v_ls0_ld_a1_q`/`a2_q`/`a2` | 1 each | IS | a1/a2 | Issue-valid pipeline copies. `L130-132` |
| `iq0_oldest_ql_a1` | 1 | IQ | a1 | IQ0 oldest-ql. `L133` |
| `ls0_ld_page_split1_a1`, `ls0_ld_page_split1_a2`, `ls0_ld_page_split2_a2` | 1 each | TLB/AGU | a1/a2 | Page-split variants. `L135, L141-142` |
| `ls0_ld_ssbb_blk_a2_q` | 1 | Ordering | a2 | SSBB block. `L137` |
| `ls0_stid_a2_q` | `STID` | SB | a2 | Store-buffer tag. `L139` |
| `ls0_srca_hash_a2_q` | 5 | AGU | a2 | src-a hash for RAW matching. `L140` |
| `ls0_ld_unalign1_a2`, `ls0_ld_unalign2_a2` | 1,1 | a2 | a2 | Unaligned halves. `L143-144` |
| `ls0_cache_line_split_a2_q` | 1 | a2 | a2 | 64B line split. `L145` |
| `mte_access_ls0_a2`, `mte_prc_mode_ls0_a2`, `mte_allow_flt_ls0_a2` | 1,1,1 | MTE | a2 | MTE ctrl. `L147-149` |
| `ls0_ltag_a2_q` | 4 | MTE | a2 | Logical tag. `L150` |
| `xlat_unpriv_ls0_a2_q` | 1 | TLB | a2 | Unpriv translation. `L151` |
| `ls0_mte_war_nuke_nxt_d4` | 1 | MTE | d4 | MTE WAR nuke next cycle. `L153` |
| `ls0_precommit_uop_a2_q` | 1 | Commit | a2 | Uop is precommitted. `L155` |
| `lor_id_ls0_a2`, `lor_match_ls0_a2` | `LOR_ID`,1 | LOR | a2 | LOR id + match. `L158-159` |
| `ls0_abort_early_indicator_adjusted_a2`, `ls0_prc_abort_adjusted_ql_a2` | 1,1 | Abort ctrl | a2 | Early abort hints. `L161-162` |
| `ls0_ld_uid_a2_q`, `ls0_rid_a2_q` | `UID`,1 | a2 | a2 | Load UID + replay id. `L163-164` |
| `ls0_ld_instr_id_a2_q` | 64 | Rename | a2 | Opaque instr id. `L166` |
| `pbha_ls0_a2` | `PBHA_RANGE` | TLB | a2 | PBHA attribute. `L169` |
| **ls1/ls2 mirror** | — | — | — | Every signal above repeats for ls1 (`L175-231`) and ls2 (`L235-291`). |

#### §5.1.7 ls{0,1,2} pipeline inputs — a2/a3/d2/d3/d4

| Signal | Width | Source | Active stage | Purpose |
|---|---|---|---|---|
| `outer_alloc_ls0_a2` | 1 | a2 | a2 | Outer-shared alloc. `L303` |
| `cache_attr_ls0_a2` | `LSL2_CACHE_ATTR` | TLB/PT | a2 | Cache attribute. `L306` |
| `share_attr_ls0_a2` | 2 | TLB/PT | a2 | Shareable attribute. `L307` |
| `tlb_any_hit_ls0_a2`, `tlb_one_or_more_hits_ls0_a2` | 1,1 | TLB | a2 | TLB hit flags. `L308-309` |
| `ls0_split_lane_vld_a2_q` | 1 | SVE ctrl | a2 | Split-lane valid. `L310` |
| `ldg_frc_raz_ls0_a2` | 1 | LDG ctrl | a2 | Force RAZ. `L311` |
| `ls0_srcpg_data_a2_q`, `ls0_srcpg_v_a2_q` | 32,1 | Rename | a2 | Source-pg predicate data. `L313-314` |
| `ls0_iq_ld_uop_vld_d2`, `_d3` | 1,1 | IQ | d2/d3 | IQ-driven uop valid. `L316, L324` |
| `ls0_ld_gather_d3_q`, `ls0_ld_sve_rep_d3_q`, `ls0_ld_sve_qrep_d3_q` | 1 each | Decode | d3 | SVE mode bits. `L317-319` |
| `ls0_pld_pli_op_d3` | 1 | Decode | d3 | PLD/PLI op. `L325` |
| `ls0_iq0_won_arb_a2_q`, `_a4_q` | 1,1 | IQ arb | a2/a4 | IQ arb won. `L326-327` |
| `ls0_ccpass_a2_q`, `_a3_q`, `_no_abort_a2` | 1,1,1 | CC | a2/a3 | CC-pass flags. `L328-330` |
| `is_ls_dstx_v_ls0_a2_q`, `_ptag_`, `_vlreg_`, `_size_` | 1, p-tag, 3, 3 | Rename | a2 | Destination-X info. `L332-337` |
| `is_ls_dsty_v_ls0_a2_q`, `_ptag_`, `_vlreg_` | 1, p-tag, 2 | Rename | a2 | Destination-Y info. `L339-341` |
| `ls_uop_ctl_ls0_a2_q` | `LS_CTL_LRQ_SAVE` | Decode | a2 | Bundled control bits saved in LRQ entry. `L343` |
| `ls0_ld_type_ovld_a2_q` | 1 | Decode | a2 | Load-type overload. `L345` |
| `ls0_va_a2_q`, `ls0_fb_va_a2_q` | VA range | AGU/TLB | a2 | VA + FB-VA. `L347-348` |
| `ls0_region_va_match_id_v_a2`, `_id_a2` | 1,`VA_REGION_ID_R` | DVM | a2 | VA-region match (for DVM invalidate). `L349-350` |
| `va_ls0_a1` | [11:4] | AGU | a1 | Byte-in-line bits at a1. `L353` |
| `ls0_mte_ttbr_a2` | 1 | MTE | a2 | MTE TTBR. `L354` |
| `tlbid_ls0_a2_q` | `LS_TLBID` | TLB | a2 | TLB entry id. `L356` |
| `ls0_iq_ld_nc_a2`, `_dev_a2`, `_nc_dev_a2` | 1 each | IQ/attr | a2 | NC / Dev / NC+Dev classification. `L358-360` |
| `ls0_pc_index_a2_q` | `LPT_PC_INDEX_MAX:0` | LPT | a2 | LPT PC index. `L362` |
| `ls0_lpt_hit_a2` | 1 | LPT | a2 | LPT hit. `L363` |
| `ls0_stid_delta_a2_q` | `LPT_STID_DELTA` | LPT | a2 | LPT stid delta. `L364` |
| `ld_val_ls0_a3` | 1 | a3 | a3 | Load-valid a3. `L366` |
| `ls0_ld_pa_a3_q`, `ls0_ld_ns_a3_q`, `ls0_ld_ps_at_least_64k_a3_q` | PA range, 1, 1 | TLB | a3 | Physical address + NS + page size. `L368-370` |
| `ls0_prc_abort_adjusted_a3_q` | 1 | Abort | a3 | Abort flag a3. `L372` |
| `ld_val_ls0_a4` | 1 | a4 | a4 | Load-valid a4. `L375` |
| `ls0_older_invalid_st_d2`, `_d4_q` | 1,1 | SB | d2/d4 | Older-invalid store. `L378, L398` |
| `ls0_ld_false_l2_wkup_d2`, `_d3` | 1,1 | L2 | d2/d3 | False L2 wakeup hints. `L380, L403` |
| `ls0_ld_fb_fwd_vld_d2_q`, `_d2_qual` | 1,1 | FB | d2 | FB-forward valid / qualified. `L381-382` |
| `ls0_ld_hit_nc_dev_unal_buf_d2` | 1 | NC/Dev buf | d2 | Hit NC/Dev unalign buffer. `L383` |
| `ls0_ld_hit_cacheable_unal_buf_d3_q` | 1 | Cacheable buf | d3 | Hit cacheable unalign buffer. `L386` |
| `ls0_tag_sbecc_err_vld_d3`, `_tag_ecc_sel_d3` | 1,1 | Tag ECC | d3 | Tag SBECC. `L387-388` |
| `ls0_ld_complete_d4`, `_data_return_d4`, `_l2_poison_d4` | 1 each | d4 | d4 | Load-complete + return + poison. `L390-392` |
| `ls0_ldar_past_stlr_alloc_rar_d4`, `_d4_override_resolve` | 1,1 | Ordering | d4 | LDAR-past-STLR override. `L393-394` |
| `ls0_ld_restart_d4` | 1 | d4 | d4 | Load restart. `L395` |
| `ls0_ld_unalign1_d4_q` | 1 | d4 | d4 | Unalign1 flag d4. `L396` |
| `ls0_ld_wayt_hit_way_mismatch_d3`, `_ignore_wayt_d3` | 1,1 | Way | d3 | Way-hit mismatch / ignore. `L401-402` |
| `ls0_ld_false_l2_wkup_sb_mb_overlap_d3` | 1 | L2 | d3 | False-wakeup due to SB/MB overlap. `L405` |
| `ls0_stlf_cancel_stdata_not_rdy_d3` | 1 | STLF | d3 | STLF cancel — stdata not ready. `L406` |
| `ls0_ld_l1_miss_sleep_d3`, `_wait_on_fb_d3` | 1,1 | d3 | d3 | Miss-sleep / wait-on-FB. `L407-408` |
| `ls0_ld_hit_sb_nodata_stid_d3` | `STID_NO_WRAP` | SB | d3 | SB-hit no-data stid. `L411` |
| `ls0_ld_alloc_match_fb_rst_d3`, `ls0_fb_rst_id_d3`, `ls0_ld_confirm_fb_rst_match_d3` | 1, 6, 1 | FB link | d3 | FB-reset linkage. `L412-414` |
| **ls1 mirror** | — | — | — | `L417-530` |
| **ls2 mirror** | — | — | — | `L533-646` |

#### §5.1.8 STDATA wakeup (two ports, p0/p1) and SB/SVE

| Signal | Width | Source | Active stage | Purpose |
|---|---|---|---|---|
| `std_wakeup_p0_v`, `std_wakeup_p0_stid` | 1, `STID_NO_WRAP` | STDATA gen | i2 | STDATA wake p0. `L296-297` |
| `std_wakeup_p1_v`, `std_wakeup_p1_stid` | 1, `STID_NO_WRAP` | STDATA gen | i2 | STDATA wake p1. `L298-299` |
| `ls0_std_v_i2_q`, `ls1_std_v_i2_q` | 1,1 | SVE std | i2 | STD present (ls0/ls1). `L649, L658` |
| `std_vec_stid_v_p0_{i2,i3,v1}_q`, `p1_{i2,i3,v1}_q` | 1 each | SVE std | i2/i3/v1 | Vec stid valid per stage. `L651-653, L660-662` |
| `std_stid_v_p0_e1_q`, `p1_e1_q` | 1 each | SVE std | e1 | Stid valid e1. `L655, L664` |
| `snp_ecc_self_evict_entry_v_q` | 1 | Snoop | any | Snoop ECC self-evict entry. `L667` |
| `is_ls_std_data_coming_i1` | 1 | IS | i1 | STD data coming i1. `L669` |
| `std_overflow_wakeup_all` | 1 | STDATA | any | Wake all on STDATA overflow. `L670` |
| `sb_empty`, `sb_val_q` | 1, `LS_SB_SIZE` | SB | any | SB empty / entry valids. `L671-672` |

#### §5.1.9 IQ / PLRU / FB hints / d0 arb sidebands

| Signal | Width | Source | Active stage | Purpose |
|---|---|---|---|---|
| `iq_oldest_ld_uid_a1_q`, `iq_oldest_ld_vld_a1_q` | `UID`,1 | IQ | a1 | Oldest-load pointer. `L675-676` |
| `plru_bits_final_dz` | `LS_PLRU_BITS_RANGE` | PLRU | dz | PLRU final bits. `L678` |
| `fb_fill_way_clean_dz` | `DCACHE_WAY_RANGE` | FB | dz | Fill-way clean mask. `L679` |
| `evict_rd_req_clean_d0` | 1 | d0 | d0 | Evict-read clean. `L680` |
| `iq_oldest_ld_uid_i2` | `UID` | IQ | i2 | i2 oldest-load pointer. `L107` |

#### §5.1.10 L2 response capture

| Signal | Width | Source | Active stage | Purpose |
|---|---|---|---|---|
| `l2_ls_spec_valid_m2`, `_crit_m2`, `_addr_m2[5:5]`, `_id_m2`, `_qw_en_m2` | 1, 1, 1, `LSL2_DID`, 4 | L2 | m2 | L2 speculative response at m2. `L685-690` |
| `l2_ls_spec_valid_m4_q`, `_crit_m4_q`, `_id_m4_q`, `l2_ls_rvalid_m4`, `_addr_m4_q[5:5]`, `_addr_m5_q[5:5]` | 1,1, id, 1, 1, 1 | L2 | m4/m5 | L2 response at m4/m5 (registered). `L691-696` |

#### §5.1.11 d0-arb outcome feedback (lrq0/lrq1 outputs feeding back)

| Signal | Width | Source | Active stage | Purpose |
|---|---|---|---|---|
| `lrq0_won_arb_ls0_d1`, `lrq0_won_arb_ls1_d1`, `lrq1_won_arb_ls1_d1` | 1 each | d0 arb | d1 | Arb outcomes (which pipe LRQ0/1 won). `L703-705` |
| `lrq0_ld_unalign1_d1`, `lrq1_ld_unalign1_d1`, `lrq0_ld_unalign2_d1_q`, `lrq1_ld_unalign2_d1_q` | 1 each | d1 | d1 | Unalign1/2 at d1 per LRQ. `L708-712` |
| `ls{0,1,2}_ld_page_split2_d2` | 1 each | d2 | d2 | Page-split2 at d2. `L714-716` |
| `lrq0_ld_nc_dev_unalign1_fb_fwd_vld_d1`, `lrq1_…_d1` | 1,1 | d1 | d1 | NC/Dev unalign1 FB-fwd. `L718-719` |
| `nc_dev_unal_buf_valid_q` | 1 | NC/Dev buf | any | NC/Dev unalign buffer valid. `L721` |

#### §5.1.12 Flush / sync / override

| Signal | Width | Source | Active stage | Purpose |
|---|---|---|---|---|
| `flush` | 1 | ct (commit) | any | Flush request (R7-4). `L724` |
| `flush_uid` | `UID` | ct | any | Flush-UID watermark. `L725` |
| `mb_atomic_override_lrq0_unalign2_d1` | 1 | MB atomic | d1 | Override LRQ0 unalign2. `L727` |
| `rst_strex_par_rd_override_lrq1_unalign2_d1` | 1 | STREX | d1 | Override LRQ1 unalign2. `L728` |
| `sync_mark_buffers_a3` | 1 | Sync | a3 | Sync-mark broadcast. `L731` |
| `lrq0_ld_false_l2_wkup_d1`, `lrq1_ld_false_l2_wkup_d1` | 1,1 | d1 | d1 | False-wakeup for LRQ0/1. `L738, L743` |
| `lrq0_ld_uop_flush_d1`, `lrq1_ld_uop_flush_d1` | 1,1 | d1 | d1 | Per-LRQ uop-flush (R7-4). `L741, L746` |

#### §5.1.13 Per-pipe post-alloc pipeline uop-valid / flush / gather

> These feed the FSM flush logic and the post-alloc "did the pipeline
> actually make it" qualifiers for each entry. The structure is
> identical across ls0/ls1/ls2 — ls0 only is tabulated.

| Signal | Width | Source | Active stage | Purpose |
|---|---|---|---|---|
| `ls0_lrq_ld_uop_vld_d2`, `ls0_ld_uop_vld_d2`/`_d3`/`_d4` | 1 each | LRQ d0 replay / pipe | d2/d3/d4 | Post-alloc uop-valid tracked through d2-d4. `L748-751` |
| `ls0_ld_unalign2_d2_q`, `_d3_q`, `ls0_ld_unalign1_d3_q` | 1 each | d2/d3 | d2/d3 | Unalign1/2 at d2/d3. `L752-754` |
| `ls0_ld_match_stdata_in_flight_d3` | 1 | STLF | d3 | Load matches in-flight STDATA. `L756` |
| `ls0_element_size_d3_q` | 3 | Decode | d3 | Element size. `L759` |
| `ls0_ld_nc_dev_unalign1_block_fb_credit_d2` | 1 | d2 | d2 | NC/Dev unalign1 blocks FB credit. `L762` |
| `ls0_uop_flush_d2`/`_d3`/`_d4` | 1 each | Flush | d2-d4 | Per-stage per-pipe flush qualifier. `L763-765` |
| `ls0_won_pf_train_d4_q` | 1 | PF train | d4 | PF train winner. `L767` |
| **ls1 mirror** | — | — | — | `L769-788` |
| **ls2 mirror** | — | — | — | `L790-809` |

#### §5.1.14 DVM / VA-region invalidate + live-lock + misc

| Signal | Width | Source | Active stage | Purpose |
|---|---|---|---|---|
| `va_region_clear_v`, `va_region_clear_id` | 1, `VA_REGION_ID_R` | DVM | any | VA-region invalidate (R7-4). `L109-110` |
| `oldest_ld_replay_cnt_sat` | 1 | Replay ctr | any | Oldest-load replay counter saturated (livelock hint, R7-4). `L1055` |

### §5.2 Output ports

#### §5.2.1 Status / wakeup / oldest-ld

| Signal | Width | Destination | Active stage | Purpose |
|---|---|---|---|---|
| `ct_tofu_uid_changed_q` | 1 | ct | any | Tofu-uid changed flag (reg). `L85` |
| `ls_is_lrq_wakeup_iz` | 1 | IS | iz | LRQ wakeup broadcast to IS scheduler (`LRQ-F13`). `L100` |
| `tofu_oldest_ld_delay_dvm_sync` | 1 | DVM sync | any | Delay DVM sync until oldest-load resolved. `L101` |
| `lrq_full` | 1 | Upstream (IQ/IS) | any | LRQ full — back-pressure (`LRQ-F12`, R7-3/4). `L104` |
| `ct_tofu_uid_q` | `UID` | ct | any | Registered tofu-uid. `L105` |
| `lrq_has_nc_dev_ld_q` | 1 | Upstream | any | LRQ holds ≥1 NC/Dev load (`LRQ-F11`). `L113` |
| `ls{0,1,2}_lrq_ld_oldest_in_lrq_d2` | 1 each | d2 | d2 | Per-pipe oldest-in-LRQ marker. `L301, L417, L533` |
| `blk_non_oldest_ld` | 1 | IS | any | Block non-oldest load issue. `L1057` |
| `lrq_oldest_uid`, `lrq_oldest_rid`, `lrq_oldest_vld` | `UID`, 1, 1 | IS/Ret | any | Oldest-live LRQ entry. `L1058-1060` |
| `lrq_oldest_op_clr` | 1 | IS/Ret | any | Oldest-op clear event. `L1061` |
| `lrq_sync_drained` | 1 | Sync | a3+ | LRQ has drained all sync-marked entries. `L733` |

#### §5.2.2 d0 pipeline re-issue — lrq0/lrq1 request to d0 arb

> 2 "pick" slots drive d0 independently; the set below is for lrq0,
> mirrored by lrq1.

| Signal | Width | Destination | Active stage | Purpose |
|---|---|---|---|---|
| `lrq0_ld_req_v_d0`, `lrq0_ld_req_poss_v_d0`, `lrq0_ld_req_v_late_squash_d0` | 1 each | d0 arb | d0 | Pick slot req valid / possibly-valid / late-squash. `L813-815` |
| `lrq0_ld_ignore_wayt_d0`, `lrq0_cracked_dev_ld_d0` | 1,1 | d0 | d0 | Way-ignore / cracked-dev flags. `L816-817` |
| `lrq0_ld_va_d0` | VA range | d0 | d0 | Replay VA. `L818` |
| `lrq0_ld_dst_size_d0`, `lrq0_ld_elem_size_dw_d0`, `lrq0_ld_size_d0` | 3,1,3 | d0 | d0 | Dst/element/load sizes. `L819, L821, L836` |
| `lrq0_ld_dstx_v_d0`, `_ptag_d0`, `_vlreg_d0` | 1, p-tag, 3 | d0 | d0 | Dst-X. `L822-824` |
| `lrq0_ld_gather_v_d0`, `lrq0_ld_type_ovld_d0`, `lrq0_ld_ldg_d0` | 1 each | d0 | d0 | SVE gather / type-ovld / LDG. `L826, L828, L830` |
| `lrq0_ld_dsty_v_d0`, `_ptag_d0`, `_vlreg_d0` | 1, p-tag, 2 | d0 | d0 | Dst-Y. `L831-833` |
| `lrq0_ld_unalign_d0`, `lrq0_ld_align_cross_16_byte_d0`, `lrq0_ld_align_cross_32_byte_d0` | 1 each | d0 | d0 | Alignment classes. `L838-840` |
| `lrq0_ld_matched_fb_rst_d0`, `lrq0_ld_fb_rst_id_d0` | 1, 6 | d0 | d0 | FB-link at replay time. `L842-843` |
| `lrq0_ld_uid_d0`, `lrq0_ld_rid_d0`, `lrq0_ld_pld_pli_d0` | `UID`, 1, 1 | d0 | d0 | UID / RID / PLD-PLI. `L844-846` |
| `lrq0_ld_instr_id_d0`, `lrq0_ld_srca_hash_d0`, `lrq0_ld_cache_attr_d0` | 64, 5, `CACHE_ATTR` | d0 | d0 | Opaque ids + cache-attr. `L848, L850-851` |
| `lrq0_ld_ccpass_d0`, `_ccpass2_d0` | 1,1 | d0 | d0 | CC-pass. `L853-854` |
| `lrq0_ld_prc_abort_d1`, `lrq0_ld_type_d1`, `lrq0_ld_qw_unalign_d1` | 1, `CTL_TYPE`, 1 | d1 | d1 | Registered at d1. `L855-856, L859` |
| `lrq0_ld_pa_d1`, `lrq0_ld_ns_d1`, `lrq0_ld_stid_d1`, `lrq0_ld_tlbid_d1` | PA, 1, `STID`, `TLBID` | d1 | d1 | PA + NS + STID + TLBID at d1. `L860-863` |
| `lrq0_ld_matched_fb_rst_unalign2_d0`, `lrq0_ld_fb_rst_id_unalign2_d0` | 1, 6 | d0 | d0 | Unalign2 FB-link. `L1004-1005` |
| `lrq0_ld_req_d0_older_than_d1` | 1 | d0 arb | d0 | Age between two d0 slots. `L1006` |
| **lrq1 mirror** | — | — | — | `L864-1009` |

#### §5.2.3 Per-pipe d2/d3/d4 allocation-side outputs

| Signal | Width | Destination | Active stage | Purpose |
|---|---|---|---|---|
| `ls0_lrq_ld_lor_match_vld_d2`, `ls0_lrq_ld_lor_id_d2` | 1, `LOR_ID` | LOR | d2 | LOR match. `L917-918` |
| `ls0_lrq_ld_share_attr_d2`, `_outer_alloc_d2` | 2,1 | Cache | d2 | Share attr + outer-alloc. `L919-920` |
| `ls0_lrq_ld_mte_access_d2`, `_mte_prc_mode_d2`, `_mte_ttbr_d2`, `_unpriv_d2`, `_ltag_d2`, `_mte_allow_flt_d2` | 1,1,1,1,4,1 | MTE | d2 | MTE propagation. `L922-928` |
| `ls0_lrq_lpt_hit_d2` | 1 | LPT | d2 | LPT hit. `L930` |
| `ls0_lrq_pf_va_region_id_d2`, `_v_d2`, `ls0_lrq_pf_va_d2`, `ls0_lrq_already_trained_d2`, `ls0_lrq_ps_at_least_64k_d2` | `VA_REGION_ID_R`, 1, PF_VA, 1, 1 | PF | d2 | Prefetch-train info. `L932-936` |
| `ls0_ld_element_size_d2`, `_sign_extend_d2`, `_big_endian_d2` | 3,1,1 | d2 | d2 | Element size / sign-ext / endian. `L938-940` |
| `ls0_ld_ln_size_d3`, `_pred_v_d3`, `_pred_value_d3` | 2,1,32 | d3 | d3 | Line size / predicate. `L942-944` |
| `ls0_ld_oldest_no_linked_fb_d2` | 1 | FB link | d2 | Oldest with no linked FB. `L1011` |
| `ls0_ld_alloc_lrq_entry_spec_a2`, `ls0_ld_alloc_lrq_entry_a2` | 1,1 | Alloc | a2 | Speculative / confirmed alloc grant (`LRQ-F03`). `L1013-1014` |
| `ls0_sync_mark_d2`, `ls0_lrq_pc_index_d3`, `ls0_lrq_ld_sync_mark_d4` | 1, `PC_INDEX`, 1 | Sync | d2-d4 | Sync-mark outputs. `L1016-1018` |
| `ls0_ld_sve_vec_force_zero_d3`, `ls0_lpt_hit_wakeup_d3` | 32, 1 | d3 | d3 | SVE zero-force + LPT-hit wakeup. `L321, L323` |
| `ls0_lrq_ld_pbha_d2` | `PBHA_RANGE` | d2 | d2 | PBHA passthrough. `L171` |
| **ls1/ls2 mirror** | — | — | — | `L439-973, L555-1002` |

#### §5.2.4 LRQ page-split2 state (registered summary)

| Signal | Width | Destination | Active stage | Purpose |
|---|---|---|---|---|
| `lrq_page_split2_pa_q`, `_ns_q`, `_prc_abort_q`, `_ccpass_q` | PA,1,1,1 | d0/d1 | any | Page-split2 "other half" PA+flags. `L1040-1043` |
| `lrq_page_split2_cache_attr_q`, `_share_attr_q`, `_outer_alloc_q` | `CACHE_ATTR`,2,1 | d1 | any | Attributes. `L1044-1046` |
| `lrq_page_split2_nc` | 1 | d1 | any | Page-split2 NC. `L1047` |
| `lrq_page_split2_mte_access_q`, `_mte_allow_flt_q`, `_mte_ttbr_q`, `_pbha_q` | 1,1,1,`PBHA_RANGE` | MTE | any | MTE/PBHA of the other half. `L1049-1053` |
| `lrq_page_split_nc_c_vld_with_fb` | 1 | FB | any | NC critical split held with FB. `L735` |

#### §5.2.5 FB linkage / dev-load / LOR summary

| Signal | Width | Destination | Active stage | Purpose |
|---|---|---|---|---|
| `lrq_dev_load_with_linked_fb_vld` | 1 | FB | any | LRQ has dev-load with linked FB. `L1062` |
| `lrq_has_ld_with_linked_fb` | 1 | FB | any | LRQ has any FB-linked ld. `L1063` |
| `lrq_dev_load_with_linked_fb_lor_vld` | `LOR_SIZE` | LOR | any | Per-LOR dev+fb bitmap. `L1065` |
| `lrq_dev_ldar_non_lor_with_linked_fb_vld`, `lrq_dev_ldlar_with_linked_fb_lor_vld` | 1, `LOR_SIZE` | LOR | any | LDAR/LDLAR variants. `L1068-1069` |
| `fb_entry_has_linked_nc_dev_ld` | 16 | FB | any | Per-FB-entry NC/Dev-link mask. `L1071` |

#### §5.2.6 LRQ entry-id feedback (pipe → LRQ alloc)

| Signal | Width | Destination | Active stage | Purpose |
|---|---|---|---|---|
| `ls{0,1,2}_lrq_id_d2` | 5 each | Pipe | d2 | Allocated LRQ entry-id echoed back to each pipe. `L1075-1077` |

#### §5.2.7 RN-side resolved dev-load summary

| Signal | Width | Destination | Active stage | Purpose |
|---|---|---|---|---|
| `ls_rn_rslv_dev_ld_pending_vld` | 1 | RN | any | Any resolved dev-load pending retirement. `L1079` |
| `ls_rn_oldest_rslv_dev_ld_uid` | `UID_CMP_BITS` | RN | any | Oldest resolved dev-load UID. `L1080` |
| `ls_rn_oldest_rslv_dev_ld_wrap_uid` | 1 | RN | any | Wrap bit for that UID. `L1082` |

#### §5.2.8 LRQ bulk state exposure (for DFT / debug / assertions)

| Signal | Width | Destination | Active stage | Purpose |
|---|---|---|---|---|
| `lrq_vld_q` | `LRQ_RANGE` (16) | DFT | any | Per-entry valid. `L1085` |
| `lrq_entry{0..15}_state_q` | 4 each | DFT | any | Per-entry FSM state (16 × 4 b). `L1088-1103` |
| `lrq_empty` | 1 | DFT / IS | any | Queue empty. `L1105` |

> **Port-count summary.** The module header (L35-L1105) declares
> roughly 460 signals once the ls0/ls1/ls2 triplicates and L2
> response bundle are counted individually; the 14 input subgroups
> plus 8 output subgroups above cover every declared signal modulo
> the explicit "mirror" rows for the ls1/ls2 symmetry. Cycle-stage
> labels are taken from the suffix (`_a1/_a2/_d2/_d3/_m4/_q`) where
> present; stages for signals without a stage suffix (e.g. the
> chicken bits, `flush`, `fb_empty`) are marked `any`.

---

## §6 接口时序 (Interface Timing)

> Per rule R7, a waveform is included for each scenario that meets
> **at least one** of: cross-cycle handshake, FSM multi-state
> transition, multi-source concurrent arbitration, exception path.
> The LRQ is the most FSM-rich module in the pilot, so this section
> has seven waveforms. Every cycle-level observation below is
> `UNVERIFIED: inferred from RTL` — the LS cluster is not yet wired
> into a live simulation in this pilot; all timings are read off the
> RTL FSM transitions and cross-module handshake structure. The
> UNVERIFIED flag is marked once per waveform header, not per cycle.
> Signal names match §5 exactly; where an internal FSM-state variable
> is referenced (e.g. `lrq_entry{i}_state_q`) it also appears in §5.2.8.
>
> **Framing note for §6.2 and §6.6.** The 3-way allocation and the
> LRQ-full back-pressure both depend on the ordering primitive. In
> this RTL snapshot, ordering signals used by those paths
> (`lrq0/lrq1/lrq2_…_a2` allocator picks and cross-pipe age picks)
> are generated by the **pairwise comparator farm** at
> `perseus_ls_lrq.sv:L4636-L5038` (48 ×
> `perseus_ls_age_older_eq_compare` + 3 ×
> `perseus_ls_age_compare`); the spec-intent `age_matrix(16)` is
> **not instantiated** in this snapshot. See §1.5 / §3.4 for the
> full framing. Waveforms below name only the RTL-observed ordering
> wires.

### §6.1 Entry lifecycle — normal RDY → IN_PIPE → WAIT_L2RESP → L2RESP_M4 → WAIT_FB → RDY

**(UNVERIFIED: inferred from RTL FSM encodings at
`perseus_ls_defines.sv:L726-L735` + per-entry state reg exposed at
`perseus_ls_lrq.sv:L1088-L1103`.)**

Scenario: a single load on ls0 misses L1 and allocates LRQ entry 0; L1
miss goes to L2; L2 returns at m4; entry waits on FB fill, then
retires.

```
cycle:               C0    C1    C2    C3    C4    C5    C6    C7    C8
clk:                _‾_‾_‾_‾_‾_‾_‾_‾_‾_‾_‾_‾_‾_‾_‾_‾_‾_
ls0_ld_uid_a2_q:    ====< UID_A     >========================================
ld_val_ls0_a2_q:    ____‾‾‾‾‾‾____________________________________
ls0_ld_alloc_lrq_entry_a2:  __‾‾‾‾__________________________________    (alloc grant)
ls0_lrq_id_d2:      ________<=0x0=>______________________________      (entry 0)
lrq_vld_q[0]:       ____________‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾____
lrq_entry0_state_q: <RDY ><IN_PIPE><WAIT_L2RESP     ><L2RESP_M4><WAIT_FB><RDY>
ls0_ld_l1_miss_wait_on_fb_d3: ______________‾‾‾‾____________________
l2_ls_spec_valid_m4_q:        __________________________‾‾______
l2_ls_rvalid_m4:              __________________________‾‾______
l2_ls_spec_id_m4_q:           ________________________<=DID=>____
fb_available:                 ‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾____
fb_empty (→ release):         __________________________________‾‾‾‾
ls_is_lrq_wakeup_iz:          ______________________________‾‾______
```

Per-cycle walkthrough:

- **C0** ls0 load enters a2 with `ld_val_ls0_a2_q=1`. Allocator grants
  `ls0_ld_alloc_lrq_entry_a2=1` (§5.2.3, `L1014`). Entry 0 is selected.
- **C1** (stage d2 of the alloc) `lrq_vld_q[0]` goes high and state
  enters `IN_PIPE` (`4'b0001`, `defines:L727`). The d0 arb will not
  re-pick this entry while it is `IN_PIPE` because the pipeline is
  still driving it.
- **C2** Pipe reports L1 miss wait-on-FB at d3
  (`ls0_ld_l1_miss_wait_on_fb_d3=1`, `L408`). State transitions to
  `WAIT_L2RESP` (`4'b0010`, `defines:L728`).
- **C3-C4** Entry idles in `WAIT_L2RESP`, periodically consulting
  `ls_lrq_timeout_tick_tock_change_q` (`L65`) for timeout (disabled
  here by `ls_disable_lrq_wait_l2resp_timeout=0`).
- **C5** L2 drives speculative response bundle at m2/m4; the registered
  `l2_ls_spec_valid_m4_q=1` and `l2_ls_rvalid_m4=1` at m4 (`L691,
  L694`) match the entry's captured DID. State moves to `L2RESP_M4`
  (`4'b0110`, `defines:L733`).
- **C6** Entry transitions to `WAIT_FB` (`4'b1001`, `defines:L735`) —
  data is announced but FB fill has not yet drained to the cache
  array. `ls_is_lrq_wakeup_iz` pulses at iz to wake dependent ops
  (`LRQ-F13`, `L100`).
- **C7** FB completes fill (`fb_fill_wb_mem_m4`, `L698`); FSM returns
  to `RDY` (`4'b0000`). `lrq_vld_q[0]` deasserts next cycle.

RTL pin cites: `L1014` (alloc), `L1077` (entry-id echo to ls0),
`L1088-L1103` (per-entry state exposed), `L691-L696` (L2 response),
`L1105` (empty).

### §6.2 3-way concurrent allocation (ls0 / ls1 / ls2 all alloc in one cycle)

**(UNVERIFIED: inferred from pairwise comparator farm at
`perseus_ls_lrq.sv:L4636-L5038` and allocator pick logic at
`L4068-L4080`; no simulation data.)**

> Ordering-signal framing: the three `ls{0,1,2}_uop_older_than_…_a1_q`
> inputs (§5.1.3, `L69-L71`) plus the 48+3 pairwise-comparator farm
> drive which of the three pipes gets which of the three free LRQ
> entries. The spec-intent `age_matrix(16)` is **not instantiated** in
> this RTL snapshot — see §3.4. The waveform labels only the
> RTL-observed wires.

Pre-condition: three entries free (say 5, 6, 7); three loads on
ls0/ls1/ls2 all valid at a2 with all `_block_lrq_alloc_a2_q = 0` and
no MTE/abort/overlap blocking.

```
cycle:                                C0        C1        C2
clk:                                 _‾_‾_‾_‾_‾_‾_‾_‾_
ld_val_ls0_a2_q / ls1 / ls2:         ‾‾‾‾‾‾‾‾  ________  ________
ls0_uop_older_than_ls1_a1_q:         ‾‾‾‾‾‾‾‾  ________  ________
ls1_uop_older_than_ls2_a1_q:         ‾‾‾‾‾‾‾‾  ________  ________
ls0_uop_older_than_ls2_a1_q:         ‾‾‾‾‾‾‾‾  ________  ________
lrq_more_than_two_avail (internal):  ‾‾‾‾‾‾‾‾  ________  ________
ls0_ld_alloc_lrq_entry_a2:           ‾‾‾‾‾‾‾‾  ________  ________
ls1_ld_alloc_lrq_entry_a2:           ‾‾‾‾‾‾‾‾  ________  ________
ls2_ld_alloc_lrq_entry_a2:           ‾‾‾‾‾‾‾‾  ________  ________
ls0_lrq_id_d2:                       ________  <=5=>     ________
ls1_lrq_id_d2:                       ________  <=6=>     ________
ls2_lrq_id_d2:                       ________  <=7=>     ________
lrq_vld_q[7:5]:                      ________  ‾‾‾‾‾‾‾‾  ‾‾‾‾‾‾‾‾
lrq_entry{5,6,7}_state_q:            <RDY>     <IN_PIPE> <IN_PIPE>
```

Per-cycle walkthrough:

- **C0 (a2)** All three `ld_val_ls{0,1,2}_a2_q=1`. The pairwise
  comparator farm (`L4636-L5012`) produces 48 older-than bits (3
  allocators × 16 entries). Three "can-alloc" vectors
  `lrq_{can,two_can,three_can}_alloc_a2` (computed around `L4068`) are
  all satisfied because `lrq_more_than_two_avail` is high. All three
  `ls{0,1,2}_ld_alloc_lrq_entry_a2` grants fire in the same cycle
  (`L1013-1014, L1022-1023, L1031-1032`).
- **C1 (d2)** Entry ids are echoed back to each pipe via
  `ls{0,1,2}_lrq_id_d2` (`L1075-L1077`). `lrq_vld_q` bits [7:5] rise
  simultaneously. The three entries enter `IN_PIPE` in the same cycle.
  Cross-allocator age is captured by the 3 × `perseus_ls_age_compare`
  cells at `L5026-L5038` so that the "older-than" relation between the
  three newly-allocated entries is consistent with ls0 < ls1 < ls2.
- **C2** Pipes continue into d3 normally; each entry independently
  chooses its next state (WAIT_L2RESP vs WAIT_STDATA vs …) based on
  its own pipe outcome.

Consistency invariant: for the three newly-allocated entries
{5,6,7}, the pairwise "older-than" bits produced by the comparator
farm must satisfy ls0 < ls1 < ls2 (from the input
`ls{i}_uop_older_than_ls{j}_a1_q` triple). The spec-intent
`age_matrix(16)` would have encoded this in one matrix update; here it
is encoded by 3 pairwise writes into the farm's state. Functional
equivalence is discussed in §8 (Gate 15).

### §6.3 STDATA speculative wakeup — WAIT_STDATA → STDATA_SPEC_WKUP → RDY

**(UNVERIFIED: inferred from state encodings at `defines:L729-L730`
and STDATA wakeup ports at `L296-L299`, `L669-L670`.)**

Scenario: a load that depends on in-flight store data (`STLF` path)
allocates and sits in `WAIT_STDATA`; store-data broadcast fires on
port p0; entry speculatively wakes and retires.

```
cycle:                     C0      C1      C2      C3      C4      C5
clk:                      _‾_‾_‾_‾_‾_‾_‾_
lrq_entry3_state_q:       <IN_PIPE><WAIT_STDATA       ><STDATA_SPEC_WKUP><RDY>
ls0_stid_a2_q:            <=STID_X=>_________________________________________
ls0_ld_match_stdata_in_flight_d3: __‾‾‾‾__________________________________
std_wakeup_p0_v:          ____________________________‾‾________
std_wakeup_p0_stid:       ____________________________<=STID_X=>___
is_ls_std_data_coming_i1: ______________________________‾‾__________
ls_is_lrq_wakeup_iz:      ____________________________________‾‾____
ls_disable_precise_stdata_wakeup: ________________________________________
```

Per-cycle walkthrough:

- **C0** Entry 3 is `IN_PIPE`; `ls0_ld_match_stdata_in_flight_d3`
  (`L756`) asserts at d3 — load matches an in-flight STDATA.
- **C1** State transitions to `WAIT_STDATA` (`4'b0011`,
  `defines:L729`). Entry is blocked from d0 re-pick.
- **C2-C3** Entry sits in `WAIT_STDATA`.
- **C4** `std_wakeup_p0_v=1` with `std_wakeup_p0_stid` equal to the
  entry's captured `stid` (`L296-L297`). With
  `ls_disable_precise_stdata_wakeup=0`, the entry moves to
  `STDATA_SPEC_WKUP` (`4'b0111`, `defines:L730`) — a **speculative**
  state (the FB may still back-pressure).
- **C5** `ls_is_lrq_wakeup_iz` (`L100`) pulses to wake IS dependents;
  entry transitions to `RDY`.

Corner case: if `ls_disable_precise_stdata_wakeup=1` or
`std_overflow_wakeup_all=1` (`L670`), the wakeup fires broadly rather
than on a stid match; the FSM still passes through
`STDATA_SPEC_WKUP` but the qualifier set is wider.

### §6.4 `ct_flush` mid-lifecycle — all pending entries flushed

**(UNVERIFIED: inferred from `flush` / `flush_uid` port at `L724-L725`
and per-entry kill path consumers.)**

Scenario: two entries live in different states when a commit-side
flush arrives. All entries younger than `flush_uid` are killed in one
cycle; oldest entries older than the watermark survive.

```
cycle:                     C0      C1      C2      C3
clk:                      _‾_‾_‾_‾_‾_‾_
flush:                    ______‾‾__________
flush_uid:                ______<=UID_W>______
lrq_entry2_state_q:       <WAIT_L2RESP><WAIT_L2RESP><WAIT_L2RESP>   (UID older than UID_W — kept)
lrq_entry4_state_q:       <WAIT_STDATA><WAIT_STDATA><RDY         >   (UID younger than UID_W — killed)
lrq_entry9_state_q:       <IN_PIPE    ><IN_PIPE    ><RDY         >   (killed)
lrq_vld_q[2]:             ‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾
lrq_vld_q[4]:             ‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾______
lrq_vld_q[9]:             ‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾______
lrq_full:                 ________________________
ls_is_lrq_wakeup_iz:      ________________________
```

Per-cycle walkthrough:

- **C0** System operating normally; three entries live (2, 4, 9).
- **C1** Commit asserts `flush=1` with `flush_uid=UID_W` (`L724-L725`).
  Every entry's per-entry FSM compares its stored UID to `flush_uid`:
  entries younger than the watermark (4, 9) take the kill arc
  directly to `RDY`. Entry 2 is older — it survives and stays in
  `WAIT_L2RESP`.
- **C2** `lrq_vld_q[4]` / `lrq_vld_q[9]` deassert; the kill arc does
  not pulse `ls_is_lrq_wakeup_iz` (there is no wakeup — the loads are
  being thrown away, not completed).
- **C3** Entry 2 continues waiting for its L2 response as before.

Corner cases: `lrq0_ld_uop_flush_d1` / `lrq1_ld_uop_flush_d1`
(`L741, L746`) are the per-LRQ in-pipe flush qualifiers used when a
pipe-local flush lands on an entry that is currently being replayed at
d0-d1; that path converges with the commit `flush` at the state's
kill input.

### §6.5 Livelock detection → buster trigger

**(UNVERIFIED: inferred from `ls_lrq_timeout_tick_tock_change_q`
input at `L65`, `trigger_mid_range_livelock_buster` at `L90`,
`oldest_ld_replay_cnt_sat` at `L1055`, and `blk_non_oldest_ld` output
at `L1057`.)**

Scenario: the oldest LRQ entry is repeatedly replayed without making
progress. Replay counter saturates; the livelock-buster asserts;
non-oldest loads are blocked to let the oldest succeed.

```
cycle:                               C0     C1     C2     C3     C4
clk:                                _‾_‾_‾_‾_‾_‾_‾_‾_‾_
ls_tick_tock_q:                     _____‾‾‾‾‾_____‾‾‾‾‾_____
ls_lrq_timeout_tick_tock_change_q:  _________‾‾____________________
oldest_ld_replay_cnt_sat:           ____________‾‾‾‾‾‾‾‾‾‾‾‾____
trigger_mid_range_livelock_buster:  ________________‾‾‾‾‾‾‾‾____
blk_non_oldest_ld:                  ________________‾‾‾‾‾‾‾‾‾‾‾‾
lrq_oldest_uid:                     <UID_O  >  <UID_O  >  <UID_O  >
lrq_oldest_vld:                     ‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾
lrq_entry0_state_q:                 <IN_PIPE ><IN_PIPE ><IN_PIPE ><L2RESP_M4><RDY>
```

Per-cycle walkthrough:

- **C0-C1** `ls_tick_tock_q` toggles (`L66`); oldest entry 0 keeps
  being re-picked by d0 arb but is bounced (e.g. by
  `ls0_ld_l1_miss_wait_on_fb_d3` without progress).
- **C2** Tick-tock change detected without oldest-load retirement —
  `ls_lrq_timeout_tick_tock_change_q` pulses (`L65`).
- **C3** Replay-counter saturates: `oldest_ld_replay_cnt_sat=1`
  (`L1055`). The LRQ asserts `blk_non_oldest_ld=1` (`L1057`) and
  receives `trigger_mid_range_livelock_buster=1` (`L90`) from the
  upstream livelock detector. With non-oldest loads now blocked the
  oldest entry finally gets the needed resource.
- **C4** Oldest completes (`L2RESP_M4` → `RDY`); the replay-counter
  resets next cycle; `blk_non_oldest_ld` drops.

Note: the entire livelock scheme relies on the tick-tock counter as a
progress witness; `ls_disable_lrq_wait_l2resp_timeout=0` must hold for
the timeout branch to fire (`L45`). This waveform is the "live-lock
buster" path, not the pure L2-response timeout path.

### §6.6 LRQ full → back-pressure on allocation

**(UNVERIFIED: inferred from `lrq_full=&lrq_vld_qual` at
`perseus_ls_lrq.sv:L7478` and allocator can-alloc logic at
`L4068-L4080`.)**

> Ordering-signal framing: the "who wins the last free slot" pick
> when only 1 entry is free is produced by the same pairwise
> comparator farm at `perseus_ls_lrq.sv:L4636-L5038` as §6.2; the
> spec-intent `age_matrix(16)` is not instantiated in this RTL
> snapshot.

Scenario: 15 entries live, one free slot; three pipes present valid
loads. Only one gets an LRQ id; the other two are back-pressured; then
an entry retires and `lrq_full` drops.

```
cycle:                     C0      C1      C2      C3      C4
clk:                      _‾_‾_‾_‾_‾_‾_‾_‾_
lrq_vld_q (popcount):     15       15      16      16      15
lrq_full:                 ________________‾‾‾‾‾‾‾‾‾‾‾‾____
ld_val_ls{0,1,2}_a2_q:    ‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾
ls0_ld_alloc_lrq_entry_a2:________‾‾‾‾____________________    (oldest of three wins)
ls1_ld_alloc_lrq_entry_a2:________________________________    (back-pressured)
ls2_ld_alloc_lrq_entry_a2:________________________________    (back-pressured)
block_ls_1 / block_ls_2:  ________‾‾‾‾‾‾‾‾‾‾‾‾________        (upstream re-issue block)
lrq_entry6_state_q:       <WAIT_L2RESP><L2RESP_M4><WAIT_FB><RDY>
lrq_vld_q[6]:             ‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾______
```

Per-cycle walkthrough:

- **C0** 15 entries live, 1 free. `lrq_full=0` (not all bits set).
- **C1** Three loads valid at a2. The pairwise comparator farm
  selects the oldest — say ls0 — which gets the last free entry. Its
  `ls0_ld_alloc_lrq_entry_a2=1` fires. `ls1`/`ls2` grants stay low
  because the can-alloc logic at `L4068-L4080` evaluates
  `lrq_more_than_one_avail = 0`. Upstream sees `block_ls_1` and
  `block_ls_2` drive high to re-issue them next cycle (`L74-L75`).
- **C2** `lrq_vld_q` is all-16; `lrq_full=&lrq_vld_qual` (`L7478`)
  goes high. No alloc grants can fire on any pipe regardless of valid
  state.
- **C3** Entry 6 transitions `L2RESP_M4 → WAIT_FB → RDY`.
- **C4** `lrq_vld_q[6]` deasserts; `lrq_full` drops; ls1/ls2 (whose
  upstream re-issue is still live) can now alloc in a later cycle.

Interaction with §6.2: the same 48+3 pairwise comparator farm that
picks the *winners* in a 3-way concurrent alloc is reused here to
pick the *single* allocator when only one slot is free.

### §6.7 DVM / `va_region_clear` invalidate

**(UNVERIFIED: inferred from `va_region_clear_v/id` at `L109-L110`,
per-entry VA-region match inputs at `L349-L350`, and
`tofu_oldest_ld_delay_dvm_sync` at `L101`.)**

Scenario: a DVM TLBI broadcast arrives carrying a VA-region id; every
LRQ entry whose captured region-id matches is invalidated and
re-enters `RDY`; oldest loads that cannot be simply dropped delay the
DVM sync handshake.

```
cycle:                           C0      C1      C2      C3      C4
clk:                            _‾_‾_‾_‾_‾_‾_‾_‾_
va_region_clear_v:              ____‾‾__________________________
va_region_clear_id:             ____<=RID>_______________________
lrq_entry1_state_q:             <WAIT_STDATA><WAIT_STDATA><RDY>   (region matches → killed)
lrq_entry5_state_q:             <WAIT_L2RESP><WAIT_L2RESP><L2RESP_M4><WAIT_FB><RDY>  (no match → kept)
lrq_entry8_state_q:             <IN_PIPE    ><IN_PIPE    ><RDY>   (region matches → killed)
lrq_vld_q[1]:                   ‾‾‾‾‾‾‾‾____________________
lrq_vld_q[5]:                   ‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾____
lrq_vld_q[8]:                   ‾‾‾‾‾‾‾‾____________________
tofu_oldest_ld_delay_dvm_sync:  ____‾‾‾‾‾‾‾‾________________   (entry5 is oldest — delay DVM sync)
ls_is_lrq_wakeup_iz:            ________________________________
```

Per-cycle walkthrough:

- **C0** Three entries live in various states. DVM subsystem asserts
  `va_region_clear_v=1` with `va_region_clear_id=RID` (`L109-L110`).
  Each entry captured its own `ls{i}_region_va_match_id_v_a2` and
  `_id_a2` at alloc (`L349-L350` for ls0 mirrored for ls1/ls2); the
  per-entry match compares stored id vs broadcast id.
- **C1** Entries 1 and 8 match — their FSMs take the region-clear
  kill arc to `RDY`. Entry 5 does not match and stays in
  `WAIT_L2RESP`.
- **C2** The kill transitions complete. Because entry 5 (the oldest
  load) was not killed and is still outstanding, the LRQ asserts
  `tofu_oldest_ld_delay_dvm_sync=1` (`L101`) so the DVM handshake
  upstream waits for the oldest-load to finish before acknowledging
  the TLBI.
- **C3-C4** Entry 5 eventually gets its L2 response and retires;
  `tofu_oldest_ld_delay_dvm_sync` drops; DVM sync completes.

Note: the kill arc does **not** pulse `ls_is_lrq_wakeup_iz` — the
invalidated loads are re-issued by the scheduler when re-fetched
after the TLBI, not woken in place.

---

<!-- §9 onwards deferred to Tasks 16-18 (Gates 15-17). Do not fill here. -->

## §7 时钟复位 (Clock & Reset)

> Scope per Gate 14 plan: the top-level functional clock `clk`, the
> async active-high `reset_i`, the LRQ single request-conditional
> clock-gate (RCG) domain `clk_lrq_entry` that fans out to all 16
> `ls_lrq_entry` children, and the two reset patterns used inside
> `perseus_ls_lrq.sv`. Per-entry FSM reset details (the precise set of
> state flops inside `ls_lrq_entry` that clear to `RDY`) are the
> concern of Gate 16 (§10 of this doc) and are only sketched here.
> Every assertion below cites an RTL line.

### §7.1 Clock tree (two domains visible inside `ls_lrq`)

| Clock | Source | Gating predicate | Gated-flop population | RTL witness |
|-------|--------|------------------|------------------------|-------------|
| `clk` | top-level LSU clock (module port `L30`) | none (free-running inside the module) | every `always_ff @(posedge clk …)` — the 196 always blocks outside the per-entry generate include the ~170 non-entry state flops: `lrq_has_nc_dev_ld_q`, `l2_ls_spec_*_m3_q`, `ls_is_lrq_wakeup_iz`, `disable_lrqN_pick_pre_q`, `ls0/1/2_ld_fast_byp_lrqN_a3_q`, the 16-deep `older_than_entryN_q` per-entry bit-vector, etc. | e.g. `L3784`, `L3852`, `L4034`, `L4274`, `L25086` |
| `clk_lrq_entry` | ICG `u_clk_lrq` (`perseus_cell_clkgate`) at `L25101-L25106` | `lrq_entry_rcg_en = chka_disable_ls_rcg \| (\|lrq_vld_qual) \| lrq_alloc_possible_a1 \| lrq_alloc_possible_a2` (`L25080-L25083`) then registered one cycle through `lrq_entry_rcg_en_q` (`L25086-L25098`) | **all 16 `ls_lrq_entry` instance clocks** — `lrq_entry_clk[0..15]`, fed from `clk_lrq_entry` at `L25110-L25125` | gate instance `L25101-L25106`; entry-clock fanout `L25110-L25125` |

**Clock-gate reference block (full quote).**

```systemverilog
// file:perseus_ls_lrq.sv:L25080-L25106
  assign lrq_entry_rcg_en  = chka_disable_ls_rcg |
                          (|lrq_vld_qual[`PERSEUS_LS_LRQ_RANGE]) |
                          (lrq_alloc_possible_a1 | lrq_alloc_possible_a2)  ;


  always_ff @(posedge clk or posedge reset_i)
  begin: u_lrq_entry_rcg_en_q
    if (reset_i == 1'b1)
      lrq_entry_rcg_en_q <= `PERSEUS_DFF_DELAY {1{1'b0}};
`ifdef PERSEUS_XPROP_FLOP
    else if (reset_i == 1'b0)
      lrq_entry_rcg_en_q <= `PERSEUS_DFF_DELAY lrq_entry_rcg_en;
    else
      lrq_entry_rcg_en_q <= `PERSEUS_DFF_DELAY {1{1'bx}};
`else
    else
      lrq_entry_rcg_en_q <= `PERSEUS_DFF_DELAY lrq_entry_rcg_en;
`endif
  end


 perseus_cell_clkgate u_clk_lrq (
        .dftcgen          (cb_dftcgen),
        .clk         (clk),
        .enable_i  (lrq_entry_rcg_en_q),
        .clk_gated   (clk_lrq_entry)
 );
```

- **What.** A single ICG gates the clock to *all 16* LRQ entries
  uniformly. The gate opens only when (a) at least one entry is
  already occupied (`|lrq_vld_qual`), or (b) an alloc candidate exists
  in pipe a1 or a2 (`lrq_alloc_possible_a1/a2` — set if any of
  `issue_v_lsN_ld_aX_q` is asserted — defined at the top of the
  `lrq_alloc_possible_*` assignments around `L25070-L25077`), or
  (c) the global RCG-disable chicken bit is asserted.
- **How.** The raw enable is first registered through
  `lrq_entry_rcg_en_q` (`L25086-L25098`). The registered enable is
  then handed to `perseus_cell_clkgate u_clk_lrq` (standard latch-AND
  ICG) together with `clk` and `cb_dftcgen`. `clk_lrq_entry` fans out
  to all 16 `lrq_entry_clk[n]` nets (`L25110-L25125`), which in turn
  become the `clk` port of every `perseus_ls_lrq_entry` instance.
- **Why.** An empty, idle LRQ with no pending alloc is the
  clock-power common case between load bursts; gating all 16 entries
  at once saves the entire per-entry flop power budget in that state.
  A single RCG (vs one per entry) is correct because the entry-array
  is indexed — reads are combinational off `_q`, so any individual
  entry's stored state is unaffected by the collective gate, and the
  alloc-write cycles necessarily assert `lrq_alloc_possible_aN` one
  cycle ahead (the pipelined `_en_q` register matches the write
  latency). Compared to per-entry ICGs this saves 15 clock-gates and
  avoids the staircase-of-gates timing risk on the entry-clock skew.
- **Contrast with `ls_tlb`.** `ls_tlb` splits its functional flops
  across *four* ICGs (three per-pipe `clk_a2_flops_lsN_a1` +
  `clk_tlb_flops`) because the TLB has distinct per-pipe-stage and
  per-entry write populations. LRQ has no per-pipe entry writes (all
  allocs write into the same indexed entry array) and therefore needs
  only one gate.

### §7.2 Reset strategy

`ls_lrq` uses **async-assert / sync-deassert active-high reset**
uniformly, consistent with ARM-N2 RTL conventions. The reset input is
module port `reset_i` (`L37`). There is no power-on-reset `poreset`
port declared on this module (search for `poreset` in ports returns
zero hits) — the top-level LSU's power-on sequence is expressed
through `reset_i` held high for the required cycle count, as is
standard for this RTL family.

Two flop patterns coexist:

**Pattern A — async-reset flops (control state must be deterministic
after reset).**
```systemverilog
// file:perseus_ls_lrq.sv:L3784-L3797 (representative: first always_ff in the module body)
  always_ff @(posedge clk or posedge reset_i)
  begin: u_disable_lrq1_pick_pre_q
    if (reset_i == 1'b1)
      disable_lrq1_pick_pre_q <= `PERSEUS_DFF_DELAY {1{1'b0}};
`ifdef PERSEUS_XPROP_FLOP
    else if (reset_i == 1'b0)
      disable_lrq1_pick_pre_q <= `PERSEUS_DFF_DELAY disable_lrq1_pick_nxt;
    else
      disable_lrq1_pick_pre_q <= `PERSEUS_DFF_DELAY {1{1'bx}};
`else
    else
      disable_lrq1_pick_pre_q <= `PERSEUS_DFF_DELAY disable_lrq1_pick_nxt;
`endif
  end
```
Pattern A is the dominant pattern in `ls_lrq`: `disable_lrqN_pick_pre_q`
(`L3784`, `L3800`), `l2_ls_spec_valid_m3_q` (`L3830`),
`ls_is_lrq_wakeup_iz` (`L3852`), `lrq_has_nc_dev_ld_q` (`L4034`),
`lrq_has_nc_dev_ld_above_threshold_q` (`L4274`),
`lrq_page_split_nc_c_vld_with_fb` (`L24242`), `lrq_entry_rcg_en_q`
(`L25086`). All such flops clear to zero on reset so the module comes
up in a "no entries valid, no broadcasts, no back-pressure" state.

**Pattern B — no-reset data flops (value undefined after reset, but
gated by a separately-reset valid bit).**
```systemverilog
// file:perseus_ls_lrq.sv:L3821-L3825 (representative: ls_enable_serialize_gather_q)
  always_ff @(posedge clk)
  begin: u_ls_enable_serialize_gather_q
    ls_enable_serialize_gather_q <= `PERSEUS_DFF_DELAY ls_enable_serialize_gather;
  end
```
Pattern B applies to data-path shadow flops that are always refreshed
combinationally one cycle later and whose X-propagation out of reset
is already masked by a Pattern-A valid upstream — representative
examples are the `l2_ls_spec_*_m3_q` payload group (`L3869`,
`L3883`) qualified by the Pattern-A `l2_ls_spec_valid_m3_q`, and the
numerous `lsN_ld_fast_byp_lrqN_a3_q` payload flops (`L7667` family)
qualified by Pattern-A `lsN_ld_fast_byp_lrqN_a3_q_vld` upstream.

**Per-entry FSM reset.** The 16 LRQ entries are instantiated via
`perseus_ls_lrq_entry u_lrq_entry_N` from `L13583` (entry 0) through
`L21565` (entry 15, approximate). Each instance receives `clk`
= `lrq_entry_clk[n]` and `reset_i` = the shared `reset_i`. The
per-entry state machine clears to the `RDY` state on reset — this is
enforced *inside* `ls_lrq_entry`, not in `ls_lrq.sv`, and its
detailed RTL walkthrough belongs to Gate 16 (§10). From
`ls_lrq.sv`'s vantage the post-reset invariant is:

- `lrq_vld_q[`PERSEUS_LS_LRQ_RANGE] == 16'b0` (all entries invalid),
  observable via `lrq_vld_qual` which feeds `lrq_entry_rcg_en` and
  `lrq_full` (`L7478`: `lrq_full = &lrq_vld_qual`).
- `ls_is_lrq_wakeup_iz = 1'b0` (no wake-up broadcast in flight,
  `L3854`).
- `lrq_has_nc_dev_ld_q = 1'b0` (no NC/device load in the queue,
  `L4036`).
- `disable_lrq0/1_pick_pre_q = 1'b0` (LRQ can arbitrate for the
  re-issue d0 slot, `L3786`, `L3802`).

These invariants together mean that after reset the module is in a
quiescent state where `lrq_entry_rcg_en = chka_disable_ls_rcg` (both
`lrq_vld_qual` and `lrq_alloc_possible_a1/a2` are zero), so the
entry-clock is gated off until the first alloc-capable issue reaches
a1.

### §7.3 Ordering-state reset — spec-intent vs RTL snapshot

Chapter §6 and the shared primitive `[ls_age_matrix](../shared_primitives/ls_age_matrix.md)` (instantiated
conceptually as `age_matrix(N=16)`) describe LRQ age-ordering as a
16×16 antisymmetric bit matrix whose "oldest entry" is a row that is
all-zero AND whose column is all-one. The matrix model makes "reset
to all-zero" a meaningful statement about the ordering state.

The RTL does **not** realise this as a monolithic `age_matrix_q`
array; instead, as §6.2 already documented, each LRQ entry owns a
16-bit vector `older_than_entryN_q[15:0]` whose update is driven by:

- **48 instantiations of `perseus_ls_age_older_eq_compare`** at
  `L4636-L5012` — one pairwise compare per `(entry_i, lsN_alloc)`
  for `entry_i ∈ 0..15` and `lsN ∈ {ls0, ls1, ls2}`. These are
  **purely combinational** — each instance has `uid_a`, `uid_b`,
  and output `a_equal_older_than_b`.
- **3 instantiations of `perseus_ls_age_compare`** at
  `L5026-L5038` — pairwise `ls1_alloc_older_than_ls0`,
  `ls1_alloc_older_than_ls2`, `ls2_alloc_older_than_ls0`. Also
  combinational.
- Plus the **per-entry bit flops** `older_than_entryN_q[k]` — these
  *are* the sequential ordering state. They are inside
  `ls_lrq_entry` (Gate 16 detail).

| Layer | Reset semantics in spec-intent (`age_matrix(16)`) | Reset semantics in RTL snapshot |
|---|---|---|
| Pairwise comparator farm (48+3) | Not a state — the matrix model has no comparator instance concept | 51 **combinational** cells; **nothing to reset** (no state) |
| Per-entry ordering vector | Matrix rows = initial all-zero after reset; derived from "no entries valid" | `older_than_entryN_q[15:0]` flops reside in `ls_lrq_entry` (Gate 16); on reset `lrq_vld_q[n]=0` so their contents are **don't-care** |
| Effective oldest signal `lrq_entry_oldest[15:0]` (`L3193`) | Derived from matrix-row-all-zero AND column-all-one | Combinational derivation from `older_than_entryN_q & lrq_vld_q` — with `lrq_vld_q=0` after reset, `lrq_entry_oldest=16'b0` ⇒ `lrq_overall_oldest_vld=0` (`L22924`). No explicit reset needed. |

**Key insight.** Because the ordering state is keyed off `lrq_vld_q`
(`L22876-L22892` gates every per-entry `uid` and `rid` select by
`lrq_entry_oldest`, which in turn is masked by valid), the
ordering-state "reset" is *implicit*: as long as `lrq_vld_q` is
cleared to zero, any residual garbage in `older_than_entryN_q` is
ignored by every downstream consumer. This matches the
shared-primitive `[ls_age_matrix §4.2](../shared_primitives/ls_age_matrix.md)` observation that
the caller contract is "valid-qualified reads only"; LRQ satisfies
that contract by construction.

### §7.4 DFT path

`cb_dftcgen` (`L34` port, `L25104` consumer) and `cb_dftramhold`
(`L34` port) are declared at the module boundary. `cb_dftcgen` is
wired into `u_clk_lrq`'s `.dftcgen` pin (`L25104`) so that during
scan the clock gate is held transparent (`clk_gated=clk`), making
all LRQ entry flops observable. `cb_dftramhold` has no functional
`always` references inside `perseus_ls_lrq.sv` itself — identical
to the `ls_tlb` pattern documented in Gate 9 §7.3, the signal is
consumed inside downstream RAM-surrogate primitives. `(UNVERIFIED:
inferred from zero grep hits for cb_dftramhold outside the port
declaration; exact consumer is in `ls_lrq_entry` or further
downstream, to be confirmed in Gate 16 / Gate 17.)`

### §7.5 Summary — reset matrix

| Element | Clock | Reset | Update enable |
|---|---|---|---|
| `disable_lrq0/1_pick_pre_q` (`L3784`, `L3800`) | `clk` | async `reset_i → 1'b0` | always enabled (free-running combinational input) |
| `l2_ls_spec_valid_m3_q` (`L3830`) | `clk` | async `reset_i → 1'b0` | always enabled |
| `ls_is_lrq_wakeup_iz` (`L3852`) | `clk` | async `reset_i → 1'b0` | always enabled — input is `ls_is_lrq_wakeup_iz_din` computed at `L3846` |
| `lrq_has_nc_dev_ld_q` (`L4034`) | `clk` | async `reset_i → 1'b0` | `favor_iq1_en` qualifier (`L4039`) |
| `lrq_has_nc_dev_ld_above_threshold_q` (`L4274`) | `clk` | async `reset_i → 1'b0` | `ld_can_alloc_when_nc_dev_in_lrq_en` qualifier (`L4279`) |
| `lrq_entry_rcg_en_q` (`L25086`) | `clk` | async `reset_i → 1'b0` | always enabled |
| 16× `lrq_vld_q` (inside `ls_lrq_entry`) | `lrq_entry_clk[n]` | async `reset_i → 1'b0` (forced by entry reset arc, Gate 16) | alloc / clear / fill arcs inside entry FSM |
| 16× `older_than_entryN_q[15:0]` (inside `ls_lrq_entry`) | `lrq_entry_clk[n]` | no explicit reset needed — implicit via `lrq_vld_q=0` gating | driven by `older_than_entryN_din` mux at `L5046-L5068+` (per bit k in entry N) |
| Per-entry data payload flops (uid, rid, va_region_id, …, inside `ls_lrq_entry`) | `lrq_entry_clk[n]` | none (data) | per-entry alloc write enable |

---

## §8 关键电路 (Key Circuits)

> Scope: **11 layers** of combinational + sequential logic that
> realise the 16-entry Load Re-issue Queue. Each layer follows the
> R2 + R4 format: **Purpose / RTL excerpt / Line-by-line / Design
> rationale**. Where the natural block is too long (e.g. `case`
> statements), we quote the skeleton with `...` for non-essential
> rows per R2. Per-entry FSM internals (next-state logic, the full
> transition table) are Gate 16 scope; this section describes the
> *module-level* glue that surrounds every entry and the
> shared-across-entries logic.

### §8.1 Allocation arbitration — 3-way concurrent ls0/ls1/ls2

**Purpose.** In a single cycle up to three loads in pipes ls0/ls1/ls2
may request an LRQ slot. This layer (i) decides whether enough slots
exist (`lrq_{one,two,three}_can_alloc_aN`), (ii) distributes up to
three free-slot one-hots to the three pipes (`lsN_entry_alloc_reg_dec_a2`),
and (iii) commits the winners (`lsN_ld_alloc_lrq_entry_a2`).

**RTL excerpt (availability-pool split, skeleton).**

```systemverilog
// file:perseus_ls_lrq.sv:L7497-L7504 (combinational per-pipe alloc one-hot decode)
   assign ls0_entry_alloc_reg_dec_a2[`PERSEUS_LS_LRQ_RANGE] = lrq_avail_low[`PERSEUS_LS_LRQ_RANGE]  & {16{ls0_can_alloc_a2 & ~ls0_early_no_alloc}};
   assign ls1_entry_alloc_reg_dec_a2[`PERSEUS_LS_LRQ_RANGE] = lrq_avail_high[`PERSEUS_LS_LRQ_RANGE] & {16{ls1_can_alloc_a2 & ~ls1_early_no_alloc}};
   assign ls2_entry_alloc_reg_dec_a2[`PERSEUS_LS_LRQ_RANGE] = lrq_avail_2low[`PERSEUS_LS_LRQ_RANGE] & {16{ls2_can_alloc_a2 & ~ls2_early_no_alloc}};

  assign ls0_entry_alloc_dec_a2[`PERSEUS_LS_LRQ_RANGE]  = ls0_entry_alloc_reg_dec_a2[`PERSEUS_LS_LRQ_RANGE];
  assign ls1_entry_alloc_dec_a2[`PERSEUS_LS_LRQ_RANGE]  = ls1_entry_alloc_reg_dec_a2[`PERSEUS_LS_LRQ_RANGE];
  assign ls2_entry_alloc_dec_a2[`PERSEUS_LS_LRQ_RANGE]  = ls2_entry_alloc_reg_dec_a2[`PERSEUS_LS_LRQ_RANGE];
```

**Upstream availability-pool derivation (quoted skeleton).**

```systemverilog
// file:perseus_ls_lrq.sv:L7288-L7301 (availability priority-encoder, first-free-slot from bottom)
   assign lrq_avail_low_qual[0] = ~lrq_vld_qual_nxt[0];
   assign lrq_avail_low_qual[1] =  ~lrq_vld_qual_nxt[1] & (&lrq_vld_qual_nxt[0:0]);
   assign lrq_avail_low_qual[2] =  ~lrq_vld_qual_nxt[2] & (&lrq_vld_qual_nxt[1:0]);
   // ... lrq_avail_low_qual[3..15] identical prefix-AND pattern
```

**Line-by-line.**

- `lrq_vld_qual_nxt` is the per-entry valid bit adjusted for
  in-flight early-clears (`early_clr_en`, `L4622-L4624`) so that
  `ls{0,1,2}` see the *post-clear* free slots rather than the raw
  `lrq_vld_q` flops. The `& (&lrq_vld_qual_nxt[k-1:0])` prefix-AND
  picks the lowest free slot for ls0 (`lrq_avail_low`), the highest
  free slot for ls1 (`lrq_avail_high`, mirrored priority), and the
  second-lowest for ls2 (`lrq_avail_2low`).
- Each per-pipe decode is then masked by `lsN_can_alloc_a2` (which
  folds in `lrq_full`, the multi-count predicates `lrq_more_than_*_avail`
  at `L7472-L7476`, plus pipe-specific `early_no_alloc` cases).
- `lrq_vld_cnt[4:0]` (`L7459-L7464`) sums four 4-bit slot-group
  populations (see §8.8) to derive the multi-count predicates.

**Design rationale.**

- **Three disjoint pools (low / high / 2low)** guarantee that the
  three pipes *cannot* collide on the same free slot even with a
  single-bit AND mask — avoiding the need for a centralised
  round-robin arbiter. This removes one combinational critical path
  layer between "need to alloc" and "commit entry one-hot".
- **`lrq_vld_qual_nxt` (post-early-clear) rather than `lrq_vld_q`**:
  a load that resolves in a3/a4 (`early_clr_en`, see §6.6) vacates
  its slot one cycle before the flop clears; allocators see the slot
  as available in the same cycle so back-pressure stalls are avoided.
- **Why three concurrent allocs**: Perseus is a 3-issue load pipeline
  with independent ls0/ls1/ls2 issue queues (per §1 of this
  document). Sequential-alloc would cap LRQ throughput at one
  load/cycle and throttle the L2 miss bandwidth. A per-pipe pool is
  the cheapest way to allow lockstep throughput.

### §8.2 Per-entry FSM transition glue (module-level)

**Purpose.** From the `ls_lrq.sv` vantage, the 16 `ls_lrq_entry`
instances each expose their next-state arcs through (i) alloc inputs
(`lsN_entry_alloc_dec_a2[n]`), (ii) clear outputs
(`lrq_entry_clr[n]`), (iii) L2-response inputs (demuxed in §8.3),
(iv) flush inputs (§8.10), (v) DVM region-clear inputs (§8.9), and
(vi) the per-entry VA-region capture assignments. This layer
aggregates the alloc-write path and the "any clear" OR reduction.

**RTL excerpt (alloc-write pre-stage + any-clear OR).**

```systemverilog
// file:perseus_ls_lrq.sv:L3828-L3829 (any-entry-clear reduction)
  assign lrq_any_clr = (|lrq_entry_clr[`PERSEUS_LS_LRQ_RANGE] );
```

```systemverilog
// file:perseus_ls_lrq.sv:L7513-L7515 (alloc-write enable into entries)
   assign alloc_lrq_en = issue_v_ls0_ld_a2 | ls0_ld_alloc_lrq_entry_a3_q |
                         issue_v_ls1_ld_a2 | ls1_ld_alloc_lrq_entry_a3_q |
                         issue_v_ls2_ld_a2 | ls2_ld_alloc_lrq_entry_a3_q ;
```

```systemverilog
// file:perseus_ls_lrq.sv:L9057-L9063 (VA-region capture mux into entry 0; identical pattern for entries 1..15)
   assign lrq_entry0_va_region_id[`PERSEUS_LS_VA_REGION_ID_R] =  ({3{ls0_entry_alloc_reg_dec_a2[0]}}     &       ls0_region_va_match_id_a2[`PERSEUS_LS_VA_REGION_ID_R]) |
                                                                ({3{ls1_entry_alloc_reg_dec_a2[0]}}     &       ls1_region_va_match_id_a2[`PERSEUS_LS_VA_REGION_ID_R]) |
                                                                ({3{ls2_entry_alloc_reg_dec_a2[0]}}     &       ls2_region_va_match_id_a2[`PERSEUS_LS_VA_REGION_ID_R]) ;

   assign lrq_entry0_va_region_id_v                        =  (ls0_entry_alloc_reg_dec_a2[0]     &       ls0_region_va_match_id_v_a2) |
                                                                (ls1_entry_alloc_reg_dec_a2[0]     &       ls1_region_va_match_id_v_a2) |
                                                                (ls2_entry_alloc_reg_dec_a2[0]     &       ls2_region_va_match_id_v_a2) ;
```

**Line-by-line.**

- `lrq_any_clr` is the OR of all 16 `lrq_entry_clr[n]` — any entry
  transitioning to the `RDY` state on this cycle. It feeds back-pressure
  (see §8.8) and the ordering-state update predicates.
- `alloc_lrq_en` is the OR of the 3-pipe a2 issues plus a3-held
  replays (`lsN_ld_alloc_lrq_entry_a3_q`). It is the global "some
  entry will be written this cycle" gate and is used by fast-bypass
  and the `lrq_vld_qual_nxt` early-commit path (§6.6).
- The per-entry VA-region capture is a 3-to-1 mux keyed by which
  pipe won this entry's alloc one-hot — identical pattern repeats
  at `L9057-L9063`, `L9231-L9237`, ... for entries 1..15. Similar
  muxes exist for `uid`, `rid`, `va`, `fb_ptr`, NC/device type,
  unalign tags, page-split, etc. (see §5 port table).

**Design rationale.**

- **OR-reduced `lrq_any_clr` on the far side.** Each entry computes
  its own clear arc internally; the module only needs the OR for
  the shared ordering-update and back-pressure consumers — avoiding
  16 parallel wires to every consumer.
- **3-way OR mux for captured attributes** is cheaper than routing
  `ls_{sel}_region_va_match_id_a2` through a tri-state / priority
  selector: because the three `lsN_entry_alloc_reg_dec_a2[n]` bits
  are guaranteed mutually exclusive for a given entry (§8.1),
  the OR-mux is correct.
- Detailed entry FSM next-state logic (RDY → WAIT_STDATA →
  WAIT_L2RESP → L2RESP_M4 → WAIT_FB → RDY, §6.3) is inside
  `ls_lrq_entry` and belongs to Gate 16.

### §8.3 L2 response demux (m3/m4 DID match)

**Purpose.** The L2 cache returns one spec response per cycle,
carrying `l2_ls_spec_valid_m4_q`, `l2_ls_spec_id_m4_q` (the DID /
dispatch-ID), and control signals `l2_ls_spec_crit_m4_q`,
`l2_ls_rvalid_m4`, `l2_ls_spec_addr_m4_q[5]`. Every LRQ entry
records its DID at alloc time; the entry whose DID matches the
incoming `l2_ls_spec_id_m4_q` takes the response-arc
(`WAIT_L2RESP → L2RESP_M4`). This layer is the m3→m4 staging flop
group that lets entries compare one cycle later.

**RTL excerpt (m3 staging flops).**

```systemverilog
// file:perseus_ls_lrq.sv:L3830-L3842 (l2_ls_spec_valid m3 staging)
  always_ff @(posedge clk or posedge reset_i)
  begin: u_l2_ls_spec_valid_m3_q
    if (reset_i == 1'b1)
      l2_ls_spec_valid_m3_q <= `PERSEUS_DFF_DELAY {1{1'b0}};
`ifdef PERSEUS_XPROP_FLOP
    else if (reset_i == 1'b0)
      l2_ls_spec_valid_m3_q <= `PERSEUS_DFF_DELAY l2_ls_spec_valid_m2;
    else
      l2_ls_spec_valid_m3_q <= `PERSEUS_DFF_DELAY {1{1'bx}};
`else
    else
      l2_ls_spec_valid_m3_q <= `PERSEUS_DFF_DELAY l2_ls_spec_valid_m2;
`endif
  end
```

Companion flops: `l2_ls_spec_crit_m3_q` (`L3869-L3881`),
`l2_ls_spec_qw_en_m3_q[3:0]` (`L3883-L3895`). These three flops are
then passed by port into every `ls_lrq_entry` (`L13861-L13865`,
mirrored per entry). The actual DID comparison
(`l2_ls_spec_id_m4_q == entryN_did_q`) is inside the entry; this
layer only stages the shared response bus.

**Line-by-line.**

- `l2_ls_spec_valid_m2` is the incoming L2-spec-valid from m2
  (comes via `l2_ls_*` input ports at `L691-L695`).
- `l2_ls_spec_valid_m3_q` is a Pattern-A reset flop that provides
  a one-cycle delay alignment with the per-entry DID comparison
  (which happens *inside* the entry at m3 against the alloc-time
  DID, producing the m4 `L2RESP_M4` state arc).
- The `PERSEUS_XPROP_FLOP` ifdef pumps an X into the flop in
  simulation when `reset_i` is in an ambiguous state — standard
  Perseus style, used throughout.

**Design rationale.**

- **Why stage in `ls_lrq.sv` rather than inside every entry.**
  Centralising the three m3 flops in the parent saves 15× flop area
  (only 1 set of shared-bus flops instead of 16 per-entry copies)
  and equalises the arrival skew at all 16 DID comparators.
- **Reset to 1'b0** — response must not be spuriously observed out
  of reset; since the entries come up invalid, a spurious
  `valid_m3_q=0` is benign; a stuck-at-`1` would be catastrophic
  (wrong DID comparisons would wake invalid entries).
- The data-qualifying flops (`l2_ls_spec_crit_m3_q`,
  `l2_ls_spec_qw_en_m3_q`) use Pattern B (`always_ff @(posedge clk)`,
  no reset at `L3869`, `L3883`) because they are payload qualified
  by the Pattern-A `valid_m3_q` — the same two-patterns-by-role
  convention described in §7.2.

### §8.4 FB (fill-buffer) link management

**Purpose.** Each LRQ entry may be linked to a fill-buffer entry in
`ls_fb` (the outstanding L1-miss tracker). The link is stored per
entry and drives two selection paths: (i) oldest-load-without-link
(`lrq_entry_oldest_no_linked_fb`, §6.5), which selects the next
candidate to push into ls_fb; and (ii) oldest-load-*with*-link,
which drives the page-split-NC/device tracking.

**RTL excerpt (oldest-no-link final selection + page-split tracking).**

```systemverilog
// file:perseus_ls_lrq.sv:L24216-L24220 (no-linked-fb final selection mux)
 assign allow_nc_pipeline_fb_alloc = 1'b1;

 assign lrq_entry_oldest_no_linked_fb_final[`PERSEUS_LS_LRQ_RANGE] = allow_nc_pipeline_fb_alloc ?  lrq_entry_oldest_no_linked_fb_spec_vld[`PERSEUS_LS_LRQ_RANGE]  :
                                                                                                  lrq_entry_oldest_no_linked_fb_vld[`PERSEUS_LS_LRQ_RANGE]  ;
```

```systemverilog
// file:perseus_ls_lrq.sv:L22932-L22933 (has-linked-fb reductions for page-split dev tracking)
  assign lrq_dev_load_with_linked_fb_vld = |(lrq_vld_q[`PERSEUS_LS_LRQ_RANGE] &  lrq_entry_has_linked_fb[`PERSEUS_LS_LRQ_RANGE] & lrq_entry_dev_type[`PERSEUS_LS_LRQ_RANGE]);
  assign lrq_has_ld_with_linked_fb = |(lrq_vld_q[`PERSEUS_LS_LRQ_RANGE] &  lrq_entry_has_any_linked_fb[`PERSEUS_LS_LRQ_RANGE]);
```

```systemverilog
// file:perseus_ls_lrq.sv:L24237-L24253 (page-split-with-fb latched flag)
   assign lrq_page_split_nc_c_vld_with_fb_din =  (|(lrq_vld_q[`PERSEUS_LS_LRQ_RANGE] & lrq_entry_page_split_q[`PERSEUS_LS_LRQ_RANGE] & lrq_entry_unalign1_nc_type[`PERSEUS_LS_LRQ_RANGE] & lrq_entry_has_linked_fb[`PERSEUS_LS_LRQ_RANGE]) )
                                               & ~(lrq_page_split2_nc | lrq_page_split2_dev);

  always_ff @(posedge clk or posedge reset_i)
  begin: u_lrq_page_split_nc_c_vld_with_fb
    if (reset_i == 1'b1)
      lrq_page_split_nc_c_vld_with_fb <= `PERSEUS_DFF_DELAY {1{1'b0}};
`ifdef PERSEUS_XPROP_FLOP
    else if (reset_i == 1'b0)
      lrq_page_split_nc_c_vld_with_fb <= `PERSEUS_DFF_DELAY lrq_page_split_nc_c_vld_with_fb_din;
    // ... XPROP branch
```

**Line-by-line.**

- `lrq_entry_oldest_no_linked_fb_final[n]` chooses between a *spec*
  (speculative — including loads whose L2 response has been seen
  but not yet committed) and a *non-spec* pool. With
  `allow_nc_pipeline_fb_alloc = 1'b1` the spec pool is used; that
  constant is a chicken bit the RTL team left permanently enabled
  in this revision. `(UNVERIFIED: allow_nc_pipeline_fb_alloc=1'b1
  is a hard-coded literal — Gate 17 external-integration walk will
  confirm whether the alternative path is dead code in production.)`
- `lrq_dev_load_with_linked_fb_vld` is used to arbitrate FB
  retirement: a device-type load with a linked FB is ineligible
  for speculative FB deallocation (§1 feature list).
- `lrq_page_split_nc_c_vld_with_fb` is the Pattern-A flop that
  tracks whether any page-split NC-coherent load in LRQ has an
  outstanding linked FB — ingested by upstream unalign2 arbitration.

**Design rationale.**

- **Per-entry `has_linked_fb` bit + OR-reduction** is O(16) compared
  to scanning the FB side; it pushes the "am I linked?" knowledge
  into the LRQ where it is consumed. Every alloc/fill transition
  updates the bit inside `ls_lrq_entry` (Gate 16 detail).
- **Latching the page-split-with-fb flag** (rather than computing
  combinationally) provides timing relief — the combinational
  reduction path (`|(vld & page_split_q & unalign1_nc & has_linked_fb)`)
  is wide and the consumer `lrq_page_split_nc_c_vld_with_fb` is
  used one cycle downstream, so a flop is cheap.

### §8.5 Precommit UID wait logic

**Purpose.** `precommit_uid_q` (`L83`, module input) is the UID of
the oldest uop that has been pre-committed by the commit pipeline.
Each LRQ entry compares its own UID to `precommit_uid_q` to decide
whether it is eligible for abort-free L2-request re-issue. The
comparison happens inside every `ls_lrq_entry`; at the module level
only the port forwarding is visible.

**RTL excerpt (port forwarding into each entry, representative).**

```systemverilog
// file:perseus_ls_lrq.sv:L13840 (entry 0 instance; pattern repeats L14341, L14842, ... L21355 for entries 1..15)
   .precommit_uid                  (precommit_uid_q[`PERSEUS_UID]),
```

And the precommit-adjusted alloc-abort qualifier at the module
level:

```systemverilog
// file:perseus_ls_lrq.sv:L4375-L4378 (ls0 precommit-abort adjust); mirrored L4405 for ls1, L4433 for ls2
                                           & ( (~ls0_prc_abort_adjusted_ql_a2 | ls0_prc_abort_adjusted_ql_a2 & ls0_precommit_uop_a2_q)
```

**Line-by-line.**

- `precommit_uid_q` is forwarded unchanged to all 16 entries (16
  identical `.precommit_uid(precommit_uid_q)` connections — no
  per-entry masking).
- The per-pipe `lsN_prc_abort_adjusted_ql_a2` / `lsN_precommit_uop_a2_q`
  qualifier at `L4375-L4378` (ls0), `L4405-L4408` (ls1),
  `L4433-L4436` (ls2) selectively allows or blocks alloc when the
  incoming load straddles a precommit boundary: a pre-committed
  uop bypasses the abort check; a non-precommit uop whose
  surrounding group has been marked `prc_abort_adjusted_ql` is
  held off (`L4456`, `L4512`, `L4568` — the invert path).

**Design rationale.**

- **Broadcast, not pairwise compare at module level.** Forwarding
  the single `precommit_uid_q` to all entries and doing the compare
  inside each entry exploits the fact that only one entry can be
  "the" precommit boundary at a time; the per-entry compare is
  trivially narrow.
- **Separate alloc-time qualifier** at `L4375-L4436` prevents
  entries from being created whose precommit status is already
  invalid — cheaper than allocating and immediately killing.

### §8.6 Wake-up broadcast generation (`ls_is_lrq_wakeup_iz`)

**Purpose.** `ls_is_lrq_wakeup_iz` is the pulse that tells the
scheduler a re-issue slot has opened; it is what §6.1 called the
wake-up broadcast.

**RTL excerpt (complete always block + combinational input).**

```systemverilog
// file:perseus_ls_lrq.sv:L3846-L3864 (wakeup broadcast generation)
  assign ls_is_lrq_wakeup_iz_din =  (l2_ls_spec_valid_m2 & ~lrq_has_nc_dev_ld)  |
                                    (l2_ls_spec_valid_m4_q & lrq_has_nc_dev_ld) |
                                    ~(&lrq_vld_q[`PERSEUS_LS_LRQ_RANGE]);


  always_ff @(posedge clk or posedge reset_i)
  begin: u_ls_is_lrq_wakeup_iz
    if (reset_i == 1'b1)
      ls_is_lrq_wakeup_iz <= `PERSEUS_DFF_DELAY {1{1'b0}};
`ifdef PERSEUS_XPROP_FLOP
    else if (reset_i == 1'b0)
      ls_is_lrq_wakeup_iz <= `PERSEUS_DFF_DELAY ls_is_lrq_wakeup_iz_din;
    else
      ls_is_lrq_wakeup_iz <= `PERSEUS_DFF_DELAY {1{1'bx}};
`else
    else
      ls_is_lrq_wakeup_iz <= `PERSEUS_DFF_DELAY ls_is_lrq_wakeup_iz_din;
`endif
  end
```

**Line-by-line.**

- The `_din` has three OR terms:
  1. `l2_ls_spec_valid_m2 & ~lrq_has_nc_dev_ld` — a cacheable
     (non-NC/device) L2 response arrived; the corresponding
     WAIT_L2RESP entry is about to transition, so wake the
     scheduler early.
  2. `l2_ls_spec_valid_m4_q & lrq_has_nc_dev_ld` — NC/device
     response; must defer to m4 (per §5.1 timing) before waking.
  3. `~(&lrq_vld_q)` — LRQ is not full, so any outstanding a1/a2
     load will find a slot and can be re-scheduled.
- The flop is a Pattern-A async-reset flop producing the
  module-output `ls_is_lrq_wakeup_iz` one cycle later.

**Design rationale.**

- **Split cacheable-vs-NC timing**: cacheable loads have predictable
  response latency and wake at m2; NC/device loads may have side
  effects that must complete at m4 before the scheduler requeues.
  Folding both into one gate with different enable cycles saves a
  separate wake port.
- **Third term (`~full`) covers the "capacity open" case** where no
  specific L2 response has just arrived but the LRQ has free slots
  and issue-queue may still be throttled — the broadcast wakes
  issuing logic conservatively. Given this term is an OR against
  the other two, false wakes are benign (idempotent).
- **Registered output** (not combinational) — all downstream
  schedulers see a clean one-cycle pulse regardless of
  combinational fan-out from m2/m4 arrivals.

### §8.7 Livelock tick-tock / mid-range buster (port-through)

**Purpose.** ARM-N2 LSU uses a *tick-tock* livelock detector: a
global counter in the commit pipeline toggles on a programmable
period; if the oldest LRQ load does not make progress across two
tick-tock edges, a "mid-range livelock buster" asserts that forces
the LRQ to drop optimisations (speculative pick, out-of-order arb)
and serialise. From `ls_lrq.sv`'s view the relevant signals are
*module inputs* that are forwarded into every entry.

**RTL excerpt (port declarations + per-entry fanout, representative).**

```systemverilog
// file:perseus_ls_lrq.sv:L65-L66, L90 (port declarations)
  input wire                                 ls_lrq_timeout_tick_tock_change_q,
  input wire                                 ls_tick_tock_q,
  ...
  input wire                                 trigger_mid_range_livelock_buster,
```

```systemverilog
// file:perseus_ls_lrq.sv:L13598-L13599 (entry 0 connection; identical for all 16)
   .ls_lrq_timeout_tick_tock_change_q       (ls_lrq_timeout_tick_tock_change_q),
   .ls_tick_tock_q                 (ls_tick_tock_q),
```

**Line-by-line.**

- `ls_tick_tock_q` is the raw 1-bit tick-tock oscillator (toggle per
  programmable period).
- `ls_lrq_timeout_tick_tock_change_q` is the pre-computed edge signal
  (toggle-detected); forwarded because each entry already latches it
  for its own per-entry progress counter.
- `trigger_mid_range_livelock_buster` is the upstream buster enable
  — this module forwards it and also consumes it internally as the
  gating for *livelock-buster override* in ordering arbitration
  (`L4070-L4080` in the alloc-can predicates).

**Design rationale.**

- **Global tick-tock + per-entry latching** is the canonical ARM
  livelock pattern (see `ls_tlb` Gate 9 §8 for the parallel pattern
  on outstanding miss).
- **Forwarding rather than re-deriving** avoids clock-domain
  paranoia — the tick-tock counter and its edge flop live in the
  commit pipe and are single-source-of-truth.

### §8.8 LRQ-full counter + multi-avail predicates

**Purpose.** Three questions must be answered combinationally every
cycle: *is LRQ full?*, *are there ≥2 slots free?*, *are there ≥3
slots free?* These predicates gate up to three concurrent allocs in
§8.1. Rather than a 16-bit popcount-adder (slow), the RTL uses a
**four 4-bit group-popcount plus adder** tree.

**RTL excerpt (first group popcount + final sum).**

```systemverilog
// file:perseus_ls_lrq.sv:L7358-L7379 (group 0 popcount LUT: 4 bits → 3 bits)
  always_comb
  begin: u_lrq_cnt_0_vld_2_0
    case(lrq_vld_qual[3:0])
      4'b0000: lrq_cnt_0_vld[2:0] = 3'b000;
      4'b0001: lrq_cnt_0_vld[2:0] = 3'b001;
      4'b0010: lrq_cnt_0_vld[2:0] = 3'b001;
      4'b0011: lrq_cnt_0_vld[2:0] = 3'b010;
      // ... 4'b0100..4'b1110 full case table
      4'b1111: lrq_cnt_0_vld[2:0] = 3'b100;
      default: lrq_cnt_0_vld[2:0] = {3{1'bx}};
    endcase
  end
```
Identical LUTs for groups 4-7 (`L7384-L7403`), 8-11 (`L7410-L7430`),
12-15 (`L7436-L7455`).

```systemverilog
// file:perseus_ls_lrq.sv:L7459-L7478 (sum tree + predicates + lrq_full)
   assign lrq_vld_cnt[4:0]          =
                                       {{2{1'b0}}, lrq_cnt_0_vld[2:0]} +
                                       {{2{1'b0}}, lrq_cnt_4_vld[2:0]} +
                                       {{2{1'b0}}, lrq_cnt_8_vld[2:0]} +
                                       {{2{1'b0}}, lrq_cnt_12_vld[2:0]} +
                                       {5{1'b0}};

   assign lrq_more_than_one_avail   = (lrq_vld_cnt[4:0] <  5'd15);
   assign lrq_more_than_two_avail   = (lrq_vld_cnt[4:0] <  5'd14);
   assign lrq_more_than_three_avail = (lrq_vld_cnt[4:0] <  5'd13);
   assign lrq_three_avail           = (lrq_vld_cnt[4:0] == 5'd13);
   assign lrq_more_than_four_avail  = (lrq_vld_cnt[4:0] <  5'd12);
   assign lrq_four_avail            = (lrq_vld_cnt[4:0] == 5'd12);
   assign lrq_two_avail             = (lrq_vld_cnt[4:0] == 5'd14);
   assign lrq_one_avail             = (lrq_vld_cnt[4:0] == 5'd15);

   assign lrq_full                  = &lrq_vld_qual[`PERSEUS_LS_LRQ_RANGE];
```

**Line-by-line.**

- Each 4-bit group maps through a 16-entry case LUT to a 3-bit
  popcount (range 0..4). Synthesis flattens this to a small carry
  chain plus gates.
- The final sum is 4 × 3-bit + 5-bit zero-extension = 5-bit
  `lrq_vld_cnt[4:0]` in range 0..16.
- Eight one-cycle predicates are derived by magnitude comparisons
  against constants — this is the base for `lrq_one_avail`,
  `lrq_two_avail`, ..., `lrq_more_than_four_avail`.
- `lrq_full` is a parallel AND-reduction of `lrq_vld_qual`, not a
  check for `lrq_vld_cnt == 16` — this short-circuits the full-
  indication to the most critical consumer
  (`ls_is_lrq_wakeup_iz_din`, `L3848`) without waiting for the
  adder chain.

**Design rationale.**

- **Group-LUT popcount** (16-entry case per 4 bits) synthesises to
  3-level gate depth and is provably shorter than a sequential
  popcount adder.
- **Parallel `lrq_full`** avoids a carry chain on the full-signal
  critical path, which is the first gate on many back-pressure
  and wake-up paths.
- **Multiple granular predicates** (`more_than_one/two/three_avail`,
  `one/two/three/four_avail`) rather than recomputing comparisons
  at each consumer — shared comparators save synthesis area.

### §8.9 DVM / VA-region invalidate match

**Purpose.** A DVM TLBI broadcast arrives on `va_region_clear_v`
(`L109`) with a region id `va_region_clear_id[2:0]` (`L110`). Every
LRQ entry has captured its own `va_region_id[2:0]` at alloc time
(§8.2, `L9057-L9063` for entry 0). Entries whose captured id
matches the broadcast are invalidated. Additionally, the module
drives `tofu_oldest_ld_delay_dvm_sync` (`L101`) to stall the DVM
sync handshake while the oldest load is still in flight.

**RTL excerpt (tofu oldest-delay-dvm signal).**

```systemverilog
// file:perseus_ls_lrq.sv:L7283 (DVM sync delay — ct-vs-IQ oldest mismatch detection)
  assign tofu_oldest_ld_delay_dvm_sync = ct_tofu_vld_q & iq_oldest_ld_vld_a1_q & (ct_tofu_uid_q[`PERSEUS_UID] == ~iq_oldest_ld_dg_uid_a1[`PERSEUS_UID]) ;
```

**Line-by-line.**

- `ct_tofu_vld_q` = commit-tofu (top-of-flight-unit) valid; the
  commit pipe's current marker.
- `iq_oldest_ld_vld_a1_q` = issue-queue oldest-load valid at a1.
- The `==` against the *bit-inverted* `iq_oldest_ld_dg_uid_a1[PERSEUS_UID]`
  tests whether the commit pointer is sitting on a UID that is the
  complement (i.e. "not the same UID" canonical form used in Perseus
  age-compare chains) of the IQ oldest load. `(UNVERIFIED: the
  bit-inverted equality is an unusual idiom — it reads as "if CT
  is past IQ-oldest by exactly one UID generation". Semantics
  inferred from context and port naming; Gate 17 external-integration
  walk will cross-check against `ls_ct` RTL.)`
- When asserted, the signal propagates to DVM sync upstream to
  delay the sync handshake until the oldest load retires — matches
  the §6.7 waveform scenario.

**Per-entry region-clear match (ref).** Each `ls_lrq_entry` hosts
its own combinational `region_id_q == va_region_clear_id` compare
plus a `va_region_clear_v`-qualified clear arc — quoted in Gate 16.

**Design rationale.**

- **Distributed match, centralised sync-delay.** Each entry's own
  compare is narrow (3-bit) and can kill in parallel; the only
  shared output is the sync-delay signal, which observes the
  *global* state (CT vs IQ-oldest).
- **Captured `va_region_id` at alloc rather than at match time.**
  The region id is derived from the VA at translation (`ls_tlb`)
  and supplied with the load op; persisting it for the lifetime
  of the LRQ entry saves a re-lookup on every DVM broadcast.

### §8.10 ct_flush / uop_flush broadcast

**Purpose.** The commit pipe may issue a misspeculation flush
(`lsN_uop_flush_dM`) that must squash in-flight LRQ re-issue
requests. This layer decides whether a re-issue arbiter winner is
accepted or thrown out.

**RTL excerpt (lrq0/lrq1 re-issue accept predicates).**

```systemverilog
// file:perseus_ls_lrq.sv:L24544-L24562 (lrq0/lrq1 accept under flush + other squash conditions)
  assign lrq0_ld_req_accept  = ~lrq0_ld_req_v_d1_q |
                               (lrq0_ld_req_v_d1_q & lrq0_ld_false_l2_wkup_d1)  |
                               (lrq0_ld_req_v_d1_q & lrq0_ld_req_d0_older_than_d1 & ~lrq0_ld_nc_dev_unalign1_fb_fwd_vld_d1) |
                               (lrq0_ld_req_v_d1_q & lrq0_ld_uop_flush_d1)      |
                               (lrq0_won_arb_ls1_d1) |
                               (lrq0_ld_req_v_d1_q & mb_atomic_override_lrq0_unalign2_d1 ) |
                               (lrq0_won_arb_ls0_d1 & ~lrq0_ld_unalign1_d1);

  assign lrq1_ld_req_accept  = ~lrq1_ld_req_v_d1_q |
                               (lrq1_ld_req_v_d1_q & lrq1_ld_req_d0_older_than_d1 & ~lrq1_ld_nc_dev_unalign1_fb_fwd_vld_d1 ) |
                               (lrq1_ld_req_v_d1_q & lrq1_ld_false_l2_wkup_d1)    |
                               (lrq1_ld_req_v_d1_q & lrq1_ld_uop_flush_d1 ) |
                               (lrq1_ld_req_v_d1_q & rst_strex_par_rd_override_lrq1_unalign2_d1 ) |
                               (lrq1_won_arb_ls1_d1 & ~lrq1_ld_unalign1_d1);
```

**Line-by-line.**

- `lrq0_ld_req_accept` OR-combines conditions under which the d0
  request is "drained" from the d1 holding register: (i) no request
  held, (ii) held request was a false L2 wake (spurious), (iii)
  d0-is-older-than-d1 age resolution, (iv) **uop_flush — flush
  broadcast kills the request**, (v) arb-winner override across
  pipes, (vi) atomic/mb override, (vii) unalign1 age path.
- `lrq1_ld_req_accept` mirrors for lrq1 with one specialisation
  (strex parity-read override instead of mb atomic override).

**Design rationale.**

- **Squash-on-accept rather than squash-on-issue.** Because the
  flush arrives in d1 (pipelined), drain-on-accept in the same
  combinational block keeps the arbiter state machine stateless
  on flushes — no separate "flush pending" flop is required.
- **Multi-condition OR** rather than separate mux paths: all the
  listed conditions equally allow the d1 request to drain, so a
  single accept signal controls the d1→d0 re-pick decision.

### §8.11 Ordering pairwise comparator farm — the age_matrix snapshot

**Purpose.** This is the most critical layer of §8 and the one that
addresses the Gate 11/12 `LRQ-F53 UNVERIFIED` flag: how the RTL
realises the *spec-intent* 16×16 `age_matrix` model as a physical
combinational+sequential structure.

**Structural inventory (verified by grep on 2026-04-23, post-VPN).**

| Count | Primitive | RTL range | Purpose |
|---|---|---|---|
| 48 | `perseus_ls_age_older_eq_compare` | `L4636-L5012` (3 rows × 16 entries) | Compare the incoming `lsN_alloc_uid` against each of the 16 current entry UIDs (`lrq_entryN_uid_q`) — one combinational cell per (pipe ls0/1/2 × entry 0..15) pair |
| 3 | `perseus_ls_age_compare` | `L5026-L5038` | Pairwise compare among the three concurrent incoming pipes: `ls1_vs_ls0`, `ls1_vs_ls2`, `ls2_vs_ls0` |
| 1 | `perseus_ls_age_compare` | `L22912-L22916` | `u_iq_vs_lrq_age` — compare oldest LRQ entry UID against oldest IQ load UID for IQ-vs-LRQ oldest arbitration |
| (2 more) | `perseus_ls_age_compare` | `L23874`, `L24203` | `u_iq_vs_lrq_no_linked_fb_age`, `u_iq_vs_lrq_no_linked_fb_spec_age` — dedicated comparators for the no-linked-fb oldest-load selection |

**RTL excerpt A — the 48-cell allocation comparator farm (first tile).**

```systemverilog
// file:perseus_ls_lrq.sv:L4636-L4670 (entry 0 sub-tile: 3 comparators for ls0/ls1/ls2 vs entry 0)
   perseus_ls_age_older_eq_compare u_lrq_age_compare_ls0_alloc_entry0 (
      .uid_a(lrq_entry0_uid_q[`PERSEUS_UID]),
      .uid_b(ls0_ld_uid_a2_q[`PERSEUS_UID]),
      .a_equal_older_than_b(older_than_ls0_alloc_pq[0])
   );

   assign older_than_ls0_alloc[0] = (ls0_ld_uid_a2_q[`PERSEUS_UID] == lrq_entry0_uid_q[`PERSEUS_UID]) ? ls0_rid_a2_q : older_than_ls0_alloc_pq[0];

   perseus_ls_age_older_eq_compare u_lrq_age_compare_ls1_alloc_entry0 (
      .uid_a(lrq_entry0_uid_q[`PERSEUS_UID]),
      .uid_b(ls1_ld_uid_a2_q[`PERSEUS_UID]),
      .a_equal_older_than_b(older_than_ls1_alloc_pq[0])
   );

   assign older_than_ls1_alloc[0] = (ls1_ld_uid_a2_q[`PERSEUS_UID] == lrq_entry0_uid_q[`PERSEUS_UID]) ? ls1_rid_a2_q : older_than_ls1_alloc_pq[0];

   perseus_ls_age_older_eq_compare u_lrq_age_compare_ls2_alloc_entry0 (
      .uid_a(lrq_entry0_uid_q[`PERSEUS_UID]),
      .uid_b(ls2_ld_uid_a2_q[`PERSEUS_UID]),
      .a_equal_older_than_b(older_than_ls2_alloc_pq[0])
   );

   assign older_than_ls2_alloc[0] = (ls2_ld_uid_a2_q[`PERSEUS_UID] == lrq_entry0_uid_q[`PERSEUS_UID]) ? ls2_rid_a2_q : older_than_ls2_alloc_pq[0];
```
Tile structure repeats for entry 1..15 (`L4660`, `L4684`, ...,
`L5012`).

**RTL excerpt B — the 3 inter-pipe comparators.**

```systemverilog
// file:perseus_ls_lrq.sv:L5026-L5043
   perseus_ls_age_compare u_lrq_age_compare_ls1_alloc_ls0_alloc (
      .uid_a(ls1_ld_uid_a2_q[`PERSEUS_UID]),
      .uid_b(ls0_ld_uid_a2_q[`PERSEUS_UID]),
      .a_older_than_b(ls1_alloc_older_than_ls0)
   );

   perseus_ls_age_compare u_lrq_age_compare_ls1_alloc_ls2_alloc (
      .uid_a(ls1_ld_uid_a2_q[`PERSEUS_UID]),
      .uid_b(ls2_ld_uid_a2_q[`PERSEUS_UID]),
      .a_older_than_b(ls1_alloc_older_than_ls2)
   );

   perseus_ls_age_compare u_lrq_age_compare_ls2_alloc_ls0_alloc (
      .uid_a(ls2_ld_uid_a2_q[`PERSEUS_UID]),
      .uid_b(ls0_ld_uid_a2_q[`PERSEUS_UID]),
      .a_older_than_b(ls2_alloc_older_than_ls0)
   );
```

**RTL excerpt C — the per-bit update mux into `older_than_entryN_q`
(entry 0 bit 1 shown; pattern repeats for every other `(N,k)` pair).**

```systemverilog
// file:perseus_ls_lrq.sv:L5046-L5056 (update mux for older_than_entry0_din[1])
     assign older_than_entry0_din[1] = ls0_entry_alloc_reg_dec_a2[0] & ls1_entry_alloc_reg_dec_a2[1]  ?  ls1_alloc_older_than_ls0 :
                                           ls2_entry_alloc_reg_dec_a2[0] & ls1_entry_alloc_reg_dec_a2[1]  ?  ls1_alloc_older_than_ls2 :
                                           ls0_entry_alloc_reg_dec_a2[0] & ls2_entry_alloc_reg_dec_a2[1]  ?  ls2_alloc_older_than_ls0 :
                                           ls2_entry_alloc_reg_dec_a2[0] & ls0_entry_alloc_reg_dec_a2[1]  ? ~ls2_alloc_older_than_ls0 :
                                           ls0_entry_alloc_dec_a2[0]                                        ?  older_than_ls0_alloc[1] :
                                           ls1_entry_alloc_dec_a2[0]                                        ?  older_than_ls1_alloc[1] :
                                           ls2_entry_alloc_dec_a2[0]                                        ?  older_than_ls2_alloc[1] :
                                           ls0_entry_alloc_dec_a2[1]                                        ? ~older_than_ls0_alloc[0] :
                                           ls1_entry_alloc_dec_a2[1]                                        ? ~older_than_ls1_alloc[0] :
                                           ls2_entry_alloc_dec_a2[1]                                        ? ~older_than_ls2_alloc[0] :
                                                                                                                 older_than_entry0_q[1] ;
```

**Line-by-line.**

- `older_than_lsN_alloc_pq[n]` is the raw pairwise compare
  (`lrq_entryN_uid_q` older-or-equal `lsN_alloc_uid`).
- `older_than_lsN_alloc[n]` is the **UID-tiebreak-resolved** version:
  when UIDs coincide (same uop), the `lsN_rid_a2_q` (re-issue id)
  breaks the tie. This resolves the `older_eq_compare`'s
  equality case.
- The 10-way ternary update mux selects the new value of
  `older_than_entry0_q[1]`:
  - Rows 1-4 (both alloc in same cycle pair `(0,1)`): choose the
    appropriate inter-pipe comparator result
    (`lsX_alloc_older_than_lsY`).
  - Rows 5-7 (only entry 0 allocated this cycle): copy the
    alloc-vs-entry1 comparator result.
  - Rows 8-10 (only entry 1 allocated this cycle, entry 0
    already live): write the **negation** of the alloc-vs-entry0
    comparator — maintaining antisymmetry.
  - Row 11 (no alloc into either entry 0 or 1): hold the
    prior value.
- Pattern replicates for every `(N, k)` with `N ≠ k` pair — the
  total storage is 16 entries × 16 bits × 1 flop = 256 bits of
  ordering state (the antisymmetry and zero-diagonal are implicit
  in the update-mux logic).

**Addressing the Gate 11/12 `LRQ-F53 UNVERIFIED` — functional
equivalence to `age_matrix(16)`.**

The mathematical model in the shared primitive
(`[ls_age_matrix §3](../shared_primitives/ls_age_matrix.md)`) posits:

> `age[i][j] = 1` iff entry `i` is older than entry `j`. The matrix
> is antisymmetric (`age[i][j] == ~age[j][i]` for `i ≠ j`), has zero
> diagonal, and the oldest entry is the index whose row is all-zero
> and column is all-one, restricted to valid entries.

The RTL physically realises this model as:

- **Storage** — 16 × 16 = 256 ordering bits split into 16 per-entry
  16-bit vectors `older_than_entryN_q[15:0]` (flops inside
  `ls_lrq_entry`). The bit `older_than_entryN_q[k]` corresponds to
  `age_matrix[N][k]` for `k ≠ N` and is don't-care for `k = N`.
- **Antisymmetry maintenance** — for every simultaneous alloc pair
  `(N=entry_for_lsX, k=entry_for_lsY)` with `X ≠ Y`, the per-entry
  update mux writes `lsX_alloc_older_than_lsY` into `entryN_din[k]`
  *and* implicitly `~lsX_alloc_older_than_lsY` into `entryk_din[N]`
  (the mirror-image mux — rows 5-10 of the ternary above flip the
  sign via the `~older_than_lsN_alloc[0]` branches). Thus the bit
  pair `(age[N][k], age[k][N])` is updated in one cycle and the
  antisymmetry invariant is *always* preserved.
- **Zero diagonal** — never written because there is no update-mux
  row that targets `older_than_entryN_din[N]`; the `entryN_q[N]`
  bit is don't-care and ignored by `lrq_entry_oldest[n]` consumers
  which mask with `lrq_vld_q[k]` for `k ≠ n` (`L22870-L22892`).
- **Oldest derivation** — `lrq_entry_oldest[N]` is asserted iff
  `(older_than_entryN_q & lrq_vld_q) == 16'b0` for all `k ≠ N`
  (i.e. no other valid entry is older than me). This is the
  row-all-zero check — exactly the shared-primitive definition.
  The column-all-one check (`entryk is younger than every other
  valid`) is logically equivalent by antisymmetry and is not
  computed redundantly.

**Coverage argument.**

- **48 pairwise comparators = 16 rows × 3 new-alloc columns.** On
  any cycle at most three new UIDs arrive, so we need the 3-column
  result (one per pipe) against all 16 existing entries — exactly
  48 combinational comparators.
- **3 inter-pipe comparators** cover the new-entry-vs-new-entry
  case when two or three pipes alloc in the same cycle. The mutual
  ordering of the three incoming UIDs needs only 3 of the 3-choose-2
  = 3 pairs (by antisymmetry the reciprocal is the negation).
- **Combined** (48 + 3) comparators produce the 3 × 16 matrix of
  "new vs existing" and 3 × 3 antisymmetric matrix of "new vs new"
  — sufficient to update every affected row/column pair in one cycle.

**Conclusion — Gate 11/12 `LRQ-F53 UNVERIFIED` is resolved.** The
RTL structure is a faithful (and efficient) realisation of the
spec-intent `age_matrix(16)` model. The 48+3 comparator farm is
necessary and sufficient to update the antisymmetric ordering
state under worst-case 3-way concurrent alloc. The per-entry
16-bit update-mux preserves antisymmetry by construction
(negation branches) and the row-all-zero oldest-select matches
the shared-primitive definition. No spec-vs-RTL discrepancy
remains; the flag can be **resolved**.

*(Note: the two additional `perseus_ls_age_compare` instances at
`L22912`, `L23874`, `L24203` — total 3 more, bringing the module
total to 3 + 48 + 3 = 54 age comparator instances — are **not** part
of the alloc-time ordering farm but rather one-shot comparators for
(i) IQ-oldest-vs-LRQ-oldest arbitration and (ii) no-linked-fb
oldest-load selection. They do not affect the `age_matrix` coverage
argument above.)*

**Design rationale (farm vs matrix).**

- **Why not a single `age_matrix` primitive instance?** The
  shared-primitive `[ls_age_matrix](../shared_primitives/ls_age_matrix.md)`
  primitive provides a centralised update. However, LRQ needs
  *two different sources of new UIDs per cycle* (pipes-to-entries
  alloc, and precommit-UID broadcast), and the fan-in pattern
  differs per entry (one entry gets one alloc while its mirror
  entry may be unchanged). The per-entry update-mux with a farm
  of combinational comparators is the natural decomposition; a
  single centralised matrix would require the same 51 comparators
  *plus* the routing infrastructure.
- **Why `perseus_ls_age_older_eq_compare` (inclusive-older) rather
  than strict-older for the farm?** Because alloc-vs-entry can have
  UID equality (same-uop re-allocation after a kill); the `_eq` form
  returns true for equal UIDs and the downstream `rid_a2_q`
  tiebreak resolves it. The inter-pipe trio uses the strict
  `perseus_ls_age_compare` because two simultaneous allocs cannot
  share the same UID (different uops by construction) — the strict
  form saves one gate.
- **Why per-entry flops rather than matrix-wide latch?** Per-entry
  clocks are already gated by `clk_lrq_entry` (§7.1), so an empty
  LRQ burns zero ordering-flop clock power. A centralised matrix
  would need its own gate or lose the power-down advantage.

---
