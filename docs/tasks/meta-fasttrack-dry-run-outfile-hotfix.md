# Meta Fast-track Dry-run Outfile Hotfix

## Status

```text
TASK_STATUS                 = IMPLEMENTED_PENDING_CI
SCOPE                       = REPOSITORY_HOTFIX_ONLY
REMOTE_ACTIONS              = NONE
PRODUCTION                  = BLOCKED
```

## Incident

The read-only retry from `main@9e316d9b6924e01b18087ae45bc8148330f18d3b` successfully generated the safe Wrangler config but stopped before every Remote action because the preparer invoked Wrangler with `--outdir` and then assumed the emitted bundle was named `worker.js`.

Wrangler completed compilation but wrote a different bundle filename, so the preparer raised `ENOENT` while attempting to read the guessed path.

## Durable correction

- Use Wrangler's supported `--outfile` option with a deterministic temporary bundle path.
- Hash the exact file passed to `--outfile`; never infer or scan for an output filename.
- Keep `--dry-run` mandatory and preserve zero Remote commands/mutations.
- Add a pure argument-builder regression proving `--outfile` is used and `--outdir` is absent.
- Preserve all existing safe-config, all-false flag, 15-table mapping, secret rejection and Meta D1/Lark contract gates.

## Safety

No Remote D1 query/write, Queue/DLQ message, Worker deployment, Meta Provider request, Lark request/mutation, Schedule/Secret change or Production action occurred.
