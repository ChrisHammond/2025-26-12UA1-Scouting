# ---- Search range ----
$id    = 13200
$maxId = 13600

# ---- What you're looking for ----
$targetCity      = "Detroit"
$targetStartDate = [datetime]"2026-01-16"
$targetEndDate   = [datetime]"2026-01-19"

# Keywords that often work even when associationTitle varies
$titleKeywords = @("Motown", "Detroit")
$assocKeywords = @("Hockey Time", "Hockey Time Productions")

# Output containers
$matches    = New-Object System.Collections.Generic.List[object]
$nearMisses = New-Object System.Collections.Generic.List[object]

function Try-ParseDate($value) {
  if ($null -eq $value) { return $null }
  try { return [datetime]$value } catch { return $null }
}

function Get-FirstExistingPropValue($obj, [string[]]$names) {
  foreach ($n in $names) {
    if ($obj.PSObject.Properties.Name -contains $n) {
      $v = $obj.$n
      if ($null -ne $v -and "$v".Trim().Length -gt 0) { return $v }
    }
  }
  return $null
}

for ($i = $id; $i -le $maxId; $i++) {
  $url = "https://gamesheetstats.com/api/useSeasonDivisions/getSeason/$i"

  try {
    $json = Invoke-RestMethod -Uri $url -Method GET -TimeoutSec 20
  } catch {
    # Common if IDs don't exist
    continue
  }

  if ($null -eq $json) { continue }

  $assoc = "$($json.associationTitle)"
  $title = "$($json.title)"

  # Try to discover optional fields (these may or may not exist in this API)
  $cityRaw  = Get-FirstExistingPropValue $json @("city","locationCity","eventCity","town")
  $startRaw = Get-FirstExistingPropValue $json @("startDate","beginDate","dateStart","start")
  $endRaw   = Get-FirstExistingPropValue $json @("endDate","finishDate","dateEnd","end")

  $city  = if ($cityRaw) { "$cityRaw" } else { "" }
  $start = Try-ParseDate $startRaw
  $end   = Try-ParseDate $endRaw

  # Matching rules
  $assocHit = $assocKeywords | Where-Object { $assoc -like "*$_*" } | Select-Object -First 1
  $titleHit = $titleKeywords | Where-Object { $title -like "*$_*" } | Select-Object -First 1
  $cityHit  = ($city -ne "" -and $city -like "*$targetCity*")

  $dateHit = $false
  if ($start -and $end) {
    $dateHit = ($start.Date -eq $targetStartDate.Date -and $end.Date -eq $targetEndDate.Date)
  }

  $isMatch = ($assocHit -or $titleHit -or ($cityHit -and $dateHit))

  $row = [pscustomobject]@{
    Id               = $i
    Url              = $url
    AssociationTitle = $assoc
    Title            = $title
    City             = $city
    StartDate        = $start
    EndDate          = $end
  }

  if ($isMatch) {
    $matches.Add($row)
    Write-Host "MATCH: [$i] $title | Assoc='$assoc' | $url"
  }
  elseif ($title -like "*Detroit*" -or $cityHit) {
    # Helpful logging for "why didn't it match?"
    $nearMisses.Add($row)
    Write-Host "Near miss: [$i] $title | Assoc='$assoc'"
  }
}

# Save outputs
$matches | Export-Csv -NoTypeInformation -Encoding UTF8 -Path "tournament_matches.csv"
$nearMisses | Export-Csv -NoTypeInformation -Encoding UTF8 -Path "tournament_near_misses.csv"

Write-Host "Done. Matches: tournament_matches.csv | Near misses: tournament_near_misses.csv"
