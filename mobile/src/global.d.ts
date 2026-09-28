declare module "*.css" {
  const content: Record<string, string>;
  export default content;
}

declare module "*.module.css" {
  const content: Record<string, string>;
  export default content;
}

// Metro resolves a font asset to an opaque module reference, which is what `useFonts` takes.
declare module "*.ttf" {
  const asset: number;
  export default asset;
}

// Same shape as the fonts above: Metro hands back an opaque module reference, which is what
// `expo-image`'s `source` takes for a bundled asset. Declared here rather than relying on
// `expo/types`, which covers stylesheets only and declares no image extension at all.
declare module "*.webp" {
  const asset: number;
  export default asset;
}
