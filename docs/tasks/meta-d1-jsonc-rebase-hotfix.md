# Meta D1 JSONC Rebase Hotfix

## Incident

Facebook Lark metadata preflight passed, while the Meta D1 read-only preflight stopped before any mutation with:

```text
CHATWOOT_SAFE_CONFIG_GENERATED_JSON_INVALID
Generated Wrangler config is not valid JSON
```

The compatibility launcher correctly intercepted the existing Meta D1 operator, but the shared generated-config path rebase helper parsed `.jsonc` input with strict `JSON.parse`. Wrangler JSONC may contain comments or trailing commas during a guarded generated-config chain.

## Correction

- Reuse the Repository's existing `parseJsoncObject` parser.
- Accept valid JSONC comments and trailing commas at the path-rebase boundary.
- Serialize the normalized result back to strict JSON before Wrangler execution.
- Preserve exact `main`, `$schema`, D1 binding and `migrations_dir` path validation.
- Preserve fail-closed rejection for malformed JSONC and invalid binding topology.

## Safety

This is a Repository-only hotfix. It does not run or authorize:

```text
Remote D1 write or migration
Queue or DLQ message
Worker deployment
Meta Provider request
Lark record or schema mutation
Schedule or Production activation
```

The failed operation remains safe: D1 writes, Queue messages, Worker deployments, Lark mutations and Provider requests were all zero.
