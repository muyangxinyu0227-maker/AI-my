# Shared Primitive: `perseus_ls_age_matrix`

> Scope of this document: Sections §1–§3 only (Gate 3).
> §4–§8 will be authored in Task 5 (Gate 4) and Task 6 (Gate 5).

---

## §1 Positioning

**Primitive class.** `perseus_ls_age_matrix` is a parametric *age matrix* — a
microarchitectural ordering primitive that tracks the relative program age of
a fixed-size pool of entries. It is *not* a storage structure: it holds no
payload, only the younger-than/older-than binary relation among entries. Its
job is to answer "which live entry is oldest (globally, or within a
sub-group)?" in one cycle, every cycle.

**Why it is a shared primitive.** Inside the LSU, several independent
structures all need the same logical capability: allocate entries in varying
order from multiple source ports, free/retire them out of order, and at any
moment pick the oldest entry still resident (optionally restricted to entries
matching a class predicate). Rather than re-implement this relation per
structure, the LSU uses a single parameterised module and instantiates it at
the sizes each consumer needs.

**Pilot consumer (in-scope for this deep-dive).**

| Consumer    | `AM_SIZE` | Role of age matrix in the consumer                                   |
|-------------|-----------|----------------------------------------------------------------------|
| `ls_lrq`    | 16        | Load Request Queue — pick oldest load needing arbitration / replay   |

**Deferred consumers (named here, not re-verified in this task).**

| Consumer    | `AM_SIZE` | Role of age matrix in the consumer                                   |
|-------------|-----------|----------------------------------------------------------------------|
| `ls_sab`    | 24        | Store Address Buffer — oldest-store selection for commit / forward   |
| `ls_rar`    | 40        | Read-After-Read tracker — oldest outstanding load for ordering check |

(UNVERIFIED: consumer `AM_SIZE` values 24 / 40 for `ls_sab` / `ls_rar` inferred
from design spec §5.2; not re-verified against their RTL in this task — pilot
scope covers only `ls_lrq`. The `AM_SIZE=16` value for `ls_lrq` is verified at
instantiation site in Task 5 / Gate 4.)

**File under analysis.**
- Path: `perseus/logical/perseus_loadstore/verilog/perseus_ls_age_matrix.sv`
- Size: ~15 KB, 255 lines (header + pragma tail included)
- Module declaration: `perseus_ls_age_matrix.sv:L26–L54`
- Module body (storage + update + query): `perseus_ls_age_matrix.sv:L62–L248`
- `endmodule`: `perseus_ls_age_matrix.sv:L249`

**Evidence.** `perseus_ls_age_matrix.sv:L26–L54` (module header and port
list declaring the single parameter `AM_SIZE`, the `entry_v` / per-group class
masks, the four allocation source ports, and the six oldest-entry outputs).

---

## §2 Mathematical Model / Abstraction

### §2.1 What — the binary relation

Let `N = AM_SIZE` and let the entry index set be `{0, 1, …, N−1}`. The age
matrix maintains an `N×N` binary matrix `A` over this index set with the
semantics

```
A[i][j] = 1   ⇔   entry_i is strictly younger than entry_j
A[i][j] = 0   ⇔   entry_i is older-than-or-unordered-with entry_j
```

`A` is, by construction, an antisymmetric relation on live entries: for any
two simultaneously-valid entries `i ≠ j`, exactly one of `A[i][j]` and
`A[j][i]` is `1`. The diagonal `A[i][i]` is never read and not stored.

The *oldest live entry* is the index `i` such that no live entry is older
than `i`, i.e.

```
oldest(i)  ⇔  (∀ live j ≠ i :  A[i][j] = 0)      — no entry to i's "right" is older-than-i
                                ∧ (A[j][i] = 1)   — every other live entry is younger than i
```

The module also emits per-class oldest vectors (`group_a` … `group_d`,
`resp`) by masking the relation with the class predicate before reducing.

**Evidence.** The storage declaration and the oldest-query reduction together
encode exactly this relation:
- Storage of the strict upper triangle: `perseus_ls_age_matrix.sv:L62–L63`
  (`age_matrix_in`/`age_matrix_q` indexed as `[row][col]` with `col > row`).
- Oldest-query for `row = 0`: `perseus_ls_age_matrix.sv:L200` — `oldest[0]`
  asserts iff the whole first row is zero (no-one older than entry 0).
- Oldest-query for interior rows: `perseus_ls_age_matrix.sv:L219` — combines
  the "row all-zero" and "column all-one" conjuncts.
- Oldest-query for `row = N−1`: `perseus_ls_age_matrix.sv:L239` — column
  all-one suffices (there is no row to its right).

### §2.2 How — upper-triangular storage, column-by-transpose

A full `N×N` matrix would cost `N²` flops and carry redundant information.
Because `A` is antisymmetric, the module stores only the **strict upper
triangle** — `N·(N−1)/2` flops total — and derives the lower half on the
fly by transposition (taking `A[i][j]` from the stored `A[j][i]`, which the
RTL implements as `matrix_eff_col[row][z] = matrix_eff[z][row]` for `z < row`).

Update is per-row and per-column driven by allocation events:
- When source `k` allocates into `row`, the entire row `row` is rewritten
  from `src_k_entry_v_eff` (the live mask adjusted for relative age against
  the other three source ports via `src_k_older[*]`).
- When source `k` allocates into `col > row`, the cell `A[row][col]` is
  forced to `~src_k_entry_v_eff[row]` (the new entry is younger than every
  already-live entry except those simultaneously allocated and ordered older
  by the cross-port `src_k_older` hints).

Query is a two-stage combinational reduction per row: `OR` the stored row
(entries claimed to be older than me), `AND` the transposed column (entries
I am claimed to be older than), conjoin, and mask by the class predicates
(`entry_v`, `entry_needs_arb`, `entry_group_{a..d}`, `entry_awaiting_resp`)
that are folded into the `*_matrix_eff_set` / `*_matrix_eff_hold` terms
before reduction.

**Evidence.**
- Upper-triangular storage generate loop: `perseus_ls_age_matrix.sv:L132–L148`
  (the `if(col > row)` guard on `age_matrix_in`).
- Per-row flop with allocation-gated enable: `perseus_ls_age_matrix.sv:L149–L168`.
- Cross-port "which new source wins the older-than tie" muxing via
  `src_k_entry_v_eff`: `perseus_ls_age_matrix.sv:L112–L130`.
- Effective-matrix masking (fold class predicates into the relation before
  reduction): `perseus_ls_age_matrix.sv:L174–L197`.
- Column-from-transpose derivation: `perseus_ls_age_matrix.sv:L207–L215`
  and `perseus_ls_age_matrix.sv:L229–L238`.

### §2.3 Why — versus alternative ordering structures

| Ordering scheme      | Oldest query | Out-of-order free | Multi-port alloc | Storage cost           | Why rejected for LSU pools                                           |
|----------------------|--------------|-------------------|------------------|------------------------|----------------------------------------------------------------------|
| **Age matrix**       | O(1) combo   | Native            | Native (4 srcs)  | `N·(N−1)/2` flops      | Chosen — all three properties hold, no wrap edge cases               |
| FIFO head/tail ptrs  | O(1) (head)  | Not supported     | Serialised       | `2·⌈log₂N⌉` flops      | Cannot retire out of order; LRQ/SAB/RAR all retire OoO               |
| Per-entry seq number | O(N) compare | Native            | Needs shared ctr | `N·⌈log₂M⌉` flops      | Counter wrap + O(N) comparator tree; multi-alloc arbitrates counter  |
| LRU / pseudo-LRU tree| O(1) combo   | Partial           | Single writer    | `~N` flops (pLRU)      | Encodes recency of access, not allocation age; wrong semantics here  |

The age matrix is uniquely well-matched to LSU ordering pools because it
satisfies *all* of (a) constant-time oldest selection, (b) native out-of-order
release (freeing an entry just clears its row/column via `entry_v`), and
(c) native multi-source allocation (up to four sources per cycle in the
pilot instance, tie-broken by `src_k_older[*]`), at the cost of a triangular
flop storage that grows as `N²/2`.

**Evidence.** Four-source allocation fan-in: `perseus_ls_age_matrix.sv:L106–L109`
and `perseus_ls_age_matrix.sv:L137–L146`. Cross-source age tie-break via
`src0_older` … `src3_older`: `perseus_ls_age_matrix.sv:L42–L45` (port)
and `perseus_ls_age_matrix.sv:L112–L130` (use).

