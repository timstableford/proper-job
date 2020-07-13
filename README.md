# NodeJS Proper Job

A library containing various asyncronous utilities.

- Run promises in batches
- Run items from a queue in parallel
- Asyncronous queueing
- Polling queueing
- Auto-scaling (and manual scaling) connection pool

If you have 10,000 items that need to be processed asyncronously that take various amount of time this library may help you. Or if you're reading from a queue and doing a processing task and want to paralleise that.

## Why?

- Why not just use Promise.all?
  - Promise.all's error handling is odd. If one throws an error it won't wait for the others.
  - If you have 10,000 promises running them all in parallel can be daunting to a lot of systems.
- Why not Promise.allSettled?
  - If you're in an older NodeJS version or have a lot of things you need to do in parallel.
  - You could split it into segments of X size and run Promise.allSettled in a loop but that doesn't
    take into account some tasks being quicker than others. This library ensures X jobs are always running.

## Features

- Works on any Iterable or AsyncIterable including maps, arrays and Mongo cursors.
- It will run as many promises in parallel as you let it. If one finishes it will start another to keep it at the maximum allowed.
- It supports aborting mid-way through. This will wait for any running promises to finish and then return.
- TypeScript definitions.
- A queue that supports async operations with a cap that waits for it to drain before allowing more items. The queue also work as an async iterator.
- An auto-scaling connection pool to manage multiple database connections. Also supports manual scaling.
- A polling buffer. Useful for reading from a queue such as SQS or Redis where you execute a blocking pop. Automatically scales the number of polling instances based on usage.
- Unit tests.

## Examples

For more examples then the below such as using the scaling connection pool or polling async buffer please see the [test](test) folder.

### Simple Iteration

```
const execute = require('proper-job').execute;
// Or in TypeScript, import { execute } from 'proper-job';

async function main() {
    const things = ['thing1', 10, 20, 30, 40, 50, 'thing2'];
    const results = await execute(things, value => {
        // Do some stuff
        return Promise.resolve(`${value} done`);
    }, {
        parallel: 2 // The number of promises to run in parallel.
    })
    console.log(results);
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
```

### Iteration with init

```
const execute = require('proper-job').execute;
// Or in TypeScript, import { execute } from 'proper-job';

async function main() {
    const results = await execute(async () => {
        // Do some async thing.
        await new Promise(resolve => setTimeout(resolve, 100));
        // Then return an object with the init field.
        return {
            init: 'Some arbitrary init data, can be an object',
            iterable: [1, 2, 4]
        };
    }, (value, init) => {
        // Do some processing.
        // init is set to the same value as returned above.
        return Promise.resolve(`${init} ${value} done`);
    }, {
        parallel: 2 // The number of promises to run in parallel.
    })
    console.log(results);
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
```

### Iterating on a stream

```
const ProperJob = require('proper-job');

const execute = ProperJob.execute;
const AsyncBuffer = ProperJob.AsyncBuffer;

async function main() {
    const buffer = new AsyncBuffer();

    console.time('Execution Complete');

    execute(buffer, async value => {
        // Do some async thing on your value.
        console.log(value);
        await new Promise(resolve => setTimeout(resolve, 100));
    }, {
        parallel: 10 // The number of promises to run in parallel.
    }).then(() => {
        console.timeEnd('Execution Complete');
    }).catch(err => {
        console.error('Execution failed', err);
    });

    // Now push all your items as they're received. This will block until
    // the queue is within it's maximum size.
    for (let i = 0; i < 10; i++) {
        await buffer.push(i);
    }

    // Finally to cause the executor to quit, gracefully draining the queue.
    await buffer.quit();
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
```

## API

### Executor

The `execute` function is the main entry-point to this library.

The arguments are as follows:

- An iterable, eg an array, a map etc. Or a promise of one, or a callback that returns a promise of one.
  Or even a callback that returns a promise of `ExecutorInit`.
- A callback to do some work. The callbacks argument is a single value from the input and it must return a Promise.
  Note that if your iterable input returned an `ExecutorInit` the second argument will be the `init` field returned
  from the first call.
- An optional options object (`ExecutorConfig`).
- An optional callback that may return a promise that's called after execution completes.
  The first argument will be the `init` field if set.

It returns an `ExecutorPromise` on success. This is an extension of a normal Promise that contains an additional `abort()` function. Call this to ask `execute` to gracefully exit. Once the promise resolves it will return an `ExecutorResults` object. If an error occurs it throws an `ExecutorError`, this contains a field called `result` which is an `ExecutorResults` object.

#### ExecutorResults

The executor results object contains the following fields:

- `results` - An array of outputs returned from the promises in the callback. Note that the order of this is not guaranteed and if the callback returns undefined the result isn't stored.
- `errors` - An array of `ExecutorError` objects. If any errors ocurred they're stored here rather than results.
- `fulfilled` - The number of promises that completed succesfully.
- `aborted` - Set to true if `abort()` was called, otherwise undefined.

#### ExecutorPromise

Returned by `execute()`. A sub-class of Promise that has a function called `abort`.

#### ExecutorInit

You may need to do some initialisation before running your job. If your first argument to `execute` is an `ExecutorInit`, or a promise of one then the `init` field returned in that structure will be passed as the second result of the executors callback.

A structure that contains two fields:

- `init` - An arbitrary user specified data-strucutre.
- `iterable` - The Iterable to iterate on.

#### ExecutorError

A sub-class of Error thrown when all all items in the input iterator have been completed if there were any that failed. Contains a field called `result` which is an `ExecutorResults` object. The results will contain any succesful output in addition to the errors.

#### ExecutorAbortError

Throw this from within the executor callback argument to cause it to gracefully exit. The error count will remain 0 but aborted will be set to true.

