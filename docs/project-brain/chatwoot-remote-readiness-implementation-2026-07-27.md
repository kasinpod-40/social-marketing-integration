# Project Brain — Chatwoot Remote Readiness Implementation

## Status

```text
PASS_FOR_INTEGRATION_REVIEW
Draft PR #111 open / unmerged
Remote execution not authorized
```

Branch `integration/chatwoot-remote-preflight` starts from
`main@f3e330339b114536c3a1a9ee7567abf5a76fa78b` after Chatwoot Runtime Wiring PR #97 and
merge-closeout PR #108 were merged.

The Repository implementation adds a guarded plan-only-by-default operator for:

```text
plan
→ preflight
→ backup
→ migrate
→ schema-readback
```

The operator locks the Integration Workspace, exact D1 database and Migration `0018`, validates all
execution gates false, requires zero active Work/Locks, checksum-binds the backup and requires 14
tables, 15 indexes, zero Chatwoot rows and Shared count parity after Migration.

Distinct exact confirmations and chain-bound evidence are required for every executable phase.
Migration `0017` has no rerun path. Before apply, the only accepted pending migration is
`0018_chatwoot_analytics.sql`; afterward the ledger must be empty.

The operator intentionally has no Chatwoot Provider request, Token read, Lark mutation, Queue/DLQ,
Worker deployment, Schedule/Webhook or Production path. This Repository implementation performed no
Remote phase.

Verified implementation head `97dccf6b428f3d45f3577fabee379a5c1691e5c0` passed Branch Verification
`#662` / run `30276869292`:

```text
Node Unit / Integration             1061 / 1061 PASS
Workers runtime                     11 / 11 PASS
Report reliability                  91 / 91 PASS
New readiness operator tests        11 / 11 included in full suite
Dependency audit                    0 vulnerabilities
Wrangler dry-run                    PASS / no deployment
Artifact                            8657185518
Artifact digest                     sha256:76926b5ac7e12de66de6ec16b2fc67174d0442d8506b899c603d6fdfea2b8a6e
```

Remote preflight, backup, Migration `0018` apply, schema read-back and all later Provider/Lark/UAT
phases remain separate explicit decisions after PR merge.
