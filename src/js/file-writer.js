/*!
	wow.export (https://github.com/Kruithne/wow.export)
	Authors: Kruithne <kruithne@gmail.com>
	License: MIT
 */
const fs = require('fs');

class FileWriter {
	/**
	 * Construct a new FileWriter instance.
	 * @param {string} file 
	 * @param {string} encoding 
	 */
	constructor(file, encoding = 'utf8') {
		try {
			this.stream = fs.createWriteStream(file, { flags: 'w', encoding });
		} catch (e) {
			if (e.code === 'EISDIR') {
				fs.rmSync(file, { recursive: true });
				this.stream = fs.createWriteStream(file, { flags: 'w', encoding });
			} else {
				throw e;
			}
		}

		this.blocked = false;
		this.resolver = null;
	}

	/**
	 * Write a line to the file.
	 * @param {string} line 
	 */
	async writeLine(line) {	
		if (this.blocked)
			await new Promise(resolve => this.resolver = resolve);
		
		const result = this.stream.write(line + '\n');
		if (!result) {
			this.blocked = true;
			this.stream.once('drain', () => this._drain());
		}
	}

	_drain() {
		this.blocked = false;
		this.resolver?.();
	}

	close() {
		this.stream.end();
	}
}

module.exports = FileWriter;