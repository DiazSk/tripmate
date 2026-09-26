import { FRAME_TIMES_S, planShare } from './shareItems';

describe('planShare', () => {
  it('turns an instagram webUrl into a reminder, not an import item', () => {
    const out = planShare({ webUrl: 'https://www.instagram.com/reel/abc/' });
    expect(out.instagramUrls).toEqual(['https://www.instagram.com/reel/abc/']);
    expect(out.linkItems).toEqual([]);
  });

  it('instagram url inside text', () => {
    const out = planShare({ text: 'Best ramen in Kyoto 🍜 https://www.instagram.com/p/xyz/?igsh=1' });
    expect(out.instagramUrls).toEqual(['https://www.instagram.com/p/xyz/?igsh=1']);
    expect(out.linkItems).toEqual([{ kind: 'text', text: 'Best ramen in Kyoto 🍜' }]);
  });

  it('splits other urls from the remaining text', () => {
    const out = planShare({ text: 'Maya says Nishiki Market\nhttps://maps.app.goo.gl/abc' });
    expect(out.linkItems).toEqual([
      { kind: 'url', url: 'https://maps.app.goo.gl/abc' },
      { kind: 'text', text: 'Maya says Nishiki Market' },
    ]);
  });

  it('frame times stop before a known duration', () => {
    const out = planShare({ files: [{ path: 'v.mov', mimeType: 'video/quicktime', duration: 7000 }] });
    expect(out.videoFrames).toEqual([{ path: 'v.mov', times: [1, 3, 6] }]);
  });

  it('unknown duration', () => {
    const out = planShare({ files: [{ path: 'v.mp4', mimeType: 'video/mp4' }] });
    expect(out.videoFrames[0].times).toEqual(FRAME_TIMES_S);
  });

  it('caps images plus frames at 20, in order, and says so', () => {
    const images = Array.from({ length: 18 }, (_, i) => ({ path: `i${i}.jpg`, mimeType: 'image/jpeg' }));
    const out = planShare({ files: [...images, { path: 'v.mp4', mimeType: 'video/mp4' }] });
    expect(out.imagePaths).toHaveLength(18);
    expect(out.videoFrames).toEqual([{ path: 'v.mp4', times: [1, 3] }]);
    expect(out.truncated).toBe(true);
  });
});
