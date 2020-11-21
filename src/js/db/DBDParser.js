/*!
	wow.export (https://github.com/Kruithne/wow.export)
	Authors: Kruithne <kruithne@gmail.com>, Martin Benjamins <marlamin@marlamin.com>
	License: MIT
 */

/**
 * Pattern to match column definitions in a DBD document.
 * @type {RegExp}
 */
const PATTERN_COLUMN = /^(int|float|locstring|string)(<[^:]+::[^>]+>)?\s([^\s]+)/;

/**
 * Pattern to match build identifiers in a DBD document.
 * @type {RegExp}
 */
const PATTERN_BUILD = /^BUILD\s(.*)/;

/**
 * Pattern to match build range identifiers in a DBD document.
 * @type {RegExp}
 */
const PATTERN_BUILD_RANGE = /([^-]+)-(.*)/;

/**
 * Pattern to match comment entries in a DBD document.
 * Note: Comment data is not captured since it is discarded in parsing.
 * @type {RegExp}
 */
const PATTERN_COMMENT = /^COMMENT\s/;

/**
 * Pattern to match layout hash identifiers in a DBD document.
 * @type {RegExp}
 */
const PATTERN_LAYOUT = /^LAYOUT\s(.*)/;

/**
 * Pattern to match a field entry in a DBD document.
 * @type {RegExp}
 */
