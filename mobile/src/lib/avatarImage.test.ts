import { resolveImage } from './avatarImage';

describe('resolveImage', () => {
  it('prefixes a server-relative avatar path with the API base', () => {
    expect(resolveImage('/api/avatar/u-1?v=5', 'http://192.168.1.4:3000')).toBe('http://192.168.1.4:3000/api/avatar/u-1?v=5');
  });
  it('leaves an absolute URL alone', () => {
    expect(resolveImage('https://cdn.example/a.jpg', 'http://x:3000')).toBe('https://cdn.example/a.jpg');
  });
  it('is null when there is no photo', () => {
    expect(resolveImage(null, 'http://x:3000')).toBeNull();
    expect(resolveImage('', 'http://x:3000')).toBeNull();
  });
});
