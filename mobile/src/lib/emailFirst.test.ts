import { afterEmail, looksLikeEmail, passwordToGo } from './emailFirst';

test('an unknown address makes an account, a known one asks for its password', () => {
  expect(afterEmail('form_identifier_not_found', [])).toBe('create');
  expect(afterEmail(undefined, [{ strategy: 'email_code' }, { strategy: 'password' }])).toBe('password');
});

test('an account with no password gets a code, or the button it was made with', () => {
  expect(afterEmail(undefined, [{ strategy: 'email_code' }])).toBe('code');
  expect(afterEmail(undefined, [{ strategy: 'oauth_apple' }])).toBe('social-only');
});

test('any other error stays on the email step', () => {
  expect(afterEmail('form_param_format_invalid', [{ strategy: 'password' }])).toBeNull();
});

test('an address needs a local part, an @ and a dotted domain', () => {
  expect(looksLikeEmail(' zaid@mail.com ')).toBe(true);
  expect(looksLikeEmail('zaid@mail')).toBe(false);
  expect(looksLikeEmail('zaid mail.com')).toBe(false);
});

test('a new password counts down to 15 characters', () => {
  expect(passwordToGo('')).toBe(15);
  expect(passwordToGo('fourteen-chars')).toBe(1);
  expect(passwordToGo('fifteen-chars!!')).toBeNull();
});
