/*!
	wow.export (https://github.com/Kruithne/wow.export)
	Authors: Kruithne <kruithne@gmail.com>
	License: MIT
 */
const parse_xml = (xml) => {
	let pos = 0;

	const skip_whitespace = () => {
		while (pos < xml.length && /\s/.test(xml[pos]))
			pos++;
	};

	const parse_tag_name = () => {
		const start = pos;
		while (pos < xml.length && /[a-zA-Z0-9_:.-]/.test(xml[pos]))
			pos++;

		return xml.slice(start, pos);
	};

	const parse_attributes = () => {
		const attrs = {};

		while (pos < xml.length) {
			skip_whitespace();

			if (xml[pos] === '>' || xml[pos] === '/' || xml[pos] === '?')
				break;

			const name_start = pos;
			while (pos < xml.length && /[a-zA-Z0-9_:.-]/.test(xml[pos]))
				pos++;

			const name = xml.slice(name_start, pos);

			skip_whitespace();

			if (xml[pos] === '=') {
				pos++;
				skip_whitespace();

				const quote = xml[pos];
				pos++;

				const value_start = pos;
				while (pos < xml.length && xml[pos] !== quote)
					pos++;

				const value = xml.slice(value_start, pos);
				pos++;

				attrs[`@_${name}`] = value;
			}
		}

		return attrs;
	};

	const parse_node = () => {
		skip_whitespace();

		if (pos >= xml.length)
			return null;

		if (xml[pos] !== '<')
			return null;

		pos++;

		// closing tag
		if (xml[pos] === '/') {
			while (pos < xml.length && xml[pos] !== '>')
				pos++;

			pos++;
			return null;
		}

		// processing instruction or xml declaration
		const is_declaration = xml[pos] === '?';
		if (is_declaration)
			pos++;

		const tag_name = (is_declaration ? '?' : '') + parse_tag_name();
		const attrs = parse_attributes();

		// self-closing or declaration
		if (xml[pos] === '/' || xml[pos] === '?') {
			pos++;
			if (xml[pos] === '>')
				pos++;

			return { tag: tag_name, attrs, children: [], self_closing: true };
		}

		if (xml[pos] === '>')
			pos++;

		const children = [];

		while (pos < xml.length) {
			skip_whitespace();

			if (pos >= xml.length)
				break;

			// check for closing tag
			if (xml[pos] === '<' && xml[pos + 1] === '/')
				break;

			const child = parse_node();
			if (child)
				children.push(child);
		}

		// skip closing tag
		if (xml[pos] === '<' && xml[pos + 1] === '/') {
			while (pos < xml.length && xml[pos] !== '>')
				pos++;

			pos++;
		}

		return { tag: tag_name, attrs, children };
	};

	const build_object = (node) => {
		if (!node)
			return {};

		const obj = { ...node.attrs };

		if (node.children.length === 0)
			return obj;

		// group children by tag name
		const groups = {};

		for (const child of node.children) {
			if (!groups[child.tag])
				groups[child.tag] = [];

			groups[child.tag].push(child);
		}

		// build child objects
		for (const [tag, nodes] of Object.entries(groups)) {
			if (nodes.length === 1)
				obj[tag] = build_object(nodes[0]);
			else
				obj[tag] = nodes.map(build_object);
		}

		return obj;
	};

	const root = {};

	while (pos < xml.length) {
		const node = parse_node();

		if (node)
			root[node.tag] = build_object(node);
	}

	return root;
};

export { parse_xml };
