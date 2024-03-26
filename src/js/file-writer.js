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
		this.stream = fs.createWriteStream(file, { flags: 'w', encoding });
		this.blocked = false;
		
		this.queue = [];
	}

	/**
	 * Write a line to the file.
	 * @param {string} line 
	 */
	writeLine(line) {	
		if (this.blocked)
			this.queue.push(line);
		else
			this._push(line);
	}

	_push(line) {
		const result = this.stream.write(line + '\n');
		if (!result) {
			this.blocked = true;
			this.stream.once('drain', () => this._drain());
			return false;
		}

		return true;
	}

	_drain() {
		this.blocked = false;

		while (this.queue.length > 0) {
			const line = this.queue.shift();
			if (!this._push(line))
				return;
		}
	}

	close() {
		this.stream.end();
	}
}

module.exports = FileWriter;