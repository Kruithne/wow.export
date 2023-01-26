//import { myTestFunction } from './test';

// This is a code comment.
// This is some more comments.

if (process.env.BUILD_TYPE === 'release')
	console.log('This will only be executed in a release build.');
else
	console.log('This will only be executed in a debug build.');

//console.log(myTestFunction());