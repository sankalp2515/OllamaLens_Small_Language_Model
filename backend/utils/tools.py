"""
tools.py
--------
Tool definitions and executor for the ReAct (Reason + Act) loop.

HOW TOOL USE WORKS WITH OLLAMA (local models):
  Unlike GPT-4 which has native function calling, local models like
  phi3:mini and mistral:7b don't natively emit structured tool calls.
  
  Instead we use a PROMPTING APPROACH:
  1. We inject tool definitions into the system prompt in a format
     the model can understand (XML-style tags).
  2. The model responds with a tool call like:
     <tool_call>{"name": "web_search", "args": {"query": "weather Mumbai"}}</tool_call>
  3. Our backend detects this pattern, executes the real tool,
     injects the result back, and lets the model continue.
  
  This is called the ReAct loop: Reason → Act → Observe → Reason again.

WHY NOT USE OLLAMA'S NATIVE TOOL CALLING?
  Ollama 0.3+ supports tool calling for some models, but:
  - phi3:mini does not support it natively
  - mistral q4_K_M has inconsistent tool call formatting
  - The prompting approach works reliably across all three models
  - It gives us full control over the tool call format

ALL TOOLS ARE ZERO COST:
  - web_search: DuckDuckGo HTML scraping (free, no API key)
  - get_weather: Open-Meteo API (free, no API key, no rate limit)
  - get_date_time: system clock (free)
  - calculator: Python eval with safety sandbox (free)
  - wikipedia: Wikipedia REST API (free, no API key)
"""

import json
import re
import math
import datetime
import httpx
import logging

logger = logging.getLogger(__name__)

# ─────────────────────────────────────────────────────────────────────
# TOOL DEFINITIONS
# These are injected into the system prompt so the model knows
# what tools are available and how to call them.
# ─────────────────────────────────────────────────────────────────────

TOOL_DEFINITIONS = [
    {
        "name": "web_search",
        "description": (
            "Search the web for current information, recent events, news, "
            "people, companies, or any factual query. Use this when the user "
            "asks about something that may have changed recently or that you "
            "are not confident about."
        ),
        "parameters": {
            "query": "The search query string (be specific and concise)"
        },
        "example": '{"name": "web_search", "args": {"query": "latest AI news 2025"}}'
    },
    {
        "name": "get_weather",
        "description": (
            "Get the current real-time weather for any city. Always use this "
            "when the user asks about weather, temperature, or forecast. "
            "Never guess weather from training data."
        ),
        "parameters": {
            "city": "City name (e.g. 'Mumbai', 'London', 'New York')"
        },
        "example": '{"name": "get_weather", "args": {"city": "Mumbai"}}'
    },
    {
        "name": "get_date_time",
        "description": (
            "Get the current date and time. Use this when the user asks "
            "what day, date, or time it is. Never guess the current date."
        ),
        "parameters": {},
        "example": '{"name": "get_date_time", "args": {}}'
    },
    {
        "name": "calculator",
        "description": (
            "Evaluate a mathematical expression accurately. Use this for "
            "any arithmetic, percentages, unit conversions, or calculations. "
            "Do not attempt to calculate in your head."
        ),
        "parameters": {
            "expression": "A valid math expression e.g. '(15 * 8.5) / 100' or 'sqrt(144)'"
        },
        "example": '{"name": "calculator", "args": {"expression": "15 * 8.5 / 100"}}'
    },
    {
        "name": "wikipedia",
        "description": (
            "Look up factual information about a topic, person, place, event, "
            "or concept from Wikipedia. Use this for historical facts, "
            "biographies, science, geography, and encyclopedic knowledge."
        ),
        "parameters": {
            "topic": "The Wikipedia article title or search term"
        },
        "example": '{"name": "wikipedia", "args": {"topic": "Large Language Model"}}'
    },
]


