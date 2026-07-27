# Meta D1 Wrangler Compatibility Hotfix

## Status

```text
SCOPE                       = REPOSITORY_HOTFIX_ONLY
REMOTE_ACTIONS              = NONE
PRODUCTION                  = BLOCKED
```

## Incident

The Facebook fast-track Lark metadata preflight passed, while the D1 read-only preflight stopped before any Remote mutation. The Meta D1 operator still used the older Wrangler dry-run contract (`--outdir` plus an assumed `worker.js`) and copied generated config text to a different directory without rebasing relative paths.

## Objective

Add a compatibility launcher for every Meta D1-only phase that:

- keeps the existing operator and all confirmation gates authoritative;
- normalizes every Wrangler `--config` file into an isolated temporary directory with correctly rebased relative paths;
- treats operator-generated `.meta-d1-only-*` configs as derived from the reviewed source config directory;
- rewrites only `wrangler deploy --dry-run --outdir <dir>` to deterministic `--outfile <dir>/worker.js`;
- delegates every other Wrangler argument unchanged to the real absolute `npx` executable;
- persists no config values and exposes no credentials;
- performs no Remote action during implementation.

## Acceptance

- Generated safe and active configs remain valid after relocation.
- Dry-run output is deterministic and hashable at `worker.js`.
- Non-dry-run deploy and Remote read commands preserve their arguments except for isolated config normalization.
- The launcher propagates stdout, stderr and exit code exactly.
- Focused Meta tests and full Repository verification pass.
