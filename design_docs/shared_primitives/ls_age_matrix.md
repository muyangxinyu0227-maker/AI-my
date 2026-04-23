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

<!-- §4–§8 to be written in Task 5 (Gate 4) and Task 6 (Gate 5) -->
