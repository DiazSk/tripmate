import { launchTarget } from './authGate';

const bare = { path: 'tripmate:///' };

test('a bare launch opens Home, signed out or not', () => {
  // Home is the first screen on every launch now; the landing is the tour, reached from Profile.
  expect(launchTarget(bare)).toBeNull();
  // Expo Go's root URL is the same event wearing a different scheme and a `/--/` separator.
  expect(launchTarget({ path: 'exp://10.0.0.2:8081/--/' })).toBeNull();
  expect(launchTarget({ path: 'tripmate://' })).toBeNull();
});

test('a share is routed to the share screen', () => {
  // The share extension's URL carries its key in the authority, so this must be recognised
  // explicitly — and a share arrives before any account could be involved.
  expect(launchTarget({ path: 'tripmate://dataUrl=abc123' })).toBe('/share');
});

test('a deep link is never gated', () => {
  const link = (path: string) => launchTarget({ path });
  // `GET /api/trips/:id` is readable by anyone holding the id, so a shared trip must open.
  expect(link('tripmate:///trip/abc')).toBeNull();
  expect(link('tripmate://trip/abc')).toBeNull();
  // A trip somebody sent, by either form of its link: the app's own and the https one a universal
  // link delivers. Opening it needs no account.
  expect(link('tripmate:///s/5a1e7f2c')).toBeNull();
  expect(link('https://tripmate.example/s/5a1e7f2c')).toBeNull();
  // The whole planning flow works under the anonymous owner.
  expect(link('exp://10.0.0.2:8081/--/plan/basics')).toBeNull();
});

test('an unrecognised launch URL fails open', () => {
  // A dev build opened from the Expo launcher looks like this. Nothing here is ever a wall.
  expect(launchTarget({ path: 'tripmate://expo-development-client/?url=http://10.0.0.2:8081' })).toBeNull();
  expect(launchTarget({ path: 'tripmate:///?utm=x' })).toBeNull();
});
