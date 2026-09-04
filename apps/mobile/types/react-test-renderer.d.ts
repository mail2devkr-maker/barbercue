// No published @types/react-test-renderer build currently matches react-test-renderer@19.x /
// react@19.2.3 in this repo. Declared loosely (any) here — this package is a test-only dependency,
// never shipped in the app bundle, so this has no runtime or production type-safety impact.
declare module 'react-test-renderer';