---

## §3 Parameterization

### §3.1 The single knob — `AM_SIZE`

The module exposes exactly one parameter:

```systemverilog
module perseus_ls_age_matrix #(parameter AM_SIZE = 4) ( … );
```

Default value `4` is the self-test / lint-friendly size; every real LSU
instantiation overrides it. There are no secondary parameters — entry width,
number of source ports (fixed at 4), and number of class groups (fixed at
`a/b/c/d` + `resp`) are hard-coded in the source.

**Evidence.** `perseus_ls_age_matrix.sv:L26`.

### §3.2 Dimensions derived from `AM_SIZE`

| Quantity                         | Formula                 | `AM_SIZE=4` | `AM_SIZE=16` | `AM_SIZE=24` | `AM_SIZE=40` |
|----------------------------------|-------------------------|-------------|--------------|--------------|--------------|
| Entry count                      | `N = AM_SIZE`           | 4           | 16           | 24           | 40           |
| Stored rows (strict upper tri.)  | `N − 1`                 | 3           | 15           | 23           | 39           |
| Stored cells in row `r`          | `N − 1 − r`             | 3, 2, 1     | 15 … 1       | 23 … 1       | 39 … 1       |
| Total stored bits                | `N·(N−1)/2`             | 6           | 120          | 276          | 780          |
| Oldest-query outputs             | 6 × `N` bits            | 24          | 96           | 144          | 240          |
| Allocation source ports          | 4 (fixed)               | 4           | 4            | 4            | 4            |
| Class-group outputs              | 4 groups + `resp` (fixed)| 5          | 5            | 5            | 5            |

**Evidence.**
- Port vectors all widthed as `[AM_SIZE-1:0]`: `perseus_ls_age_matrix.sv:L31–L52`.
- Strict-upper-triangle storage declaration driving the `N·(N−1)/2` count:
  `perseus_ls_age_matrix.sv:L62–L63` and the `if(col > row)` gate at
  `perseus_ls_age_matrix.sv:L135`.
- Six oldest-entry output vectors: `perseus_ls_age_matrix.sv:L47–L52`.

### §3.3 Instantiation sizes across the LSU

| Instance site | `AM_SIZE` | Stored bits | Status in this deep-dive            |
|---------------|-----------|-------------|-------------------------------------|
| Self-test default | 4     | 6           | Reference; not instantiated in LSU  |
| `ls_lrq`      | 16        | 120         | **In scope** — pilot consumer       |
| `ls_sab`      | 24        | 276         | Deferred (UNVERIFIED)               |
| `ls_rar`      | 40        | 780         | Deferred (UNVERIFIED)               |

(UNVERIFIED: `ls_sab` and `ls_rar` instantiation `AM_SIZE` overrides are taken
from design spec §5.2 and are not cross-checked against their RTL files in
this task, per pilot scope.)

**Evidence (param declaration site).** `perseus_ls_age_matrix.sv:L26`.

---

## §4 Ports and Interface

All vector widths are expressed in terms of the single module parameter
`AM_SIZE`, which is the entry-pool depth `N`. The `src*_older` hints are the
only fixed-width ports (4 bits each, one bit per source port).

### §4.1 Input ports

| Name                 | Width              | Direction | Role                                                                                                                    |
|----------------------|--------------------|-----------|-------------------------------------------------------------------------------------------------------------------------|
| `clk`                | `1`                | input     | Positive-edge clock for the age-matrix flops (`perseus_ls_age_matrix.sv:L28`, used at `L152`).                          |
| `reset_i`            | `1`                | input     | Asynchronous, active-high reset; clears the stored upper triangle to 0 (`perseus_ls_age_matrix.sv:L29`, used at `L154`).|
| `entry_v`            | `[AM_SIZE-1:0]`    | input     | Per-entry live/valid mask; masked into all `*_matrix_eff_hold/set` terms (`perseus_ls_age_matrix.sv:L31`, used `L176–L188`). |
| `entry_needs_arb`    | `[AM_SIZE-1:0]`    | input     | Per-entry predicate "this entry still wants to arbitrate"; gates `matrix_eff_*` for the primary `oldest_entry` cone (`perseus_ls_age_matrix.sv:L32`, used `L176–L180, L183–L187`). |
| `entry_awaiting_resp`| `[AM_SIZE-1:0]`    | input     | Per-entry predicate for the `resp_*` cone; gates `resp_matrix_eff_*` (`perseus_ls_age_matrix.sv:L33`, used `L181, L188`).|
| `entry_group_a`      | `[AM_SIZE-1:0]`    | input     | Class predicate for `group_a_oldest_entry` cone (`perseus_ls_age_matrix.sv:L34`, used `L177, L184`).                    |
| `entry_group_b`      | `[AM_SIZE-1:0]`    | input     | Class predicate for `group_b_oldest_entry` cone (`perseus_ls_age_matrix.sv:L35`, used `L178, L185`).                    |
| `entry_group_c`      | `[AM_SIZE-1:0]`    | input     | Class predicate for `group_c_oldest_entry` cone (`perseus_ls_age_matrix.sv:L36`, used `L179, L186`).                    |
| `entry_group_d`      | `[AM_SIZE-1:0]`    | input     | Class predicate for `group_d_oldest_entry` cone (`perseus_ls_age_matrix.sv:L37`, used `L180, L187`).                    |
| `src0_alloc_entry`   | `[AM_SIZE-1:0]`    | input     | 1-hot (caller contract) allocation row selected by source port 0; drives row/column update (`perseus_ls_age_matrix.sv:L38`, used `L106, L138–L139`). |
| `src1_alloc_entry`   | `[AM_SIZE-1:0]`    | input     | 1-hot allocation from source port 1 (`perseus_ls_age_matrix.sv:L39`, used `L107, L140–L141`).                           |
| `src2_alloc_entry`   | `[AM_SIZE-1:0]`    | input     | 1-hot allocation from source port 2 (`perseus_ls_age_matrix.sv:L40`, used `L108, L142–L143`).                           |
| `src3_alloc_entry`   | `[AM_SIZE-1:0]`    | input     | 1-hot allocation from source port 3 (`perseus_ls_age_matrix.sv:L41`, used `L109, L144–L145`).                           |
| `src0_older`         | `[3:0]`            | input     | Cross-port relative-age hints for source 0: bit `k` = "src0 is older than src`k`". Bits `[0]` and the diagonal are unread; bits `[1:3]` are consumed at `L113–L115` (`perseus_ls_age_matrix.sv:L42`). |
| `src1_older`         | `[3:0]`            | input     | Cross-port hints for source 1: bits `[0],[2],[3]` consumed at `L118–L120` (`perseus_ls_age_matrix.sv:L43`).              |
| `src2_older`         | `[3:0]`            | input     | Cross-port hints for source 2: bits `[0],[1],[3]` consumed at `L123–L125` (`perseus_ls_age_matrix.sv:L44`).              |
| `src3_older`         | `[3:0]`            | input     | Cross-port hints for source 3: bits `[0],[1],[2]` consumed at `L128–L130` (`perseus_ls_age_matrix.sv:L45`).              |

### §4.2 Output ports

| Name                    | Width              | Direction | Role                                                                                                                |
|-------------------------|--------------------|-----------|---------------------------------------------------------------------------------------------------------------------|
| `oldest_entry`          | `[AM_SIZE-1:0]`    | output    | 1-hot oldest among `entry_v ∧ entry_needs_arb` (`perseus_ls_age_matrix.sv:L47`, driven at `L200, L219, L239`).      |
| `group_a_oldest_entry`  | `[AM_SIZE-1:0]`    | output    | 1-hot oldest among `entry_v ∧ entry_needs_arb ∧ entry_group_a` (`perseus_ls_age_matrix.sv:L48`, driven at `L201, L220, L240`). |
| `group_b_oldest_entry`  | `[AM_SIZE-1:0]`    | output    | 1-hot oldest among `entry_v ∧ entry_needs_arb ∧ entry_group_b` (`perseus_ls_age_matrix.sv:L49`, driven at `L202, L221, L241`). |
| `group_c_oldest_entry`  | `[AM_SIZE-1:0]`    | output    | 1-hot oldest among `entry_v ∧ entry_needs_arb ∧ entry_group_c` (`perseus_ls_age_matrix.sv:L50`, driven at `L203, L222, L242`). |
| `group_d_oldest_entry`  | `[AM_SIZE-1:0]`    | output    | 1-hot oldest among `entry_v ∧ entry_needs_arb ∧ entry_group_d` (`perseus_ls_age_matrix.sv:L51`, driven at `L204, L223, L243`). |
| `resp_oldest_entry`     | `[AM_SIZE-1:0]`    | output    | 1-hot oldest among `entry_v ∧ entry_awaiting_resp` (`perseus_ls_age_matrix.sv:L52`, driven at `L205, L224, L244`). |

