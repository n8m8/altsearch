# Security Review - Altsearch

## ✅ Safe to Open-Source

The worker code contains no secrets, credentials, or proprietary logic. All sensitive data is handled via environment variables.

## Current Security Posture

### Input Validation
- ✅ Query length limited to 200 characters
- ✅ Max results capped at 10
- ✅ Proper URL encoding for search queries
- ✅ JSON parsing with error handling

### API Key Security
- ✅ API keys stored in environment variables (`env.BRAVE_API_KEY`, `env.OPENROUTER_API_KEY`)
- ✅ Keys never exposed to frontend
- ✅ All API calls are server-side only
- ✅ No keys in git repository

### CORS Configuration
- ✅ CORS headers properly configured
- ✅ Supports both origin validation and wildcard
- ⚠️ **Current:** Permissive for development (`origin || "*"`)
- 💡 **Production:** Already safe, but could restrict to specific domain if needed

### Prompt Injection Prevention
- ✅ User input clearly separated in prompts
- ✅ No code execution from AI responses
- ✅ JSON parsing with fallback handling
- ✅ Input sanitized through URL encoding

### Data Privacy
- ✅ No user data stored server-side
- ✅ No cookies or tracking
- ✅ Transparent disclosure about AI processing
- ✅ Queries processed by: Brave Search API, OpenRouter (NVIDIA Nemotron)
- ✅ No PII collected

### Rate Limiting
- ⚠️ **Missing:** No rate limiting implemented
- 💡 **Recommendation:** Add Cloudflare rate limiting rule in dashboard:
  - 30 requests per minute per IP
  - 500 requests per hour per IP

## Recommendations for Production

### 1. Add Rate Limiting (Cloudflare Dashboard)
```
Security > WAF > Rate Limiting Rules
Rule: "Altsearch API rate limit"
Match: 
  - Path: /api/*
  - Method: POST
Characteristics: IP address
Rate: 30 requests per 1 minute
Action: Block for 60 seconds
```

### 2. Optional: Restrict CORS (not required)
If you want to lock down to your domain only:
```javascript
function corsHeaders(origin) {
  const allowed = ["https://nataliefloraa.com"];
  return {
    "Access-Control-Allow-Origin": allowed.includes(origin) ? origin : allowed[0],
    ...
  };
}
```

### 3. Monitor API Usage
- Set up Cloudflare Workers analytics
- Monitor OpenRouter usage dashboard
- Set billing alerts on both Brave and OpenRouter

### 4. Consider Adding (Optional)
- Request ID logging for debugging
- Response caching for popular queries (30min TTL)
- User-Agent validation (block obvious bots)

## What's Safe to Share Publicly

✅ **Safe:**
- Entire worker.js code
- HTML/CSS/JavaScript frontend
- Configuration defaults (blocklist, model name)
- This security documentation

❌ **Never share:**
- API keys (already in environment variables)
- wrangler.toml with account details
- .env file
- Deployment credentials

## API Cost Protections

**Brave Search API:**
- Free tier: 2,000 queries/month
- Current usage pattern: ~1 query per search
- Rate limiting will prevent abuse

**OpenRouter API:**
- NVIDIA Nemotron is free tier
- No cost per request
- Streaming prevents timeout issues

**Risk Assessment:** LOW
- Free APIs used
- Input validation prevents abuse
- No credential exposure
- Cloudflare Workers free tier sufficient

## Open-Source Checklist

Before publishing to GitHub:

- [x] No hardcoded secrets
- [x] Environment variables documented
- [x] Security review completed
- [ ] Add LICENSE file (MIT recommended)
- [ ] Add README with setup instructions
- [ ] Add example .env.example file
- [ ] Document required Wrangler secrets
- [ ] Add deployment instructions

## Example .env.example

Create this file for open-source repo:

```bash
# Brave Search API Key
# Get from: https://brave.com/search/api/
BRAVE_API_KEY=your_brave_api_key_here

# OpenRouter API Key  
# Get from: https://openrouter.ai/
OPENROUTER_API_KEY=your_openrouter_api_key_here
```

## Deployment Security

```bash
# Set secrets via wrangler (never commit .env)
wrangler secret put BRAVE_API_KEY
wrangler secret put OPENROUTER_API_KEY

# Deploy
wrangler deploy
```

---

**Last reviewed:** 2026-03-21  
**Status:** ✅ Safe to open-source  
**Risk level:** LOW
