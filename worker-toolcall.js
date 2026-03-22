/**
 * Small Business Finder - Cloudflare Worker
 * Secure serverless backend that proxies AI and search API calls
 */

// Load config from KV or inline
const CONFIG = {
  default_model: "nvidia/nemotron-3-super-120b-a12b:free",
  max_results: 5,
  default_blocklist: [
    "amazon", "walmart", "target", "petco", "petsmart", "chewy",
    "costco", "samsclub", "ebay", "alibaba", "aliexpress",
    "bestbuy", "homedepot", "lowes", "walgreens", "cvs"
  ],
  categories: {
    pet_supplies: ["petco", "petsmart", "chewy", "petland"],
    electronics: ["bestbuy", "newegg", "microcenter"],
    food: ["kroger", "safeway", "albertsons", "wholefoodsmarket"],
    home_goods: ["homedepot", "lowes", "menards", "acehardware"],
    clothing: ["gap", "oldnavy", "hm", "zara", "uniqlo"]
  }
};

const SYSTEM_PROMPT = `You are a research assistant helping users find small business and independent retailer alternatives to major chains.

## Your Capabilities

You have access to web search via Brave Search API. Use it to:
1. Find independent retailers and specialty shops
2. Verify they have online ordering capability
3. Check for deals, shipping policies, and specialty focus
4. Identify physical locations when available

## Your Task

When given a product query and blocklist:
1. **Search strategically** - Use multiple search queries:
   - "{product} independent retailer"
   - "{product} small business online"
   - "{product} specialty shop"

2. **Verify retailers** - For each potential match:
   - Check they sell the actual product
   - Confirm online ordering capability
   - Note deals or shipping policies
   - Confirm they're small/independent (not major chain)

3. **Apply blocklist** - Exclude blocklisted retailers (case-insensitive)

4. **Consider location** (if provided) - Prefer nearby retailers, but still include great online options

5. **Return structured results** as JSON array:
[
  {
    "name": "Retailer Name",
    "url": "https://direct-product-url.com",
    "description": "Brief note (deals, shipping, specialty)",
    "location": "City, State" // or "Online only"
  }
]

Be thorough. Use multiple searches. Verify everything. Return only JSON.`;

// Brave Search tool definition
const BRAVE_SEARCH_TOOL = {
  type: "function",
  function: {
    name: "brave_search",
    description: "Search the web using Brave Search API",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query" },
        count: { type: "integer", description: "Results (1-10)", default: 5 }
      },
      required: ["query"]
    }
  }
};

async function braveSearch(query, count = 5, env) {
  const response = await fetch(
    `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${Math.min(count, 10)}`,
    {
      headers: {
        "Accept": "application/json",
        "X-Subscription-Token": env.BRAVE_API_KEY
      }
    }
  );
  
  if (!response.ok) {
    throw new Error(`Brave Search failed: ${response.status}`);
  }
  
  const data = await response.json();
  return (data.web?.results || []).map(item => ({
    title: item.title || "",
    url: item.url || "",
    description: item.description || ""
  }));
}

async function queryOpenRouter(systemPrompt, userPrompt, env) {
  const messages = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userPrompt }
  ];
  
  let iteration = 0;
  const maxIterations = 10;
  
  while (iteration < maxIterations) {
    iteration++;
    
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${env.OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://nataliefloraa.com",
        "X-Title": "Small Business Finder"
      },
      body: JSON.stringify({
        model: CONFIG.default_model,
        messages: messages,
        tools: [BRAVE_SEARCH_TOOL]
      })
    });
    
    if (!response.ok) {
      throw new Error(`OpenRouter failed: ${response.status}`);
    }
    
    const data = await response.json();
    const choice = data.choices[0];
    const message = choice.message;
    
    messages.push(message);
    
    // Done if no tool calls
    if (choice.finish_reason === "stop" || !message.tool_calls) {
      return message.content;
    }
    
    // Process tool calls
    for (const toolCall of message.tool_calls || []) {
      if (toolCall.function.name === "brave_search") {
        const args = JSON.parse(toolCall.function.arguments);
        const results = await braveSearch(args.query, args.count || 5, env);
        
        messages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: JSON.stringify(results)
        });
      }
    }
  }
  
  throw new Error("Max iterations reached");
}

function buildUserPrompt(query, blocklist, location, maxResults) {
  const blocklistStr = blocklist.map(b => `"${b}"`).join(", ");
  const locationText = location ? `\n- Location preference: "${location}"` : "";
  
  return `Find ${maxResults} small business/independent retailer alternatives for this product:

- Product: "${query}"
- Exclude these retailers: ${blocklistStr}${locationText}

Use web search to find options. Return ONLY a JSON array with this structure:
[
  {
    "name": "Retailer Name",
    "url": "https://direct-product-url.com",
    "description": "Brief note (deals, shipping, specialty)",
    "location": "City, State" // or "Online only"
  }
]`;
}

function parseJsonResponse(text) {
  text = text.trim();
  
  // Strip markdown code blocks
  if (text.includes("```json")) {
    const start = text.indexOf("```json") + 7;
    const end = text.indexOf("```", start);
    text = text.substring(start, end).trim();
  } else if (text.includes("```")) {
    const start = text.indexOf("```") + 3;
    const end = text.indexOf("```", start);
    text = text.substring(start, end).trim();
  }
  
  return JSON.parse(text);
}

function corsHeaders(origin) {
  return {
    "Access-Control-Allow-Origin": origin || "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400"
  };
}