(UNVERIFIED: the convention that `src_k_older[k]` — the self-bit on the diagonal —
is unread is inferred from inspecting `L112–L130`: each `src_k_entry_v_eff`
only reads `src_k_older[j]` for `j ≠ k`. The RTL neither reads nor constrains
the diagonal bits, so callers MAY leave them tied to any constant without
affecting behaviour. Not cross-checked against synthesis / formal lint in this
task.)

**Evidence.** Module header and full port list: `perseus_ls_age_matrix.sv:L26–L54`.

---

## §5 Key Circuit — Layer-by-Layer Walkthrough

The datapath decomposes into five strictly pipelined (combinational or flopped)
layers. Each sub-section below gives (a) the layer's purpose in one sentence,
(b) the verbatim RTL excerpt, (c) an operational explanation of every line,
and (d) the micro-architectural "why" that justifies the chosen structure.

### §5.1 Layer 1 — Effective Valid Computation (L106–L130)

**Purpose.** Compute, *per source port k*, the mask of entries that
port `k` considers "already older than the entry I am allocating this
cycle". This mask fuses two populations: pre-existing live entries
(minus anything being re-allocated on top of them) and *other* source
ports' concurrent allocations that the cross-port hints declare older
than port `k`.

```systemverilog
// perseus_ls_age_matrix.sv:L106–L130
  assign alloc_entry[AM_SIZE-1:0] =   src0_alloc_entry[AM_SIZE-1:0]
                                    | src1_alloc_entry[AM_SIZE-1:0]
                                    | src2_alloc_entry[AM_SIZE-1:0]
                                    | src3_alloc_entry[AM_SIZE-1:0];


  assign src0_entry_v_eff[AM_SIZE-1:0] =   (entry_v[AM_SIZE-1:0] & ~alloc_entry[AM_SIZE-1:0])
                                         | ({AM_SIZE{~src0_older[1]}} & src1_alloc_entry[AM_SIZE-1:0])
                                         | ({AM_SIZE{~src0_older[2]}} & src2_alloc_entry[AM_SIZE-1:0])
                                         | ({AM_SIZE{~src0_older[3]}} & src3_alloc_entry[AM_SIZE-1:0]);

  assign src1_entry_v_eff[AM_SIZE-1:0] =   (entry_v[AM_SIZE-1:0] & ~alloc_entry[AM_SIZE-1:0])
                                         | ({AM_SIZE{~src1_older[0]}} & src0_alloc_entry[AM_SIZE-1:0])
                                         | ({AM_SIZE{~src1_older[2]}} & src2_alloc_entry[AM_SIZE-1:0])
                                         | ({AM_SIZE{~src1_older[3]}} & src3_alloc_entry[AM_SIZE-1:0]);

  assign src2_entry_v_eff[AM_SIZE-1:0] =   (entry_v[AM_SIZE-1:0] & ~alloc_entry[AM_SIZE-1:0])
                                         | ({AM_SIZE{~src2_older[0]}} & src0_alloc_entry[AM_SIZE-1:0])
                                         | ({AM_SIZE{~src2_older[1]}} & src1_alloc_entry[AM_SIZE-1:0])
                                         | ({AM_SIZE{~src2_older[3]}} & src3_alloc_entry[AM_SIZE-1:0]);

  assign src3_entry_v_eff[AM_SIZE-1:0] =   (entry_v[AM_SIZE-1:0] & ~alloc_entry[AM_SIZE-1:0])
                                         | ({AM_SIZE{~src3_older[0]}} & src0_alloc_entry[AM_SIZE-1:0])
                                         | ({AM_SIZE{~src3_older[1]}} & src1_alloc_entry[AM_SIZE-1:0])
                                         | ({AM_SIZE{~src3_older[2]}} & src2_alloc_entry[AM_SIZE-1:0]);
```

**What.** `alloc_entry` (`L106–L109`) is the OR-fold of all four
source ports' 1-hot allocation vectors — the bitmask of rows being
written this cycle from *any* port. The four `src*_entry_v_eff`
signals (`L112–L130`) then each compute a port-specific "entries older
than mine" mask: start from all currently-live entries except those
being overwritten, then add in the concurrent allocations from *other*
ports whose `src_k_older[j]` hint says port `j`'s new entry is older
than port `k`'s.

