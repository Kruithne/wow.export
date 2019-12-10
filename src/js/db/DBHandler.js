const log = require('../log');
const core = require('../core');
const WDC3 = require('./WDC3');

const WDC3_MAGIC = 0x33434457;

module.exports = {
	/**
	 * Open a DB using a table reader based on the data format.
	 * @param {string} fileName
	 * @param {object} schema
	 */
	openTable: async (fileName, schema) => {
		const data = await core.view.casc.getFileByName(fileName);

		// Allow this BLTE to have zeroed sections.
		data.partialDecrypt = true;

		const magic = data.readUInt32LE();

		let table;
		switch (magic) {
			case WDC3_MAGIC:
				log.write('Processing DB file %s as WDC3', fileName);
				table = new WDC3(data, schema);
				break;

			default:
				throw new Error('Unsupported DB format: %d', magic);
		}

		log.write('Extracted %d rows from %s', table.rows.size, fileName);
		return table;
	}
};