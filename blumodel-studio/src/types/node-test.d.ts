/**
 * Minimal typings for the two Node built-ins the TS unit tests use (`src/**\/__tests__/*.test.ts`,
 * run by `node scripts/test-ts.mjs`). The project doesn't depend on `@types/node` (no new
 * dependencies this round); if it ever does, delete this file.
 */
declare module 'node:test' {
  interface TestContext {
    name: string;
    skip(message?: string): void;
    todo(message?: string): void;
    test(name: string, fn: TestFn): Promise<void>;
  }
  type TestFn = (t: TestContext) => void | Promise<void>;
  interface TestOptions {
    skip?: boolean | string;
    todo?: boolean | string;
    only?: boolean;
    timeout?: number;
  }
  interface TestApi {
    (name: string, fn: TestFn): Promise<void>;
    (name: string, options: TestOptions, fn: TestFn): Promise<void>;
    todo(name: string, fn?: TestFn): Promise<void>;
    skip(name: string, fn?: TestFn): Promise<void>;
  }
  export const test: TestApi;
  export const it: TestApi;
  export function describe(name: string, fn: () => void | Promise<void>): Promise<void>;
  export function before(fn: () => void | Promise<void>): void;
  export function after(fn: () => void | Promise<void>): void;
  export function beforeEach(fn: () => void | Promise<void>): void;
  export function afterEach(fn: () => void | Promise<void>): void;
  export default test;
}

declare module 'node:assert/strict' {
  interface Assert {
    (value: unknown, message?: string): asserts value;
    ok(value: unknown, message?: string): asserts value;
    equal<T>(actual: unknown, expected: T, message?: string): asserts actual is T;
    notEqual(actual: unknown, expected: unknown, message?: string): void;
    deepEqual<T>(actual: unknown, expected: T, message?: string): asserts actual is T;
    notDeepEqual(actual: unknown, expected: unknown, message?: string): void;
    throws(fn: () => unknown, expected?: RegExp | ((err: unknown) => boolean) | object, message?: string): void;
    doesNotThrow(fn: () => unknown, message?: string): void;
    rejects(fn: Promise<unknown> | (() => Promise<unknown>), expected?: RegExp | object, message?: string): Promise<void>;
    match(value: string, regexp: RegExp, message?: string): void;
    doesNotMatch(value: string, regexp: RegExp, message?: string): void;
    fail(message?: string): never;
  }
  const assert: Assert;
  export default assert;
}
