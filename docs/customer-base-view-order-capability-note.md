# Lark Grid View field-order capability note

Checked against the documented Grid View JS SDK surface used by the customer Base UI-runner lane.

Documented read capability:

- `getFieldMetaList()` returns field metadata ordered as it appears in the UI.
- `getVisibleFieldIdList()` returns visible field IDs.

Documented write capabilities include filter, sort, group, show/hide, width, row height and `applySetting()`.

No documented Grid View method is exposed for reordering an existing view's field/column sequence. Therefore this workstream must not invent or send an undocumented field-order payload against the customer Base.

Consequence: field order must be treated as an explicit parity gate even when its final closeout requires UI interaction. Future migrations should minimize this remainder by creating table fields in the Source primary/default operational-view order and verifying every Source per-View order before declaring parity.
