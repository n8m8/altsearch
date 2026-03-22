#!/bin/bash
# Deploy Small Business Finder to Cloudflare Workers

echo "🚀 Deploying to Cloudflare Workers..."

# Deploy the worker
wrangler deploy

echo ""
echo "✅ Deployed! Now set your secrets:"
echo ""
echo "Run these commands:"
echo "  wrangler secret put OPENROUTER_API_KEY"
echo "  (paste: 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)"
echo ""
echo "  wrangler secret put BRAVE_API_KEY"
echo "  (paste: BSAdmh5EzSvMrBlpcX79n9FdjAu7I_K)"
echo ""
