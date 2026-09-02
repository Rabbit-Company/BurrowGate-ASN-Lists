#!/usr/bin/env node
// Rebuilds lists/ from scratch by walking every network in
// local/GeoLite2-ASN.mmdb, collecting the unique set of ASNs, and sorting
// each one into a broad category using name-based heuristics.
//
// This is a full rebuild, not an incremental merge: everything under
// lists/ (including lists/manifest.json) is output only, never an input.
// That means the only way to make a correction is to edit this script's
// own inputs - the `rules` below, or scripts/overrides.txt / the
// `inlineOverrides` object - and re-run. That correction then survives
// forever, including against a freshly downloaded mmdb that adds, drops,
// or renumbers ASNs.
//
// lists/ itself is gitignored: it's built locally and published to a CDN
// rather than committed, so regenerate it after cloning.
//
// Requires the `maxmind` package (npm install maxmind) since this
// repository has no runtime dependencies of its own otherwise.
import maxmind from "maxmind";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const scriptsDir = dirname(fileURLToPath(import.meta.url));
const root = join(scriptsDir, "..");
const mmdbPath = join(root, "local/GeoLite2-ASN.mmdb");
const listsDir = join(root, "lists");
const overridesPath = join(scriptsDir, "overrides.txt");

// Step 1: enumerate every unique ASN in the database by walking the
// IPv4 and IPv6 search trees, jumping forward by the size of each
// resolved network instead of testing every address.

function ipv4ToString(n) {
	return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join(".");
}

function ipv6ToString(value128) {
	const hex = value128.toString(16).padStart(32, "0");
	const groups = [];
	for (let i = 0; i < 32; i += 4) groups.push(hex.slice(i, i + 4));
	return groups.join(":");
}

function cleanOrg(org) {
	return (org || "Unknown organization").trim().replace(/\s+/gu, " ");
}

async function enumerateAsns(reader) {
	const asnMap = new Map();

	let current = 0n;
	const MAX_V4 = 2n ** 32n;
	while (current < MAX_V4) {
		const ipStr = ipv4ToString(Number(current));
		const [data, prefixLength] = reader.getWithPrefixLength(ipStr);
		if (data && data.autonomous_system_number) {
			const asn = data.autonomous_system_number;
			if (!asnMap.has(asn)) asnMap.set(asn, cleanOrg(data.autonomous_system_organization));
		}
		current += 2n ** BigInt(32 - prefixLength);
	}

	let v6current = 0n;
	const MAX_V6 = 2n ** 128n;
	while (v6current < MAX_V6) {
		const ipStr = ipv6ToString(v6current);
		const [data, prefixLength] = reader.getWithPrefixLength(ipStr);
		if (data && data.autonomous_system_number) {
			const asn = data.autonomous_system_number;
			if (!asnMap.has(asn)) asnMap.set(asn, cleanOrg(data.autonomous_system_organization));
		}
		v6current += 2n ** BigInt(128 - prefixLength);
	}

	return asnMap;
}

// Step 2: classify. An ordered list of name-based rules; the first match
// wins. Anything matching nothing lands in "unknown" for manual triage.

const categories = [
	{ id: "vpn", label: "VPN providers", description: "Networks classified as VPN providers or VPN services." },
	{ id: "proxy", label: "Proxy services", description: "Networks associated with public or commercial proxy services." },
	{ id: "satellite", label: "Satellite internet", description: "Satellite internet access providers and operators." },
	{ id: "mobile-carrier", label: "Mobile carriers", description: "Cellular and mobile network operators." },
	{ id: "education", label: "Education", description: "Universities, schools, and other educational institutions." },
	{ id: "government", label: "Government and military", description: "Government agencies, public administration, and military networks." },
	{ id: "healthcare", label: "Healthcare", description: "Hospitals, clinics, and other healthcare organizations." },
	{ id: "financial", label: "Financial services", description: "Banks, insurers, and other financial institutions." },
	{ id: "gaming", label: "Gaming", description: "Video game publishers, platforms, and esports organizations." },
	{ id: "media-broadcasting", label: "Media and broadcasting", description: "Television, radio, news, and other media organizations." },
	{ id: "nonprofit-religious", label: "Nonprofit and religious", description: "Charities, foundations, NGOs, and religious organizations." },
	{ id: "transportation", label: "Transportation", description: "Airlines, airports, railways, shipping, and other transportation operators." },
	{ id: "utility", label: "Utilities", description: "Electric, water, gas, and other energy or utility providers." },
	{ id: "datacenter", label: "Datacenter, cloud, and hosting", description: "Networks classified as datacenter, cloud, CDN, or hosting infrastructure." },
	{ id: "isp-telecom", label: "ISPs and telecoms", description: "Fixed-line internet service providers and telecommunications operators." },
	{ id: "unknown", label: "Unknown", description: "ASNs that could not be confidently classified from the organization name alone." },
];
const categoryIds = new Set(categories.map((c) => c.id));

