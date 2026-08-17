# Repository Final Closeout — 2026-08-17

## Purpose

This record closes repository debt discovered during the full-repository audit without changing Live runtime state. TikTok Ads is intentionally deferred by the user and remains outside this closeout.

## Verified baseline

- latest audited `main`: `5fcc0777ea19abf7aee2e42f566f62e44149232c`
- Weekly v6 Worker: `da0777dc-447b-452b-b86c-3e96637375c8` at 100% traffic
- v6 controlled recovery: Quality Gate PASS; AI 1; Admission 1; D1 delivery `sent/mirrored` claim 1; Lark Notification Log `sent` 1
- exact new alert / DLQ / active lock after recovery: `0 / 0 / 0`
- next eligible scheduled proof: `2026-08-24 08:30 Asia/Bangkok`
- Production: blocked / customer-owned

## Repository debt found

### PR #249 — actionable code delta

Current `main` still used a permissive fixed-number regex and did not normalize official grouped Lark Number formatter enums before precision comparison. The old Draft PR contains the minimal serializer correction and regressions. The affected serializer and focused test files on `main` are byte-identical to PR #249's original base, so the reviewed file delta can be ported without overwriting later edits.

The closeout ports only:

- official grouped formatter handling through shared `normalizeLarkNumberFormatter`
- explicit supported precision map
- unsupported-precision fail-safe behavior
- focused regression cases
- Shared Dimensions Backfill operator identity v1.3 + focused identity test

No Backfill Apply is authorized or executed.

### Obsolete Draft PRs

The following old Draft PRs are superseded by current `main` and should be closed after the current-main closeout merge:

- #11 — old Google Ads separate RAW schema architecture; superseded by current D1-first/non-TikTok RAW-retirement architecture
- #17 — old Google Ads signed-delivery feature branch; current Google Ads transport/admission/runtime has later merged/live evidence
- #66 — old WooCommerce integration branch; current main contains later WooCommerce migration/runtime/report completion
- #249 — superseded once this minimal current-main port is merged
- #595 — old YouTube `invalid_grant` incident record; later owner consent/Analytics catch-up and signed daily-count work supersede it

PR #220 is intentionally retained:

```text
TIKTOK_ADS = DEFERRED_BY_USER
```

## Authority cleanup

The previous large `docs/current-task.md`, `docs/project-brain/00-current-state.md` and `docs/project-brain/10-next-actions.md` contained valuable history but also stale July/August intermediate status. Their exact blobs are preserved under archive paths before the active files are replaced with concise current authority.

This is archival relocation, not deletion of evidence.

## Runtime safety

This repository closeout must produce zero:

- Worker deployments
- Queue messages / replay / DLQ redrive
- Remote D1 migrations or Business writes
- Lark mutations
- Provider calls
- Schedule changes
- Secret/Binding changes
- Production actions

## Remaining non-repository gates

After this closeout, the only current gates are:

1. Automatic Weekly v6 scheduled exactly-once evidence after `2026-08-24 08:30 Asia/Bangkok`.
2. Customer-owned Production provisioning/UAT when separately authorized.
3. TikTok Ads only when the user explicitly resumes that deferred workstream.
