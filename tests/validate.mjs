#!/usr/bin/env node

import { readFile, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const listsDir = join(root, "lists");

function assert(condition, message) {
	if (!condition) throw new Error(message);
}

async function readList(file) {
	const body = await readFile(join(listsDir, file), "utf8");
	assert(body.endsWith("\n"), `${file} must end with a newline`);
	assert(!/[ \t]+$/mu.test(body), `${file} contains trailing whitespace`);

	const entries = new Map();
	let previous = 0;
	for (const [index, line] of body.trim().split("\n").entries()) {
		const match = /^(\d+) ([^\s].*)$/u.exec(line);
		assert(match, `${file}:${index + 1} must use the format <ASN> <organization>`);
		const asn = Number(match[1]);
		const organization = match[2];
		assert(Number.isSafeInteger(asn) && asn > 0 && asn <= 4_294_967_295, `${file}:${index + 1} contains invalid ASN ${match[1]}`);
		assert(asn > previous, `${file}:${index + 1} is duplicated or not numerically sorted`);
		assert(!/\s{2,}/u.test(organization), `${file}:${index + 1} contains repeated whitespace in the organization name`);
		entries.set(asn, organization);
		previous = asn;
	}
	return entries;
}

const manifest = JSON.parse(await readFile(join(listsDir, "manifest.json"), "utf8"));
assert(manifest.schemaVersion === 1, "Unsupported manifest schema");
assert(typeof manifest.generatedAt === "string" && !Number.isNaN(Date.parse(manifest.generatedAt)), "manifest.json must have a valid generatedAt timestamp");

const expectedListFiles = [manifest.all.file, ...manifest.categories.map((category) => category.file)].sort();
const actualListFiles = (await readdir(listsDir)).filter((file) => file.endsWith(".txt")).sort();
assert(JSON.stringify(actualListFiles) === JSON.stringify(expectedListFiles), "Every lists/*.txt file must be declared exactly once in lists/manifest.json");

const all = await readList(manifest.all.file);
assert(all.size === manifest.all.count, `${manifest.all.file} count does not match manifest.json`);

const categoryIds = new Set();
const categoryLists = new Map();
let unknownOrganizations = 0;
for (const category of manifest.categories) {
	assert(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(category.id), `Invalid category ID ${category.id}`);
	assert(!categoryIds.has(category.id), `Duplicate category ID ${category.id}`);
	assert(category.label && category.description, `Category ${category.id} needs a label and description`);
	categoryIds.add(category.id);

	const entries = await readList(category.file);
	assert(entries.size === category.count, `${category.file} count does not match manifest.json`);
	for (const [asn, organization] of entries) {
		assert(all.has(asn), `${category.file} contains ASN ${asn}, which is absent from ${manifest.all.file}`);
		assert(all.get(asn) === organization, `${category.file} uses a different organization name for ASN ${asn}`);
	}
	categoryLists.set(category.id, entries);
}

for (const organization of all.values()) {
	if (organization === "Unknown organization") unknownOrganizations += 1;
}

assert(categoryLists.has("unknown"), "an unknown category is required");

const seen = new Set();
let totalCategorized = 0;
for (const [categoryId, entries] of categoryLists) {
	for (const asn of entries.keys()) {
		assert(!seen.has(asn), `ASN ${asn} appears in more than one category (found again in ${categoryId})`);
		seen.add(asn);
	}
	totalCategorized += entries.size;
}
assert(totalCategorized === all.size, "The categories together must partition all.txt exactly (every ASN in exactly one category)");

console.log(`Validated ${all.size} ASNs across ${manifest.categories.length} categories; ${unknownOrganizations} organization names need manual review.`);