def build_tools_system_prompt(user_system: str | None = None) -> str:
    """
    Build the full system prompt including tool definitions.
    
    The prompt teaches the model:
    1. What tools are available
    2. How to invoke them (XML tag format)
    3. When to use them vs answer from knowledge
    4. How to present the final answer
    """
    tools_block = "\n".join([
        f"  - {t['name']}: {t['description']}\n"
        f"    Parameters: {json.dumps(t['parameters'])}\n"
        f"    Example call: <tool_call>{t['example']}</tool_call>"
        for t in TOOL_DEFINITIONS
    ])

    base = f"""You are a helpful AI assistant with access to real-time tools.

AVAILABLE TOOLS:
{tools_block}

RULES FOR TOOL USE:
- If the user asks about current events, weather, today's date/time, or any fact you're uncertain about → USE A TOOL
- If you need to do math or calculations → USE the calculator tool
- If you need factual/encyclopedic information → USE the wikipedia tool
- NEVER guess or make up weather, current events, dates, or calculations
- To call a tool, output ONLY this on its own line:
  <tool_call>{{"name": "tool_name", "args": {{"param": "value"}}}}</tool_call>
- Wait for the tool result before continuing your response
- After receiving a tool result, use it to give an accurate, helpful answer
- If you do NOT need a tool, answer directly from your knowledge

MEMORY: You have access to the conversation history provided above. Use it to maintain context."""

    if user_system:
        return f"{user_system}\n\n{base}"
    return base


# ─────────────────────────────────────────────────────────────────────
# TOOL CALL DETECTION
# ─────────────────────────────────────────────────────────────────────

TOOL_CALL_PATTERN = re.compile(
    r'<tool_call>(.*?)</tool_call>',
    re.DOTALL | re.IGNORECASE
)


def extract_tool_call(text: str) -> dict | None:
    """
    Parse a tool call from the model's response text.
    Returns None if no tool call is found.
    
    Handles malformed JSON gracefully — small quantized models
    sometimes emit trailing commas or unquoted keys.
    """
    match = TOOL_CALL_PATTERN.search(text)
    if not match:
        return None

    raw = match.group(1).strip()

    # Attempt direct parse
    try:
        parsed = json.loads(raw)
        if "name" in parsed:
            return parsed
    except json.JSONDecodeError:
        pass

    # Try to fix common issues: trailing commas, single quotes
    try:
        fixed = re.sub(r',\s*}', '}', raw)   # trailing comma in object
        fixed = re.sub(r',\s*]', ']', fixed)  # trailing comma in array
        fixed = fixed.replace("'", '"')        # single → double quotes
        parsed = json.loads(fixed)
        if "name" in parsed:
            return parsed
    except json.JSONDecodeError:
        pass

    logger.warning(f"Could not parse tool call: {raw}")
    return None


def strip_tool_call(text: str) -> str:
    """Remove the <tool_call>...</tool_call> tag from model output."""
    return TOOL_CALL_PATTERN.sub('', text).strip()


# ─────────────────────────────────────────────────────────────────────
# TOOL EXECUTORS
# ─────────────────────────────────────────────────────────────────────

async def _web_search(query: str) -> str:
    """
    Search DuckDuckGo and return top result snippets.
    
    WHY DUCKDUCKGO?
    - Free, no API key, no rate limiting for reasonable use
    - Returns clean text snippets
    - Does not require account or payment
    
    We use the DuckDuckGo Instant Answer API (JSON endpoint)
    which is publicly available and well-documented.
    """
    try:
        async with httpx.AsyncClient(timeout=10.0, follow_redirects=True) as client:
            # DuckDuckGo Instant Answer API
            resp = await client.get(
                "https://api.duckduckgo.com/",
                params={
                    "q": query,
                    "format": "json",
                    "no_html": "1",
                    "skip_disambig": "1",
                }
            )
            data = resp.json()

            results = []

            # Abstract (Wikipedia-sourced summary)
            if data.get("Abstract"):
                results.append(f"Summary: {data['Abstract']}")
                if data.get("AbstractURL"):
                    results.append(f"Source: {data['AbstractURL']}")

            # Answer (for simple factual queries like math, capitals)
            if data.get("Answer"):
                results.append(f"Direct answer: {data['Answer']}")

            # Related topics
            topics = data.get("RelatedTopics", [])[:3]
            for t in topics:
                if isinstance(t, dict) and t.get("Text"):
                    results.append(f"• {t['Text'][:200]}")

            if results:
                return "\n".join(results)

            # Fallback: scrape DuckDuckGo HTML for more results
            resp2 = await client.get(
                "https://html.duckduckgo.com/html/",
                params={"q": query},
                headers={"User-Agent": "Mozilla/5.0 (compatible; OllamaLens/1.0)"}
            )
            # Extract snippets from result HTML (simple regex)
            snippets = re.findall(
                r'class="result__snippet"[^>]*>(.*?)</a>',
                resp2.text, re.DOTALL
            )[:3]
            if snippets:
                clean = [re.sub(r'<[^>]+>', '', s).strip() for s in snippets]
                return "Search results:\n" + "\n".join(f"• {s}" for s in clean if s)

            return f"No results found for: {query}"

    except Exception as e:
        return f"Search failed: {str(e)}"


