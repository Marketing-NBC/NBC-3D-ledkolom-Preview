/*
  NBC Events - 3D ledkolom viewer
  ------------------------------------------------------------------
  Toont een LED-kolomvideo (4 zijden naast elkaar, geluidloos) als
  draaibare 3D-kolom.

  De verhouding van de kolom wordt op het moment van afspelen uit de
  video zelf gelezen (videoWidth / videoHeight), dus er hoeft niets
  vooraf te worden uitgerekend of in de pagina gebakken. Een andere
  video in dezelfde map neerzetten is genoeg.

  Staat er een foto.jpg naast (de kolom in de NBC-foyer, gemaakt door
  tools/foto.mjs), dan komt die rechts in beeld met een schuif ertussen.
  Helemaal naar rechts is alleen de 3D-kolom, helemaal naar links alleen
  de foto. Zodra de video loopt, speelt die ook op de kolommen van de
  foto: assets/foyer/kolommen.json zegt waar die staan. Tot dan, of als
  dat niet lukt, blijft de still uit foto.jpg staan.
*/
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const canvas  = document.getElementById('c');
const startEl = document.getElementById('start');
const spinBtn = document.getElementById('spin');

// videobron: ?v= wint (handig om even een andere video te bekijken),
// anders het data-attribuut op de canvas, anders kolom.mp4 ernaast
const params    = new URLSearchParams(location.search);
const VIDEO_SRC = params.get('v') || canvas.dataset.video || 'kolom.mp4';

// een echte ledkolom is smal en hoog; hieronder klopt er meestal iets niet
const MIN_FACE_ASPECT = 3.0;

let renderer, scene, camera, orbit, video, column;
let webglReady = false, built = false, spin = true, faceRatio = 4;

// ---- 1. klikafhandeling eerst, zodat de knop altijd reageert -------
function fail(kop, uitleg){
  startEl.innerHTML =
    '<div class="projname">' + kop + '</div>' +
    '<div class="play" style="cursor:default"><span>' + uitleg + '</span></div>' +
    '<div class="brand">NBC EVENTS · RUIMTE VOOR MAGIE</div>';
  startEl.style.cursor = 'default';
}

function begin(){
  if (!webglReady) {
    fail('3D-preview', 'Open deze link in Safari, Chrome of Edge');
    return;
  }
  startEl.style.display = 'none';
  video.play().catch(() => {});
  gestart = true;
  toonFoto();
}
startEl.addEventListener('click', begin);
startEl.addEventListener('touchend', (e) => { e.preventDefault(); begin(); });

// ---- 2. scene opzetten ---------------------------------------------
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  scene  = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(35, 1, 0.1, 200);
  camera.position.set(3.2, 0.5, 8);

  orbit = new OrbitControls(camera, renderer.domElement);
  orbit.enableDamping = true;
  orbit.target.set(0, 0, 0);

  video = document.createElement('video');
  video.loop = true;
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  video.setAttribute('playsinline', '');
  video.setAttribute('webkit-playsinline', '');
  video.addEventListener('loadedmetadata', buildColumn);
  video.addEventListener('error', () => {
    fail('Video niet gevonden', 'Er staat geen kolom.mp4 naast deze pagina');
  });
  video.src = VIDEO_SRC;

  webglReady = true;
} catch (e) {
  console.warn('WebGL niet beschikbaar:', e && e.message);
  // begin() toont de melding zodra er geklikt wordt
}

