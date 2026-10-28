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
  de foto.
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
  if (deel > 0) renderer.render(scene, camera);
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

function geenFoto(){
  if (fotoEl) fotoEl.remove();
  if (schuifEl) schuifEl.remove();
  fotoKlaar = false;
  zet(1);
}

if (fotoImg && schuifEl && !params.get('v')) {
  // een andere video via ?v= hoort niet bij deze foto
  const geladen = () => { fotoKlaar = true; toonFoto(); };
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
    fotoImg.style.width  = bw + 'px';
    fotoImg.style.height = bh + 'px';
    fotoImg.style.left   = links + 'px';
    fotoImg.style.top    = (H - bh) * FOTO_BOVEN + 'px';
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
