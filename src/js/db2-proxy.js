import { db } from '../views/main/rpc.js';

// proxy that translates db2.Table.method() calls into flat RPC calls
// this allows view-side modules to use the same db2.Table.method() pattern
// as the bun-side code without direct access to WDCReader instances

const table_cache = {};

const create_table_proxy = (table_name) => {
	return {
		getRow: (id) => db.get_row(table_name, id),

		getAllRows: async () => {
			const rows = await db.get_all_rows(table_name);
			const map = new Map();
			for (const row of rows)
				map.set(row.id ?? row.ID, row);

			return map;
		},

		getRelationRows: (foreign_key) => db.get_relation_rows(table_name, foreign_key),
	};
};

const preload_proxy = new Proxy({}, {
	get(target, table_name) {
		return () => db.preload(table_name);
	}
});

const db2_proxy = new Proxy({}, {
	get(target, prop) {
		if (prop === 'preload')
			return preload_proxy;

		if (!table_cache[prop])
			table_cache[prop] = create_table_proxy(prop);

		return table_cache[prop];
	}
});

export default db2_proxy;
