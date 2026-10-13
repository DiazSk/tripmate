import { clerkMessage, isCancellation } from './clerkError';

test("prefers Clerk's long message", () => {
  expect(clerkMessage({ errors: [{ message: 'Incorrect', longMessage: 'Password is incorrect.' }] })).toBe('Password is incorrect.');
});

test('falls back through short message, error message, fallback', () => {
  expect(clerkMessage({ errors: [{ message: 'Incorrect' }] })).toBe('Incorrect');
  expect(clerkMessage(new Error('Network down'))).toBe('Network down');
  expect(clerkMessage(undefined)).toBe("That didn't work. Try again.");
});

test('the Apple and Google cancel codes read as cancellation, nothing else does', () => {
  expect(isCancellation({ code: 'ERR_REQUEST_CANCELED' })).toBe(true);
  expect(isCancellation({ code: 'SIGN_IN_CANCELLED' })).toBe(true);
  expect(isCancellation({ code: '-5' })).toBe(true);
  expect(isCancellation({ code: 'ERR_NETWORK' })).toBe(false);
  expect(isCancellation(new Error('boom'))).toBe(false);
});
