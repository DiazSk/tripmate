// expo-share-intent opens the app with `tripmate://dataUrl=<key>`. Without this, expo-router
// treats that as a path and shows "unmatched route" instead of the Share screen.
export function redirectSystemPath({ path }: { path: string; initial: boolean }) {
  return path.includes('dataUrl=') ? '/share' : path;
}
