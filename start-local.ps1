$ErrorActionPreference = 'Stop'
$env:VITE_SKIP_WINDOWS_NET_USE = '1'
& node .\node_modules\vite\bin\vite.js --configLoader native --mode development --host 127.0.0.1 --port 8766