// ---- 3. kolom bouwen zodra de afmetingen bekend zijn ----------------
function buildColumn(){
  if (built || !webglReady) return;
  built = true;

  const vw = video.videoWidth, vh = video.videoHeight;
  if (!vw || !vh) { fail('Video onleesbaar', 'Kon de afmetingen niet bepalen'); return; }

  // vier zijden naast elkaar: elke zijde is een kwart van de breedte
  faceRatio = vh / (vw / 4);
  if (faceRatio < MIN_FACE_ASPECT) {
    console.warn(
      'Zijde-verhouding ' + faceRatio.toFixed(2) + ' is laag voor een ledkolom. ' +
      'Klopt het dat de vier zijden naast elkaar staan?'
    );
  }

  const W = 1, D = 1, H = faceRatio;

  const tex = new THREE.VideoTexture(video);
  tex.colorSpace = THREE.SRGBColorSpace;

  // per zijde een kwart van de textuur toewijzen
  const geo = new THREE.BoxGeometry(W, H, D);
  const uv  = geo.attributes.uv;
  function strip(faceIndex, uMin, uMax){
    const o = faceIndex * 4;
    for (let k = 0; k < 4; k++){
      const u = uv.getX(o + k);
      uv.setX(o + k, uMin + u * (uMax - uMin));
    }
  }
  strip(4, 0.00, 0.25);  // +Z  zijde 1
  strip(0, 0.25, 0.50);  // +X  zijde 2
  strip(5, 0.50, 0.75);  // -Z  zijde 3
  strip(1, 0.75, 1.00);  // -X  zijde 4
  uv.needsUpdate = true;

  const sideMat = new THREE.MeshBasicMaterial({ map: tex });
  const capMat  = new THREE.MeshBasicMaterial({ color: 0x0c1722 });
  column = new THREE.Mesh(geo, [sideMat, sideMat, capMat, capMat, sideMat, sideMat]);
  scene.add(column);

  column.add(new THREE.LineSegments(
    new THREE.EdgesGeometry(geo),
    new THREE.LineBasicMaterial({ color: 0xC7A24A, transparent: true, opacity: 0.28 })
  ));

  const floor = new THREE.Mesh(
    new THREE.CircleGeometry(Math.max(2.4, H * 0.6), 48),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.30 })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -H / 2 - 0.02;
  scene.add(floor);

  orbit.minDistance = H * 0.9;
  orbit.maxDistance = H * 6;

  frame();
  maakBeweging();

  if (spinBtn) {
    spinBtn.onclick = () => {
      spin = !spin;
      spinBtn.textContent = 'Auto-draaien: ' + (spin ? 'aan' : 'uit');
    };
    orbit.addEventListener('start', () => {
      spin = false;
      spinBtn.textContent = 'Auto-draaien: uit';
    });
  }

  loop();
}

// camera zo zetten dat de hele kolom in beeld past, ook staand op mobiel
function frame(){
  if (!webglReady) { verdeel(); return; }

  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();

  if (column) {
    const vFov = camera.fov * Math.PI / 180;
    let dist = (faceRatio * 0.62) / Math.tan(vFov / 2);   // hoogte passend maken
    if (camera.aspect < 1) dist *= 1 + (1 - camera.aspect) * 0.30;  // staand: iets ruimer

    const dir = new THREE.Vector3(0.37, 0.06, 0.93).normalize();
    camera.position.copy(dir.multiplyScalar(dist));
    orbit.update();
  }
  verdeel();
}
addEventListener('resize', frame);

function loop(){
  requestAnimationFrame(loop);
  if (spin && column) column.rotation.y += 0.005;
  orbit.update();

  const W = innerWidth, H = innerHeight, px = Math.round(deel * W);
  zetBeweging();
  renderer.setScissorTest(true);
  if (px > 0) {
    renderer.setViewport(0, 0, W, H);
    renderer.setScissor(0, 0, px, H);
    renderer.render(scene, camera);
  }
  if (beweegt && px < W) {
    // de foto beslaat het hele vlak uit verdeel(); alleen het stuk rechts
    // van de schuif wordt getekend (three telt van onderen)
    renderer.setViewport(fotoVlak.links, H - fotoVlak.top - fotoVlak.bh, fotoVlak.bw, fotoVlak.bh);
    renderer.setScissor(px, 0, W - px, H);
    renderer.render(fotoScene, fotoCam);
  }
}

// ---- 4. foto op locatie, met een schuif ernaast ---------------------
const fotoEl   = document.getElementById('foto');
const fotoImg  = fotoEl && fotoEl.querySelector('img');
const schuifEl = document.getElementById('schuif');

// waar de middelste kolom op de foto staat, als deel van de breedte; daar
// blijft de foto op gericht als er maar een stuk van in beeld is
const FOTO_FOCUS = 0.477;
// past de foto niet in de hoogte, dan gaat er vooral van de onderkant af:
// de kap van de kolom blijft dan in beeld
const FOTO_BOVEN = 0.2;
// smaller dan dit is er geen plek voor de knop en de uitleg naast het logo
const SMAL_PX = 340;
// na het starten schuift de foto vanzelf tot hier in beeld
const BEGIN_DEEL = 0.5;