#### ExecutorConfig

The optional third argument of `execute()`. It contains the following fields:

- `parallel` `(default 1)` - The number of promises to keep running in parallel.
- `continueOnError` `(default true)` - If set to false the executor will exit early if it encounters any errors.
  The default behaviour is to store the errors and throw them at the end.
- `storeOutput` `(default true)` - Whether to store the output of the callback in the `results` array. Errors will always be stored.
- `throwOnError` `(default true)` - Whether to throw on completion if any errors were encountered.
  If set to false and there are errors the `ExecutorResults` object will still contain the errors in its array.
- `maxErrors` `(default none)` - If set to a number will stop storing errors when the cap is met.

### AsyncBuffer

This class allows buffering from an asyncronous source and pushing it to a buffer that will block until it's below a specified size. It also provides a pop function that blocks until data is available or quit is called. In addition it can be used as an async iterator.

- `constructor` - Accepts an optional `AsyncBufferOptions` object as configuration.
- `push` - Accepts a single value to be pushed to the buffer and returns a Promise that resolves to void once it's added. This will throw an error if called after quit has been called.
- `pop` - Returns a Promise that resolves to the oldest value in the buffer or undefined if quit has been called.
- `Symbol.asyncIterator` - Used to iterate asyncronously eg `for await (const value of buffer)`, or passing to `execute`. Completed once `quit` is called and the buffer has drained. Returns a standard AsyncIterator.
- `quit` - Call this to cause the iterator to end and all pop calls to resolve. This call returns a Promise of void that only resolves when the queue has drained. After this is called subsequent calls to push will throw an error and pop will return a Promise that resolves to undefined.
- `length` - A property containing the number of items in the buffer.

#### AsyncBufferOptions

- `maxSize` `(default 100)` - The maximum number of items to allow into the buffer before blocking the push call until a pop.

### ScalingConnectionPool

This class is useful for managing multiple connections to a resource. It auto-scales based on how long resources are claimed for. It can also be manually scaled, as is done in PollingAsyncBuffer. This class extends EventEmitter.

- `constructor` - Accepts `CreateRunnerCallback<T>` as the first argument. A function with no parameters that may return a class that extends `ConnectionPoolRunner` or a promise of one. Errors thrown are emitted as 'error'. The second (optional) argument is a `ConnectionPoolOptions` object. A tick after the constructor is run the system will start scaling to the minimum configured instances.
- `run` - This functions claims an instance, calls the users callback and then releases the instance. Accepts a `ClaimCallback<T, V>`as it's argument. This is a callback that may return a value, Promise of a value or void. The first argument passed to the callback is the instance. If a value is returned then that value is also returned by `run`.
- `claim` - Returns an instance. Blocks until one is available. May cause scaling.
- `release` - Releases the instance passed in as it's first parameter. This is a value returned by claim.
- `quit` - Gracefully shuts down the pool. It stops new claims, and scaling, waits for all claims to releass, shuts down all instances and removes all listeners.
- `getClaimedCount` - Returns the number of instances in use.
- `getInstanceCount` - Returns the number of instances.
- `scaleDown` - Attempts to scale down. Will only do so if there are unclaimed instances. To wait for one to be unclaimed listen for the 'released' event. Returns a Promise of void. Also will not scale below the minimum instance config. Will do nothing if the system is already scaling. Emits 'scale' when it's possible to try again.
- `scaleUp` - Attempts to scale up. Won't go beyond the maximum instance config. If the system is currently scaling it waits for scaling to complete. Emits 'available' on success and emits 'scale' when scaling can be done again.

#### ConnectionPoolOptions

An object to configure a connection pool.

- `minInstances` `(default 1)` - The minimum number of instances. Scaled up to this on creation and won't scale below this.
- `maxInstances` `(default 16)` - The maximum number of instances. Won't scale above this.
- `scaleDownAt` `(default 0.4)` - When the usage is below 0.4 (calculated based on the total claim time vs the total possible claim time over a period) it will scale down by 1.
- `scaleUpAt` `(default 0.8)` - When usage is above this it scales up by 1.
- `scaleInterval` `(default 1000)` - Time in milliseconds between attempting to scale up or down by 1.
- `responsiveScale` `(default true)` - If enabled, the instance count is below the maximum and there are no instances unclaimed then this allows the `claim` function to create a new instance.
- `autoScale` `(default true)` - If enabled periodically uses the usage to scale up and down. If disabled `responsiveScale` is also disabled. Set this to false if manually using the `scaleUp` and `scaleDown` functions.

#### ConnectionPoolRunner

An abstract class with the following methods.

- `quit` - Returns a `Promise<void>`.

### PollingAsyncBuffer

This class is used when to parallelise blocking pops from a queue. For example when asking SQS for data over a REST interface of using Redis to blocking pop. This class extends `AsyncBuffer`.

- `constructor` - Accepts a `CreatePollingRunnerCallback<T>` as the first argument. This is a function with no parameters that returns a class that extends `PollingConnectionPoolRunner<T>` where `T` is the data type returned by the runners fetch function and the type of the data in the buffer. The second optional argument is a `PollingAsyncBufferOptions` object which has all of the options of both `ConnectionPoolOptions` and `AsyncBufferOptions`.
- `getInstanceCount` - Returns the number of instances currently in use.
- `quit` - Gracefully shuts down the queue and internal pool. Note that this will block until all of your `PollingConnectionPoolRunner`'s have returned undefined or a value. It will then continue to block until the queue is fully drained.

#### PollingConnectionPoolRunner

An abstract class with the following methods.

- `quit` - Returns a `Promise<void>`.
- `fetch` - Returns a `Promise<T | undefined>`. This is assumed to be a function that returns a value when it's available and on timeout returns undefined.
