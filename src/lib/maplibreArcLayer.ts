import type { CustomLayerInterface, Map as MapLibreMap } from "maplibre-gl";

/**
 * The day routes as real translucent tubes, drawn straight into MapLibre's GL context.
 *
 * **Why this is not a style layer.** MapLibre has no elevated-line primitive — no `line-z-offset`,
 * and every `line-*` layer is draped on the terrain — so the first version of the arcs was built
 * out of `fill-extrusion` prisms, one thin slab per segment. A prism is axis-aligned and cannot be
 * tilted, so a segment spanning a steep stretch of the curve becomes a *tall box*, and the curve is
 * at its steepest exactly where it leaves each stop. Sizing the segments off the height they climb
 * made the steps smaller but never made them stop being steps: the arcs read as a staircase of
 * cubes, opaque where Cesium's ribbon is glass.
 *
 * A custom layer has no such constraint. The tube here is real swept geometry — a ring of vertices
 * carried along the centreline — shaded and blended the way `glassRibbon.ts` shades Cesium's:
 * cylindrical falloff across the body, a specular streak along the top, a rim that brightens at the
 * silhouette, and alpha that survives everything. The two engines finally draw the same object.
 *
 * Everything is in **mercator world units**, which is what `modelViewProjectionMatrix` expects.
 * Mercator is conformal, so a metre is locally the same length on all three axes at a given
 * latitude — which is what makes it safe to build a round tube and compute normals in that space
 * rather than in metres.
 */

/** Vertices around the tube. Eight is round enough at every framing this app uses, and the whole
 *  trip is one buffer — a smoother tube would cost geometry nobody can see. */
const TUBE_SIDES = 8;

/** Metres of world, per mercator unit, at a given latitude. */
const EARTH_CIRCUMFERENCE_M = 40_075_016.686;

function metresToMercator(lat: number): number {
  return 1 / (EARTH_CIRCUMFERENCE_M * Math.cos((lat * Math.PI) / 180));
}

/** One arc to draw: a centreline in world coordinates plus how it should look. */
export interface ArcTube {
  /** Sampled points along the curve, in order. `heightM` is metres above sea level. */
  points: { lat: number; lng: number; heightM: number }[];
  /** Tube radius in metres. */
  radiusM: number;
  /** Linear RGB in 0..1. */
  color: [number, number, number];
  /** How present this day is — `DAY_STATE_ALPHA`, or 1 for the stop being pointed at. */
  alpha: number;
}

const VERTEX_SRC = `#version 300 es
uniform mat4 u_matrix;
in vec3 a_pos;
in vec3 a_normal;
in vec4 a_color;
out vec3 v_normal;
out vec4 v_color;
void main() {
  v_normal = a_normal;
  v_color = a_color;
  gl_Position = u_matrix * vec4(a_pos, 1.0);
}`;

/**
 * The glass. Three terms, and each one is doing a job `glassRibbon.ts` does on the Cesium side.
 *
 * - **Body.** A soft diffuse falloff around the tube, so it reads as round rather than as a flat
 *   strip that happens to be curved.
 * - **Specular streak.** A narrow highlight where the surface faces up, which is the single cue
 *   that most makes a tube look like polished glass rather than painted plastic.
 * - **Rim.** The silhouette brightens and *thickens* in alpha. This is the honest approximation
 *   here: a true fresnel needs the view vector, and a custom layer is not handed the camera
 *   position — only the combined matrix. Using how far the normal points away from vertical
 *   stands in for it, which is exact at nadir and slightly generous at a shallow pitch. It reads
 *   correctly at every framing this app actually uses, which is 0 to 65 degrees of tilt.
 *
 * Output is premultiplied, because MapLibre sets \`blendFunc(ONE, ONE_MINUS_SRC_ALPHA)\` before
 * calling a custom layer and documents that it expects premultiplied colours.
 */
const FRAGMENT_SRC = `#version 300 es
precision highp float;
in vec3 v_normal;
in vec4 v_color;
out vec4 fragColor;
void main() {
  vec3 n = normalize(v_normal);
  float up = clamp(n.z, 0.0, 1.0);
  float body = 0.62 + 0.38 * up;
  float streak = pow(up, 10.0) * 0.55;
  float rim = pow(1.0 - abs(n.z), 2.5);
  vec3 rgb = v_color.rgb * body + vec3(streak) + v_color.rgb * rim * 0.35;
  float alpha = clamp(v_color.a * (0.5 + 0.5 * rim) + streak * 0.3, 0.0, 1.0);
  fragColor = vec4(rgb * alpha, alpha);
}`;

