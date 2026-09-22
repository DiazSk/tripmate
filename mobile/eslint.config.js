// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

// The React Native app's own rules. Without this file ESLint walks up and finds the web app's
// flat config at the repo root — so `expo lint` was checking this project against Next.js's
// rules, which flag `jsx-a11y/alt-text` on an `expo-image` and `no-require-imports` on Metro's
// own asset idiom. The root config now ignores `mobile/**` for the same reason.
module.exports = defineConfig([
  expoConfig,
  {
    ignores: ['dist/*', '.expo/*'],
  },
]);