async function handleRequest(request, env) {
  const url = new URL(request.url);
  const origin = request.headers.get("Origin");
  
  // CORS preflight
  if (request.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders(origin) });
  }
  
  // Serve static HTML at root
  if (url.pathname === "/" && request.method === "GET") {
    return new Response(HTML, {
      headers: {
        "Content-Type": "text/html",
        ...corsHeaders(origin)
      }
    });
  }
  
  // Config endpoint
  if (url.pathname === "/api/config" && request.method === "GET") {
    return new Response(JSON.stringify({
      default_blocklist: CONFIG.default_blocklist,
      max_results: CONFIG.max_results,
      categories: CONFIG.categories
    }), {
      headers: {
        "Content-Type": "application/json",
        ...corsHeaders(origin)
      }
    });
  }
  
  // Search endpoint
  if (url.pathname === "/api/search" && request.method === "POST") {
    try {
      const data = await request.json();
      
      // Validate
      const query = (data.query || "").trim();
      if (!query) {
        return new Response(JSON.stringify({ error: "Query required" }), {
          status: 400,
          headers: { "Content-Type": "application/json", ...corsHeaders(origin) }
        });
      }
      
      if (query.length > 200) {
        return new Response(JSON.stringify({ error: "Query too long" }), {
          status: 400,
          headers: { "Content-Type": "application/json", ...corsHeaders(origin) }
        });
      }
      
      const blocklist = data.blocklist || CONFIG.default_blocklist;
      const location = (data.location || "").trim() || null;
      const maxResults = Math.min(data.max_results || CONFIG.max_results, 10);
      
      // Build prompts
      const userPrompt = buildUserPrompt(query, blocklist, location, maxResults);
      
      // Query AI with tool calling
      const response = await queryOpenRouter(SYSTEM_PROMPT, userPrompt, env);
      
      // Parse results
      const results = parseJsonResponse(response);
      
      return new Response(JSON.stringify({
        results,
        query,
        count: results.length
      }), {
        headers: {
          "Content-Type": "application/json",
          ...corsHeaders(origin)
        }
      });
      
    } catch (error) {
      console.error("Search error:", error);
      return new Response(JSON.stringify({
        error: "Search failed. Please try again.",
        details: error.message,
        stack: error.stack
      }), {
        status: 500,
        headers: { "Content-Type": "application/json", ...corsHeaders(origin) }
      });
    }
  }
  
  return new Response("Not Found", { status: 404 });
}

export default {
  async fetch(request, env, ctx) {
    return handleRequest(request, env);
  }
};

// Inline HTML (will be replaced with actual frontend)
const HTML = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Small Business Finder</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      min-height: 100vh;
      padding: 20px;
    }
    .container { max-width: 900px; margin: 0 auto; }
    .header { text-align: center; color: white; margin-bottom: 40px; }
    .header h1 { font-size: 2.5em; margin-bottom: 10px; }
    .search-card {
      background: white;
      border-radius: 12px;
      padding: 30px;
      box-shadow: 0 10px 40px rgba(0,0,0,0.1);
      margin-bottom: 30px;
    }
    input { width: 100%; padding: 12px; margin: 8px 0; border: 2px solid #e0e0e0; border-radius: 8px; font-size: 16px; }
    button {
      width: 100%;
      padding: 14px;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      border: none;
      border-radius: 8px;
      font-size: 18px;
      font-weight: 600;
      cursor: pointer;
      margin-top: 20px;
    }
    button:disabled { opacity: 0.6; cursor: not-allowed; }
    .results { display: none; }
    .results.show { display: block; }
    .result-card {
      background: white;
      border-radius: 12px;
      padding: 24px;
      margin-bottom: 20px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.1);
    }
    .result-name { font-size: 1.4em; font-weight: 700; margin-bottom: 8px; }
    .result-url { color: #667eea; display: block; margin-bottom: 8px; }
    .loading { text-align: center; color: white; padding: 40px; display: none; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>🏪 Small Business Finder</h1>
      <p>Find independent retailers as alternatives to major chains</p>
    </div>
    <div class="search-card">
      <input type="text" id="query" placeholder="What are you looking for? (e.g., zupreem bird food)">
      <input type="text" id="location" placeholder="Location (optional, e.g., Austin, TX)">
      <button id="searchBtn">Find Alternatives</button>
    </div>
    <div id="loading" class="loading">Searching...</div>
    <div id="results" class="results"></div>
  </div>
  <script>
    const searchBtn = document.getElementById('searchBtn');
    const loading = document.getElementById('loading');
    const results = document.getElementById('results');
    
    searchBtn.onclick = async () => {
      const query = document.getElementById('query').value.trim();
      if (!query) return alert('Please enter a search query');
      
      const location = document.getElementById('location').value.trim();
      
      searchBtn.disabled = true;
      loading.style.display = 'block';
      results.innerHTML = '';
      results.classList.remove('show');
      
      try {
        const response = await fetch('/api/search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query, location: location || null, max_results: 5 })
        });
        
        const data = await response.json();
        if (!response.ok) throw new Error(data.error);
        
        results.innerHTML = data.results.map((r, i) => \`
          <div class="result-card">
            <div class="result-name">\${i+1}. \${r.name}</div>
            <a href="\${r.url}" target="_blank" class="result-url">\${r.url}</a>
            <div>\${r.description}</div>
            \${r.location ? \`<div style="color:#999;margin-top:8px">📍 \${r.location}</div>\` : ''}
          </div>
        \`).join('');
        results.classList.add('show');
      } catch (err) {
        alert('Search failed: ' + err.message);
      } finally {
        searchBtn.disabled = false;
        loading.style.display = 'none';
      }
    };
  </script>
</body>
</html>`;
