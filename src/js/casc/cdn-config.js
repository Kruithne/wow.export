const KEY_VAR_PATTERN = /([^\s]+)\s?=\s?(.*)/;

module.exports = data => {
    const entries = {};
    let lines = data.split(/\r?\n/);

    for (const line of lines) {
        // Skip empty lines/comments.
        if (line.trim().length === 0 || line.startsWith('#'))
            continue;

        const match = line.match(KEY_VAR_PATTERN);
        if (match === null)
            throw new Error('Invalid token encountered parsing CDN config');

        entries[match[1]] = match[2];
    }
    
    return entries;
};