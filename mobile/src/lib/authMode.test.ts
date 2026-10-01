import { authMode } from './authMode';

test('reads the two modes the chooser sends', () => {
  expect(authMode('login')).toBe('login');
  expect(authMode('signup')).toBe('signup');
});

test('falls back to login for anything else, because a form with neither mode renders nothing', () => {
  // A stale link, a typo, or a cold-start deep link straight to the form.
  expect(authMode(undefined)).toBe('login');
  expect(authMode('')).toBe('login');
  expect(authMode('Signup')).toBe('login');
  expect(authMode(['signup'] as unknown as string)).toBe('login');
});
