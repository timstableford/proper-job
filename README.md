# NodeJS Proper Job

A library designed to run promises in batches.

If you have 10,000 items that need to be processed asyncronously that take various amount of time this library may help you.

## Why?

- Why not just use Promise.all?
  - Promise.all's error handling is odd. If one throws an error it won't wait for the others.
  - If you have 10,000 promises running them all in parallel can be daunting to a lot of systems.
- Why not Promise.allSettled?
  - If you're in an older NodeJS version or have a lot of things you need to do in parallel.
  - You could split it into segments of X size and run Promise.allSettled in a loop but that doesn't
    take into account some tasks being quicker than others. This library ensured X jobs are always running.

## Features

- Works on any iterable including maps, arrays and Mongo cursors.
- It will run as many promises in parallel as you let it. If one finishes sooner it will start another.
- It supports aborting mid-way through. This will wait for any running promises to finish and then return.
- TypeScript definitions.
- Unit tests.

## Example

```
import { execute } from 'proper-job';
// Or const execute = require('proper-job').execute;

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

## API

The `execute` function is the main entry-point to this library.

The arguments are as follows:

- An iterable, eg an array, a map etc.
- A callback to do some promising. The callbacks argument is a single value from the input and it must return a Promise.
- An optional options object (see below - `ExecutorConfig`).

It returns an `ExecutorPromise` on success. This is an extension of a normal Promise that contains an additional `abort()` function. Call this to ask `execute` to gracefully exit. Once the promise resolves it will return an `ExecutorResults` object. If an error occurs it throws an `ExecutorError`, this contains a field called `result` which is an `ExecutorResults` object.

### ExecutorResults

The executor results object contains the following fields:

- `results` - An array of outputs returned from the promises in the callback. Note that the order of this is not guaranteed and if the callback returns undefined the result isn't stored.
- `errors` - An array of `ExecutorError` objects. If any errors ocurred they're stored here rather than results.
- `fulfilled` - The number of promises that completed succesfully.
- `aborted` - Set to true if `abort()` was called, otherwise undefined.

### ExecutorPromise

Returned by `execute()`. A sub-class of Promise that has a function called `abort`.

### ExecutorError

A sub-class of Error thrown when all all items in the input iterator have been completed if there were any that failed. Contains a field called `result` which is an `ExecutorResults` object. The results will contain any succesful output in addition to the errors.

### ExecutorConfig

The optional third argument of `execute()`. It contains the following fields:

- `parallel` `(default 1)` - The number of promises to keep running in parallel.
- `continueOnError` `(default true)` - If set to false the executor will exit early if it encounters any errors.
  The default behaviour is to store the errors and throw them at the end.
- `storeOutput` `(default true)` - Whether to store the output of the callback in the `results` array. Errors will always be stored.
- `throwOnError` `(default true)` - Whether to throw on completion if any errors were encountered.
  If set to false and there are errors the `ExecutorResults` object will still contain the errors in its array.
