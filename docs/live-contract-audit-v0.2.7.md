# Live Contract Audit v0.2.7

This audit compared the current code, the current `Social MKT Data Hub` export, and the TikTok sync path.

## Confirmed source shapes

- Text: arrays such as `[{ type: "text", text: "..." }]`
- URL: arrays such as `[{ type: "url", link: "https://...", text: "..." }]`
- Date/time: epoch milliseconds
- Numbers: primitive numbers

## Fixed risks

1. URL arrays were not decoded by v0.2.6.
2. Rich text arrays could be coerced incorrectly or lost.
3. `metric_date` used a date-only string although Lark expects DateTime epoch milliseconds.
4. The source content URL could be misclassified as `cta_destination`.
5. Select option values were not checked before writes.
6. Validation normalized data but did not run the production serializer against live schemas.
7. Source rows could be written under the wrong account identity.

## Current Base issues requiring operator action

- The 20 RAW TikTok rows in the supplied Base export belong to `@ft.pumkin`, not `@chemistry_k`.
- `MKT_Content.course_level` is missing dictionary outputs `DEK73` and `ม.3`.

The connector now fails safely instead of writing inconsistent data.
