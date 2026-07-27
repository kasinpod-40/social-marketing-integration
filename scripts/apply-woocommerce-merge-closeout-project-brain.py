from pathlib import Path


PATH = Path('PROJECT_BRAIN.md')
text = PATH.read_text()


def replace_once(old, new):
    global text
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'PROJECT_BRAIN.md expected one match, found {count}: {old[:80]}')
    text = text.replace(old, new, 1)


replace_once(
    """YouTube final verification                    #581 PASS
Migration 0016                                source only / not applied remotely
Worker deployment                             not run for TikTok, Meta or YouTube rollout
Provider execution                            not run for Meta or YouTube rollout
Queue send / DLQ redrive                      none for TikTok, Meta or YouTube rollout
Remote D1 / Lark mutation                     none for TikTok, Meta or YouTube rollout""",
    """YouTube final verification                    #581 PASS
Chatwoot analytics foundation                 merged via PR #68
Chatwoot foundation merge commit              80601de973740e8654b2cea2c4ecf419f4378c0a
Chatwoot foundation verification              #619 PASS
WooCommerce end-to-end integration            merged via PR #94
WooCommerce integration merge commit          060977cd9ed2933700fbd121c9236e6578ad571e
WooCommerce reviewed Integration head         d0ce3399177b5d6c8fcdb6c56eadd77851ae29e9
WooCommerce final verification                #622 PASS
Migration 0016                                source only / not applied remotely
Migration 0017                                WooCommerce source only / not applied remotely
Worker deployment                             not run for TikTok, Meta, YouTube, Chatwoot or WooCommerce rollout
Provider execution                            not run for Meta, YouTube, Chatwoot or WooCommerce rollout
Queue send / DLQ redrive                      none for TikTok, Meta, YouTube, Chatwoot or WooCommerce rollout
Remote D1 / Lark mutation                     none for TikTok, Meta, YouTube, Chatwoot or WooCommerce rollout""",
)

replace_once(
    """MKT_YOUTUBE_END_TO_END_ENABLED=false
MKT_YOUTUBE_LARK_WRITE_ENABLED=false
MKT_REPORT_D1_SHADOW_READ_ENABLED=false""",
    """MKT_YOUTUBE_END_TO_END_ENABLED=false
MKT_YOUTUBE_LARK_WRITE_ENABLED=false
MKT_CONNECTOR_WOOCOMMERCE_ENABLED=false
MKT_WOOCOMMERCE_D1_WRITE_ENABLED=false
MKT_WOOCOMMERCE_LARK_WRITE_ENABLED=false
MKT_WOOCOMMERCE_REPORT_READ_ENABLED=false
MKT_WOOCOMMERCE_FULL_RECONCILIATION_ENABLED=false
MKT_SCHEDULE_WOOCOMMERCE_ENABLED=false
MKT_REPORT_D1_SHADOW_READ_ENABLED=false""",
)

replace_once(
    """YouTube Organic      integration PR #85 merged / Remote read-only preflight pending
Chatwoot             separate Draft PR
WooCommerce          separate Draft PR
Google Ads           complete / safely closed""",
    """YouTube Organic      integration PR #85 merged / Remote read-only preflight pending
Chatwoot             foundation PR #68 merged / Runtime Wiring waits after Migration 0017 owner
WooCommerce          integration PR #94 merged / Migration 0017 and Remote rollout pending
Google Ads           complete / safely closed""",
)

replace_once(
    """Provider execution has not run and remains a separate explicit gate.

## Default-false controls""",
    """Provider execution has not run and remains a separate explicit gate.

## Merged Chatwoot analytics foundation

PR `#68` merged the reviewed bounded Chatwoot polling and analytics foundation at
`80601de973740e8654b2cea2c4ecf419f4378c0a`. It adds PII-minimized source collection,
stable identity/revision handling, bounded D1/Coverage preparation and optional existing
`TableSyncEngine` delivery. Runtime routing and a numbered Chatwoot migration remain separate work.

WooCommerce Integration owns Migration `0017`; Chatwoot Runtime Wiring must refresh the migration
directory and currently treats its later migration as provisional `0018`.

Detailed closeout:

```text
docs/project-brain/chatwoot-foundation-merge-closeout-2026-07-27.md
```

## Merged WooCommerce integration

PR `#94` merged the reviewed WooCommerce End-to-End implementation and Shared protected wiring at
`060977cd9ed2933700fbd121c9236e6578ad571e` after Branch Verification `#622` passed.

Merged contracts include:

- read-only WooCommerce REST transport with HTTPS and header-only Basic authentication;
- PII-minimized Commerce models and exact currency micros;
- immutable continuation scope, source-revision gating and atomic Order-line replacement;
- additive D1 RAW/Canonical/Daily facts and Coverage-backed reports;
- stable Queue work identity `woocommerce:<operationId>`;
- protected `uat_pending` / `manualOnly` routing;
- existing Reliability, lock, Queue retry/DLQ, Coverage and `TableSyncEngine` reuse;
- additive source Migration `0017_woocommerce_commerce.sql`;
- all Connector, D1, Lark, Report, full-reconciliation and Schedule controls default `false`.

The merge performed no Provider request, credential use, Remote D1/Lark mutation, Queue action,
Worker deployment, Schedule, LIVE UAT or Production change.

Detailed closeout:

```text
docs/project-brain/woocommerce-integration-merge-closeout-2026-07-27.md
```

## Default-false controls""",
)

PATH.write_text(text)
