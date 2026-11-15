/**
 * CDNFlare - High-Speed Cloudflare Edge Download Accelerator & Reverse Proxy
 * Author: mh-mahim
 * Repository: https://github.com/mh-mahim/cdnflare
 * License: MIT
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

    // Only allow GET and HEAD requests
    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Method Not Allowed", { status: 405 });
    }

    // 1. Resilient Target URL Extraction
    // Handles query string without parameter truncation and path prefixes (/https://...)
    let targetUrlParam = extractTargetUrl(request.url);

    // If no target URL, render the clean English Web UI with Paste button
    if (!targetUrlParam) {
      return new Response(renderWebUI(requestUrl.origin), {
        headers: {
          "Content-Type": "text/html; charset=UTF-8",
          "Cache-Control": "public, max-age=3600"
        }
      });
    }

    // Optional Access Token Authentication
    if (env.ACCESS_TOKEN) {
      const userToken = requestUrl.searchParams.get("token") || request.headers.get("x-access-token");
      if (userToken !== env.ACCESS_TOKEN) {
        return renderError(request, "Unauthorized: Invalid or missing access token.", 401, targetUrlParam);
      }
    }

    // Validate and parse target URL
    let targetUrl;
    try {
      targetUrl = new URL(targetUrlParam.trim());
      if (targetUrl.protocol !== "http:" && targetUrl.protocol !== "https:") {
        return renderError(request, "Invalid URL protocol. Only HTTP and HTTPS protocols are supported.", 400, targetUrlParam);
      }
    } catch {
      return renderError(request, "Malformed target URL. Please provide a valid absolute URL.", 400, targetUrlParam);
    }

    // Prevent recursive proxy loops
    if (targetUrl.hostname === requestUrl.hostname) {
      return renderError(request, "Loop detected: The target URL cannot point to this accelerator.", 400, targetUrlParam);
    }

    // Construct forward headers
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

    // Realistic modern browser User-Agent
    const clientUA = request.headers.get("User-Agent");
    forwardHeaders.set(
      "User-Agent",
      clientUA && !clientUA.includes("Cloudflare-Workers")
        ? clientUA
        : "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36"
    );

    // Origin Referer: Never forward the worker's own domain as referer (avoids hotlink blocks)
    const clientReferer = request.headers.get("Referer");
    if (clientReferer && !clientReferer.includes(requestUrl.hostname)) {
      forwardHeaders.set("Referer", clientReferer);
    } else {
      forwardHeaders.set("Referer", targetUrl.origin + "/");
    }

    // Standard Accept headers
    forwardHeaders.set("Accept", request.headers.get("Accept") || "*/*");
    forwardHeaders.set("Accept-Language", request.headers.get("Accept-Language") || "en-US,en;q=0.9");

    // Fetch from origin
    try {
      const originResponse = await fetch(targetUrl.toString(), {
        method: request.method,
        headers: forwardHeaders,
        redirect: "follow",
        cf: {
          cacheEverything: true,
          cacheTtl: 86400
        }
      });

      // Prepare client response headers
      const responseHeaders = new Headers();

      const passHeaders = [
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
        if (passHeaders.includes(lowerKey)) {
          responseHeaders.set(key, value);
        }
      }

      // Ensure Accept-Ranges is enabled so IDM/Aria2 can slice into parallel chunks
      if (!responseHeaders.has("Accept-Ranges")) {
        responseHeaders.set("Accept-Ranges", "bytes");
      }

      // Extract filename from URL path if not provided
      let filename = "";
      const pathSegments = targetUrl.pathname.split("/").filter(Boolean);
      const lastSegment = pathSegments.pop();
      if (lastSegment && lastSegment.includes(".")) {
        filename = decodeURIComponent(lastSegment).replace(/[^\w.-]/g, "_");
      }

      // Ensure Content-Disposition enforces attachment for direct download trigger
      const existingDisp = responseHeaders.get("Content-Disposition");
      if (!existingDisp) {
        if (filename) {
          responseHeaders.set("Content-Disposition", `attachment; filename="${filename}"`);
        } else {
          responseHeaders.set("Content-Disposition", "attachment; filename=\"downloaded_file.bin\"");
        }
      } else if (!existingDisp.toLowerCase().includes("attachment")) {
        // If origin sent 'inline', replace with 'attachment' so browser downloads rather than opens
        responseHeaders.set("Content-Disposition", existingDisp.replace(/inline/i, "attachment"));
      }

      // CORS headers
      responseHeaders.set("Access-Control-Allow-Origin", "*");
      responseHeaders.set("Access-Control-Expose-Headers", "Content-Length, Content-Range, Accept-Ranges, Content-Disposition");

      // Accelerator signature headers
      responseHeaders.set("X-Accelerated-By", "CDNFlare-Edge");
      responseHeaders.set("X-Origin-Status", originResponse.status.toString());

      // If origin returned 4xx or 5xx, surface clean error
      if (originResponse.status >= 400 && !responseHeaders.get("Content-Range")) {
        return renderError(request, `Origin server returned HTTP ${originResponse.status}: ${originResponse.statusText}`, originResponse.status, targetUrl.toString());
      }

      // Stream directly to client without buffering entire body into RAM
      return new Response(originResponse.body, {
        status: originResponse.status,
        statusText: originResponse.statusText,
        headers: responseHeaders
      });

    } catch (err) {
      return renderError(
        request,
        `Failed to reach origin server: ${err.message || "Network Error"}. Please verify that the target URL is accessible and online.`,
        502,
        targetUrl.toString()
      );
    }
  }
};

