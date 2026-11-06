import { spawnSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import process from 'node:process'
import { URL } from 'node:url'

export const POLICY_URL = new URL('../security/development-advisories.json', import.meta.url)
export const REVIEW_WINDOW_DAYS = 90
export const DEFAULT_OWNER = '@jst-stack/maintainers'

const SEVERITY_ORDER = ['info', 'low', 'moderate', 'high', 'critical']
const PRODUCTION_LEVEL_FLAG = '--production-level='

// Development waivers are the only waivers. A published package whose own dependency tree carries
// an advisory cannot be waived, so it names the severities it passes on the command line: anything
// above that level stays fatal, and everything below it is reported on every run.
export function readProductionLevel(argv = process.argv) {
	const flag = argv.find(value => value.startsWith(PRODUCTION_LEVEL_FLAG))
	if (flag === undefined) {
		return undefined
	}
	const level = flag.slice(PRODUCTION_LEVEL_FLAG.length)
	if (!SEVERITY_ORDER.includes(level)) {
		throw new Error(`Unknown production level: ${level}.`)
	}
	return level
}

export function exceedsLevel(severity, level) {
	return level === undefined || SEVERITY_ORDER.indexOf(severity) > SEVERITY_ORDER.indexOf(level)
}

// Advisories are grouped by package name, never by advisory id: npm reissues advisory ids for the
// same package, so an id-keyed ledger drifts on every registry refresh while the package, its
// severity and the review decision stay identical.
export function auditPackages({ omitDevelopment = false } = {}) {
	const report = runAudit(omitDevelopment)
	const packages = new Map()
	for (const [name, vulnerability] of Object.entries(report.vulnerabilities ?? {})) {
		const advisories = vulnerability.via.filter(value => typeof value === 'object')
		if (advisories.length > 0) {
			packages.set(name, merge(packages.get(name), advisories))
		}
	}
	return packages
}

// A missing ledger is an empty ledger, so a repository can opt out of waivers and still keep the
// production gate.
export async function readPolicy(url = POLICY_URL) {
	try {
		const policy = JSON.parse(await readFile(url, 'utf8'))
		return { waivers: Array.isArray(policy.waivers) ? policy.waivers : [] }
	}
	catch (error) {
		if (error.code === 'ENOENT') {
			return { waivers: [] }
		}
		throw error
	}
}

export function classify({ policy, full, production, today = new Date().toISOString().slice(0, 10) }) {
	const waived = new Map(policy.waivers.map(waiver => [waiver.package, waiver]))
	const developmentPackages = new Map([...full].filter(([name]) => !production.has(name)))
	const development = toEntries(developmentPackages)
	return {
		today,
		production: toEntries(production),
		development,
		reviewed: development.filter(entry => waived.has(entry.name)),
		unreviewed: development.filter(entry => !waived.has(entry.name)),
		expired: development
			.map(entry => waived.get(entry.name))
			.filter(waiver => waiver !== undefined && waiver.expires < today),
		stale: policy.waivers.filter(waiver => !developmentPackages.has(waiver.package)),
	}
}

export function describePackage(entry) {
	return `${entry.name} (${entry.severity}, advisory ${entry.advisories.join(', ')})`
}

function runAudit(omitDevelopment) {
	const command = omitDevelopment ? ['audit', '--json', '--omit=dev'] : ['audit', '--json']
	const audit = spawnSync('npm', command, { encoding: 'utf8', shell: process.platform === 'win32' })
	if (!audit.stdout) {
		throw new Error(audit.stderr || 'npm audit returned no report.')
	}
	const report = JSON.parse(audit.stdout)
	if (report.error !== undefined) {
		throw new Error(`npm audit failed: ${JSON.stringify(report.error)}`)
	}
	// A registry outage also exits non-zero, but without a report; never read that as a clean tree.
	if (report.metadata === undefined) {
		throw new Error('npm audit returned an unexpected report.')
	}
	return report
}

function merge(existing, advisories) {
	const entry = existing ?? { advisories: new Set(), severity: 'info', titles: new Set() }
	for (const advisory of advisories) {
		entry.advisories.add(String(advisory.source))
		entry.titles.add(advisory.title)
		if (SEVERITY_ORDER.indexOf(advisory.severity) > SEVERITY_ORDER.indexOf(entry.severity)) {
			entry.severity = advisory.severity
		}
	}
	return entry
}

function toEntries(packages) {
	return [...packages]
		.map(([name, entry]) => ({
			name,
			severity: entry.severity,
			advisories: [...entry.advisories].sort(),
			titles: [...entry.titles],
		}))
		.sort((left, right) => left.name.localeCompare(right.name))
}
