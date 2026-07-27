# Project Brain — Chatwoot Lark Additive Schema Apply

## Verified input

On 2026-07-28, the merged Chatwoot Lark metadata-only preflight inspected the Integration Workspace Base and found:

```text
remote tables                 = 56
Chatwoot tables resolved      = 0 / 15
Chatwoot tables missing       = 15 / 15
planned actions               = 15 create_table
ambiguous identities          = 0
type/Primary blockers         = 0
destructive actions           = 0
record reads                  = 0
Lark mutations                = 0
```

Decision:

```text
CHATWOOT_LARK_ADDITIVE_PLAN_REQUIRED
```

## Durable decision

The approved Repository direction is one plan-only-by-default, separately confirmed additive schema operator.

It must:

- consume and validate the local metadata evidence;
- re-read current Table/Field metadata immediately before mutation;
- permit only `bind_table_env`, `create_table`, and `create_field`;
- reuse the existing Lark client and merged Chatwoot Blueprint;
- create transport-compatible Field types matching the existing normalized Write set;
- verify all 15 Tables and Stable keys after Apply;
- write raw Table IDs only to an ignored local Environment fragment;
- support safe rerun after partial Table creation.

It must never:

- rename/delete Tables or Fields;
- change an existing Field type or Primary Field;
- read or write Lark records;
- access Chatwoot Provider or Token;
- mutate D1, Queue/DLQ, Worker, Schedule/Webhook, Secrets or Production;
- edit `.dev.vars` or `wrangler.sync.jsonc` automatically.

## Independent blocker

Chatwoot Provider readiness remains blocked independently because Profile ID `14` is still `agent`. It must become `administrator` before Account Reporting Events and Runtime activation can pass.

Lark schema preparation does not bypass or weaken that Provider permission gate.
