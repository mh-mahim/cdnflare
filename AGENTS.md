# CDNFlare - Project Agent Rules

This project is a Cloudflare Workers-based reverse proxy & download accelerator designed to leverage Cloudflare's global edge network, local peering, and anycast routing to deliver accelerated download speeds for slow international file sources.

## Tech Stack
- **Runtime:** Cloudflare Workers (V8 Serverless Edge Engine)
- **Deployment:** Wrangler CLI v4
- **Language:** Modern JavaScript (ES Modules)
- **Architecture:** Zero-buffer streaming pass-through (`Response(originResponse.body)`), Range header multiplexing for IDM, embedded responsive web UI.

## Safety & Best Practices
- Never buffer complete large files in Worker memory (Worker memory limit is 128MB). Always stream directly.
- Preserve client `Range` and `Content-Range` headers for multi-threaded downloads.
- Always provide descriptive JSON error responses for API failures and graceful UI validation.
