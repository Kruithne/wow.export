export default class EventEmitter {
	constructor() {
		this._events = new Map();
	}

	on(event, fn) {
		if (!this._events.has(event))
			this._events.set(event, new Set());

		this._events.get(event).add(fn);
		return this;
	}

	off(event, fn) {
		this._events.get(event)?.delete(fn);
		return this;
	}

	once(event, fn) {
		const wrapper = (...args) => {
			this.off(event, wrapper);
			fn(...args);
		};
		return this.on(event, wrapper);
	}

	emit(event, ...args) {
		const handlers = this._events.get(event);
		if (handlers)
			for (const fn of handlers) fn(...args);

		return this;
	}

	removeAllListeners(event) {
		if (event)
			this._events.delete(event);
		else
			this._events.clear();

		return this;
	}

	setMaxListeners() {
		return this;
	}
}
