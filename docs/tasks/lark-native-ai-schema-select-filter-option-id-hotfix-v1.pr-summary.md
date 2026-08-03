# PR summary — Lark Native AI Select Filter Option-ID Hotfix

Repository-only Hotfix. No Remote action was performed while implementing or testing it.

The change translates accepted name-based Select filter values to exact live option IDs before Lark View PATCH, preserves Checkbox Booleans, and retains partial-resume/zero-drift gates. The first Apply's successful 23 Field creates, two Field updates, two View creates and one View update remain authoritative and are never rolled back.
