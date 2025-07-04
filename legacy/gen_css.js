const fs = require('fs');
const sass = require('sass');

const appScss = './src/app.scss';

(async () => {
	try {
		const result = sass.compile(appScss);
		await fs.promises.writeFile(appScss.replace('.scss', '.css'), result.css);
	} catch (err) {
		console.error('Failed to compile application css: %s', err);
	}
})();