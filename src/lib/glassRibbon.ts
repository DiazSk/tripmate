/**
 * The route ribbon's material: a glass shader with a specular highlight, replacing Cesium's
 * stock `PolylineOutlineMaterialProperty`.
 *
 * **Why a custom shader rather than more entities.** The ribbon needs three things at once — a
 * dark casing down both edges, a body that shades like a rounded surface rather than a flat
 * strip, and a narrow specular streak running along it. Only the first is available off the
 * shelf. The other two are functions of *position across the line's width*, which is a value
 * that exists only inside the fragment shader: `materialInput.st.t` runs 0 at one edge to 1 at
 * the other. Nothing in the entity API can address it, so stacking more polylines cannot express
 * this at any cost — a stack of lines is a stack of flat strips.
 *
 * Cesium's material system is extensible for exactly this. A "fabric" is a GLSL fragment plus a
 * uniform declaration, registered under a type name; a `MaterialProperty` is the entity-layer
 * handle that supplies those uniforms per frame. Both are implemented here.
 *
 * The casing half is deliberately a verbatim copy of Cesium's own PolylineOutline material —
 * same `halfInteriorWidth` split, same `czm_antialias` call on the same distance term — so the
 * ribbon's edge behaves identically to how it did before the glass pass existed, and
 * `ARC_CASING_WIDTH`'s documented "total across both edges" semantics still hold. Only the
 * interior is new.
 */

type CesiumModule = typeof import("cesium");

/** The registered fabric type name. Namespaced because `Material._materialCache` is a single
 *  global map shared with every built-in material. */
const MATERIAL_TYPE = "TripMateGlassRibbon";

/**
 * Where the specular streak sits across the ribbon's interior, 0 to 1.
 *
 * Off-centre on purpose. A highlight down the middle reads as a second, brighter line drawn on
 * top of the first; a highlight at a third reads as light catching the shoulder of something
 * round. This is the single number that decides whether the ribbon looks like glass or like a
 * stripe.
 *
 * "Along the top curve" is as literal as it can honestly get here. `st.t` is the polyline's own
 * across-width axis, which is stable relative to the ribbon but not oriented to world up — a
 * true up-facing highlight would need the world up vector in the fragment shader, and a polyline
 * has no meaningful surface normal to carry it. What this buys instead is a highlight that stays
 * on the same side of the ribbon as it curves, which is what makes it read as one continuous
 * lit surface rather than a glint that wanders across the line.
 */
const SPECULAR_CENTRE = 0.32;
/** Gaussian half-width of the streak, in the same interior coordinates. Narrow: this is a
 *  specular reflection, and a wide one is just a lighter ribbon. */
const SPECULAR_WIDTH = 0.16;
/** How far the body darkens away from the lit shoulder. Not to black — the ribbon is emissive
 *  neon, not a lit solid, so the shaded side stays clearly its own colour. */
const BODY_FLOOR = 0.72;
/** Centre of the body's curvature falloff. Matched to the specular centre so the two describe
 *  the same imagined cylinder rather than two different ones. */
const CURVE_CENTRE = 0.34;
/** Exponent on the curvature term. Above 1 keeps the falloff soft near the shoulder and steeper
 *  at the far edge, which is how a cylinder actually shades. */
const CURVE_POWER = 1.4;
/** A faint bounce along the unlit edge — the light the environment throws back. Small; this is
 *  the difference between "flat" and "sitting in a scene", not a second highlight. */
const RIM_WIDTH = 0.22;
const RIM_INTENSITY = 0.18;

const f = (n: number) => n.toFixed(4);

