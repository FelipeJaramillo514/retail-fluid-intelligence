import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { PALETTE, reducedMotion, SimpleClock } from './common.js';

const R = 1;
const MAP_W = 4; const MAP_H = 2; // el mapa plano conserva la proporción 2:1 de la textura
const fmt2 = new Intl.NumberFormat('es-CO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmt0 = new Intl.NumberFormat('es-CO', { maximumFractionDigits: 0 });
const compact = (v) => (v >= 1e6 ? `${(v / 1e6).toFixed(2).replace('.', ',')} M` : `${fmt0.format(Math.round(v / 1000))} mil`);

/** lon/lat → punto sobre la esfera, coherente con el mapeo UV de SphereGeometry. */
function latLon(lat, lon, radius = R) {
  const phi = THREE.MathUtils.degToRad(lat);
  const lam = THREE.MathUtils.degToRad(lon);
  return new THREE.Vector3(Math.cos(phi) * Math.cos(lam), Math.sin(phi), -Math.cos(phi) * Math.sin(lam)).multiplyScalar(radius);
}
/** lon/lat → punto sobre el plano del mapa (norte = -Z). */
function planePoint(lat, lon) {
  return new THREE.Vector3((lon / 180) * (MAP_W / 2), 0, -(lat / 90) * (MAP_H / 2));
}

/** Dibuja la base cartográfica (SVG de Natural Earth) como textura equirectangular. */
async function buildEarthTexture() {
  const W = 2048; const H = 1024;
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  const sea = ctx.createLinearGradient(0, 0, 0, H);
  sea.addColorStop(0, '#0d1a5c'); sea.addColorStop(0.5, '#0a1450'); sea.addColorStop(1, '#0b1a5a');
  ctx.fillStyle = sea; ctx.fillRect(0, 0, W, H);

  ctx.strokeStyle = 'rgba(140, 210, 255, .16)'; ctx.lineWidth = 1.4;
  for (let lon = 0; lon <= 360; lon += 30) { ctx.beginPath(); ctx.moveTo((lon / 360) * W, 0); ctx.lineTo((lon / 360) * W, H); ctx.stroke(); }
  for (let lat = 0; lat <= 180; lat += 30) { ctx.beginPath(); ctx.moveTo(0, (lat / 180) * H); ctx.lineTo(W, (lat / 180) * H); ctx.stroke(); }

  try {
    const svg = await (await fetch('/world-map.svg')).text();
    // El SVG sólo trae viewBox: se fija su tamaño intrínseco para que drawImage use las mismas unidades.
    const tinted = svg
      .replace('<svg ', '<svg width="900" height="390" ')
      .replace(/fill="#[0-9a-fA-F]{3,6}"/g, 'fill="#5b7cf5"')
      .replace(/stroke="#[0-9a-fA-F]{3,6}"/g, 'stroke="#c4f3ff"')
      .replace(/stroke-width="[^"]*"/g, 'stroke-width=".55"');
    const url = URL.createObjectURL(new Blob([tinted], { type: 'image/svg+xml' }));
    const img = new Image();
    await new Promise((resolve, reject) => { img.onload = resolve; img.onerror = reject; img.src = url; });
    // La vista 2D proyecta lon/lat en el rectángulo (22,20)–(878,372) del SVG de 900×390.
    ctx.drawImage(img, 22, 20, 856, 352, 0, 0, W, H);
    URL.revokeObjectURL(url);
  } catch {
    /* sin base cartográfica el visor sigue funcionando con la retícula */
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

function atmosphere() {
  return new THREE.Mesh(
    new THREE.SphereGeometry(R * 1.1, 64, 48),
    new THREE.ShaderMaterial({
      transparent: true, side: THREE.BackSide, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { uInner: { value: new THREE.Color(PALETTE.cyan) }, uOuter: { value: new THREE.Color(PALETTE.violet) } },
      vertexShader: 'varying vec3 vN; varying vec3 vV; void main(){ vN = normalize(normalMatrix * normal); vec4 mv = modelViewMatrix * vec4(position,1.); vV = -mv.xyz; gl_Position = projectionMatrix * mv; }',
      fragmentShader: `uniform vec3 uInner; uniform vec3 uOuter; varying vec3 vN; varying vec3 vV;
        void main(){ float f = pow(clamp(-dot(normalize(vN), normalize(vV)) * 2.4, 0.0, 1.0), 1.8); gl_FragColor = vec4(mix(uOuter, uInner, f), f * 0.55);
          #include <colorspace_fragment>
        }`,
    }),
  );
}

export async function initGlobe({ canvas, tip, count, geo, labels, modeButtons }) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(0x000000, 0);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 50);

  scene.add(new THREE.AmbientLight(0xaab4ff, 1.15));
  const l1 = new THREE.DirectionalLight(0xdff6ff, 1.8); l1.position.set(3, 3, 4);
  const l2 = new THREE.DirectionalLight(0xff8fc4, 0.9); l2.position.set(-4, -1, -2);
  scene.add(l1, l2);

  const earthMap = await buildEarthTexture();
  const earthMaterial = new THREE.MeshStandardMaterial({ map: earthMap, roughness: 0.75, metalness: 0.05, emissive: 0xffffff, emissiveMap: earthMap, emissiveIntensity: 0.38 });
  const earth = new THREE.Mesh(new THREE.SphereGeometry(R, 128, 96), earthMaterial);
  const halo = atmosphere();
  const globeGroup = new THREE.Group(); globeGroup.add(earth, halo);

  const flat = new THREE.Mesh(new THREE.PlaneGeometry(MAP_W, MAP_H), earthMaterial.clone());
  flat.rotation.x = -Math.PI / 2;
  const flatGroup = new THREE.Group(); flatGroup.add(flat);
  const slab = new THREE.Mesh(new THREE.BoxGeometry(MAP_W + 0.08, 0.06, MAP_H + 0.08), new THREE.MeshStandardMaterial({ color: 0x1b2a8a, roughness: 0.4, metalness: 0.5 }));
  slab.position.y = -0.04; flatGroup.add(slab);
  scene.add(globeGroup, flatGroup);

  const controls = new OrbitControls(camera, canvas);
  controls.enablePan = false; controls.enableDamping = true; controls.dampingFactor = 0.08;

  const bars = new THREE.Group();
  scene.add(bars);
  const prismGeo = new THREE.CylinderGeometry(0.022, 0.03, 1, 8, 1).translate(0, 0.5, 0);
  const capGeo = new THREE.SphereGeometry(0.038, 16, 12);
  const baseGeo = new THREE.RingGeometry(0.04, 0.058, 28);
  const up = new THREE.Vector3(0, 1, 0);
  const cyan = new THREE.Color(PALETTE.cyan); const pink = new THREE.Color(PALETTE.pink);
  const pickables = [];
  let mode = 'globe';
  let grow = 1; let growing = false;
  let currentItems = [];

  function placeBars() {
    bars.children.forEach((holder) => {
      const { lat, lon } = holder.userData;
      if (mode === 'globe') {
        const normal = latLon(lat, lon).normalize();
        holder.position.copy(normal.clone().multiplyScalar(R * 0.998));
        holder.quaternion.setFromUnitVectors(up, normal);
        holder.userData.normal = normal;
      } else {
        holder.position.copy(planePoint(lat, lon)); holder.position.y = 0.002;
        holder.quaternion.identity();
        holder.userData.normal = up.clone();
      }
    });
  }

  function clearBars() {
    bars.children.slice().forEach((child) => {
      child.traverse((o) => { if (o.material) o.material.dispose(); });
      bars.remove(child);
    });
    pickables.length = 0;
    labels.replaceChildren();
  }

  function setData(items) {
    currentItems = items;
    clearBars();
    const located = items.filter((item) => Object.hasOwn(geo, item.key));
    const max = Math.max(...located.map((item) => item.sales), 1);
    const ranked = [...located].sort((a, b) => b.sales - a.sales);
    located.forEach((item) => {
      const [lon, lat] = geo[item.key];
      const frac = Math.sqrt(item.sales / max);
      const color = cyan.clone().lerp(pink, frac);
      const holder = new THREE.Group();
      const height = 0.06 + frac * 0.42;
      holder.userData = { country: item.key, sales: item.sales, lat, lon, height, rank: ranked.indexOf(item) };

      const material = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.5, metalness: 0.2, roughness: 0.35 });
      const prism = new THREE.Mesh(prismGeo, material);
      const cap = new THREE.Mesh(capGeo, new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: color, emissiveIntensity: 0.9, roughness: 0.3 }));
      const base = new THREE.Mesh(baseGeo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85, side: THREE.DoubleSide }));
      base.rotation.x = -Math.PI / 2; base.position.y = 0.003;
      holder.add(prism, cap, base);
      holder.userData.prism = prism; holder.userData.cap = cap;
      [prism, cap].forEach((m) => { m.userData.holder = holder; pickables.push(m); });
      bars.add(holder);

      // Etiqueta HTML con el nombre del país; las 8 mayores muestran además el valor.
      const label = document.createElement('div');
      label.className = 'globe-label';
      label.innerHTML = '<b></b><i></i>';
      label.firstChild.textContent = item.key;
      label.lastChild.textContent = compact(item.sales);
      label.hidden = true;
      holder.userData.label = label;
      labels.appendChild(label);
    });
    placeBars();
    count.textContent = `${located.length} PAÍSES · ALTURA = VENTAS`;
    grow = reducedMotion ? 1 : 0; growing = !reducedMotion;
    applyGrow();
  }

  function applyGrow() {
    const eased = 1 - (1 - grow) ** 3;
    bars.children.forEach((holder) => {
      const h = holder.userData.height * eased;
      holder.userData.prism.scale.y = Math.max(0.001, h);
      holder.userData.cap.position.y = h + 0.03;
    });
  }

  function setMode(next) {
    mode = next;
    globeGroup.visible = mode === 'globe';
    flatGroup.visible = mode === 'map';
    modeButtons.forEach((btn) => btn.setAttribute('aria-pressed', String(btn.dataset.mode === mode)));
    if (mode === 'globe') {
      controls.enableRotate = true; controls.autoRotate = !reducedMotion; controls.autoRotateSpeed = 0.5;
      controls.minDistance = 2.2; controls.maxDistance = 6; controls.minPolarAngle = 0; controls.maxPolarAngle = Math.PI;
      controls.minAzimuthAngle = -Infinity; controls.maxAzimuthAngle = Infinity;
      controls.target.set(0, 0, 0);
      // Mira al Atlántico: se ven América y Europa a la vez.
      const dir = latLon(28, -30).normalize();
      camera.position.copy(dir.multiplyScalar(3.5));
    } else {
      controls.autoRotate = false;
      controls.minDistance = 2.2; controls.maxDistance = 6.5;
      controls.minPolarAngle = 0.15; controls.maxPolarAngle = 1.25;
      controls.minAzimuthAngle = -0.9; controls.maxAzimuthAngle = 0.9;
      controls.target.set(0, 0, 0.1);
      camera.position.set(0, 3.4, 2.9);
    }
    placeBars();
    controls.update();
  }
  modeButtons.forEach((btn) => btn.addEventListener('click', () => setMode(btn.dataset.mode)));

  // Interacción: tooltip al pasar y filtro al hacer clic.
  const ray = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  let hovered = null; let downAt = null;
  function pick(event) {
    const rect = canvas.getBoundingClientRect();
    pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
    ray.setFromCamera(pointer, camera);
    const hit = ray.intersectObjects(pickables, false)[0];
    if (hit && mode === 'globe') {
      const earthHit = ray.intersectObject(earth, false)[0];
      if (earthHit && earthHit.distance < hit.distance - 0.02) return null; // detrás del planeta
    }
    return hit ? hit.object.userData.holder : null;
  }
  function positionTip(event) {
    const rect = canvas.parentElement.getBoundingClientRect();
    tip.style.left = `${Math.min(event.clientX - rect.left + 14, rect.width - 190)}px`;
    tip.style.top = `${Math.max(event.clientY - rect.top - 10, 6)}px`;
  }
  canvas.addEventListener('pointermove', (event) => {
    const holder = pick(event);
    if (holder === hovered) { if (holder) positionTip(event); return; }
    hovered = holder;
    canvas.style.cursor = holder ? 'pointer' : 'grab';
    controls.autoRotate = mode === 'globe' && !holder && !reducedMotion;
    if (!holder) { tip.hidden = true; return; }
    tip.innerHTML = '<strong></strong><span></span>';
    tip.firstChild.textContent = holder.userData.country;
    tip.lastChild.textContent = `${fmt2.format(holder.userData.sales)} en ventas · clic para filtrar`;
    tip.hidden = false; positionTip(event);
  });
  canvas.addEventListener('pointerleave', () => { hovered = null; tip.hidden = true; controls.autoRotate = mode === 'globe' && !reducedMotion; });
  canvas.addEventListener('pointerdown', (event) => { downAt = [event.clientX, event.clientY]; });
  canvas.addEventListener('pointerup', (event) => {
    if (!downAt || Math.hypot(event.clientX - downAt[0], event.clientY - downAt[1]) > 5) return;
    const holder = pick(event);
    if (holder) document.dispatchEvent(new CustomEvent('rf:country', { detail: { country: holder.userData.country } }));
  });

  // Etiquetas: se proyectan a pantalla y se ocultan las del lado oculto del globo.
  const tmp = new THREE.Vector3(); const camDir = new THREE.Vector3();
  function updateLabels() {
    const w = canvas.clientWidth; const h = canvas.clientHeight;
    camDir.copy(camera.position).normalize();
    const limit = mode === 'globe' ? 4 : 6; // el resto de países se ve al pasar el cursor
    bars.children.forEach((holder) => {
      const label = holder.userData.label;
      const facing = mode === 'map' || holder.userData.normal.dot(camDir) > 0.18;
      const show = facing && holder.userData.rank < limit;
      label.hidden = !show;
      if (!show) return;
      tmp.copy(holder.position).addScaledVector(holder.userData.normal, holder.userData.height * (1 - (1 - grow) ** 3) + 0.1);
      tmp.project(camera);
      label.style.transform = `translate(${((tmp.x + 1) / 2) * w}px, ${((1 - tmp.y) / 2) * h}px) translate(-50%, -100%)`;
    });
  }

  // Ciclo de render: sólo cuando el panel está visible.
  let visible = false; let raf = 0; const clock = new SimpleClock();
  function resize() {
    const w = canvas.clientWidth; const h = canvas.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
  }
  function frame() {
    const dt = Math.min(clock.getDelta(), 0.05);
    if (growing) { grow = Math.min(1, grow + dt * 0.9); applyGrow(); if (grow >= 1) growing = false; }
    controls.update();
    renderer.render(scene, camera);
    updateLabels();
  }
  function loop() { if (!visible) return; frame(); raf = requestAnimationFrame(loop); }
  function setVisible(value) {
    if (value === visible) return;
    visible = value && !document.hidden;
    cancelAnimationFrame(raf);
    if (visible) { resize(); clock.getDelta(); loop(); }
  }
  new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { threshold: 0.05 }).observe(canvas);
  new ResizeObserver(() => { resize(); if (!visible) { renderer.render(scene, camera); updateLabels(); } }).observe(canvas);
  document.addEventListener('visibilitychange', () => setVisible(!document.hidden && canvas.isConnected));

  resize();
  setMode('globe');
  return { setData, setVisible };
}
