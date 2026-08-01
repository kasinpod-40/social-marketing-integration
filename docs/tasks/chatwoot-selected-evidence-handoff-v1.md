# Chatwoot Selected Evidence Handoff v1

## Incident

The safe-baseline wrapper successfully selected one retained controller identity and proved the exact queue-exhausted
D1 boundary. After promoting the retained active Worker version, the existing arbitration child rescanned two
incomplete evidence identities that both referenced that active version and stopped with
`CHATWOOT_CONTROLLER_EVIDENCE_ACTIVE_VERSION_AMBIGUOUS`.

The parent then restored and verified all execution flags false. No Provider, Queue, Remote D1, Remote Lark or incident
closure action occurred.

## Correction

Use the already-written current-head `01-active-window.attempt.json` as a verified selection handoff. The child validates
its exact repository Head, contract, boundary, no-mutation fields and three identity fingerprints, then intersects that
handoff with the still-required current active Worker version.

The handoff does not grant mutation authority. It only prevents the child from discarding the parent's exact selection.
The existing isolated evidence clone and Initial terminal recovery launcher remain the sole recovery path.

## Fail-closed behavior

- No handoff file: preserve the original active-version-only selector.
- Invalid, symlinked or non-private handoff: stop before recovery child start.
- Handoff matches zero or multiple candidates: stop as ambiguous.
- Current Worker does not expose the exact Chatwoot Final UAT flags: stop.
- No candidate is selected by timestamp or newest directory.
- No retained evidence is edited, renamed or deleted.
- No second Initial admission, Queue endpoint, D1 mutation SQL or Lark write is added.
- Schedule and Webhook remain disabled; Production remains blocked.

## Required tests

- two distinct candidates sharing one active version remain ambiguous without a handoff;
- the exact safe-baseline handoff selects one candidate by session and version fingerprints;
- mismatched handoffs fail closed;
- the handoff validator rejects any mutation-authorizing or wrong-head field;
- plan-only and static authority checks retain the isolated exact-main recovery path;
- full repository, report reliability, audit and Wrangler dry-run gates pass.
