# Bruno Simon portfolio replica

This folder contains the official `folio-2025` source linked from [bruno-simon.com](https://bruno-simon.com/), plus its static runtime assets. The upstream source is under the MIT license; see [license.md](./license.md).

## Open the running copy

The local preview is running at <http://127.0.0.1:8766/>. Click the scene to start driving.

## Restart the preview

Dependencies are already installed in this workspace. From PowerShell in this folder, run:

```powershell
.\start-local.ps1
```

The upstream `npm run dev` command is also in the README; this helper starts Vite in the current managed Windows environment.

## Fresh setup

Install Node.js, then open a terminal in this folder and run:

```powershell
Copy-Item .env.example .env
npm install --force
npm run dev
```

The runtime uses compressed MP3 tracks; the large uncompressed WAV duplicates were left out. Bruno’s private game server is not in the public repository, so scores and whispers remain offline.

## Upstream

Source repository: https://github.com/brunosimon/folio-2025
