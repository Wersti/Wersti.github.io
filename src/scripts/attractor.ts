/**
 * Lorenz attractor particle field.
 *
 * A signature hero visual rather than a generic decorative blob: particles are
 * advected through the Lorenz system, so what you see is the actual strange
 * attractor emerging in real time.
 *
 * Uses OGL (~10 KB) instead of Three.js (~600 KB) because this needs one
 * shader and one draw call, nothing more.
 *
 * Loaded dynamically and only when: WebGL exists, the canvas is on screen,
 * the viewport is desktop-sized, and the user has not asked for reduced
 * motion. Every one of those failing leaves the CSS fallback in place.
 */

import { Renderer, Camera, Transform, Program, Geometry, Mesh, Vec3 } from 'ogl';

// The attractor is a fractal *sheet*, not a curve. Too few particles and it
// reads as a thin filament rather than a form, so the count is set by what
// makes the surface legible — 13k points is ~150k Euler sub-steps per frame,
// still comfortably inside a frame budget for one draw call.
const PARTICLE_COUNT = 13000;

// Camera distance and the depth ramp derived from it, so the shader and the
// camera can never drift out of agreement.
const CAMERA_Z = 72;
const DEPTH_SPAN = 60;

// Classic Lorenz parameters — the values that produce the butterfly.
const SIGMA = 10;
const RHO = 28;
const BETA = 8 / 3;

const vertex = /* glsl */ `
  attribute vec3 position;
  attribute float aSeed;

  uniform mat4 modelViewMatrix;
  uniform mat4 projectionMatrix;
  uniform float uTime;
  uniform float uDepthFar;
  uniform float uDepthRange;
  uniform float uPixelRatio;
  uniform vec3 uOrigin;

  varying float vDepth;
  varying float vSeed;

  void main() {
    // Recentre in the shader so rotation pivots on the attractor's centre
    // rather than the origin of its raw coordinate space.
    vec4 mv = modelViewMatrix * vec4(position - uOrigin, 1.0);

    // View-space z is negative in front of the camera. The ramp has to be
    // derived from the actual camera distance — hardcoding it silently
    // clamps every particle to one end and makes the field invisible.
    vDepth = clamp((mv.z + uDepthFar) / uDepthRange, 0.0, 1.0);
    vSeed = aSeed;

    gl_Position = projectionMatrix * mv;
    // Nearer particles read larger; the twinkle keeps the field alive.
    float twinkle = 0.85 + 0.15 * sin(uTime * 2.0 + aSeed * 12.0);
    gl_PointSize = (2.2 + vDepth * 2.6) * twinkle * uPixelRatio;
  }
`;

const fragment = /* glsl */ `
  precision highp float;

  uniform vec3 uColorCore;
  uniform vec3 uColorEdge;

  varying float vDepth;
  varying float vSeed;

  void main() {
    // Round, soft-edged points.
    vec2 uv = gl_PointCoord - 0.5;
    float d = length(uv);
    if (d > 0.5) discard;

    float soft = smoothstep(0.5, 0.05, d);
    vec3 color = mix(uColorEdge, uColorCore, vDepth);

    gl_FragColor = vec4(color, soft * (0.75 + vDepth * 0.55));
  }
`;

