# Meta D1 JSONC Rebase Hotfix

## Incident

The Facebook Lark metadata preflight passed, but the D1 read-only preflight stopped before any mutation because the compatibility layer passed a valid Wrangler JSONC config to the shared path-rebase helper, while that helper accepted strict JSON only.

## Correction

- Reuse the existing shared JSONC parser for generated Wrangler config path rebasing.
- Preserve fail-closed object, D1 binding, main, schema and migrations path validation.
- Serialize the normalized temporary config as deterministic JSON before Wrangler execution.
- Add focused coverage for comments, trailing commas and malformed JSONC.

## Safety

Repository-only. No Remote D1 read/write, Queue/DLQ action, Worker deployment, Meta Provider request, Lark request/mutation, Schedule/Secret change or Production action occurred.

## Acceptance

- Valid Wrangler JSONC with comments and trailing commas is accepted and normalized.
- Malformed JSONC remains rejected before Wrangler invocation.
- Existing Meta, full Repository, report reliability, dependency audit and Wrangler dry-run gates pass.