let deel = 1;          // deel van de breedte voor de 3D-kolom: 1 = alleen 3D, 0 = alleen foto
let fotoKlaar = false, gestart = false, getoond = false, animatie = 0;
let fotoVlak = { links: 0, top: 0, bw: 1, bh: 1 };   // waar de foto staat, in CSS-pixels
// bewegend beeld op de foto, zie onder 5.
const RAND = 1;     // zoals in tools/foto.mjs: buitenranden 1 pixel ruimer
let fotoScene = null, fotoCam = null, beweegt = false, kolommen = null, mislukt = false;

function geenFoto(){
  if (fotoEl) fotoEl.remove();
  if (schuifEl) schuifEl.remove();
  fotoKlaar = false;
  zet(1);
}

if (fotoImg && schuifEl && !params.get('v')) {
  // een andere video via ?v= hoort niet bij deze foto
  const geladen = () => { fotoKlaar = true; toonFoto(); maakBeweging(); };
  if (fotoImg.complete) {
    // al klaar voordat dit script draaide, gelukt of niet
    if (fotoImg.naturalWidth) geladen(); else geenFoto();
  } else {
    fotoImg.addEventListener('load', geladen);
    fotoImg.addEventListener('error', geenFoto);
  }
} else {
  geenFoto();
}

function toonFoto(){
  if (!fotoKlaar || !gestart || getoond) return;
  getoond = true;
  fotoEl.hidden = false;
  schuifEl.hidden = false;
  document.body.classList.add('met-foto');
  verdeel();
  // eerst even de kolom, dan schuift de foto erbij: zo ziet men dat het kan
  setTimeout(() => schuifNaar(BEGIN_DEEL), 700);
}

function zet(d){
  deel = Math.min(1, Math.max(0, d));
  verdeel();
}

function verdeel(){
  const W = innerWidth, H = innerHeight;
  const px = Math.round(deel * W);
  const root = document.documentElement.style;
  root.setProperty('--split', px + 'px');
  root.setProperty('--rest', (W - px) + 'px');
  document.body.classList.toggle('smal', px < SMAL_PX);
  document.body.classList.toggle('smalfoto', W - px < 200);
  if (schuifEl) schuifEl.setAttribute('aria-valuenow', String(Math.round(deel * 100)));

  if (fotoKlaar) {
    // schermvullend, en zo verschoven dat de middelste kolom midden in het
    // zichtbare stuk staat, zonder dat er een lege rand ontstaat
    const iw = fotoImg.naturalWidth, ih = fotoImg.naturalHeight;
    const s  = Math.max(W / iw, H / ih);
    const bw = iw * s, bh = ih * s;
    const gewenst = px + (W - px) / 2 - FOTO_FOCUS * bw;
    const links   = Math.min(px, Math.max(W - bw, gewenst));
    const top     = (H - bh) * FOTO_BOVEN;
    fotoImg.style.width  = bw + 'px';
    fotoImg.style.height = bh + 'px';
    fotoImg.style.left   = links + 'px';
    fotoImg.style.top    = top + 'px';
    fotoVlak = { links, top, bw, bh };
    // hoeveel fotopixels er op één schermpixel vallen, voor de bemonstering
    if (fotoScene) fotoScene.userData.stap.value = iw / (bw * renderer.getPixelRatio());
  }

  // de kolom in het midden van zijn eigen stuk scherm houden
  if (webglReady) camera.setViewOffset(W, H, (W - px) / 2, 0, W, H);
}

function schuifNaar(doel){
  cancelAnimationFrame(animatie);
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) { zet(doel); return; }
  const van = deel, start = performance.now(), duur = 900;
  const stap = (nu) => {
    const t = Math.min(1, (nu - start) / duur);
    zet(van + (doel - van) * (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2));
    if (t < 1) animatie = requestAnimationFrame(stap);
  };
  animatie = requestAnimationFrame(stap);
}

if (schuifEl) {
  schuifEl.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    cancelAnimationFrame(animatie);
    schuifEl.setPointerCapture(e.pointerId);
    schuifEl.classList.add('sleept');
  });
  schuifEl.addEventListener('pointermove', (e) => {
    if (schuifEl.hasPointerCapture(e.pointerId)) zet(e.clientX / innerWidth);
  });
  const los = (e) => {
    if (!schuifEl.hasPointerCapture(e.pointerId)) return;
    schuifEl.releasePointerCapture(e.pointerId);
    schuifEl.classList.remove('sleept');
    // vlak bij de rand: helemaal 3D of helemaal foto
    if (deel < 0.04) zet(0);
    if (deel > 0.96) zet(1);
  };
  schuifEl.addEventListener('pointerup', los);
  schuifEl.addEventListener('pointercancel', los);
  schuifEl.addEventListener('keydown', (e) => {
    const stappen = { ArrowLeft: -0.05, ArrowDown: -0.05, ArrowRight: 0.05, ArrowUp: 0.05 };
    if (e.key in stappen) zet(deel + stappen[e.key]);
    else if (e.key === 'Home') zet(0);
    else if (e.key === 'End') zet(1);
    else return;
    cancelAnimationFrame(animatie);
    e.preventDefault();
  });
}

