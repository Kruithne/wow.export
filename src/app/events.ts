/* Copyright (c) wow.export contributors. All rights reserved. */
/* Licensed under the MIT license. See LICENSE in project root for license information. */
import EventEmitter from 'node:events';

export default new class extends EventEmitter {
	constructor() {
		super();
		this.setMaxListeners(666);
	}

	/**
	 * Emits an event and awaits all listeners to complete.
	 * @param event - The event to emit
	 * @param args - The arguments to pass to the event listeners
	 */
	async emitAndAwait(event: string, ...args: any[]): Promise<void> {
		const listeners = this.listeners(event).map((listener) => listener(...args));
		await Promise.all(listeners);
	}
};