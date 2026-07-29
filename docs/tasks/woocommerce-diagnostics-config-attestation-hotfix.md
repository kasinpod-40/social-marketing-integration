# WooCommerce Diagnostics Config Attestation Hotfix

## Status

```text
TASK_STATUS                         = READY_FOR_CI
PROGRAM                             = WOOCOMMERCE_WORKER_PROVIDER_DIAGNOSTICS
INCIDENT_CODE                       = WOOCOMMERCE_WORKER_PROVIDER_DIAGNOSTICS_RUNTIME_VERSION_MISMATCH
EXPECTED_ACTIVE_VERSION             = 0d87c498-b53b-4d85-bc50-6ee9381d06ee
OBSERVED_RESPONSE_VERSION           = null
PROVIDER_REQUEST                    = 0
BUSINESS_MUTATION                   = 0
QUEUE_MESSAGE                       = 0
LARK_REQUEST                        = 0
SCHEDULE_MUTATION                   = 0
PRODUCTION                          = BLOCKED
```

## Verified incident

The second authorized diagnostics attempt still failed before Provider access after Active and Safe configs materialized `version_metadata.binding=CF_VERSION_METADATA`.

The response lacked `x-mkt-worker-version-id` for both the diagnostic-only deployment and the automatic Safe restore. The shared deploy flow had already verified the just-deployed version as the sole 100% active version and verified the exact true execution-flag set before making the public HTTP probe.

Therefore:

- the Provider was not called;
- the Safe deployment reached zero true execution flags;
- the unresolved proof was public-route response attribution;
- runtime-version response metadata cannot remain the sole HTTP safety gate for this operator.

## Root cause

The operator already deploys each generated config as the sole 100% active Worker version and verifies the exact version and flags through the Cloudflare control plane.

It then required a `Cloudflare-Workers-Version-Overrides` request to return `CF_VERSION_METADATA.id` as a custom response header. Cloudflare documents that an override can fail to apply and is intended to select a version from the current deployment. Using that optional request-routing feature as a mandatory second proof added an independent failure mode without improving the already-completed 100% deployment proof.

The HTTP proof also had no generated config identity independent from runtime metadata, so a missing header could not distinguish Worker routing, an upstream response or metadata omission.

## Implementation

Generated Active and Safe configs now receive separate random 256-bit hexadecimal attestations:

```text
MKT_WOOCOMMERCE_PROVIDER_DIAGNOSTICS_ATTESTATION
```

The guarded route returns the exact attestation only in:

```text
x-mkt-woocommerce-diagnostics-attestation
```

for matched-route responses including 401, 404, 200, 400 and 422.

The operator now requires all of the following before the authenticated Provider GET:

1. the just-deployed version is the sole 100% active version;
2. the exact inspected version has only the approved true execution flags;
3. three public route probes return HTTP 401;
4. every response returns the exact Active config attestation.

Safe restore requires:

1. the just-deployed Safe version is the sole 100% active version;
2. the exact inspected Safe version has zero true execution flags;
3. three route probes return HTTP 404;
4. every response returns the exact Safe config attestation.

Active and Safe attestations must differ. The Safe config contains no ephemeral authorization digest. The attestation is non-secret, does not authorize the route and is replaced by the next generated config.

## Failure evidence

Attestation mismatch output is bounded to:

- expected and observed attestation fingerprints;
- whether a valid observed attestation existed;
- HTTP status;
- content type;
- server header;
- presence of `cf-ray`;
- exact deployed version and control-plane proof booleans.

No body, authorization value, credential, unrestricted headers or attestation value is persisted in failure evidence.

Safe restore reporting now separates:

```text
controlPlaneSafeRestored
httpClosureAttested
restoredSafeVersion
```

so an HTTP proof failure cannot hide a successful all-flags-false control-plane restore.

## Acceptance criteria

- Active and Safe configs contain different valid attestations.
- Safe config has zero true execution flags and no token digest.
- Active config has only the diagnostics flag and one token digest.
- Route responses expose the attestation header but never include it in JSON.
- Missing attestation fails before Provider access.
- HTTP retries are bounded and stop on the expected attestation.
- Version override headers are absent from the operator and launcher.
- Exact version and exact flag checks remain mandatory through Wrangler control-plane reads.
- Failure output reports actual Worker deployment and Provider request counts.
- No Queue, D1, Lark, Schedule or Secret mutation path is added.

## Live boundary

Implementation and CI perform no Worker deployment or Provider request. A new diagnostic execution still requires Squash Merge and separate explicit authorization. Final rollout resend and recovery of `woo-final-full-6f43ac8ee857` remain blocked until the diagnostic result is reviewed.
