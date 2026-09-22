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
