/* Copyright (c) wow.export contributors. All rights reserved. */
/* Licensed under the MIT license. See LICENSE in project root for license information. */
import BufferWrapper from '../buffer';

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
 * Parse a build string into components.
 * @param buildID String representation of build (x.x.x.xxxxx)
 * @returns Build
 */
const parseBuildID = (buildID: string): Build => {
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

type BuildRange = {
	min: string;
	max: string;
}

type Build = {
	major: number;
	minor: number;
	patch: number;
	rev: number;
}

/**
 * Returns true if the provided build falls within the provided range.
 * @param build - Build to check
 * @param min - Minimum build
 * @param max - Maximum build
 * @returns If build falls in range
 */
const isBuildInRange = (build: string, min: string, max: string): boolean => {
	const buildToCheck = parseBuildID(build);
	const minBuild = parseBuildID(min);
	const maxBuild = parseBuildID(max);

	if (buildToCheck.major < minBuild.major || buildToCheck.major > maxBuild.major)
		return false;

	if (buildToCheck.minor < minBuild.minor || buildToCheck.minor > maxBuild.minor)
		return false;

	if (buildToCheck.patch < minBuild.patch || buildToCheck.patch > maxBuild.patch)
		return false;

	if (buildToCheck.rev < minBuild.rev || buildToCheck.rev > maxBuild.rev)
		return false;

	return true;
};

export class DBDField {
	type: string;
	name: string;
	isSigned: boolean = true;
	isID: boolean = false;
	isInline: boolean = true;
	isRelation: boolean = false;
	arrayLength: number = -1;
	size: number = -1;

	/**
	 * Construct a new DBDField instance.
	 * @param fieldName - Name of the field
	 * @param fieldType - Type of the field
	 */
	constructor(fieldName: string, fieldType: string) {
		this.type = fieldType;
		this.name = fieldName;
	}
}

export class DBDEntry {
	builds: Set<string> = new Set();
	buildRanges: Set<BuildRange> = new Set();
	layoutHashes: Set<string> = new Set();
	fields: Set<DBDField> = new Set();

	/**
	 * Add a build to this DBD entry.
	 * @param build - Build to add
	 */
	addBuild(build: string): void {
		this.builds.add(build);
	}

	/**
	 * Add a build range to this DBD entry.
	 * @param min - Minimum build
	 * @param max - Maximum build
	 */
	addBuildRange(min: string, max: string): void {
		this.buildRanges.add({ min: min, max: max });
	}

	/**
	 * Adds layouthashes to this DBD entry.
	 * @param hashes
	 */
	addLayoutHashes(...hashes: string[]): void {
		for (const hash of hashes)
			this.layoutHashes.add(hash);
	}

	/**
	 * Add a field to this DBD entry.
	 * @param field
	 */
	addField(field: DBDField): void {
		this.fields.add(field);
	}

	/**
	 * Check if this entry is valid for the provided buildID or layout hash.
	 * @param buildID - Build
	 * @param layoutHash - LayoutHash
	 * @returns {boolean}
	 */
	isValidFor(buildID: string, layoutHash: string): boolean {
		// Layout hash takes priority, being the quickest to check.
		if (this.layoutHashes.has(layoutHash))
			return true;

		// Check for a single build ID.
		if (this.builds.has(buildID))
			return true;

		// Fallback to checking build ranges.
		for (const range of this.buildRanges) {
			if (isBuildInRange(buildID, range.min, range.max))
				return true;
		}

		return false;
	}
}

export class DBDParser {
	entries: Set<DBDEntry> = new Set();
	columns: Map<string, string> = new Map();

	/**
	 * Construct a new DBDParser instance.
	 * @param data
	 */
	constructor(data: BufferWrapper) {
		this.parse(data);
	}

	/**
	 * Get a DBD structure for the provided buildID and layoutHash.
	 * @param buildID - Build to find definitions for
	 * @param layoutHash - Layouthash to find definitions for
	 * @returns DBDEntry if found, otherwise null
	 */
	getStructure(buildID: string, layoutHash: string): DBDEntry | null {
		for (const entry of this.entries) {
			if (entry.isValidFor(buildID, layoutHash))
				return entry;
		}

		return null;
	}

	/**
	 * Parse the contents of a DBD document.
	 * @param data
	 */
	parse(data: BufferWrapper): void {
		const lines = data.readLines();

		// Separate the file into chunks separated by empty lines.

		let chunk: Array<string> = [];
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
	 * @param chunk
	 */
	parseChunk(chunk: string[]): void {
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
						if (buildRange !== null)
							entry.addBuildRange(buildRange[1], buildRange[2]);
						else
							entry.addBuild(build.trim());
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
					const fieldName = fieldMatch[3];
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
					if (fieldMatch[5]?.length > 0)
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
	 * @param chunk
	 */
	parseColumnChunk(chunk: string[]): void {
		if (chunk === undefined)
			throw new Error('Invalid DBD: Missing column definitions.');

		// Remove the COLUMNS header.
		chunk.shift();

		for (const entry of chunk) {
			const match = entry.match(PATTERN_COLUMN);
			if (match !== null) {
				const columnType = match[1]; // int|float|locstring|string
				//const columnForeignKey = match[2]; // <TableName::ColumnName> or undefined
				const columnName = match[3].replace('?', ''); // Field_6_0_1_18179_000?

				// TODO: Support foreign key support.

				this.columns.set(columnName, columnType);
			}
		}
	}
}