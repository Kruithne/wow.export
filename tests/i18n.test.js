const fs = require('fs');
const path = require('path');
const { describe, expect, test } = require('bun:test');

const i18n = require('../src/js/i18n');
const ROOT = path.resolve(__dirname, '..');

const flatten = (object, prefix = '', result = {}) => {
	for (const [key, value] of Object.entries(object)) {
		const fullKey = prefix ? prefix + '.' + key : key;
		if (value && typeof value === 'object')
			flatten(value, fullKey, result);
		else
			result[fullKey] = value;
	}
	return result;
};

const collectFiles = directory => {
	const files = [];
	for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
		const file = path.join(directory, entry.name);
		if (entry.isDirectory())
			files.push(...collectFiles(file));
		else if (/\.(js|html)$/.test(entry.name))
			files.push(file);
	}
	return files;
};

const collectStaticUIStrings = () => {
	const files = [path.join(ROOT, 'src/index.html')];
	files.push(...collectFiles(path.join(ROOT, 'src/js/modules')));
	files.push(...collectFiles(path.join(ROOT, 'src/js/components')));

	const strings = new Set();
	for (const file of files) {
		const source = fs.readFileSync(file, 'utf8');
		for (const match of source.matchAll(/>([^<>\n{}]{3,})</g)) {
			const value = match[1].replace(/\s+/g, ' ').trim();
			if (/^[A-Za-z][A-Za-z0-9 ,.'():+\-/!"?]+$/.test(value))
				strings.add(value);
		}
	}
	return strings;
};

describe('i18n dictionaries', () => {
	test('English and Simplified Chinese dictionaries have identical keys', () => {
		const english = flatten(require('../src/js/i18n/en-US.json'));
		const chinese = flatten(require('../src/js/i18n/zh-CN.json'));
		expect(Object.keys(chinese).sort()).toEqual(Object.keys(english).sort());
	});

	test('every static UI string has a dictionary entry', () => {
		const english = flatten(require('../src/js/i18n/en-US.json'));
		const values = new Set(Object.values(english));
		const missing = [...collectStaticUIStrings()].filter(value => !values.has(value));
		expect(missing).toEqual([]);
	});

	test('locale preference and fallback work', () => {
		i18n.setPreference('zh-CN');
		expect(i18n.getLocale()).toBe('zh-CN');
		expect(i18n.t('nav.models')).toBe('模型');

		i18n.setPreference('en-US');
		expect(i18n.getLocale()).toBe('en-US');
		expect(i18n.t('nav.models')).toBe('Models');
		expect(i18n.t('missing.key')).toBe('missing.key');

		i18n.setPreference('system');
		expect(i18n.getPreference()).toBe('en-US');
		expect(i18n.getLocale()).toBe('en-US');
	});
});
