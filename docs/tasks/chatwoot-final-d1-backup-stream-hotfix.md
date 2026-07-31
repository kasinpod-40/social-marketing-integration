# Chatwoot Final D1 Backup Stream Integrity Hotfix

## Incident

The guarded Chatwoot Final 30-day Initial plus three-day Daily UAT completed local gates and read-only admission, then successfully exported a fresh Remote D1 SQL backup. Integrity collection invoked `execFileSync('cat', [path])`, which attempted to buffer the entire SQL file and failed with `ENOBUFS`.

```text
code         ENOBUFS
message      spawnSync cat ENOBUFS
safeRestore  NOT_REQUIRED
production   BLOCKED
```

The failure occurred before temporary Active Worker deployment. No Queue send, Chatwoot Provider request, D1/Lark Business write, Schedule activation or Production action occurred. The exported backup is retained as evidence and must not be deleted merely because the local integrity read failed.

## Root correction

The operator must not transfer a potentially large backup through a child-process stdout buffer.

The corrected sequence is:

```text
Wrangler Remote D1 export
→ filesystem stat
→ require regular non-empty file
→ incremental SHA-256 through createReadStream
→ persist relative path / exact byte count / digest evidence
→ continue to Active deployment only after integrity passes
```

Inspection and hashing failures receive bounded error codes without exposing backup content or secrets.

## Acceptance criteria

```text
execFileSync cat backup read             forbidden
whole backup in child-process buffer     forbidden
filesystem regular-file verification     required
empty backup rejection                   required
streamed SHA-256                         required
backup byte count from stat              required
Active deployment before integrity       forbidden
Queue / Provider / Business write in CI  0
Schedule / Webhook / Production          disabled / disabled / blocked
```

## Required verification

```bash
npm ci
npm run check
node --test tests/application/chatwoot-final-30d-daily-uat.test.js
npm test
npm run test:report-reliability
npm audit --audit-level=high
npm run deploy:dry-run
```

`docs/current-task.md` remains owned by the concurrent Meta workstream and is intentionally unchanged.
