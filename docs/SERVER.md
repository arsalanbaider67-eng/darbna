# Darbna server (darbna.com)

Your own copy of the route planner (Valhalla) and place search (Nominatim), built from the
OpenStreetMap Iraq map. It replaces the free public servers, which don't allow an app with real
users. Map tiles (OpenFreeMap) and shared reports (Supabase) stay as they are.

| Address | What |
|---|---|
| `https://routing.darbna.com` | car + walking routes, speed limits |
| `https://search.darbna.com` | search, "nearby" quick buttons |

## 1. Rent the VPS

- Ubuntu 24.04, **4 vCPU, 8 GB RAM, 80 GB disk** (Hetzner, DigitalOcean, Contabo, …).
- When creating it, add an **SSH key** (not a password):
  - On Windows (PowerShell): `ssh-keygen -t ed25519 -f darbna_server -N '""'`
  - Paste the contents of `darbna_server.pub` into the provider's "SSH key" box.
  - Keep `darbna_server` (no extension) private: it goes into GitHub in step 3, nowhere else.

## 2. Point the names at it (where you bought darbna.com)

Add two **A records** with the VPS's IP address:

| Type | Name | Value |
|---|---|---|
| A | `routing` | VPS IP |
| A | `search` | VPS IP |

## 3. GitHub secrets (repo → Settings → Secrets and variables → Actions → Secrets)

- `SERVER_HOST`: the VPS IP
- `SERVER_SSH_KEY`: the whole text of the private key file `darbna_server`

## 4. Deploy

GitHub → Actions → **Server deploy** → Run workflow. It installs Docker, copies the setup and
starts everything. The first time, the Iraq map is downloaded and indexed: **30–90 minutes**
before the addresses answer (the run ends with a "not ready yet" warning; that's expected).
Run it again later to confirm both show ✓.

## 5. Switch the app over

Repo → Settings → Secrets and variables → Actions → **Variables**:

- `VALHALLA_URL` = `https://routing.darbna.com`
- `NOMINATIM_URL` = `https://search.darbna.com`

The next web, iPhone and Android builds use your server. Delete the variables to go back to
the public servers.

## Keeping it fresh

- Search follows OpenStreetMap edits by itself (minutely updates from Geofabrik).
- Routes: run **Server deploy** with "refresh map data" ticked about once a month.
