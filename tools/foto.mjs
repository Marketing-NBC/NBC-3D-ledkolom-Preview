/*
  NBC Events - ledkolom in de foyer-foto zetten
  ------------------------------------------------------------------
  Pakt een still uit kolom.mp4 en plakt die in perspectief op de
  ledkolommen van docs/assets/foyer/nbc-foyer.jpg. Waar de kolommen
  precies staan, staat in docs/assets/foyer/kolommen.json. Dat bestand
  leest de viewer ook, om de video op de foto te laten bewegen.

  Geen extra pakketten nodig: ffmpeg leest en schrijft de beelden als
  ruwe RGB, het rekenwerk gebeurt hier.
*/
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const HIER     = path.dirname(fileURLToPath(import.meta.url));
const MAP      = path.join(HIER, '..', 'docs', 'assets', 'foyer');
const KOLOMMEN = JSON.parse(fs.readFileSync(path.join(MAP, 'kolommen.json'), 'utf8'));
const BRON     = path.join(MAP, KOLOMMEN.foto);

// elke pixel wordt in een raster van SUB x SUB punten bemonsterd, zodat de
// randen van de kolom en de verkleinde video netjes zacht worden
const SUB = 4;

// Zoveel pixels schuiven de buitenranden van elke kolom extra naar buiten. Zo
// blijft er langs de kap, de voet en de zijkanten geen dun randje van het
// oorspronkelijke beeld staan.
const RAND = 1;

// Verandert de foto, de maatvoering of deze code, dan verandert de versie en
// worden alle bestaande foto's bij de volgende build opnieuw gemaakt.
export const FOTO_VERSIE = crypto.createHash('sha1')
  .update(fs.readFileSync(BRON))
  .update(fs.readFileSync(path.join(MAP, 'kolommen.json')))
  .update(fs.readFileSync(fileURLToPath(import.meta.url)))
  .digest('hex').slice(0, 12);

function ffmpeg(args, input) {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', ...args], {
    input, maxBuffer: 256 * 1024 * 1024,
  });
  if (r.error) throw new Error(`ffmpeg kon niet worden gestart: ${r.error.message}`);
  if (r.status !== 0) throw new Error(`ffmpeg faalde (exit ${r.status})\n${String(r.stderr || '').trim()}`);
  return r.stdout;
}

function afmetingen(file) {
  const r = spawnSync('ffprobe', [
    '-v', 'error', '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height:format=duration', '-of', 'json', file,
  ], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`ffprobe faalde op ${file}`);
  const meta = JSON.parse(r.stdout);
  const st = meta.streams[0];
  return { w: Number(st.width), h: Number(st.height), duur: Number(meta.format.duration) || 0 };
}

function leesRgb(file, w, h, extra = []) {
  const buf = ffmpeg([...extra, '-i', file, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']);
  if (buf.length !== w * h * 3) throw new Error(`Onverwachte beeldgrootte bij ${path.basename(file)}`);
  return buf;
}

// ---------- still kiezen ---------------------------------------------

// Is er een moment opgegeven, dan wordt het dat beeld. Anders een paar
// kandidaten uit het midden van de video, en de drukste wint. Zo komt er geen
// zwart begin- of eindbeeld of een witte flits in de foto terecht.
function kiesStill(video, moment) {
  const { w, h, duur } = afmetingen(video);
  if (typeof moment === 'number') {
    // net voor het einde blijven: daar staat soms geen beeld meer
    const t = Math.min(Math.max(0, moment), Math.max(0, duur - 0.1));
    return { w, h, t, rgb: leesRgb(video, w, h, ['-ss', String(t)]) };
  }
  let beste = null;
  for (const fractie of [0.2, 0.35, 0.5, 0.65, 0.8]) {
    const t = Math.round(duur * fractie * 10) / 10;
    const rgb = leesRgb(video, w, h, ['-ss', String(t)]);
    let som = 0, kwadraat = 0;
    const n = rgb.length / 3;
    for (let i = 0; i < rgb.length; i += 3) {
      const l = 0.2126 * rgb[i] + 0.7152 * rgb[i + 1] + 0.0722 * rgb[i + 2];
      som += l; kwadraat += l * l;
    }
    const gem = som / n;
    const spreiding = Math.sqrt(Math.max(0, kwadraat / n - gem * gem));
    if (!beste || spreiding > beste.spreiding) beste = { t, rgb, spreiding };
  }
  return { w, h, t: beste.t, rgb: beste.rgb };
}

// ---------- perspectief ----------------------------------------------

// Homografie die het eenheidsvierkant (u,v) op vier hoekpunten legt
// (Heckbert, "Fundamentals of Texture Mapping", 1989), en de inverse daarvan
// om van een fotopixel terug te rekenen naar een plek in de video.
function vierkantNaarVierhoek([[x0, y0], [x1, y1], [x2, y2], [x3, y3]]) {
  const sx = x0 - x1 + x2 - x3, sy = y0 - y1 + y2 - y3;
  const dx1 = x1 - x2, dx2 = x3 - x2, dy1 = y1 - y2, dy2 = y3 - y2;
  const den = dx1 * dy2 - dx2 * dy1;
  const g = (sx * dy2 - dx2 * sy) / den;
  const h = (dx1 * sy - sx * dy1) / den;
  return [
    x1 - x0 + g * x1, x3 - x0 + h * x3, x0,
    y1 - y0 + g * y1, y3 - y0 + h * y3, y0,
    g, h, 1,
  ];
}

function inverteer([a, b, c, d, e, f, g, h, i]) {
  const A = e * i - f * h, B = f * g - d * i, C = d * h - e * g;
  const det = a * A + b * B + c * C;
  return [
    A / det, (c * h - b * i) / det, (b * f - c * e) / det,
    B / det, (a * i - c * g) / det, (c * d - a * f) / det,
    C / det, (b * g - a * h) / det, (a * e - b * d) / det,
  ];
}

function binnen(poly, x, y) {
  let in_ = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) in_ = !in_;
  }
  return in_;
}

