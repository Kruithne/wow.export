// shared Map/Set serialization for RPC transport
// used on both bun and view sides

function serialize(value) {
	if (value instanceof Map)
		return { __t: 'M', e: Array.from(value.entries()).map(([k, v]) => [serialize(k), serialize(v)]) };

	if (value instanceof Set)
		return { __t: 'S', v: Array.from(value).map(serialize) };

	if (Array.isArray(value))
		return value.map(serialize);

	if (value !== null && typeof value === 'object') {
		const result = {};
		for (const key of Object.keys(value))
			result[key] = serialize(value[key]);

		return result;
	}

	return value;
}

function deserialize(value) {
	if (value !== null && typeof value === 'object') {
		if (value.__t === 'M')
			return new Map(value.e.map(([k, v]) => [deserialize(k), deserialize(v)]));

		if (value.__t === 'S')
			return new Set(value.v.map(deserialize));

		if (Array.isArray(value))
			return value.map(deserialize);

		const result = {};
		for (const key of Object.keys(value))
			result[key] = deserialize(value[key]);

		return result;
	}

	return value;
}

export { serialize, deserialize };
