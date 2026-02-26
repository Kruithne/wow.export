const PATTERN_COLUMN = /^(int|float|locstring|string)(<[^:]+::[^>]+>)?\s([^\s]+)/;
const PATTERN_BUILD = /^BUILD\s(.*)/;
const PATTERN_BUILD_RANGE = /([^-]+)-(.*)/;
const PATTERN_COMMENT = /^COMMENT\s/;
const PATTERN_LAYOUT = /^LAYOUT\s(.*)/;
const PATTERN_FIELD = /^(\$([^$]+)\$)?([^<[]+)(<(u|)(\d+)>)?(\[(\d+)\])?$/;
const PATTERN_BUILD_ID = /(\d+).(\d+).(\d+).(\d+)/;

const parse_build_id = (build_id) => {
	const parts = build_id.match(PATTERN_BUILD_ID);
	const entry = { major: 0, minor: 0, patch: 0, rev: 0 };

	if (parts !== null) {
		entry.major = parseInt(parts[1]);
		entry.minor = parseInt(parts[2]);
		entry.patch = parseInt(parts[3]);
		entry.rev = parseInt(parts[4]);
	}

	return entry;
};

const is_build_in_range = (build, min, max) => {
	build = parse_build_id(build);
	min = parse_build_id(min);
	max = parse_build_id(max);

	if (build.major < min.major || build.major > max.major)
		return false;

	if (build.minor < min.minor || build.minor > max.minor)
		return false;

	if (build.patch < min.patch || build.patch > max.patch)
		return false;

	if (build.rev < min.rev || build.rev > max.rev)
		return false;

	return true;
};

export class DBDField {
	constructor(field_name, field_type) {
		this.type = field_type;
		this.name = field_name;

		this.isSigned = true;
		this.isID = false;
		this.isInline = true;
		this.isRelation = false;
		this.arrayLength = -1;
		this.size = -1;
	}
}

export class DBDEntry {
	constructor() {
		this.builds = new Set();
		this.buildRanges = new Set();
		this.layoutHashes = new Set();
		this.fields = new Set();
	}

	addBuild(min, max) {
		if (max !== undefined)
			this.buildRanges.add({ min, max });
		else
			this.builds.add(min);
	}

	addLayoutHashes(...hashes) {
		for (const hash of hashes)
			this.layoutHashes.add(hash);
	}

	addField(field) {
		this.fields.add(field);
	}

	isValidFor(build_id, layout_hash) {
		if (this.layoutHashes.has(layout_hash))
			return true;

		if (this.builds.has(build_id))
			return true;

		for (const range of this.buildRanges) {
			if (is_build_in_range(build_id, range.min, range.max))
				return true;
		}

		return false;
	}
}

export class DBDParser {
	constructor(data) {
		this.entries = new Set();
		this.columns = new Map();

		this.parse(data);
	}

	getStructure(build_id, layout_hash) {
		for (const entry of this.entries) {
			if (entry.isValidFor(build_id, layout_hash))
				return entry;
		}

		return null;
	}

	parse(data) {
		const lines = data.readLines();

		let chunk = [];
		for (const line of lines) {
			if (line.trim().length > 0) {
				chunk.push(line);
			} else {
				this.parseChunk(chunk);
				chunk = [];
			}
		}

		if (chunk.length > 0)
			this.parseChunk(chunk);

		if (this.columns.size === 0)
			throw new Error('Invalid DBD: No columns defined.');
	}

	parseChunk(chunk) {
		if (chunk[0] === 'COLUMNS') {
			this.parseColumnChunk(chunk);
		} else {
			const entry = new DBDEntry();
			for (const line of chunk) {
				const buildMatch = line.match(PATTERN_BUILD);
				if (buildMatch !== null) {
					const builds = buildMatch[1].split(',');
					for (const build of builds) {
						const buildRange = build.match(PATTERN_BUILD_RANGE);
						if (buildRange !== null)
							entry.addBuild(buildRange[1], buildRange[2]);
						else
							entry.addBuild(build.trim());
					}

					continue;
				}

				const commentMatch = line.match(PATTERN_COMMENT);
				if (commentMatch !== null)
					continue;

				const layoutMatch = line.match(PATTERN_LAYOUT);
				if (layoutMatch !== null) {
					entry.addLayoutHashes(...(layoutMatch[1].split(',').map(e => e.trim())));
					continue;
				}

				const fieldMatch = line.match(PATTERN_FIELD);
				if (fieldMatch !== null) {
					const fieldName = fieldMatch[3];
					const fieldType = this.columns.get(fieldName);

					if (fieldType === undefined)
						throw new Error('Invalid DBD: No field type defined for ' + fieldName);

					const field = new DBDField(fieldName, fieldType);

					if (fieldMatch[2] !== undefined) {
						const annotations = fieldMatch[2].split(',');
						if (annotations.includes('id'))
							field.isID = true;

						if (annotations.includes('noninline'))
							field.isInline = false;

						if (annotations.includes('relation'))
							field.isRelation = true;
					}

					if (fieldMatch[5]?.length > 0)
						field.isSigned = false;

					if (fieldMatch[6] !== undefined) {
						const dataSize = parseInt(fieldMatch[6]);
						if (!isNaN(dataSize))
							field.size = dataSize;
					}

					if (fieldMatch[8] !== undefined) {
						const arrayLength = parseInt(fieldMatch[8]);
						if (!isNaN(arrayLength))
							field.arrayLength = arrayLength;
					}

					entry.addField(field);
				}
			}

			this.entries.add(entry);
		}
	}

	parseColumnChunk(chunk) {
		if (chunk === undefined)
			throw new Error('Invalid DBD: Missing column definitions.');

		chunk.shift();

		for (const entry of chunk) {
			const match = entry.match(PATTERN_COLUMN);
			if (match !== null) {
				const columnType = match[1];
				const columnName = match[3].replace('?', '');
				this.columns.set(columnName, columnType);
			}
		}
	}
}
