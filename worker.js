/**
 * Small Business Finder - Cloudflare Worker (Simplified)
 * Makes searches upfront, then asks AI to filter/format results
 */

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

async function braveSearch(query, count, env, blocklist = []) {
  // Don't use negative search terms in Brave (causes 422 errors)
  // Let AI filter the blocklist instead
  let searchQuery = query;
  
  const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(searchQuery)}&count=${count}`;
  
  const response = await fetch(url, {
    headers: {
      "Accept": "application/json",
      "X-Subscription-Token": env.BRAVE_API_KEY
    }
  });
  
  if (!response.ok) {
    const errorBody = await response.text();
    console.error(`Brave Search 422 details:`, { 
      query: searchQuery, 
      queryLength: searchQuery.length,
      error: errorBody 
    });
    throw new Error(`Brave Search failed: ${response.status} - ${errorBody}`);
  }
  
  const data = await response.json();
  return (data.web?.results || []).map(item => ({
    title: item.title || "",
    url: item.url || "",
    description: item.description || ""
  }));
}

async function findAlternatives(query, blocklist, location, maxResults, env, progressCallback = null) {
  const sendProgress = (step, message, data = {}) => {
    if (progressCallback) progressCallback(step, message, data);
  };
  // Single optimized search
  const searches = [
    `${query} independent small business online shop`
  ];
  
  sendProgress(1, 'Searching the web...', { searches: searches.length });
  
  // Execute single search
  const allResults = [];
  const searchQuery = searches[0];
  
  try {
    sendProgress(1, 'Searching the web...');
    const results = await braveSearch(searchQuery, 20, env, blocklist); // Get more results from single search
    allResults.push(...results);
  } catch (e) {
    console.error(`Search failed for "${searchQuery}":`, e);
    throw new Error('Search failed: ' + e.message);
  }
  
  sendProgress(2, `Found ${allResults.length} potential retailers`);
  
  // Ask AI to filter and format
  const blocklistStr = blocklist.map(b => `"${b}"`).join(", ");
  const locationText = location ? `\n- Location preference: "${location}"` : "";
  
  const prompt = `I found ${allResults.length} web search results for "${query}". 

Your task: Select the BEST small business/independent retailer options from these results, AND provide a brief summary of the results quality.

RESULT COUNT GUIDANCE:
- If you find many excellent independent options (10+), return up to 15 results
- If options are limited or lower quality, aim for around 5 results
- Quality over quantity - don't pad the list with mediocre options
- It's okay to return fewer than 5 if that's all the good options available

EXCLUDE these retailers: ${blocklistStr}${locationText}

Search Results:
${JSON.stringify(allResults, null, 2)}

Return a JSON object with this EXACT structure:
{
  "summary": "Brief 1-2 sentence assessment of result quality. Be honest: if you couldn't find great small business options and had to include chains, admit it. If results are limited, suggest trying a broader search.",
  "quality": "excellent|good|fair|limited",
  "results": [
    {
      "name": "Retailer Name",
      "url": "https://direct-product-url.com",
      "description": "Why this is a good option (deals, shipping, specialty)",
      "location": "City, State",
      "distance_miles": 50,
      "is_chain": false
    }
  ]
}

CRITICAL REQUIREMENTS:
- Small businesses and specialty shops (NOT major chains)
- Retailers that actually sell "${query}" - verify from search results
- MUST have online store/direct-to-consumer capability
- If location provided, verify they ship to that region/country
- Exclude anything matching the blocklist
- Only include retailers where you can confirm online ordering is available
- Prefer ${location ? `options that ship to ${location}` : 'retailers with clear shipping policies'}
- Provide helpful descriptions including shipping info when available

LOCATION/DISTANCE INSTRUCTIONS:
${location ? `- Calculate approximate distance in miles from ${location} to nearest physical location (if they have one)
- If they have multiple locations (chain), find the CLOSEST to ${location}
- Set is_chain:true if multiple locations exist
- Set distance_miles to null if purely online-only (no physical stores)` : `- Set distance_miles to null for all results (no user location to measure from)
- Note if retailer is online-only vs has physical locations`}

