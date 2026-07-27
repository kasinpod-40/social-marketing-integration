# TikTok Audit Exact-Version Invocation Hotfix — 2026-07-27

## Verified Remote incident

```text
Audit-only unauthenticated probes      401 / 401 / 401
Authenticated Audit HTTP               404
Authenticated remote code              TIKTOK_POST_LARK_AUDIT_FAILED
Audit evidence                         missing
Emergency safe-close                   PASS
Safe-close probes                      404 / 404 / 404
Safe-close Worker version              388479ba-037b-4a89-942f-dad176311f93
Queue or Business write                none
Current Remote state                   safe-closed
```

The authenticated request did not reach the guarded Audit logic because the disabled route contract returns `404`; a rejected operator token would return `401`, while an Audit dependency failure would return `400`. The preceding status-only probes therefore did not prove that the authenticated request would execute on the same Wrangler deployment version.

## Repository decision

Open a Repository-only hotfix that binds every probe and authenticated Audit request to the exact Wrangler `deploy.version_id`, and requires Worker Version Metadata attestation on every guarded response.

Cloudflare's `Cloudflare-Workers-Version-Overrides` request header is used only with the exact reviewed Worker name and version UUID. The guarded route exposes a single non-secret `x-mkt-worker-version-id` response header derived from the `CF_VERSION_METADATA.id` binding. Missing or mismatched identity fails closed.

## Safety boundary

This record and implementation authorize no Worker deployment, Secret rotation, Remote Audit retry, Queue/DLQ action, D1/Lark mutation, schedule activation, retention/delete or Production action. Runtime remains safe-closed until a later merge and separately approved all-flags-false deployment gate.
