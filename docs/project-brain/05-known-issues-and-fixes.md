# 05 — Known Issues and Fixes

## Known risk: Native integration overwrites rows
Native sync may update current rows instead of creating daily history. Mitigation: create daily snapshot tables and run snapshot jobs.

## Known risk: metric naming mismatch
Unique viewers must not be called reach unless confirmed by platform definition. Target ROAS must not be treated as actual ROAS.

## Known risk: API permission and app review delays
Production access and app review are not included in the 14-day dev estimate. Use client-owned production resources and native integrations where possible.

## Known risk: partial platform failures
One platform failure must not block other platforms. Mitigation: platform-scoped jobs, retry, DLQ, and sync logs.
