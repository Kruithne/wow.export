const english = require('./en-US.json');
const simplifiedChinese = require('./zh-CN.json');
const Vue = require('vue/dist/vue.cjs.js');

const LOCALES = {
	'en-US': english,
	'zh-CN': simplifiedChinese
};

const originalText = new WeakMap();
const originalAttributes = new WeakMap();

let preference = 'en-US';
const state = Vue.reactive({ locale: 'en-US' });
let observer = null;
let applying = false;
let missingKeys = new Set();

const flatten = (object, prefix = '') => {
	const result = {};
	for (const [key, value] of Object.entries(object)) {
		const fullKey = prefix ? prefix + '.' + key : key;
		if (value && typeof value === 'object')
			Object.assign(result, flatten(value, fullKey));
		else
			result[fullKey] = value;
	}
	return result;
};

const dictionaries = Object.fromEntries(Object.entries(LOCALES).map(([key, value]) => [key, flatten(value)]));

const resolveLocale = value => {
	if (value === 'zh-CN' || value === 'en-US')
		return value;
	return 'en-US';
};

const interpolate = (value, params = {}) => value.replace(/\{([^}]+)\}/g, (_, name) => {
		return Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : '{' + name + '}';
	});

const translateKey = (key, params) => {
	const active = dictionaries[state.locale] || dictionaries['en-US'];
	const value = active[key] ?? dictionaries['en-US'][key];
	if (value === undefined) {
		if (!missingKeys.has(key) && typeof BUILD_RELEASE !== 'undefined' && !BUILD_RELEASE)
			console.warn('[i18n] Missing translation key:', key);
		missingKeys.add(key);
		return key;
	}
	return interpolate(value, params);
};

const translateText = text => {
	const leading = text.match(/^\s*/)?.[0] || '';
	const trailing = text.match(/\s*$/)?.[0] || '';
	const trimmed = text.trim();
	if (!trimmed)
		return text;

	const key = Object.entries(dictionaries['en-US']).find(([, value]) => value === trimmed)?.[0];
	return key ? leading + translateKey(key) + trailing : text;
};

const translateNode = node => {
	if (node.nodeType === Node.TEXT_NODE) {
		const current = node.nodeValue;
		const previous = originalText.get(node);
		if (previous === undefined || (current !== previous && current !== translateText(previous)))
			originalText.set(node, current);
		const source = originalText.get(node);
		const result = translateText(source);
		if (node.nodeValue !== result)
			node.nodeValue = result;
		return;
	}

	if (node.nodeType !== Node.ELEMENT_NODE)
		return;

	for (const attribute of ['title', 'placeholder', 'aria-label', 'value']) {
		if (!node.hasAttribute(attribute))
			continue;
		let values = originalAttributes.get(node);
		if (!values) {
			values = {};
			originalAttributes.set(node, values);
		}
		if (!(attribute in values))
			values[attribute] = node.getAttribute(attribute);
		else if (node.getAttribute(attribute) !== values[attribute] && node.getAttribute(attribute) !== translateText(values[attribute]))
			values[attribute] = node.getAttribute(attribute);
		const translated = translateText(values[attribute]);
		if (node.getAttribute(attribute) !== translated)
			node.setAttribute(attribute, translated);
	}

	for (const child of node.childNodes)
		translateNode(child);
};

const apply = () => {
	if (typeof document === 'undefined' || applying)
		return;
	applying = true;
	try {
		translateNode(document.body);
	} finally {
		applying = false;
	}
};

const setLocale = value => {
	const nextLocale = resolveLocale(value);
	preference = value === 'zh-CN' || value === 'en-US' ? value : 'en-US';
	if (state.locale !== nextLocale) {
		state.locale = nextLocale;
		apply();
	}
};

const init = app => {
	if (app) {
		app.config.globalProperties.$t = translateKey;
		app.config.globalProperties.$tc = (key, count, params = {}) => translateKey(key, { ...params, count });
	}
	if (typeof MutationObserver !== 'undefined' && document.body) {
		observer = new MutationObserver(() => apply());
		observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true });
	}
	apply();
};

const setPreference = value => {
	preference = value || 'en-US';
	setLocale(preference);
};

const getPreference = () => preference;
const getLocale = () => state.locale;

module.exports = { init, setLocale, setPreference, getPreference, getLocale, t: translateKey, tc: (key, count, params) => translateKey(key, { ...params, count }) };
