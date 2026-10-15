import { clerkCode, clerkMessage, isCancellation, unsupportedStepMessage } from './clerkError';

// unsupportedStepMessage warns for developers; keep that out of the test output.
beforeEach(() => jest.spyOn(console, 'warn').mockImplementation(() => {}));
afterEach(() => jest.restoreAllMocks());

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

test("a sign-up stuck on fields TripMate doesn't collect names them", () => {
  expect(unsupportedStepMessage({ status: 'missing_requirements', missingFields: ['username'] })).toBe(
    "TripMate can't finish this sign-up: it also needs a username, which the app doesn't ask for yet.",
  );
  expect(unsupportedStepMessage({ status: 'missing_requirements', missingFields: ['username', 'phone_number', 'legal_accepted'] })).toBe(
    "TripMate can't finish this sign-up: it also needs a username, a phone number and acceptance of the terms, which the app doesn't ask for yet.",
  );
});

test('an unknown field is named plainly rather than dropped', () => {
  expect(unsupportedStepMessage({ status: 'missing_requirements', missingFields: ['web3_wallet'] })).toMatch(/web3 wallet/);
});

test('a second factor is called what it is', () => {
  expect(unsupportedStepMessage({ status: 'needs_second_factor' })).toBe(
    "This account uses two-step verification, which TripMate doesn't support yet.",
  );
});

test('anything else keeps the general sentence', () => {
  expect(unsupportedStepMessage({ status: 'needs_identifier' })).toBe("This account needs a sign-in step TripMate doesn't support yet.");
});

test("reads Clerk's error code off the API error or the error itself", () => {
  expect(clerkCode({ errors: [{ code: 'form_identifier_not_found', message: "Couldn't find your account." }] })).toBe('form_identifier_not_found');
  expect(clerkCode({ code: 'network_error' })).toBe('network_error');
  expect(clerkCode(new Error('boom'))).toBeUndefined();
  expect(clerkCode(null)).toBeUndefined();
});
