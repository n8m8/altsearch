#!/usr/bin/env python3
"""
Small Business Finder - Web API Server
Provides REST API and serves frontend for finding alternative retailers.
Uses OpenRouter with Brave Search tool calling for client-side research.
"""

import os
import sys
import json
import yaml
import requests
from pathlib import Path
from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS

# Add parent directory to path to import from references
WEBAPP_DIR = Path(__file__).parent
SKILL_DIR = WEBAPP_DIR.parent
sys.path.insert(0, str(SKILL_DIR))

CONFIG_PATH = SKILL_DIR / "references" / "config.yaml"
SYSTEM_PROMPT_PATH = SKILL_DIR / "references" / "system-prompt.md"

app = Flask(__name__, static_folder='static')
CORS(app)  # Enable CORS for frontend development


def load_config():
    """Load configuration from references/config.yaml"""
    with open(CONFIG_PATH) as f:
        return yaml.safe_load(f)


def load_system_prompt():
    """Load system prompt from references/system-prompt.md"""
    with open(SYSTEM_PROMPT_PATH) as f:
        return f.read()


def build_user_prompt(query, blocklist, location=None, max_results=5):
    """Build user prompt for the AI"""
    blocklist_str = ", ".join([f'"{item}"' for item in blocklist])
    
    location_text = ""
    if location:
        location_text = f'\n- Location preference: "{location}"'
    
    prompt = f"""Find {max_results} small business/independent retailer alternatives for this product:

- Product: "{query}"
- Exclude these retailers: {blocklist_str}{location_text}

Use web search to find options. Return ONLY a JSON array with this structure:
[
  {{
    "name": "Retailer Name",
    "url": "https://direct-product-url.com",
    "description": "Brief note (deals, shipping, specialty)",
    "location": "City, State" // or "Online only"
  }}
]"""

    return prompt


# Brave Search tool definition for OpenRouter
BRAVE_SEARCH_TOOL = {
    "type": "function",
    "function": {
        "name": "brave_search",
        "description": "Search the web using Brave Search API. Returns titles, URLs, and descriptions.",
        "parameters": {
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "Search query string"
                },
                "count": {
                    "type": "integer",
                    "description": "Number of results to return (1-10)",
                    "default": 5
                }
            },
            "required": ["query"]
        }
    }
}


def brave_search(query, count=5):
    """Execute Brave Search API call"""
    api_key = os.getenv("BRAVE_API_KEY")
    if not api_key:
        raise ValueError("BRAVE_API_KEY environment variable not set")
    
    url = "https://api.search.brave.com/res/v1/web/search"
    headers = {
        "Accept": "application/json",
        "Accept-Encoding": "gzip",
        "X-Subscription-Token": api_key
    }
    params = {
        "q": query,
        "count": min(count, 10)
    }
    
    response = requests.get(url, headers=headers, params=params, timeout=10)
    response.raise_for_status()
    
    data = response.json()
    results = []
    
    for item in data.get("web", {}).get("results", []):
        results.append({
            "title": item.get("title", ""),
            "url": item.get("url", ""),
            "description": item.get("description", "")
        })
    
    return results


def query_openrouter_with_tools(system_prompt, user_prompt, model):
    """Query OpenRouter with tool calling support"""
    api_key = os.getenv("OPENROUTER_API_KEY")
    if not api_key:
        raise ValueError("OPENROUTER_API_KEY environment variable not set")
    
    url = "https://openrouter.ai/api/v1/chat/completions"
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
        "HTTP-Referer": "https://openclaw.ai",
        "X-Title": "Small Business Finder"
    }
    
    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": user_prompt}
    ]
    
    max_iterations = 10  # Prevent infinite loops
    iteration = 0
    
    while iteration < max_iterations:
        iteration += 1
        
        payload = {
            "model": model,
            "messages": messages,
            "tools": [BRAVE_SEARCH_TOOL]
        }
        
        response = requests.post(url, headers=headers, json=payload, timeout=60)
        response.raise_for_status()
        
        data = response.json()
        choice = data["choices"][0]
        message = choice["message"]
        
        # Add assistant's response to conversation
        messages.append(message)
        
        # Check if we're done (no tool calls)
        if choice.get("finish_reason") == "stop" or not message.get("tool_calls"):
            # Extract final response
            content = message.get("content", "")
            return content
        
        # Process tool calls
        tool_calls = message.get("tool_calls", [])
        for tool_call in tool_calls:
            if tool_call["function"]["name"] == "brave_search":
                args = json.loads(tool_call["function"]["arguments"])
                search_results = brave_search(
                    args.get("query"),
                    args.get("count", 5)
                )
                
                # Add tool response to conversation
                messages.append({
                    "role": "tool",
                    "tool_call_id": tool_call["id"],
                    "content": json.dumps(search_results)
                })
    
    raise Exception("Max iterations reached without completion")


