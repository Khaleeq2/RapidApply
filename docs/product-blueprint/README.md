# RapidApply product blueprint

This directory is the governing source of truth for RapidApply's product
strategy and platform shape. It explains what the product promises, who it is
for, how customer boundaries are enforced, and how the current MVP grows into
the long-term product.

## Document set

1. [Product charter](product-charter.md) — vision, customer, product promise,
   principles, success measures, and MVP scope.
2. [Platform architecture](platform-architecture.md) — tenant model, trust
   boundaries, execution model, data ownership, and scaling path.
3. [MVP and evolution roadmap](mvp-roadmap.md) — capability phases and their
   objective exit criteria, without coupling the plan to arbitrary dates.

Implementation-level details live in [`docs/architecture`](../architecture/).
Those documents explain how a particular capability works today. This blueprint
governs why the capability exists and which boundaries implementations must
preserve.

## Authority and change policy

When product copy, generated prototypes, implementation notes, or historical
code conflict with this blueprint, this blueprint governs until an explicit
product decision changes it.

Changes should preserve four invariants:

- RapidApply optimizes for candidate outcomes, not raw automation volume.
- The candidate knowingly controls the campaign and the facts used on their
  behalf.
- Durable product state belongs to the cloud control plane, not a browser tab.
- Execution mechanisms and site adapters remain replaceable.

Material changes to the customer, core promise, tenant boundary, submission
authority, or source-of-truth model should update all affected blueprint
documents together.
