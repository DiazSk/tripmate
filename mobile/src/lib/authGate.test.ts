import { launchTarget } from './authGate';

const bare = { path: 'tripmate:///', initial: true, signedIn: false, seenWelcome: false };

test('the first bare launch by somebody signed out opens the welcome', () => {
  expect(launchTarget(bare)).toBe('/landing?welcome=1');
  // Expo Go's root URL is the same event wearing a different scheme and a `/--/` separator.
  expect(launchTarget({ ...bare, path: 'exp://10.0.0.2:8081/--/' })).toBe('/landing?welcome=1');
  expect(launchTarget({ ...bare, path: 'tripmate://' })).toBe('/landing?welcome=1');
});

test('once the welcome has been seen, a bare launch signed out opens Home', () => {
  // Shown once, the way a phone app greets you once: from then on the app opens on itself.
  expect(launchTarget({ ...bare, seenWelcome: true })).toBeNull();
  expect(launchTarget({ ...bare, path: 'exp://10.0.0.2:8081/--/', seenWelcome: true })).toBeNull();
});

test('a bare launch by somebody signed in is left alone, welcome seen or not', () => {
  // The no-flash contract. A signed-in traveller must never see the gate, so this is the case
  // worth stating as a test rather than trusting to the branch order above.
  expect(launchTarget({ ...bare, signedIn: true })).toBeNull();
  expect(launchTarget({ ...bare, signedIn: true, seenWelcome: true })).toBeNull();
  expect(launchTarget({ path: 'exp://10.0.0.2:8081/--/', initial: true, signedIn: true, seenWelcome: false })).toBeNull();
});

test('a welcome flag that could not be read is passed as seen, and opens Home', () => {
  // `redirectSystemPath` fails open to `seenWelcome: true` when the keychain read throws, so a
  // broken keychain never shows the welcome on every launch. This is what that value then does.
  expect(launchTarget({ ...bare, seenWelcome: true })).toBeNull();
});

test('a share is routed to the share screen whether or not there is an account', () => {
  // The share extension's URL carries its key in the authority, so this must be recognised
  // explicitly — and a share arrives before any account could be involved.
  for (const signedIn of [false, true]) {
    for (const seenWelcome of [false, true]) {
      expect(launchTarget({ path: 'tripmate://dataUrl=abc123', initial: true, signedIn, seenWelcome })).toBe('/share');
    }
  }
});

test('a deep link is never gated, even before the welcome', () => {
  const link = (path: string) => launchTarget({ path, initial: true, signedIn: false, seenWelcome: false });
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

test('a link arriving mid-session is not a launch', () => {
  // Otherwise a warm link could yank somebody out of what they were doing and into the gate.
  expect(launchTarget({ ...bare, initial: false })).toBeNull();
});

test('an unrecognised launch URL fails open', () => {
  // A dev build opened from the Expo launcher looks like this. Being wrong in this direction shows
  // somebody Home when they might have seen the welcome; being wrong the other way walls them out.
  expect(
    launchTarget({ ...bare, path: 'tripmate://expo-development-client/?url=http://10.0.0.2:8081' }),
  ).toBeNull();
  expect(launchTarget({ ...bare, path: 'tripmate:///?utm=x' })).toBeNull();
});
