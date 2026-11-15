/**
 * Cloudflare CDN Reverse Proxy & Download Accelerator
 * Author: mh-mahim
 * Description: High-speed edge streaming proxy with BDIX/DAC peering, Range support for IDM, and embedded modern Web UI.
 */

export default {
  async fetch(request, env, ctx) {
    const requestUrl = new URL(request.url);

    // Handle CORS Preflight
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
          "Access-Control-Allow-Headers": "*",
          "Access-Control-Max-Age": "86400"
        }
      });
    }

    // Only allow GET and HEAD
    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Method Not Allowed", { status: 405 });
    }

    // Extract target URL from query parameter or path
    const targetUrlParam = requestUrl.searchParams.get("url");

    // If no target URL is provided, serve the Web UI
    if (!targetUrlParam) {
      return new Response(renderWebUI(requestUrl.origin), {
        headers: {
          "Content-Type": "text/html; charset=UTF-8",
          "Cache-Control": "public, max-age=3600"
        }
      });
    }

    // Validate and parse the target URL
    let targetUrl;
    try {
      targetUrl = new URL(targetUrlParam.trim());
      if (targetUrl.protocol !== "http:" && targetUrl.protocol !== "https:") {
        return jsonErrorResponse("Invalid URL protocol. Only HTTP and HTTPS are supported.", 400);
      }
    } catch {
      return jsonErrorResponse("Malformed URL provided. Please provide a valid absolute URL.", 400);
    }

    // Prevent recursive proxy loops
    if (targetUrl.hostname === requestUrl.hostname) {
      return jsonErrorResponse("Loop detected: Target URL cannot be this worker itself.", 400);
    }

    // Build forward request headers
    const forwardHeaders = new Headers();

    // Preserve client Range header (Essential for IDM, multi-threaded downloads, and resuming)
    const clientRange = request.headers.get("Range") || request.headers.get("range");
    if (clientRange) {
      forwardHeaders.set("Range", clientRange);
    }

    const ifRange = request.headers.get("If-Range");
    if (ifRange) forwardHeaders.set("If-Range", ifRange);

    const ifModifiedSince = request.headers.get("If-Modified-Since");
    if (ifModifiedSince) forwardHeaders.set("If-Modified-Since", ifModifiedSince);

    const ifNoneMatch = request.headers.get("If-None-Match");
    if (ifNoneMatch) forwardHeaders.set("If-None-Match", ifNoneMatch);

    // Forward or set realistic browser User-Agent
    const clientUA = request.headers.get("User-Agent");
    forwardHeaders.set(
      "User-Agent",
      clientUA && !clientUA.includes("Cloudflare-Workers")
        ? clientUA
        : "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
    );

    // Set origin Referer to bypass hotlink protections
    const clientReferer = request.headers.get("Referer");
    forwardHeaders.set("Referer", clientReferer || targetUrl.origin);

    // Accept standard content types
    forwardHeaders.set(
      "Accept",
      request.headers.get("Accept") || "*/*"
    );

    // Fetch from origin with Cloudflare Edge caching enabled
    try {
      const originResponse = await fetch(targetUrl.toString(), {
        method: request.method,
        headers: forwardHeaders,
        redirect: "follow",
        cf: {
          cacheEverything: true,
          cacheTtl: 86400 // Cache for 24 hours if eligible
        }
      });

      // Prepare response headers for client
      const responseHeaders = new Headers();

      // Pass crucial headers
      const headersToPass = [
        "content-type",
        "content-length",
        "content-range",
        "accept-ranges",
        "content-disposition",
        "last-modified",
        "etag",
        "cache-control"
      ];

      for (const [key, value] of originResponse.headers.entries()) {
        const lowerKey = key.toLowerCase();
        if (headersToPass.includes(lowerKey)) {
          responseHeaders.set(key, value);
        }
      }

      // Ensure Accept-Ranges is always present so download managers know slicing is allowed
      if (!responseHeaders.has("Accept-Ranges")) {
        responseHeaders.set("Accept-Ranges", "bytes");
      }

      // Add CORS headers for web clients
      responseHeaders.set("Access-Control-Allow-Origin", "*");
      responseHeaders.set("Access-Control-Expose-Headers", "Content-Length, Content-Range, Accept-Ranges, Content-Disposition");

      // Custom accelerator signature headers
      responseHeaders.set("X-Accelerated-By", "Cloudflare-Worker-DAC");
      responseHeaders.set("X-Origin-Status", originResponse.status.toString());

      // Stream the response directly to the client without buffering
      return new Response(originResponse.body, {
        status: originResponse.status,
        statusText: originResponse.statusText,
        headers: responseHeaders
      });

    } catch (err) {
      return jsonErrorResponse(
        `Failed to reach origin server: ${err.message || "Network Error"}. Please verify that the target URL is accessible and online.`,
        502
      );
    }
  }
};

