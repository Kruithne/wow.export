// eslint-disable-next-line @typescript-eslint/no-var-requires
const fs = require('fs');

module.exports = {
	content: ['./src/app/**/*.{html,ts,vue}'],
	theme: JSON.parse(fs.readFileSync('./tailwind.theme.json'))
};