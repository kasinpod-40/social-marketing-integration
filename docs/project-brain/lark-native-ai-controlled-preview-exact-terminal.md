# Project Brain — Lark Native AI Controlled Preview Exact Terminal

## Purpose

The exact-terminal workstream converts the merged Controlled Preview Live Pilot into one reviewed user command without shell heredoc, manual SHA, manual approval JSON or manually assembled readiness input.

## Authority chain

```text
retained real validated Report package
→ package checksum and exact-main binding
→ schema zero-drift authority
→ released all-false Remote authority
→ deterministic 1D/3D/7D/30D readiness plans
→ existing 40-row Executor planner
→ existing bounded Lark Live Pilot
→ independent same-input replay
```

The exact Terminal does not create a second Report materializer, Lark client or execution planner.

## Sequential Terminal rule

The user may run this command after another Terminal command has ended. PR closure is not itself the runtime gate. The retained source package must prove that the prior Terminal stopped in an all-false safe state and released the single Integration Workspace Remote mutation window.

A caller Boolean is not sufficient. The source package checksum, exact current Head, schema evidence and Remote evidence are validated before any Lark request.

## Fixed child boundary

The parent overrides local retry/pagination settings with:

```text
maxAttempts=1
maxPages=1
maxFilterConditions=50
requestTimeoutMs=30000
minRequestIntervalMs=150
```

Partial or unknown write outcomes are never automatically retried. Every new attempt starts by searching Stable keys.

## Success contract

First pass:

```text
0..40 bounded create/update writes
fresh zero-drift verification
```

Independent replay:

```text
40 no_op
0 writes
0 deletes
```

AI, Automation, notification, D1, Queue, Worker deployment, Provider, Schedule and Production actions remain zero/disabled/blocked.

## Evidence retention

Every run receives a new private attempt directory. Inputs and results are mode `0600`; directories are mode `0700`; files are never overwritten. A local exclusive lock prevents two exact-terminal processes from running concurrently and is never removed automatically when pre-existing.
