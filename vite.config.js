const { join, dirname, resolve } = require('path');
const recast = require('recast');
const parser = require('recast/parsers/babel');

function convertModuleImport(moduleImport, relativeBase) {
	if (moduleImport.startsWith('.'))
		return join(dirname(relativeBase), moduleImport).substring(1).replace(/\\/g, '/');
	else if (moduleImport.startsWith('@/'))
		return join('src', moduleImport.substring(1)).replace(/\\/g, '/');
}

function adjustRequireSrc(ast, id) {
	recast.types.visit(ast, {
		visitCallExpression(nodePath) {
			const node = nodePath.node;
			if (node.callee.type === 'Identifier' && node.callee.name === 'require') {
				const [arg] = node.arguments;
				if (arg.type === 'StringLiteral') {
					const converted = convertModuleImport(arg.value, id);
					if (converted != null)
						arg.value = converted;
				}
			}
			this.traverse(nodePath);
		}
	});
}

function getVueComponent(ast) {
	let retDecl = null;
	const b = recast.types.builders;

	recast.types.visit(ast, {
		visitObjectExpression(nodePath) {
			const decl = nodePath.value;

			// detect vue component by default export with `template` and (`setup` or `data`) properties
			let hasTemplate = false;
			let hasSetupData = false;
			for (const prop of decl.properties) {
				if (prop.key.type !== 'Identifier')
					continue;

				hasTemplate = hasTemplate || prop.key.name === 'template' || prop.key.name === 'render';
				hasSetupData = hasSetupData || prop.key.name === 'setup' || prop.key.name === 'data';
				if (prop.key.name === 'data') {
					// wrap original data body in a try block to gracefully handle errors
					recast.types.visit(prop, {
						visitBlockStatement(subPath) {
							if (
								subPath.parentPath.value.type === 'ObjectMethod' ||
                                                                subPath.parentPath.value.type === 'FunctionExpression' ||
                                                                subPath.parentPath.value.type === 'ArrowFunctionExpression'
							) {
								subPath.node.body = [
									b.tryStatement(
										b.blockStatement([...subPath.node.body]),
										b.catchClause(b.identifier('e'), null,
											b.blockStatement([
												b.expressionStatement(
													b.callExpression(
														b.memberExpression(b.identifier('console'), b.identifier('error')),
														[b.stringLiteral('Vue component crashed,'), b.identifier('e')]
													)
												),
												b.expressionStatement(
													b.callExpression(
														b.memberExpression(b.identifier('Vue'), b.identifier('onMounted')),
														[b.arrowFunctionExpression([], b.blockStatement([
															b.expressionStatement(b.assignmentExpression(
																'=',
																b.memberExpression(b.memberExpression(b.identifier('this'), b.identifier('$el')), b.identifier('innerHTML')),
																b.stringLiteral(`<crashed-component style="flex-grow: 1"></crashed-component>`)
															))
														]))]
													)
												),
												b.returnStatement(b.objectExpression([]))
											]))
									)
								];

								return false;
							}
							this.traverse(subPath);
						}
					});
				}

				if (prop.key.name === 'render') {
					// wrap original render body in a try block to gracefully handle errors
					recast.types.visit(prop, {
						visitBlockStatement(subPath) {
							if (
								subPath.parentPath.value.type === 'ObjectMethod' ||
                                                                subPath.parentPath.value.type === 'FunctionExpression' ||
                                                                subPath.parentPath.value.type === 'ArrowFunctionExpression'
							) {
								subPath.node.body = [
									b.tryStatement(
										b.blockStatement([...subPath.node.body]),
										b.catchClause(b.identifier('e'), null,
											b.blockStatement([
												b.expressionStatement(
													b.callExpression(
														b.memberExpression(b.identifier('console'), b.identifier('error')),
														[b.stringLiteral('Vue component crashed,'), b.identifier('e')]
													)
												),
												b.returnStatement(
													b.callExpression(
														b.memberExpression(b.identifier('Vue'), b.identifier('h')),
														[b.stringLiteral('crashed-component')]
													)
												)
											]))
									)
								];

								return false;
							}
							this.traverse(subPath);
						}
					});
				}
			}

			if (hasTemplate && hasSetupData) {
				retDecl = decl;
				return false;
			}

			this.traverse(nodePath);
		}
	});

	return retDecl;
}

function addVueHmr(ast, id) {
	let components = new Set();
	const b = recast.types.builders;

	const variableDeclarations = Object.fromEntries(
		ast.program.body
			.filter(node => node.type === 'VariableDeclaration')
			.map(node => [node.declarations[0].id.name, node])
	);

	for (let i = 0; i < ast.program.body.length; i++) {
		const node = ast.program.body[i];
		if (!node.type.startsWith('Export'))
			continue;

		try {
			let vueComponent = getVueComponent(node);
			if (vueComponent == null) {
				const variableName = node.declaration.name ?? (node.declaration.declarations ?? '')[0]?.init?.name;
				const variable = variableDeclarations[variableName];
				if (variableName == null || variable == null)
					continue;

				vueComponent = getVueComponent(variable);
				if (vueComponent == null)
					continue;
			}

			const name = node.type === 'ExportDefaultDeclaration'
				? 'default'
				: node.declaration.declarations[0].id.name;

			const componentId = `${id}:${name}`;
			components.add([componentId, name]);

			vueComponent.properties.push(b.objectProperty(
				b.identifier('__hmrId'),
				b.stringLiteral(componentId)));
		} catch (e) {
			console.error(e);
		}
	}

	if (components.size > 0) {
		const templateTests = [];
		for (const [_, name] of components.values()) {
			templateTests.push(`
if (newModule.${name}.template) {
	const errors = [];
	try {
		Vue.compile(newModule.${name}.template, {onError(e) { errors.push(e); }});
	} catch (e) { errors.push(e); }
	if (errors.length > 0) {
		for (const e of errors)
			console.error(${JSON.stringify(name)} + ": Vue template compilation errors,", e);
		newModule.${name}.template = \`<crashed-component style="flex-grow: 1"></crashed-component>\`;
	}
}`);
		}

		const astHot = recast.parse(`
if (import.meta.hot) {
	import.meta.hot.accept((newModule) => {
		if (newModule == null)
			return;

		${templateTests.join('\n')}

		${Array.from(components.values())
		.map(([componentId, name]) => `__VUE_HMR_RUNTIME__.reload(${JSON.stringify(componentId)}, newModule.${name})`)
		.join(';')};
	});
}`, { parser });

		ast.program.body.push(...astHot.program.body);

		return true;
	}
}

const hmrPlugin = {
	name: 'vue-hmr',
	async transformIndexHtml(html) {
		return html.replace(
			'<script defer type="text/javascript" src="app.js"></script>',
			'<script type="text/javascript" src="init.js"></script><script type="module" src="app-loader.js"></script>'
		);
	},
	async transform(code, id) {
		const relativeId = id.substring(resolve(__dirname).length);
		const isModule = relativeId.endsWith('.mjs');

		if (!(relativeId.startsWith('/src') && (isModule || relativeId === '/src/init.js')))
			return;

		const ast = recast.parse(code, { sourceFileName: id, parser });
		adjustRequireSrc(ast, relativeId);

		if (isModule && !code.includes('import.meta.hot')) {
			if (addVueHmr(ast, relativeId))
				console.log('vue-hmr:', relativeId);
		}

		return recast.print(ast, { sourceMapName: id });
	},
};

export default {
	root: join(__dirname, 'src'),
	server: { port: process.env.SERVER_PORT ?? 4175 },
	plugins: [hmrPlugin],
	sourcemap: true,
	clearScreen: false,
};
