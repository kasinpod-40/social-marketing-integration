# Customer Weekly message format correction — 2026-09-23

## Objective

Correct the Customer Weekly Executive message for `2026-09-14..2026-09-20` without inventing facts and make the same message-format contract apply to future automatic Weekly delivery.

## Source authority

- Numeric facts come only from exact retained Customer PROD D1 Report materializations for the seven-day period.
- Manual correction is a delivery transport only. It must not hand-edit or hardcode business metric values.
- The retained generated Executive AI row may supply strengths, weaknesses and recommendations only after the shared factual quality gate accepts the in-memory delivery projection.
- The generated AI source row is immutable.

## Shared delivery format

- Count metrics whose identity is Views render with `ครั้ง`, never multiplier language `เท่า`.
- Follower counts render with `คน`.
- A parenthetical numeric increase/decrease must carry `%`.
- Required numeric facts must remain attached to their factual channel.
- When the AI overview violates those rules, the automatic runtime may replace only the in-memory overview with a deterministic three-channel factual projection and then rerun the unchanged complete quality gate.
- The deterministic overview preserves up to four decimal places for comparison percentages, so a factual `0.4743` change is rendered as `(เพิ่ม 0.4743%)`.
- Organic channel sections render only the highest-ranked in-period Content (`Content #1`) for each platform.
  Additional retained candidates remain available as bounded evidence but are not shown to the customer.
- Paid Ads keep the existing maximum of three rendered candidates per channel.

## One-off correction transport

The correction operator uploads an isolated Cloudflare Preview version only. Production traffic remains on the active Production version.

Preview mode:

- reads Customer PROD D1 and the exact retained AI row;
- resolves the reviewed `Chemistry K — Marketing Alerts` destination by visible name plus immutable hash;
- reuses one existing inactive connector-selector plain-text binding for the random Preview authorization hash,
  so the isolated version stays within Cloudflare's 250 plain-text binding limit without copying a secret;
- returns the full message preview and hashes;
- performs zero D1 writes, zero Lark Base writes, zero Queue admissions and zero message sends.

Send mode:

- requires a separate exact confirmation;
- checks whether the exact corrected message is already visible when the destination bot has group-message
  history scope; if that scope is absent, it fails closed unless the operator has explicit approval to use the
  fixed request UUID as the one-off duplicate guard;
- sends at most one direct Lark text message with that idempotent UUID;
- does not delete or recall earlier customer messages;
- does not alter Report Settings, Automation, Queue/D1 delivery state or Production Worker traffic.

## Completed correction

- Exact-period source selection accepted the newest retained formula revision for the same structural Report
  identity, recovering the immutable YouTube `youtube-organic-v2` source while the branch registry names `v1`.
- Isolated Preview version `be0d54a9-6e40-49b8-904a-e6dd8c3f7081` read all eight exact Customer PROD Report
  materializations and passed the unchanged complete quality gate.
- After the user reviewed the full message and explicitly approved the fixed-UUID fallback, the correction was
  delivered exactly once with `sendDisposition=sent_once`, `messageSendCount=1`, message hash
  `a08f543023749aa27e2a3a3b5f17dab040ea41fbfc5f3111e0258079ba54a1d7` and hashed message receipt
  `fcad1fbd8805f603c7ae1379224042ab896847ea18c28e949f3b25f51298d23b`.
- Customer Production traffic remained on `e065d760-30fa-4644-834a-d9ef3325fb95`; the correction performed zero
  D1 writes, zero Lark Base writes and zero Queue admissions.

## Completion gates

1. Shared formatter and AI quality regressions pass.
2. Full Branch Verification passes.
3. Isolated Customer PROD preview returns the exact period and a reviewed message body with correct channel ownership, units and `%` formatting.
4. Only after preview review may the one-off send confirmation be used.
5. The shared formatter remains in `main`, so the next automatic Weekly uses the same format guard.
