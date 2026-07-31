# Chatwoot Final D1 Snapshot File Preflight Hotfix

## Incident

A guarded Chatwoot Final UAT attempt passed local gates, read-only admission and D1 backup, entered the temporary Active Worker window, then failed on the first Initial-operation D1 Snapshot read. The emitted command ended at `mktConversationAccountDaily`, returned exit code `1`, and did not expose a usable Wrangler error because stdout was discarded while stderr was empty.

The failure occurred before the Initial Queue send. Automatic Safe restore completed without a restore error. Therefore the attempt performed one temporary Active deployment and one all-false Safe restore, but no Chatwoot Queue message, Provider request or D1/Lark Business write.

## Root cause class

The Final operator sends the complete Snapshot SQL as one `wrangler d1 execute --command` argument. This read path is materially larger than the preflight query and is first exercised only after the Active deployment. The command wrapper also records only a stderr fingerprint, so Wrangler failures written to stdout are not diagnosable.

## Correction

1. Write each D1 read SQL statement to a private generated file with `umask 077`.
2. Execute D1 reads through `wrangler d1 execute --file` and always remove the generated SQL file.
3. Run the exact Initial Snapshot SQL as part of read-only preflight before D1 backup and before any Active deployment.
4. Preserve the existing remote-empty and schema admission contracts.
5. Record both stdout and stderr fingerprints without exposing raw SQL, data, credentials or identities.
6. Keep the sequence read-only preflight → D1 backup → Active deployment → Queue send → automatic all-false restore.

## Acceptance criteria

```text
Long Snapshot SQL in --command             forbidden
Private SQL file mode                      0600 / umask 077
Generated SQL cleanup                      required in finally
Exact Initial Snapshot query preflight     before D1 backup and Active deploy
Raw stdout/stderr                          never emitted
stdout/stderr SHA-256 fingerprints         retained on command failure
Queue send before Snapshot validation      forbidden
Schedule/Webhook                           disabled
Production                                 blocked
```

## Verification

Run the focused Chatwoot Final UAT tests and the complete Branch Verification gate set. Repository implementation and CI must perform zero Remote actions.

`docs/current-task.md` remains owned by the concurrent Meta execution workstream and is not modified by this hotfix.
