import { webglAvailable } from './common.js';

/**
 * Punto de entrada 3D. Si WebGL no está disponible o algo falla, la interfaz 2D
 * (SVG) sigue funcionando sin cambios.
 */
async function boot() {
  if (!webglAvailable()) return;
  const root = document.documentElement;

  try {
    const { initBackground } = await import('./background.js');
    initBackground(document.getElementById('bg3d'));
    root.classList.add('webgl-on');
  } catch (error) {
    console.warn('Fondo 3D no disponible:', error);
  }

  try {
    const canvas = document.getElementById('globeCanvas');
    if (!canvas) return;
    const { initGlobe } = await import('./globe.js');
    const stage = canvas.closest('.globe-stage');
    let globe = null;
    const apply = (detail) => globe && detail && globe.setData(detail.countrySales);
    // Los datos pueden llegar antes o después de que el globo termine de cargar.
    document.addEventListener('rf:data', (event) => apply(event.detail));
    globe = await initGlobe({
      canvas, tip: document.getElementById('globeTip'), count: document.getElementById('globeCount'),
      geo: window.__rfGeo || {},
    });
    stage.classList.add('ready');
    apply(window.__rfLastData);
  } catch (error) {
    console.warn('Globo 3D no disponible:', error);
    document.querySelector('.globe-panel')?.setAttribute('hidden', '');
  }
}

boot();
