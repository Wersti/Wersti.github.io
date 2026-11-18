/**
 * Strange attractor, drawn as a handful of fading trajectories.
 *
 * Each trail is a ring of points integrated through the system: the head
 * advances every frame and the tail fades out, so the shape is drawn like a
 * pen line rather than filled as a cloud.
 *
 * OGL (~10 KB) instead of Three.js: this needs one shader and a few draw calls.
 * Loaded only when WebGL exists, the hero is on screen, the viewport is
 * desktop-sized, and reduced motion is off; otherwise the CSS glow stays.
 */

import { Renderer, Camera, Transform, Program, Geometry, Mesh, Vec3 } from 'ogl';

/** Independent trajectories. Few enough that each one stays legible. */
const TRAILS = 10;
/** Vertices per trail. */
const TRAIL_LEN = 1200;
/** How fast heads advance, in vertices per second. */
const VERTS_PER_SECOND = 75;

const CAMERA_Z = 72;
const DEPTH_SPAN = 60;

type Vec = Float64Array;

interface System {
  /** Advance state p = [x, y, z] by `steps` explicit-Euler steps, in place. */
  step(p: Vec, steps: number): void;
  start: [number, number, number];
  /** Steps discarded so sampling starts on the attractor. */
  burnIn: number;
  /** Euler steps between consecutive trail vertices. */
  substeps: number;
  /**
   * Rotationally symmetric about z: framed by its radius and allowed to spin
   * continuously. Otherwise framed by its x extent and only swayed.
   */
  spins: boolean;
}

/** Lorenz (σ=10, ρ=28, β=8/3): the butterfly. */
const LORENZ: System = {
  start: [0.1, 0, 20],
  burnIn: 5000,
  substeps: 3,
  spins: false,
  step(p, steps) {
    const H = 0.002;
    let x = p[0];
    let y = p[1];
    let z = p[2];
    for (let s = 0; s < steps; s++) {
      const dx = 10 * (y - x);
      const dy = x * (28 - z) - y;
      const dz = x * y - (8 / 3) * z;
      x += dx * H;
      y += dy * H;
      z += dz * H;
    }
    p[0] = x;
    p[1] = y;
    p[2] = z;
  },
};

/** Aizawa (a=.95, b=.7, c=.6, d=3.5, e=.25, f=.1): a sphere pierced by a tube. */
const AIZAWA: System = {
  start: [0.1, 0, 0],
  burnIn: 3000,
  substeps: 2,
  spins: true,
  step(p, steps) {
    const H = 0.008;
    let x = p[0];
    let y = p[1];
    let z = p[2];
    for (let s = 0; s < steps; s++) {
      const r2 = x * x + y * y;
      const dx = (z - 0.7) * x - 3.5 * y;
      const dy = 3.5 * x + (z - 0.7) * y;
      const dz = 0.6 + 0.95 * z - (z * z * z) / 3 - r2 * (1 + 0.25 * z) + 0.1 * z * x * x * x;
      x += dx * H;
      y += dy * H;
      z += dz * H;
    }
    p[0] = x;
    p[1] = y;
    p[2] = z;
  },
};

const SYSTEM = AIZAWA;

const vertex = /* glsl */ `
  // Screen-space ribbon: every trail point is emitted twice (side = ±1) and
  // pushed apart along the on-screen normal. WebGL caps gl.LINES at 1px, so
  // this is the only way to get a stroke with real, resolution-correct width.
  attribute vec3 position;
  attribute vec3 prev;
  attribute vec3 next;
  attribute float side;
  attribute float aAge;

  uniform mat4 modelViewMatrix;
  uniform mat4 projectionMatrix;
  uniform float uDepthFar;
  uniform float uDepthRange;
  uniform vec3 uOrigin;
  uniform vec2 uResolution;
  uniform float uThickness;

  varying float vDepth;
  varying float vAge;

  vec2 toScreen(vec4 clip, vec2 aspect) {
    return clip.xy / clip.w * aspect;
  }

  void main() {
    vec4 mv = modelViewMatrix * vec4(position - uOrigin, 1.0);
    vDepth = clamp((mv.z + uDepthFar) / uDepthRange, 0.0, 1.0);
    vAge = aAge;

    vec4 clip = projectionMatrix * mv;
    vec4 clipPrev = projectionMatrix * modelViewMatrix * vec4(prev - uOrigin, 1.0);
    vec4 clipNext = projectionMatrix * modelViewMatrix * vec4(next - uOrigin, 1.0);

    vec2 aspect = vec2(uResolution.x / uResolution.y, 1.0);
    vec2 delta = toScreen(clipNext, aspect) - toScreen(clipPrev, aspect);
    vec2 dir = length(delta) > 1e-6 ? normalize(delta) : vec2(1.0, 0.0);
    vec2 normal = vec2(-dir.y, dir.x) / aspect;

    // Pen-like taper: full width at the head, thinner toward the tail.
    float width = uThickness * (0.35 + 0.65 * aAge);
    clip.xy += normal * side * (width / uResolution.y) * clip.w;
    gl_Position = clip;
  }
`;

