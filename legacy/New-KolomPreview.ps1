<#
  New-KolomPreview.ps1
  Maakt van een LED-kolom video (4 zijden naast elkaar, geluidloos) een
  NBC 3D-preview en publiceert die als deelbare link op Netlify.

  - Originele mp4 wordt NOOIT gewijzigd (alleen gelezen).
  - Web-versie (index.html + kolom.mp4) wordt naar Netlify geupload -> link in beeld.
  - Optioneel ook een lokaal zelfstandig "<naam> - 3D Kolom.html" (base64) als backup.
  - Aan te roepen met 1 of meer paden (bestanden en/of mappen), bv. via drag-and-drop.
#>

[CmdletBinding()]
param(
  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]] $Paths
)

$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$root      = $PSScriptRoot
$ffmpeg    = Join-Path $root 'tools\ffmpeg.exe'
$ffprobe   = Join-Path $root 'tools\ffprobe.exe'
$tplPath   = Join-Path $root 'template.html'
$tplWebPath= Join-Path $root 'template-web.html'
$cfgPath   = Join-Path $root 'config.json'
$tokenPath = Join-Path $root 'tools\netlify-token.txt'
$mapPath   = Join-Path $root 'deployed-sites.json'
$inv       = [System.Globalization.CultureInfo]::InvariantCulture

foreach ($p in @($ffmpeg,$ffprobe,$tplWebPath,$cfgPath)) {
  if (-not (Test-Path $p)) { Write-Host "ONTBREEKT: $p" -ForegroundColor Red; exit 1 }
}

$cfg         = Get-Content $cfgPath -Raw -Encoding UTF8 | ConvertFrom-Json
$templateWeb = Get-Content $tplWebPath -Raw -Encoding UTF8
$maxBytes    = [int64]($cfg.maxHtmlMB * 1MB)

$wantLocal = if ($cfg.PSObject.Properties.Name -contains 'localHtml') { [bool]$cfg.localHtml } else { $true }
$doNetlify = if ($cfg.PSObject.Properties.Name -contains 'netlify')   { [bool]$cfg.netlify }   else { $true }

# template.html (base64-versie) alleen nodig voor de lokale backup
$template = $null
if ($wantLocal -and (Test-Path $tplPath)) { $template = Get-Content $tplPath -Raw -Encoding UTF8 }

# Netlify-token inlezen (blijft buiten beeld)
$token = $null
if ($doNetlify) {
  if (Test-Path $tokenPath) { $token = (Get-Content $tokenPath -Raw).Trim() }
  if (-not $token) {
    Write-Host "! Geen Netlify-token gevonden in tools\netlify-token.txt - uploaden wordt overgeslagen." -ForegroundColor Yellow
    $doNetlify = $false
  }
}

# lokale map project -> netlify site-id, zodat re-drag dezelfde site bijwerkt
$siteMap = @{}
if (Test-Path $mapPath) {
  try {
    $obj = Get-Content $mapPath -Raw -Encoding UTF8 | ConvertFrom-Json
    foreach ($pr in $obj.PSObject.Properties) { $siteMap[$pr.Name] = [string]$pr.Value }
  } catch {}
}
function Save-SiteMap {
  ($siteMap | ConvertTo-Json) | Set-Content -LiteralPath $mapPath -Encoding UTF8
}

function HtmlEncode([string]$s) {
  return ($s -replace '&','&amp;' -replace '<','&lt;' -replace '>','&gt;')
}

function Get-Slug([string]$s) {
  $x = $s.ToLowerInvariant()
  $x = $x -replace '[^a-z0-9]+','-'
  $x = $x.Trim('-')
  if ($x.Length -lt 1) { $x = 'kolom' }
  if ($x.Length -gt 40) { $x = $x.Substring(0,40).Trim('-') }
  return "nbc-kolom-$x"
}

function Get-MaxWidth([double]$dur) {
  if ($dur -le 30)  { return 1044 }
  if ($dur -le 90)  { return 928 }
  if ($dur -le 240) { return 696 }
  return 560
}

