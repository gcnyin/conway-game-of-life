import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { FXAAPass } from 'three/addons/postprocessing/FXAAPass.js';

const UP = new THREE.Vector3(0, 1, 0);
const HALF_PI = Math.PI / 2;
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const CELL_WIDTH = 0.8;
const MAX_AGE_COLOR = 20;
const MAX_AGE_HEIGHT = 20;

/** Linear-space palette: birth mint -> cyan -> blue -> violet. */
function makePalette() {
  const stops = [0x2effcf, 0x00c6ff, 0x3f7cff, 0xa45cff].map((hex) =>
    new THREE.Color(hex),
  );
  const lut = new Float32Array(64 * 3);
  for (let i = 0; i < 64; i += 1) {
    const t = (i / 63) * (stops.length - 1);
    const segment = Math.min(stops.length - 2, Math.floor(t));
    const local = t - segment;
    const eased = local * local * (3 - 2 * local);
    const a = stops[segment];
    const b = stops[segment + 1];
    lut[i * 3] = a.r + (b.r - a.r) * eased;
    lut[i * 3 + 1] = a.g + (b.g - a.g) * eased;
    lut[i * 3 + 2] = a.b + (b.b - a.b) * eased;
  }
  return lut;
}

const PALETTE = makePalette();

function hash01(value) {
  const x = Math.sin(value * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

function bresenham(x0, y0, x1, y1) {
  const points = [];
  let dx = Math.abs(x1 - x0);
  let dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let error = dx + dy;
  let x = x0;
  let y = y0;

  while (points.length < 128) {
    points.push([x, y]);
    if (x === x1 && y === y1) break;
    const doubled = 2 * error;
    if (doubled >= dy) {
      error += dy;
      x += sx;
    }
    if (doubled <= dx) {
      error += dx;
      y += sy;
    }
  }
  return points;
}

export class LifeScene {
  constructor(canvas, { sim, onEditStart, onToggle, onPaint, onPaintEnd }) {
    this.canvas = canvas;
    this.sim = sim;
    this.size = sim.size;
    this.count = sim.size * sim.size;
    this.onEditStart = onEditStart;
    this.onToggle = onToggle;
    this.onPaint = onPaint;
    this.onPaintEnd = onPaintEnd;

    this.reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.boardHalf = this.size / 2 + 1.9;
    this.isPortrait = false;
    this.paintMode = false;
    this.isPainting = false;
    this.pointerDown = null;
    this.lastPaintCell = null;
    this.hoverCell = null;
    this.strokeValue = 1;
    this.startTime = performance.now();
    this.intro = null;
    this.fitDistance = 110;
    this.target = new THREE.Vector3(0, 0, 0);
    this.landscapeDirection = new THREE.Vector3(0.61, 0.68, 0.87).normalize();
    this.portraitDirection = new THREE.Vector3(0.38, 1.12, 0.68).normalize();
    this.baseDirection = this.landscapeDirection.clone();
    this.currentTime = 0;
    this.stars = null;
    this.dome = null;

    this.visualHeight = new Float32Array(this.count);
    this.introDelay = new Float32Array(this.count);
    this.shade = new Float32Array(this.count);
    for (let i = 0; i < this.count; i += 1) {
      this.shade[i] = 0.9 + hash01(i) * 0.16;
      const x = i % this.size;
      const y = Math.floor(i / this.size);
      const dx = (x - (this.size - 1) / 2) / (this.size / 2);
      const dy = (y - (this.size - 1) / 2) / (this.size / 2);
      const radial = Math.min(1, Math.hypot(dx, dy));
      this.introDelay[i] = this.reducedMotion
        ? 0
        : 0.12 + radial * 0.52 + hash01(i + 19) * 0.16;
    }

    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.boardPlane = new THREE.Plane(UP.clone(), 0);
    this.hitPoint = new THREE.Vector3();

    this.initRenderer();
    this.initScene();
    this.initPostProcessing();
    this.initControls();
    this.bindEvents();
    this.resize();

    if (!this.reducedMotion) {
      this.intro = { start: performance.now(), duration: 2300 };
      this.controls.enabled = false;
    }
  }

  initRenderer() {
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: false,
      alpha: false,
      powerPreference: 'high-performance',
      stencil: false,
    });
    this.renderer.setClearColor(0x02050a, 1);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.renderer.toneMappingExposure = 1.0;
  }

  initScene() {
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(40, 1, 1, 700);
    this.scene.fog = new THREE.FogExp2(0x02050a, 0.0035);

    this.buildAtmosphere();
    this.buildBoard();
    this.buildCells();
    this.buildHover();

    this.hemi = new THREE.HemisphereLight(0xa5ecff, 0x02050a, 1.1);
    this.scene.add(this.hemi);

    this.keyLight = new THREE.DirectionalLight(0xd7fff9, 2.1);
    this.keyLight.position.set(26, 52, 20);
    this.scene.add(this.keyLight);

    this.rimLight = new THREE.DirectionalLight(0x6c5dff, 1.7);
    this.rimLight.position.set(-38, 24, -32);
    this.scene.add(this.rimLight);

    this.syncColors();
  }

  buildAtmosphere() {
    const domeMaterial = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: false,
      uniforms: {},
      vertexShader: /* glsl */ `
        varying vec3 vDirection;
        void main() {
          vDirection = normalize(position);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec3 vDirection;

        void main() {
          vec3 dir = normalize(vDirection);
          float height = clamp(dir.y * 0.5 + 0.5, 0.0, 1.0);

          vec3 bottom = vec3(0.0015, 0.0035, 0.0085);
          vec3 middle = vec3(0.008, 0.026, 0.043);
          vec3 top = vec3(0.005, 0.014, 0.031);

          vec3 color = mix(bottom, middle, smoothstep(0.32, 0.61, height));
          color = mix(color, top, smoothstep(0.58, 1.0, height));

          float violetHaze = pow(max(dot(dir, normalize(vec3(-0.72, 0.18, -0.72))), 0.0), 5.0);
          color += vec3(0.026, 0.011, 0.048) * violetHaze;

          float tealHaze = pow(max(dot(dir, normalize(vec3(0.68, 0.05, 0.5))), 0.0), 7.0);
          color += vec3(0.006, 0.042, 0.047) * tealHaze;

          float horizon = exp(-pow((height - 0.47) * 7.0, 2.0));
          color += vec3(0.006, 0.022, 0.028) * horizon;

          gl_FragColor = vec4(color, 1.0);
        }
      `,
    });

    this.dome = new THREE.Mesh(new THREE.SphereGeometry(280, 32, 20), domeMaterial);
    this.dome.frustumCulled = false;
    this.dome.renderOrder = -100;
    this.scene.add(this.dome);

    const starCount = 560;
    const positions = new Float32Array(starCount * 3);
    const sizes = new Float32Array(starCount);
    const alphas = new Float32Array(starCount);

    for (let i = 0; i < starCount; i += 1) {
      const radius = 120 + Math.random() * 150;
      const theta = Math.random() * Math.PI * 2;
      const cosPhi = Math.random() * 1.55 - 0.35;
      const sinPhi = Math.sqrt(Math.max(0, 1 - cosPhi * cosPhi));
      positions[i * 3] = Math.cos(theta) * sinPhi * radius;
      positions[i * 3 + 1] = cosPhi * radius;
      positions[i * 3 + 2] = Math.sin(theta) * sinPhi * radius;
      sizes[i] = 0.6 + Math.random() * 2.4;
      alphas[i] = 0.16 + Math.random() * 0.74;
    }

    const starGeometry = new THREE.BufferGeometry();
    starGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    starGeometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
    starGeometry.setAttribute('aAlpha', new THREE.BufferAttribute(alphas, 1));

    this.starMaterial = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uPixelRatio: { value: 1 },
      },
      vertexShader: /* glsl */ `
        attribute float aSize;
        attribute float aAlpha;
        uniform float uPixelRatio;
        varying float vAlpha;

        void main() {
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mvPosition;
          gl_PointSize = clamp(aSize * uPixelRatio * (235.0 / max(1.0, -mvPosition.z)), 0.7, 4.5);
          vAlpha = aAlpha;
        }
      `,
      fragmentShader: /* glsl */ `
        varying float vAlpha;

        void main() {
          float d = length(gl_PointCoord - vec2(0.5));
          if (d > 0.5) discard;
          float alpha = smoothstep(0.5, 0.02, d);
          alpha *= alpha;
          gl_FragColor = vec4(vec3(0.66, 0.88, 1.0), alpha * vAlpha);
        }
      `,
    });

    this.stars = new THREE.Points(starGeometry, this.starMaterial);
    this.stars.frustumCulled = false;
    this.scene.add(this.stars);

    const floorGeometry = new THREE.PlaneGeometry(360, 360);
    this.floorMaterial = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {},
      vertexShader: /* glsl */ `
        varying vec3 vWorldPosition;
        void main() {
          vec4 world = modelMatrix * vec4(position, 1.0);
          vWorldPosition = world.xyz;
          gl_Position = projectionMatrix * viewMatrix * world;
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec3 vWorldPosition;

        void main() {
          vec2 p = vWorldPosition.xz;
          vec2 coord = p / 6.0;
          vec2 grid = abs(fract(coord - 0.5) - 0.5) / fwidth(coord);
          float line = 1.0 - min(min(grid.x, grid.y), 1.0);
          float distanceToCenter = length(p);
          float fade = smoothstep(135.0, 16.0, distanceToCenter);
          float alpha = line * fade * 0.065;
          gl_FragColor = vec4(vec3(0.06, 0.22, 0.23), alpha);
        }
      `,
    });

    const floor = new THREE.Mesh(floorGeometry, this.floorMaterial);
    floor.rotation.x = -HALF_PI;
    floor.position.y = -1.72;
    floor.renderOrder = -10;
    floor.frustumCulled = false;
    this.scene.add(floor);
  }

  buildBoard() {
    this.boardGroup = new THREE.Group();
    this.scene.add(this.boardGroup);

    const base = new THREE.Mesh(
      new RoundedBoxGeometry(this.size + 3.8, 1.55, this.size + 3.8, 3, 0.16),
      new THREE.MeshStandardMaterial({
        color: 0x061019,
        roughness: 0.64,
        metalness: 0.42,
        emissive: 0x02090d,
        emissiveIntensity: 0.8,
      }),
    );
    base.position.y = -0.8;
    this.boardGroup.add(base);

    const gridMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uSize: { value: this.size },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec2 vUv;
        uniform float uSize;

        void main() {
          // One subtle major line every four cells; individual cells are
          // outlined by the glowing geometry itself.
          vec2 coord = vUv * uSize / 4.0;
          vec2 grid = abs(fract(coord - 0.5) - 0.5) / fwidth(coord);
          float line = 1.0 - min(min(grid.x, grid.y), 1.0);

          vec2 centered = vUv - 0.5;
          float radial = smoothstep(0.74, 0.12, length(centered));
          float edge = smoothstep(0.43, 0.5, max(abs(centered.x), abs(centered.y)));

          vec3 baseColor = mix(vec3(0.0025, 0.0055, 0.012), vec3(0.004, 0.012, 0.023), radial);
          vec3 color = baseColor;
          color += vec3(0.01, 0.034, 0.052) * line * (0.12 + radial * 0.18);
          color += vec3(0.01, 0.033, 0.055) * edge * 0.32;

          gl_FragColor = vec4(color, 1.0);
        }
      `,
    });

    const grid = new THREE.Mesh(new THREE.PlaneGeometry(this.size, this.size), gridMaterial);
    grid.rotation.x = -HALF_PI;
    grid.position.y = 0.004;
    this.boardGroup.add(grid);

    const rimMaterial = new THREE.LineBasicMaterial({
      color: 0x6bffe5,
      transparent: true,
      opacity: 0.3,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const rimPoints = [];
    const rim = this.size / 2 + 1.1;
    const corners = [
      [-rim, -rim],
      [rim, -rim],
      [rim, rim],
      [-rim, rim],
    ];
    for (let i = 0; i < corners.length; i += 1) {
      const [x, z] = corners[i];
      rimPoints.push(new THREE.Vector3(x, 0.012, z));
    }
    const rimGeometry = new THREE.BufferGeometry().setFromPoints(rimPoints);
    const rimLine = new THREE.LineLoop(rimGeometry, rimMaterial);
    this.boardGroup.add(rimLine);

    const bracketPoints = [];
    const corner = this.size / 2 + 1.14;
    const arm = 2.9;
    for (const [sx, sz] of [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ]) {
      const x = corner * sx;
      const z = corner * sz;
      bracketPoints.push(new THREE.Vector3(x - arm * sx, 0.016, z));
      bracketPoints.push(new THREE.Vector3(x, 0.016, z));
      bracketPoints.push(new THREE.Vector3(x, 0.016, z));
      bracketPoints.push(new THREE.Vector3(x, 0.016, z - arm * sz));
    }

    const bracketGeometry = new THREE.BufferGeometry().setFromPoints(bracketPoints);
    const brackets = new THREE.LineSegments(
      bracketGeometry,
      new THREE.LineBasicMaterial({
        color: 0xa5fff2,
        transparent: true,
        opacity: 0.55,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    this.boardGroup.add(brackets);
  }

  buildCells() {
    const geometry = new RoundedBoxGeometry(CELL_WIDTH, 1, CELL_WIDTH, 2, 0.07);
    this.colorArray = new Float32Array(this.count * 3);
    this.colorAttribute = new THREE.InstancedBufferAttribute(this.colorArray, 3);
    this.colorAttribute.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('cellColor', this.colorAttribute);

    this.cellMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
      },
      vertexShader: /* glsl */ `
        attribute vec3 cellColor;
        varying vec3 vColor;
        varying vec3 vNormalV;
        varying vec3 vViewDir;

        void main() {
          vec4 worldPosition = instanceMatrix * vec4(position, 1.0);
          vec4 mvPosition = modelViewMatrix * worldPosition;
          vColor = cellColor;
          vNormalV = normalize(normalMatrix * normal);
          vViewDir = normalize(-mvPosition.xyz);
          gl_Position = projectionMatrix * mvPosition;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        varying vec3 vColor;
        varying vec3 vNormalV;
        varying vec3 vViewDir;

        void main() {
          vec3 normal = normalize(vNormalV);
          vec3 viewDir = normalize(vViewDir);
          vec3 keyDir = normalize(vec3(-0.45, 0.95, 0.55));
          vec3 fillDir = normalize(vec3(0.7, 0.25, -0.45));

          float key = max(dot(normal, keyDir), 0.0);
          float fill = max(dot(normal, fillDir), 0.0);
          float top = smoothstep(0.2, 0.92, normal.y);
          float fresnel = pow(1.0 - max(dot(normal, viewDir), 0.0), 2.0);

          vec3 color = vColor * (0.075 + key * 0.46 + fill * 0.12 + top * 0.3);
          color += vColor * fresnel * 0.9;
          color += vec3(0.24, 0.76, 0.7) * fresnel * top * 0.12;

          vec3 halfDir = normalize(keyDir + viewDir);
          float specular = pow(max(dot(normal, halfDir), 0.0), 42.0);
          color += mix(vColor, vec3(0.78, 1.0, 0.96), 0.65) * specular * top * 0.18;

          color *= 0.985 + 0.015 * sin(uTime * 1.8 + vColor.g * 26.0);

          gl_FragColor = vec4(color, 1.0);
        }
      `,
    });

    this.cellMesh = new THREE.InstancedMesh(geometry, this.cellMaterial, this.count);
    this.cellMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.cellMesh.instanceMatrix.array.fill(0);
    for (let i = 0; i < this.count; i += 1) {
      this.cellMesh.instanceMatrix.array[i * 16 + 15] = 1;
    }
    this.cellMesh.instanceMatrix.needsUpdate = true;
    this.cellMesh.frustumCulled = false;
    this.cellMesh.renderOrder = 2;
    this.boardGroup.add(this.cellMesh);
  }

  buildHover() {
    this.hoverGroup = new THREE.Group();
    this.hoverGroup.visible = false;
    this.hoverGroup.renderOrder = 5;

    const half = 0.48;
    const points = [
      new THREE.Vector3(-half, 0, -half),
      new THREE.Vector3(half, 0, -half),
      new THREE.Vector3(half, 0, half),
      new THREE.Vector3(-half, 0, half),
    ];
    const line = new THREE.LineLoop(
      new THREE.BufferGeometry().setFromPoints(points),
      new THREE.LineBasicMaterial({
        color: 0xd8fff9,
        transparent: true,
        opacity: 0.7,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    this.hoverGroup.add(line);

    const fill = new THREE.Mesh(
      new THREE.PlaneGeometry(0.96, 0.96),
      new THREE.MeshBasicMaterial({
        color: 0x6fffe6,
        transparent: true,
        opacity: 0.085,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
      }),
    );
    fill.rotation.x = -HALF_PI;
    fill.position.y = 0.001;
    this.hoverGroup.add(fill);

    this.scene.add(this.hoverGroup);
  }

  initPostProcessing() {
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));

    this.bloom = new UnrealBloomPass(
      new THREE.Vector2(window.innerWidth, window.innerHeight),
      0.7,
      0.12,
      0.7,
    );
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.composer.addPass(new FXAAPass());
  }

  initControls() {
    this.controls = new OrbitControls(this.camera, this.canvas);
    this.controls.target.copy(this.target);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.055;
    this.controls.enablePan = false;
    this.controls.rotateSpeed = 0.55;
    this.controls.zoomSpeed = 0.65;
    this.controls.minPolarAngle = 0.28;
    this.controls.maxPolarAngle = 1.38;
    this.controls.autoRotate = !this.reducedMotion;
    this.controls.autoRotateSpeed = 0.42;

    this.camera.position.copy(this.target).addScaledVector(this.baseDirection, 130);
    this.camera.lookAt(this.target);
    this.controls.update();
    this.hasFitted = false;

    this.controls.addEventListener('start', () => {
      this.canvas.classList.add('is-dragging');
    });
    this.controls.addEventListener('end', () => {
      this.canvas.classList.remove('is-dragging');
    });
  }

  bindEvents() {
    this.onPointerDown = this.onPointerDown.bind(this);
    this.onPointerMove = this.onPointerMove.bind(this);
    this.onPointerUp = this.onPointerUp.bind(this);
    this.onPointerCancel = this.onPointerCancel.bind(this);
    this.onPointerLeave = this.onPointerLeave.bind(this);
    this.onResize = this.onResize.bind(this);
    this.onContextMenu = (event) => event.preventDefault();

    this.canvas.addEventListener('pointerdown', this.onPointerDown, { capture: true });
    this.canvas.addEventListener('pointermove', this.onPointerMove, { capture: true });
    this.canvas.addEventListener('pointerup', this.onPointerUp, { capture: true });
    this.canvas.addEventListener('pointercancel', this.onPointerCancel, { capture: true });
    this.canvas.addEventListener('pointerleave', this.onPointerLeave);
    this.canvas.addEventListener('contextmenu', this.onContextMenu);
    window.addEventListener('resize', this.onResize);
    window.addEventListener('blur', () => this.hideHover());
  }

  setPaintMode(enabled) {
    this.paintMode = enabled;
    this.canvas.classList.toggle('is-paint-mode', enabled);
    if (!enabled) {
      this.hideHover();
    }
  }

  setAutoOrbit(enabled) {
    this.controls.autoRotate = enabled;
  }

  get autoOrbit() {
    return this.controls.autoRotate;
  }

  /** Read a grid coordinate from a pointer event using the board plane. */
  pickCell(event) {
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;

    this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);

    const hit = this.raycaster.ray.intersectPlane(this.boardPlane, this.hitPoint);
    if (!hit) return null;

    const half = (this.size - 1) / 2;
    const x = Math.round(hit.x + half);
    const y = Math.round(hit.z + half);
    if (x < 0 || y < 0 || x >= this.size || y >= this.size) return null;
    return { x, y };
  }

  showHover(cell) {
    if (!cell) {
      this.hideHover();
      return;
    }
    this.hoverCell = cell;
    this.hoverGroup.visible = true;
    const half = (this.size - 1) / 2;
    this.hoverGroup.position.x = cell.x - half;
    this.hoverGroup.position.z = cell.y - half;
    this.hoverGroup.position.y = 0.06;
  }

  hideHover() {
    this.hoverCell = null;
    this.hoverGroup.visible = false;
  }

  onPointerDown(event) {
    if (event.pointerType === 'mouse' && event.button !== 0) return;

    const cell = this.pickCell(event);
    this.pointerDown = {
      x: event.clientX,
      y: event.clientY,
      cell,
      moved: false,
      pointerId: event.pointerId,
    };

    if (cell && (this.paintMode || event.shiftKey)) {
      event.preventDefault();
      this.isPainting = true;
      this.controls.enabled = false;
      this.canvas.classList.add('is-painting');
      this.canvas.setPointerCapture?.(event.pointerId);

      const index = this.sim.index(cell.x, cell.y);
      this.strokeValue = this.sim.alive[index] ? 0 : 1;
      this.lastPaintCell = cell;
      this.onEditStart?.();
      this.onPaint?.([[cell.x, cell.y]], this.strokeValue);
      this.showHover(cell);
    }
  }

  onPointerMove(event) {
    if (this.isPainting) {
      event.preventDefault();
      const cell = this.pickCell(event);
      if (!cell) return;
      if (
        this.lastPaintCell &&
        this.lastPaintCell.x === cell.x &&
        this.lastPaintCell.y === cell.y
      ) {
        return;
      }

      const path = this.lastPaintCell
        ? bresenham(this.lastPaintCell.x, this.lastPaintCell.y, cell.x, cell.y)
        : [[cell.x, cell.y]];
      this.lastPaintCell = cell;
      this.onPaint?.(path, this.strokeValue);
      this.showHover(cell);
      return;
    }

    if (this.pointerDown) {
      const distance = Math.hypot(event.clientX - this.pointerDown.x, event.clientY - this.pointerDown.y);
      if (distance > 6 && !this.pointerDown.moved) {
        this.pointerDown.moved = true;
        this.hideHover();
      }
      if (this.pointerDown.moved) return;
    }

    if (event.pointerType === 'mouse' || event.pointerType === 'pen') {
      const cell = this.pickCell(event);
      if (cell) this.showHover(cell);
      else this.hideHover();
    }
  }

  onPointerUp(event) {
    const down = this.pointerDown;

    if (this.isPainting) {
      this.finishPainting(event.pointerId);
      this.pointerDown = null;
      return;
    }

    this.pointerDown = null;
    if (!down) return;

    const distance = Math.hypot(event.clientX - down.x, event.clientY - down.y);
    const isTap = !down.moved && distance < 7;
    if (isTap && down.cell && (event.pointerType !== 'mouse' || event.button === 0)) {
      this.onEditStart?.();
      this.onToggle?.(down.cell.x, down.cell.y);
      const cell = this.pickCell(event);
      if (cell) this.showHover(cell);
    }
  }

  onPointerCancel() {
    this.finishPainting();
    this.pointerDown = null;
  }

  onPointerLeave() {
    if (!this.isPainting) this.hideHover();
  }

  finishPainting(pointerId) {
    if (!this.isPainting) {
      this.controls.enabled = true;
      this.canvas.classList.remove('is-painting');
      return;
    }
    this.isPainting = false;
    this.lastPaintCell = null;
    this.controls.enabled = true;
    this.canvas.classList.remove('is-painting');
    if (pointerId != null && this.canvas.hasPointerCapture?.(pointerId)) {
      this.canvas.releasePointerCapture(pointerId);
    }
    this.onPaintEnd?.();
  }

  onResize() {
    if (this.resizeFrame) cancelAnimationFrame(this.resizeFrame);
    this.resizeFrame = requestAnimationFrame(() => {
      this.resizeFrame = 0;
      this.resize();
    });
  }

  resize() {
    const width = window.innerWidth;
    const height = window.innerHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, width < 820 ? 1.5 : 1.75);

    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(width, height, false);
    this.composer.setPixelRatio(dpr);
    this.composer.setSize(width, height);

    this.camera.aspect = width / height;
    const isPortrait = height > width * 1.12;
    this.camera.setViewOffset(
      width,
      height,
      0,
      Math.round(height * (isPortrait ? 0.045 : 0.105)),
      width,
      height,
    );
    this.camera.updateProjectionMatrix();

    const orientationJustChanged = this.hasFitted && isPortrait !== this.isPortrait;
    const orientationChanged = this.hasFitted && isPortrait !== this.isPortrait;
    this.isPortrait = isPortrait;
    this.baseDirection.copy(isPortrait ? this.portraitDirection : this.landscapeDirection);
    this.target.set(0, 0, 0);
    this.controls.target.copy(this.target);

    const previousFit = this.fitDistance;
    const previousDistance = this.camera.position.distanceTo(this.controls.target);
    const nextFit = this.computeFitDistance();
    this.fitDistance = nextFit;

    const currentDirection = this.camera.position.clone().sub(this.controls.target);
    if (currentDirection.lengthSq() < 0.001 || !this.hasFitted || orientationChanged) {
      currentDirection.copy(this.baseDirection);
    }
    currentDirection.normalize();

    let distance = nextFit;
    if (this.hasFitted && previousFit > 0 && !orientationChanged) {
      distance = clamp((previousDistance / previousFit) * nextFit, nextFit * 0.42, nextFit * 1.85);
    }
    if (this.intro) distance = nextFit * 1.5;
    this.camera.position.copy(this.controls.target).addScaledVector(currentDirection, distance);
    this.hasFitted = true;
    this.controls.minDistance = nextFit * 0.42;
    this.controls.maxDistance = nextFit * 1.85;
    this.controls.update();

    if (this.starMaterial) {
      this.starMaterial.uniforms.uPixelRatio.value = dpr;
    }
  }

  computeFitDistance() {
    const margins = { x: 0.89, y: 0.82 };
    const half = this.boardHalf;
    const corners = [];
    for (const x of [-half, half]) {
      for (const y of [-1.6, 1.75]) {
        for (const z of [-half, half]) {
          corners.push(new THREE.Vector3(x, y, z));
        }
      }
    }

    const direction = this.baseDirection.clone();
    const projected = new THREE.Vector3();
    const previousPosition = this.camera.position.clone();
    const previousTarget = this.controls?.target?.clone() ?? new THREE.Vector3();
    let low = 20;
    let high = 420;

    for (let i = 0; i < 30; i += 1) {
      const middle = (low + high) / 2;
      this.camera.position.copy(this.target).addScaledVector(direction, middle);
      this.camera.lookAt(this.target);
      this.camera.updateMatrixWorld(true);

      let fits = true;
      for (const corner of corners) {
        projected.copy(corner).project(this.camera);
        if (Math.abs(projected.x) > margins.x || Math.abs(projected.y) > margins.y) {
          fits = false;
          break;
        }
      }

      if (fits) high = middle;
      else low = middle;
    }

    this.camera.position.copy(previousPosition);
    if (this.controls) {
      this.controls.target.copy(previousTarget);
      this.camera.lookAt(this.controls.target);
    }
    this.camera.updateMatrixWorld(true);

    return high;
  }

  syncColors() {
    const colors = this.colorAttribute.array;
    const alive = this.sim.alive;
    const age = this.sim.age;

    for (let i = 0; i < this.count; i += 1) {
      if (!alive[i]) continue;
      const normalized = clamp((age[i] - 1) / MAX_AGE_COLOR, 0, 1);
      const lutIndex = Math.round(normalized * 63) * 3;
      const shade = this.shade[i];
      colors[i * 3] = PALETTE[lutIndex] * shade;
      colors[i * 3 + 1] = PALETTE[lutIndex + 1] * shade;
      colors[i * 3 + 2] = PALETTE[lutIndex + 2] * shade;
    }

    this.colorAttribute.needsUpdate = true;
  }

  cellTargetHeight(i) {
    if (!this.sim.alive[i]) return 0;
    return 0.42 + Math.min(this.sim.age[i], MAX_AGE_HEIGHT) * 0.056;
  }

  updateVisuals(dt, now) {
    const elapsed = (now - this.startTime) / 1000;
    const grow = 1 - Math.exp(-dt * 16);
    const shrink = 1 - Math.exp(-dt * 22);
    const matrix = this.cellMesh.instanceMatrix.array;
    const half = (this.size - 1) / 2;
    let changed = false;

    for (let i = 0; i < this.count; i += 1) {
      let target = this.cellTargetHeight(i);
      if (elapsed < this.introDelay[i]) target = 0;

      let h = this.visualHeight[i];
      const previous = h;
      h += (target - h) * (target > h ? grow : shrink);
      if (h < 0.004) h = 0;
      if (Math.abs(h - previous) > 0.0001) changed = true;
      this.visualHeight[i] = h;

      const offset = i * 16;
      const x = (i % this.size) - half;
      const z = Math.floor(i / this.size) - half;
      if (h === 0) {
        matrix[offset] = 0;
        matrix[offset + 5] = 0;
        matrix[offset + 10] = 0;
        matrix[offset + 12] = x;
        matrix[offset + 13] = 0;
        matrix[offset + 14] = z;
      } else {
        matrix[offset] = CELL_WIDTH;
        matrix[offset + 5] = h;
        matrix[offset + 10] = CELL_WIDTH;
        matrix[offset + 12] = x;
        matrix[offset + 13] = h / 2;
        matrix[offset + 14] = z;
      }
    }

    // Entries outside the scale / translation lanes remain zero or stale zero,
    // which is safe for an affine instance matrix.
    if (changed) this.cellMesh.instanceMatrix.needsUpdate = true;

    if (this.hoverCell) {
      const index = this.sim.index(this.hoverCell.x, this.hoverCell.y);
      const height = this.visualHeight[index];
      const halfBoard = (this.size - 1) / 2;
      this.hoverGroup.position.set(
        this.hoverCell.x - halfBoard,
        Math.max(height, 0.02) + 0.055,
        this.hoverCell.y - halfBoard,
      );
    }
  }

  updateIntro(now) {
    if (!this.intro) {
      this.controls.update();
      return;
    }

    const progress = clamp((now - this.intro.start) / this.intro.duration, 0, 1);
    const eased = 1 - (1 - progress) ** 3;
    const distance = this.fitDistance * (1 + (1 - eased) * 0.55);
    const angle = (1 - eased) * 0.17;
    const direction = this.baseDirection.clone().applyAxisAngle(UP, angle);

    this.camera.position.copy(this.target).addScaledVector(direction, distance);
    this.camera.lookAt(this.target);

    if (progress >= 1) {
      this.intro = null;
      this.controls.enabled = true;
      this.controls.update();
    }
  }

  render(dt, now) {
    this.currentTime = now / 1000;
    this.updateIntro(now);
    this.updateVisuals(dt, now);
    this.cellMaterial.uniforms.uTime.value = this.currentTime;

    if (this.stars) {
      this.stars.rotation.y += dt * 0.003;
    }

    this.composer.render();
  }
}