const fragment = /* glsl */ `
  precision highp float;

  uniform vec3 uColorCore;
  uniform vec3 uColorEdge;

  varying float vDepth;
  varying float vAge;

  void main() {
    // vAge runs 0 (oldest) to 1 (head): the tail fades out, the head glows.
    float fade = pow(vAge, 1.6);
    vec3 color = mix(uColorEdge, uColorCore, 0.35 + 0.65 * vDepth);
    gl_FragColor = vec4(color, fade * (0.55 + 0.45 * vDepth));
  }
`;

/** Stroke width at the head, in CSS pixels. */
const THICKNESS = 1.8;

interface Trail {
  head: Float64Array;
  /** Raw trail points, oldest first: TRAIL_LEN × xyz. */
  points: Float32Array;
  /** Ribbon attributes: each point twice, with its neighbours. */
  position: Float32Array;
  prev: Float32Array;
  next: Float32Array;
  geometry: Geometry;
}

/** Expand trail points into the doubled ribbon vertex arrays. */
function buildRibbon(t: Trail) {
  const { points, position, prev, next } = t;
  const last = TRAIL_LEN - 1;
  for (let i = 0; i < TRAIL_LEN; i++) {
    const p = i * 3;
    const a = Math.max(i - 1, 0) * 3;
    const b = Math.min(i + 1, last) * 3;
    for (let k = 0; k < 2; k++) {
      const v = (i * 2 + k) * 3;
      for (let c = 0; c < 3; c++) {
        position[v + c] = points[p + c];
        prev[v + c] = points[a + c];
        next[v + c] = points[b + c];
      }
    }
  }
}

