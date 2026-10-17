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
  - On Windows: run `ssh-keygen -t ed25519 -f darbna_server` and press Enter twice
    at the passphrase prompts for a dedicated unattended deployment key. Do not
    pass literal quote characters as the passphrase.
  - Paste the contents of `darbna_server.pub` into the provider's "SSH key" box.
  - Keep `darbna_server` (no extension) private: it goes into GitHub in step 3, nowhere else.

## 2. Point the names at it (where you bought darbna.com)

Add two **A records** with the VPS's IP address:

| Type | Name | Value |
|---|---|---|
| A | `routing` | VPS IP |
| A | `search` | VPS IP |

Use DNS-only records for these two new API names. Caddy terminates HTTPS on the
server. Keep the existing website records unchanged.

## 3. GitHub secrets (repo → Settings → Secrets and variables → Actions → Secrets)

- `SERVER_HOST`: the VPS IP
- `SERVER_SSH_KEY`: the whole text of the private key file `darbna_server`
- `SERVER_KNOWN_HOSTS`: the server's SSH host public key, in `known_hosts` format.
  Confirm its fingerprint during the owner's first login and compare with
  `ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub` on the server. Do not replace
  a mismatching key with an unverified `ssh-keyscan` result.

This workflow requires root access (the default `SERVER_USER`). It rejects other
users explicitly rather than failing partway through privileged commands.

## 4. Deploy

GitHub → Actions → **Server deploy** → Run workflow. It installs Docker, copies the setup and
starts everything. Ubuntu's package repository supplies Docker and Compose.
The first time, the Iraq map is downloaded and indexed. The workflow can finish
while the import continues; a running container is not a ready routing/search
service. Check both status endpoints and real Iraq searches/routes before
changing the app's endpoints. Do not restart imports just to poll progress.

The container images are pinned by digest, including Nominatim 5.3 with PostgreSQL
16. Review and test image updates explicitly. Import settings leave memory for
both services on the 12 GB launch VPS. Caddy access logging is disabled and its
runtime error logs remove the request object. Avoid printing backend logs in CI;
they may contain query text. Backend Docker log storage is disabled; use status
endpoints, process/resource checks and index files to monitor imports. Caddy's
filtered operational logs are bounded to two 5 MB files. The database ports are internal to Docker, with only
SSH and HTTP/HTTPS exposed on the host.

## 5. Switch the app over

Repo → Settings → Secrets and variables → Actions → **Variables**:

- `VALHALLA_URL` = `https://routing.darbna.com`
- `NOMINATIM_URL` = `https://search.darbna.com`

The next web, iPhone and Android builds use your server. Delete the variables to go back to
the public servers.

## Keeping it fresh

- Search follows OpenStreetMap edits by itself (minutely updates from Geofabrik).
- Routes: run **Server deploy** with "refresh map data" ticked about once a month.
