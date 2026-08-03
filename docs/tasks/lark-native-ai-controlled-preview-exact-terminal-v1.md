# Lark Native AI Controlled Preview Exact Terminal v1

## Objective

Provide one reviewed Terminal entrypoint that consumes one private retained real-data package, builds the exact approved `1D / 3D / 7D / 30D` readiness set, applies at most 40 Preview Records to `🧠 MKT_AI_Report_Runs`, and performs a separate same-input replay that must converge to `40 no_op / 0 writes`.

The operator removes pasted heredocs, caller-entered SHA values, manual approval JSON and manually assembled Live Pilot input from the user workflow.

## Command

Run from the repository root on `main`:

```bash
CONFIRM_LARK_NATIVE_AI_CONTROLLED_PREVIEW_EXACT_TERMINAL=RUN_LARK_NATIVE_AI_CONTROLLED_PREVIEW_EXACT_TERMINAL node scripts/lark-native-ai-controlled-preview-exact-terminal.mjs --execute
```

There are no placeholders in this command. The operator discovers the exact local Head and binds approval itself.

## Required retained source package

Default path:

```text
outputs/lark-native-ai-controlled-preview/retained-real-report-source.json
```

Optional path override is accepted only through:

```text
MKT_LARK_NATIVE_AI_CONTROLLED_PREVIEW_SOURCE_PACKAGE
```

The file must:

- be a regular non-symlink file inside the repository working tree;
- use mode `0600`;
- be no larger than 16 MiB;
- use schema `lark_native_ai_controlled_preview_retained_source_package_v1`;
- use contract `lark_native_ai_controlled_preview_exact_terminal_v1`;
- bind the exact current `main` Head;
- contain a recomputable package SHA-256;
- prove `retained_real_validated_report_evidence` with `fixtureData=false`;
- contain exact Offline inputs for unique windows `1, 3, 7, 30`;
- contain schema zero-drift authority with exact `6/6` View filters;
- contain a retained safe-state authority captured after the prior Terminal stopped;
- prove Remote lock released, all Worker flags false, Preview URLs disabled, Schedule disabled and Production blocked.

Fixture, dummy, placeholder and sample generation identities are rejected before any Lark request.

## Exact execution sequence

```text
explicit confirmation
→ Node.js >= 22
→ git fetch origin main
→ local branch=main / clean / HEAD=origin/main
→ acquire private local execution lock
→ validate source path/type/mode/size/JSON/checksum/Head
→ validate schema and Remote safe-state authority
→ validate exact 1D/3D/7D/30D real-data topology
→ create a new immutable attempt directory
→ build four readiness plans with deterministic Head-bound approval
→ write private Live Pilot input
→ run bounded first pass
→ require fresh zero-drift read-back
→ run a separate same-input replay
→ require 40 no-op / 0 writes
→ write private summary
→ release local execution lock
```

## Client boundary locked by the parent operator

The child Live Pilot receives fixed values regardless of local Environment overrides:

```text
LARK_MAX_ATTEMPTS=1
LARK_MAX_PAGES=1
LARK_MAX_FILTER_CONDITIONS=50
LARK_REQUEST_TIMEOUT_MS=30000
LARK_MIN_REQUEST_INTERVAL_MS=150
```

This prevents hidden retry and pagination drift. A failed or ambiguous write is not retried automatically. A new reviewed run must search Stable keys again.

## Remote allowlist

The existing Live Pilot guard remains authoritative:

- tenant token;
- one Table inventory read;
- Stable-key Record search by `ai_run_key` and `dedupe_key`;
- at most one batch create and one batch update;
- maximum 40 first-pass Record writes;
- fresh verification read-back.

The exact Terminal adds a second child run that must perform zero Record writes.

Forbidden:

- Record delete;
- Schema or View mutation;
- AI call;
- Automation or Group notification;
- D1, Queue, Worker deployment or Provider action;
- Schedule activation;
- Production activation.

## Attempt evidence

Each execution creates a new private `0700` directory under:

```text
outputs/lark-native-ai-controlled-preview/exact-terminal/
```

Files are written with mode `0600` and never overwritten:

```text
live-pilot-input.json
01-first-pass.json
02-same-input-replay.json
summary.json
```

A stopped run writes `failure-summary.json` when an attempt directory already exists.

The local lock file is:

```text
outputs/lark-native-ai-controlled-preview/exact-terminal/.exact-terminal.lock
```

A pre-existing lock is never deleted automatically. The operator stops with `LARK_NATIVE_AI_CONTROLLED_PREVIEW_EXACT_TERMINAL_LOCK_EXISTS` so the prior process/evidence can be inspected first.

## Expected success

The first pass is accepted only as one of:

```text
applied_and_verified  with 1..40 writes
already_zero_drift    with 0 writes
```

The second pass must be exactly:

```text
mode                 already_zero_drift
verification.status  zero_drift
verification.counts  write=0 / noOp=40 / delete=0
writes.total          0
```

## Important failure codes

```text
..._MAIN_REQUIRED                 wrong branch
..._CLEAN_REQUIRED                working tree changed
..._MAIN_NOT_CURRENT              local main differs from fetched origin/main
..._LOCK_EXISTS                   another exact-terminal attempt or retained stale lock exists
..._SOURCE_PACKAGE_NOT_FOUND      exact source path missing
..._SOURCE_PACKAGE_MODE_INVALID   source file is not mode 0600
..._SOURCE_PACKAGE_CHECKSUM_INVALID content changed after retention
..._SOURCE_PACKAGE_HEAD_MISMATCH  source evidence is stale for current main
..._SOURCE_PACKAGE_REMOTE_AUTHORITY_INVALID prior Terminal did not prove safe release
..._READINESS_NOT_READY           a real-data window failed readiness validation
..._CHILD_FAILED                  Live Pilot stopped; no automatic retry occurred
..._FIRST_PASS_INVALID            first pass exceeded or misreported reviewed boundaries
..._REPLAY_INVALID                same-input rerun was not 40 no-op / zero writes
```

## Historical failure prevention

This operator directly prevents recurring failure classes:

- no shell heredoc or quoting-sensitive pasted JSON;
- no manually typed SHA or approval timestamp;
- no relative retained-evidence path guessed by the user;
- no source file symlink or permissive mode;
- no stale local main;
- no hidden Lark retry/page/filter override;
- no input overwrite across attempts;
- no automatic retry after partial/unknown write;
- no success without an independent same-input replay;
- no Fixture data written for demonstration.

## Current Live status

Repository implementation and CI perform zero Remote action. A Live run remains blocked until the retained source package exists and proves a safe sequential handoff after the prior Terminal stopped.
