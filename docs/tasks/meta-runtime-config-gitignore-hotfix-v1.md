# Meta Runtime Config Gitignore Hotfix v1

## Incident

The Meta D1/Lark compatibility launchers materialize `wrangler.meta-history.runtime.jsonc` in the repository root before invoking the guarded rollout operator. The operator then checks `git status --porcelain --untracked-files=all` and rejects the rollout as a dirty Working Tree when the generated runtime config is not ignored.

Observed live boundary:

- Meta read-only validation: PASS
- Active Worker version resolution: PASS
- Facebook D1 preflight: blocked before mutation with `META_D1_ONLY_CONTINUATION_REPOSITORY_INVALID`
- Business writes: 0
- Worker deployments: 0
- Queue messages: 0

## Fix

Treat the generated repository-root runtime config as local generated state by ignoring exactly:

`/wrangler.meta-history.runtime.jsonc`

Do not ignore arbitrary Wrangler configs and do not weaken the operator clean-tree gate.

## Safety

Repository-only hotfix. No Provider request, D1/Lark mutation, Queue send, Worker deployment, Schedule activation, Secret change, or Production action.
