# Deploying to a Raspberry Pi

This setup assumes the NAS share is **already mounted** on the Pi and your recipe files are in
`/mnt/chipolata/recipes/processed/`. The Pi runs nginx and serves:

```
Phone/tablet ──https──▶ Raspberry Pi (nginx)
                          /                    → /var/www/recipes/                   the app (site/), copied by deploy.sh
                          /recipes/…           → /mnt/chipolata/recipes/processed/   your recipes and images (NAS, read-only)
                          /recipes/index.json  → /var/lib/recipes/index.json         the index, rebuilt every 5 minutes
```

**Nothing is written to the NAS.** The app and the index live on the Pi, and the recipes folder is only read.

Files in this folder:

| File | What it is |
|---|---|
| `deploy.sh` | Copies the app to `/var/www/recipes` and rebuilds the index. Run it for the first install and after every update. |
| `nginx.conf.example` | A dedicated nginx site for the app: HTTPS, the folder mapping above, gzip, caching and security headers. |
| `nginx-cookbook-http.conf`, `nginx-cookbook-locations.conf` | Or: the same app at `/cookbook/` inside an nginx site you already have (step 6, option A). |
| `recipes-index.service`, `recipes-index.timer` | Rebuild the index from the recipes folder every 5 minutes. The file is only rewritten when recipes changed. |

The commands below use `pi` as the Pi user and `recipes.local` as the address. Replace `pi` with your login name. For
the address, use your Pi's hostname followed by `.local`; run `hostname` on the Pi to see it. Phones and tablets
find `<hostname>.local` on the home network without any router setup.

## 1. Check the basics

```bash
ls /mnt/chipolata/recipes/processed | head
```

```bash
node --version
```

Node needs to be **20 or newer**. Raspberry Pi OS "Trixie" ships Node 20 (`sudo apt install nodejs`). Otherwise
install the official build from nodejs.org. That's also the only option on **32-bit Raspberry Pi OS** (`armhf`),
which NodeSource doesn't support. Node 22 is the last line with 32-bit ARM (`armv7l`) builds, supported until
April 2027. Install it into `/usr/local`:

```bash
uname -m      # armv7l or aarch64: fine. armv6l (Pi Zero / Pi 1): see below.
```

> **Pi Zero / Pi 1 (`armv6l`):** nodejs.org has no builds for this chip. On Raspberry Pi OS Trixie, use
> `sudo apt install nodejs` (Node 20, built for ARMv6) and skip the download below. On Bookworm, `apt` gives
> Node 18: run `node /opt/recipes/tools/build-index.mjs /mnt/chipolata/recipes/processed --dry-run --report` to
> check that it works before relying on it.

```bash
cd /tmp && V=$(curl -fsSL https://nodejs.org/dist/latest-v22.x/SHASUMS256.txt | grep -o 'node-v22[^ ]*-linux-armv7l\.tar\.xz' | head -1) && echo "$V"
```

```bash
curl -fsSLO "https://nodejs.org/dist/latest-v22.x/$V" && curl -fsSL https://nodejs.org/dist/latest-v22.x/SHASUMS256.txt | grep " $V\$" | sha256sum -c -
```

```bash
sudo tar -xJf "/tmp/$V" -C /usr/local --strip-components=1 --exclude CHANGELOG.md --exclude LICENSE --exclude README.md && /usr/local/bin/node --version
```

On a 64-bit OS, replace `armv7l` with `arm64` in the first command. Node then lives at `/usr/local/bin/node`. Use
that path in `recipes-index.service` (step 3).

nginx runs as the `www-data` user, and it must be able to read the recipes folder:

```bash
sudo -u www-data ls /mnt/chipolata/recipes/processed | head
```

If that says "Permission denied", the share is mounted for your user only. Add `file_mode=0644,dir_mode=0755` to
its options in `/etc/fstab` (or `uid=`/`gid=` options that give `www-data` read access), then remount.

## 2. Install the tools and get the code

```bash
sudo apt install nginx rsync git
```

```bash
sudo git clone https://github.com/pbeckham/recipes.git /opt/recipes && sudo chown -R pi:pi /opt/recipes
```

## 3. Index timer

Edit `User=` in the service if your user isn't `pi`, and the `node` path in `ExecStart=` if Node isn't at
`/usr/bin/node` (`command -v node` shows where it is; `/usr/local/bin/node` if you installed it from nodejs.org).
The index is written to `/var/lib/recipes`, which systemd creates.

```bash
sudo cp /opt/recipes/deploy/recipes-index.service /opt/recipes/deploy/recipes-index.timer /etc/systemd/system/
```

```bash
sudo systemctl daemon-reload && sudo systemctl enable --now recipes-index.timer
```

```bash
sudo systemctl start recipes-index && journalctl -u recipes-index -n 20 --no-pager
```

The log lists how many recipes were indexed, plus a warning for each file that isn't a valid recipe. To see which
recipes had their categories guessed:

```bash
node /opt/recipes/tools/build-index.mjs /mnt/chipolata/recipes/processed --dry-run --report
```

## 4. Install the app

```bash
sudo /opt/recipes/deploy/deploy.sh
```

This copies `site/` to `/var/www/recipes` and starts the index service.

## 5. HTTPS certificate