# Een twee-pass encode naar een doelgrootte. Retourneert pad naar temp-mp4.
function Invoke-Encode([string]$src, [double]$budgetMB, [double]$durEff, [int]$maxW) {
  $budgetBytes = $budgetMB * 1MB
  $vbBps = [math]::Floor(0.97 * $budgetBytes * 8 / $durEff)
  $vbk   = "$([math]::Floor($vbBps/1000))k"
  $vf    = "scale=min(iw\,$maxW):-2"
  $tmp   = Join-Path $env:TEMP ("kolom_" + [guid]::NewGuid().ToString('N'))
  $plog  = "$tmp.log"
  $out   = "$tmp.mp4"
  $fps   = [int]$cfg.fps
  $preset= [string]$cfg.preset

  $trim = @()
  if ($cfg.maxDurationSec -gt 0) { $trim = @('-t', "$($cfg.maxDurationSec)") }

  # pass 1 (analyse, geen output-bestand)
  & $ffmpeg -y -hide_banner -loglevel error -i $src @trim -an -c:v libx264 -preset $preset `
      -b:v $vbk -pass 1 -passlogfile $plog -vf $vf -r $fps -f null NUL
  if ($LASTEXITCODE -ne 0) { throw "ffmpeg pass 1 faalde ($LASTEXITCODE)" }

  # pass 2 (echte encode)
  & $ffmpeg -y -hide_banner -loglevel error -i $src @trim -an -c:v libx264 -preset $preset `
      -b:v $vbk -pass 2 -passlogfile $plog -vf $vf -r $fps -pix_fmt yuv420p -movflags +faststart $out
  if ($LASTEXITCODE -ne 0) { throw "ffmpeg pass 2 faalde ($LASTEXITCODE)" }

  Remove-Item "$plog*" -Force -ErrorAction SilentlyContinue
  return $out
}

