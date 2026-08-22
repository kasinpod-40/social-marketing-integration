# Root cause — customer Base View field order

The defect was introduced because the migration treated canonical table field order and hidden-field parity as sufficient to reproduce each Source View's displayed column order.

That assumption is invalid:

- a Lark table has a field schema order;
- each grid View has its own visible column sequence;
- Source authority preserves per-View field order;
- creating the correct Fields plus filters/sorts/groups does not guarantee Source display order.

A second factor hid the defect: the shared Base v3 `visible_fields` path was already used to close hidden-field parity, but that verifier sorted expected and actual arrays before comparing them. Sorting is correct when the contract is **membership only**, but it deliberately removes ordering information. Therefore a Target View could have the correct visible/hidden member set and still display those visible fields in the wrong order while the hidden-field gate passed.

The official Base v3 `visible_fields` property is also the documented repair path because Lark states that it controls both visibility and order. The new order lane therefore preserves membership and changes only sequence, with exact ordered readback and rollback on failure.

Prevention rule for future migrations:

- capture Source per-View visible order as authority;
- verify visible order separately from hidden membership;
- do not sort arrays in an order-parity assertion;
- create table fields in the Source primary/default operational-view order when practical;
- block final parity when any in-scope visible order differs.

This is a migration-planning/presentation defect, not a record-data defect. Existing customer records must never be rewritten to close it.
