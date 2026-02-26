const GITHUB_RELEASE_BASE = 'https://github.com/Kruithne/wow.export/releases/download';

const argv = process.argv.slice(2);
const [hook_key, prefix, tag] = argv;

if (!hook_key || !prefix || !tag) {
	console.error('usage: bun trigger_release.js <hook_key> <prefix> <tag>');
	process.exit(1);
}

const update_json_url = `${GITHUB_RELEASE_BASE}/${tag}/${prefix}-update.json`;
const bundle_url = `${GITHUB_RELEASE_BASE}/${tag}/${prefix}-wow.export.tar.zst`;
const installer_url = `${GITHUB_RELEASE_BASE}/${tag}/${prefix}-wow.export-installer.tar.zst`;

const res = await fetch('https://www.kruithne.net/wow.export/v2/trigger_update/' + prefix, {
	method: 'POST',
	headers: {
		'Content-Type': 'application/json',
		'Authorization': hook_key
	},
	body: JSON.stringify({ update_json_url, bundle_url, installer_url })
});

console.log(`HTTP ${res.status} ${res.statusText}`);
process.exit(res.ok ? 0 : 1);