SUMMARY GUIDELINES:
- Be honest about result quality
- Mention how many results you're returning and why (e.g., "Found 12 excellent independent options" or "Limited to 4 results - few alternatives available")
- If you had to include blocklisted retailers because no alternatives exist, admit it in summary
- If options are limited/poor, suggest trying a broader search term
- Quality ratings: "excellent" (many true small businesses), "good" (mostly small businesses), "fair" (mix of small + regional chains), "limited" (mostly chains or very few options)

Return ONLY the JSON object (with summary, quality, and results), nothing else.`;

  sendProgress(3, 'AI is analyzing results...');
  
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
      messages: [{ role: "user", content: prompt }],
      temperature: 0.7,
      stream: true
    })
  });
  
  if (!response.ok) {
    const error = await response.text();
    throw new Error(`OpenRouter failed: ${response.status} - ${error}`);
  }
  
  // Stream tokens from OpenRouter
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let content = '';
  let buffer = '';
  
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    
    for (const line of lines) {
      if (!line.trim() || line === 'data: [DONE]') continue;
      if (!line.startsWith('data: ')) continue;
      
      try {
        const json = JSON.parse(line.slice(6));
        const delta = json.choices?.[0]?.delta?.content;
        if (delta) {
          content += delta;
          // Send progress update with partial content
          sendProgress(3, 'AI is generating response...', { 
            partialContent: content.substring(0, 100) + '...' 
          });
        }
      } catch (e) {
        // Skip malformed JSON
      }
    }
  }
  
  // Parse JSON
  let text = content.trim();
  if (text.includes("```json")) {
    const start = text.indexOf("```json") + 7;
    const end = text.indexOf("```", start);
    text = text.substring(start, end).trim();
  } else if (text.includes("```")) {
    const start = text.indexOf("```") + 3;
    const end = text.indexOf("```", start);
    text = text.substring(start, end).trim();
  }
  
  const parsed = JSON.parse(text);
  
  // Handle both old array format and new object format
  if (Array.isArray(parsed)) {
    return {
      summary: "Found several options for your search.",
      quality: "good",
      results: parsed
    };
  }
  
  return parsed;
}

