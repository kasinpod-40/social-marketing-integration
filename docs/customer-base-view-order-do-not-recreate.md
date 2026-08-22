# Do not recreate the current customer Base

The field-order remainder does not justify recreating tables or replaying record migration. The existing customer Base has correct record-to-field bindings and already-closed schema/logic lanes. Recreating it would increase risk and could disturb customer-owned/protected state.

Close the field-order remainder in place, read back, export, and verify.
