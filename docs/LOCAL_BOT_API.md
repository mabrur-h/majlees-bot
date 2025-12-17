# Telegram Local Bot API Setup

This document explains how to set up and use the Telegram Local Bot API for handling large files (up to 2GB) instead of the default 20MB limit.

## Overview

### Why Local Bot API?

| Feature | Cloud API | Local Bot API |
|---------|-----------|---------------|
| Max file download | 20 MB | 2 GB |
| Max file upload | 50 MB | 2 GB |
| File storage | Telegram servers | Your server |
| Setup complexity | None | Requires Docker |

### How It Works

1. The Local Bot API server runs as a Docker container on your machine
2. Your bot connects to the Local Bot API instead of `api.telegram.org`
3. Files are downloaded and stored locally in the container
4. Your bot reads files from the container using `docker cp`

## Setup Instructions

### Prerequisites

- Docker installed and running
- Telegram API credentials from https://my.telegram.org/apps
  - `TELEGRAM_API_ID`
  - `TELEGRAM_API_HASH`

### Step 1: Start the Local Bot API Container

```powershell
# Windows PowerShell
docker run -d --name telegram-bot-api `
  -p 8081:8081 `
  -e TELEGRAM_API_ID=your_api_id `
  -e TELEGRAM_API_HASH=your_api_hash `
  -e TELEGRAM_LOCAL=true `
  --user root `
  aiogram/telegram-bot-api:latest --local
```

```bash
# Linux/Mac
docker run -d --name telegram-bot-api \
  -p 8081:8081 \
  -e TELEGRAM_API_ID=your_api_id \
  -e TELEGRAM_API_HASH=your_api_hash \
  -e TELEGRAM_LOCAL=true \
  aiogram/telegram-bot-api:latest --local
```

### Step 2: Configure Environment Variables

Add these to your `.env` file:

```env
# Enable Local Bot API
USE_LOCAL_BOT_API=true
LOCAL_BOT_API_URL=http://localhost:8081

# Required for file access on Windows (docker cp fallback)
LOCAL_BOT_API_FILES_PATH=C:/telegram-bot-api-data

# Telegram API credentials
TELEGRAM_API_ID=your_api_id
TELEGRAM_API_HASH=your_api_hash
```

### Step 3: Start Your Bot

```bash
npm run dev
```

You should see:
```
Using Local Bot API at: http://localhost:8081
Max file size: 2.0 GB
```

## Docker Commands Reference

### Start Container
```powershell
docker run -d --name telegram-bot-api -p 8081:8081 -e TELEGRAM_API_ID=your_id -e TELEGRAM_API_HASH=your_hash -e TELEGRAM_LOCAL=true --user root aiogram/telegram-bot-api:latest --local
```

### Stop Container
```powershell
docker stop telegram-bot-api
```

### Remove Container
```powershell
docker rm telegram-bot-api
```

### View Logs
```powershell
docker logs telegram-bot-api
docker logs telegram-bot-api --tail 50  # Last 50 lines
docker logs telegram-bot-api -f         # Follow logs
```

### Check Container Status
```powershell
docker ps
```

### List Files in Container
```powershell
docker exec telegram-bot-api ls -la /var/lib/telegram-bot-api/
docker exec telegram-bot-api ls -la "/var/lib/telegram-bot-api/YOUR_BOT_TOKEN/videos/"
```

### Copy File from Container
```powershell
docker cp "telegram-bot-api:/var/lib/telegram-bot-api/BOT_TOKEN/videos/file.mp4" "C:/temp/file.mp4"
```

### Restart Container
```powershell
docker restart telegram-bot-api
```

## Windows-Specific Notes

### Colon in Path Issue

The Local Bot API stores files in paths like:
```
/var/lib/telegram-bot-api/123456789:AAH.../videos/file.mp4
```

Windows cannot create directories with colons (`:`) in the name. This means volume mounts don't work properly on Windows.

**Solution**: The bot automatically falls back to using `docker cp` to copy files from the container to a temp directory.

### Volume Mount (Linux/Mac Only)

On Linux/Mac, you can mount a volume for direct file access:

```bash
docker run -d --name telegram-bot-api \
  -p 8081:8081 \
  -v /path/to/data:/var/lib/telegram-bot-api \
  -e TELEGRAM_API_ID=your_id \
  -e TELEGRAM_API_HASH=your_hash \
  -e TELEGRAM_LOCAL=true \
  aiogram/telegram-bot-api:latest --local
```

Then set `LOCAL_BOT_API_FILES_PATH=/path/to/data` in your `.env`.

## How File Upload Works

1. User sends a video to the bot
2. Bot receives the message with `file_id`
3. Bot calls `getFile(file_id)` via Local Bot API
4. Local Bot API downloads the file from Telegram and returns a local path like:
   ```
   /var/lib/telegram-bot-api/TOKEN/videos/file_0.mp4
   ```
5. Bot copies the file from container using `docker cp`
6. Bot uploads the file to your backend API
7. Temp file is deleted

## Troubleshooting

### Bot Not Starting

Check if the Local Bot API container is running:
```powershell
docker ps
docker logs telegram-bot-api
```

### "File is too big" Error

Make sure:
1. `USE_LOCAL_BOT_API=true` in `.env`
2. Container is running with `--local` flag
3. Bot is connecting to `http://localhost:8081`

### Container Crashes

Check logs for errors:
```powershell
docker logs telegram-bot-api
```

Common issues:
- Invalid API credentials
- Port 8081 already in use
- Insufficient permissions

### Files Not Found

Files are lost when the container restarts. Make sure to:
1. Process files immediately after upload
2. Don't restart the container while files are pending

## Production Deployment (Railway)

For Railway deployment, both the Local Bot API and your bot run in the same container using supervisord.

See the `Dockerfile` and `supervisord.conf` in this repository for the production setup.

### Required Railway Environment Variables

```
BOT_TOKEN=your_bot_token
API_BASE_URL=https://your-api.railway.app
WEB_APP_URL=https://your-web.railway.app
USE_LOCAL_BOT_API=true
TELEGRAM_API_ID=your_api_id
TELEGRAM_API_HASH=your_api_hash
```

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     Your Server                              │
│                                                              │
│  ┌──────────────────┐     ┌──────────────────────────────┐ │
│  │   Your Bot       │     │  Local Bot API Container     │ │
│  │   (Node.js)      │────▶│  (telegram-bot-api)          │ │
│  │                  │     │                              │ │
│  │  Port 3001       │     │  Port 8081                   │ │
│  └──────────────────┘     │                              │ │
│           │               │  Files stored at:            │ │
│           │               │  /var/lib/telegram-bot-api/  │ │
│           │               └──────────────────────────────┘ │
│           │                           │                     │
│           │        docker cp          │                     │
│           │◀──────────────────────────┘                     │
│           │                                                 │
│           ▼                                                 │
│  ┌──────────────────┐                                      │
│  │  Backend API     │                                      │
│  │  (Upload files)  │                                      │
│  └──────────────────┘                                      │
└─────────────────────────────────────────────────────────────┘
                    │
                    │ HTTPS
                    ▼
          ┌──────────────────┐
          │  Telegram Servers │
          └──────────────────┘
```

## Resources

- [Telegram Bot API - Local Mode](https://core.telegram.org/bots/api#using-a-local-bot-api-server)
- [telegram-bot-api Docker Image](https://hub.docker.com/r/aiogram/telegram-bot-api)
- [grammY Local Bot API](https://grammy.dev/guide/api#running-a-local-bot-api-server)
