# Contributing

Contributions that correct classifications, add manual overrides, or introduce useful categories are welcome. Most contributions will be moving an ASN out of `lists/unknown.txt` into the category it actually belongs in, after checking a public, authoritative source for what the organization does.

**Everything under `lists/`, including `lists/manifest.json`, is generated output.** `scripts/generate-lists.mjs` fully rewrites every file in `lists/` on each run, so never edit them directly - the edit is silently discarded the next time someone regenerates against an updated `local/GeoLite2-ASN.mmdb`. Make the change in the generator's own inputs instead, then regenerate. `lists/` is also gitignored (built locally and published to a CDN, not committed), so it won't show up in `git status` either way.

## Correcting a classification

1. Add a line to `scripts/overrides.txt`: `<ASN> <category-id>`, one per line, `#` comments allowed. For a single one-off fix you can instead add an entry to the `inlineOverrides` object near the top of `scripts/generate-lists.mjs`.
2. Regenerate:

```bash
npm install
npm run generate:lists
```

3. Run the validator:

```bash
node tests/validate.mjs
```

Include a public, authoritative reference for the change in the pull request description, and explain ambiguous cases and the possible false-positive impact of classifying the entire ASN.

An override always wins over the keyword rules, so it survives regeneration even if the mmdb's organization name for that ASN changes or the rules are later tweaked.

Prefer a rule over an override whenever the correction generalizes - a rule applies to the whole database and to ASNs that don't exist yet, an override only ever fixes the one ASN you added it for. Reserve overrides for cases a rule genuinely can't solve, typically a VPN or proxy service registered under a shell/holding company name with no lexical hint (e.g. "Proton AG"). Don't bulk-import a classification from elsewhere without checking it fits the current categories - a category from a different scheme (e.g. a coarser "everything that isn't X" bucket) will not line up with these category definitions.

## Adding a category

Category names should describe an observable network or service type rather than make an unsupported judgment about every request coming from it.

1. Add an entry to the `categories` array in `scripts/generate-lists.mjs` (id, label, description).
2. Add a matching pattern to the `rules` array in the same file so ASNs are classified into it going forward.
3. Add it to the list table in `README.md`.
4. Regenerate and validate:

```bash
npm run generate:lists
node tests/validate.mjs
```

Every ASN in `all.txt` must belong to exactly one category (categories don't overlap) - the validator enforces this.

## Validation

Run this before opening a pull request:

```bash
node tests/validate.mjs
```

The validator checks formatting, numeric ordering, duplicates, organization-name consistency, manifest counts, category membership, and that the categories partition `all.txt` with no ASN in more than one category.
