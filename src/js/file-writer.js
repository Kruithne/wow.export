const fs = require('fs');

class FileWriter {
	/**
	 * Construct a new FileWriter instance.
	 * @param {string} file 
	 * @param {string} encoding 
	 */
	constructor(file, encoding = 'utf8') {
		this.isBlocked = false;
		this.isClosing = false;
		this.queue = [];
		this.stream = fs.createWriteStream(file, encoding);
		this.stream.on('drain', () => this.onDrain());
	}

	/**
	 * Invoked when the stream is drained.
	 */
	onDrain() {
		// Drain the queue as much as we can.
		while (this.queue.length > 0)
			if (!this.stream.write(this.queue.shift()))
				return;

		if (this.isClosing) {
			// Writer has been closed, finish up here.
			this.stream.end();
		} else {
			// Write still open, unblock queue.
			this.isBlocked = false;
		}
	}

	/**
	 * Write a line to the file.
	 * @param {string} line 
	 */
	writeLine(line) {
		line = line + '\n';
		
		if (this.isBlocked) {
			// The stream is currently flushing, queue lines.
			this.queue.push(line);
		} else {
			// No backlog, write directly to stream.
			this.isBlocked = !this.stream.write(line);
		}
	}

	/**
	 * Close the stream.
	 */
	async close() {
		return new Promise(res => {
			// Resolve this promise once the stream is done.
			this.stream.once('finish', res);

			// Mark our writer as closing so that if we're draining, the
			// queue can be fed to the stream before we actually close.
			this.isClosing = true;

			// If we're blocked, we need to wait for the queue to empty into
			// the system to be flushed before trying to end.
			if (!this.isBlocked)
				this.stream.end();
		});
	}
}

module.exports = FileWriter;