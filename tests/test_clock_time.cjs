#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const clock = require('../forge-source/clock-time.js');

test('pipeline countdown is canonical for text and hand position', () => {
  const result = clock.resolveClockTime({ minutes_to_midnight: 35 }, 50.93);
  assert.equal(result.display, '35m 00s');
  assert.equal(result.totalMinutesExact, 35);
  assert.equal(result.angleDeg, -210);
});

test('score conversion is used only when canonical countdown is absent', () => {
  const result = clock.resolveClockTime({}, 50);
  assert.equal(result.display, '15m 00s');
  assert.equal(result.angleDeg, -90);
});

test('fractional canonical countdown normalizes rounded seconds', () => {
  const result = clock.resolveClockTime({ minutes_to_midnight: 34.999 }, 0);
  assert.equal(result.display, '35m 00s');
  assert.equal(result.minutesToMidnight, 35);
});
