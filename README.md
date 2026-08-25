# NBC 3D Ledkolom Preview

Maakt van een LED-kolomvideo een deelbare 3D-preview: de klant opent een link,
ziet de kolom in 3D en kan hem ronddraaien.

Alles gebeurt online, in deze repository. Je hoeft niets te installeren en er
hoeft niets op een eigen computer te draaien.

**Overzicht van alle previews:** https://marketing-nbc.github.io/NBC-3D-ledkolom-Preview/

---

## Een nieuwe preview maken

1. Ga naar de map [`docs/p/`](../../tree/main/docs/p) in deze repository.
2. Klik **Add file → Upload files** en sleep de mp4 erin.
3. Klik **Commit changes**.
4. Wacht ongeveer een minuut. Onder het tabblad **Actions** zie je de voortgang.
5. Klaar. De link staat in het overzicht en onderaan het Actions-logboek.

De bestandsnaam wordt de naam op het startscherm en bepaalt de link:

| Bestand dat je uploadt        | Wordt                                             |
| ----------------------------- | ------------------------------------------------- |
| `Deloitte - 25 aug.mp4`       | `.../p/deloitte-25-aug/`, startscherm "Deloitte - 25 aug" |
| `Brookz_27 aug - trim.mp4`    | `.../p/brookz-27-aug/`, startscherm "Brookz 27 aug"       |

Onderstrepingstekens worden spaties en een `- trim` achter de naam gaat eraf,
zodat je exports rechtstreeks kunt uploaden.

Upload je een video met dezelfde naam nog een keer, dan wordt diezelfde preview
bijgewerkt en blijft de link werken. Handig als er een nieuwe versie komt nadat
je de link al hebt verstuurd.

### Video's groter dan 25 MB

De upload-knop op github.com gaat tot 25 MB. Is je bronvideo groter, dan is dit
de weg eromheen:

1. Ga naar **Releases** (rechterkolom op de voorpagina) → **Draft a new release**.
2. Geef hem een tag, bijvoorbeeld `bronvideos`, en sleep de mp4 bij **Attach binaries**. Hier mag een bestand tot 2 GB zijn.
3. Publiceer de release en kopieer de link van het bestand (rechtermuisknop → linkadres kopiëren).
4. Ga naar **Actions → Preview bouwen en publiceren → Run workflow**.
5. Plak de link bij *video_url*, vul bij *naam* de gewenste naam in en start.

Het bronbestand blijft dan in de release staan en komt niet in de repository
terecht.

## Wat er onder water gebeurt

De workflow [`publiceer-preview.yml`](.github/workflows/publiceer-preview.yml)
draait `tools/build.mjs`, en dat script:

1. leest breedte, hoogte en duur van de video met `ffprobe`;
2. controleert of het echt een kolomvideo is — vier zijden naast elkaar, dus
   hoog en smal. Klopt de verhouding niet, dan stopt hij met een melding in
   plaats van er een platgeslagen kolom van te maken;
3. comprimeert de video in twee passes naar het budget uit `config.json`
   (standaard 10,5 MB), zodat de preview ook op 4G vlot laadt;
4. zet er een preview-pagina naast en werkt de overzichtspagina bij;
5. gooit het geüploade bronbestand weg, zodat de repository klein blijft;
6. publiceert `docs/` naar GitHub Pages.

De verhouding van de kolom wordt niet in de pagina gebakken maar in de browser
uit de video zelf gelezen. Een andere `kolom.mp4` in een bestaande map zetten is
dus genoeg om die preview te vervangen.

## Instellingen

Alles staat in [`config.json`](config.json):

| Sleutel          | Standaard | Betekenis                                                        |
| ---------------- | --------- | ---------------------------------------------------------------- |
| `videoBudgetMB`  | `10.5`    | Doelgrootte van de gecomprimeerde video.                          |
| `fps`            | `24`      | Beelden per seconde na compressie.                                |
| `preset`         | `medium`  | x264-preset. `slow` geeft iets betere kwaliteit, duurt langer.    |
| `maxDurationSec` | `60`      | Langere video's worden afgekapt. `0` zet dat uit.                 |
| `minFaceAspect`  | `3.0`     | Ondergrens voor de controle hierboven.                            |
| `forceAll`       | `false`   | Op `true` slaat die controle over.                                |
| `showName`       | `true`    | Naam op het startscherm tonen.                                    |

## Een preview weghalen

Verwijder de map onder `docs/p/` via github.com. De overzichtspagina wordt bij
de eerstvolgende workflow automatisch bijgewerkt. Doe dit met previews van
afgelopen evenementen: elke preview kost ongeveer 10 MB en die tellen op.

## Opbouw van de repository

```
docs/                     wat er op GitHub Pages komt te staan
  index.html              overzichtspagina (wordt gegenereerd)
  assets/
    viewer.js             de 3D-kolom
    nbc.css               huisstijl
    vendor/three/         three.js, meegeleverd zodat er geen CDN nodig is
  p/<naam>/               één preview: kolom.mp4 + index.html + meta.json
tools/
  build.mjs               comprimeert en genereert de pagina's
  template-preview.html   sjabloon voor één preview
  template-index.html     sjabloon voor het overzicht
config.json               de instellingen hierboven
legacy/                   de oude Netlify-versie, zie hieronder
```

## De oude versie

In [`legacy/`](legacy/) staat de Windows-versie waarmee dit begon: een
PowerShell-script dat je met drag-and-drop op `Maak 3D preview.cmd` aanriep,
lokaal ffmpeg gebruikte en naar Netlify uploadde. Die staat er alleen als
naslag; hij wordt niet meer gebruikt.

Twee dingen zijn daarbij bewust niet meegekomen:

- **`tools/netlify-token.txt`** — een Netlify-token hoort niet in een
  repository. Deze opzet gebruikt het token dat GitHub Actions zelf uitdeelt,
  dus er hoeft nergens een sleutel te worden bewaard.
- **`ffmpeg.exe` en `ffprobe.exe`** — die stonden in `tools/`, waren samen
  bijna 200 MB en hebben een eigen licentie. GitHub Actions heeft ffmpeg al aan
  boord.

`legacy/deployed-sites.json` bewaart welke Netlify-site bij welk project hoorde.
Zolang die sites nog bestaan blijven de oude links werken; nieuwe previews lopen
via GitHub Pages.