function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type)!;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    // Thrown rather than swallowed: a shader that will not compile draws nothing, silently, and
    // that is exactly the class of failure this file exists to stop repeating.
    throw new Error(`arc tube shader: ${gl.getShaderInfoLog(shader)}`);
  }
  return shader;
}

/**
 * Build the layer. `setArcs` may be called before or after the layer is added — the mesh is kept on
 * the CPU and uploaded whenever both it and a GL context exist.
 */
export function createArcTubeLayer(id: string) {
  let gl: WebGL2RenderingContext | null = null;
  let program: WebGLProgram | null = null;
  let matrixLocation: WebGLUniformLocation | null = null;
  let vao: WebGLVertexArrayObject | null = null;
  let vertexBuffer: WebGLBuffer | null = null;
  let indexBuffer: WebGLBuffer | null = null;
  let indexCount = 0;
  /** Interleaved: 3 position, 3 normal, 4 colour. */
  let vertices: Float32Array = new Float32Array(0);
  let indices: Uint32Array = new Uint32Array(0);
  let dirty = false;
  let mapRef: MapLibreMap | null = null;

  function upload() {
    if (!gl || !vertexBuffer || !indexBuffer || !dirty) return;
    dirty = false;
    indexCount = indices.length;
    gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.DYNAMIC_DRAW);
  }

  const layer: CustomLayerInterface & { setArcs: (arcs: ArcTube[]) => void } = {
    id,
    type: "custom",
    // Shares the depth buffer with the rest of the scene, so a tube behind a hill is occluded by
    // it rather than painted over it.
    renderingMode: "3d",

    onAdd(map, context) {
      gl = context;
      mapRef = map;
      const vertexShader = compile(gl, gl.VERTEX_SHADER, VERTEX_SRC);
      const fragmentShader = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT_SRC);
      program = gl.createProgram()!;
      gl.attachShader(program, vertexShader);
      gl.attachShader(program, fragmentShader);
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        throw new Error(`arc tube program: ${gl.getProgramInfoLog(program)}`);
      }
      gl.deleteShader(vertexShader);
      gl.deleteShader(fragmentShader);
      matrixLocation = gl.getUniformLocation(program, "u_matrix");

      vertexBuffer = gl.createBuffer();
      indexBuffer = gl.createBuffer();
      vao = gl.createVertexArray();
      gl.bindVertexArray(vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
      const stride = 10 * 4;
      const pos = gl.getAttribLocation(program, "a_pos");
      const normal = gl.getAttribLocation(program, "a_normal");
      const color = gl.getAttribLocation(program, "a_color");
      gl.enableVertexAttribArray(pos);
      gl.vertexAttribPointer(pos, 3, gl.FLOAT, false, stride, 0);
      gl.enableVertexAttribArray(normal);
      gl.vertexAttribPointer(normal, 3, gl.FLOAT, false, stride, 3 * 4);
      gl.enableVertexAttribArray(color);
      gl.vertexAttribPointer(color, 4, gl.FLOAT, false, stride, 6 * 4);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
      gl.bindVertexArray(null);
      dirty = true;
    },

    onRemove() {
      if (!gl) return;
      if (program) gl.deleteProgram(program);
      if (vertexBuffer) gl.deleteBuffer(vertexBuffer);
      if (indexBuffer) gl.deleteBuffer(indexBuffer);
      if (vao) gl.deleteVertexArray(vao);
      gl = null;
      program = null;
      vao = null;
      vertexBuffer = null;
      indexBuffer = null;
      mapRef = null;
    },

    render(context, options) {
      if (!program || !vao) return;
      gl = context;
      upload();
      if (indexCount === 0) return;
      gl.useProgram(program);
      gl.uniformMatrix4fv(
        matrixLocation,
        false,
        options.defaultProjectionData.mainMatrix as Float32Array
      );
      gl.bindVertexArray(vao);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.enable(gl.DEPTH_TEST);
      // Tested against the scene but not written to. Translucent geometry that writes depth
      // occludes *itself*: the far wall of a tube would be discarded before the near wall blended
      // over it, and every place the arcs cross would flicker depending on draw order.
      gl.depthMask(false);
      gl.drawElements(gl.TRIANGLES, indexCount, gl.UNSIGNED_INT, 0);
      gl.depthMask(true);
      gl.bindVertexArray(null);
    },

    /**
     * Replace the whole mesh.
     *
     * One buffer for the entire trip rather than one per arc: a day is a handful of hops, the
     * whole thing is a few thousand triangles, and a single `drawElements` is what keeps this
     * layer's cost invisible next to the basemap it sits on.
     */
    setArcs(arcs: ArcTube[]) {
      let vertexCount = 0;
      let triangleCount = 0;
      for (const arc of arcs) {
        if (arc.points.length < 2) continue;
        vertexCount += arc.points.length * TUBE_SIDES;
        triangleCount += (arc.points.length - 1) * TUBE_SIDES * 2;
      }
      vertices = new Float32Array(vertexCount * 10);
      indices = new Uint32Array(triangleCount * 3);

      let v = 0;
      let i = 0;
      let base = 0;
      for (const arc of arcs) {
        const n = arc.points.length;
        if (n < 2) continue;
        // One scale for the whole arc. An arc spans a few kilometres at most, over which the
        // mercator scale factor changes in the fifth decimal — far below a pixel.
        const midLat = arc.points[Math.floor(n / 2)].lat;
        const scale = metresToMercator(midLat);
        const radius = arc.radiusM * scale;

        // Centreline in mercator units. `y` grows southward, which is why latitude is negated
        // through the standard mercator formula rather than used directly.
        const centre = arc.points.map((p) => {
          const x = (180 + p.lng) / 360;
          const sinLat = Math.sin((p.lat * Math.PI) / 180);
          const y = 0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI);
          return [x, y, p.heightM * scale] as [number, number, number];
        });

        for (let k = 0; k < n; k++) {
          // Central difference for the tangent, one-sided at the ends. A forward difference
          // throughout would twist the ring by half a segment at every join.
          const a = centre[Math.max(0, k - 1)];
          const b = centre[Math.min(n - 1, k + 1)];
          let tx = b[0] - a[0];
          let ty = b[1] - a[1];
          let tz = b[2] - a[2];
          const tLen = Math.hypot(tx, ty, tz) || 1;
          tx /= tLen;
          ty /= tLen;
          tz /= tLen;
          // A frame around the tangent. `side` is horizontal by construction (the cross product of
          // the tangent with world up), so the ring never rolls along the arc and the specular
          // streak stays on top where the shader expects it.
          let sx = ty * 1 - tz * 0;
          let sy = tz * 0 - tx * 1;
          let sz = 0;
          const sLen = Math.hypot(sx, sy, sz);
          if (sLen < 1e-9) {
            // Tangent is vertical — no horizontal cross product exists. Any perpendicular will do.
            sx = 1;
            sy = 0;
            sz = 0;
          } else {
            sx /= sLen;
            sy /= sLen;
            sz /= sLen;
          }
          // up = side × tangent, completing a right-handed frame.
          const ux = sy * tz - sz * ty;
          const uy = sz * tx - sx * tz;
          const uz = sx * ty - sy * tx;

          for (let j = 0; j < TUBE_SIDES; j++) {
            const theta = (j / TUBE_SIDES) * Math.PI * 2;
            const cos = Math.cos(theta);
            const sin = Math.sin(theta);
            const nx = sx * cos + ux * sin;
            const ny = sy * cos + uy * sin;
            const nz = sz * cos + uz * sin;
            vertices[v++] = centre[k][0] + nx * radius;
            vertices[v++] = centre[k][1] + ny * radius;
            vertices[v++] = centre[k][2] + nz * radius;
            vertices[v++] = nx;
            vertices[v++] = ny;
            vertices[v++] = nz;
            vertices[v++] = arc.color[0];
            vertices[v++] = arc.color[1];
            vertices[v++] = arc.color[2];
            vertices[v++] = arc.alpha;
          }
        }

        for (let k = 0; k < n - 1; k++) {
          for (let j = 0; j < TUBE_SIDES; j++) {
            const next = (j + 1) % TUBE_SIDES;
            const a = base + k * TUBE_SIDES + j;
            const b = base + k * TUBE_SIDES + next;
            const c = base + (k + 1) * TUBE_SIDES + j;
            const d = base + (k + 1) * TUBE_SIDES + next;
            indices[i++] = a;
            indices[i++] = c;
            indices[i++] = b;
            indices[i++] = b;
            indices[i++] = c;
            indices[i++] = d;
          }
        }
        base += n * TUBE_SIDES;
      }

      dirty = true;
      mapRef?.triggerRepaint();
    },
  };

  return layer;
}
