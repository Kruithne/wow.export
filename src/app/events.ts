/* Copyright (c) wow.export contributors. All rights reserved. */
/* Licensed under the MIT license. See LICENSE in project root for license information. */
import EventEmitter from 'node:events';

const events = new EventEmitter();
events.setMaxListeners(666);

export default events;