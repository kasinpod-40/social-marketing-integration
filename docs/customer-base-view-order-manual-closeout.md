# Customer Base manual View field-order closeout

Use the generated checklist `Lark_View_Field_Order_Parity_Checklist.xlsx` from the working session as the operator reference.

## Operator sequence

1. Work only inside `Setup Phase | Social MKT Data Hub`.
2. Open each Pending grid view.
3. Open `Customize Field`.
4. Drag fields to the exact Source order recorded for that view.
5. Do not toggle visibility while dragging.
6. Do not modify filter, sort, group, row height or width.
7. Do not touch `🎵 RAW_TikTok_Creator_Videos`.
8. Mark the checklist row `Done` only after the full sequence is visually exact.
9. Skip every `🔄 MKT_Sync_Log` view because those five are already exact.
10. After all Pending rows are done, export the Target `.base` and run a read-only comparison.

## Efficient batching

Perform tables whose views share a single Source order profile consecutively. The current closeout begins with:

- `🎬 MKT_Content` — 5 views, one Source order profile.
- `📅 MKT_Content_Daily` — 5 views, one Source order profile.

Continue using the checklist's Batch/Priority order. This minimizes context switching and reduces the chance of dragging a field according to the wrong table profile.

## Acceptance

Field-order lane closes only when the final exported Target reports:

- `fieldOrderMismatchCount = 0`
- `missingTargetViewCount = 0`
- `extraTargetViewCount = 0`

Width is not part of this acceptance.
