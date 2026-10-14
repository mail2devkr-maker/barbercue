// Test-only clock shim used by the PR #168 disposable PostgreSQL HTTP certification.
// It runs in a dedicated child backend process and never changes the host clock or production code.
const fs = require('node:fs');

const clockFile = process.env.FASTQUE_TEST_CLOCK_FILE;
if (!clockFile)
  throw new Error(
    'FASTQUE_TEST_CLOCK_FILE is required for the test clock shim.',
  );

const NativeDate = global.Date;
const readEpoch = () => {
  const value = Number(fs.readFileSync(clockFile, 'utf8').trim());
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(
      'The PR #168 test clock file must contain a positive epoch-millisecond integer.',
    );
  }
  return value;
};

function ControlledDate(...args) {
  if (!new.target) return new NativeDate(readEpoch()).toString();
  return Reflect.construct(
    NativeDate,
    args.length ? args : [readEpoch()],
    new.target,
  );
}

Object.setPrototypeOf(ControlledDate, NativeDate);
ControlledDate.prototype = NativeDate.prototype;
ControlledDate.now = readEpoch;
ControlledDate.parse = NativeDate.parse;
ControlledDate.UTC = NativeDate.UTC;
global.Date = ControlledDate;