async def _get_weather(city: str) -> str:
    """
    Get current weather using Open-Meteo + geocoding.
    
    WHY OPEN-METEO?
    - Completely free, no API key required
    - No rate limiting for personal use
    - Returns real-time weather data
    - Uses WMO weather codes for conditions
    
    Two-step process:
    1. Geocode city name → lat/lng (Open-Meteo geocoding API)
    2. Fetch weather for those coordinates
    """
    WMO_CODES = {
        0: "Clear sky", 1: "Mainly clear", 2: "Partly cloudy", 3: "Overcast",
        45: "Foggy", 48: "Depositing rime fog",
        51: "Light drizzle", 53: "Moderate drizzle", 55: "Dense drizzle",
        61: "Slight rain", 63: "Moderate rain", 65: "Heavy rain",
        71: "Slight snow", 73: "Moderate snow", 75: "Heavy snow",
        80: "Slight showers", 81: "Moderate showers", 82: "Violent showers",
        95: "Thunderstorm", 96: "Thunderstorm with hail",
    }

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            # Step 1: Geocode
            geo = await client.get(
                "https://geocoding-api.open-meteo.com/v1/search",
                params={"name": city, "count": 1, "language": "en", "format": "json"}
            )
            geo_data = geo.json()

            if not geo_data.get("results"):
                return f"City '{city}' not found. Try a different spelling."

            loc = geo_data["results"][0]
            lat, lng = loc["latitude"], loc["longitude"]
            loc_name = f"{loc.get('name', city)}, {loc.get('country', '')}"

            # Step 2: Fetch weather
            weather = await client.get(
                "https://api.open-meteo.com/v1/forecast",
                params={
                    "latitude": lat, "longitude": lng,
                    "current": "temperature_2m,relative_humidity_2m,wind_speed_10m,weather_code,apparent_temperature",
                    "wind_speed_unit": "kmh",
                    "timezone": "auto",
                }
            )
            w = weather.json()
            curr = w.get("current", {})

            temp      = curr.get("temperature_2m", "?")
            feels     = curr.get("apparent_temperature", "?")
            humidity  = curr.get("relative_humidity_2m", "?")
            wind      = curr.get("wind_speed_10m", "?")
            code      = curr.get("weather_code", 0)
            condition = WMO_CODES.get(code, f"Code {code}")

            return (
                f"Current weather in {loc_name}:\n"
                f"• Condition: {condition}\n"
                f"• Temperature: {temp}°C (feels like {feels}°C)\n"
                f"• Humidity: {humidity}%\n"
                f"• Wind speed: {wind} km/h"
            )

    except Exception as e:
        return f"Weather fetch failed: {str(e)}"


def _get_date_time() -> str:
    """Return current date and time (server timezone)."""
    now = datetime.datetime.now()
    utc = datetime.datetime.utcnow()
    return (
        f"Current date and time:\n"
        f"• Local: {now.strftime('%A, %d %B %Y at %H:%M:%S')}\n"
        f"• UTC: {utc.strftime('%Y-%m-%d %H:%M:%S UTC')}\n"
        f"• Day of week: {now.strftime('%A')}\n"
        f"• Week number: {now.isocalendar()[1]}"
    )


