const log = require('../log');
const core = require('../core');

const WDC = require('./WDC');

const TABLE_FORMATS = {
	0x434C5331: { name: 'CLS1', id: WDC.FORMAT_WDC2 },
	0x32434457: { name: 'WDC2', id: WDC.FORMAT_WDC2 },
	0x33434457: { name: 'WDC3', id: WDC.FORMAT_WDC3 }
};

module.exports = {
	/**
	 * Open a DB using a table reader based on the data format.
	 * @param {string} fileName
	 * @param {object} schema
	 * @param {object} casc
	 */
	openTable: async (fileName, schema, casc = core.view.casc) => {
		const data = await casc.getFileByName(fileName, true, false, true);
		const magic = data.readUInt32LE();

		const format = TABLE_FORMATS[magic];
		if (!format)
			throw new Error('Unsupported DB format: ' + magic);

		log.write('Processing DB file %s as %s', fileName, format.name);
		const table = new WDC(data, schema, format.id);

		log.write('Parsed %s with %d rows', fileName, table.rows.size);
		return table;
	}
};