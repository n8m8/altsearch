# Small Business Finder - Cloudflare Workers

Serverless single-page webapp that finds small business alternatives to major retailers. Secure deployment with API keys protected in Cloudflare Workers.

## Quick Deploy

```bash
cd webapp
./deploy.sh
```

Then set secrets:
```bash
wrangler secret put OPENROUTER_API_KEY
# Paste: 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

wrangler secret put BRAVE_API_KEY
# Paste: BSAdmh5EzSvMrBlpcX79n9FdjAu7I_K
```

## What It Does

1. **User searches** for a product (e.g., "zupreem bird food")
2. **Cloudflare Worker** receives request (API keys stay secure)
3. **AI (Nemotron)** uses Brave Search to research retailers
4. **Returns** curated list of small business alternatives

## Architecture

- **Frontend:** Single HTML page (inline in worker.js)
- **Backend:** Cloudflare Worker (serverless, global edge network)
- **AI:** OpenRouter API (nvidia/nemotron-3-super-120b-a12b:free)
- **Search:** Brave Search API (tool calling)
- **Secrets:** Stored in Cloudflare (never exposed to client)

## Security

✅ API keys stored as Cloudflare secrets  
✅ Server-side AI and search API calls only  
✅ CORS headers configured  
✅ Input validation (query length, blocklist size)  
✅ Rate limiting via Cloudflare (automatic)  
✅ No database required  

## API Endpoints

### GET /
Single-page webapp interface

### GET /api/config
Returns public config (blocklist, categories)

### POST /api/search
```json
{
  "query": "product name",
  "location": "Austin, TX",
  "blocklist": ["amazon", "walmart"],
  "max_results": 5
}
```

Returns:
```json
{
  "results": [
    {
      "name": "Retailer Name",
      "url": "https://...",
      "description": "...",
      "location": "City, State"
    }
  ],
  "query": "product name",
  "count": 1
}
```

## Local Development

```bash
wrangler dev
```

Visit http://localhost:8787

## Custom Domain

Edit `wrangler.toml`:
```toml
routes = [
  { pattern = "finder.nataliefloraa.com", custom_domain = true }
]
```

Then deploy:
```bash
wrangler deploy
```

## Cost

- Cloudflare Workers: 100k requests/day free
- OpenRouter (Nemotron free model): $0
- Brave Search API: Pay per search (check pricing)

Estimated cost: ~$0-5/month for moderate use

## Monitoring

View logs:
```bash
wrangler tail
```

Check analytics in Cloudflare dashboard

## Embed on Your Website

Add to any page:
```html
<iframe src="https://small-biz-finder.your-subdomain.workers.dev" 
        width="100%" height="800px" 
        style="border: none; border-radius: 12px;">
</iframe>
```

Or link directly:
```html
<a href="https://small-biz-finder.your-subdomain.workers.dev">
  Find Small Business Alternatives
</a>
```
