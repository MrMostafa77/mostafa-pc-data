param([int]$Port=8080)
$root=(Get-Location).Path
$listener=New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://127.0.0.1:$Port/")
$listener.Start()
Start-Process "http://127.0.0.1:$Port/"
Write-Host "GameVault running at http://127.0.0.1:$Port/" -ForegroundColor Cyan
$mime=@{'.html'='text/html; charset=utf-8';'.css'='text/css; charset=utf-8';'.js'='application/javascript; charset=utf-8';'.json'='application/json; charset=utf-8';'.jpg'='image/jpeg';'.jpeg'='image/jpeg';'.png'='image/png';'.svg'='image/svg+xml';'.webp'='image/webp';'.ico'='image/x-icon'}
try {
 while($listener.IsListening){
  $ctx=$listener.GetContext(); $path=[Uri]::UnescapeDataString($ctx.Request.Url.AbsolutePath.TrimStart('/'))
  if([string]::IsNullOrWhiteSpace($path)){$path='index.html'}
  $file=Join-Path $root $path
  if((Test-Path $file -PathType Leaf) -and ((Resolve-Path $file).Path.StartsWith($root,[System.StringComparison]::OrdinalIgnoreCase))){
    $bytes=[IO.File]::ReadAllBytes($file); $ext=[IO.Path]::GetExtension($file).ToLowerInvariant(); if($mime.ContainsKey($ext)){$ctx.Response.ContentType=$mime[$ext]}; $ctx.Response.ContentLength64=$bytes.Length; $ctx.Response.OutputStream.Write($bytes,0,$bytes.Length)
  } else { $ctx.Response.StatusCode=404; $b=[Text.Encoding]::UTF8.GetBytes('404'); $ctx.Response.OutputStream.Write($b,0,$b.Length) }
  $ctx.Response.OutputStream.Close()
 }
} finally { $listener.Stop() }
