module.exports = data => {
	const entries = [];
	const lines = data.split(/\r?\n/);

	// First line contains field definitions.
	// Example: Name!STRING:0|Path!STRING:0|Hosts!STRING:0|Servers!STRING:0|ConfigPath!STRING:0
	const headers = lines.shift().split('|');
	const fields = new Array(headers.length);

	// Whitespace is replaced so that a field like 'Install Key' becomes 'InstallKey'.
	// This just improves coding readability when accessing the fields later on.
	for (let i = 0, n = headers.length; i < n; i++)
		fields[i] = headers[i].split('!')[0].replace(' ', '');

	for (const entry of lines) {
		// Skip empty lines/comments.
		if (entry.trim().length === 0 || entry.startsWith('#'))
			continue;
			
		const node = {};
		const entryFields = entry.split('|');
		for (let i = 0, n = entryFields.length; i < n; i++)
			node[fields[i]] = entryFields[i];

		entries.push(node);
	}
	return entries;
};