def _calculator(expression: str) -> str:
    """
    Safely evaluate a mathematical expression.
    
    WHY NOT JUST USE eval()?
    Raw eval() is a security risk — someone could pass
    "__import__('os').system('rm -rf /')" as the expression.
    
    We use a whitelist approach: only allow math functions,
    numbers, and operators. No builtins, no imports.
    """
    # Whitelist of safe names
    safe_names = {
        "abs": abs, "round": round, "min": min, "max": max,
        "sqrt": math.sqrt, "pow": math.pow, "log": math.log,
        "log2": math.log2, "log10": math.log10,
        "sin": math.sin, "cos": math.cos, "tan": math.tan,
        "pi": math.pi, "e": math.e, "inf": math.inf,
        "floor": math.floor, "ceil": math.ceil,
    }

    # Block anything that looks dangerous
    blocked = ["__", "import", "exec", "eval", "open", "os", "sys",
               "subprocess", "compile", "globals", "locals", "getattr"]
    expr_lower = expression.lower()
    for b in blocked:
        if b in expr_lower:
            return f"Expression blocked for security: contains '{b}'"

    try:
        result = eval(expression, {"__builtins__": {}}, safe_names)  # noqa: S307
        # Format nicely
        if isinstance(result, float):
            if result == int(result):
                return f"Result: {int(result)}"
            return f"Result: {result:.6g}"
        return f"Result: {result}"
    except ZeroDivisionError:
        return "Error: Division by zero"
    except Exception as e:
        return f"Calculation error: {str(e)}"


async def _wikipedia(topic: str) -> str:
    """
    Fetch a Wikipedia article summary.
    
    Uses the Wikipedia REST API (free, no key needed).
    Returns the introduction section — enough for factual context.
    """
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            # Search first to get the correct article title
            search = await client.get(
                f"https://en.wikipedia.org/api/rest_v1/page/summary/{httpx.URL(topic).path}",
                headers={"User-Agent": "OllamaLens/1.0 (educational project)"}
            )

            if search.status_code == 404:
                # Try search endpoint
                search2 = await client.get(
                    "https://en.wikipedia.org/w/api.php",
                    params={
                        "action": "query", "list": "search",
                        "srsearch": topic, "format": "json",
                        "srlimit": 1,
                    }
                )
                results = search2.json().get("query", {}).get("search", [])
                if not results:
                    return f"No Wikipedia article found for: {topic}"

                title = results[0]["title"]
                search = await client.get(
                    f"https://en.wikipedia.org/api/rest_v1/page/summary/{httpx.URL(title).path}",
                    headers={"User-Agent": "OllamaLens/1.0"}
                )

            if search.status_code != 200:
                return f"Wikipedia lookup failed (status {search.status_code})"

            data = search.json()
            title   = data.get("title", topic)
            extract = data.get("extract", "No content available")
            url     = data.get("content_urls", {}).get("desktop", {}).get("page", "")

            # Limit extract to ~500 chars to stay within context window
            if len(extract) > 500:
                extract = extract[:500] + "…"

            return f"Wikipedia — {title}:\n{extract}\nSource: {url}"

    except Exception as e:
        return f"Wikipedia lookup failed: {str(e)}"


# ─────────────────────────────────────────────────────────────────────
# MAIN DISPATCHER
# ─────────────────────────────────────────────────────────────────────

async def execute_tool(name: str, args: dict) -> str:
    """
    Dispatch a tool call to the correct executor.
    Returns a string result that gets injected back into the prompt.
    """
    logger.info(f"Executing tool: {name} with args: {args}")

    try:
        if name == "web_search":
            return await _web_search(args.get("query", ""))

        elif name == "get_weather":
            return await _get_weather(args.get("city", ""))

        elif name == "get_date_time":
            return _get_date_time()

        elif name == "calculator":
            return _calculator(args.get("expression", ""))

        elif name == "wikipedia":
            return await _wikipedia(args.get("topic", ""))

        else:
            return f"Unknown tool: {name}. Available: web_search, get_weather, get_date_time, calculator, wikipedia"

    except Exception as e:
        logger.error(f"Tool {name} failed: {e}", exc_info=True)
        return f"Tool {name} failed with error: {str(e)}"