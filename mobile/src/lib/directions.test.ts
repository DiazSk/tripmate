import { Platform } from 'react-native';

import { directionsUrl } from './directions';

const stop = { lat: 34.9949, lng: 135.785 };

test('each platform gets the maps app it actually has', () => {
  Platform.OS = 'ios';
  expect(directionsUrl(stop)).toBe('https://maps.apple.com/?daddr=34.9949,135.785');
  Platform.OS = 'android';
  expect(directionsUrl(stop)).toBe(
    'https://www.google.com/maps/dir/?api=1&destination=34.9949,135.785'
  );
});

// A negative longitude losing its sign sends somebody to the wrong hemisphere, and the URL looks
// perfectly well-formed either way.
test('western and southern coordinates keep their signs', () => {
  Platform.OS = 'ios';
  expect(directionsUrl({ lat: -33.8568, lng: -151.2153 })).toContain('daddr=-33.8568,-151.2153');
});
