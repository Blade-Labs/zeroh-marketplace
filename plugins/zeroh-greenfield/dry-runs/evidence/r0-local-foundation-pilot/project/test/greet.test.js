import test from 'node:test';
import assert from 'node:assert/strict';
import { greet } from '../src/index.js';

test('greets the supplied person, preserving spaces and Unicode', () => {
  assert.equal(greet('Ada'), 'Hello, Ada!');
  assert.equal(greet('Grace Hopper'), 'Hello, Grace Hopper!');
  assert.equal(greet('José'), 'Hello, José!');
});
