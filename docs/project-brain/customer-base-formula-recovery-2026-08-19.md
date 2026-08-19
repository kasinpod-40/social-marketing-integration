# Customer Base Formula Recovery — 2026-08-19

## Scope

This record captures the controlled recovery state for PR #661 after the customer Target Base received partial migration writes. It supersedes any earlier operational instruction to create a new checkpoint.

## Immutable recovery baseline

- Source export SHA-256: `c230354d7eb06f7ab598511c1be4d798ba420e50255ce29a6b810db505e8e643`
- Original controlled-Apply checkpoint SHA-256: `7c1176faab7b039acb81b663e442837e6d80a79d922c8d6e6cefbfbcaef93053`
- Target Base: `✨Marketing Content Calendar`
- Clone scope: 32 Tables
- Protected external Table: `🎵 RAW_TikTok_Creator_Videos`
- Folder placement: user already moved cloned Tables under `Setup Phase | Social MKT Data Hub`

Recovery rule: **reuse the original checkpoint only; never run `--prepare-checkpoint` again.**

## Observed Target progress

The controlled Apply is no longer a zero-mutation preview. The Target contains migration-owned partial state.

Observed automatic progress before the current blocker:

1. original checkpoint accepted;
2. clone-scope Tables created/claimed;
3. ordinary fields progressed;
4. Relation fields progressed, including the corrected `account_link` relation semantics;
5. Formula phase reached `📣 MKT_Ads_Campaigns.budget`;
6. Record phase has not started.

Downstream phases remain incomplete until proven by later operator output: remaining Formulas, Records, relation record-cell remap, Views, hierarchy, Advanced Permission, canonical verification, manual View parity, Dashboards, Workflows and final export verification.

## Live Formula failures

### Earlier full Formula create

A prior attempt to create `📣 MKT_Ads_Campaigns.budget` with the exported Formula property set was rejected by Lark with code `99992402`.

### Shell-staging attempt

At verified HEAD `3b7ee74b55aec459300f08fb6722cfe0ae69e552`, the adapter attempted:

`CREATE Formula shell without formula_expression → PUT full Formula → GET verify`

The CREATE itself was rejected before any Formula field was created:

```text
operator code  CUSTOMER_BASE_RESUME_FORMULA_SHELL_CREATE_REMOTE_REJECTED
operation      createFormulaShell
Table          📣 MKT_Ads_Campaigns
Field          budget
Field type     20 / Formula
propertyKeys   currency_code / formatter / type
HTTP           400
Lark code      99992402
```

This live evidence invalidated the shell-staging assumption for this Target.

## Current recovery implementation

The resumable adapter now follows the documented Formula model for a Base whose `formula_type` is `2`:

- require `formula_expression`;
- require `property.type`;
- canonicalize Formula result UI metadata into `property.type.ui_property`;
- avoid duplicating those type-2 UI keys at Formula-property top level;
- create the complete Formula once;
- immediately list/read back Fields and compare semantic mutation state;
- reuse an exact existing Formula on retry without write;
- retain the historical-shell PUT path only for a shell that is actually present;
- refuse to overwrite a different non-empty Formula expression.

The implementation deliberately stays inside `prepare-lark-base-resumable-target.js`; `consolidate-lark-base.js` remains the single migration engine and continues to own Formula Table/Field-ID remapping.

## Regression coverage

Focused and shared resumable-target tests now cover:

- direct Formula type-2 CREATE with `formula_expression + type.ui_property`;
- no follow-up PUT on fresh create;
- GET readback after create;
- exact Formula reuse with zero write;
- historical shell recovery without duplicate create;
- conflict on a different non-empty expression;
- `formula_type != 2` behavior;
- Source object immutability;
- safe redacted diagnostics if Formula CREATE is rejected.

## Verified code milestone

```text
HEAD  4f624207e2828b859d0e65c181d72d6a2aaa4d1e
Run   32254077830
Job   96071712121
PASS  all Branch Verification steps
```

This is a **code/CI milestone only**. The request-shape diagnosis remains a hypothesis until a controlled live recovery passes `📣 MKT_Ads_Campaigns.budget` on the customer Target.

## No-repeat rules

- Do not create a new checkpoint.
- Do not delete or recreate the 32 partial clone Tables.
- Do not delete migration-created partial Fields.
- Do not rerun old shell-staging code.
- Do not replay a failed historical Apply from a new baseline.
- Do not mutate Source, Worker, D1, Queue, schedule or deployment state in this recovery.
- Do not mark the Formula root cause confirmed until live Target evidence passes the failing field.

## Next evidence required

Run the controlled `--apply` only from the exact final CI-verified branch HEAD while validating the original checkpoint SHA. Preserve and return the complete operator JSON. The next decision must be based on the actual phase/code returned by that run rather than assuming later phases are complete.