const PATTERN_FIELD = /^(\$([^$]+)\$)?([^<[]+)(<(u|)(\d+)>)?(\[(\d+)\])?$/;

/**
 * Pattern to match the components of a build ID.
 * @type {RegExp}
 */
const PATTERN_BUILD_ID = /(\d+).(\d+).(\d+).(\d+)/;

/**
 * Parse a build ID into components.
 * @param {string} buildID 
 * @returns {object}
 */
const parseBuildID = (buildID) => {
	const parts = buildID.match(PATTERN_BUILD_ID);
	const entry = { major: 0, minor: 0, patch: 0, rev: 0 };

	if (parts !== null) {
		entry.major = parseInt(parts[1]);
		entry.minor = parseInt(parts[2]);
		entry.patch = parseInt(parts[3]);
		entry.rev = parseInt(parts[4]);
	}

	return entry;
};

/**
 * Returns true if the provided build falls within the provided range.
 * @param {string} build 
 * @param {string} min 
 * @param {string} max 
 * @returns {boolean}
 */
const isBuildInRange = (build, min, max) => {
	build = parseBuildID(build);
	min = parseBuildID(min);
	max = parseBuildID(max);

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

class DBDField {
	/**
	 * Construct a new DBDField instance.
	 * @param {string} fieldName
	 * @param {string} fieldType
	 */
	constructor(fieldName, fieldType) {
		this.type = fieldType;
		this.name = fieldName;

		this.isSigned = true;
		this.isID = false;
		this.isInline = true;
		this.isRelation = false;
		this.arrayLength = -1;
		this.size = -1;
	}
}

class DBDEntry {
	/**
	 * Construct a new DBDEntry instance.
	 */
	constructor() {
		this.builds = new Set();
		this.buildRanges = new Set();
		this.layoutHashes = new Set();
		this.fields = new Set();
	}

	/**
	 * Add a build to this DBD entry.
	 * @param {string} min 
	 * @param {string} max 
	 */
	addBuild(min, max) {
		if (max !== undefined)
			this.buildRanges.add({ min, max });
		else
			this.builds.add(min);
	}
	
	/**
	 * Add a layout hash to this DBD entry.
	 * @param {string[]} hashes
	 */
	addLayoutHashes(...hashes) {
		for (const hash of hashes)
			this.layoutHashes.add(hash);
	}

	/**
	 * Add a field to this DBD entry.
	 * @param {DBDField} field 
	 */
	addField(field) {
		this.fields.add(field);
	}

	/**
	 * Check if this entry is valid for the provided buildID or layout hash.
	 * @param {string} buildID 
	 * @param {string} layoutHash 
	 * @returns {boolean}
	 */
	isValidFor(buildID, layoutHash) {
		// Layout hash takes priority, being the quickest to check.
		if (this.layoutHashes.has(layoutHash))
			return true;

		// Check for a single build ID.
		if (this.builds.has(buildID))
			return true;

		// Fallback to checking build ranges.
		for (const range of this.buildRanges)
			if (isBuildInRange(buildID, range.min, range.max))
				return true;

		return false;
	}
}

class DBDParser {
	/**
	 * Construct a new DBDParser instance.
	 * @param {BufferReader} data 
	 */
	constructor(data) {
		this.entries = new Set();
		this.columns = new Map();

		this.parse(data);
	}

	/**
	 * Get a DBD structure for the provided buildID and layoutHash.
	 * @param {string} buildID 
	 * @param {string} layoutHash 
	 * @returns {?DBDEntry}
	 */
	getStructure(buildID, layoutHash) {
		for (const entry of this.entries)
			if (entry.isValidFor(buildID, layoutHash))
				return entry;

		return null;
	}

	/**
	 * Parse the contents of a DBD document.
	* @param {BufferReader} data 
	 */
	parse(data) {
		const lines = data.readLines();

		// Separate the file into chunks separated by empty lines.
		let chunk = [];
		for (const line of lines) {
			if (line.trim().length > 0) {
				chunk.push(line);
			} else {
				this.parseChunk(chunk);
				chunk = [];
			}
		}

		// Ensure last chunk is accounted for.
		if (chunk.length > 0)
			this.parseChunk(chunk);
		
		if (this.columns.size === 0)
			throw new Error('Invalid DBD: No columns defined.');
	}

	/**
	 * Parse a chunk from this DBD document.
	 * @param {string[]} chunk 
	 */
	parseChunk(chunk) {
		if (chunk[0] === 'COLUMNS') {
			this.parseColumnChunk(chunk);
		} else {
			const entry = new DBDEntry();
			for (const line of chunk) {
				// Build IDs.
				const buildMatch = line.match(PATTERN_BUILD);
				if (buildMatch !== null) {
					// BUILD 1.7.0.4671-1.8.0.4714
					// BUILD 0.9.1.3810
					// BUILD 1.13.6.36231, 1.13.6.36310
					const builds = buildMatch[1].split(',');
					for (const build of builds) {
						const buildRange = build.match(PATTERN_BUILD_RANGE);
						if (buildRange !== null) {
							entry.addBuild(buildRange[1], buildRange[2]);
						} else {
							entry.addBuild(build.trim());
						}
					}

					continue;
				}

				// Skip comments.
				const commentMatch = line.match(PATTERN_COMMENT);
				if (commentMatch !== null)
					continue;

				// Layout hashes.
				const layoutMatch = line.match(PATTERN_LAYOUT);
				if (layoutMatch !== null) {
					// LAYOUT 0E84A21C, 35353535
					entry.addLayoutHashes(...(layoutMatch[1].split(',').map(e => e.trim())));
					continue;
				}

				const fieldMatch = line.match(PATTERN_FIELD);
				if (fieldMatch !== null) {
					const fieldName = fieldMatch[3]
					const fieldType = this.columns.get(fieldName);

					if (fieldType === undefined)
						throw new Error('Invalid DBD: No field type defined for ' + fieldName);

					const field = new DBDField(fieldName, fieldType);

					// Parse annotations, (eg 'id,noninline,relation').
					if (fieldMatch[2] !== undefined) {
						const annotations = fieldMatch[2].split(',');
						if (annotations.includes('id'))
							field.isID = true;

						if (annotations.includes('noninline'))
							field.isInline = false;

						if (annotations.includes('relation'))
							field.isRelation = true;
					}

					// Parse signedness, either 'u' or undefined.
					if (fieldMatch[5].length > 0)
						field.isSigned = false;

					// Parse data size (eg '32').
					if (fieldMatch[6] !== undefined) {
						const dataSize = parseInt(fieldMatch[6]);
						if (!isNaN(dataSize))
							field.size = dataSize;
					}

					// Parse array size (eg '2').
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

	/**
	 * Parse the column definition of a DBD document.
	 * @param {string[]} chunk 
	 */
	parseColumnChunk(chunk) {
		if (chunk === undefined)
			throw new Error('Invalid DBD: Missing column definitions.');

		// Remove the COLUMNS header.
		chunk.shift();

		for (const entry of chunk) {
			const match = entry.match(PATTERN_COLUMN);
			if (match !== null) {
				const columnType = match[1]; // int|float|locstring|string
				const columnForeignKey = match[2]; // <TableName::ColumnName> or undefined
				const columnName = match[3].replace('?', ''); // Field_6_0_1_18179_000?

				// TODO: Support foreign key support.

				this.columns.set(columnName, columnType);
			}
		}
	}
}

module.exports = DBDParser;