/**
 * The fragment shader.
 *
 * Cesium supplies `materialInput.st` (with `.t` across the width) and, for polylines only, the
 * `v_width` varying in framebuffer pixels. Everything below is in *interior* coordinates —
 * remapped so 0 and 1 are the inner edges of the casing rather than the outer edges of the line.
 * That remap is what keeps the shading proportional as the ribbon tapers: `ARC_WIDTH_START` to
 * `ARC_WIDTH_END` nearly halves the line's width along its length while the casing stays a fixed
 * pixel count, so an interior fraction is the only coordinate that means the same thing at both
 * ends. Anchored to `st.t` directly, the highlight would drift toward one edge as the ribbon
 * narrowed and fall into the casing on the last segment.
 */
const SOURCE = `
uniform vec4 color;
uniform vec4 outlineColor;
uniform float outlineWidth;
uniform vec4 specularColor;
uniform float specularIntensity;

in float v_width;

czm_material czm_getMaterial(czm_materialInput materialInput)
{
    czm_material material = czm_getDefaultMaterial(materialInput);

    vec2 st = materialInput.st;

    // --- Casing. Verbatim from Cesium's PolylineOutline material. ---
    float halfInteriorWidth = 0.5 * (v_width - outlineWidth) / v_width;
    float b = step(0.5 - halfInteriorWidth, st.t);
    b *= 1.0 - step(0.5 + halfInteriorWidth, st.t);
    float d1 = abs(st.t - (0.5 - halfInteriorWidth));
    float d2 = abs(st.t - (0.5 + halfInteriorWidth));
    float dist = min(d1, d2);

    // --- Glass interior. ---
    // Position across the interior only, so the shading holds its proportions under taper.
    float span = max(2.0 * halfInteriorWidth, 1e-4);
    float u = clamp((st.t - (0.5 - halfInteriorWidth)) / span, 0.0, 1.0);

    // Body curvature: brightest at the lit shoulder, falling off toward both edges, so a flat
    // strip of pixels reads as the top of a round surface.
    float reach = max(${f(CURVE_CENTRE)}, 1.0 - ${f(CURVE_CENTRE)});
    float curve = pow(max(1.0 - abs(u - ${f(CURVE_CENTRE)}) / reach, 0.0), ${f(CURVE_POWER)});
    vec3 body = color.rgb * (${f(BODY_FLOOR)} + (1.0 - ${f(BODY_FLOOR)}) * curve);

    // The specular streak: a tight gaussian, not a step, or the edge of the highlight becomes a
    // fourth line down the ribbon.
    float g = (u - ${f(SPECULAR_CENTRE)}) / ${f(SPECULAR_WIDTH)};
    float spec = exp(-g * g);

    // Environment bounce along the far edge.
    float rim = smoothstep(1.0 - ${f(RIM_WIDTH)}, 1.0, u) * ${f(RIM_INTENSITY)};

    vec3 lit = body + specularColor.rgb * (spec * specularIntensity + rim);
    // Alpha is the caller's, untouched by the shading — the day's dim/active state and the
    // shimmer both ride on it, and lighting the ribbon must not quietly override either.
    vec4 interior = vec4(lit, color.a);

    vec4 currentColor = mix(outlineColor, interior, b);
    vec4 outColor = czm_antialias(outlineColor, interior, currentColor, dist);
    outColor = czm_gammaCorrect(outColor);

    material.diffuse = outColor.rgb;
    material.alpha = outColor.a;

    return material;
}
`;

/**
 * Register the fabric, once per page.
 *
 * `Material._materialCache` is private API — it is not in Cesium's `.d.ts`, hence the cast —
 * but it is the only registration point there is, and `Material.fromType` reads straight out of
 * it. The guard matters: `addMaterial` overwrites by key, and a second registration would
 * discard the fabric a live material is already compiled against.
 */
