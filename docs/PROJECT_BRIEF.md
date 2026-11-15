# Project Brief: CDNFlare

## 🎯 Executive Summary
Downloading files directly from distant or unoptimized international servers often suffers from high latency, packet loss, and severe ISP throttling down to 2–5 Mbps.

**CDNFlare** solves this problem by using Cloudflare Workers as a transparent, high-speed reverse proxy edge. When a user inputs a target file URL into the system, Cloudflare's global edge network fetches the file directly over its enterprise-grade backbone and streams it to the user through the nearest local edge PoP, achieving full line speed.

## 🚀 Key Objectives
1. **Accelerated Throughput:** Bypass slow international routing and leverage local Cloudflare edge peering.
2. **Download Manager Friendly:** Full support for HTTP `Range` requests, enabling tools like IDM or Aria2 to download in 8–16 simultaneous threads.
3. **Zero Configuration UI:** A simple, modern web dashboard accessible from both mobile and desktop.
4. **Cost:** Operates 100% within Cloudflare Workers' generous free tier (100,000 requests/day).
