# Technical Architecture

## Data Flow
```text
[Client / IDM / Browser]
        │
        ▼ (HTTP GET / HEAD with Range header)
[Cloudflare Dhaka Edge (DAC) / Worker]
        │
        ├─► Cache Lookup (cf: { cacheEverything: true })
        │
        ▼ (Fetch over Cloudflare Backbone)
[Origin Server (Slow International Host)]
```

## Key Architectural Decisions
1. **Streaming Pass-Through:** `new Response(originResponse.body, ...)` ensures that Worker memory is never exhausted, allowing arbitrary file sizes (e.g. 5GB - 50GB ISOs, videos) to stream without hitting the 128MB worker RAM cap.
2. **Range Multiplexing:** Preserving and forwarding `Range`, `If-Range`, and `Accept-Ranges` headers allows IDM, Aria2, and download managers to open parallel chunk connections and resume interrupted downloads.
3. **Hotlink Bypass:** When the client does not specify a `Referer`, the worker automatically sets `Referer: targetUrl.origin` to defeat naive hotlink-protection scripts on the origin host.
