# CDNFlare

An edge-powered HTTP reverse proxy designed for Cloudflare Workers that accelerates file downloads through local network peering and edge-optimized streaming.

## Highlights

- **Edge Streaming:** Transfers files directly to the client without buffering full payloads in Worker memory.
- **Byte-Range Multiplexing:** Full `HTTP 206 Partial Content` support for download managers (IDM, Aria2) with multi-segmented downloads and pause/resume capability.
- **Dual Routing Methods:** Accepts target links via query string (`/?url=...`) or path prefix (`/https://...`).
- **Header Forwarding:** Preserves upstream content headers (`Content-Type`, `Content-Disposition`, `Content-Length`, `ETag`).
- **Hotlink Fallback:** Automatically sets the upstream origin as the referer when unprovided.
- **Access Guard:** Optional token verification via `ACCESS_TOKEN` environment variable.
- **English Web Dashboard:** Built-in web interface for generating direct download links and terminal commands.

## Deploying to Cloudflare

### Prerequisites
- Node.js (version 18 or newer)
- A Cloudflare account

### Setup Steps

1. Clone this repository:
   ```bash
   git clone https://github.com/mh-mahim/cdnflare.git
   cd cdnflare
   ```

2. Authenticate with Wrangler:
   ```bash
   npx wrangler login
   ```

3. Deploy the worker:
   ```bash
   npx wrangler deploy
   ```

Your service will be accessible at: `https://cdnflare.<subdomain>.workers.dev`

## Usage Guide

### 1. Web Dashboard
Open the deployed worker URL in a browser, enter your target download link, and select your preferred tool format.

### 2. URL Path Format
Prepend the worker URL to your file link:
```
https://cdnflare.<subdomain>.workers.dev/https://example.com/archive.zip
```

### 3. Query Parameter Format
```
https://cdnflare.<subdomain>.workers.dev/?url=https://example.com/archive.zip
```

### 4. CLI Tools

- **Aria2 (16 Connections):**
  ```bash
  aria2c -s 16 -x 16 "https://cdnflare.<subdomain>.workers.dev/?url=https://example.com/file.iso"
  ```
- **cURL:**
  ```bash
  curl -L -O -C - "https://cdnflare.<subdomain>.workers.dev/?url=https://example.com/file.iso"
  ```

## Security Settings

To protect your deployment with an access token, configure the secret via Wrangler:
```bash
npx wrangler secret put ACCESS_TOKEN
```
When configured, append `&token=YOUR_TOKEN` to your request parameters.

## License

This project is licensed under the MIT License.