export function registerGlassRibbonMaterial(Cesium: CesiumModule): void {
  const cache = (
    Cesium.Material as unknown as {
      _materialCache: {
        getMaterial: (type: string) => unknown;
        addMaterial: (type: string, definition: unknown) => void;
      };
    }
  )._materialCache;
  if (cache.getMaterial(MATERIAL_TYPE)) return;
  cache.addMaterial(MATERIAL_TYPE, {
    fabric: {
      type: MATERIAL_TYPE,
      uniforms: {
        color: new Cesium.Color(1, 1, 1, 1),
        outlineColor: new Cesium.Color(0, 0, 0, 1),
        outlineWidth: 1,
        specularColor: new Cesium.Color(1, 1, 1, 1),
        specularIntensity: 0.5,
      },
      source: SOURCE,
    },
    // Declared rather than inferred. Cesium infers translucency by inspecting the fabric's
    // uniforms for an alpha below 1, which is wrong here: the alpha that matters arrives at
    // runtime from a CallbackProperty (the shimmer, and the day's dim state), so at
    // registration time every uniform is opaque and the ribbon would be batched into the
    // opaque pass and then never fade.
    translucent: true,
  });
}

/** What the material needs each frame. Colours may be plain `Color`s or any Cesium `Property`,
 *  which is what lets the shimmer and the hover tint arrive as `CallbackProperty`s. */
export interface GlassRibbonOptions {
  color: import("cesium").Color | import("cesium").Property;
  outlineColor: import("cesium").Color | import("cesium").Property;
  outlineWidth: number;
  specularColor: import("cesium").Color | import("cesium").Property;
  specularIntensity: number;
}

/**
 * A `MaterialProperty` for the fabric above.
 *
 * Duck-typed rather than a subclass of `Cesium.MaterialProperty`: that export is an interface
 * with a constructor that throws, and everything downstream of it — `StaticGeometryPerMaterialBatch`,
 * `Property.isConstant`, `MaterialProperty.getValue` — reaches these members by name and never
 * by `instanceof`. A factory also keeps this reachable from a module that only ever sees Cesium
 * through `await import("cesium")`, which is the convention `mapRoute.ts` documents.
 *
 * `color` is a mutable field on purpose: `tintPolyline` in `mapRoute.ts` assigns
 * `entity.polyline.material.color` to repaint a ribbon on hover, exactly as it does for the stock
 * glow and outline materials. Keeping that name and that behaviour is what lets one tint closure
 * still cover every material on the route.
 *
 * Non-constant, because the colours are. That is not a new cost: it matches what
 * `PolylineOutlineMaterialProperty` already reported here, so the ribbon stays in the same
 * per-material static batch and its geometry is never rebuilt — only these uniforms are re-read.
 */
export function createGlassRibbonMaterial(Cesium: CesiumModule, options: GlassRibbonOptions) {
  const definitionChanged = new Cesium.Event();
  const value = (
    property: import("cesium").Color | import("cesium").Property | undefined,
    time: import("cesium").JulianDate,
    result?: import("cesium").Color
  ) =>
    property instanceof Cesium.Color
      ? Cesium.Color.clone(property, result)
      : (property as import("cesium").Property | undefined)?.getValue(time, result);

  return {
    color: options.color,
    outlineColor: options.outlineColor,
    specularColor: options.specularColor,
    outlineWidth: options.outlineWidth,
    specularIntensity: options.specularIntensity,
    get isConstant() {
      return false;
    },
    get definitionChanged() {
      return definitionChanged;
    },
    getType() {
      return MATERIAL_TYPE;
    },
    getValue(time: import("cesium").JulianDate, result?: Record<string, unknown>) {
      const out = result ?? ({} as Record<string, unknown>);
      out.color = value(this.color, time, out.color as import("cesium").Color | undefined);
      out.outlineColor = value(
        this.outlineColor,
        time,
        out.outlineColor as import("cesium").Color | undefined
      );
      out.specularColor = value(
        this.specularColor,
        time,
        out.specularColor as import("cesium").Color | undefined
      );
      out.outlineWidth = this.outlineWidth;
      out.specularIntensity = this.specularIntensity;
      return out;
    },
    equals(other?: unknown) {
      return this === other;
    },
  };
}
