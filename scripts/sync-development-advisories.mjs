import { writeFile } from 'node:fs/promises'
import process from 'node:process'
import {
	auditPackages,
	classify,
	DEFAULT_OWNER,
	describePackage,
	exceedsLevel,
	POLICY_URL,
	readPolicy,
	readProductionLevel,
	REVIEW_WINDOW_DAYS,
} from './development-advisories.mjs'

const write = process.argv.includes('--write')
const renew = process.argv.includes('--review')
const policy = await readPolicy()
const classification = classify({
	policy,
	full: auditPackages(),
	production: auditPackages({ omitDevelopment: true }),
})

// The ledger only ever waives what the production tree cannot reach; everything else has to be fixed.
const level = readProductionLevel()
const fatal = classification.production.filter(entry => exceedsLevel(entry.severity, level))
const tolerated = classification.production.filter(entry => !exceedsLevel(entry.severity, level))
if (fatal.length > 0) {
	const reported = fatal.map(entry => describePackage(entry)).join(', ')
	const guidance = 'Upgrade them or pin a patched transitive version.'
	throw new Error(`Refusing to waive production advisories: ${reported}. ${guidance}`)
}

for (const entry of tolerated) {
	process.stdout.write(`reported ${describePackage(entry)} in the production tree at or below ${level}
`)
}

const waived = new Map(policy.waivers.map(waiver => [waiver.package, waiver]))
const expires = new Date()
expires.setUTCDate(expires.getUTCDate() + REVIEW_WINDOW_DAYS)
const nextExpiry = expires.toISOString().slice(0, 10)
const changes = []

const waivers = classification.development.map((entry) => {
	const existing = waived.get(entry.name)
	if (existing === undefined) {
		changes.push(`recorded ${describePackage(entry)} until ${nextExpiry}`)
		return {
			package: entry.name,
			owner: DEFAULT_OWNER,
			reason: generatedReason(entry),
			expires: nextExpiry,
		}
	}
	if (renew && existing.expires < nextExpiry) {
		changes.push(`renewed ${entry.name} from ${existing.expires} to ${nextExpiry}`)
		return { ...existing, expires: nextExpiry }
	}
	return existing
})

for (const waiver of classification.stale) {
	changes.push(`dropped ${waiver.package} (no longer reported)`)
}

for (const change of changes) {
	process.stdout.write(`${change}\n`)
}
const reported = classification.development.length
process.stdout.write(`Ledger waivers: ${waivers.length}; development-only packages: ${reported}.\n`)

if (write) {
	await writeFile(POLICY_URL, `${JSON.stringify({ waivers }, null, '\t')}\n`)
	process.stdout.write('Wrote security/development-advisories.json.\n')
}
else {
	process.stdout.write('Dry run. Pass --write to persist security/development-advisories.json.\n')
}

function generatedReason(entry) {
	const verdict = 'Replace this generated reason with the review decision.'
	return `Development-only ${entry.severity} advisory; production excludes it. ${verdict}`
}
