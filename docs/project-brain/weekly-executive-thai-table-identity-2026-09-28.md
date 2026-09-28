# Weekly Executive Thai table identity — 2026-09-28

The scheduled Weekly Executive report for 2026-09-21..27 failed before Work creation and before notification delivery with `LARK_NATIVE_AI_WEEKLY_7D_CONTROLLED_UAT_TABLE_INVALID`. The existing source collector required English decorated display names. The customer intentionally renamed the six Report tables to Thai.

The customer-provided Base export token equals the exact Worker Production Base token. Each of the six Production D1 runtime-configured table IDs matches one of the six scoped Report tables in that export. The candidate Worker path now uses these stable IDs rather than names and avoids whole-Base table enumeration. Missing, malformed and duplicate IDs fail before record reads. The existing AI/notification safety gates and once-only delivery contract remain unchanged.

This is an offline export plus Production D1/Cloudflare GET verification. The local Lark App receives HTTP 403 for live Production Base reads. No Production deploy or failed-job recovery has been performed; after reviewed deployment, verify exact period source, quality gate, zero prior delivery and one guarded recovery before asserting that the Monday report was sent.
