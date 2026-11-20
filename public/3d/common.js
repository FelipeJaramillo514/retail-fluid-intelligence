import * as THREE from 'three';

export const PALETTE = {
  cyan: 0x3fe0ff,
  blue: 0x3b6bff,
  violet: 0x8d5cff,
  magenta: 0xd24dff,
  pink: 0xff5fa8,
  deep: 0x0b0a24,
};

export const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export function webglAvailable() {
  try {
    const canvas = document.createElement('canvas');
    return Boolean(canvas.getContext('webgl2') || canvas.getContext('webgl'));
  } catch {
    return false;
  }
}

/** Ruido simplex 3D (Ashima Arts / Stefan Gustavson, MIT). */
export const SIMPLEX_NOISE = /* glsl */ `
vec3 mod289(vec3 x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 mod289(vec4 x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 permute(vec4 x){return mod289(((x*34.0)+1.0)*x);}
vec4 taylorInvSqrt(vec4 r){return 1.79284291400159-0.85373472095314*r;}
float snoise(vec3 v){
  const vec2 C=vec2(1.0/6.0,1.0/3.0); const vec4 D=vec4(0.0,0.5,1.0,2.0);
  vec3 i=floor(v+dot(v,C.yyy)); vec3 x0=v-i+dot(i,C.xxx);
  vec3 g=step(x0.yzx,x0.xyz); vec3 l=1.0-g; vec3 i1=min(g.xyz,l.zxy); vec3 i2=max(g.xyz,l.zxy);
  vec3 x1=x0-i1+C.xxx; vec3 x2=x0-i2+C.yyy; vec3 x3=x0-D.yyy;
  i=mod289(i);
  vec4 p=permute(permute(permute(i.z+vec4(0.0,i1.z,i2.z,1.0))+i.y+vec4(0.0,i1.y,i2.y,1.0))+i.x+vec4(0.0,i1.x,i2.x,1.0));
  float n_=0.142857142857; vec3 ns=n_*D.wyz-D.xzx;
  vec4 j=p-49.0*floor(p*ns.z*ns.z);
  vec4 x_=floor(j*ns.z); vec4 y_=floor(j-7.0*x_);
  vec4 x=x_*ns.x+ns.yyyy; vec4 y=y_*ns.x+ns.yyyy; vec4 h=1.0-abs(x)-abs(y);
  vec4 b0=vec4(x.xy,y.xy); vec4 b1=vec4(x.zw,y.zw);
  vec4 s0=floor(b0)*2.0+1.0; vec4 s1=floor(b1)*2.0+1.0; vec4 sh=-step(h,vec4(0.0));
  vec4 a0=b0.xzyw+s0.xzyw*sh.xxyy; vec4 a1=b1.xzyw+s1.xzyw*sh.zzww;
  vec3 p0=vec3(a0.xy,h.x); vec3 p1=vec3(a0.zw,h.y); vec3 p2=vec3(a1.xy,h.z); vec3 p3=vec3(a1.zw,h.w);
  vec4 norm=taylorInvSqrt(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3)));
  p0*=norm.x;p1*=norm.y;p2*=norm.z;p3*=norm.w;
  vec4 m=max(0.6-vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)),0.0); m=m*m;
  return 42.0*dot(m*m,vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3)));
}`;

/**
 * Material «gota líquida»: la esfera se deforma con ruido simplex y se tiñe con un
 * degradado iridiscente (cian → violeta → rosa) según el desplazamiento y el fresnel.
 */
export function createLiquidMaterial({ amplitude = 0.38, speed = 1 } = {}) {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: {
      uTime: { value: 0 },
      uAmp: { value: amplitude },
      uSpeed: { value: speed },
      uA: { value: new THREE.Color(PALETTE.cyan) },
      uB: { value: new THREE.Color(PALETTE.violet) },
      uC: { value: new THREE.Color(PALETTE.pink) },
    },
    vertexShader: /* glsl */ `
      uniform float uTime; uniform float uAmp; uniform float uSpeed;
      varying vec3 vN; varying vec3 vView; varying float vDisp;
      ${SIMPLEX_NOISE}
      float disp(vec3 p){
        float t = uTime * uSpeed;
        return snoise(p * 1.1 + t * 0.22) * 0.55 + snoise(p * 2.3 - t * 0.31) * 0.22;
      }
      vec3 displaced(vec3 p){ return p + normalize(p) * disp(p) * uAmp; }
      void main(){
        vec3 n0 = normalize(position);
        vec3 t = normalize(cross(n0, abs(n0.y) < 0.99 ? vec3(0.,1.,0.) : vec3(1.,0.,0.)));
        vec3 b = cross(n0, t);
        float e = 0.02;
        vec3 p0 = displaced(n0);
        vec3 p1 = displaced(normalize(n0 + t * e));
        vec3 p2 = displaced(normalize(n0 + b * e));
        vDisp = disp(n0);
        vN = normalize(normalMatrix * normalize(cross(p1 - p0, p2 - p0)));
        vec4 mv = modelViewMatrix * vec4(p0, 1.0);
        vView = -mv.xyz;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uA; uniform vec3 uB; uniform vec3 uC;
      varying vec3 vN; varying vec3 vView; varying float vDisp;
      void main(){
        vec3 N = normalize(vN); vec3 V = normalize(vView);
        float fres = pow(1.0 - max(dot(N, V), 0.0), 2.4);
        float t = vDisp * 0.9 + 0.5;
        vec3 base = mix(uA, uB, smoothstep(0.0, 0.7, t));
        base = mix(base, uC, smoothstep(0.55, 1.0, t + fres * 0.35));
        vec3 L = normalize(vec3(0.5, 0.8, 0.6));
        float diff = max(dot(N, L), 0.0);
        vec3 H = normalize(L + V);
        float spec = pow(max(dot(N, H), 0.0), 70.0);
        vec3 col = base * (0.32 + 0.8 * diff) + fres * uC * 0.85 + spec * vec3(1.0);
        gl_FragColor = vec4(col, 0.72 + 0.25 * fres);
        #include <colorspace_fragment>
      }`,
  });
}

/** Mide el tamaño en CSS píxeles de un canvas y actualiza renderer/cámara. */
export function fitRenderer(renderer, camera, width, height) {
  renderer.setSize(width, height, false);
  camera.aspect = width / Math.max(height, 1);
  camera.updateProjectionMatrix();
}

/** Reloj mínimo (THREE.Clock está obsoleto). */
export class SimpleClock {
  constructor() { this.last = performance.now(); this.elapsedTime = 0; }
  getDelta() {
    const now = performance.now();
    const dt = (now - this.last) / 1000;
    this.last = now;
    this.elapsedTime += dt;
    return dt;
  }
}

export function disposeObject(root) {
  root.traverse((obj) => {
    if (obj.geometry) obj.geometry.dispose();
    if (obj.material) [].concat(obj.material).forEach((m) => m.dispose());
  });
}
