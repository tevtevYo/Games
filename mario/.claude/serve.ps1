# Minimal static file server for local testing (no dependencies).
param([int]$Port = 8765)
$root = (Resolve-Path "$PSScriptRoot\..").Path
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://127.0.0.1:$Port/")
$listener.Prefixes.Add("http://localhost:$Port/")
$listener.Start()
Write-Host "Serving $root on http://localhost:$Port/"
$types = @{ ".html"="text/html; charset=utf-8"; ".js"="text/javascript; charset=utf-8"; ".css"="text/css; charset=utf-8"; ".md"="text/plain; charset=utf-8"; ".json"="application/json" }
while ($listener.IsListening) {
  $ctx = $listener.GetContext()
  $path = [Uri]::UnescapeDataString($ctx.Request.Url.AbsolutePath)
  if ($path -eq "/") { $path = "/index.html" }
  $file = Join-Path $root ($path -replace "/", "\")
  $res = $ctx.Response
  try {
    if ((Test-Path $file -PathType Leaf) -and $file.StartsWith($root)) {
      $bytes = [IO.File]::ReadAllBytes($file)
      $ext = [IO.Path]::GetExtension($file).ToLower()
      $res.ContentType = if ($types[$ext]) { $types[$ext] } else { "application/octet-stream" }
      $res.StatusCode = 200
      $res.OutputStream.Write($bytes, 0, $bytes.Length)
    } else {
      $res.StatusCode = 404
      $b = [Text.Encoding]::UTF8.GetBytes("Not found: $path")
      $res.OutputStream.Write($b, 0, $b.Length)
    }
  } catch { $res.StatusCode = 500 }
  $res.Close()
}
