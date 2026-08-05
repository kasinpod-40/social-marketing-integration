# Project Brain — Multichannel Report Active Stability & Facebook DLQ Recovery

Date: `2026-08-05`

## Locked incident truth

The first Multichannel Report Run All attempt reached Facebook Organic 1D and stopped safely. The original Queue
job did not create a Reliability Sync Run or Report materialization. It produced exactly one open Report DLQ:

```text
DLQ ID       terminal:4c366c2b02ad5162c6e4035899d67abc
Message ID   4c366c2b02ad5162c6e4035899d67abc
Error code   DASHBOARD_REPORT_CONFIGURATION_INVALID
Error        Dashboard report requires a reviewed D1-primary job contract
Retry count  1
```

The retained replay payload SHA-256 equals the local reviewed job SHA-256:

```text
cee6c82f7732ab99d5f81d8e70c6108a33bed95b1b685d007c50d3f6122bd298
```

The exact target remained empty in D1 and Lark. Facebook Account Daily source facts stayed valid. Work and Lock
counts were zero. The Worker restored the existing active Notification Runtime baseline, while Notification
Admission, Schedule and Production remained disabled.

## Root cause decision

This incident is a Worker deployment-stability race, not a malformed job, missing source facts or materializer
identity defect.

The shared reviewed closeout operator deployed an Active Worker and performed one immediate exact version/flag/
binding readback before sending Queue work. The Queue message reached the DLQ roughly 110 seconds after admission,
consistent with consumption under the restored/baseline configuration where D1-primary Report reading is false.

An older exact TikTok configuration-DLQ recovery already proved the required correction: three stable Active
Worker observations before Queue submission. The generic reviewed remote verifier is the correct shared location
for that barrier.

## Locked architecture

```text
Reviewed retained handoff
→ shared Report Active Worker deployment
→ three stable exact deployment samples
→ exact Queue job
→ Shared Reliability + D1 materialization
→ Shared Lark writer
→ same-job replay
→ three stable preserved-baseline samples
```

No channel-specific Report engine, Queue framework, D1 writer, Lark sync engine or Reliability layer is added.

## Exact recovery authority

The Facebook recovery is pinned to:

```text
Original Head      158f881a61b3a41bb219b8990c59099777fb68f4
Platform           facebook
Capability         organic
Window             1D
Period end         2026-07-31
Source watermark   2026-07-28T10:01:10+0000
Requested-at       1785918760577
Report setting     integration_workspace:facebook:rolling:1d
Report ID          integration_workspace:facebook:rolling:1d:chemistry_k:rolling_days:2026-07-31:2026-07-31:facebook-organic-v1
DLQ                terminal:4c366c2b02ad5162c6e4035899d67abc
```

The recovery may submit exactly two Queue messages only after merge and Finalizer rerun:

1. the exact original first-materialization job once;
2. the exact same job once for replay/idempotency proof.

It must restore the preserved Notification Runtime baseline in `finally`. Only after successful materialization,
replay, D1/Lark parity and stable restore may it mark the exact DLQ/metadata recovery complete. The forensic row is
retained and not deleted.

## Forbidden actions

- rerunning the original Run All before exact recovery;
- manually recreating or modifying the Queue payload;
- using a new requested-at or Report ID;
- generic DLQ redrive or deletion;
- manually changing D1/Lark Report rows;
- rerunning the Notification Runtime smoke command;
- enabling Notification Admission, Schedule or Production.

## Next gate

After the hotfix is reviewed, exact-head CI passes and it is merged:

1. update the local clean main;
2. rerun Report Runtime Finalizer at the new exact Head;
3. execute the exact Facebook DLQ recovery once;
4. inspect the final recovery JSON;
5. rerun all SELECT-only readiness and rebuild the retained all-channel handoff;
6. resume the existing Run All path under the shared stable-deployment barrier.
