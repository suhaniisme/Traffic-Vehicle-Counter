# Minimal static file server for Traffic Counter (no installs needed).
# Usage:  powershell -ExecutionPolicy Bypass -File serve.ps1 [-Port 8080]
# Then open http://localhost:8080/
#
# Browsers refuse to read canvas pixels from file:// pages, so the app
# must be served over HTTP. POST /__save?name=<file> writes the request
# body into tests/output/ (used only by the automated test runner).

param(
    [int]$Port = 8080,
    [string]$Root = $PSScriptRoot
)

$Root = (Resolve-Path $Root).Path
$outDir = Join-Path $Root 'tests\output'

$mime = @{
    '.html' = 'text/html; charset=utf-8'
    '.css'  = 'text/css; charset=utf-8'
    '.js'   = 'application/javascript; charset=utf-8'
    '.json' = 'application/json; charset=utf-8'
    '.md'   = 'text/markdown; charset=utf-8'
    '.jpg'  = 'image/jpeg'
    '.jpeg' = 'image/jpeg'
    '.png'  = 'image/png'
    '.webp' = 'image/webp'
    '.svg'  = 'image/svg+xml'
    '.ico'  = 'image/x-icon'
}

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$Port/")
$listener.Start()
Write-Host "Traffic Counter running at http://localhost:$Port/  (Ctrl+C to stop)"

function Send-Bytes($res, [int]$status, [byte[]]$bytes, [string]$type) {
    $res.StatusCode = $status
    $res.ContentType = $type
    $res.Headers.Add('Cache-Control', 'no-store')
    $res.ContentLength64 = $bytes.Length
    $res.OutputStream.Write($bytes, 0, $bytes.Length)
    $res.OutputStream.Close()
}

function Send-Text($res, [int]$status, [string]$text) {
    Send-Bytes $res $status ([Text.Encoding]::UTF8.GetBytes($text)) 'text/plain; charset=utf-8'
}

try {
    while ($listener.IsListening) {
        $ctx = $listener.GetContext()
        $req = $ctx.Request
        $res = $ctx.Response
        try {
            $path = [Uri]::UnescapeDataString($req.Url.AbsolutePath)

            if ($req.HttpMethod -eq 'POST' -and $path -eq '/__save') {
                $name = $req.QueryString['name']
                if (-not $name -or $name -notmatch '^[\w\-.]+$') { Send-Text $res 400 'bad name'; continue }
                New-Item -ItemType Directory -Force $outDir | Out-Null
                $ms = New-Object System.IO.MemoryStream
                $req.InputStream.CopyTo($ms)
                $bytes = $ms.ToArray()
                # Data URLs (annotated PNGs) are decoded to binary.
                $text = [Text.Encoding]::UTF8.GetString($bytes)
                if ($text.StartsWith('data:')) {
                    $bytes = [Convert]::FromBase64String($text.Substring($text.IndexOf(',') + 1))
                }
                [IO.File]::WriteAllBytes((Join-Path $outDir $name), $bytes)
                Send-Text $res 200 'saved'
                continue
            }

            if ($path.EndsWith('/')) { $path += 'index.html' }
            $file = [IO.Path]::GetFullPath((Join-Path $Root $path.TrimStart('/')))
            if (-not $file.StartsWith($Root, [StringComparison]::OrdinalIgnoreCase) -or -not (Test-Path $file -PathType Leaf)) {
                Send-Text $res 404 'not found'
                continue
            }
            $ext = [IO.Path]::GetExtension($file).ToLower()
            $type = $mime[$ext]; if (-not $type) { $type = 'application/octet-stream' }
            Send-Bytes $res 200 ([IO.File]::ReadAllBytes($file)) $type
        } catch {
            try { Send-Text $res 500 $_.Exception.Message } catch {}
        }
    }
} finally {
    $listener.Stop()
}
