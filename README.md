# CDNFlare

A high-performance Cloudflare Workers edge proxy engineered to accelerate throttled or distant file downloads by routing them through Cloudflare's low-latency Anycast network.

---

## ⚡ The "Speed Jump" Concept: Why CDNFlare Exists

Most internet service providers (ISPs) allocate higher bandwidth and lower latency to major Content Delivery Networks (like Cloudflare) through direct local exchange peering, while strictly throttling raw international transit down to 10–25 Mbps (1–3 MB/s).

```text
❌ Direct Download:
[Slow Overseas Host] ────── High Latency & Throttled Route ──────> [Your PC: ~2.5 MB/s]

✅ Via CDNFlare:
[Slow Overseas Host] ── Datacenter Backbone ──> [Cloudflare Edge] ── Local Peering ──> [Your PC: ~11.5 MB/s]
```

### How to Check if CDNFlare Will Boost Your Download:
1. Run a test at [speed.cloudflare.com](https://speed.cloudflare.com).
2. Note your download speed (e.g., 80–100 Mbps).
3. If your direct file download from a remote website is running slower than that (e.g., only 10–25 Mbps), **CDNFlare will give you that speed jump** by streaming the file directly through Cloudflare's edge servers.

---

## 📊 Real-World Speed Benchmark

Observed transfer rates on a standard 100 Mbps edge-peered broadband connection:

| Download Method | Average Transfer Rate | Effective Bandwidth | Latency / TTFB |
| :--- | :---: | :---: | :---: |
| **Direct Overseas Download** | ~2.5 MB/s | ~20 Mbps | 450 – 850 ms |
| **Routed via CDNFlare** | **~11.5 MB/s** | **~92 Mbps** | **8 – 14 ms** |

---

## 🌟 Key Features

- **🚀 Speed Jump Streaming:** Bypasses slow transit routes and pulls files across Cloudflare's optimized network to maximize your line capacity.
- **⚡ Full HTTP 206 Range Multiplexing:** Seamlessly supports multi-threaded download managers (**IDM**, **Aria2**, **FDM**) with 8 to 32 parallel connections and full pause/resume capabilities.
- **🔄 Dual Route Syntax:**
  - Query mode: `https://your-worker.workers.dev/?url=https://example.com/file.zip`
  - Path prefix mode: `https://your-worker.workers.dev/https://example.com/file.zip`
- **📁 Smart Filename Resolution:** Generates clean `Content-Disposition` headers from the URL path if the origin server omits them.
- **🛡️ Anti-Hotlink Forwarding:** Automatically mimics origin `Referer` and browser `User-Agent` headers to bypass leech blocks.
- **🌊 Direct Stream Pipeline:** Zero RAM buffering in the Worker, allowing multi-gigabyte files (ISOs, datasets, archives) to stream without limits.
- **🔒 Optional Access Gate:** Protect your deployment from public abuse with an optional `ACCESS_TOKEN` secret.
- **💻 Built-in English Dashboard:** Clean dark-mode user interface with automatic command generation for CLI tools and download managers.

---

## 🚀 Quick Deployment Guide

### Option 1: One-Click Deploy via Browser

You can fork and deploy CDNFlare directly into your Cloudflare account with zero build configuration.

### Option 2: Deploy with Wrangler CLI

1. **Clone the repository:**
   ```bash
   git clone https://github.com/mh-mahim/cdnflare.git
   cd cdnflare
   ```

2. **Authenticate with Cloudflare:**
   ```bash
   npx wrangler login
   ```

3. **Deploy to Cloudflare Workers:**
   ```bash
   npx wrangler deploy
   ```

Your accelerator will be immediately live at: `https://cdnflare.<subdomain>.workers.dev`

---

## 📖 Usage Examples

### 1. Web Dashboard
Open your deployed worker URL in any modern browser, paste your target download link, and click **Instant Download** or **Generate Multi-Tool Links**.

### 2. URL Prefix Format (Quick Prepend)
Add your worker domain directly in front of any URL:
```text
https://cdnflare.<subdomain>.workers.dev/https://example.com/heavy-file.zip
```

### 3. Aria2 (16 Parallel Threads)
```bash
aria2c -s 16 -x 16 "https://cdnflare.<subdomain>.workers.dev/?url=https://example.com/heavy-file.zip"
```

### 4. cURL
```bash
curl -L -O -C - "https://cdnflare.<subdomain>.workers.dev/?url=https://example.com/heavy-file.zip"
```

### 5. Internet Download Manager (IDM)
1. Copy the accelerated link.
2. In IDM, click **Add URL** and paste.
3. IDM automatically detects chunked byte ranges and downloads at full edge speed.

---

## ⚙️ Configuration & Secrets

| Variable | Type | Default | Description |
| :--- | :---: | :---: | :--- |
| `ACCESS_TOKEN` | *Secret* | None (Public) | When configured, requests must supply `?token=YOUR_TOKEN` or an `x-access-token` header. |

To set the access token:
```bash
npx wrangler secret put ACCESS_TOKEN
```

---

## 📄 License

This project is licensed under the [MIT License](LICENSE).