// ---- 5. de video ook op de kolommen van de foto ---------------------
// Eén vlak ter grootte van de foto, met een shader die per pixel uitrekent
// op welke zijde van welke kolom hij valt en daar de video bemonstert. Het
// rekenwerk is hetzelfde als in tools/foto.mjs, dat de still maakt.

if (fotoImg && webglReady && !params.get('v')) {
  fetch('../../assets/foyer/kolommen.json')
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status))))
    .then((data) => { kolommen = data; maakBeweging(); })
    .catch((e) => console.warn('Geen bewegend beeld op de foto:', e.message));
}

// homografie van het eenheidsvierkant naar vier hoekpunten, en terug
function vierkantNaarVierhoek([[x0, y0], [x1, y1], [x2, y2], [x3, y3]]){
  const sx = x0 - x1 + x2 - x3, sy = y0 - y1 + y2 - y3;
  const dx1 = x1 - x2, dx2 = x3 - x2, dy1 = y1 - y2, dy2 = y3 - y2;
  const den = dx1 * dy2 - dx2 * dy1;
  const g = (sx * dy2 - dx2 * sy) / den;
  const h = (dx1 * sy - sx * dy1) / den;
  return [x1 - x0 + g * x1, x3 - x0 + h * x3, x0, y1 - y0 + g * y1, y3 - y0 + h * y3, y0, g, h, 1];
}

function inverteer([a, b, c, d, e, f, g, h, i]){
  const A = e * i - f * h, B = f * g - d * i, C = d * h - e * g;
  const det = a * A + b * B + c * C;
  return [
    A / det, (c * h - b * i) / det, (b * f - c * e) / det,
    B / det, (a * i - c * g) / det, (c * d - a * f) / det,
    C / det, (b * g - a * h) / det, (a * e - b * d) / det,
  ];
}

