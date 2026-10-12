"use client";

/**
 * The device-side half of a profile photo: centre-cropped to a square, scaled to 256px, re-encoded as
 * JPEG at 0.8. The server never decodes an image, and a 12MP phone photo arrives as ~30 KB.
 */
export async function squareJpeg(file: File): Promise<{ mediaType: "image/jpeg"; data: string }> {
  const bitmap = await createImageBitmap(file);
  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 256;
  canvas
    .getContext("2d")!
    .drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, 256, 256);
  bitmap.close();
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("encode"))), "image/jpeg", 0.8)
  );
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let raw = "";
  for (const b of bytes) raw += String.fromCharCode(b);
  return { mediaType: "image/jpeg", data: btoa(raw) };
}
