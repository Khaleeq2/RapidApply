# Resume lifecycle

## Purpose

RapidApply's first resume capability creates one candidate-approved, role-specific PDF that the browser helper can reliably reuse during supported application flows. It is deliberately a foundational resume generator, not a source of invented career facts.

## Source of truth

The candidate profile is the only source used by the MVP generator. The PDF can include:

- full name and contact details;
- professional headline and candidate-authored summary;
- public professional links; and
- the target role for the current campaign.

The generator must not infer or fabricate work history, education, skills, certifications, employer names, achievements, compensation, legal status, or any other candidate fact.

## Identity and versions

Each user has one durable resume record per normalized target role. The visible filename is natural and deterministic:

```text
Full_Name_Target_Role_Resume_v1.pdf
```

For example:

```text
Taylor_Rivera_Product_Designer_Resume_v1.pdf
```

An unchanged candidate profile produces the same file name, content hash, resume record, and version. A changed approved profile produces one explicit next version, such as `v2`. This avoids per-application filenames while retaining a truthful audit trail when the underlying content actually changes.

## Storage and delivery

The application stores PDFs in a private, managed storage root. Database records retain the user owner, internal role key, visible filename, MIME type, byte size, content hash, and version.

The dashboard can list and download only the current user's documents. The extension cannot request a document by user ID, role, or arbitrary storage key. Instead it presents its existing short-lived executor capability; the server resolves the user and target role from the already-claimed campaign.

## LinkedIn handoff

The browser helper follows this order:

1. Inventory bounded visible filenames in LinkedIn Application Settings before discovery, or in the active Easy Apply surface when resolving an application step.
2. Send those names through the claimed run's résumé-audit capability; the server returns only summary identity when an exact/full-or-truncated match exists.
3. Select and verify the exact target card without requesting PDF bytes.
4. Only when platform reuse is unavailable, receive and integrity-check the exact role PDF.
5. Reuse an exact completed file in Chrome's managed `RapidApply/` download folder, or download it once when absent.
6. Attach only that exact PDF through a static, locally packaged trusted-input routine.
7. Re-observe LinkedIn and continue only after the file is visibly confirmed.

The extension never receives a general file-system picker, arbitrary path, remote JavaScript, selector, or browser-control instruction. A failed or ambiguous confirmation becomes a resume checkpoint; it does not advance to the next application step.

## Current boundary

The MVP does not delete, rename, or bulk-manage documents stored by LinkedIn. It uses one deterministic active document per role and revises it only after an approved profile change. A future resume-management experience can add candidate review, richer structured history, resume tailoring, retention controls, LinkedIn cleanup assistance, and role-family policies without changing the executor contract.
