# ---- Search range ----
$id    = 12600
$maxId = 14350

# Output container
$rows = New-Object System.Collections.Generic.List[object]

for ($i = $id; $i -le $maxId; $i++) {
  $url = "https://gamesheetstats.com/api/useSeasonDivisions/getSeason/$i"

  try {
    $json = Invoke-RestMethod -Uri $url -Method GET -TimeoutSec 20
  } catch {
    # Common if IDs don't exist / 404 / etc.
    continue
  }

  if ($null -eq $json) { continue }

  $title = "$($json.title)"
  $assoc = "$($json.associationTitle)"

  # Record the row
  $rows.Add([pscustomobject]@{
    Id        = $i
    Url       = $url
    Title     = $title
    Organizer = $assoc
  })

  Write-Host "[$i] $title | Organizer='$assoc'"
}

# Save outputs (different filename)
$rows | Export-Csv -NoTypeInformation -Encoding UTF8 -Path "tournaments_all.csv"

Write-Host "Done. Results saved to tournaments_all.csv"
