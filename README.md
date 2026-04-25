# gh-discord-relay

Lightweight proxy server that forwards GitHub webhook events to Discord as rich embeds. Built with Deno.

## How it works

1. Configure this server's URL as the webhook URL in your GitHub repository
2. The server receives GitHub webhook events, transforms them into rich Discord embeds, and forwards them to a Discord webhook

## Supported events

Supports **40+** GitHub event types including pushes, pull requests, issues, releases, deployments, workflow runs, security alerts, discussions, and more.

## Setup

### Environment variables

| Variable              | Description                         |
| --------------------- | ----------------------------------- |
| `DISCORD_WEBHOOK_URL` | Your Discord webhook URL (required) |
| `PORT`                | Server port (default: `8080`)       |

### Run locally

```bash
DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/... deno run --allow-net --allow-env proxy.ts
```

### Run with Docker

Build and run the image directly:

```bash
docker build -t gh-discord-relay .
docker run -d -p 6060:6060 \
  -e DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/... \
  -e PORT=6060 \
  --name gh-discord-relay \
  gh-discord-relay
```

### Run with Docker Compose

Create a `.env` file:

```
DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/...
```

```bash
docker compose up -d
```

The container uses port `6060` by default, runs with `restart: unless-stopped`, and reads the webhook URL from the `.env` file.

### Development

```bash
deno task dev
```

## GitHub webhook configuration

1. Go to your repository → **Settings** → **Webhooks** → **Add webhook**
2. Set **Payload URL** to `https://your-server/webhook`
3. Set **Content type** to `application/json`
4. Select the events you want to forward
5. Click **Add webhook**
