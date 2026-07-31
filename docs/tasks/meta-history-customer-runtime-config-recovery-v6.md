# Meta History Customer Runtime Config Recovery v6

## Incident

The seventh one-time Meta history Terminal attempt passed local verification, Cloudflare readiness, Remote
all-false state and the ordered GET-only Meta customer identity validation. It then entered the first
Facebook July operation and stopped before D1 preflight Remote activity with:

```text
META_D1_ONLY_SOURCE_MAPPING_INVALID
Meta D1-only config requires a pinned Meta Graph API version
```

The D1 operator rejected the reviewed generated Wrangler config while loading the target. No D1 backup,
Worker deployment, Queue admission, D1/Lark Business write, Schedule mutation or Production action occurred.
The outer closeout verified all Worker execution flags false and no emergency restore was required.

## Root cause

The process environment and generated deployment config diverged.

The read-only phase received temporary process-only overrides for the approved Chemistry K API version and
identity mappings. The D1/Lark phases validate `vars` in their reviewed Wrangler config before they build or
deploy an execution window. The Safe config did not contain the same customer authority, so the D1 target
loader rejected it before Remote action.

This is not a Meta credential, permission, Page, Instagram, Ad Account or Provider failure. The same
credential set had just passed the ordered GET-only validation.

## Decision

Use one Shared non-secret runtime authority across Terminal, D1 and Lark:

```text
MKT_ENV=development
MKT_CUSTOMER_PROFILE=integration_workspace
MKT_CONNECTION_CUSTOMER_KEY=chemistry_k
META_GRAPH_API_VERSION=v25.0
approved Facebook Page mapping
approved Instagram Professional Account mapping
approved chemistry_k2 and chemistry_k3 Ad Account mappings
META_AD_ACCOUNT_ID=""
```

Tokens and other credentials remain outside this authority.

## Runtime sequence

```text
caller environment
→ apply exact customer runtime authority
→ close every reviewed execution flag false
→ guarded one-command child
→ read original private Safe Wrangler config
→ replace all stale authority values
→ insert all missing authority values
→ validate exact config values
→ write private 0600 runtime config under ignored outputs/
→ D1 launcher and Lark launcher use the same reviewed runtime config
```

The runtime config is created beside the original Safe config so it remains inside the Repository path
boundary while staying outside Git status. It is retained with the Head-bound evidence and never contains
credentials.

## Safety properties

- No `.dev.vars` mutation.
- No Secret value copied into Source, config or evidence.
- Existing stale non-secret identities are replaced, not left as duplicate alternatives.
- Missing mappings and API version are inserted.
- Legacy single-account Meta Ads mapping is explicitly empty.
- D1 and Lark launchers apply the same authority independently before starting their operators.
- Generated config validation fails closed before Remote action if any exact value is missing or duplicated
  with a different value.
- Schedule remains disabled and Production remains blocked.

## Acceptance criteria

```text
process customer authority                              exact
reviewed runtime config customer authority              exact
META_GRAPH_API_VERSION                                  v25.0
Facebook / Instagram mappings                           exact approved values
Meta Ads aliases                                        chemistry_k2, chemistry_k3
legacy single Ad mapping                                empty
stale mapping values                                    absent
runtime config                                          repository/outputs + 0600
D1 / Lark launcher authority                            shared
credentials in generated config                         0
.dev.vars writes                                        0
Remote action during implementation/CI                  0
focused runtime authority tests                         PASS
Meta End-to-End Verification                            PASS
Branch Verification                                     PASS
full Unit/Workers, Report, audit, Wrangler dry-run       PASS
```

## Live continuation boundary

The prior attempt did not admit the Facebook operation and produced no Queue attempt. After merge and
execution handoff, the public Terminal may be run once from exact clean current `main`. Every prior evidence
directory must remain untouched.

If a future attempt reaches Queue admission or any deployment phase and then stops, do not blindly rerun;
inspect the exact operation evidence and Remote all-false/idle state first.
