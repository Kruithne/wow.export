import { exporter } from '../views/main/rpc.js';

class FileWriter {
	constructor(path) {
		this.path = path;
		this.lines = [];
	}

	async writeLine(text) {
		this.lines.push(text);
	}

	async close() {
		await exporter.export_text(this.lines.join('\n'), this.path);
	}
}

export default FileWriter;
