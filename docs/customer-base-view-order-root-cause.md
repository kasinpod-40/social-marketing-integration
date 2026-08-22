# Root cause — customer Base View field order

The defect was introduced during Target creation because the migration treated canonical table field order as if it were sufficient to reproduce each Source View's displayed column order.

That assumption is invalid:

- A Lark table has a field schema.
- Each grid View has its own UI field sequence.
- Source authority preserves that per-View sequence.
- Creating the right fields and the right View filters/sorts/groups does not guarantee that the View displays those fields in Source order.

The prevention change is to make per-View field order a blocking read-back gate. Future migrations should also create table fields in the Source primary/default operational-view order when possible so that views sharing the default order inherit a useful initial sequence instead of an arbitrary/canonical schema sequence.

This is a migration-planning defect, not a record-data defect. Existing customer records must not be rewritten to close it.
