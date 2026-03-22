# 🍋 Altsearch

Find independent online retailers as alternatives to major chains. Powered by AI and Brave Search.

## Features

- 🔍 **Smart Search** - AI analyzes web results to find genuine small businesses
- 🌐 **Online Focus** - Filters for stores with e-commerce capabilities
- 🚫 **Blocklist** - Automatically excludes major chains (Amazon, Walmart, etc.)
- 📍 **Location Aware** - Prioritizes nearby options when location provided
- ⚡ **Fast** - Server-sent events for real-time progress updates
- 🔒 **Secure** - All API keys server-side, never exposed to client

## Tech Stack

- **Frontend:** Brutalist single-page app (inline HTML/CSS/JS)
- **Backend:** Cloudflare Workers (serverless, global edge)
- **AI:** NVIDIA Nemotron 3 Super via OpenRouter (free tier)
- **Search:** Brave Search API
- **Streaming:** Server-Sent Events for real-time updates

## Quick Deploy

### Prerequisites

- [Cloudflare account](https://dash.cloudflare.com/sign-up)
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/install-and-update/)
- [OpenRouter API key](https://openrouter.ai/) (free)
- [Brave Search API key](https://brave.com/search/api/)

### Setup

1. **Clone and install:**
```bash
git clone https://github.com/yourusername/altsearch.git
cd altsearch
npm install -g wrangler  # If not installed
```

2. **Configure secrets:**
```bash
# Copy example env file
cp .env.example .env

# Edit .env with your API keys
# OPENROUTER_API_KEY=your_key_here
# BRAVE_API_KEY=your_key_here
```

3. **Deploy:**
```bash
wrangler deploy

# Set secrets (will prompt for values)
wrangler secret put OPENROUTER_API_KEY
wrangler secret put BRAVE_API_KEY
```

4. **Visit your worker URL:**
```
https://small-biz-finder.your-subdomain.workers.dev
```

## Local Development

```bash
# Create .env with your API keys
cp .env.example .env

# Start dev server (reads from .env automatically)
wrangler dev

# Open http://localhost:8787
```

## Configuration

### Custom Domain

Edit `wrangler.toml`:
```toml
routes = [
  { pattern = "altsearch.yourdomain.com", custom_domain = true }
]
```

### Adjust Blocklist

Edit `worker.js`:
```javascript
default_blocklist: [
  "amazon", "walmart", "target", // Add more here
]
```

## API Documentation

### GET /

Single-page webapp interface

### GET /api/config

Returns public configuration:
```json
{
  "default_blocklist": ["amazon", "walmart", ...],
  "max_results": 5,
  "categories": { ... }
}
```

### POST /api/search-stream

Server-sent events endpoint. Streams progress updates:

**Request:**
```json
{
  "query": "bird food",
  "location": "Austin, TX",
  "blocklist": ["amazon", "walmart"],
  "max_results": 5
}
```

**Response (SSE stream):**
```
event: progress
data: {"step":1,"message":"Searching the web..."}

event: progress
data: {"step":2,"message":"Found 20 potential retailers"}

event: progress
data: {"step":3,"message":"Reasoning...","partialContent":"..."}

event: result
data: {"results":[...],"summary":"...","quality":"good"}
```

## Cost Estimate

- **Cloudflare Workers:** Free tier (100k req/day)
- **OpenRouter (Nemotron):** Free
- **Brave Search:** 2,000 free queries/month, then $5/1k queries

**Typical usage:** $0-5/month for small-scale deployment

## Security

See [SECURITY.md](SECURITY.md) for full security review.

**Highlights:**
- ✅ No hardcoded secrets
- ✅ API keys stored in Cloudflare Workers secrets
- ✅ Input validation (200 char limit, max 10 results)
- ✅ CORS properly configured
- ✅ No user data stored
- ✅ Transparent AI disclosure in UI

**Recommended:** Add rate limiting in Cloudflare dashboard (30 req/min per IP)

## Monitoring

**View logs:**
```bash
wrangler tail
```

**Analytics:**
- Cloudflare Workers dashboard
- OpenRouter usage dashboard
- Brave Search API dashboard

## Embed Options

### iFrame
```html
<iframe src="https://your-worker.workers.dev" 
        width="100%" height="800px" 
        style="border: 4px solid #2b1f0f;">
</iframe>
```

### Direct Link
```html
<a href="https://your-worker.workers.dev">
  🍋 Find Small Business Alternatives
</a>
```

## Contributing

Private repo for now. Open-source release coming soon.

## License

MIT License - see [LICENSE](LICENSE)

## Acknowledgments

- **AI Model:** NVIDIA Nemotron 3 Super (via OpenRouter)
- **Search:** Brave Search API
- **Hosting:** Cloudflare Workers
- **Design:** Brutalist web design principles

---

**Questions?** Open an issue or contact [@nataliefloraa](https://github.com/n8m8)