function corsHeaders(origin) {
  return {
    "Access-Control-Allow-Origin": origin || "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  };
}

async function handleRequest(request, env) {
  const url = new URL(request.url);
  const origin = request.headers.get("Origin");
  
  if (request.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders(origin) });
  }
  
  if (url.pathname === "/" && request.method === "GET") {
    return new Response(HTML, {
      headers: { "Content-Type": "text/html", ...corsHeaders(origin) }
    });
  }
  
  if (url.pathname === "/api/config" && request.method === "GET") {
    return new Response(JSON.stringify({
      default_blocklist: CONFIG.default_blocklist,
      max_results: CONFIG.max_results,
      categories: CONFIG.categories
    }), {
      headers: { "Content-Type": "application/json", ...corsHeaders(origin) }
    });
  }
  
  // SSE streaming endpoint
  if (url.pathname === "/api/search-stream" && request.method === "POST") {
    try {
      const data = await request.json();
      
      const query = (data.query || "").trim();
      if (!query || query.length > 200) {
        return new Response(JSON.stringify({ error: "Invalid query" }), {
          status: 400,
          headers: { "Content-Type": "application/json", ...corsHeaders(origin) }
        });
      }
      
      const blocklist = data.blocklist || CONFIG.default_blocklist;
      const location = (data.location || "").trim() || null;
      const maxResults = Math.min(data.max_results || CONFIG.max_results, 10);
      
      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        async start(controller) {
          const send = (event, data) => {
            const message = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
            controller.enqueue(encoder.encode(message));
          };
          
          try {
            // Step 1: Search
            send('progress', { step: 1, message: 'Searching the web...' });
            
            const searchQuery = `${query} independent small business online shop`;
            const searchResults = await braveSearch(searchQuery, 20, env, blocklist);
            
            send('progress', { step: 2, message: `Found ${searchResults.length} potential retailers` });
            
            // Step 3: AI analysis with streaming
            send('progress', { step: 3, message: 'AI is analyzing results...' });
            
            const prompt = `I found ${searchResults.length} web search results for "${query}". 

Your task: Select the BEST small business/independent retailer options from these results, AND provide a brief summary of the results quality.

RESULT COUNT GUIDANCE:
- If you find many excellent independent options (10+), return up to 15 results
- If options are limited or lower quality, aim for around 5 results
- Quality over quantity - don't pad the list with mediocre options
- It's okay to return fewer than 5 if that's all the good options available

EXCLUDE these retailers: ${blocklist.join(', ')}${location ? `\n\nPrefer options that ship to: ${location}` : ''}

Search Results:
${JSON.stringify(searchResults, null, 2)}

Return a JSON object with this EXACT structure:
{
  "summary": "Brief 1-2 sentence assessment of result quality. Be honest: if you couldn't find great small business options and had to include chains, admit it. If results are limited, suggest trying a broader search.",
  "quality": "excellent|good|fair|limited",
  "results": [
    {
      "name": "Retailer Name",
      "url": "https://direct-product-url.com",
      "description": "Why this is a good option (deals, shipping, specialty)",
      "location": "City, State",
      "distance_miles": 50,
      "is_chain": false
    }
  ]
}

CRITICAL REQUIREMENTS:
- Small businesses and specialty shops (NOT major chains)
- Retailers that actually sell "${query}" - verify from search results
- MUST have online store/direct-to-consumer capability
- If location provided, verify they ship to that region/country
- Exclude anything matching the blocklist
- Only include retailers where you can confirm online ordering is available
- Prefer ${location ? `options that ship to ${location}` : 'retailers with clear shipping policies'}
- Provide helpful descriptions including shipping info when available

LOCATION/DISTANCE INSTRUCTIONS:
${location ? `- Calculate approximate distance in miles from ${location} to nearest physical location (if they have one)
- If they have multiple locations (chain), find the CLOSEST to ${location}
- Set is_chain:true if multiple locations exist
- Set distance_miles to null if purely online-only (no physical stores)` : `- Set distance_miles to null for all results (no user location to measure from)
- Note if retailer is online-only vs has physical locations`}

SUMMARY GUIDELINES:
- Be honest about result quality
- Mention how many results you're returning and why (e.g., "Found 12 excellent independent options" or "Limited to 4 results - few alternatives available")
- If you had to include blocklisted retailers because no alternatives exist, admit it in summary
- If options are limited/poor, suggest trying a broader search term
- Quality ratings: "excellent" (many true small businesses), "good" (mostly small businesses), "fair" (mix of small + regional chains), "limited" (mostly chains or very few options)

Return ONLY the JSON object (with summary, quality, and results), nothing else.`;

            const aiResponse = await fetch("https://openrouter.ai/api/v1/chat/completions", {
              method: "POST",
              headers: {
                "Authorization": `Bearer ${env.OPENROUTER_API_KEY}`,
                "Content-Type": "application/json",
                "HTTP-Referer": "https://nataliefloraa.com",
                "X-Title": "Altsearch"
              },
              body: JSON.stringify({
                model: CONFIG.default_model,
                messages: [{ role: "user", content: prompt }],
                temperature: 0.7,
                stream: true
              })
            });
            
            if (!aiResponse.ok) {
              const error = await aiResponse.text();
              throw new Error(`OpenRouter failed: ${aiResponse.status} - ${error}`);
            }
            
            // Stream AI response
            const aiReader = aiResponse.body.getReader();
            const aiDecoder = new TextDecoder();
            let content = '';
            let aiBuffer = '';
            
            while (true) {
              const { done, value } = await aiReader.read();
              if (done) break;
              
              aiBuffer += aiDecoder.decode(value, { stream: true });
              const lines = aiBuffer.split('\n');
              aiBuffer = lines.pop() || '';
              
              for (const line of lines) {
                if (!line.trim() || line === 'data: [DONE]') continue;
                if (!line.startsWith('data: ')) continue;
                
                try {
                  const json = JSON.parse(line.slice(6));
                  const delta = json.choices?.[0]?.delta?.content;
                  if (delta) {
                    content += delta;
                    // Send streaming update
                    send('progress', { 
                      step: 3, 
                      message: 'AI is generating response...', 
                      partialContent: content.substring(0, 150) + (content.length > 150 ? '...' : '')
                    });
                  }
                } catch (e) {
                  // Skip malformed JSON
                }
              }
            }
            
            // Parse final JSON response
            let text = content.trim();
            if (text.includes("```json")) {
              const start = text.indexOf("```json") + 7;
              const end = text.indexOf("```", start);
              text = text.substring(start, end).trim();
            } else if (text.includes("```")) {
              const start = text.indexOf("```") + 3;
              const end = text.indexOf("```", start);
              text = text.substring(start, end).trim();
            }
            
            const parsed = JSON.parse(text);
            const searchData = Array.isArray(parsed) ? {
              summary: "Found several options for your search.",
              quality: "good",
              results: parsed
            } : parsed;
            
            send('result', {
              summary: searchData.summary,
              quality: searchData.quality,
              results: searchData.results,
              query,
              count: searchData.results.length
            });
            
          } catch (error) {
            console.error("Search error:", error);
            send('error', {
              error: "Search failed",
              details: error.message
            });
          }
          
          controller.close();
        }
      });
      
      return new Response(stream, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          "Connection": "keep-alive",
          ...corsHeaders(origin)
        }
      });
      
    } catch (error) {
      console.error("SSE error:", error);
      return new Response(JSON.stringify({
        error: "Request failed",
        details: error.message
      }), {
        status: 500,
        headers: { "Content-Type": "application/json", ...corsHeaders(origin) }
      });
    }
  }
  
  if (url.pathname === "/api/search" && request.method === "POST") {
    try {
      const data = await request.json();
      
      const query = (data.query || "").trim();
      if (!query || query.length > 200) {
        return new Response(JSON.stringify({ error: "Invalid query" }), {
          status: 400,
          headers: { "Content-Type": "application/json", ...corsHeaders(origin) }
        });
      }
      
      const blocklist = data.blocklist || CONFIG.default_blocklist;
      const location = (data.location || "").trim() || null;
      const maxResults = Math.min(data.max_results || CONFIG.max_results, 10);
      
      // Get search preview early
      if (data.get_preview) {
        const searches = [
          `${query} independent retailer online`,
          `${query} small business shop`
        ];
        
        const previewResults = [];
        for (const searchQuery of searches.slice(0, 2)) {
          try {
            const results = await braveSearch(searchQuery, 10, env, blocklist);
            previewResults.push(...results);
          } catch (e) {
            console.error("Preview search failed:", e);
          }
        }
        
        return new Response(JSON.stringify({
          preview: previewResults.slice(0, 15)
        }), {
          headers: { "Content-Type": "application/json", ...corsHeaders(origin) }
        });
      }
      
      const searchData = await findAlternatives(query, blocklist, location, maxResults, env);
      
      return new Response(JSON.stringify({
        summary: searchData.summary,
        quality: searchData.quality,
        results: searchData.results,
        query,
        count: searchData.results.length
      }), {
        headers: { "Content-Type": "application/json", ...corsHeaders(origin) }
      });
      
    } catch (error) {
      console.error("Search error:", error);
      return new Response(JSON.stringify({
        error: "Search failed",
        details: error.message
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

const HTML = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Altsearch | Find online small businesses</title>
  <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><ellipse cx='50' cy='55' rx='35' ry='40' fill='%23FFF44F'/><ellipse cx='50' cy='55' rx='30' ry='35' fill='%23FFEB3B'/><ellipse cx='40' cy='45' rx='8' ry='10' fill='%23FFF9C4' opacity='0.6'/><path d='M 45 15 Q 50 10, 55 15 L 50 25 Z' fill='%2388C057'/></svg>">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'Courier New', Courier, monospace;
      background: #F5F5DC;
      min-height: 100vh;
      padding: 20px;
      color: #2b1f0f;
    }
    .container { max-width: 900px; margin: 0 auto; }
    .header { text-align: center; margin-bottom: 40px; border: 4px solid #2b1f0f; padding: 20px; background: #fff; }
    .header h1 { font-size: 2.5em; margin-bottom: 10px; font-weight: 900; text-transform: uppercase; }
    .search-card {
      background: #fff;
      border: 4px solid #2b1f0f;
      padding: 30px;
      margin-bottom: 30px;
    }
    label { display: block; font-weight: 700; margin-bottom: 8px; text-transform: uppercase; font-size: 0.9em; letter-spacing: 1px; }
    input { width: 100%; padding: 12px; margin: 8px 0; border: 3px solid #2b1f0f; font-size: 16px; font-family: 'Courier New', monospace; background: #fff; }
    button {
      width: 100%;
      padding: 14px;
      background: #2b1f0f;
      color: #F5F5DC;
      border: 4px solid #2b1f0f;
      font-size: 18px;
      font-weight: 900;
      cursor: pointer;
      margin-top: 20px;
      text-transform: uppercase;
      letter-spacing: 2px;
      font-family: 'Courier New', monospace;
    }
    button:hover { background: #F5F5DC; color: #2b1f0f; }
    button:disabled { opacity: 0.4; cursor: not-allowed; }
    .btn-small {
      padding: 6px 12px;
      font-size: 14px;
      width: auto;
      margin: 0 4px;
      display: inline-block;
    }
    .results { display: none; }
    .results.show { display: block; }
    .accordion {
      margin: 20px 0;
      border: 3px solid #2b1f0f;
      background: #fff;
    }
    .accordion-header {
      padding: 12px;
      cursor: pointer;
      font-weight: 900;
      text-transform: uppercase;
      font-size: 0.9em;
      letter-spacing: 1px;
      background: #fff;
      border-bottom: 3px solid #2b1f0f;
    }
    .accordion-header:hover { background: #f0f0f0; }
    .accordion-content {
      padding: 16px;
      display: none;
    }
    .accordion-content.show { display: block; }
    .blocklist-item {
      display: inline-block;
      padding: 6px 12px;
      margin: 4px;
      border: 2px solid #2b1f0f;
      background: #fff;
      cursor: pointer;
      font-family: 'Courier New', monospace;
    }
    .blocklist-item:hover { background: #2b1f0f; color: #F5F5DC; }
    .blocklist-toolbar { margin-bottom: 12px; }
    .summary-card {
      background: white;
      border: 4px solid #2b1f0f;
      padding: 20px;
      margin-bottom: 24px;
    }
    .summary-card.excellent { border-color: #2d5016; }
    .summary-card.good { border-color: #2b1f0f; }
    .summary-card.fair { border-color: #8b4513; }
    .summary-card.limited { border-color: #8b0000; }
    .summary-title { font-weight: 900; margin-bottom: 8px; text-transform: uppercase; }
    .summary-text { line-height: 1.5; }
    .result-card {
      background: white;
      border: 4px solid #2b1f0f;
      padding: 24px;
      margin-bottom: 20px;
    }
    .result-name { font-size: 1.4em; font-weight: 900; margin-bottom: 8px; text-transform: uppercase; }
    .result-url { color: #2b1f0f; display: block; margin-bottom: 8px; word-break: break-all; text-decoration: underline; }
    .progress {
      background: white;
      border: 4px solid #2b1f0f;
      padding: 24px;
      margin-bottom: 30px;
      display: none;
    }
    .progress.show { display: block; }
    .progress-step {
      display: flex;
      align-items: center;
      margin-bottom: 12px;
      font-family: 'Courier New', monospace;
    }
    .progress-step.active { font-weight: 900; }
    .progress-step.done { opacity: 0.5; }
    .progress-icon { margin-right: 12px; font-size: 1.2em; }
    .error { background: #ffcdd2; color: #8b0000; padding: 16px; border: 3px solid #8b0000; margin-bottom: 20px; display: none; font-family: 'Courier New', monospace; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>🍋 Altsearch</h1>
      <p>Find independent online retailers as alternatives to major chains</p>
      <div style="margin-top: 16px; font-size: 0.85em; border-top: 2px solid #2b1f0f; padding-top: 12px; text-align: left;">
        <strong>AI Data Collection Notice:</strong> This tool uses <a href="https://openrouter.ai/nvidia/nemotron-3-super-120b-a12b:free" target="_blank" style="color: #2b1f0f; text-decoration: underline;">NVIDIA Nemotron 3 Super (free)</a> via OpenRouter and <a href="https://brave.com/search/api/" target="_blank" style="color: #2b1f0f; text-decoration: underline;">Brave Search API</a> to analyze search results and suggest alternatives. Your queries may be processed by these services to provide results. This is how we can offer the tool for free.
      </div>
    </div>
    <div class="search-card">
      <label for="query">Product Search</label>
      <input type="text" id="query" placeholder="e.g., zupreem bird food">
      
      <label for="location" style="margin-top: 16px;">Location (Optional)</label>
      <input type="text" id="location" placeholder="e.g., Austin, TX">
      
      <div class="accordion">
        <div class="accordion-header" id="settingsToggle">⚙️ Settings</div>
        <div class="accordion-content" id="settingsContent">
          <div style="font-weight: 900; margin-bottom: 8px;">COMPANY BLOCKLIST</div>
          <div class="blocklist-toolbar">
            <button class="btn-small" id="addBlocklistBtn">+ Add</button>
            <button class="btn-small" id="clearBlocklistBtn">Remove All</button>
          </div>
          <div id="blocklistContainer"></div>
          <input type="text" id="blocklistInput" placeholder="Company name..." style="margin-top: 12px; display: none;">
        </div>
      </div>
      
      <button id="searchBtn">Find Alternatives</button>
    </div>
    <div id="error" class="error"></div>
    <div id="progress" class="progress">
      <div id="step1" class="progress-step"><span class="progress-icon">⏳</span> Searching the web...</div>
      <div id="step2" class="progress-step"><span class="progress-icon">⏳</span> Finding small businesses...</div>
      <div id="searchPreview" style="display:none; margin: 16px 0; padding: 12px; background: #f5f5f5; border-radius: 8px; color: #666; font-size: 0.9em;"></div>
      <div id="step3" class="progress-step"><span class="progress-icon">⏳</span> Verifying availability...</div>
      <div id="step4" class="progress-step"><span class="progress-icon">⏳</span> Reasoning...</div>
      <div id="aiProgress" style="display:none; margin-top: 12px;">
        <div style="background: #e0e0e0; height: 6px; border-radius: 3px; overflow: hidden;">
          <div id="aiProgressBar" style="background: linear-gradient(90deg, #667eea, #764ba2); height: 100%; width: 0%; transition: width 0.5s;"></div>
        </div>
      </div>
    </div>
    <div id="results" class="results"></div>
  </div>
  <script>
    const searchBtn = document.getElementById('searchBtn');
    const progress = document.getElementById('progress');
    const results = document.getElementById('results');
    const errorDiv = document.getElementById('error');
    
    let blocklist = [];
    
    // Load default blocklist
    fetch('/api/config')
      .then(r => r.json())
      .then(config => {
        blocklist = config.default_blocklist || [];
        renderBlocklist();
      });
    
    // Accordion toggle
    document.getElementById('settingsToggle').onclick = () => {
      const content = document.getElementById('settingsContent');
      content.classList.toggle('show');
    };
    
    // Render blocklist
    function renderBlocklist() {
      const container = document.getElementById('blocklistContainer');
      container.innerHTML = blocklist.map(item => 
        \`<span class="blocklist-item" data-item="\${item}">\${item}</span>\`
      ).join('');
    }
    
    // Remove item from blocklist
    document.getElementById('blocklistContainer').addEventListener('click', (e) => {
      if (e.target.classList.contains('blocklist-item')) {
        const item = e.target.getAttribute('data-item');
        blocklist = blocklist.filter(b => b !== item);
        renderBlocklist();
      }
    });
    
    // Add to blocklist
    const blocklistInput = document.getElementById('blocklistInput');
    document.getElementById('addBlocklistBtn').onclick = () => {
      blocklistInput.style.display = 'block';
      blocklistInput.focus();
    };
    
    blocklistInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        const value = blocklistInput.value.trim().toLowerCase();
        if (value && !blocklist.includes(value)) {
          blocklist.push(value);
          renderBlocklist();
        }
        blocklistInput.value = '';
        blocklistInput.style.display = 'none';
      }
    });
    
    // Clear all
    document.getElementById('clearBlocklistBtn').onclick = () => {
      if (confirm('Remove all blocked companies?')) {
        blocklist = [];
        renderBlocklist();
      }
    };
    
    function updateProgress(step, message = null) {
      const steps = [
        { id: 'step1', default: 'Searching the web...' },
        { id: 'step2', default: 'Finding small businesses...' },
        { id: 'step3', default: 'Verifying availability...' },
        { id: 'step4', default: 'AI is compiling results...' }
      ];
      
      steps.forEach((s, i) => {
        const el = document.getElementById(s.id);
        if (i < step) {
          el.classList.remove('active');
          el.classList.add('done');
          el.querySelector('.progress-icon').textContent = '✓';
        } else if (i === step) {
          el.classList.add('active');
          el.querySelector('.progress-icon').textContent = '⏳';
          // Update text if message provided (but not for step 3 - handled by interval)
          if (message && i !== 3) {
            const textPart = el.childNodes[1];
            if (textPart) textPart.textContent = ' ' + message;
          }
        } else {
          el.classList.remove('active', 'done');
          el.querySelector('.progress-icon').textContent = '⏳';
        }
      });
    }
    
    searchBtn.onclick = async () => {
      const query = document.getElementById('query').value.trim();
      if (!query) return alert('Please enter a search query');
      
      const location = document.getElementById('location').value.trim();
      
      searchBtn.disabled = true;
      progress.classList.add('show');
      results.innerHTML = '';
      results.classList.remove('show');
      errorDiv.style.display = 'none';
      document.getElementById('searchPreview').style.display = 'none';
      document.getElementById('aiProgress').style.display = 'none';
      
      updateProgress(0);
      
      try {
        // Use SSE for real-time progress
        const response = await fetch('/api/search-stream', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ 
            query, 
            location: location || null, 
            blocklist: blocklist,
            max_results: 5 
          })
        });
        
        if (!response.ok) {
          const data = await response.json();
          errorDiv.textContent = data.error + (data.details ? ': ' + data.details : '');
          errorDiv.style.display = 'block';
          searchBtn.disabled = false;
          return;
        }
        
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\\n\\n');
          buffer = lines.pop(); // Keep incomplete message in buffer
          
          for (const line of lines) {
            if (!line.trim()) continue;
            
            const eventMatch = line.match(/^event: (.+)$/m);
            const dataMatch = line.match(/^data: (.+)$/m);
            
            if (!eventMatch || !dataMatch) continue;
            
            const event = eventMatch[1];
            const data = JSON.parse(dataMatch[1]);
            
            if (event === 'progress') {
              updateProgress(data.step, data.message);
              
              // Show search results count as preview
              if (data.step === 2 && data.message) {
                const previewEl = document.getElementById('searchPreview');
                previewEl.innerHTML = data.message;
                previewEl.style.display = 'block';
              }
              
              // Show detailed search progress
              if (data.step === 1 && data.resultsFound !== undefined) {
                const previewEl = document.getElementById('searchPreview');
                previewEl.innerHTML = \`Found \${data.resultsFound} results so far...\`;
                previewEl.style.display = 'block';
              }
              
              // Show AI streaming content
              if (data.step === 3) {
                document.getElementById('aiProgress').style.display = 'block';
                
                // Show partial content if available
                if (data.partialContent) {
                  const previewEl = document.getElementById('searchPreview');
                  previewEl.innerHTML = \`<strong>AI generating:</strong><br><code style="font-size:0.85em; color:#666;">\${data.partialContent}</code>\`;
                  previewEl.style.display = 'block';
                }
                
                // Sophisticated progress bar with stage transitions
                if (!window._aiProgressInterval) {
                  let pct = 0;
                  let elapsed = 0;
                  const step4El = document.getElementById('step4');
                  const textNode = step4El.childNodes[1];
                  
                  const interval = setInterval(() => {
                    elapsed++;
                    
                    // Change message based on elapsed time
                    if (elapsed < 20) {
                      if (textNode) textNode.textContent = ' Reasoning...';
                      pct = Math.min(pct + 1.5, 30); // Slow to 30% over 20s
                    } else if (elapsed < 25) {
                      if (textNode) textNode.textContent = ' This usually takes between 60-90 seconds...';
                      pct = Math.min(pct + 2, 35); // Brief pause
                    } else if (elapsed < 50) {
                      if (textNode) textNode.textContent = ' Analyzing...';
                      pct = Math.min(pct + 2, 75); // Speed up to 75%
                    } else if (elapsed < 75) {
                      if (textNode) textNode.textContent = ' Compiling results...';
                      pct = Math.min(pct + 1, 95); // Slow to 95%
                    } else {
                      // After 75s, stick at 98%
                      pct = 98;
                    }
                    
                    document.getElementById('aiProgressBar').style.width = pct + '%';
                  }, 1000);
                  window._aiProgressInterval = interval;
                }
              }
            }
            
            if (event === 'result') {
              // Clear progress bar interval
              if (window._aiProgressInterval) {
                clearInterval(window._aiProgressInterval);
                document.getElementById('aiProgressBar').style.width = '100%';
              }
              
              // Render results
              let summaryHTML = '';
              if (data.summary) {
                const qualityEmoji = {
                  excellent: '✨',
                  good: '👍',
                  fair: '⚠️',
                  limited: '⚠️'
                };
                summaryHTML = \`
                  <div class="summary-card \${data.quality || 'good'}">
                    <div class="summary-title">\${qualityEmoji[data.quality] || '💡'} Results Overview</div>
                    <div class="summary-text">\${data.summary}</div>
                  </div>
                \`;
              }
              
              results.innerHTML = summaryHTML + data.results.map((r, i) => {
                let locationInfo = '';
                if (r.location) {
                  if (r.distance_miles !== null && r.distance_miles !== undefined) {
                    if (r.distance_miles < 300) {
                      locationInfo = \`📍 \${r.location} (\${Math.round(r.distance_miles)} mi away)\${r.is_chain ? ' • Multiple locations' : ''}\`;
                    } else {
                      locationInfo = \`🌐 Online store • Nearest location: \${r.location}\`;
                    }
                  } else {
                    locationInfo = \`🌐 Online only\`;
                  }
                }
                
                return \`
                  <div class="result-card">
                    <div class="result-name">\${i+1}. \${r.name}</div>
                    <a href="\${r.url}" target="_blank" class="result-url">\${r.url}</a>
                    <div>\${r.description}</div>
                    \${locationInfo ? \`<div style="color:#999;margin-top:8px">\${locationInfo}</div>\` : ''}
                  </div>
                \`;
              }).join('');
              results.classList.add('show');
              
              setTimeout(() => {
                progress.classList.remove('show');
              }, 500);
            }
            
            if (event === 'error') {
              errorDiv.textContent = data.error + (data.details ? ': ' + data.details : '');
              errorDiv.style.display = 'block';
            }
          }
        }
        
      } catch (err) {
        errorDiv.textContent = 'Request failed: ' + err.message;
        errorDiv.style.display = 'block';
      } finally {
        searchBtn.disabled = false;
      }
    };
  </script>
</body>
</html>`;
