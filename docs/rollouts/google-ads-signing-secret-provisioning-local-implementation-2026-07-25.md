# Google Ads Signing Secret Provisioning — Local Implementation Closeout

Date: `2026-07-25`

## Authority and baseline

```text
BASELINE_MAIN              = ddfcf600a6fd1125188c5cc7e7e265858c037ed8
IMPLEMENTATION_BRANCH      = codex/google-ads-secret-provisioning-local
DRAFT_PR                   = #55
VERIFIED_SOURCE_COMMIT     = b7ac4029aa07c020f8cb8e6423832d0668fffbc4
BRANCH_VERIFICATION_RUN    = 30158898274
IMPLEMENTATION_SCOPE       = LOCAL_SOURCE_AND_TESTS_ONLY
REMOTE_MIGRATION           = NOT_APPLIED
WORKER_DEPLOYMENT          = NOT_RUN
TICKET_CREATION_OR_REDEEM  = NOT_RUN
SIGNING_SECRET_CHANGE      = NOT_RUN
```

This additive closeout follows the approved Design in
`docs/google-ads-manager-script-signing-secret-provisioning-design-v1.md` and
preserves all existing Current Task, Project Brain, README and CHANGELOG facts
without replacing or deleting them.

## Implemented source

- exact canonical redeem/confirm contract bound to environment, profile,
  Manager, advertiser, customer key, account key and Key ID;
- Web Crypto helpers for 256-bit one-time Ticket, 256-bit challenge,
  fingerprint-only persistence and HMAC confirmation proof;
- guarded application-level `create_one_ticket` operator that refuses execution
  without exact explicit approval and returns plaintext only after fingerprint
  persistence succeeds;
- additive Migration `0014_google_ads_signing_secret_provisioning.sql`;
- atomic D1 lifecycle `active -> redeemed -> confirmed`, expiry and cancellation;
- `POST /v1/google-ads/manager-script/signing-secret/redeem`;
- `POST /v1/google-ads/manager-script/signing-secret/confirm`;
- independent `MKT_GOOGLE_ADS_SECRET_PROVISIONING_ENABLED` flag, default false;
- placeholder-only temporary Google Ads Manager Script helper that pins the exact
  schema/routes, refuses redirects, uses a SHA-256-derived 128-bit client nonce,
  validates exact response fields and unconditionally removes both Script
  Properties when confirmation cannot complete.

There is intentionally no HTTP Ticket-creation endpoint. The guarded operator
exists only as an application primitive; no Ticket was created or used in this
task.

## Security properties

- disabled routes return `404` before D1 or Signing Secret loading;
- one Ticket is atomically redeemable once and expires within five minutes;
- D1 stores only Ticket, identity and challenge fingerprints, non-secret Key ID
  and lifecycle timestamps;
- plaintext Ticket is returned only after its fingerprint row is verified;
- request JSON must be canonical and contain the exact field set;
- successful redeem is the only response containing the Signing Secret;
- confirmation response contains only sanitized status;
- Ticket, Secret, proof, challenge, raw request body and customer identities are
  excluded from operational logs;
- helper contains placeholders only, disables redirect following and cannot
  enable delivery, create a trigger or mutate Google Ads.

## Verification

GitHub Actions Branch Verification run `30158898274` completed successfully on
verified source commit `b7ac4029aa07c020f8cb8e6423832d0668fffbc4`:

```text
Syntax architecture and hygiene      PASS
Focused staged TikTok regression     PASS 4/4
Unit tests                            PASS 780/780
Workers runtime tests                 PASS 9/9
Report reliability regression        PASS 70/70
Dependency audit                      PASS / 0 vulnerabilities
Wrangler deploy dry-run               PASS
```

## Preserved gates

The following remain disabled/not performed:

- Remote D1 Migration `0014`;
- API Worker deployment;
- provisioning feature flag;
- Ticket creation, redeem or confirmation against a Remote Worker;
- Signing Secret or Script Properties changes;
- signed ingress and signed PREVIEW/LIVE delivery;
- Queue, Sync processing, Business D1/Lark writes;
- schedules, Production and Google Ads mutation/spend.

## Next approval boundary

Review PR `#55`. Merge, Remote D1 backup/Migration, API Worker deployment,
feature-flag opening, one-time Ticket creation and signed PREVIEW are separate
gates and must not be combined implicitly.
