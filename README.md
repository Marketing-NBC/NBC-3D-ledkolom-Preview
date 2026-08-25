# NBC 3D Ledkolom Preview

Maakt van een LED-kolomvideo een deelbare 3D-preview: de klant opent een link,
ziet de kolom in 3D en kan hem ronddraaien.

Alles gebeurt online, in deze repository. Je hoeft niets te installeren en er
hoeft niets op een eigen computer te draaien.

**Overzicht van alle previews:** https://marketing-nbc.github.io/NBC-3D-ledkolom-Preview/

---

## Een nieuwe preview maken

Ledkolom-exports zijn al snel een paar honderd MB. De upload-knop van
github.com stopt bij 25 MB, dus loopt het via een release: daar mag een bestand
tot 2 GB zijn.

1. Open [**het release-formulier**](https://github.com/Marketing-NBC/NBC-3D-ledkolom-Preview/releases/new). (Vanaf de voorpagina: rechterkolom, onder *About*, bij **Releases** → *Create a new release*.)
2. Vul bij *Choose a tag* een nieuwe naam in, bijvoorbeeld `deloitte-25-aug`, en klik **Create new tag**.
3. Sleep de mp4 in het vak **Attach binaries**. Wacht tot de upload klaar is.
4. Klik **Publish release**.
5. Wacht een paar minuten. Onder **Actions** lopen er twee taken achter elkaar: eerst *Release verwerken*, daarna *Preview bouwen en publiceren*. Zijn ze allebei groen, dan staat de link in het [overzicht](https://marketing-nbc.github.io/NBC-3D-ledkolom-Preview/).

Je mag meerdere mp4's aan één release hangen. Ze worden dan allemaal verwerkt.

**De naam komt van het bestand, niet van de tag.** Sleep je
`Deloitte - 25 aug.mp4` in de release, dan wordt de link
`.../p/deloitte-25-aug/` en staat "Deloitte - 25 aug" op het startscherm. De tag
van de release doet er verder niet toe; die moet alleen uniek zijn.

| Bestand dat je bijvoegt      | Wordt                                                     |
| ---------------------------- | --------------------------------------------------------- |
| `Deloitte - 25 aug.mp4`      | `.../p/deloitte-25-aug/`, startscherm "Deloitte - 25 aug"  |
| `Brookz_27 aug - trim.mp4`   | `.../p/brookz-27-aug/`, startscherm "Brookz 27 aug"        |

Onderstrepingstekens worden spaties en een `- trim` achter de naam gaat eraf,
zodat je exports rechtstreeks kunt bijvoegen.

Gebruik je dezelfde bestandsnaam nog een keer, dan wordt diezelfde preview
bijgewerkt en blijft de link werken. Handig als er een nieuwe versie komt nadat
je de link al hebt verstuurd.

### Wat er met je bronvideo gebeurt

De mp4 blijft in de release staan; alleen de gecomprimeerde versie van ongeveer
10 MB komt in de repository terecht. Je hebt er dus meteen een archief van je
aangeleverde bestanden bij. Ruimt lekker op om oude releases af en toe weg te
gooien, maar het hoeft niet: bijlagen bij releases tellen niet mee voor de
grootte van de repository zelf.

### Twee kortere routes

**Video kleiner dan 25 MB** — sleep hem rechtstreeks in de map
[`docs/p/`](../../tree/main/docs/p) via **Add file → Upload files** en commit.
Verder gaat het precies hetzelfde.

**Video staat al ergens online** — ga naar **Actions → Preview bouwen en
publiceren → Run workflow**, plak de link bij *video_url* en vul bij *naam* in
wat er op het startscherm moet komen.

## Wat er onder water gebeurt

Het werk is over twee workflows verdeeld, en daar is een reden voor. Een
release draait op de tag en niet op `main`, en het `github-pages`-environment
laat alleen deployments vanaf de standaardbranch toe. Publiceren vanaf een tag
wordt dus geweigerd. Daarom doet
[`verwerk-release.yml`](.github/workflows/verwerk-release.yml) het zware werk en
commit het resultaat naar `main`, waarna
[`publiceer-preview.yml`](.github/workflows/publiceer-preview.yml) het oppakt en
online zet.

Het rekenwerk zelf zit in `tools/build.mjs`. Dat script haalt de video op uit de
release en gaat er dan mee aan de slag:

1. het leest breedte, hoogte en duur van de video met `ffprobe`;
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