const rules = [
	{
		id: "vpn",
		pattern:
			/\bvpn\b|\bnordvpn\b|\bnord security\b|\bexpressvpn\b|\bsurfshark\b|\bcyberghost\b|\bprotonvpn\b|\bwindscribe\b|\btunnelbear\b|\bipvanish\b|\bprivate internet access\b|\bmullvad\b|\bhide\.?me\b|\bhide my ass\b|\bvyprvpn\b|\bpurevpn\b|\bstrongvpn\b|\bastrill\b|\bzenmate\b|\bhotspot shield\b|\banchorfree\b|\bivacy\b|\bfastestvpn\b|\bspeedify\b|\bperfect privacy\b|\bkape technologies\b|\bnordlayer\b|\bnorton secure vpn\b|\bnortonlifelock\b|\bgen digital\b|\bavg secure vpn\b|\bmcafee safe connect\b|\bf-secure freedome\b|\bkaspersky (vpn|secure connection)\b|\bbitdefender vpn\b|\btorguard\b|\bkeepsolid\b|\bvpn unlimited\b|\bhola vpn\b|\bbetternet\b|\bivpn\b|\bairvpn\b|\bcactusvpn\b|\bsafervpn\b|\ble vpn\b|\bgoose vpn\b|\bpsiphon\b|\bmozilla vpn\b|\batlas vpn\b|\burbanvpn\b|\bultrasurf\b|\bprivado vpn\b|\bavast secureline\b/i,
	},
	{ id: "proxy", pattern: /\bprox(y|ies)\b|\bbright data\b|\bluminati\b|\boxylabs\b|\bsmartproxy\b|\bnetnut\b|\bgeosurf\b|\biproyal\b|\bsoax\b/i },
	{
		id: "satellite",
		pattern: /\bsatellite\b|\bstarlink\b|\bvsat\b|\biridium\b|\binmarsat\b|\bviasat\b|\bhughes network\b|\beutelsat\b|\bintelsat\b|\bglobalstar\b/i,
	},
	{
		id: "mobile-carrier",
		pattern:
			/\bmobile\b|\bcellular\b|\bgsm\b|\b[345]g\b|\bmobifone\b|\bmobitel\b|\bcellcom\b|\bmobinil\b|\bmobily\b|\bt-mobile\b|\bverizon wireless\b|\bat&t mobility\b|\bchina mobile\b|\bchina unicom\b|\bbharti airtel\b|\bairtel\b|\btelenor\b|\betisalat\b|\bdocomo\b|\bsoftbank\b|\bkddi\b|\bmovistar\b|\bvodafone\b|\bo2\b|\bee limited\b|\bthree\b|\bdigicel\b|\bglobe telecom\b|\bsmart communications\b|\booredoo\b|\bturkcell\b|\bsafaricom\b|\bvodacom\b|\bmegafon\b/i,
	},
	{
		id: "education",
		pattern:
			/\buniversity\b|\buniversidad\b|\buniversität\b|\bcollege\b|\bpolytechnic\b|\bacadem(y|ic)\b|\binstitute of technology\b|\bschool district\b|\b(primary|secondary|high) school\b|\.edu\b|\buniv\.?\b|\bresearch library\b|\blibrary consortium\b/i,
	},
	{
		id: "government",
		pattern:
			/\bministry\b|\bministerstvo\b|\bgovernment\b|\bmunicipal\b|\bcity of \b|\bcounty of\b|\bcounty\b|\bfederal\b|\bstate of \b|\barmy\b|\bnavy\b|\bair force\b|\bpolice\b|\bcourt\b|\bparliament\b|\bsenate\b|\bcity council\b|\brepublic of\b|\bdepartment of\b|\bnational guard\b|\bpublic safety\b|\bpublic works\b|\btown of\b|\bprovince of\b|\bstate budgetary\b|\bembassy\b|\bconsulate\b|\bcity hall\b|\bauthority\b/i,
	},
	{
		id: "healthcare",
		pattern: /\bhospital\b|\bmedical (center|centre)\b|\bhealth (system|care|network)\b|\bhealthcare\b|\bclinic\b|\bnhs\b|\bmedical\b|\bpharmaceutical\b/i,
	},
	{
		id: "financial",
		pattern:
			/\bbank\b|\bbancorp\b|\bbanco\b|\bcredit union\b|\bfinancial\b|\binsurance\b|\bcapital\b|\binvestments?\b|\bsavings\b|\bsecurities\b|\basset management\b|\bfintech\b/i,
	},
	{
		id: "gaming",
		pattern:
			/\bgaming\b|\besports\b|\bvideo games?\b|\bplaystation\b|\bxbox\b|\bnintendo\b|\briot games\b|\bvalve\b|\bblizzard\b|\bactivision\b|\bepic games\b/i,
	},
	{ id: "media-broadcasting", pattern: /\bbroadcast(ing)?\b|\btelevision\b|\bradio\b|\bnewspaper\b|\bpublishing\b|\bcinema\b|\bfilm studio\b/i },
	{
		id: "nonprofit-religious",
		pattern:
			/\bfoundation\b|\bchurch\b|\bdiocese\b|\barchdiocese\b|\bcatholic\b|\bmosque\b|\btemple\b|\bsynagogue\b|\bministries\b|\bcharity\b|\bcharitable\b|\bngo\b|\bnon-?profit\b|\bhumanitarian\b|\bred cross\b/i,
	},
	{ id: "transportation", pattern: /\bairlines?\b|\bairways\b|\bairport\b|\brailway\b|\brailroad\b|\bshipping\b|\bmaritime\b|\bport authority\b/i },
	{ id: "utility", pattern: /\belectric(ity)?\b|\bpower\b|\benergy\b|\butilit(y|ies)\b|\bwater (works|authority)\b|\bpetroleum\b|\bnatural gas\b/i },
	{
		id: "datacenter",
		pattern:
			/\bhosting\b|\bclouds?\b|\bdata\s?center(s)?\b|\bdatacentre\b|\bcolocation\b|\bcolo\b|\bdedicated servers?\b|\bvps\b|\bcdn\b|\bcontent delivery\b|\bovh\b|\bhetzner\b|\bdigitalocean\b|\blinode\b|\bvultr\b|\bchoopa\b|\bthe constant company\b|\bscaleway\b|\bcontabo\b|\bnetcup\b|\bionos\b|\bgodaddy\b|\bnamecheap\b|\bhostinger\b|\bliquid web\b|\brackspace\b|\bsoftlayer\b|\bupcloud\b|\bkamatera\b|\bwholesale internet\b|\bfrantech\b|\bbuyvm\b|\bpsychz\b|\bquadranet\b|\bcolocrossing\b|\bhostdime\b|\bphoenixnap\b|\bservers\.com\b|\bcherry servers\b|\blimestone networks\b|\bworldstream\b|\breliablesite\b|\bvirmach\b|\btime4vps\b|\bgreencloud\b|\bracknerd\b|\bdediserve\b|\binterserver\b|\bdreamhost\b|\bzenlayer\b|\bg-core\b|\bakamai\b|\bfastly\b|\bcloudflare\b|\bstackpath\b|\bkeycdn\b|\bbunny\.net\b|\bbunnycdn\b|\blimelight networks\b|\bedgecast\b|\bedgio\b|\bcachefly\b|\bamazon\.com\b|\bamazon technologies\b|\bamazon web services\b|\baws\b|\bmicrosoft\b|\boracle corporation\b|\binternational business machines\b|\bibm\b/i,
	},
	{
		id: "isp-telecom",
		pattern:
			/\btelecom(munication)?s?\b|\bbroadband\b|\bfib(er|re)\b|\bcable\b|\bisp\b|\binternet\b|\bnetworks?\b|\bcommunications?\b|\btelephone\b|\bwireless\b|\bwi-?fi\b|\btelecomunicaciones\b|\btelekom\b|\bconnect\b|\bverizon\b|\bat&t\b|\bcomcast\b|\bcharter communications\b|\blevel ?3\b|\bzayo\b|\bntt\b|\brostelecom\b|\bkpn\b|\belisa (oyj|eesti|estonia)\b|\btele2\b|\bpccw\b|\bpldt\b|\bstarhub\b|\btelstra\b|\bcolt technology\b|\bproximus\b|\bswisscom\b|\bsingtel\b|\btelia\b|\bt-2\b|\btelemach\b|\ba1 (bulgaria|hrvatska|slovenija|srbija)\b/i,
	},
];

