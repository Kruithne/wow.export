import fs from 'node:fs';

class FileWriter {
	constructor(file, encoding = 'utf8') {
		this.stream = fs.createWriteStream(file, { flags: 'w', encoding });
		this.blocked = false;
		this.resolver = null;
	}

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

export default FileWriter;
