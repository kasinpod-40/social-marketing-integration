# Project Brain — Report D1 Read Retry & Diagnostics

Date: `2026-08-05`

## Locked state

The latest exact-head Run All stopped safely before Instagram deployment at the shared D1 SELECT preflight. No
Instagram Queue, Worker deployment, D1 write, Lark write or Provider call occurred. The prior Facebook channel ran
first and must be reverified read-only before resuming.

The failure output contained the entire generated command but not the actual `stderr` returned by Wrangler. Because
the same query passed during readiness immediately beforehand, a transient Cloudflare/CLI failure is plausible, but
it is not proven. The implementation therefore both retries bounded command failures and preserves the final compact
diagnostic instead of guessing.

## Locked correction

- three maximum attempts for shared Report D1 SELECT command execution;
- fixed two-second wait between failed attempts;
- final error code `REPORT_RUNTIME_CLOSEOUT_D1_READ_FAILED`;
- compact source code/signal/stdout/stderr only;
- no SQL text in diagnostics;
- invalid successful JSON fails immediately;
- no retry for any D1 write or Queue operation.

## Forbidden actions

- rerun the old `outputs/report-live-resume-392673893e39` block;
- reuse its retained handoff;
- assume Facebook or Instagram state without new SELECT-only evidence;
- add an Instagram-only operator;
- manually change D1/Lark materializations;
- enable Notification Admission, Schedule or Production.

## Resume order

```text
new merged main
→ exact-head Finalizer
→ Facebook readiness
→ Instagram readiness
→ remaining readiness
→ new retained handoff
→ one resumed Run All
→ post-run readiness for all 28 windows
```
