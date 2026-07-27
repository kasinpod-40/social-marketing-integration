# Project Brain — YouTube D1 Migration-list Transient Read

## Durable live fact

The YouTube current-main revalidation remained read-only and stopped at the Remote D1 migration-list query
when Cloudflare returned `internal error` with code `7500`. No deployment, Queue message, D1 write, Lark or
Provider request occurred.

## Durable operator rule

A final read-only gate must distinguish transient Cloudflare transport/storage failure from contract drift.
For the D1 migration-list read only:

- retry when the failure contains both `internal error` and code `7500`;
- bound the operation to three total attempts;
- preserve all non-transient failures as immediate fail-closed results;
- never rerun or apply a migration as part of the retry;
- never convert an OS/child-process numeric exit code into a public business decision;
- persist only sanitized attempt counts and semantic codes.

This rule does not weaken migration truth. After a successful read, Migration `0017` and `0018` classification
remains unchanged and authoritative.

## Historical YouTube baseline

YouTube Lark schema apply, full sync, idempotent rerun, incremental sync, lock/retry/DLQ/alert and identity
fail-closed validation remain confirmed. This hotfix does not rewrite or re-read YouTube/Lark business rows.
