import { expect, test } from 'vitest';
import { Mutex } from '../src/store/mutex.js';

test('holds the lock across an await and runs queued work in arrival order', async () => {
  const mutex = new Mutex();
  const events: string[] = [];
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const first = mutex.runExclusive(async () => {
    events.push('first entered');
    await gate;
    events.push('first finished');
    return 1;
  });
  const second = mutex.runExclusive(() => { events.push('second'); return 2; });
  const third = mutex.runExclusive(() => { events.push('third'); return 3; });
  await Promise.resolve();
  expect(events).toEqual(['first entered']);
  release();
  expect(await Promise.all([first, second, third])).toEqual([1, 2, 3]);
  expect(events).toEqual(['first entered', 'first finished', 'second', 'third']);
});

test.each([false, true])('releases the queue after a failure (async=%s)', async (asyncFailure) => {
  const mutex = new Mutex();
  const failing = mutex.runExclusive(() => {
    if (asyncFailure) return Promise.reject(new Error('failed operation'));
    throw new Error('failed operation');
  });
  const next = mutex.runExclusive(() => 'queue still works');
  await expect(failing).rejects.toThrow('failed operation');
  expect(await next).toBe('queue still works');
});
