// The `File` class does not implement the `path` property in the official File API.
// However, nw.js adds this property to get the native path of a file.
// See: https://developer.mozilla.org/en-US/docs/Web/API/File
// See: https://docs.nwjs.io/en/latest/References/Changes%20to%20DOM/#fileitempath
interface NWFile {
	path: string;
}

type ToastType = 'info' | 'success' | 'warning' | 'error' | 'progress';

type CDNRegion = { tag: string, url: string, delay: number | null };