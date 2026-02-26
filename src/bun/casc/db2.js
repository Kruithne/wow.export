import WDCReader from '../db/WDCReader.js';

const cache = new Map();

const preload_proxy = new Proxy({}, {
	get(target, table_name) {
		if (typeof table_name !== 'string')
			return undefined;

		return async () => {
			const file_path = `DBFilesClient/${table_name}.db2`;

			if (cache.has(table_name)) {
				const existing = cache.get(table_name);
				if (!existing.isLoaded)
					await existing.parse();
				existing.preload();
				return existing;
			}

			const reader = new WDCReader(file_path);
			await reader.parse();
			reader.preload();

			const wrapper = create_wrapper(reader);
			cache.set(table_name, wrapper);
			return wrapper;
		};
	}
});

const create_wrapper = (reader) => {
	let parse_promise = null;

	return new Proxy(reader, {
		get(reader_target, prop) {
			const value = reader_target[prop];

			if (typeof value === 'function') {
				if (prop === 'getRelationRows') {
					return function(...args) {
						if (!reader_target.isLoaded)
							throw new Error('Table must be loaded before calling getRelationRows. Use db2.preload.' + reader_target.fileName.split('/').pop().replace('.db2', '') + '() first.');

						if (reader_target.rows === null)
							throw new Error('Table must be preloaded before calling getRelationRows. Use db2.preload.' + reader_target.fileName.split('/').pop().replace('.db2', '') + '() first.');

						return value.apply(reader_target, args);
					};
				}

				return async function(...args) {
					if (!reader_target.isLoaded) {
						if (parse_promise === null)
							parse_promise = reader_target.parse();

						await parse_promise;
					}

					return value.apply(reader_target, args);
				};
			}

			return value;
		}
	});
};

const db2_proxy = new Proxy({ preload: preload_proxy }, {
	get(target, table_name) {
		if (table_name === 'preload')
			return preload_proxy;

		if (typeof table_name !== 'string')
			return undefined;

		if (cache.has(table_name))
			return cache.get(table_name);

		const file_path = `DBFilesClient/${table_name}.db2`;
		const reader = new WDCReader(file_path);
		const wrapper = create_wrapper(reader);

		cache.set(table_name, wrapper);
		return wrapper;
	}
});

export default db2_proxy;
