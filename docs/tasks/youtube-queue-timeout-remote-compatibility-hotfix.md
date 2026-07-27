# YouTube Queue Timeout Remote Compatibility Hotfix

## Status

```text
BASE_MAIN_SHA                   = 197be38956222ed536560eb30aad9500f7643097
BRANCH                          = hotfix/youtube-queue-max-wait-time-ms
REMOTE_ACTIONS_DURING_HOTFIX    = NONE
```

## Root cause

Cloudflare Queue Consumers API returns Worker push-consumer wait time as
`settings.max_wait_time_ms`. The strict YouTube Remote validator compares seconds through
`max_batch_timeout`. The live compatibility adapter handled omitted Queue names and D1 display names but
did not normalize this official API field.

## Implementation contract

- normalize exact integer milliseconds into whole seconds before delegation to the strict validator;
- accept top-level or `settings` representations only when duplicate values agree;
- preserve the existing explicit-seconds representation;
- reject negative, non-integer, fractional-second and conflicting values;
- never infer a missing Remote timeout from Local configuration;
- preserve all existing Queue identity, D1 UUID, flag, Secret, trigger, traffic and fingerprint checks.

## Required tests

- `max_wait_time_ms=30000` produces `max_batch_timeout=30`;
- the normalized value passes the existing strict Queue consumer parser;
- legacy explicit seconds remains supported;
- negative, non-whole-second and conflicting values fail closed;
- absent timeout remains absent and the strict parser still blocks;
- unrelated YouTube/TikTok/Core tests and standard Repository gates pass.

## Out of scope

- Worker deployment or rollback;
- Queue send/Ack/Retry/DLQ action;
- Remote D1 write or Migration apply;
- YouTube or Lark request;
- Schedule, route, workers.dev or Secret mutation;
- Production.
