#!/usr/bin/env node
/*
  Meldt de designaanvraag-tool welke ledkolommen uit een oplevering online
  staan, of waarom het niet lukte. Draait als laatste stap van "Preview bouwen
  en publiceren", ook als een eerdere stap faalde.

  Een preview geldt pas als klaar als hij ook echt gepubliceerd is: de
  designaanvraag verstuurt daarna meteen de opleveringsmail met de link, en
  die moet dan werken. Is het publiceren mislukt (of overgeslagen omdat een
  eerdere stap faalde), dan melden we hem als mislukt.

    AANVRAAG_UITSLAG        het bestand dat tools/build.mjs schreef
    GEPUBLICEERD            de uitkomst van de publiceerstap ("success" of iets anders)
    DESIGNAANVRAAG_URL      de function ledkolom-preview
    DESIGNAANVRAAG_SECRET   het gedeelde geheim
    RUN_URL                 de link naar deze run, voor in de foutmelding
*/
import fs from 'node:fs';

const bestand = process.env.AANVRAAG_UITSLAG;
if (!bestand || !fs.existsSync(bestand)) {
  console.log('Geen ledkolommen uit de designaanvraag in deze run.');
  process.exit(0);
}

const basis  = process.env.DESIGNAANVRAAG_URL;
const geheim = process.env.DESIGNAANVRAAG_SECRET;
if (!basis || !geheim) {
  console.error('::error::DESIGNAANVRAAG_URL of DESIGNAANVRAAG_SECRET ontbreekt; de designaanvraag hoort niet dat zijn previews klaar zijn.');
  process.exit(1);
}

const gepubliceerd = process.env.GEPUBLICEERD === 'success';
const uitslagen = JSON.parse(fs.readFileSync(bestand, 'utf8')).map((u) =>
  u.status === 'klaar' && !gepubliceerd
    ? {
        ...u,
        status: 'mislukt',
        fout: 'De preview is gemaakt, maar het publiceren naar GitHub Pages mislukte.'
          + (process.env.RUN_URL ? ` Zie ${process.env.RUN_URL}` : ''),
      }
    : u
);

for (const u of uitslagen) console.log(`- ${u.id}: ${u.status}${u.fout ? ` (${u.fout})` : ''}`);

let laatsteFout = '';
for (let poging = 1; poging <= 4; poging++) {
  try {
    const res = await fetch(basis, {
      method: 'POST',
      headers: { Authorization: `Bearer ${geheim}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ uitslagen }),
      signal: AbortSignal.timeout(30_000),
    });
    const tekst = await res.text();
    if (res.ok) {
      console.log(`Gemeld: ${tekst}`);
      process.exit(0);
    }
    laatsteFout = `${res.status}: ${tekst.slice(0, 200)}`;
    // een verkeerd geheim of een onleesbare melding wordt niet beter van opnieuw proberen
    if (res.status < 500) break;
  } catch (e) {
    laatsteFout = e.message;
  }
  await new Promise((r) => setTimeout(r, poging * 3000));
}
console.error(`::error::Melden bij de designaanvraag mislukt (${laatsteFout}).`);
process.exit(1);
