// This allows us to import .toml files without errors.
declare module '*.toml' {
	const content: any;
	export default content;
}