function jsonErrorResponse(message, status = 500) {
  return new Response(
    JSON.stringify({
      success: false,
      status: status,
      error: message,
      timestamp: new Date().toISOString()
    }),
    {
      status: status,
      headers: {
        "Content-Type": "application/json; charset=UTF-8",
        "Access-Control-Allow-Origin": "*"
      }
    }
  );
}

function renderWebUI(origin) {
  return `<!DOCTYPE html>
<html lang="bn">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>CDN Download Accelerator | Cloudflare Edge</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg: #0b0f19;
      --card-bg: #111827;
      --card-border: #1f2937;
      --accent: #38bdf8;
      --accent-glow: rgba(56, 189, 248, 0.15);
      --accent-hover: #0284c7;
      --text-main: #f8fafc;
      --text-muted: #94a3b8;
      --success: #10b981;
    }

    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    body {
      font-family: 'Plus Jakarta Sans', -apple-system, sans-serif;
      background-color: var(--bg);
      color: var(--text-main);
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 1.5rem;
      background-image: 
        radial-gradient(circle at 15% 20%, rgba(56, 189, 248, 0.08) 0%, transparent 40%),
        radial-gradient(circle at 85% 80%, rgba(14, 165, 233, 0.06) 0%, transparent 40%);
    }

    .container {
      width: 100%;
      max-width: 640px;
    }

    .header {
      text-align: center;
      margin-bottom: 2rem;
    }

    .badge {
      display: inline-flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.35rem 0.85rem;
      border-radius: 9999px;
      font-size: 0.8rem;
      font-weight: 600;
      background: var(--accent-glow);
      color: var(--accent);
      border: 1px solid rgba(56, 189, 248, 0.25);
      margin-bottom: 1rem;
    }

    .badge-dot {
      width: 8px;
      height: 8px;
      background: var(--accent);
      border-radius: 50%;
      box-shadow: 0 0 10px var(--accent);
    }

    h1 {
      font-size: 2.1rem;
      font-weight: 800;
      letter-spacing: -0.025em;
      line-height: 1.2;
      margin-bottom: 0.6rem;
    }

    .subtitle {
      color: var(--text-muted);
      font-size: 0.95rem;
      line-height: 1.5;
    }

    .card {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 16px;
      padding: 2rem;
      box-shadow: 0 20px 40px -15px rgba(0, 0, 0, 0.7);
    }

    .input-label {
      display: block;
      font-size: 0.85rem;
      font-weight: 600;
      color: var(--text-muted);
      margin-bottom: 0.5rem;
    }

    .input-group {
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
      margin-bottom: 1.25rem;
    }

    input[type="url"] {
      width: 100%;
      padding: 0.9rem 1.1rem;
      background: #0b0f19;
      border: 1px solid #334155;
      border-radius: 10px;
      color: var(--text-main);
      font-size: 0.95rem;
      outline: none;
      transition: all 0.2s ease;
      font-family: inherit;
    }

    input[type="url"]:focus {
      border-color: var(--accent);
      box-shadow: 0 0 0 3px var(--accent-glow);
    }

    .button-row {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 0.75rem;
    }

    @media (max-width: 480px) {
      .button-row {
        grid-template-columns: 1fr;
      }
    }

    .btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 0.5rem;
      padding: 0.85rem 1.25rem;
      border-radius: 10px;
      font-size: 0.95rem;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s ease;
      text-decoration: none;
      border: none;
    }

    .btn-primary {
      background: var(--accent);
      color: #0b0f19;
    }

    .btn-primary:hover {
      background: #7dd3fc;
      transform: translateY(-1px);
    }

    .btn-secondary {
      background: #1e293b;
      color: var(--text-main);
      border: 1px solid #334155;
    }

    .btn-secondary:hover {
      background: #334155;
      border-color: #475569;
    }

    .status-box {
      display: none;
      margin-top: 1.25rem;
      padding: 1rem;
      border-radius: 10px;
      background: #0f172a;
      border: 1px solid #1e293b;
      font-size: 0.88rem;
    }

    .status-box.show {
      display: block;
    }

    .status-title {
      font-weight: 600;
      color: var(--accent);
      margin-bottom: 0.35rem;
    }

    .code-box {
      background: #080c14;
      padding: 0.6rem 0.8rem;
      border-radius: 6px;
      font-family: 'JetBrains Mono', monospace;
      font-size: 0.8rem;
      color: #38bdf8;
      word-break: break-all;
      margin-top: 0.4rem;
      border: 1px solid #1e293b;
    }

    .guide-card {
      margin-top: 1.5rem;
      background: rgba(17, 24, 39, 0.6);
      border: 1px solid #1f2937;
      border-radius: 12px;
      padding: 1.25rem 1.5rem;
    }

    .guide-title {
      font-size: 0.9rem;
      font-weight: 700;
      color: #e2e8f0;
      margin-bottom: 0.5rem;
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }

    .guide-list {
      list-style: none;
      font-size: 0.82rem;
      color: var(--text-muted);
      line-height: 1.6;
    }

    .guide-list li::before {
      content: "•";
      color: var(--accent);
      font-weight: bold;
      display: inline-block;
      width: 1em;
      margin-left: -1em;
    }

    .guide-list li {
      padding-left: 1em;
      margin-bottom: 0.35rem;
    }

    .footer {
      text-align: center;
      margin-top: 2rem;
      font-size: 0.8rem;
      color: #64748b;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div class="badge">
        <span class="badge-dot"></span>
        <span>Dhaka PoP (DAC) & BDIX Edge</span>
      </div>
      <h1>CDN Download Accelerator</h1>
      <p class="subtitle">স্লো আন্তর্জাতিক লিংক ক্লাউডফ্লেয়ার এজ দিয়ে হাই-স্পিডে ডাউনলোড করুন</p>
    </div>

    <div class="card">
      <label class="input-label" for="urlInput">ডাউনলোড ফাইল লিংক পেস্ট করুন</label>
      <div class="input-group">
        <input 
          type="url" 
          id="urlInput" 
          placeholder="https://example.com/slow-large-file.zip" 
          autocomplete="off" 
          required 
        />
      </div>

      <div class="button-row">
        <button class="btn btn-primary" onclick="handleDownload()">
          <span>🚀 ডাউনলোড শুরু করুন</span>
        </button>
        <button class="btn btn-secondary" onclick="handleCopyLink()">
          <span>📋 অ্যাক্সিলারেটেড লিংক কপি</span>
        </button>
      </div>

      <div id="statusBox" class="status-box">
        <div class="status-title" id="statusTitle">লিংক তৈরি সম্পন্ন!</div>
        <div class="code-box" id="acceleratedUrlDisplay"></div>
      </div>
    </div>

    <div class="guide-card">
      <div class="guide-title">
        <span>⚡ IDM / Aria2 / Downloader এ কীভাবে ব্যবহার করবেন:</span>
      </div>
      <ul class="guide-list">
        <li>উপরের <strong>"অ্যাক্সিলারেটেড লিংক কপি"</strong> বাটনে ক্লিক করে রূপান্তরিত লিংকটি কপি করুন।</li>
        <li>আপনার <strong>IDM (Internet Download Manager)</strong>-এ <em>Add URL</em> দিয়ে পেস্ট করুন।</li>
        <li>আমাদের ওয়ার্কারে <code>Range</code> হেডার সাপোর্ট থাকায় IDM ১৬টি থ্রেড দিয়ে ফুল ৯০-৯৫ Mbps স্পিডে রিজিউমেবল ডাউনলোড করতে পারবে।</li>
      </ul>
    </div>

    <div class="footer">
      Powered by Cloudflare Workers &bull; Dhaka Edge Peering &bull; Built with &hearts; by mh-mahim
    </div>
  </div>

  <script>
    const origin = window.location.origin;

    function getAcceleratedUrl() {
      const input = document.getElementById('urlInput');
      const rawUrl = input.value.trim();
      if (!rawUrl) {
        alert('অনুগ্রহ করে একটি সঠিক ডাউনলোড লিংক দিন!');
        input.focus();
        return null;
      }
      try {
        new URL(rawUrl);
      } catch (e) {
        alert('ভুল URL ফরম্যাট! লিংকটি https:// বা http:// দিয়ে শুরু হতে হবে।');
        input.focus();
        return null;
      }
      return origin + '/?url=' + encodeURIComponent(rawUrl);
    }

    function handleDownload() {
      const accUrl = getAcceleratedUrl();
      if (!accUrl) return;
      window.location.href = accUrl;
    }

    function handleCopyLink() {
      const accUrl = getAcceleratedUrl();
      if (!accUrl) return;

      navigator.clipboard.writeText(accUrl).then(() => {
        const box = document.getElementById('statusBox');
        const display = document.getElementById('acceleratedUrlDisplay');
        const title = document.getElementById('statusTitle');
        
        title.innerText = '✅ লিংক কপি হয়েছে! (IDM এ পেস্ট করুন)';
        display.innerText = accUrl;
        box.classList.add('show');
      }).catch(() => {
        prompt('নিচের লিংকটি কপি করে নিন:', accUrl);
      });
    }
  </script>
</body>
</html>`;
}
