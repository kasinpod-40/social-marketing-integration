# Report Window `.dev.vars` Permission Hotfix v1

## Incident

The merged one-command Organic Dashboard repair stopped before any Remote mutation because
`npm run check` found the local `.dev.vars` file readable by group/other users:

```text
Repository hygiene check failed:
- .dev.vars permissions are too open; run chmod 600 .dev.vars
```

The wrapper delegated directly to the Report finalizer and did not normalize the known local-secret
permission prerequisite first. This made the advertised one-command workflow require an unlisted
manual recovery command.

## Correction

Before the finalizer or any Repository gate runs, the wrapper now:

1. locates the repository-root `.dev.vars` file;
2. permits absence because credentials may be supplied through another supported environment path;
3. rejects symlinks and non-regular files;
4. applies owner-only mode `0600` on non-Windows systems;
5. reads the file mode back and fails closed unless all group/other permission bits are zero.

The plan and sanitized success summary expose only the permission mode, never secret contents.

## Regression

The focused source-contract test requires permission preparation to occur before the Report
finalizer and verifies the symlink guard, `chmod(..., 0o600)` call and post-change mode readback.

## Safety

Repository implementation performs no Worker deployment, Queue/DLQ send, Remote D1/Lark mutation,
Schedule change, Secret-content change, provider call or Production action. The local file mode is
changed only when the user explicitly executes the existing confirmed one-command operator.