function classify(org) {
	for (const rule of rules) {
		if (rule.pattern.test(org)) return rule.id;
	}
	return "unknown";
}

// Manual corrections. Each ASN below overrides the category the rules
// above would otherwise assign, and takes priority over them. This -
// plus the rules and categories above - is the *only* place a manual
// correction should be made. Never edit lists/*.txt directly: it is
// fully overwritten by every run, so a hand edit there is silently lost
// the next time someone regenerates against an updated mmdb.
//
// Bulk corrections (e.g. a prior hand-reviewed list) belong in
// scripts/overrides.txt, one "<ASN> <category-id>" pair per line. A one-
// off correction can instead be added inline below; leave a short
// comment saying why. Inline entries win if an ASN appears in both.

async function loadFileOverrides() {
	const overrides = new Map();
	let body;
	try {
		body = await readFile(overridesPath, "utf8");
	} catch (err) {
		if (err.code === "ENOENT") return overrides;
		throw err;
	}
	for (const rawLine of body.split("\n")) {
		const line = rawLine.trim();
		if (!line || line.startsWith("#")) continue;
		const [asnText, categoryId] = line.split(/\s+/u);
		const asn = Number(asnText);
		if (!Number.isSafeInteger(asn) || asn <= 0) throw new Error(`overrides.txt: invalid ASN in line "${rawLine}"`);
		if (!categoryIds.has(categoryId)) throw new Error(`overrides.txt: unknown category "${categoryId}" for ASN ${asn}`);
		overrides.set(asn, categoryId);
	}
	return overrides;
}

