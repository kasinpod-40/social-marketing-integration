# Lark Weekly 7D Factual Source Diagnostics v1

Date: 2026-08-09

## Incident

The first post-#557 read-only full-channel preview correctly rendered nine channel sections, but only Meta Ads contained business facts even though the accepted V9 source Report list also contained Facebook Organic, Instagram Organic and WooCommerce Report IDs.

Do not send the corrected notification until this difference is classified. A source Report identity does not by itself prove that usable summary business facts exist.

## Objective

Add a bounded read-only diagnostic that reuses the exact weekly Report collector and explains, per approved channel, why factual evidence is or is not eligible for the deterministic notification composer.

## Contract

For each of the nine channels report:

- exact source Report presence and ID;
- Report `dataStatus`;
- total Metric Value rows;
- usable summary metric count and bounded metric keys;
- rejected counts for non-summary scope, non-summary dimension, unavailable metric and null current value;
- bounded rejected metric samples containing metric key + rejection reason only;
- Top Content / Top Ads total and real non-placeholder counts;
- final `hasBusinessFacts` and deterministic `emptyReason`.

## Remote boundary

The terminal allows only:

- Lark tenant token POST;
- Lark table inventory GET;
- Lark record list GET;
- Lark record search POST.

Every other Lark request is blocked before transmission. There are no record create/update methods, Queue calls, Worker deployment, Automation mutation, D1 mutation or Schedule action.

## Decision gate

- If Facebook / Instagram / WooCommerce have no usable facts because the materialized Report itself is `no_data_confirmed`, unavailable or null, keep the composer unchanged.
- If usable business facts exist but are rejected by an incorrect scope/dimension/availability assumption, fix only that factual-composer contract and rerun read-only preview.
- Do not execute the corrected notification until this diagnostic is reviewed.

`docs/current-task.md` remains untouched because the active Chatwoot workstream owns it.
