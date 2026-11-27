param([Parameter(Mandatory = $true)][string]$Database)
$ErrorActionPreference = 'Stop'
if ($Database -notmatch '^trazflow_trz115_[a-zA-Z0-9_]+$') { throw 'Use una base de pruebas aislada trazflow_trz115_*.' }
$company = [guid]::NewGuid().ToString()
$container = 'supabase_db_TrazFlow-G8'
function Sql([string]$statement) {
  $output = docker exec $container psql -X -q -v ON_ERROR_STOP=1 -U postgres -d $Database -At -c $statement 2>&1
  if ($LASTEXITCODE -ne 0) { throw ($output -join "`n") }
  return ($output -join "`n")
}
Sql "insert into public.companies(id,name) values ('$company','TRZ115 concurrency fixture'); insert into public.warehouses(company_id,code,name,layout) values ('$company','FIRST-OFF','First off',jsonb_build_array(jsonb_build_object('label','Sector'))),('$company','FIRST-INSERT','First insert',jsonb_build_array(jsonb_build_object('label','Sector')));" | Out-Null
function Start-Session([string]$statement) {
  Start-Job -ArgumentList $container,$Database,$statement -ScriptBlock {
    param($container,$database,$statement)
    $output = docker exec $container psql -X -q -v ON_ERROR_STOP=1 -U postgres -d $database -At -c $statement 2>&1
    [pscustomobject]@{ ExitCode = $LASTEXITCODE; Output = ($output -join "`n") }
  }
}
$first = Start-Session "begin; update public.warehouses set active=false where company_id='$company' and code='FIRST-OFF'; select pg_sleep(4); commit;"
Start-Sleep -Seconds 1
$second = Start-Session "insert into public.warehouse_locations(company_id,warehouse_code,code,aisle) values ('$company','FIRST-OFF','RACE-OFF','A');"
$a = $first | Wait-Job | Receive-Job; $b = $second | Wait-Job | Receive-Job
if ($a.ExitCode -ne 0 -or $b.ExitCode -eq 0 -or $b.Output -notmatch 'inactivo') { throw "Desactivación primero: $($a.Output) / $($b.Output)" }
$first = Start-Session "begin; insert into public.warehouse_locations(company_id,warehouse_code,code,aisle) values ('$company','FIRST-INSERT','RACE-INSERT','A'); select pg_sleep(4); commit;"
Start-Sleep -Seconds 1
$second = Start-Session "update public.warehouses set active=false where company_id='$company' and code='FIRST-INSERT';"
$a = $first | Wait-Job | Receive-Job; $b = $second | Wait-Job | Receive-Job
if ($a.ExitCode -ne 0 -or $b.ExitCode -ne 0) { throw "Alta primero: $($a.Output) / $($b.Output)" }
$result = Sql "select (select count(*) from public.warehouse_locations where company_id='$company' and code='RACE-OFF')=0 and (select count(*) from public.warehouse_locations where company_id='$company' and code='RACE-INSERT')=1 and not (select active from public.warehouses where company_id='$company' and code='FIRST-INSERT');"
if ($result.Trim() -ne 't') { throw 'El estado final no coincide con la serialización esperada.' }
Write-Output 'PASS: ambos órdenes de alta individual y desactivación.'