**How — pairwise consistency trick.** For each ordered pair (k,j) with
k≠j, the hint bit `src_k_older[j]` appears exactly once in `src_k_entry_v_eff`
(gating `srcj_alloc_entry` into port k's "older" set). Its complement
`src_j_older[k]` — required by the caller contract (§6) to equal
`~src_k_older[j]` — appears exactly once in `src_j_entry_v_eff` (gating
`srck_alloc_entry` into port j's "older" set). This ensures the
diagonal pair `(L113 bit[1])` vs `(L118 bit[0])`, `(L114 bit[2])` vs
`(L123 bit[0])`, … always place each cross-port allocation into
*exactly one* of the two involved `src*_entry_v_eff` masks, preserving
matrix antisymmetry across the four-way concurrent-alloc event.

**Why 4-way concurrent allocation.** The LSU issues up to four new
LRQ/SAB/RAR entries per cycle (one per pipe). The age matrix must
settle the total order among these four *and* against the already-live
pool in the same cycle, because the oldest-query consumers read
`oldest_entry` combinationally the cycle after allocation. A
centralized age counter would serialize this; the 4-way fan-in here
lets each port present its own "I am younger than these neighbours"
hint, and the pairwise-consistency invariant makes the resulting row
writes agree.

### §5.2 Layer 2 — `age_matrix_in` Combinational Update (L137–L146)

**Purpose.** For each strict-upper-triangle cell `[row][col]`, select
this cycle's new value as one of nine choices: "new entry written to
row by source k, so copy the k-th effective-valid bit at col", "new
entry written to col by source k, so force the complement", or — if
no allocation touches row or col — hold the flop value.

```systemverilog
// perseus_ls_age_matrix.sv:L137–L146
     assign age_matrix_in[row][col] =
                                      src0_alloc_entry[row] ?  src0_entry_v_eff[col]         :
                                      src0_alloc_entry[col] ? ~src0_entry_v_eff[row]         :
                                      src1_alloc_entry[row] ?  src1_entry_v_eff[col]         :
                                      src1_alloc_entry[col] ? ~src1_entry_v_eff[row]         :
                                      src2_alloc_entry[row] ?  src2_entry_v_eff[col]         :
                                      src2_alloc_entry[col] ? ~src2_entry_v_eff[row]         :
                                      src3_alloc_entry[row] ?  src3_entry_v_eff[col]         :
                                      src3_alloc_entry[col] ? ~src3_entry_v_eff[row]         :
                                                                      age_matrix_q[row][col]  ;
```

**What.** A cascade of eight ternaries selects the next-state of cell
`[row][col]` (only defined for `col > row`, per the `if(col > row)`
guard at `L135`). The nine outcomes in order of priority: (1) src0
allocates into `row` → cell := `src0_entry_v_eff[col]` meaning "my
new entry at row is younger than whatever sits at col iff col is in
port 0's older set"; (2) src0 allocates into `col` → cell :=
`~src0_entry_v_eff[row]` meaning "new entry at col is younger than
entry at row iff row is NOT in port 0's older set"; (3–4) same for
src1; (5–6) src2; (7–8) src3; (9) hold previous value.

**How — priority encoding.** The cascade is a strict priority encoder
src0 > src1 > src2 > src3 > hold. It is *safe* because the caller
contract (§6) guarantees that at most one of the four `src*_alloc_entry`
vectors has a 1 in any given bit position — so at most one of
cases (1/2), (3/4), (5/6), (7/8) can fire for any `(row, col)` cell,
and the apparent priority is operationally a parallel 4-way mux. The
remaining (row-vs-col) ambiguity within a single source is also
one-hot by contract (a source allocates into exactly one row per cycle).

**Why.** Encoding this as a priority cascade rather than an OR-reduction
is (a) strictly smaller at synthesis — 8 muxes chained beats a 9-way
OR with decode logic — and (b) matches the natural one-hot case: the
first arm that fires *is* the answer, so downstream arms are don't-cares.
The fall-through to `age_matrix_q[row][col]` on the final line
implements the row-level clock-gating contract from Layer 3: if no
source touches row or col, the flop loads its own output and nothing
observable changes.

### §5.3 Layer 3 — Flop Storage with Row Clock-Gating (L149–L168)

**Purpose.** Latch `age_matrix_in[row][*]` into `age_matrix_q[row][*]`
on the positive clock edge, but only for rows whose contents can
actually change this cycle, saving power on idle rows.

```systemverilog
// perseus_ls_age_matrix.sv:L149–L168
  assign matrix_row_en[row] = alloc_entry[row] | (|alloc_entry[AM_SIZE-1:row+1]);


  always_ff @(posedge clk or posedge reset_i)
  begin: u_age_matrix_q_row_am_size_1_row_1
    if (reset_i == 1'b1)
      age_matrix_q[row][(AM_SIZE-1):(row+1)] <= `PERSEUS_DFF_DELAY {(((AM_SIZE-1))-((row+1))+1){1'b0}};
`ifdef PERSEUS_XPROP_FLOP
    else if (reset_i == 1'b0 && matrix_row_en[row] == 1'b1)
      age_matrix_q[row][(AM_SIZE-1):(row+1)] <= `PERSEUS_DFF_DELAY age_matrix_in[row][(AM_SIZE-1):(row+1)];
    else if (reset_i == 1'b0 && matrix_row_en[row] == 1'b0)
    begin
    end
    else
      age_matrix_q[row][(AM_SIZE-1):(row+1)] <= `PERSEUS_DFF_DELAY {(((AM_SIZE-1))-((row+1))+1){1'bx}};
`else
    else if (matrix_row_en[row] == 1'b1)
      age_matrix_q[row][(AM_SIZE-1):(row+1)] <= `PERSEUS_DFF_DELAY age_matrix_in[row][(AM_SIZE-1):(row+1)];
`endif
  end
```

**What.** `matrix_row_en[row]` (L149) asserts whenever *either* the
row itself is being allocated (`alloc_entry[row]`) *or* any higher-
indexed row is being allocated (`|alloc_entry[AM_SIZE-1:row+1]`) —
the latter because allocating into column `col > row` rewrites cell
`[row][col]`, which lives in this row's flop slice. The `always_ff`
block then implements: async reset clears the slice to 0; if XPROP
guarding is enabled, a clean `row_en=1` loads `age_matrix_in`, a
clean `row_en=0` holds, and any unknown on the enable injects X into
the slice; otherwise (plain build) only the `row_en=1` case is coded,
leaving the flop implicit-hold on `row_en=0`.

**How — row-level clock-gate.** `matrix_row_en[row]` is the clock-gate
enable term: only rows with a live write requirement toggle this cycle.
The "higher-indexed" term is needed because of the upper-triangular
storage: row `r` owns cells `[r][r+1..N-1]`, and a write to column
`col` (via a source alloc hitting col) lands in `age_matrix_q[r][col]`
for every `r < col` — so every row below `col` must enable.

**Why XPROP guard.** `PERSEUS_XPROP_FLOP` switches the model from
two-state (RTL hold) to an explicit four-case: reset / enabled / held /
else→X. The else→X arm catches cases where the synthesis-intended
clock gate could glitch (enable is X); in simulation this propagates
X into `age_matrix_q` and the downstream oldest cone, surfacing the
bug as an X-prop miscompare rather than silent "same value" hold.
(UNVERIFIED: `PERSEUS_DFF_DELAY` and `PERSEUS_XPROP_FLOP` are defined
in `perseus_header.sv`/`perseus_ls_defines.sv` and not re-inspected in
this task; the explanation reflects standard Perseus convention.)

### §5.4 Layer 4 — Masked Effective Matrix (L176–L195)

**Purpose.** For each of the six oldest-entry cones (primary +
group_a..d + resp), fold that cone's class predicate into the stored
age relation, producing a per-row "which later-indexed entries are
strictly older than me, under this cone's mask?" term that the
oldest-selector (Layer 5) reduces.

```systemverilog
// perseus_ls_age_matrix.sv:L176–L195
  assign         matrix_eff_hold[row][AM_SIZE-1:row+1] = age_matrix_q[row][AM_SIZE-1:row+1] & entry_v[AM_SIZE-1:row+1] &     entry_needs_arb[AM_SIZE-1:row+1];
  assign group_a_matrix_eff_hold[row][AM_SIZE-1:row+1] = age_matrix_q[row][AM_SIZE-1:row+1] & entry_v[AM_SIZE-1:row+1] &     entry_needs_arb[AM_SIZE-1:row+1] &  entry_group_a[AM_SIZE-1:row+1];
  assign group_b_matrix_eff_hold[row][AM_SIZE-1:row+1] = age_matrix_q[row][AM_SIZE-1:row+1] & entry_v[AM_SIZE-1:row+1] &     entry_needs_arb[AM_SIZE-1:row+1] &  entry_group_b[AM_SIZE-1:row+1];
  assign group_c_matrix_eff_hold[row][AM_SIZE-1:row+1] = age_matrix_q[row][AM_SIZE-1:row+1] & entry_v[AM_SIZE-1:row+1] &     entry_needs_arb[AM_SIZE-1:row+1] &  entry_group_c[AM_SIZE-1:row+1];
  assign group_d_matrix_eff_hold[row][AM_SIZE-1:row+1] = age_matrix_q[row][AM_SIZE-1:row+1] & entry_v[AM_SIZE-1:row+1] &     entry_needs_arb[AM_SIZE-1:row+1] &  entry_group_d[AM_SIZE-1:row+1];
  assign    resp_matrix_eff_hold[row][AM_SIZE-1:row+1] = age_matrix_q[row][AM_SIZE-1:row+1] & entry_v[AM_SIZE-1:row+1] & entry_awaiting_resp[AM_SIZE-1:row+1];

  assign         matrix_eff_set[row][AM_SIZE-1:row+1] = {AM_SIZE-row-1{~entry_v[row]}} | {AM_SIZE-row-1{~entry_needs_arb[row]}};
  assign group_a_matrix_eff_set[row][AM_SIZE-1:row+1] = {AM_SIZE-row-1{~entry_v[row]}} | {AM_SIZE-row-1{~entry_needs_arb[row]}} | {AM_SIZE-row-1{~entry_group_a[row]}};
  assign group_b_matrix_eff_set[row][AM_SIZE-1:row+1] = {AM_SIZE-row-1{~entry_v[row]}} | {AM_SIZE-row-1{~entry_needs_arb[row]}} | {AM_SIZE-row-1{~entry_group_b[row]}};
  assign group_c_matrix_eff_set[row][AM_SIZE-1:row+1] = {AM_SIZE-row-1{~entry_v[row]}} | {AM_SIZE-row-1{~entry_needs_arb[row]}} | {AM_SIZE-row-1{~entry_group_c[row]}};
  assign group_d_matrix_eff_set[row][AM_SIZE-1:row+1] = {AM_SIZE-row-1{~entry_v[row]}} | {AM_SIZE-row-1{~entry_needs_arb[row]}} | {AM_SIZE-row-1{~entry_group_d[row]}};
  assign    resp_matrix_eff_set[row][AM_SIZE-1:row+1] = {AM_SIZE-row-1{~entry_v[row]}} | {AM_SIZE-row-1{~entry_awaiting_resp[row]}};

  assign         matrix_eff[row][AM_SIZE-1:row+1] =         matrix_eff_set[row][AM_SIZE-1:row+1] |         matrix_eff_hold[row][AM_SIZE-1:row+1];
  assign group_a_matrix_eff[row][AM_SIZE-1:row+1] = group_a_matrix_eff_set[row][AM_SIZE-1:row+1] | group_a_matrix_eff_hold[row][AM_SIZE-1:row+1];
  assign group_b_matrix_eff[row][AM_SIZE-1:row+1] = group_b_matrix_eff_set[row][AM_SIZE-1:row+1] | group_b_matrix_eff_hold[row][AM_SIZE-1:row+1];
  assign group_c_matrix_eff[row][AM_SIZE-1:row+1] = group_c_matrix_eff_set[row][AM_SIZE-1:row+1] | group_c_matrix_eff_hold[row][AM_SIZE-1:row+1];
  assign group_d_matrix_eff[row][AM_SIZE-1:row+1] = group_d_matrix_eff_set[row][AM_SIZE-1:row+1] | group_d_matrix_eff_hold[row][AM_SIZE-1:row+1];
  assign    resp_matrix_eff[row][AM_SIZE-1:row+1] =    resp_matrix_eff_set[row][AM_SIZE-1:row+1] |    resp_matrix_eff_hold[row][AM_SIZE-1:row+1];
```

**What — hold vs set decomposition.** For each cone X, the effective
row slice `X_matrix_eff[row][col]` is a Boolean OR of two terms:
- `X_matrix_eff_hold[row][col]` — "col is a live cone-member older
  than row" (the raw relation ANDed with col-side cone predicates);
- `X_matrix_eff_set[row][col]` — "row itself is not a cone-member,
  so force the cell to 1 (treat col as trivially older so row can
  never be oldest in this cone)".

For the primary cone (`matrix_eff`, L176/L183/L190), the cone mask is
`entry_v ∧ entry_needs_arb`. For the four class groups, an extra
`entry_group_{a..d}` bit enters both the hold (AND on col) and the
set (OR on `~group[row]`) terms. For `resp_*`, the mask is
`entry_v ∧ entry_awaiting_resp` and `needs_arb` drops out.

**How — six parallel variants.** Lines L176–L181 build the six
`_hold` terms; L183–L188 build the six `_set` terms; L190–L195 OR
them into `_eff`. Six cones × three intermediate signals × per-row
generate = the six cones run as totally independent datapath copies
from here on. There is no sharing below Layer 3.

**Why the hold/set split.** The oldest-selector at Layer 5 computes
`oldest[row] = ~|eff[row][row+1:]` & `&eff_col[row][:row-1]` — a row
of zeros AND a column of ones. The `_set` term fires the "column of
ones" discipline from the row's own side: by forcing `eff[row][col]=1`
whenever `row` is not a cone-member, the cone simply cannot select
`row` as oldest (its row-zero reduction will be falsified). This
folds the cone predicate into the relation itself rather than AND-ing
the final `oldest_entry[row]` with `cone_mask[row]`, which is equivalent
but adds a layer of gating after an already long reduction tree.

### §5.5 Layer 5 — Oldest-Entry Selector (L200–L244)

**Purpose.** Reduce each cone's effective matrix into a 1-hot
`*_oldest_entry[N]` output vector via the row-of-zeros ∧ column-of-ones
query per row.

```systemverilog
// perseus_ls_age_matrix.sv:L200–L244
  assign         oldest_entry[0] = ~(|        matrix_eff[0][AM_SIZE-1:1]);
  assign group_a_oldest_entry[0] = ~(|group_a_matrix_eff[0][AM_SIZE-1:1]);
  assign group_b_oldest_entry[0] = ~(|group_b_matrix_eff[0][AM_SIZE-1:1]);
  assign group_c_oldest_entry[0] = ~(|group_c_matrix_eff[0][AM_SIZE-1:1]);
  assign group_d_oldest_entry[0] = ~(|group_d_matrix_eff[0][AM_SIZE-1:1]);
  assign    resp_oldest_entry[0] = ~(|   resp_matrix_eff[0][AM_SIZE-1:1]);
generate
 for(row=1; row<AM_SIZE-1; row=row+1) begin : matrix_eff_inverse_row
   for(z=0; z<AM_SIZE-2; z=z+1) begin : matrix_eff_inverse_z
    if(z < row) begin : z_less_than_row
      assign         matrix_eff_col[row][z] =         matrix_eff[z][row];
      assign group_a_matrix_eff_col[row][z] = group_a_matrix_eff[z][row];
      assign group_b_matrix_eff_col[row][z] = group_b_matrix_eff[z][row];
      assign group_c_matrix_eff_col[row][z] = group_c_matrix_eff[z][row];
      assign group_d_matrix_eff_col[row][z] = group_d_matrix_eff[z][row];
      assign    resp_matrix_eff_col[row][z] =    resp_matrix_eff[z][row];
    end

   end
  assign         oldest_entry[row] = ~(|        matrix_eff[row][AM_SIZE-1:row+1]) & (&        matrix_eff_col[row][row-1:0]);
  assign group_a_oldest_entry[row] = ~(|group_a_matrix_eff[row][AM_SIZE-1:row+1]) & (&group_a_matrix_eff_col[row][row-1:0]);
  assign group_b_oldest_entry[row] = ~(|group_b_matrix_eff[row][AM_SIZE-1:row+1]) & (&group_b_matrix_eff_col[row][row-1:0]);
  assign group_c_oldest_entry[row] = ~(|group_c_matrix_eff[row][AM_SIZE-1:row+1]) & (&group_c_matrix_eff_col[row][row-1:0]);
  assign group_d_oldest_entry[row] = ~(|group_d_matrix_eff[row][AM_SIZE-1:row+1]) & (&group_d_matrix_eff_col[row][row-1:0]);
  assign    resp_oldest_entry[row] = ~(|   resp_matrix_eff[row][AM_SIZE-1:row+1]) & (&   resp_matrix_eff_col[row][row-1:0]);

 end
endgenerate

generate
 for(z=0; z<AM_SIZE-1; z=z+1) begin : matrix_eff_inverse_last_row
  assign         matrix_eff_col[AM_SIZE-1][z] =         matrix_eff[z][AM_SIZE-1];
  assign group_a_matrix_eff_col[AM_SIZE-1][z] = group_a_matrix_eff[z][AM_SIZE-1];
  assign group_b_matrix_eff_col[AM_SIZE-1][z] = group_b_matrix_eff[z][AM_SIZE-1];
  assign group_c_matrix_eff_col[AM_SIZE-1][z] = group_c_matrix_eff[z][AM_SIZE-1];
  assign group_d_matrix_eff_col[AM_SIZE-1][z] = group_d_matrix_eff[z][AM_SIZE-1];
  assign    resp_matrix_eff_col[AM_SIZE-1][z] =    resp_matrix_eff[z][AM_SIZE-1];
 end
endgenerate
  assign         oldest_entry[AM_SIZE-1] =                                        (&        matrix_eff_col[AM_SIZE-1][AM_SIZE-2:0]);
  assign group_a_oldest_entry[AM_SIZE-1] =                                        (&group_a_matrix_eff_col[AM_SIZE-1][AM_SIZE-2:0]);
  assign group_b_oldest_entry[AM_SIZE-1] =                                        (&group_b_matrix_eff_col[AM_SIZE-1][AM_SIZE-2:0]);
  assign group_c_oldest_entry[AM_SIZE-1] =                                        (&group_c_matrix_eff_col[AM_SIZE-1][AM_SIZE-2:0]);
  assign group_d_oldest_entry[AM_SIZE-1] =                                        (&group_d_matrix_eff_col[AM_SIZE-1][AM_SIZE-2:0]);
  assign    resp_oldest_entry[AM_SIZE-1] =                                        (&   resp_matrix_eff_col[AM_SIZE-1][AM_SIZE-2:0]);
```

**What — three row-class cases.**
- **Row 0** (L200–L205): has no column to its left (there is no row
  with smaller index), so the column-of-ones conjunct collapses. Only
  the row-of-zeros reduction over `matrix_eff[0][AM_SIZE-1:1]` is
  needed; its complement directly drives `oldest_entry[0]`.
- **Interior rows `1 ≤ row ≤ AM_SIZE-2`** (L207–L226): two
  generate loops. The inner loop (z < row) transposes the z-th
  column of the stored triangle into `matrix_eff_col[row][z]` by
  reading `matrix_eff[z][row]` (the upper-triangle flop cell that
  encodes the i=z vs j=row relation). The row's oldest test at
  L219 then combines `~|matrix_eff[row][row+1:]` (row zero) with
  `&matrix_eff_col[row][row-1:0]` (column one) for each of the six
  cones.
- **Row AM_SIZE-1** (L229–L244): has no row-of-zeros term (there
  is no column to its right), so only the column-of-ones conjunct
  remains. The generate at L229–L238 populates the whole
  `matrix_eff_col[AM_SIZE-1][0:AM_SIZE-2]` by transposing column
  `AM_SIZE-1` of each stored row.

**How — column-from-transpose.** The antisymmetric relation means
the "lower triangle" entries are just the inverses of the stored
upper-triangle entries, *but the four Layer-4 `_eff` variants already
contain the correct sense including the set-to-1 force* — so the
column read is a direct copy of `matrix_eff[z][row]`, not a negation.
The resulting `matrix_eff_col` array provides the `&` conjunct in
one-cycle combinational depth. The `if(z < row)` guard at L209
prevents generate loops from instantiating the above-diagonal half
of `matrix_eff_col`, which is unused.

**Why — fan-in scaling.** For row `r`, the oldest reduction is an
OR tree of width `N-1-r` and an AND tree of width `r`, fan-in ~N per
row. Total gate count is O(N²) per cone × 6 cones = O(6N²), same as
the storage cost. Critical path depth is one OR-tree + one AND-tree
+ one gate ≈ `ceil(log2(N))` levels — at AM_SIZE=16 this is 4 levels
of 2-input gates, easily fitting one cycle. The split into three
row-classes is a pure readability/lint optimization; a single
generate covering row 0..N-1 with conditional corner-case guards
would synthesize to the same logic.

---

## §6 Caller Contract

Callers that instantiate `perseus_ls_age_matrix` MUST satisfy the
following assumptions. Violations do not cause synthesis errors but
will silently corrupt the ordering relation and yield wrong
`*_oldest_entry` outputs.

### §6.1 Required invariants

1. **Pairwise-consistent cross-port age hints.** For every ordered
   pair of source ports `k ≠ j`, the caller MUST drive
   `src_k_older[j] = ~src_j_older[k]`. Without this, the four
   `src*_entry_v_eff` masks at `perseus_ls_age_matrix.sv:L112–L130`
   disagree on which of the two concurrent allocations is older, and
   the row/column writes in `age_matrix_in` (L137–L146) emit an
   *asymmetric* age-matrix that no longer satisfies
   `A[i][j] + A[j][i] = 1`. Downstream, the row-of-zeros and
   column-of-ones reductions (L200–L244) can then both succeed for
   multiple rows, producing non-1-hot `oldest_entry`.

2. **At most one source allocates into any given row per cycle.**
   I.e. for every bit position `r`,
   `sum(src0_alloc_entry[r], src1_alloc_entry[r], src2_alloc_entry[r], src3_alloc_entry[r]) ≤ 1`.
   This is what makes the priority cascade at `perseus_ls_age_matrix.sv:L137–L146`
   behave as a parallel 4-way mux instead of a true priority encoder:
   only one arm fires per cell, so the src0>src1>src2>src3 ordering is
   never observed in practice.

3. **Each `src_k_alloc_entry` is 0 or 1-hot.** A given source port
   writes at most one entry per cycle. Multi-hot would cause the
   row-enable term `matrix_row_en[row] = alloc_entry[row] | (|alloc_entry[row+1:])`
   at `perseus_ls_age_matrix.sv:L149` to still be correct, but the
   `age_matrix_in` cascade would write *multiple* rows from the same
   source port with cross-row `src_k_entry_v_eff` values that only
   make sense for a single new entry.

4. **Un-used source ports are tied to zero.** A caller with fewer
   than four allocation sources MUST drive the unused
   `src_k_alloc_entry` to all zeros (and MAY leave the unused
   `src_k_older` bits at any value — they are masked out by the
   zero alloc vector at `L113–L130`).

5. **Class predicates need not be mutually exclusive.** `entry_group_a`,
   `entry_group_b`, `entry_group_c`, `entry_group_d` are independently
   consumed by six separate effective-matrix cones at L176–L195; an
   entry MAY be in zero, one, or multiple groups simultaneously. The
   only constraint is that a group-mask bit should be 0 for dead
   entries (where `entry_v` is 0), but this is also enforced by the
   `entry_v` AND at L176–L181.

6. **Degenerate size `AM_SIZE=1` is unsupported.** The `for(row=0; row<AM_SIZE-1; ...)`
   generate loops at L133, L175, L207 produce empty bodies when
   `AM_SIZE=1`, leaving `age_matrix_q` declared but never assigned.
   The final `oldest_entry[0]` assignment at L200 reads
   `matrix_eff[0][AM_SIZE-1:1]` which is a backward/null range for
   `AM_SIZE=1` and will not elaborate cleanly. (UNVERIFIED: the RTL
   does not contain an explicit `AM_SIZE > 1` assertion; inferred
   from the loop bounds.)

### §6.2 Potential pitfalls in caller code

- **Unused-source alloc forgotten at reset.** If a caller has only
  two real alloc sources and leaves `src2_alloc_entry` / `src3_alloc_entry`
  at X (e.g. uninitialised flop output), the cascade at
  `perseus_ls_age_matrix.sv:L137–L146` will propagate X into every
  upper-triangle cell on every cycle. Always tie unused source ports
  to `{AM_SIZE{1'b0}}` in the instantiation.

- **`entry_v[r]=1` but no `src_k_alloc_entry[r]` ever asserted.**
  If a consumer allocates by a path that bypasses the age matrix
  (e.g. a retry queue that sets `entry_v` directly), the row's
  `age_matrix_q[r][r+1:]` flops remain in their reset-zero state,
  and the row-of-zeros oldest test will declare `r` oldest even
  when older entries exist in higher rows. Every entry that
  participates in age ordering MUST have been allocated via one of
  the four `src_k_alloc_entry` ports.

- **Same-cycle read of `oldest_entry` and new alloc.** The age
  matrix has one-cycle allocation latency: `src_k_alloc_entry` is
  consumed combinationally by `age_matrix_in` (L137–L146) but is
  stored into `age_matrix_q` only on the next posedge (L152). The
  same-cycle `*_oldest_entry` at L200–L244 reads `matrix_eff` which
  reads `age_matrix_q` — i.e. the *previous* cycle's relation.
  Callers that need "include the entry I am allocating this cycle
  in the oldest query" must either pre-merge by adjusting `entry_v`
  and the cone masks, or accept one-cycle latency. See §7
  (deferred) for how `ls_lrq` handles this at the instantiation
  site.

- **Stale `src_k_older` when `src_k_alloc_entry == 0`.** If a
  caller drives a non-zero `src_k_older` hint while keeping
  `src_k_alloc_entry = 0` (no allocation), the hint is harmless —
  it ANDs with zero at L113/L114/… — but indicates confused control
  logic. The canonical pattern is "drive both or neither".

**Evidence.** Port list and cross-port hint widths:
`perseus_ls_age_matrix.sv:L38–L45`. One-hot consumption sites:
`perseus_ls_age_matrix.sv:L106–L109` (OR-fold), `L137–L146`
(priority cascade). Row-enable: `perseus_ls_age_matrix.sv:L149`.
Allocation latency: `perseus_ls_age_matrix.sv:L152–L168` vs
`L200–L244`.

---

## §7 Instantiation Catalog

This section enumerates age-matrix consumers along two parallel axes:
(a) **spec intent** — the consumers named in the design spec, which
represent the intended architecture; and (b) **current RTL snapshot** —
the consumers that actually instantiate `perseus_ls_age_matrix` in the
LSU RTL release under inspection (`MP128-r0p3-00rel0-2 /
MP128-BU-50000-r0p3-00rel0`). Under the pilot rule that spec is
authoritative and the RTL may be a pruned subset of spec, the two lists
can legitimately differ without either being "wrong".

### §7.1 Spec §3 D5 intended consumers (spec intent — not realized in current RTL snapshot)

Per design spec §3 D5 (line 60), the shared primitive `ls_age_matrix`
is "referenced by `ls_lrq` (and later `ls_sab`, `ls_rar`)". These are
the spec's intended consumers:

| Consumer   | `AM_SIZE` (spec intent) | Role (spec intent)                    | RTL instantiation status in this snapshot                                                                             |
|------------|-------------------------|---------------------------------------|-----------------------------------------------------------------------------------------------------------------------|
| `ls_lrq`   | 16                      | Ordering of outstanding loads         | Not instantiated — `grep -n 'perseus_ls_age_matrix\|age_matrix'` on `perseus_ls_lrq.sv` returns 0 hits.              |
| `ls_sab`   | 24                      | Store address age tracking            | Not instantiated — `grep -n 'perseus_ls_age_matrix\|age_matrix'` on `perseus_ls_sab.sv` returns 0 hits.              |
| `ls_rar`   | 40                      | Read-after-read ordering              | Not instantiated — `grep -n 'perseus_ls_age_matrix\|age_matrix'` on `perseus_ls_rar.sv` returns 0 hits.              |

Evidence basis: design spec §3 D5 at line 60 (authoritative source); the
`ls_lrq` / `ls_sab` / `ls_rar` modules exist in the RTL tree (referenced
by row/line in the L1 scaffold) but their age-matrix hookup is not
realized in this RTL snapshot. Under the pilot rule, this is interpreted
as "RTL is a pruned subset of spec" rather than a spec error; no spec
change is implied, and these rows remain valid architectural intent for
later RTL revisions.

### §7.2 Current RTL snapshot — observed instantiations (legitimate extensions beyond spec §3 D5 examples)

The grep `grep -rn 'perseus_ls_age_matrix'
perseus/logical/perseus_loadstore/verilog/` returns four live
instantiations, listed below. Design spec §3 D5 names `ls_lrq` / `ls_sab`
/ `ls_rar` as reference examples (the "e.g." list at spec §5.2 line 154
and §7 R6 line 252 is explicitly illustrative), so the four consumers
below are **spec-compatible extensions** rather than contradictions.

| Consumer           | `AM_SIZE` (resolved)                              | Instance name             | Role (inferred from RTL wiring)                                                       | RTL location                           |
|--------------------|---------------------------------------------------|---------------------------|---------------------------------------------------------------------------------------|----------------------------------------|
| `perseus_ls_fb`    | `16` (integer literal at instance)                | `u_fb_age_matrix`         | Fill-Buffer oldest arbitration; per-L2-bank oldest (groups a–d = l2bank 0..3)         | `perseus_ls_fb.sv:L8526`               |
| `perseus_ls_pf`    | `` `PERSEUS_LS_PF_TRAIN_BUFFER_SIZE `` = **4**    | `u_train_buf_age_matrix`  | Prefetch training buffer oldest selection; class groups all tied to zero              | `perseus_ls_pf.sv:L3762`               |
| `perseus_ls_prq`   | `` `PERSEUS_LS_PRQ_SIZE `` = **8**                | `u_prq_age_matrix`        | Pending Request Queue oldest; single alloc source (`prq_alloc_a5`), groups tied 0     | `perseus_ls_prq.sv:L409`               |
| `perseus_ls_snoop` | `` `PERSEUS_LS_SNPQ_SIZE_TOTAL `` = **7** (4+3)   | `u_snpq_age_matrix`       | Snoop Queue oldest; group_a = DVM class, group_b = cache-snoop class                  | `perseus_ls_snoop.sv:L3858`            |

Macro resolution evidence (all in `perseus_ls_defines.sv`):
- `` `PERSEUS_LS_PF_TRAIN_BUFFER_SIZE = 4 `` — `perseus_ls_defines.sv:L1041`.
- `` `PERSEUS_LS_PRQ_SIZE = 8 `` — `perseus_ls_defines.sv:L1104`.
- `` `PERSEUS_LS_SNPQ_SIZE_TOTAL = (4+3) = 7 `` — `perseus_ls_defines.sv:L874`.
- `AM_SIZE=16` for `u_fb_age_matrix` is a literal integer at the instantiation site.

Note: These four consumers are not enumerated in spec §3 D5's "e.g."
list. Per the pilot rule, a RTL consumer outside the spec's illustrative
examples is treated as a legitimate extension (additional instantiations
are allowed so long as they don't conflict with spec-stated invariants).
The §1 (Positioning) and §3.3 (Instantiation sizes) tables earlier in
this document still list the spec-intent sizes (16/24/40) as authored
during Gate 3 — they are preserved to reflect spec intent; readers
cross-checking the current RTL snapshot should consult §7.2 above for
the realized instantiations.

### §7.3 Per-instance wiring highlights

The wiring-level detail below applies only to the §7.2 RTL-observed
instantiations. The §7.1 spec-intent consumers (`ls_lrq` / `ls_sab` /
`ls_rar`) have no wiring to document in this snapshot because the
age-matrix instance is not yet present in their RTL.

**`u_fb_age_matrix` (AM_SIZE=16, `perseus_ls_fb.sv:L8526`).** Three live
alloc sources (`ls0/1/2_alloc_fb_entry_d3`), source 3 tied to zero;
cross-port hints (`ls0/1/2_older_d3_q`) are live and drive pairwise
age decisions across the three load-store pipes. Four class groups are
wired to the four L2-bank masks (`fb_entry_l2bank0..3`), giving a
per-L2-bank oldest output used by downstream bank arbiters.
`entry_awaiting_resp` is wired to `fb_entry_awaiting_cracked_dev`, so
`resp_oldest_entry` selects the oldest device/cracked-access waiter.

**`u_train_buf_age_matrix` (AM_SIZE=4, `perseus_ls_pf.sv:L3762`).**
Smallest instance. Three alloc sources (`p0/1/2_train_buf_alloc_entry`),
one tied to zero. Cross-port hints are fixed constants
(`src0_older=4'b1110`, `src1_older=4'b1100`, `src2_older=4'b1000`,
`src3_older=4'b0000`) — a static triangular priority ordering
src0 > src1 > src2 > src3, used because the prefetch-training buffer
does not have a dynamic age relationship among concurrent trainers.
All four class groups and `entry_awaiting_resp` are tied to zero; only
the primary `oldest_entry` cone is used.

**`u_prq_age_matrix` (AM_SIZE=8, `perseus_ls_prq.sv:L409`).** Single
live alloc source (`prq_alloc_a5` on src0); the other three
`src*_alloc_entry` are tied to zero. The cross-port hint constants are
identical to the PF instance (static triangular) but vacuous because
only src0 ever allocates. All four class groups tied to zero; primary
and `resp_oldest_entry` cones are active.

**`u_snpq_age_matrix` (AM_SIZE=7, `perseus_ls_snoop.sv:L3858`).** Two
live alloc sources (`alloc_snp_entry` on src0, `alloc_snp_self_entry`
on src1); src2/src3 tied to zero. Cross-port hints are the same static
constants. Group_a is driven by `group_a_entry` (DVM class — TLBI / CPP
excluded), group_b by `~tlbi & ~cpp` (cache-snoop class); group_c/d are
tied to zero. `entry_awaiting_resp` is wired to `dvm_entry_needs_resp`,
so `resp_oldest_entry` selects the oldest DVM waiter.

**Evidence.** Port bindings inspected by
`sed -n '<L-3>,<L+20>p'` at each instantiation line above.

---

## §8 Verification Concerns (Testpoint Seeds)

This section seeds a testpoint list for the primitive itself (not for
any one consumer — consumer-specific scenarios belong in their own
module docs). Each testpoint names the RTL layer (§5.1–§5.5) it
exercises. These are *seeds*, not a complete verification plan; a DV
engineer is expected to expand each bullet into concrete stimulus and
checker pseudocode.

### §8.1 Primitive testpoints

| ID           | Scenario                                                                                                                                             | Expected behaviour                                                                                                                                       | RTL layer                              |
|--------------|------------------------------------------------------------------------------------------------------------------------------------------------------|----------------------------------------------------------------------------------------------------------------------------------------------------------|----------------------------------------|
| `AGEMTX-TP-01` | Single-source sequential allocation: drive `src0_alloc_entry` one-hot at rows 0, 1, 2, …, N−1 in successive cycles, with `entry_v` accumulating.    | After cycle *k*, `oldest_entry` is 1-hot at row 0 for the primary cone while rows 0..k are live and `entry_needs_arb` is all 1.                           | L1, L2, L3, L5                         |
| `AGEMTX-TP-02` | Out-of-order dealloc via `entry_v`: after TP-01 fills rows 0..N−1, clear `entry_v[0]` (leave `entry_v[1..N-1]=1`).                                   | Same cycle, `oldest_entry` transitions 1-hot to row 1. Row 0's age-matrix flops retain their state (no row-0 alloc this cycle) but are masked by `entry_v`. | L4 (mask), L5                          |
| `AGEMTX-TP-03` | 4-source concurrent allocation into 4 distinct empty rows with consistent `src_k_older` hints (pairwise `src_k_older[j] = ~src_j_older[k]`).         | The implied total order across the four new rows is respected by `oldest_entry` in subsequent cycles; antisymmetry assertion `A[i][j] xor A[j][i]` holds for every pair. | L1 (pairwise), L2, L3                  |
| `AGEMTX-TP-04` | Dynamic class-group membership: allocate N entries, mark a rotating subset as `entry_group_a`; toggle the group-a membership of interior rows.      | `group_a_oldest_entry` tracks the oldest *currently in group_a* independently of the primary `oldest_entry`; the two cones disagree whenever group_a excludes the global oldest. | L4 (hold/set split), L5                |
| `AGEMTX-TP-05` | Reset release: drive `reset_i=1` for multiple cycles, then deassert and allocate row *r* via `src0_alloc_entry` on the very first post-reset cycle. | After allocation, the next cycle's `oldest_entry` is 1-hot at row *r*; all other upper-triangle flops remain the reset value 0 (no spurious ordering).    | L3 (async reset), L5                   |
| `AGEMTX-TP-06` | Row-level clock-gate correctness: allocate only into *low* rows (`r < N/2`) for many cycles, then query `oldest_entry` while *high* rows are live.  | High-row flops (whose `matrix_row_en` remained asserted only when a column-in-their-slice was written) still produce correct transposed-column reads; no stale high-row cells corrupt `oldest_entry`. | L3 (`matrix_row_en`, L149), L5         |
| `AGEMTX-TP-07` | XPROP mode (`PERSEUS_XPROP_FLOP` defined): drive `matrix_row_en[row]` to X (e.g. via X on an `src_k_alloc_entry` bit).                               | The `else` arm at `perseus_ls_age_matrix.sv:L166` loads `1'bx` into that row-slice; `oldest_entry` for affected cones propagates X, surfacing as a simulation X-check fail. | L3 (XPROP branch)                      |
| `AGEMTX-TP-08` | Same-cycle alloc + dealloc: allocate row *r* via `src0_alloc_entry[r]=1` while `entry_v[r]` is simultaneously deasserted (caller "fire-and-forget"). | `alloc_entry[r]` still wins — the row's flop is written this cycle — but the primary cone masks it out via `entry_v` at `L176`. `oldest_entry` ignores row *r*. Pairing checks: `entry_v` contract (§6.1 item 5) is not violated. | L1, L2, L4                             |
| `AGEMTX-TP-09` | `resp_oldest_entry` when `entry_awaiting_resp` is all zero.                                                                                          | `resp_oldest_entry` is all-zero for the same cycle — no row wins because `resp_matrix_eff_set` ORs in `~entry_awaiting_resp[row]` for every row (L188), and `resp_matrix_eff_hold` ANDs in `entry_awaiting_resp[col]` (L181), so every row's row-zero reduction fails. (UNVERIFIED: the row *N−1* corner case uses only the column-of-ones conjunct at L244; need to cross-check that `resp_matrix_eff_col[N-1][:]` transposes through a `_set` term that is all-1 when `entry_awaiting_resp=0` — by inspection of L188 the `_set` row for `row=N−1` is length-zero, so the conjunct `&resp_matrix_eff_col[N-1][N-2:0]` falls back to the hold term, which is zero ⇒ `resp_oldest_entry[N-1]=0`. Confirmed by eyeballing L453/L461; flag as UNVERIFIED pending formal check.) | L4 (`resp_*` cone), L5                 |
| `AGEMTX-TP-10` | Parameter sweep: re-elaborate with `AM_SIZE ∈ {4, 7, 8, 16}` (the four in-tree sizes from §7.1) and rerun TP-01/02 smoke.                            | All four sizes synthesise without elaboration warnings; TP-01/02 pass on each. Catches accidental AM_SIZE-specific constants in the RTL.                  | All layers (parametric smoke)          |
| `AGEMTX-TP-11` | Pairwise-inconsistent `src_k_older` hints (contract violation, negative test): drive `src0_older[1]=1` and `src1_older[0]=1` simultaneously with both ports allocating. | The resulting age matrix becomes asymmetric; `oldest_entry` may be multi-hot or all-zero depending on reduction. Expected: a caller-side assertion in the consumer fires *before* the primitive sees the bad hints; if the primitive is driven directly, the test captures the corruption as a one-hot checker failure. | L1 (pairwise invariant), §6.1 item 1   |

(Total: 11 primitive testpoint seeds. TP-01/02 cover the basic single-source
lifecycle; TP-03/11 cover the 4-way allocation pairwise invariant; TP-04
covers the group cones; TP-05/07 cover reset and XPROP; TP-06 covers the
row-level clock gate; TP-08/09 cover cone-mask corners; TP-10 is a
parameter-variant smoke.)

### §8.2 Out-of-scope for this primitive's testpoints

The following belong to consumer-level (FB / PF / PRQ / SNPQ) testpoint
lists, not to this document:

- The semantic correctness of each consumer's `entry_group_*` mapping
  (e.g. L2-bank assignment for FB, DVM-class vs cache-snoop-class for
  SNPQ) — those are consumer ordering requirements, not primitive behaviour.
- Replay / arbitration-grant downstream of `oldest_entry` — this is
  consumer arbitration, not age-matrix output.
- Pipeline latency alignment between `src_k_alloc_entry` and the
  `entry_v`/`entry_needs_arb`/`entry_group_*` predicates — this is a
  consumer timing concern (§6.2 bullet 3 of this doc identifies it but
  the check belongs in each consumer's TP list).

### §8.3 Consolidated UNVERIFIED summary

| Location                        | Claim                                                                                                                              | Gate-5 status                                                                                                                                      |
|---------------------------------|------------------------------------------------------------------------------------------------------------------------------------|----------------------------------------------------------------------------------------------------------------------------------------------------|
| §1 / §3.3 (Gate 3, `ls_lrq`=16) | Spec §3 D5 names `ls_lrq` as a 16-entry age-matrix consumer.                                                                       | **Open — informational.** Spec intent; not realized in current RTL snapshot (`perseus_ls_lrq.sv` does not instantiate the primitive — see §7.1). No spec change implied; retained as architectural intent. |
| §1 / §3.3 (Gate 3, `ls_sab`=24) | Spec §3 D5 names `ls_sab` as a 24-entry age-matrix consumer.                                                                       | **Open — informational.** Spec intent; not realized in current RTL snapshot (`perseus_ls_sab.sv` does not instantiate the primitive — see §7.1). No spec change implied; retained as architectural intent. |
| §1 / §3.3 (Gate 3, `ls_rar`=40) | Spec §3 D5 names `ls_rar` as a 40-entry age-matrix consumer.                                                                       | **Open — informational.** Spec intent; not realized in current RTL snapshot (`perseus_ls_rar.sv` does not instantiate the primitive — see §7.1). No spec change implied; retained as architectural intent. |
| §7.2 (Gate 5)                   | `ls_fb` (16), `ls_pf` (4), `ls_prq` (8), `ls_snoop` (7) instantiate the primitive but are not named in spec §3 D5's "e.g." list.    | **Documented — no action needed.** Per the pilot rule, RTL consumers outside spec's illustrative examples are legitimate extensions; not a conflict. Sizes resolved from `perseus_ls_defines.sv` (see §7.2). |
| §4.2 (Gate 4)                   | Convention that `src_k_older[k]` self-bit is unread.                                                                               | Open — not re-verified in this gate; still informational. Pilot-scope OK.                                                                          |
| §5.3 (Gate 4)                   | `PERSEUS_DFF_DELAY` / `PERSEUS_XPROP_FLOP` definitions in header.                                                                  | Open — conventions stated; header file not re-inspected.                                                                                           |
| §6.1 item 6 (Gate 4)            | `AM_SIZE=1` degenerate size support is untested (no explicit assertion in RTL).                                                    | Open — in-tree min size is 4 (PF train buf), so `AM_SIZE=1` is operationally unreachable; flag retained for primitive-reuse guidance.              |
| §8.1 TP-09                      | Row `N−1` corner behaviour for `resp_oldest_entry` when `entry_awaiting_resp` is all-zero.                                         | Open — eyeballed; DV should formally check.                                                                                                        |

---
