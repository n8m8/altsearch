#!/bin/bash
# Deploy Altsearch to Cloudflare Workers

echo "🚀 Deploying to Cloudflare Workers..."

# Deploy the worker
wrangler deploy

echo ""
echo "✅ Deployed! Now set your secrets:"
echo ""
echo "Run these commands to set your API keys:"
echo "  wrangler secret put OPENROUTER_API_KEY"
echo "  wrangler secret put BRAVE_API_KEY"
echo ""
echo "Get your API keys from:"
echo "  - OpenRouter: https://openrouter.ai/"
echo "  - Brave Search: https://brave.com/search/api/"
echo ""
