/*!
	wow.export (https://github.com/Kruithne/wow.export)
	Authors: Kruithne <kruithne@gmail.com>
	License: MIT
 */
const core = require('./core');
const BLPFile = require('./casc/blp');

// inv_misc_questionmark
const DEFAULT_ICON = 'url(\'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAUDBAQEAwUEBAQFBQUGBwwIBwcHBw8LCwkMEQ8SEhEPERETFhwXExQaFRERGCEYGh0dHx8fExciJCIeJBweHx7/2wBDAQUFBQcGBw4ICA4eFBEUHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh7/wAARCAA4ADgDASIAAhEBAxEB/8QAGwABAAIDAQEAAAAAAAAAAAAAAAYHAgQFAwj/xAAwEAACAQQBAgYBAwIHAAAAAAABAgMABAURBhIhBxMxQVFhInGB8DLBCBVCUlOR4f/EABsBAAIDAQEBAAAAAAAAAAAAAAQFAAMGBwEC/8QAKxEAAQMCBAMIAwAAAAAAAAAAAQACAwQRBSExURJBYQYTFCIjcaHwFbHR/9oADAMBAAIRAxEAPwD43u7i4u7qW7u55bi4mdpJZZXLPI5OyzE9ySTsk16YuwvMnkIMfj7eS5up3CRRINlj/Pf2rWq/v8MvH7LH4LKc7ynSgj64bdnH9Eajcjj7J/H5/Ej3oarqPDxF+p5e6PwyhNdUthBsNSdgNVt4Lws4lwnDLlub3sF3dSLry3QmJG1sqiju7fZ/6Fak/LOALcFIsJkniBI6ysYJ/bf96hHO+U3fIcvPlsjK3QCRDHvtEm+ygfzZqEzZO7nlCwbTZ0qqNk/FK4qaao80jjf3sAtjU1dDhgEbIx7WuT1N19L47CcYy+MhyNlbxtDINjpXR37g/YqB+LGAwqY0w2sYSeFgesDupPbX37HX1Ux4VYX3G+AxQXMchvGV5WiB35Rb27fHqfvdV3zO9BjW0DdUjt1yHez+/wCtJ4ZJPE2Y4kA/C3v42jdhMk9RGBdtrWz4jp1y+6KrYpLnH3yTQTSW91byB45Y3KujqdhlI7ggjYIpWxnen/MG6fXpHV+v81Stmx3E0FcJqYhDM6MHQkLQqS4zmGUt8SMRcXd3LYJ/RCJ26AN710+hG+9RqvaxtZ728hs7WNpZ55FjiRfVmY6AH6k18yxskbZ4yVlFVz0sofAbO+8l1Sl3yG+gx+ItLi5mc9okTbE/J17Ae/oKvPw48LbHjCx5bMzRXWTUdQ/4rc/W/U/Z9Pb5qScB4dieBcf2fLe9aMvfXre+hsgH2Qf+mqz8ROfT5uSS1sma2xiEjZOmlHy3wD/trOz1MlT6MGTOZ3XRsPwyGkIrq/zSnMDk23xcb6Dluu5z/nEAc2GN3IRtZpFbQPyoNVRk74RBppnMkrnYBPdjXNvcvolLVQdf6z/YVyJHeRy7sWY+pJo+jw0RDNK8a7WGb04ze2mw/pSV2lkaRztmOzSsaU30WDJJNylS3wkymMwvO7HJ5SDzo4OpolLaHma0p37aJ33qJVb/AIM+HOG5Nxi6ymdiuCXuPLtjFKUIVQOo/B2Trv8ABoWtljjhcZDYHLLqmmC001RWsbAAXDOx0yzzUj8Q+fWWY4zJjcdFcxyXLr5plAGkB37E+pA/aqPzty0lwYFP4J6/Zqa+J3HE4tl47DDZa9nCwB3Wdgenfoo0APQb9PcVXTszuzsdsx2T90HhlPG1vEw3Hyn/AGoxGZ57l7OE88wRYbEddcgsaUpTZYtKUpUUWUiPHI0cisjqSGVhogj2NWLwDxSyXHMXFhzBby2kRbyzIp/EM3UR20fUnv39aUqmenjqGcEguEbh+IT4fN3sBsf2NlyuZ8gGZyF3k2dQ84/FAxbo7aAG6htKV5TxNibwtVuKV0lZKHv+3KUpSr0tWUaPJIscas7sQFVRskn2FKUqKL//2Q==\')';

const QUEUE_LIMIT = 20;

let _style = null;
let _loading = false;
const _queue = [];

/**
 * Returns the dynamic stylesheet used internally for item icons.
 * @returns {StyleSheet}
 */
const getStylesheet = () => {
	// Create dynamic stylesheet if we haven't already.
	if (_style === null) {
		_style = document.createElement('style');
		_style.setAttribute('id', 'item-icon-render');
		document.head.appendChild(_style);
	}

	return _style.sheet;
};

/**
 * Returns true if a given rule exists in the dynamic stylesheet.
 * @param {string} selector 
 * @returns {boolean}
 */
const iconRuleExists = (selector) => {
	const sheet = getStylesheet();
	for (const rule of sheet.rules) {
		if (rule.selectorText === selector)
			return true;
	}

	return false;
};

const processQueue = () => {
	if (_queue.length === 0) {
		_loading = false;
		return;
	}

	_loading = true;

	const entry = _queue.pop();
	core.view.casc.getFile(entry.fileDataID).then(data => {
		const blp = new BLPFile(data);
		entry.rule.style.backgroundImage = 'url(' + blp.getDataURL(false) + ')';
	}).catch(() => {
		// Icon failed to load. Keep the rule and leave it empty.
	}).finally(() => {
		processQueue();
	});
};

const queueItem = (fileDataID, rule) => {
	_queue.push({ fileDataID, rule });

	// If the queue is full, remove an element from the front rather than the back
	// since we want to prioritize the most recently requested icons, as they're
	// most likely the ones the user can see.
	if (_queue.length > QUEUE_LIMIT)
		_queue.shift();

	if (!_loading)
		processQueue();
};

const loadIcon = (fileDataID) => {
	const selector = '.icon-' + fileDataID;
	if (!iconRuleExists(selector)) {
		const sheet = getStylesheet();
		const ruleIndex = sheet.insertRule(selector + ' {}');
		const rule = sheet.rules[ruleIndex];

		rule.style.backgroundImage = DEFAULT_ICON;
		
		if (fileDataID === 0)
			return;

		queueItem(fileDataID, rule);
	}
};

module.exports = { loadIcon };