export function initAttractor(canvas: HTMLCanvasElement): () => void {
  const dpr = Math.min(window.devicePixelRatio, 2);

  const renderer = new Renderer({ canvas, alpha: true, antialias: true, dpr });
  const gl = renderer.gl;
  gl.clearColor(0, 0, 0, 0);

  const camera = new Camera(gl, { fov: 45, near: 0.1, far: 400 });
  camera.position.set(0, 0, CAMERA_Z);
  camera.lookAt(new Vec3(0, 0, 0));

  const scene = new Transform();
  const shape = new Transform();
  shape.setParent(scene);

  // Static per-vertex data shared by every ribbon. Age runs 0 at the tail to
  // 1 at the head; side alternates ±1; two triangles join each pair of points.
  const ages = new Float32Array(TRAIL_LEN * 2);
  const sides = new Float32Array(TRAIL_LEN * 2);
  for (let i = 0; i < TRAIL_LEN; i++) {
    ages[i * 2] = ages[i * 2 + 1] = i / (TRAIL_LEN - 1);
    sides[i * 2] = -1;
    sides[i * 2 + 1] = 1;
  }
  const index = new Uint16Array((TRAIL_LEN - 1) * 6);
  for (let i = 0; i < TRAIL_LEN - 1; i++) {
    const v = i * 2;
    index.set([v, v + 1, v + 2, v + 1, v + 3, v + 2], i * 6);
  }

  // Seed every trail from consecutive stretches of one long orbit, after
  // discarding the transient, so they start on the attractor and apart.
  const seed = new Float64Array(SYSTEM.start);
  SYSTEM.step(seed, SYSTEM.burnIn);

  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;

  const trails: Trail[] = [];
  for (let t = 0; t < TRAILS; t++) {
    const points = new Float32Array(TRAIL_LEN * 3);
    for (let i = 0; i < TRAIL_LEN; i++) {
      SYSTEM.step(seed, SYSTEM.substeps);
      points[i * 3] = seed[0];
      points[i * 3 + 1] = seed[1];
      points[i * 3 + 2] = seed[2];
      // Spinning shapes are framed by radius, so any angle stays in frame.
      const r = Math.hypot(seed[0], seed[1]);
      const lo = SYSTEM.spins ? -r : seed[0];
      const hi = SYSTEM.spins ? r : seed[0];
      if (lo < minX) minX = lo;
      if (hi > maxX) maxX = hi;
      if (seed[2] < minZ) minZ = seed[2];
      if (seed[2] > maxZ) maxZ = seed[2];
    }
    const n = TRAIL_LEN * 2 * 3;
    const trail = {
      head: new Float64Array(seed),
      points,
      position: new Float32Array(n),
      prev: new Float32Array(n),
      next: new Float32Array(n),
    } as Trail;
    buildRibbon(trail);
    trail.geometry = new Geometry(gl, {
      position: { size: 3, data: trail.position },
      prev: { size: 3, data: trail.prev },
      next: { size: 3, data: trail.next },
      side: { size: 1, data: sides },
      aAge: { size: 1, data: ages },
      index: { data: index },
    });
    trails.push(trail);
  }

  const program = new Program(gl, {
    vertex,
    fragment,
    uniforms: {
      uDepthFar: { value: CAMERA_Z + DEPTH_SPAN / 2 },
      uDepthRange: { value: DEPTH_SPAN },
      // After the upright rotation, orbit x is screen x and orbit z is screen y.
      uOrigin: { value: new Vec3((minX + maxX) / 2, 0, (minZ + maxZ) / 2) },
      // signal-300 near, signal-700 far.
      uColorCore: { value: new Vec3(0.416, 0.918, 1.0) },
      uColorEdge: { value: new Vec3(0.043, 0.459, 0.565) },
      // Both in device pixels, set on resize.
      uResolution: { value: [1, 1] },
      uThickness: { value: THICKNESS * dpr },
    },
    transparent: true,
    depthTest: false,
    // Ribbon triangles wind either way depending on stroke direction.
    cullFace: false,
  });
  // Additive: where trails cross, they brighten instead of occluding.
  program.setBlendFunc(gl.SRC_ALPHA, gl.ONE);

  for (const trail of trails) {
    new Mesh(gl, { mode: gl.TRIANGLES, geometry: trail.geometry, program }).setParent(shape);
  }

  // Measure the parent: OGL writes an inline 300x150 size onto the canvas.
  // clientWidth/Height rather than getBoundingClientRect, which would include
  // the hero's scroll-linked scale transform.
  const container = canvas.parentElement ?? canvas;
  const visibleHeight = 2 * CAMERA_Z * Math.tan((45 * Math.PI) / 360);
  let sceneScale = 1;

  function resize() {
    const width = container.clientWidth;
    const height = container.clientHeight;
    if (width === 0 || height === 0) return;

    renderer.setSize(width, height);
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    camera.perspective({ aspect: width / height });
    program.uniforms.uResolution.value = [width * dpr, height * dpr];

    const visibleWidth = visibleHeight * (width / height);
    sceneScale = Math.min((visibleHeight * 0.7) / (maxZ - minZ), (visibleWidth * 0.76) / (maxX - minX));
  }
  resize();

  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(container);

  // Pointer sway, eased toward the target.
  const pointer = { x: 0, y: 0 };
  const target = { x: 0, y: 0 };
  function onPointerMove(e: PointerEvent) {
    target.x = (e.clientX / window.innerWidth - 0.5) * 2;
    target.y = (e.clientY / window.innerHeight - 0.5) * 2;
  }
  window.addEventListener('pointermove', onPointerMove, { passive: true });

  // Pause while scrolled away.
  let visible = true;
  const io = new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
  });
  io.observe(container);

  let raf = 0;
  let last = performance.now();
  let pending = 0;

  function frame(now: number) {
    raf = requestAnimationFrame(frame);

    // Clamp so a backgrounded tab does not jump on return.
    const dt = Math.min((now - last) / 1000, 1 / 30);
    last = now;
    if (!visible) return;

    // Advance each head by a whole number of vertices, carrying the remainder.
    pending += dt * VERTS_PER_SECOND;
    const n = Math.min(Math.floor(pending), TRAIL_LEN);
    pending -= n;

    if (n > 0) {
      for (const trail of trails) {
        const { head, points } = trail;
        points.copyWithin(0, n * 3);
        for (let j = TRAIL_LEN - n; j < TRAIL_LEN; j++) {
          SYSTEM.step(head, SYSTEM.substeps);
          points[j * 3] = head[0];
          points[j * 3 + 1] = head[1];
          points[j * 3 + 2] = head[2];
        }
        buildRibbon(trail);
        const attrs = trail.geometry.attributes;
        attrs.position.needsUpdate = true;
        attrs.prev.needsUpdate = true;
        attrs.next.needsUpdate = true;
      }
    }

    // Frame-rate-independent easing.
    const ease = 1 - Math.pow(0.955, dt * 60);
    pointer.x += (target.x - pointer.x) * ease;
    pointer.y += (target.y - pointer.y) * ease;

    shape.scale.set(sceneScale);
    // -90° on x stands the x–z butterfly upright, facing the camera. Sway
    // stays small and in-plane so the shape is never seen edge-on.
    if (SYSTEM.spins) {
      // Tilted toward the viewer so the shell and its axial tube both read,
      // and turning slowly about its own axis.
      shape.rotation.x = -Math.PI / 2 + 0.42 + pointer.y * 0.12;
      shape.rotation.z = now * 0.00012 + pointer.x * 0.3;
    } else {
      // Bounded in-plane sway: seen edge-on, the butterfly collapses.
      shape.rotation.x = -Math.PI / 2 + pointer.y * 0.16;
      shape.rotation.z = Math.sin(now * 0.00007) * 0.18 + pointer.x * 0.2;
    }

    renderer.render({ scene, camera });
  }
  raf = requestAnimationFrame(frame);

  return function destroy() {
    cancelAnimationFrame(raf);
    resizeObserver.disconnect();
    io.disconnect();
    window.removeEventListener('pointermove', onPointerMove);
    gl.getExtension('WEBGL_lose_context')?.loseContext();
  };
}