// One-off inline corrections (see the comment above).
// Example:
//   8075: "datacenter", // Microsoft Corporation - Azure, not classified by name alone
const inlineOverrides = {
	// 12345: "isp-telecom",
};

for (const categoryId of Object.values(inlineOverrides)) {
	if (!categoryIds.has(categoryId)) {
		throw new Error(`inlineOverrides references unknown category "${categoryId}" - add it to the categories list first`);
	}
}

// Step 3: write lists/*.txt, lists/all.txt, and lists/manifest.json.
// Everything under lists/ is published output (see README) - paths in
// the manifest are relative to lists/ itself, not the repo root.

function formatList(entries) {
	return entries.map(([asn, org]) => `${asn} ${org}`).join("\n") + "\n";
}

async function main() {
	const reader = await maxmind.open(mmdbPath);
	console.error("Walking mmdb search trees...");
	const asnMap = await enumerateAsns(reader);
	console.error(`Found ${asnMap.size} unique ASNs.`);

	const overrides = await loadFileOverrides();
	for (const [asn, categoryId] of Object.entries(inlineOverrides)) overrides.set(Number(asn), categoryId);
	console.error(`Loaded ${overrides.size} manual overrides.`);

	const byCategory = new Map(categories.map((c) => [c.id, new Map()]));
	let overridden = 0;

	for (const [asn, org] of asnMap) {
		const override = overrides.get(asn);
		const categoryId = override ?? classify(org);
		if (override) overridden++;
		byCategory.get(categoryId).set(asn, org);
	}

	const manifestCategories = [];
	const allEntries = [];
	for (const category of categories) {
		const entries = [...byCategory.get(category.id).entries()].sort((a, b) => a[0] - b[0]);
		await writeFile(join(listsDir, `${category.id}.txt`), formatList(entries));
		allEntries.push(...entries);
		manifestCategories.push({
			id: category.id,
			label: category.label,
			description: category.description,
			file: `${category.id}.txt`,
			count: entries.length,
		});
		console.error(`${category.id}: ${entries.length}`);
	}

	allEntries.sort((a, b) => a[0] - b[0]);
	await writeFile(join(listsDir, "all.txt"), formatList(allEntries));

	const manifest = {
		schemaVersion: 1,
		format: "One decimal ASN and organization name per line: <ASN> <organization>.",
		generatedAt: new Date().toISOString(),
		all: { file: "all.txt", count: allEntries.length },
		categories: manifestCategories,
	};
	await writeFile(join(listsDir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");

	console.error(`\nTotal: ${allEntries.length} (${overridden} from manual overrides)`);
}

main();
