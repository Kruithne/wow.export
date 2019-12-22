const log = require('../log');
const core = require('../core');
const dbd = require('./DBD');

const WDC3 = require('./WDC3');
const WDC2 = require('./WDC2');

const WDC2_MAGIC = 0x32434457;
const WDC3_MAGIC = 0x33434457;
const CLS1_MAGIC = 0x434C5331;

module.exports = {
	/**
	 * Open a DB using a table reader based on the data format.
	 * @param {string} fileName
	 * @param {object} schema
	 */
	openTable: async (fileName, schema) => {
		const data = await core.view.casc.getFileByName(fileName, true, false, true);
		const magic = data.readUInt32LE();

		let table;
		switch (magic) {
			case WDC3_MAGIC:
				log.write('Processing DB file %s as WDC3', fileName);
				table = new WDC3(data, schema);
				break;

			case WDC2_MAGIC:
			case CLS1_MAGIC:
				log.write('Processing DB file %s as WDC2/CLS1', fileName);
				table = new WDC2(data, schema);
				break;

			default:
				throw new Error('Unsupported DB format: ' + magic);
		}

		log.write('Extracted %d rows from %s', table.rows.size, fileName);
		return table;
	}
};