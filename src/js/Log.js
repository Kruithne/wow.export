const fs = require('fs');
const util = require('util');
const Constants = require('./Constants');

const MAX_LOG_POOL = 1000;
const MAX_DRAIN_PER_TICK = 10;

const isClogged = false;
const pool = [];

/**
 * Invoked when the stream has finished flushing.
 */
const drainPool = () => {
    isClogged = false;

    // If the pool is empty, don't slip into a loop.
    if (pool.length === 0)
        return;

    let ticks = 0;
    while (!isClogged && ticks < MAX_DRAIN_PER_TICK && pool.length > 0) {
        isClogged = !stream.write(pool.shift());
        ticks++;
    }

    // Only schedule another drain if we're not blocked and we have
    // something remaining in the pool.
    if (!isClogged && pool.length > 0)
        process.nextTick(drainPool);

    /* ToDo: Handle error on pool overflow. */
};

/**
 * Write a message to the log.
 */
const write = (...parameters) => {
    const line = util.format(...parameters) + '\n';

    if (!isClogged) {
        isClogged = !stream.write(line);
    } else {
        // Stream is blocked, pool instead.
        // If pool exceeds MAX_LOG_POOL, explode.
        if (pool.length < MAX_LOG_POOL)
            pool.push(line);
    }

    // Mirror output to debugger.
    if (!BUILD_RELEASE)
        console.log(line);
};

// Initialize the logging stream.
const stream = fs.createWriteStream(Constants.RuntimeLog);
stream.once('error', () => { /* ToDo: Handle this. */ });
stream.on('drain', drainPool);

module.exports = { write };