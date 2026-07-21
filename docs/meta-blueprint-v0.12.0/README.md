# Meta Blueprint v0.12.0 — Approved Source Contract

Approved by the user on `2026-07-21` for Lark UAT schema application only.

This directory is the source-controlled text representation of the approved workbook. It covers table inventory, field dictionaries, Raw-to-Canonical mapping, stable keys and metric contracts, UAT gates, approval decisions and source traceability.

The approval does not authorize connector implementation, live source API calls, destination business-data writes, Cloudflare rollout, advertisement creation or spend.

Files:

- `table-inventory.csv`
- `facebook-organic-fields.csv`
- `instagram-organic-fields.csv`
- `meta-ads-fields.csv`
- `canonical-account-daily-fields.csv`
- `mapping.csv`
- `keys-metrics.csv`
- `uat-checklist.csv`
- `approval.csv`
- `sources.csv`

User-facing workbook handoff:

- `Social_MKT_Data_Hub_Meta_Blueprint_v0.12.0_APPROVED.xlsx`
- SHA-256: `4c49148b84051b221cdf4eca7b16315421e03812e6d058bb6ac4978a531bc02d`
- The binary workbook is delivered outside GitHub; this directory is the durable source-controlled contract.

Canonical decisions:

- 14 Meta Raw/source tables.
- New `MKT_Account_Daily` for Page/Account daily metrics.
- Existing Organic canonical tables are reused.
- Existing Canonical Ads v2 tables are reused.
- Meta Ad Set maps to canonical Ads Ad Group.
- Instagram `/me` identity is authoritative.
- Observed zero remains zero; missing or unsupported remains null or absent by contract.
- Organic dates use `Asia/Bangkok`; Ads dates use the Ad Account timezone.
- Ads actions remain structured until a later approved conversion mapping.
