const argv = process.argv.slice(2);
const [hook_key, tag, update_url, manifest_url, package_url] = argv;

const res = await fetch('https://www.kruithne.net/wow.export/v2/trigger_update/' + tag, {
	method: 'POST',
	headers: {
		'Content-Type': 'application/json',
		'Authorization': hook_key
	},
	body: JSON.stringify({ update_url, manifest_url, package_url })
});

console.log(`HTTP ${res.status} ${res.statusText}`);
process.exit(res.ok ? 0 : 1);