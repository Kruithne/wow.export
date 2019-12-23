const util = require('util');
const log = require('../log');
const core = require('../core');
const generics = require('../generics');

module.exports = {
	/**
	 * Generates a DB schema based upon WoWDBDefs.
	 * @param {string} tableName
	 * @param {string} layoutHash
	 * @returns {object, object}
	 */
	getSchemaForTable: async (tableName, layouthash) => {
		// Download DBD for specific table (keep case sensitivity in mind)
		const url = util.format(core.view.config.dbdURL, tableName)
		let data = await generics.downloadFile(url);

		const targetBuild = core.view.casc.getBuildName();

		// Parse DBD
		const columnDefinitions = new Map();
		const versionDefinitions = [];

		const validTypes = ["int", "float", "string", "locstring"];

		const lines = data.readLines();
		let lineNumber = 0;

		if(lines[0].substring(0, 7) === "COLUMNS"){
			lineNumber++;
			while(true){
				const line = lines[lineNumber++];

				// Column definitions end at an empty line
				if(line.length === 0)
					break;

				// TYPE READING, find index of space (end of type) or < (foreign key)
				const spacePos = line.indexOf(' ');
				const larrPos = line.indexOf('<');
				const type = line.substring(0, (larrPos != -1 && spacePos > larrPos) ? larrPos : spacePos);

				// Check if type is valid, otherwise error out
				if(!validTypes.includes(type))
					throw new Error('Unsupported DBD type: ' + type);

				// SKIPPED: Foreign key reading

				// NAME READING
				const firstSpace = line.indexOf(' ');
				const lastSpace = line.lastIndexOf(' ');
				const name = line.substring(firstSpace + 1, (firstSpace === lastSpace) ? line.length : line.indexOf(' ', firstSpace + 1)).replace('?', '');

				// SKIPPED: Verified (?) and comment reading

				columnDefinitions.set(name, type);
			}
		}

		let layouthashes = [];
		let builds = [];
		let fields = [];

		for(let i = lineNumber; i < lines.length; i++){
			// Line is manipulated later on, not a const
			let line = lines[i];

			if(line.length === 0){
				versionDefinitions.push({fields, builds, layouthashes});

				layouthashes = [];
				builds = [];
				fields = [];
			}

			// Parse layouthashes
			if(line.substring(0, 6) === "LAYOUT"){
				layouthashes = line.replace("LAYOUT ", "").split(", ");
			}

			// Parse builds, skip BUILD lines with ranges
			if(line.substring(0, 5) === "BUILD" && !line.includes('-')){
				builds = builds.concat(builds, line.replace("BUILD ", "").split(", "));
			}

			if (line.substring(0, 6) !== "LAYOUT" && line.substring(0, 5) !== "BUILD" && line.substring(0, 7) !== "COMMENT" && line.length !== 0)
			{
				const field = { arrLength: 0 };

				if(line.indexOf('$') !== -1){
					// Annotation
					const start = line.indexOf('$');
					const end = line.indexOf('$', 1);

					const annotations = line.substring(start + 1, end - 1).split(",");

					field.isID = annotations.includes("id");
					field.isNonInline = annotations.includes("noninline");
					field.isRelation = annotations.includes("relation");

					line = line.substring(end + 1);
				}

				if(line.indexOf('<') !== -1){
					// Signedness, cardinality
					const start = line.indexOf('<');
					const end = line.indexOf('>');
					let size = line.substring(start + 1, end);
					if(size[0] === 'u'){
						field.isSigned = false;
						field.size = size.replace('u', '');
						line = line.replace("<u" + field.size + ">", "");
					}else{
						field.isSigned = true;
						field.size = size;
						line = line.replace("<" + field.size + ">", "");
					}
				}

				if(line.indexOf('[') !== -1){
					// Array length
					const start = line.indexOf('[');
					const end = line.indexOf(']');
					field.arrLength = line.substring(start + 1, end);
					line = line.replace("[" + field.arrLength + "]", "");
				}

				if(line.indexOf("//") !== -1){
					// Comment, skip
					line = line.substring(0, line.indexOf("//"));
				}

				field.name = line;

				if (!columnDefinitions.has(field.name))
					throw new Error('Could not find field in column definitions: ' + field.name);

				fields.push(field);
			}
		}

		// Sometimes DBDs don't end with a newline
		if(builds.length > 0){
			versionDefinitions.push({fields, builds, layouthashes});
		}

		let matchedDefinition;
		for (const versionDefinition of versionDefinitions) {
			if(versionDefinition.builds.includes(targetBuild)){
				matchedDefinition = versionDefinition;
			}
		}

		// TODO: Layouthash fallback, will require reordering of DB2 reading to get layouthash before reading full DB2
		/*
		if(matchedDefinition == undefined){
			for (const versionDefinition of versionDefinitions) {
				if(versionDefinition.layouthashes.includes(layouthash)){
					matchedDefinition = versionDefinition;
				}
			}
		}
		*/

		if(matchedDefinition === undefined)
			throw new Error('Unable to find version definition for build ' + targetBuild);

		return {columnDefinitions, matchedDefinition};
	}
}