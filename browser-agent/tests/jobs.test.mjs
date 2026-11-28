import test from 'node:test';
import assert from 'node:assert/strict';
import { opensOwnWindow } from '../dist/jobs.js';

test('every job that opens its own window is allowed right after the claim', () => {
  for (const kind of ['open', 'hide', 'feed', 'post']) assert.equal(opensOwnWindow({ kind, reuse: false }), true, kind);
  assert.equal(opensOwnWindow({ kind: 'open' }), true);
  // Reusing a window that is already open (and allowed) needs nothing new.
  for (const kind of ['hide', 'feed', 'post']) assert.equal(opensOwnWindow({ kind, reuse: true }), false, kind);
  for (const kind of ['close', 'check_proxy', 'preview']) assert.equal(opensOwnWindow({ kind }), false, kind);
});