/**
 * Robust target URL extractor that prevents query parameter truncation
 */
function extractTargetUrl(rawUrlString) {
  // Case 1: Query param e.g. /?url=...
  const queryIndex = rawUrlString.indexOf("?url=");
  if (queryIndex !== -1) {
    let extracted = rawUrlString.slice(queryIndex + 5);
    // If double encoded, decode once
    if (extracted.startsWith("http%3A") || extracted.startsWith("https%3A")) {
      try {
        extracted = decodeURIComponent(extracted);
      } catch {}
    }
    return extracted;
  }

  // Case 2: Path prefix e.g. /https://... or /http://...
  const parsed = new URL(rawUrlString);
  const path = parsed.pathname.slice(1);
  if (path.startsWith("http://") || path.startsWith("https://")) {
    return path + parsed.search;
  }

  return null;
}

function renderError(request, message, status = 500, targetUrl = "") {
  const accept = request.headers.get("Accept") || "";
  
  // Return JSON if caller is an API client or download manager
  if (!accept.includes("text/html")) {
    return new Response(
      JSON.stringify({
        success: false,
        status: status,
        error: message,
        target: targetUrl,
        timestamp: new Date().toISOString()
      }, null, 2),
      {
        status: status,
        headers: {
          "Content-Type": "application/json; charset=UTF-8",
          "Access-Control-Allow-Origin": "*"
        }
      }
    );
  }

  // Return stylish HTML error page for human browser users
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>CDNFlare | Connection Notice</title>
  <style>
    body { font-family: system-ui, -apple-system, sans-serif; background: #090d16; color: #f8fafc; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; padding: 1.5rem; }
    .card { background: #111827; border: 1px solid #1f293d; border-radius: 16px; padding: 2rem; max-width: 520px; width: 100%; box-shadow: 0 20px 40px rgba(0,0,0,0.6); }
    h2 { color: #f87171; font-size: 1.35rem; margin-top: 0; display: flex; align-items: center; gap: 0.5rem; }
    p { color: #94a3b8; font-size: 0.95rem; line-height: 1.5; margin: 1rem 0; }
    .url-box { background: #080c14; padding: 0.75rem; border-radius: 8px; font-family: monospace; font-size: 0.8rem; color: #38bdf8; word-break: break-all; border: 1px solid #1f293d; margin: 1rem 0; }
    .btn { display: inline-block; background: #38bdf8; color: #090d16; text-decoration: none; padding: 0.75rem 1.25rem; border-radius: 8px; font-weight: 600; font-size: 0.9rem; transition: 0.2s; }
    .btn:hover { background: #7dd3fc; }
  </style>
</head>
<body>
  <div class="card">
    <h2>⚠️ Unable to Stream Target File</h2>
    <p>${message}</p>
    ${targetUrl ? `<div class="url-box">Target: ${targetUrl}</div>` : ''}
    <p style="font-size: 0.85rem; color: #64748b;">Status Code: ${status}</p>
    <a href="/" class="btn">← Back to Dashboard</a>
  </div>
</body>
</html>`;

  return new Response(html, {
    status: status,
    headers: { "Content-Type": "text/html; charset=UTF-8" }
  });
}

function renderWebUI(origin) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>CDNFlare | High-Speed Edge Download Accelerator</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg: #090d16;
      --card-bg: #111827;
      --card-border: #1f293d;
      --accent: #38bdf8;
      --accent-glow: rgba(56, 189, 248, 0.16);
      --accent-hover: #0284c7;
      --text-main: #f8fafc;
      --text-muted: #94a3b8;
      --border-color: #334155;
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
      padding: 2rem 1.5rem;
      background-image: 
        radial-gradient(circle at 10% 15%, rgba(56, 189, 248, 0.1) 0%, transparent 45%),
        radial-gradient(circle at 90% 85%, rgba(14, 165, 233, 0.08) 0%, transparent 45%);
    }

    .container {
      width: 100%;
      max-width: 680px;
    }

    .header {
      text-align: center;
      margin-bottom: 2rem;
    }

    .badge {
      display: inline-flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.35rem 0.9rem;
      border-radius: 9999px;
      font-size: 0.8rem;
      font-weight: 600;
      background: var(--accent-glow);
      color: var(--accent);
      border: 1px solid rgba(56, 189, 248, 0.3);
      margin-bottom: 1.25rem;
    }

    .badge-dot {
      width: 8px;
      height: 8px;
      background: var(--accent);
      border-radius: 50%;
      box-shadow: 0 0 10px var(--accent);
    }

    h1 {
      font-size: 2.35rem;
      font-weight: 800;
      letter-spacing: -0.03em;
      line-height: 1.2;
      margin-bottom: 0.75rem;
    }

    .subtitle {
      color: var(--text-muted);
      font-size: 1rem;
      line-height: 1.5;
    }

    .card {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 18px;
      padding: 2rem;
      box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.7);
      margin-bottom: 1.5rem;
    }

    .input-label {
      display: flex;
      justify-content: space-between;
      font-size: 0.88rem;
      font-weight: 600;
      color: var(--text-muted);
      margin-bottom: 0.6rem;
    }

    .input-wrapper {
      position: relative;
      display: flex;
      align-items: center;
      margin-bottom: 1rem;
    }

    input[type="url"] {
      width: 100%;
      padding: 1rem 5.5rem 1rem 1.2rem;
      background: #090e17;
      border: 1px solid var(--border-color);
      border-radius: 12px;
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

    .paste-btn {
      position: absolute;
      right: 8px;
      background: #1e293b;
      border: 1px solid #334155;
      color: var(--accent);
      font-size: 0.8rem;
      font-weight: 600;
      padding: 0.5rem 0.85rem;
      border-radius: 8px;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 0.35rem;
      transition: all 0.15s ease;
    }

    .paste-btn:hover {
      background: #334155;
      border-color: var(--accent);
      transform: scale(1.02);
    }

    .speed-tip {
      font-size: 0.82rem;
      color: #94a3b8;
      background: #0c1322;
      border: 1px solid #1e293d;
      padding: 0.75rem 1rem;
      border-radius: 10px;
      margin-bottom: 1.25rem;
      line-height: 1.45;
    }

    .speed-tip a {
      color: var(--accent);
      text-decoration: underline;
    }

    .btn-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 0.75rem;
    }

    @media (max-width: 520px) {
      .btn-grid {
        grid-template-columns: 1fr;
      }
    }

    .btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 0.5rem;
      padding: 0.9rem 1.25rem;
      border-radius: 12px;
      font-size: 0.95rem;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s ease;
      text-decoration: none;
      border: none;
    }

    .btn-primary {
      background: var(--accent);
      color: #090e17;
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

    .output-panel {
      display: none;
      margin-top: 1.5rem;
      padding-top: 1.5rem;
      border-top: 1px solid var(--card-border);
    }

    .output-panel.active {
      display: block;
    }

    .tab-nav {
      display: flex;
      gap: 0.5rem;
      margin-bottom: 0.75rem;
      border-bottom: 1px solid #1f293d;
      padding-bottom: 0.5rem;
      overflow-x: auto;
    }

    .tab-btn {
      background: transparent;
      border: none;
      color: var(--text-muted);
      font-size: 0.85rem;
      font-weight: 600;
      padding: 0.4rem 0.8rem;
      border-radius: 6px;
      cursor: pointer;
      white-space: nowrap;
      transition: all 0.15s;
    }

    .tab-btn.active {
      background: #1e293b;
      color: var(--accent);
    }

    .code-container {
      position: relative;
      background: #080c14;
      border: 1px solid #1f293d;
      border-radius: 10px;
      padding: 0.9rem 1rem;
      font-family: 'JetBrains Mono', monospace;
      font-size: 0.85rem;
      color: #38bdf8;
      word-break: break-all;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 1rem;
    }

    .copy-icon-btn {
      background: #1e293b;
      border: 1px solid #334155;
      color: var(--text-main);
      padding: 0.4rem 0.75rem;
      border-radius: 6px;
      font-size: 0.75rem;
      font-weight: 600;
      cursor: pointer;
      white-space: nowrap;
      transition: all 0.15s;
    }

    .copy-icon-btn:hover {
      background: #334155;
      border-color: var(--accent);
    }

    .features-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 1rem;
      margin-bottom: 1.5rem;
    }

    @media (max-width: 600px) {
      .features-grid {
        grid-template-columns: 1fr;
      }
    }

    .feature-item {
      background: rgba(17, 24, 39, 0.6);
      border: 1px solid var(--card-border);
      border-radius: 12px;
      padding: 1rem;
      text-align: center;
    }

    .feature-icon {
      font-size: 1.25rem;
      margin-bottom: 0.35rem;
    }

    .feature-title {
      font-size: 0.85rem;
      font-weight: 700;
      color: var(--text-main);
      margin-bottom: 0.2rem;
    }

    .feature-desc {
      font-size: 0.75rem;
      color: var(--text-muted);
      line-height: 1.4;
    }

    .footer {
      text-align: center;
      font-size: 0.85rem;
      color: #64748b;
      line-height: 1.6;
    }

    .footer a {
      color: var(--accent);
      text-decoration: none;
    }

    .footer a:hover {
      text-decoration: underline;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div class="badge">
        <span class="badge-dot"></span>
        <span>Cloudflare Edge &bull; Low-Latency Anycast Routing</span>
      </div>
      <h1>CDNFlare</h1>
      <p class="subtitle">Jump your download speeds up to maximum edge line rate via Cloudflare</p>
    </div>

    <div class="card">
      <div class="input-label">
        <span>Enter Target Download URL</span>
        <span style="font-size: 0.75rem; color: #64748b;">Direct HTTP/HTTPS links</span>
      </div>

      <div class="input-wrapper">
        <input 
          type="url" 
          id="urlInput" 
          placeholder="https://example.com/slow-large-file.zip" 
          autocomplete="off" 
          spellcheck="false"
          required 
        />
        <button type="button" class="paste-btn" id="pasteBtn" onclick="handlePaste()" title="Paste from clipboard">
          <span>📋 Paste</span>
        </button>
      </div>

      <div class="speed-tip">
        ⚡ <strong>The Speed Jump:</strong> If your speed test at <a href="https://speed.cloudflare.com" target="_blank" rel="noopener">speed.cloudflare.com</a> is significantly faster than your direct download, CDNFlare routes your file through Cloudflare Edge to unlock full line speeds.
      </div>

      <div class="btn-grid">
        <button class="btn btn-primary" onclick="triggerDownload()">
          <span>🚀 Instant Download</span>
        </button>
        <button class="btn btn-secondary" onclick="generateLinks()">
          <span>📋 Generate Multi-Tool Links</span>
        </button>
      </div>

      <div id="outputPanel" class="output-panel">
        <div class="tab-nav">
          <button class="tab-btn active" onclick="switchTab('direct')">Direct URL / IDM</button>
          <button class="tab-btn" onclick="switchTab('aria2')">Aria2 (16 Threads)</button>
          <button class="tab-btn" onclick="switchTab('curl')">cURL</button>
          <button class="tab-btn" onclick="switchTab('wget')">Wget</button>
        </div>

        <div class="code-container">
          <span id="codeDisplay"></span>
          <button class="copy-icon-btn" id="copyBtn" onclick="copyCurrentSnippet()">Copy</button>
        </div>
      </div>
    </div>

    <div class="features-grid">
      <div class="feature-item">
        <div class="feature-icon">🚀</div>
        <div class="feature-title">Speed Jump Engine</div>
        <div class="feature-desc">Unlocks full edge peering speed when direct origin downloads are throttled.</div>
      </div>
      <div class="feature-item">
        <div class="feature-icon">⚡</div>
        <div class="feature-title">HTTP 206 Multi-Range</div>
        <div class="feature-desc">Full <code>Range</code> support for IDM, multi-threaded slicing, and resuming.</div>
      </div>
      <div class="feature-item">
        <div class="feature-icon">🌐</div>
        <div class="feature-title">Zero-Buffer Pipeline</div>
        <div class="feature-desc">Direct edge streaming supporting arbitrary file sizes with no RAM limits.</div>
      </div>
    </div>

    <div class="footer">
      CDNFlare &bull; Open Source on <a href="https://github.com/mh-mahim/cdnflare" target="_blank" rel="noopener">GitHub</a> &bull; Crafted by <a href="https://github.com/mh-mahim" target="_blank" rel="noopener">mh-mahim</a>
    </div>
  </div>

  <script>
    const origin = window.location.origin;
    let currentTab = 'direct';
    let currentUrl = '';

    async function handlePaste() {
      const input = document.getElementById('urlInput');
      const btn = document.getElementById('pasteBtn');
      try {
        const text = await navigator.clipboard.readText();
        if (text) {
          input.value = text.trim();
          btn.innerHTML = '<span>✅ Pasted!</span>';
          btn.style.color = '#10b981';
          btn.style.borderColor = '#10b981';
          setTimeout(() => {
            btn.innerHTML = '<span>📋 Paste</span>';
            btn.style.color = '';
            btn.style.borderColor = '';
          }, 1800);
        }
      } catch (err) {
        // Fallback if browser requires user gesture / permission
        input.focus();
        input.select();
        alert('Please press Ctrl+V to paste your link.');
      }
    }

    function getValidatedUrl() {
      const input = document.getElementById('urlInput');
      const raw = input.value.trim();
      if (!raw) {
        alert('Please enter or paste a valid download link!');
        input.focus();
        return null;
      }
      try {
        const u = new URL(raw);
        if (u.protocol !== 'http:' && u.protocol !== 'https:') {
          throw new Error('Only HTTP/HTTPS are supported');
        }
        return raw;
      } catch (e) {
        alert('Invalid URL format! Ensure the link begins with http:// or https://');
        input.focus();
        return null;
      }
    }

    function triggerDownload() {
      const url = getValidatedUrl();
      if (!url) return;
      window.location.href = origin + '/?url=' + encodeURIComponent(url);
    }

    function generateLinks() {
      const url = getValidatedUrl();
      if (!url) return;
      currentUrl = url;

      document.getElementById('outputPanel').classList.add('active');
      renderSnippet();
    }

    function switchTab(tab) {
      currentTab = tab;
      document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.classList.toggle('active', btn.innerText.toLowerCase().includes(tab));
      });
      renderSnippet();
    }

    function renderSnippet() {
      if (!currentUrl) return;
      const acceleratedUrl = origin + '/?url=' + encodeURIComponent(currentUrl);
      const display = document.getElementById('codeDisplay');
      
      switch (currentTab) {
        case 'direct':
          display.innerText = acceleratedUrl;
          break;
        case 'aria2':
          display.innerText = 'aria2c -s 16 -x 16 "' + acceleratedUrl + '"';
          break;
        case 'curl':
          display.innerText = 'curl -L -O -C - "' + acceleratedUrl + '"';
          break;
        case 'wget':
          display.innerText = 'wget -c "' + acceleratedUrl + '"';
          break;
      }
    }

    function copyCurrentSnippet() {
      const text = document.getElementById('codeDisplay').innerText;
      if (!text) return;

      navigator.clipboard.writeText(text).then(() => {
        const btn = document.getElementById('copyBtn');
        btn.innerText = 'Copied!';
        btn.style.color = '#10b981';
        btn.style.borderColor = '#10b981';
        setTimeout(() => {
          btn.innerText = 'Copy';
          btn.style.color = '';
          btn.style.borderColor = '';
        }, 2000);
      }).catch(() => {
        prompt('Copy to clipboard:', text);
      });
    }
  </script>
</body>
</html>`;
}