# Publiceer web-build (index.html + kolom.mp4) naar Netlify. Retourneert de https-URL.
function Publish-ToNetlify([string]$webHtml, [string]$mp4Path, [string]$proj) {
  $hdr = @{ Authorization = "Bearer $token" }

  # tijdelijke deploy-map opbouwen
  $deployDir = Join-Path $env:TEMP ("nbcdeploy_" + [guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Path $deployDir | Out-Null
  $enc = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText((Join-Path $deployDir 'index.html'), $webHtml, $enc)
  Copy-Item -LiteralPath $mp4Path -Destination (Join-Path $deployDir 'kolom.mp4') -Force
  $zip = "$deployDir.zip"
  if (Test-Path $zip) { Remove-Item $zip -Force }
  Compress-Archive -Path (Join-Path $deployDir '*') -DestinationPath $zip -Force

  try {
    # bestaande site hergebruiken indien bekend en nog aanwezig
    $siteId = $null
    if ($siteMap.ContainsKey($proj) -and $siteMap[$proj]) {
      $siteId = $siteMap[$proj]
      try { Invoke-RestMethod -Uri "https://api.netlify.com/api/v1/sites/$siteId" -Headers $hdr -Method Get | Out-Null }
      catch { $siteId = $null }   # site bestaat niet meer -> opnieuw aanmaken
    }

    if (-not $siteId) {
      $slug = Get-Slug $proj
      try {
        $body = @{ name = $slug } | ConvertTo-Json
        $site = Invoke-RestMethod -Uri "https://api.netlify.com/api/v1/sites" -Headers $hdr -Method Post -Body $body -ContentType 'application/json'
      } catch {
        # naam al bezet of ongeldig -> laat Netlify zelf een naam kiezen
        $site = Invoke-RestMethod -Uri "https://api.netlify.com/api/v1/sites" -Headers $hdr -Method Post
      }
      $siteId = $site.id
      $siteMap[$proj] = $siteId
      Save-SiteMap
    }

    # zip deployen
    $deploy = Invoke-RestMethod -Uri "https://api.netlify.com/api/v1/sites/$siteId/deploys" `
                -Headers $hdr -Method Post -InFile $zip -ContentType 'application/zip'

    # wachten tot de deploy live staat
    $deployId = $deploy.id
    for ($i = 0; $i -lt 30 -and $deploy.state -ne 'ready'; $i++) {
      Start-Sleep -Seconds 2
      $deploy = Invoke-RestMethod -Uri "https://api.netlify.com/api/v1/sites/$siteId/deploys/$deployId" -Headers $hdr -Method Get
      if ($deploy.state -eq 'error') { throw "Netlify-deploy mislukte (state=error)" }
    }

    $siteInfo = Invoke-RestMethod -Uri "https://api.netlify.com/api/v1/sites/$siteId" -Headers $hdr -Method Get
    $url = $siteInfo.ssl_url
    if (-not $url) { $url = $siteInfo.url }
    return $url
  }
  finally {
    Remove-Item $deployDir -Recurse -Force -ErrorAction SilentlyContinue
    Remove-Item $zip -Force -ErrorAction SilentlyContinue
  }
}

function Convert-One([string]$file) {
  $file = (Resolve-Path -LiteralPath $file).ProviderPath
  $name = [IO.Path]::GetFileName($file)

  # afmetingen + duur
  $probe = & $ffprobe -v error -select_streams v:0 -show_entries "stream=width,height:format=duration" -of json $file | Out-String
  $meta  = $probe | ConvertFrom-Json
  $w = [int]$meta.streams[0].width
  $h = [int]$meta.streams[0].height
  $dur = [double]::Parse([string]$meta.format.duration, $inv)
  if ($w -le 0 -or $h -le 0 -or $dur -le 0) { Write-Host "  ! Kon afmetingen/duur niet lezen - overgeslagen" -ForegroundColor Yellow; return }

  $faceAspect = $h / ($w / 4.0)
  Write-Host ("  {0}x{1}, {2:n1}s  -  zijde-verhouding {3:n2}" -f $w,$h,$dur,$faceAspect) -ForegroundColor DarkGray

  if (-not $cfg.forceAll -and $faceAspect -lt $cfg.minFaceAspect) {
    Write-Host "  ! Ziet er niet uit als een 4-zijden ledkolom (verhouding te laag) - overgeslagen." -ForegroundColor Yellow
    Write-Host "    (Zet 'forceAll': true in config.json om dit toch te forceren.)" -ForegroundColor DarkGray
    return
  }

  $H = ($h / ($w / 4.0)).ToString('0.######', $inv)
  $maxW = Get-MaxWidth $dur
  $durEff = if ($cfg.maxDurationSec -gt 0 -and $dur -gt $cfg.maxDurationSec) { [double]$cfg.maxDurationSec } else { $dur }

  # naam voor op het startscherm + de site
  $proj = [IO.Path]::GetFileNameWithoutExtension($file)
  $proj = $proj -replace '(?i)\s*-?\s*trim\s*$',''
  $proj = ($proj -replace '[_]+',' ' -replace '\s{2,}',' ').Trim()
  $showName = [bool]$cfg.showName -and $proj.Length -gt 0
  $projKey = if ($proj.Length -gt 0) { $proj } else { [IO.Path]::GetFileNameWithoutExtension($file) }

  # comprimeren (verklein budget alleen indien de lokale base64-HTML te groot zou worden)
  Write-Host "  comprimeren..." -ForegroundColor DarkGray
  $budgetMB = [double]$cfg.videoBudgetMB
  $b64 = $null; $mp4 = $null
  $mp4 = Invoke-Encode -src $file -budgetMB $budgetMB -durEff $durEff -maxW $maxW
  if ($wantLocal -and $template) {
    for ($try = 1; $try -le 4; $try++) {
      $bytes = [IO.File]::ReadAllBytes($mp4)
      $b64 = [Convert]::ToBase64String($bytes)
      $approx = $template.Length + $b64.Length
      if ($approx -lt $maxBytes) { break }
      $budgetMB = $budgetMB * 0.82
      Write-Host ("  - lokale HTML te groot ({0:n1} MB), opnieuw comprimeren op {1:n1} MB budget..." -f ($approx/1MB), $budgetMB) -ForegroundColor DarkGray
      Remove-Item $mp4 -Force -ErrorAction SilentlyContinue
      $mp4 = Invoke-Encode -src $file -budgetMB $budgetMB -durEff $durEff -maxW $maxW
    }
  }

  # ---- lokale zelfstandige HTML (backup) ----------------------------
  if ($wantLocal -and $template) {
    $html = $template
    $html = $html.Replace('__FACE_RATIO__', $H)
    $html = $html.Replace('__NAME_DISPLAY__', $(if ($showName) {'block'} else {'none'}))
    $html = $html.Replace('__PROJECT_NAME__', $(if ($showName) { HtmlEncode $proj } else {''}))
    $html = $html.Replace('__VIDEO_DATA__', $b64)
    $outDir  = [IO.Path]::GetDirectoryName($file)
    $outName = ([IO.Path]::GetFileNameWithoutExtension($file)) + ' - 3D Kolom.html'
    $outPath = Join-Path $outDir $outName
    [System.IO.File]::WriteAllText($outPath, $html, (New-Object System.Text.UTF8Encoding($false)))
    $sizeMB = [math]::Round((Get-Item $outPath).Length/1MB, 2)
    Write-Host ("  lokaal  -> {0}  ({1} MB)" -f $outName, $sizeMB) -ForegroundColor DarkGreen
  }

  # ---- web-versie publiceren op Netlify -----------------------------
  if ($doNetlify) {
    $webHtml = $templateWeb
    $webHtml = $webHtml.Replace('__FACE_RATIO__', $H)
    $webHtml = $webHtml.Replace('__NAME_DISPLAY__', $(if ($showName) {'block'} else {'none'}))
    $webHtml = $webHtml.Replace('__PROJECT_NAME__', $(if ($showName) { HtmlEncode $proj } else {''}))
    Write-Host "  uploaden naar Netlify..." -ForegroundColor DarkGray
    try {
      $url = Publish-ToNetlify -webHtml $webHtml -mp4Path $mp4 -proj $projKey
      Write-Host ""
      Write-Host "  ====================================================" -ForegroundColor Green
      Write-Host ("   LINK: {0}" -f $url) -ForegroundColor Green
      Write-Host "  ====================================================" -ForegroundColor Green
      Set-Clipboard -Value $url -ErrorAction SilentlyContinue
      Write-Host "  (link staat ook op je klembord - direct plakken in je mail)" -ForegroundColor DarkGray
    } catch {
      Write-Host ("  ! Upload mislukte: {0}" -f $_.Exception.Message) -ForegroundColor Red
    }
  }

  Remove-Item $mp4 -Force -ErrorAction SilentlyContinue
}

# ---- hoofdlus over alle gesleepte paden -----------------------------
if (-not $Paths -or $Paths.Count -eq 0) {
  Write-Host "Sleep een of meer mp4-bestanden op 'Maak 3D preview.cmd'." -ForegroundColor Cyan
  return
}

$files = New-Object System.Collections.Generic.List[string]
foreach ($p in $Paths) {
  if (Test-Path -LiteralPath $p -PathType Container) {
    Get-ChildItem -LiteralPath $p -Filter *.mp4 -File | ForEach-Object { $files.Add($_.FullName) }
  } elseif (Test-Path -LiteralPath $p -PathType Leaf) {
    if ([IO.Path]::GetExtension($p) -ieq '.mp4') { $files.Add((Resolve-Path -LiteralPath $p).ProviderPath) }
    else { Write-Host "Geen mp4, overgeslagen: $p" -ForegroundColor Yellow }
  } else {
    Write-Host "Niet gevonden: $p" -ForegroundColor Yellow
  }
}

Write-Host ""
Write-Host ("3D Kolom preview-generator  -  {0} bestand(en)" -f $files.Count) -ForegroundColor Cyan
$ok = 0
foreach ($f in $files) {
  Write-Host ""
  Write-Host ("> " + [IO.Path]::GetFileName($f)) -ForegroundColor White
  try { Convert-One $f; $ok++ }
  catch { Write-Host ("  FOUT: " + $_.Exception.Message) -ForegroundColor Red }
}
Write-Host ""
Write-Host ("Klaar. {0} van {1} verwerkt." -f $ok, $files.Count) -ForegroundColor Cyan
