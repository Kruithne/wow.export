export default (data) => {
	const entries = [];
	const lines = data.split(/\r?\n/);

	const headers = lines.shift().split('|');
	const fields = new Array(headers.length);

	for (let i = 0, n = headers.length; i < n; i++)
		fields[i] = headers[i].split('!')[0].replace(' ', '');

	for (const entry of lines) {
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
