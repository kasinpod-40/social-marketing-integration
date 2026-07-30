# WooCommerce Orphaned-running Recovery — Review Checklist

- [ ] Exact operation, Work key and generation are pinned.
- [ ] Two read-only snapshots prove 30-second stability.
- [ ] Mutation targets only one `sync_runs` row.
- [ ] Durable Work/Phase/Fence/Queue/Coverage/Business facts remain immutable.
- [ ] No Queue, Provider, Lark, Worker deploy, Schedule or Production path exists.
- [ ] Existing exact continuation accepts the recovered retryable state.
- [ ] Full Repository gates and exact-head Branch Verification pass.
