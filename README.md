# BurrowGate ASN Lists

Open ASN lists for best-effort network traffic classification. They are designed for BurrowGate but use a simple text format that any firewall, proxy, analytics system, or application can consume.

Every ASN present in the local GeoLite2 ASN database is sorted into exactly one broad category (`lists/all.txt` is their union). `lists/` is entirely generated output, rebuilt from scratch on every run by [`scripts/generate-lists.mjs`](scripts/generate-lists.mjs): it matches each organization name against an ordered set of keyword rules, applies manual corrections from `scripts/overrides.txt`, and puts anything that matches neither in `lists/unknown.txt` for review. Because a correction lives in the script's own inputs and never in `lists/` itself, it survives being regenerated against an updated mmdb.

`lists/` is gitignored, not committed - it's built locally and published to a CDN. See [Downloading](#downloading).

These lists are policy signals, not proof that a visitor is malicious or that every address announced by an ASN has the same purpose. Start with identification or monitoring, review your own traffic, and maintain explicit ASN or IP allowlists for trusted networks.

## Repository layout

```text
.
├── lists/                      (generated, gitignored - see Downloading)
│   ├── all.txt
│   ├── manifest.json
│   ├── vpn.txt
│   ├── proxy.txt
│   ├── satellite.txt
│   ├── mobile-carrier.txt
│   ├── education.txt
│   ├── government.txt
│   ├── healthcare.txt
│   ├── financial.txt
│   ├── gaming.txt
│   ├── media-broadcasting.txt
│   ├── nonprofit-religious.txt
│   ├── transportation.txt
│   ├── utility.txt
│   ├── datacenter.txt
│   ├── isp-telecom.txt
│   └── unknown.txt
├── scripts/
│   ├── generate-lists.mjs
│   └── overrides.txt
├── tests/
│   └── validate.mjs
├── CONTRIBUTING.md
├── LICENSE
└── README.md
```

## Available lists

| List                      | Meaning                                                                           |
| ------------------------- | --------------------------------------------------------------------------------- |
| `all.txt`                 | Every unique ASN included by the repository.                                      |
| `vpn.txt`                 | VPN providers or VPN services.                                                    |
| `proxy.txt`               | Public or commercial proxy services.                                              |
| `satellite.txt`           | Satellite internet access providers.                                              |
| `mobile-carrier.txt`      | Cellular and mobile network operators.                                            |
| `education.txt`           | Universities, schools, and other educational institutions.                        |
| `government.txt`          | Government agencies, public administration, and military networks.                |
| `healthcare.txt`          | Hospitals, clinics, and other healthcare organizations.                           |
| `financial.txt`           | Banks, insurers, and other financial institutions.                                |
| `gaming.txt`              | Video game publishers, platforms, and esports organizations.                      |
| `media-broadcasting.txt`  | Television, radio, news, and other media organizations.                           |
| `nonprofit-religious.txt` | Charities, foundations, NGOs, and religious organizations.                        |
| `transportation.txt`      | Airlines, airports, railways, shipping, and other transportation operators.       |
| `utility.txt`             | Electric, water, gas, and other energy or utility providers.                      |
| `datacenter.txt`          | Datacenter, cloud, CDN, or hosting infrastructure.                                |
| `isp-telecom.txt`         | Fixed-line internet service providers and telecommunications operators.           |
| `unknown.txt`             | Not confidently classified from the organization name alone; needs manual review. |

`manifest.json` provides a `generatedAt` timestamp plus stable category IDs, labels, descriptions, filenames, and row counts. Consumers can use it to discover categories instead of hard-coding the current set.

Every ASN in `all.txt` appears in exactly one category file, the categories partition `all.txt`, they don't overlap.

## File format

Every non-empty line contains the decimal ASN followed by at least one space and its organization name:

```text
211252 Delis LLC
398324 Censys, Inc.
```

The ASN has no `AS` prefix. Files are UTF-8, deduplicated, and sorted numerically by ASN. Consumers should treat the first whitespace-delimited field as the identifier and the remainder as informational organization text.

An ASN that the local GeoLite2 database doesn't have an organization name for is retained as `Unknown organization` so maintainers can research and correct it without losing the classification.

## Classification methodology and limitations

This is a best-effort, **largely unreviewed** heuristic classification, not a hand-audited dataset. An organization's registered legal name is a weak signal:

