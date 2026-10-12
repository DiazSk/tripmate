import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';

/** `user.image` is server-relative (`/api/avatar/…`); the phone needs it absolute. */
export function resolveImage(image: string | null, base: string): string | null {
  if (!image) return null;
  return /^https?:\/\//.test(image) ? image : `${base}${image}`;
}

/** Centre-crop to a square, scale to 256, JPEG at 0.8 — the same photo the web uploads. */
export async function squareJpegBase64(asset: { uri: string; width: number; height: number }): Promise<string> {
  const side = Math.min(asset.width, asset.height);
  const context = ImageManipulator.manipulate(asset.uri);
  if (side > 0) context.crop({ originX: (asset.width - side) / 2, originY: (asset.height - side) / 2, width: side, height: side });
  context.resize({ width: 256, height: 256 });
  const image = await context.renderAsync();
  const saved = await image.saveAsync({ format: SaveFormat.JPEG, compress: 0.8, base64: true });
  if (!saved.base64) throw new Error('encode');
  return saved.base64;
}