Browsers only allow **"Keep screen on"** over HTTPS. Everything else also works over plain `http://`. To skip HTTPS
for now, follow the note at the top of `nginx.conf.example` and go to step 6.

**Option A: a local certificate authority with `mkcert`.** You don't need a domain, but each device needs one-time
setup.

```bash
sudo apt install mkcert
```

```bash
mkcert -install && mkcert recipes.local
```

```bash
sudo install -D -m 644 recipes.local.pem /etc/nginx/ssl/recipes.pem && sudo install -m 600 recipes.local-key.pem /etc/nginx/ssl/recipes-key.pem
```

Then trust the certificate authority on each phone and tablet. Its certificate is `rootCA.pem` in the folder shown
by `mkcert -CAROOT`. **Never share `rootCA-key.pem`.**

- **iPhone or iPad:** send `rootCA.pem` to the device (AirDrop or email), then open **Settings → Profile Downloaded →
  Install**. Then go to **Settings → General → About → Certificate Trust Settings** and turn it on.
- **Android:** copy `rootCA.pem` to the device, then go to **Settings → Security → More security settings →
  Encryption & credentials → Install a certificate → CA certificate**. The menu names vary by manufacturer.

**Option B: Let's Encrypt.** If you own a domain, use `certbot` with your DNS provider's plugin. The DNS-01
challenge means nothing is exposed to the internet, and phones need no setup. Point a local DNS record such as
`recipes.example.com` at the Pi, then use that name and the certificate paths certbot prints in the nginx config.

## 6. nginx

**Does this Pi's nginx already serve other things?** Check with `ls /etc/nginx/sites-enabled/` and look inside the
files listed there. If your `default` site has your own `location` blocks (other apps, other pages), **don't replace
it**. Use option A to add the app at `/cookbook/` alongside them. Option B gives the app a site of its own.

### Option A: add the app at `/cookbook/` to your existing site

This adds two small include files; the only change to your existing config is one `include` line.

```bash
sudo cp /opt/recipes/deploy/nginx-cookbook-http.conf /etc/nginx/conf.d/cookbook.conf && sudo cp /opt/recipes/deploy/nginx-cookbook-locations.conf /etc/nginx/snippets/cookbook.conf
```

Find the file your enabled `default` site really is, and back it up:

```bash
F=$(readlink -f /etc/nginx/sites-enabled/default) && echo "$F" && sudo cp "$F" "$F.bak"
```

Add the include line after `server_name _;` (the first occurrence only):

```bash
sudo sed -i '0,/^[[:space:]]*server_name _;/s//&\n\tinclude snippets\/cookbook.conf;/' "$F" && grep -n 'cookbook' "$F"
```

```bash
sudo nginx -t && sudo systemctl reload nginx
```

The app is at `http://<pi-name>.local/cookbook/`. If `nginx -t` fails, restore the backup with
`sudo cp "$F.bak" "$F"`. Recipe folder paths are in `/etc/nginx/snippets/cookbook.conf` (lines marked `←`). For
HTTPS with this option, enable SSL in your existing server block (see step 5); the snippet works unchanged.

### Option B: a dedicated site for the app

```bash
sudo cp /opt/recipes/deploy/nginx.conf.example /etc/nginx/sites-available/recipes
```

Check the lines marked `←`: `server_name`, the certificate paths, and the recipes folder.

```bash
sudo ln -sf /etc/nginx/sites-available/recipes /etc/nginx/sites-enabled/recipes && sudo rm -f /etc/nginx/sites-enabled/default
```

```bash
sudo nginx -t && sudo systemctl reload nginx
```

Open `https://recipes.local/` on your phone. Add it to the home screen for one-tap access.

## Cookbook progress (optional)

To see how much of each cookbook you have, put a `books.json` contents list in the recipes folder, next to your
recipes: `/mnt/chipolata/recipes/processed/books.json`. The index timer picks it up automatically, and the app's
**Books** page shows each book's progress and what's still to add. The format is in the main README under
"Cookbooks". To keep it somewhere else, add `--books /path/to/books.json` to `ExecStart=` in the service.

## Day to day

- **Adding or editing recipes:** save the files into `processed/` on the NAS as you do now. They appear within 5
  minutes, or straight away after `sudo systemctl start recipes-index`.
- **Updating the app** after a new version is merged:

  ```bash
  cd /opt/recipes && git pull && sudo deploy/deploy.sh
  ```

## Troubleshooting

| Symptom | Check |
|---|---|
| "No recipe index found" | `journalctl -u recipes-index`. Is the share mounted? Can the service user read it? |
| Recipes list loads, recipe pages say "not found (HTTP 404)" or images are missing | `sudo -u www-data ls /mnt/chipolata/recipes/processed`. nginx needs read access. |
| "Keep screen on" button missing | The site is on plain HTTP, or the device doesn't trust the certificate. |
| New recipe not showing | `systemctl list-timers recipes-index`, then `sudo systemctl start recipes-index`. |
| nginx won't start | `sudo nginx -t` names the bad line. |
| `recipes-index` fails with "Unable to locate executable … build-index.mjs: Permission denied" | The Node path is missing from `ExecStart=`. It must start with the full path to `node`. |

The repository's tests run `deploy.sh` and this exact nginx config, with only paths, ports and certificate
swapped, in a real nginx. They check the headers, caching, gzip and blocked paths, and load the app in a browser
(`npm run test:deploy`).
