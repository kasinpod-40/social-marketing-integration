#!/usr/bin/env node

const realDateNow = Date.now.bind(Date);
let lastIssued = Number.NEGATIVE_INFINITY;

Object.defineProperty(Date, 'now', {
  configurable: true,
  enumerable: false,
  writable: false,
  value() {
    const observed = realDateNow();
    lastIssued = observed > lastIssued ? observed : lastIssued + 1;
    return lastIssued;
  },
});
