import { launchTarget } from './authGate';

const bare = { path: 'tripmate:///', initial: true, signedIn: false };

test('a bare launch by somebody signed out opens the sign-in screen', () => {
  expect(launchTarget(bare)).toBe('/signin');
  // Expo Go's root URL is the same event wearing a different scheme and a `/--/` separator.
  expect(launchTarget({ ...bare, path: 'exp://10.0.0.2:8081/--/' })).toBe('/signin');
  expect(launchTarget({ ...bare, path: 'tripmate://' })).toBe('/signin');
});

test('a bare launch by somebody signed in is left alone', () => {
  // The no-flash contract. A signed-in traveller must never see the gate, so this is the case
  // worth stating as a test rather than trusting to the branch order above.
  expect(launchTarget({ ...bare, signedIn: true })).toBeNull();
  expect(launchTarget({ path: 'exp://10.0.0.2:8081/--/', initial: true, signedIn: true })).toBeNull();
});

test('a share is routed to the share screen whether or not there is an account', () => {
  // The share extension's URL carries its key in the authority, so this must be recognised
  // explicitly — and a share arrives before any account could be involved.
  expect(launchTarget({ path: 'tripmate://dataUrl=abc123', initial: true, signedIn: false })).toBe('/share');
  expect(launchTarget({ path: 'tripmate://dataUrl=abc123', initial: true, signedIn: true })).toBe('/share');
});

test('a deep link is never gated', () => {
  // `GET /api/trips/:id` is readable by anyone holding the id, so a shared trip must open.
  expect(launchTarget({ path: 'tripmate:///trip/abc', initial: true, signedIn: false })).toBeNull();
  expect(launchTarget({ path: 'tripmate://trip/abc', initial: true, signedIn: false })).toBeNull();
  // The whole planning flow works under the anonymous owner.
  expect(launchTarget({ path: 'exp://10.0.0.2:8081/--/plan/basics', initial: true, signedIn: false })).toBeNull();
});

test('a link arriving mid-session is not a launch', () => {
  // Otherwise a warm link could yank somebody out of what they were doing and into the gate.
  expect(launchTarget({ ...bare, initial: false })).toBeNull();
});

test('an unrecognised launch URL fails open', () => {
  // A dev build opened from the Expo launcher looks like this. Being wrong in this direction shows
  // somebody Home when they might have seen the gate; being wrong the other way walls them out.
  expect(
    launchTarget({ path: 'tripmate://expo-development-client/?url=http://10.0.0.2:8081', initial: true, signedIn: false }),
  ).toBeNull();
  expect(launchTarget({ ...bare, path: 'tripmate:///?utm=x' })).toBeNull();
});