// ---------- samenstellen ---------------------------------------------

function plak(foto, fw, fh, still) {
  const { w: vw, h: vh, rgb: vid } = still;

  function bemonster(u, v, uit) {
    // bilineair, met de rand vastgezet
    const x = Math.min(Math.max(u * vw - 0.5, 0), vw - 1.001);
    const y = Math.min(Math.max(v * vh - 0.5, 0), vh - 1.001);
    const x0 = x | 0, y0 = y | 0, fx = x - x0, fy = y - y0;
    const p = (y0 * vw + x0) * 3, q = p + vw * 3;
    for (let k = 0; k < 3; k++) {
      const boven = vid[p + k] + (vid[p + 3 + k] - vid[p + k]) * fx;
      const onder = vid[q + k] + (vid[q + 3 + k] - vid[q + k]) * fx;
      uit[k] += boven + (onder - boven) * fy;
    }
  }

  const kleur = [0, 0, 0];
  for (const kolom of KOLOMMEN.kolommen) {
    const vlakken = kolom.vlakken.map((vl) => {
      const [a, b, c, d] = vl.hoeken;
      const breed = (Math.hypot(b[0] - a[0], b[1] - a[1]) + Math.hypot(c[0] - d[0], c[1] - d[1])) / 2;
      const hoog  = (Math.hypot(d[0] - a[0], d[1] - a[1]) + Math.hypot(c[0] - b[0], c[1] - b[1])) / 2;
      return {
        inv: inverteer(vierkantNaarVierhoek(vl.hoeken)),
        u0: (vl.zijde - 1) / 4,
        eu: RAND / breed,
        ev: RAND / hoog,
      };
    });
    const xs = kolom.vlakken.flatMap((vl) => vl.hoeken.map((p) => p[0]));
    const ys = kolom.vlakken.flatMap((vl) => vl.hoeken.map((p) => p[1]));
    const xa = Math.max(0, Math.floor(Math.min(...xs) - RAND)), xb = Math.min(fw - 1, Math.ceil(Math.max(...xs) + RAND));
    const ya = Math.max(0, Math.floor(Math.min(...ys) - RAND)), yb = Math.min(fh - 1, Math.ceil(Math.max(...ys) + RAND));

    for (let py = ya; py <= yb; py++) {
      for (let px = xa; px <= xb; px++) {
        let raak = 0;
        kleur[0] = kleur[1] = kleur[2] = 0;
        for (let sy = 0; sy < SUB; sy++) {
          for (let sx = 0; sx < SUB; sx++) {
            const x = px + (sx + 0.5) / SUB, y = py + (sy + 0.5) / SUB;
            if (kolom.ervoor.some((poly) => binnen(poly, x, y))) continue;
            // eerst precies binnen een zijde zoeken, pas daarna in de extra rand,
            // zodat de naad tussen de twee zijden op zijn plek blijft
            let gevonden = false;
            for (let ruim = 0; ruim < 2 && !gevonden; ruim++) {
              for (const { inv: m, u0, eu, ev } of vlakken) {
                const z = m[6] * x + m[7] * y + m[8];
                const u = (m[0] * x + m[1] * y + m[2]) / z;
                const v = (m[3] * x + m[4] * y + m[5]) / z;
                const mu = ruim * eu, mv = ruim * ev;
                if (u < -mu || u > 1 + mu || v < -mv || v > 1 + mv) continue;
                bemonster(u0 + Math.min(Math.max(u, 0), 1) / 4, Math.min(Math.max(v, 0), 1), kleur);
                raak++;
                gevonden = true;
                break;
              }
            }
          }
        }
        if (!raak) continue;
        const dekking = raak / (SUB * SUB);
        const i = (py * fw + px) * 3;
        for (let k = 0; k < 3; k++) {
          foto[i + k] = Math.round(foto[i + k] * (1 - dekking) + (kleur[k] / raak) * dekking);
        }
      }
    }
  }
}

/**
 * Maakt `doel` (jpg): de foyer-foto met een still uit `video` op de kolommen.
 * `moment` (seconden) kiest de still zelf; zonder kiest het script er een.
 * Geeft het tijdstip van de gebruikte still terug, in seconden.
 */
export function maakFoto(video, doel, moment) {
  const { w: fw, h: fh } = afmetingen(BRON);
  const foto = leesRgb(BRON, fw, fh);
  const still = kiesStill(video, moment);
  plak(foto, fw, fh, still);
  ffmpeg([
    '-y', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', `${fw}x${fh}`, '-i', '-',
    '-frames:v', '1', '-q:v', '3', doel,
  ], foto);
  return still.t;
}
