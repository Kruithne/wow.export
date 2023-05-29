import { test, expect } from 'bun:test';

test('can check if using Bun', () => {
	expect(Bun).toBeDefined();
});