def parse_json_response(text):
    """Parse JSON from AI response, handling markdown code blocks"""
    text = text.strip()
    
    # Strip markdown code blocks if present
    if "```json" in text:
        start = text.find("```json") + 7
        end = text.find("```", start)
        text = text[start:end].strip()
    elif "```" in text:
        start = text.find("```") + 3
        end = text.find("```", start)
        text = text[start:end].strip()
    
    return json.loads(text)


@app.route('/')
def index():
    """Serve frontend"""
    return send_from_directory('static', 'index.html')


@app.route('/api/config', methods=['GET'])
def get_config():
    """Get current configuration"""
    config = load_config()
    return jsonify({
        "default_blocklist": config.get("default_blocklist", []),
        "default_model": config.get("default_model", "nvidia/nemotron-3-super-120b-a12b:free"),
        "max_results": config.get("max_results", 5),
        "categories": config.get("categories", {})
    })


@app.route('/api/search', methods=['POST'])
def search():
    """Search for alternative retailers using AI with tool calling"""
    data = request.json
    
    # Validate input
    query = data.get("query", "").strip()
    if not query:
        return jsonify({"error": "Query is required"}), 400
    
    # Get parameters with defaults
    config = load_config()
    blocklist = data.get("blocklist") or config.get("default_blocklist", [])
    location = data.get("location", "").strip() or None
    max_results = data.get("max_results") or config.get("max_results", 5)
    model = data.get("model") or config.get("default_model", "nvidia/nemotron-3-super-120b-a12b:free")
    
    try:
        # Load prompts
        system_prompt = load_system_prompt()
        user_prompt = build_user_prompt(query, blocklist, location, max_results)
        
        # Query AI with tool calling
        response = query_openrouter_with_tools(system_prompt, user_prompt, model)
        
        # Parse results
        results = parse_json_response(response)
        
        return jsonify({
            "results": results,
            "query": query,
            "count": len(results)
        })
        
    except Exception as e:
        return jsonify({
            "error": str(e),
            "query": query
        }), 500


@app.route('/api/models', methods=['GET'])
def get_models():
    """Get available OpenRouter models"""
    config = load_config()
    return jsonify({
        "default": config.get("default_model", "nvidia/nemotron-3-super-120b-a12b:free"),
        "models": [
            {
                "id": "nvidia/nemotron-3-super-120b-a12b:free",
                "name": "Nemotron 3 Super (Free)",
                "description": "NVIDIA's free model with tool calling support"
            },
            {
                "id": "anthropic/claude-3.5-sonnet",
                "name": "Claude 3.5 Sonnet",
                "description": "Best accuracy, thorough research"
            },
            {
                "id": "anthropic/claude-3-haiku",
                "name": "Claude 3 Haiku",
                "description": "Fastest, cheapest for simple queries"
            },
            {
                "id": "openai/gpt-4-turbo",
                "name": "GPT-4 Turbo",
                "description": "Fast, reliable, good for most queries"
            }
        ]
    })


if __name__ == '__main__':
    import argparse
    
    parser = argparse.ArgumentParser(description='Small Business Finder API Server')
    parser.add_argument('--host', default='localhost', help='Host to bind to')
    parser.add_argument('--port', type=int, default=5000, help='Port to listen on')
    parser.add_argument('--debug', action='store_true', help='Enable debug mode')
    
    args = parser.parse_args()
    
    # Check for API keys
    if not os.getenv("OPENROUTER_API_KEY"):
        print("Warning: OPENROUTER_API_KEY environment variable not set", file=sys.stderr)
        print("Set it with: export OPENROUTER_API_KEY='your-key'", file=sys.stderr)
    
    if not os.getenv("BRAVE_API_KEY"):
        print("Warning: BRAVE_API_KEY environment variable not set", file=sys.stderr)
        print("Set it with: export BRAVE_API_KEY='your-key'", file=sys.stderr)
        print("Get one at: https://brave.com/search/api/", file=sys.stderr)
    
    app.run(host=args.host, port=args.port, debug=args.debug)
