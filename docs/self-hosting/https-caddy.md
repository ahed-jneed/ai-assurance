# HTTPS with Caddy

Out of the box, the self-hosted app speaks plain HTTP on port 8787. That is fine on your own laptop. Once other people reach it over a network, passwords and session cookies would travel unencrypted. This guide puts Caddy in front of the app so that everything travels over HTTPS.

Two terms, in case they are new:

- **Caddy** is a small web server that gets and renews HTTPS certificates on its own.
- A **reverse proxy** is a server that sits in front of the app and passes requests on to it. Here Caddy is the reverse proxy.

The repository ships two files for this:

- `docker-compose.caddy.yml` is a compose **overlay**: a second compose file that adds to `docker-compose.yml`. It adds a `caddy` service and stops publishing the app's own port, so the app is reachable only through Caddy.
- `Caddyfile` is Caddy's configuration. It is a few lines long, and you do not need to edit it.

## Before you start

You need:

1. **A server with Docker and Docker Compose 2.24.4 or later.** Check with `docker compose version`. Older versions do not understand the `!reset` tag that the overlay uses to remove the published app port.
2. **A host name that points at the server.** This guide uses `assurance.example.com` as the example. Create a DNS record (type `A`, or `AAAA` for IPv6) for your own name with the server's public address.
3. **Ports 80 and 443 reachable from the internet.** Open them in the server's firewall. Caddy proves to the certificate authority that it controls the host name through these ports, so without them it cannot get a certificate. Nothing else may be listening on them on the server.

## Steps

Run every command in the repository root, the folder that holds `docker-compose.yml`.

1. Tell Caddy your host name. Create a file named `.env` with one line. Replace the example name with your own:

   ```bash
   echo "ASSURANCE_HOST=assurance.example.com" > .env
   ```

   Docker Compose reads `.env` on its own. Git ignores the file, so it stays out of your commits.

2. Start the app and Caddy:

   ```bash
   docker compose -f docker-compose.yml -f docker-compose.caddy.yml up -d --build
   ```

   The first start builds the app image, which takes a few minutes.

3. Open `https://assurance.example.com` (your own name) in a browser. The first visit asks you to create the owner account. Caddy needs a few seconds after the first start to get the certificate. If the browser shows a certificate warning, wait a moment and reload.

Use both `-f` options in every later compose command too, for example to read Caddy's log:

```bash
docker compose -f docker-compose.yml -f docker-compose.caddy.yml logs caddy
```

If you already ran the plain variant, the same command in step 2 switches it over. Your data stays, because it lives in the `ai-assurance-data` volume.

## What to change

- **Host name.** Only the `ASSURANCE_HOST` line in `.env`. To change it later, edit the line and run the `up -d` command of step 2 again.
- **Ports.** The overlay publishes ports 80 and 443 (see `ports:` under `caddy` in `docker-compose.caddy.yml`). Keep them if you can: certificate authorities reach your server on these two ports, so automatic certificates need them. The app's own port 8787 is no longer published on the server. Caddy reaches it inside the compose network, so you do not need to change or open it.

## How it works

- Caddy serves `https://<your host name>` on port 443 and passes each request on to the app at `ai-assurance:8787` inside the compose network. Requests to port 80 (plain HTTP) are redirected to HTTPS.
- Caddy keeps the public host name in the request and adds the header `X-Forwarded-Proto: https`. The app needs both. It marks the session cookie `Secure` when it sees that header, and it refuses any form post that does not come from the site's own address (see [Built-in accounts](../security/identity.md#built-in-accounts-local-the-default)).
- Always open the app through the HTTPS address, never around Caddy.

## Keep the certificate volume

Caddy stores its certificates and their private keys in the `caddy-data` volume. Keep this volume. If you delete it, Caddy asks for new certificates at the next start, and certificate authorities limit how many they issue for one name in a week. `docker compose down` keeps volumes. `docker compose down -v` deletes them, **including your app data**, so do not use `-v` unless you mean it.

## Try it without a public name

To try the set-up on one machine first, use a name that ends in `.localhost`:

```bash
echo "ASSURANCE_HOST=assurance.localhost" > .env
```

For such names Caddy does not ask a public certificate authority. It signs the certificate with its own local authority, so your browser shows a warning that you must accept. Use this for a trial only.

## Go back to plain HTTP

Start the stack without the overlay:

```bash
docker compose up -d --remove-orphans
```

`--remove-orphans` removes the Caddy container, which the plain file does not know. The app is again on `http://<server>:8787`, published on all network interfaces, and your data and the certificate volumes stay.

## If something does not work

- **`required variable ASSURANCE_HOST is missing a value`.** The `.env` file is missing, or you ran the command in another folder.
- **An error about `!reset`, or port 8787 is still published.** Your Docker Compose is probably older than 2.24.4. Update it.
- **No certificate.** Read Caddy's log (command above). The usual causes are a DNS record that does not point at this server yet, or a firewall that blocks port 80 or 443.
- **"Request refused" (403) when you send a form.** You opened the app at another address than the one Caddy serves, for example by IP address. Use `https://` and the host name in `.env`.

## What was tested

This set-up was tested with Docker Compose 5.7.1 and the `caddy:2` image, with the host name `assurance.localhost` and Caddy's local certificate authority: owner set-up, sign-out and sign-in through Caddy over HTTPS, the `Secure` mark on the session cookie, the refusal of a form post with a foreign `Origin`, and that port 8787 is not published. Not tested: a certificate from a public certificate authority and a real public DNS name, because the test machine had neither.