- Brand names that don't describe the business (e.g. a mobile carrier with no "mobile" in its legal name) are missed and land in `unknown.txt`.
- Keyword rules can misfire on unusual names.
- Roughly two-thirds of all ASNs currently sit in `unknown.txt` because most small operators register under a generic legal name (a person's name, or a bare "X LLC"/"X GmbH") with no descriptive keyword at all.
- ASN ownership, routing, and business models change over time, and one ASN can host consumer, business, VPN, proxy, and unrelated traffic simultaneously.
- Organization names identify the registered network operator and may differ from a consumer-facing brand or service.
- These files classify ASNs, not IP addresses. Consumers need a current IP-to-ASN database or service before performing a lookup.

`scripts/overrides.txt` should stay small and rule-driven classification should stay the default. It holds hand-verified exceptions the rules genuinely can't infer from the organization name (e.g. a VPN provider operating under an unrelated-looking shell/holding company name) - not a bulk import of some other classification. If a correction would apply to more than one ASN, prefer a new or adjusted rule in `scripts/generate-lists.mjs` over adding each ASN to the override file - a rule applies to the whole database and to ASNs that don't exist yet, an override only ever fixes the one ASN it names. If you import a classification from elsewhere, verify it actually fits the current categories before trusting it - a category from a different scheme (e.g. a coarser "everything that isn't X" bucket) will not line up with these definitions.

Verify before relying on any list here for anything but coarse, reversible filtering. Blocking an entire ASN can affect legitimate users - identification, logging, rate limits, or challenges are usually safer defaults than immediate blocking. See [CONTRIBUTING.md](CONTRIBUTING.md) for how to correct or improve a classification.

## Downloading

Published to:

```text
https://cdn.rabbit-company.com/burrowgate/asn-lists/manifest.json
https://cdn.rabbit-company.com/burrowgate/asn-lists/vpn.txt
https://cdn.rabbit-company.com/burrowgate/asn-lists/datacenter.txt
```

Example JavaScript loader:

```js
async function loadAsns(url) {
	const response = await fetch(url);
	if (!response.ok) throw new Error(`ASN list returned HTTP ${response.status}`);

	return new Map(
		(await response.text())
			.split(/\r?\n/)
			.filter(Boolean)
			.map((line) => {
				const separator = line.indexOf(" ");
				return [Number(line.slice(0, separator)), line.slice(separator + 1)];
			}),
	);
}

const vpnAsns = await loadAsns("https://cdn.rabbit-company.com/burrowgate/asn-lists/vpn.txt");
```

## Regenerating and manual maintenance

**Everything under `lists/` (including `lists/manifest.json`) is generated output. Never hand-edit it** - `scripts/generate-lists.mjs` fully rewrites every file in `lists/` on each run, so a direct edit there is silently discarded the next time someone regenerates. All maintenance happens one level up, in the generator's own inputs:

- `scripts/generate-lists.mjs` - the keyword `rules` that assign a category from the organization name, and the `categories` list itself.
- `scripts/overrides.txt` - a flat `<ASN> <category-id>` file of manual corrections that take priority over the rules. This is the durable home for anything that isn't (or shouldn't be) inferable from the org name alone - most commonly, moving an ASN out of `unknown.txt` after research.

Because corrections live there instead of in `lists/`, they survive being regenerated against a newer `local/GeoLite2-ASN.mmdb` - a re-run reclassifies only ASNs that are new to that override file and every rule.

`local/GeoLite2-ASN.mmdb` is gitignored (see [.gitignore](.gitignore)) and must be supplied locally to regenerate:

```bash
npm install
npm run generate:lists
```

This rewrites every file in `lists/`, including `manifest.json` with a fresh `generatedAt` timestamp, even if nothing else changed.

To correct a specific ASN, add a line to `scripts/overrides.txt` (`<ASN> <category-id>`, one per line, `#` comments allowed) or, for a one-off fix, an entry in the `inlineOverrides` object near the top of `scripts/generate-lists.mjs`. Then regenerate and validate:

```bash
npm run generate:lists
node tests/validate.mjs
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for classification and review guidance.

## Adding a category

Add an entry to `categories` and a matching pattern to `rules` in `scripts/generate-lists.mjs`, then regenerate and validate. Document the new category in the table above too. Category IDs should be stable lowercase names separated by hyphens. Describe an observable network or service type and avoid implying that every request from the network is harmful.

## License

The repository is available under the [MIT License](LICENSE). Contributions must only include information that can be redistributed under compatible terms.
