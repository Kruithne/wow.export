/* Copyright (c) wow.export contributors. All rights reserved. */
/* Licensed under the MIT license. See LICENSE in project root for license information. */

// This is the main entry point for the application. This context/scope will be mixed with
// the browser context, so everything exposed here will be accessible from the browser
// and vice-versa.

const nwjsWindow = nw.Window.get();

class Application {
	static foo: number = 5;
}

globalThis.test = new Application();

const win = nw.Window.get();
win.showDevTools();