export function initAttractor(canvas: HTMLCanvasElement): () => void {
  const renderer = new Renderer({
    canvas,
    alpha: true,
    antialias: true,
    dpr: Math.min(window.devicePixelRatio, 2),
  });

  const gl = renderer.gl;
  gl.clearColor(0, 0, 0, 0);
  gl.enable(gl.BLEND);
  // Additive blending: overlapping particles build luminosity.
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
  gl.disable(gl.DEPTH_TEST);

  const dpr = Math.min(window.devicePixelRatio, 2);

  const camera = new Camera(gl, { fov: 45, near: 0.1, far: 400 });
  camera.position.set(0, 0, CAMERA_Z);
  camera.lookAt(new Vec3(0, 0, 0));

  const scene = new Transform();

  // Seed by sampling one long orbit rather than scattering a random cloud.
  // Lorenz is an *attractor*: a random cloud collapses onto the manifold and
  // reads as a thin filament. Points already spread along the orbit show the
  // whole butterfly from the first frame and stay spread as they flow.
  const positions = new Float32Array(PARTICLE_COUNT * 3);
  const seeds = new Float32Array(PARTICLE_COUNT);

  {
    let x = 0.1;
    let y = 0;
    let z = 20;
    const H = 0.002;

    // Discard the transient so sampling starts on the manifold.
    for (let i = 0; i < 5000; i++) {
      const dx = SIGMA * (y - x);
      const dy = x * (RHO - z) - y;
      const dz = x * y - BETA * z;
      x += dx * H;
      y += dy * H;
      z += dz * H;
    }

    // Spread samples over many orbits so both lobes fill evenly. The stride
    // sets the time window sampled: at h=0.002, stride 4 covers only t≈52 —
    // a handful of orbits, which reads as a filament. Stride 20 covers t≈520
    // and fills the attractor's sheet.
    const strideSteps = 20;
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      for (let s = 0; s < strideSteps; s++) {
        const dx = SIGMA * (y - x);
        const dy = x * (RHO - z) - y;
        const dz = x * y - BETA * z;
        x += dx * H;
        y += dy * H;
        z += dz * H;
      }
      // Slight jitter so particles do not sit in a perfect single-file line.
      positions[i * 3 + 0] = x + (Math.random() - 0.5) * 0.25;
      positions[i * 3 + 1] = y + (Math.random() - 0.5) * 0.25;
      positions[i * 3 + 2] = z + (Math.random() - 0.5) * 0.25;
      seeds[i] = Math.random();
    }
  }

  // Frame from the sampled geometry instead of hardcoded constants: measure
  // the orbit's own extent and derive centre and scale from it.
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (let i = 0; i < PARTICLE_COUNT; i++) {
    const x = positions[i * 3];
    const z = positions[i * 3 + 2];
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }
  // After the upright rotation, orbit x maps to screen x and orbit z to screen y.
  const centreX = (minX + maxX) / 2;
  const centreZ = (minZ + maxZ) / 2;

  // Fit to the smaller of the two axes so the whole shape stays in frame on
  // any aspect ratio. Recomputed on resize, since visible width depends on it.
  const visibleHeight = 2 * CAMERA_Z * Math.tan((45 * Math.PI) / 360);
  let sceneScale = 1;

  function computeScale() {
    // clientWidth/Height, not getBoundingClientRect: the hero's scroll-linked
    // departure animation applies a `scale` transform to this container, and a
    // bounding rect reports the *transformed* size. Reading that would make the
    // scene rescale itself as the user scrolls. Layout metrics ignore transforms.
    const aspect = measured.w && measured.h ? measured.w / measured.h : 16 / 9;
    const visibleWidth = visibleHeight * aspect;
    // Leave generous margins: the shape's outer particles are sparse, and
    // clipping the lobes is what makes it read as a smear instead of a form.
    const fitH = (visibleHeight * 0.66) / (maxZ - minZ);
    const fitW = (visibleWidth * 0.72) / (maxX - minX);
    sceneScale = Math.min(fitH, fitW);
  }

  const geometry = new Geometry(gl, {
    position: { size: 3, data: positions },
    aSeed: { size: 1, data: seeds },
  });

  const program = new Program(gl, {
    vertex,
    fragment,
    uniforms: {
      uTime: { value: 0 },
      // Particles sit near the origin, so view-space z spans roughly
      // -(CAMERA_Z + span/2) .. -(CAMERA_Z - span/2).
      uDepthFar: { value: CAMERA_Z + DEPTH_SPAN / 2 },
      uDepthRange: { value: DEPTH_SPAN },
      uPixelRatio: { value: dpr },
      uOrigin: { value: new Vec3(centreX, 0, centreZ) },
      // signal-300 core fading to signal-700 in the distance
      uColorCore: { value: new Vec3(0.416, 0.918, 1.0) },
      uColorEdge: { value: new Vec3(0.043, 0.459, 0.565) },
    },
    transparent: true,
    depthTest: false,
  });

  const points = new Mesh(gl, { mode: gl.POINTS, geometry, program });
  points.setParent(scene);

  // Measure the parent, not the canvas. OGL's Renderer constructor defaults to
  // 300x150 and writes that as an *inline* style, which beats the `w-full
  // h-full` classes — so reading the canvas back gives 300x150 forever. The
  // parent is the element actually sized by CSS.
  const container = canvas.parentElement ?? canvas;

  // Cached untransformed size, refreshed only on resize.
  const measured = { w: 0, h: 0 };

  function resize() {
    const width = container.clientWidth;
    const height = container.clientHeight;
    if (width === 0 || height === 0) return;

    measured.w = width;
    measured.h = height;

    renderer.setSize(width, height);
    // setSize rewrites the inline px style; put it back to fluid so the canvas
    // keeps tracking its container.
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    camera.perspective({ aspect: width / height });
    computeScale();
  }
  resize();

  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(container);

  // Pointer parallax, eased toward the target rather than snapped.
  const pointer = { x: 0, y: 0 };
  const target = { x: 0, y: 0 };
  function onPointerMove(e: PointerEvent) {
    target.x = (e.clientX / window.innerWidth - 0.5) * 2;
    target.y = (e.clientY / window.innerHeight - 0.5) * 2;
  }
  window.addEventListener('pointermove', onPointerMove, { passive: true });

  // Pause when scrolled away — no point burning GPU on an offscreen canvas.
  let visible = true;
  const io = new IntersectionObserver(
    ([entry]) => {
      visible = entry.isIntersecting;
    },
    { threshold: 0 }
  );
  io.observe(container);

  let raf = 0;
  let last = performance.now();
  const posAttr = geometry.attributes.position;

  function frame(now: number) {
    raf = requestAnimationFrame(frame);

    // Clamp dt so a backgrounded tab does not integrate a huge step and blow
    // the particles out to infinity on return.
    const dt = Math.min((now - last) / 1000, 1 / 30);
    last = now;

    if (!visible) return;

    program.uniforms.uTime.value = now * 0.001;

    // Integrate the Lorenz system. Sub-stepping with a small fixed h keeps
    // plain Euler stable: the system's stiffness means a single frame-sized
    // step diverges and throws every particle out of frame.
    const H = 0.002;
    const steps = Math.min(Math.max(Math.round((dt * 0.6) / H), 1), 12);

    const data = posAttr.data as Float32Array;
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const i3 = i * 3;
      let x = data[i3];
      let y = data[i3 + 1];
      let z = data[i3 + 2];

      for (let s = 0; s < steps; s++) {
        const dx = SIGMA * (y - x);
        const dy = x * (RHO - z) - y;
        const dz = x * y - BETA * z;
        x += dx * H;
        y += dy * H;
        z += dz * H;
      }

      // Escaped particles get recycled into the active region.
      if (!Number.isFinite(x) || Math.abs(x) > 90 || Math.abs(y) > 90 || z < -10 || z > 90) {
        x = (Math.random() - 0.5) * 4;
        y = (Math.random() - 0.5) * 4;
        z = 25 + (Math.random() - 0.5) * 4;
      }

      data[i3] = x;
      data[i3 + 1] = y;
      data[i3 + 2] = z;
    }
    posAttr.needsUpdate = true;

    pointer.x += (target.x - pointer.x) * 0.045;
    pointer.y += (target.y - pointer.y) * 0.045;

    // Rotating x by -90° stands the butterfly upright, facing the camera.
    // Geometry is recentred in the shader via uOrigin, so the mesh transform
    // only has to handle placement.
    points.scale.set(sceneScale);

    // Position stays at the origin, on the camera axis. Offsetting the mesh
    // sideways is what made this read as a "V": under perspective an off-axis
    // object is seen obliquely, and the foreshortening squeezes the two lobes
    // inward until they converge. The canvas is positioned over the right-hand
    // side in CSS instead, so the attractor is always viewed square-on — and
    // the render loop needs no layout reads at all.

    // The Lorenz butterfly lies in the x–z plane. Standing it upright (-90° on
    // x) shows that plane face-on; yawing away from square flattens it into a
    // cloud, so the sway is kept small and applied on z, in-plane.
    points.rotation.x = -Math.PI / 2 + pointer.y * 0.16;
    points.rotation.y = 0;
    // Bounded sway, not an unbounded spin — a full rotation would periodically
    // present the shape edge-on, where it collapses into a smear.
    points.rotation.z = Math.sin(now * 0.00007) * 0.18 + pointer.x * 0.2;

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