// waar de video komt: de zijden van de kolommen, min wat ervoor staat
function maakMasker(fw, fh){
  const c = document.createElement('canvas');
  c.width = fw; c.height = fh;
  const g = c.getContext('2d');
  const pad = (punten) => {
    g.beginPath();
    punten.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
    g.closePath();
  };
  g.fillStyle = g.strokeStyle = '#fff';
  g.lineWidth = 2 * RAND;
  g.lineJoin = 'miter';
  for (const kolom of kolommen.kolommen) {
    for (const vl of kolom.vlakken) { pad(vl.hoeken); g.fill(); g.stroke(); }
  }
  g.globalCompositeOperation = 'destination-out';
  for (const kolom of kolommen.kolommen) {
    for (const poly of kolom.ervoor) { pad(poly); g.fill(); }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.NoColorSpace;
  return tex;
}

function maakBeweging(){
  if (fotoScene || mislukt || !kolommen || !fotoKlaar || !webglReady || !column) return;

  const fw = fotoImg.naturalWidth, fh = fotoImg.naturalHeight;
  const inv = [], kader = [], vlak = [];
  for (const kolom of kolommen.kolommen) {
    for (const vl of kolom.vlakken) {
      const [a, b, c, d] = vl.hoeken;
      const breed = (Math.hypot(b[0] - a[0], b[1] - a[1]) + Math.hypot(c[0] - d[0], c[1] - d[1])) / 2;
      const hoog  = (Math.hypot(d[0] - a[0], d[1] - a[1]) + Math.hypot(c[0] - b[0], c[1] - b[1])) / 2;
      const m = inverteer(vierkantNaarVierhoek(vl.hoeken));
      inv.push(new THREE.Matrix3().set(...m));
      const xs = vl.hoeken.map((p) => p[0]), ys = vl.hoeken.map((p) => p[1]);
      const r = RAND + 1;
      kader.push(new THREE.Vector4(Math.min(...xs) - r, Math.min(...ys) - r, Math.max(...xs) + r, Math.max(...ys) + r));
      vlak.push(new THREE.Vector3((vl.zijde - 1) / 4, RAND / breed, RAND / hoog));
    }
  }

  // los ingeladen in plaats van het img-element: dat heeft CSS-maten, en de
  // browser heeft hem toch al in de cache
  const fotoTex = new THREE.TextureLoader().load(fotoImg.currentSrc || fotoImg.src);
  fotoTex.colorSpace = THREE.SRGBColorSpace;

  const stap = { value: 1 };
  const mat = new THREE.ShaderMaterial({
    defines: { VLAKKEN: inv.length },
    uniforms: {
      foto:   { value: fotoTex },
      masker: { value: maakMasker(fw, fh) },
      video:  { value: column.material[0].map },
      inv:    { value: inv },
      kader:  { value: kader },
      vlak:   { value: vlak },
      maat:   { value: new THREE.Vector2(fw, fh) },
      stap,
    },
    vertexShader: `
      varying vec2 vUv;
      void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
    fragmentShader: `
      uniform sampler2D foto, masker, video;
      uniform mat3 inv[VLAKKEN];
      uniform vec4 kader[VLAKKEN];   // omhullende per zijde, in fotopixels
      uniform vec3 vlak[VLAKKEN];    // begin van de zijde in de video, extra rand in u en v
      uniform vec2 maat;             // fotobreedte en -hoogte
      uniform float stap;            // fotopixels per schermpixel
      varying vec2 vUv;

      // eerst precies binnen een zijde, daarna in de extra rand: zo blijft
      // de naad tussen twee zijden op zijn plek
      // three slaat videotexturen zonder sRGB-omzetting op; dat doen we hier,
      // net als MeshBasicMaterial bij de 3D-kolom
      vec3 lineair(vec3 c){
        return mix(pow(c * 0.9478672986 + vec3(0.0521327014), vec3(2.4)), c * 0.0773993808,
                   vec3(lessThanEqual(c, vec3(0.04045))));
      }

      bool zoek(vec2 p, float ruim, out vec2 tc){
        for (int i = 0; i < VLAKKEN; i++) {
          vec4 k = kader[i];
          if (p.x < k.x || p.y < k.y || p.x > k.z || p.y > k.w) continue;
          vec3 q = inv[i] * vec3(p, 1.0);
          vec2 uv = q.xy / q.z;
          vec2 m = ruim * vlak[i].yz;
          if (uv.x < -m.x || uv.x > 1.0 + m.x || uv.y < -m.y || uv.y > 1.0 + m.y) continue;
          uv = clamp(uv, 0.0, 1.0);
          tc = vec2(vlak[i].x + uv.x * 0.25, 1.0 - uv.y);
          return true;
        }
        return false;
      }

      void main(){
        vec4 basis = texture2D(foto, vUv);
        float dekking = texture2D(masker, vUv).a;
        gl_FragColor = basis;
        if (dekking > 0.002) {
          // 3x3 punten per schermpixel: de video is hier flink verkleind
          vec2 p = vec2(vUv.x, 1.0 - vUv.y) * maat;
          vec3 som = vec3(0.0);
          float n = 0.0;
          for (int sy = -1; sy <= 1; sy++) {
            for (int sx = -1; sx <= 1; sx++) {
              vec2 tc;
              vec2 q = p + vec2(float(sx), float(sy)) * stap / 3.0;
              if (zoek(q, 0.0, tc) || zoek(q, 1.0, tc)) { som += lineair(texture2D(video, tc).rgb); n += 1.0; }
            }
          }
          if (n > 0.0) gl_FragColor = vec4(mix(basis.rgb, som / n, dekking), 1.0);
        }
        #include <colorspace_fragment>
      }`,
    depthTest: false,
    depthWrite: false,
  });

  fotoScene = new THREE.Scene();
  fotoScene.userData.stap = stap;
  fotoScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat));
  fotoCam = new THREE.Camera();

  // lukt de shader niet, dan blijft gewoon de still staan
  renderer.debug.onShaderError = () => { mislukt = true; beweegt = false; zetBeweging(); };
  renderer.compile(fotoScene, fotoCam);
  verdeel();
}

// pas bewegen als er echt videobeeld is; tot die tijd de still uit foto.jpg
function zetBeweging(){
  const nu = Boolean(fotoScene && !mislukt && getoond && video.readyState >= 2);
  if (nu === beweegt) return;
  beweegt = nu;
  document.body.classList.toggle('beweegt', beweegt);
}
