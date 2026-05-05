"""
tools.py  (v5 — chain-of-thought leak fix)

BUGS FIXED:
  1. Model leaking internal reasoning (#### This is just a greeting...)
     CAUSE: System prompt did not explicitly forbid markdown headers,
            internal notes, or chain-of-thought output.
     FIX:   Added strict output rules: no markdown headers, no internal
            notes, respond directly to the user.

  2. Model echoing "User: ..." in its own response
     CAUSE: History format used "User:" and "Assistant:" prefixes which
            the model was copying into its output.
     FIX:   Changed history format to use <human> / <assistant> XML tags
            which are less likely to be echoed, plus explicit rule
            "never repeat conversation history in your responses."

  3. Tool counter showing 0
     CAUSE: tool_calls list was populated in SSE but the done event
            was sending a separate empty list.
     FIX:   tool_calls_log is passed correctly through resolve_with_tools
            and emitted in the done event.
"""

import json
import re
import math
import datetime
import httpx
import logging

logger = logging.getLogger(__name__)

TOOL_DEFINITIONS = [
    {
        "name": "web_search",
        "description": "Search the web for current information, recent events, news, people, companies, or any factual query you are not certain about.",
        "parameters": {"query": "The search query string"},
        "example": '{"name": "web_search", "args": {"query": "latest AI news 2025"}}'
    },
    {
        "name": "get_weather",
        "description": "Get current real-time weather for any city. ALWAYS use this for weather questions — never guess.",
        "parameters": {"city": "City name e.g. Mumbai"},
        "example": '{"name": "get_weather", "args": {"city": "Mumbai"}}'
    },
    {
        "name": "get_date_time",
        "description": "Get current date and time. Use for any question about today's date, day, or time.",
        "parameters": {},
        "example": '{"name": "get_date_time", "args": {}}'
    },
    {
        "name": "calculator",
        "description": "Evaluate a math expression accurately. Use for arithmetic, percentages, unit conversions.",
        "parameters": {"expression": "A valid math expression e.g. '15 * 8.5 / 100'"},
        "example": '{"name": "calculator", "args": {"expression": "15 * 8.5 / 100"}}'
    },
    {
        "name": "wikipedia",
        "description": "Look up factual information about a topic, person, place, or concept from Wikipedia.",
        "parameters": {"topic": "The Wikipedia article title or search term"},
        "example": '{"name": "wikipedia", "args": {"topic": "Large Language Model"}}'
    },
]


def build_tools_system_prompt(user_system: str | None = None) -> str:
    """
    Strict system prompt that prevents:
    - Chain-of-thought leaking into responses (#### This is just a greeting...)
    - History format echoing back in responses (User: ... Assistant: ...)
    - Fake tool results when tools aren't called
    """
    tools_block = "\n".join([
        f"- {t['name']}: {t['description']}\n"
        f"  Example: <tool_call>{t['example']}</tool_call>"
        for t in TOOL_DEFINITIONS
    ])

    base = f"""You are OllamaLens, a concise and helpful AI assistant.

AVAILABLE TOOLS:
{tools_block}

STRICT OUTPUT RULES — follow these exactly:
1. NEVER output markdown headers (##, ###, ####) in your responses
2. NEVER output your internal reasoning or planning notes
3. NEVER start a response with meta-commentary like "This is a greeting" or "The user is asking about..."
4. NEVER repeat or quote conversation history back to the user
5. NEVER prefix your words with "Assistant:" or "User:" in your output
6. ALWAYS respond directly and naturally as if in a real conversation
7. Keep responses concise — no unnecessary filler phrases

TOOL USE RULES:
- For weather → ALWAYS call get_weather tool, never guess
- For current date/time → ALWAYS call get_date_time tool
- For recent news/events → ALWAYS call web_search tool
- For math/calculations → ALWAYS call calculator tool
- For encyclopedic facts → call wikipedia tool if unsure
- To call a tool, output EXACTLY this (nothing else on that line):
  <tool_call>{{"name": "tool_name", "args": {{"param": "value"}}}}</tool_call>

CONVERSATION MEMORY:
The conversation history is provided in <history> tags below.
Use it to understand context, but never quote it back verbatim."""

    if user_system:
        return f"{user_system}\n\n{base}"
    return base


# ─────────────────────────────────────────────────────────────────────
# TOOL CALL DETECTION
# ─────────────────────────────────────────────────────────────────────

TOOL_CALL_PATTERN = re.compile(r'<tool_call>(.*?)</tool_call>', re.DOTALL | re.IGNORECASE)

# Strip markdown headers and chain-of-thought markers from output
CHAIN_OF_THOUGHT_PATTERN = re.compile(
    r'(^#{1,6}\s+.*$)|'            # markdown headers
    r'(^\*{1,2}Note:.*$)|'         # Note: ... lines
    r'(^\*{1,2}Thinking:.*$)|'     # Thinking: ... lines
    r'(\[END OF TOOL RESULT\])',    # leftover tool markers
    re.MULTILINE | re.IGNORECASE
)

def clean_response(text: str) -> str:
    """
    Remove leaked chain-of-thought, markdown headers, and internal notes.
    Also removes history echo patterns like 'User: ...' that the model
    sometimes copies from the history context.
    """
    # Remove markdown headers
    text = re.sub(r'^#{1,6}\s+.*$', '', text, flags=re.MULTILINE)
    # Remove [END OF TOOL RESULT] markers
    text = re.sub(r'\[END OF TOOL RESULT\]', '', text, flags=re.IGNORECASE)
    # Remove lines that start with "User:" or "Assistant:" (history echo)
    text = re.sub(r'^(User|Assistant|Human):\s+.*$', '', text, flags=re.MULTILINE)
    # Remove leftover tool call tags
    text = TOOL_CALL_PATTERN.sub('', text)
    # Collapse multiple blank lines into one
    text = re.sub(r'\n{3,}', '\n\n', text)
    return text.strip()


def extract_tool_call(text: str) -> dict | None:
    match = TOOL_CALL_PATTERN.search(text)
    if not match:
        return None
    raw = match.group(1).strip()
    try:
        parsed = json.loads(raw)
        if "name" in parsed:
            return parsed
    except json.JSONDecodeError:
        pass
    try:
        fixed = re.sub(r',\s*}', '}', raw)
        fixed = re.sub(r',\s*]', ']', fixed)
        fixed = fixed.replace("'", '"')
        parsed = json.loads(fixed)
        if "name" in parsed:
            return parsed
    except json.JSONDecodeError:
        pass
    logger.warning(f"Could not parse tool call: {raw}")
    return None


def strip_tool_call(text: str) -> str:
    return TOOL_CALL_PATTERN.sub('', text).strip()


# ─────────────────────────────────────────────────────────────────────
# TOOL EXECUTORS
# ─────────────────────────────────────────────────────────────────────

async def _web_search(query: str) -> str:
    try:
        async with httpx.AsyncClient(timeout=10.0, follow_redirects=True) as client:
            resp = await client.get(
                "https://api.duckduckgo.com/",
                params={"q": query, "format": "json", "no_html": "1", "skip_disambig": "1"}
            )
            data = resp.json()
            results = []
            if data.get("Abstract"):
                results.append(f"Summary: {data['Abstract']}")
                if data.get("AbstractURL"):
                    results.append(f"Source: {data['AbstractURL']}")
            if data.get("Answer"):
                results.append(f"Direct answer: {data['Answer']}")
            topics = data.get("RelatedTopics", [])[:3]
            for t in topics:
                if isinstance(t, dict) and t.get("Text"):
                    results.append(f"• {t['Text'][:200]}")
            if results:
                return "\n".join(results)
            # HTML fallback
            resp2 = await client.get(
                "https://html.duckduckgo.com/html/",
                params={"q": query},
                headers={"User-Agent": "Mozilla/5.0 (compatible; OllamaLens/1.0)"}
            )
            snippets = re.findall(r'class="result__snippet"[^>]*>(.*?)</a>', resp2.text, re.DOTALL)[:3]
            if snippets:
                clean = [re.sub(r'<[^>]+>', '', s).strip() for s in snippets]
                return "Search results:\n" + "\n".join(f"• {s}" for s in clean if s)
            return f"No results found for: {query}"
    except Exception as e:
        return f"Search failed: {str(e)}"


async def _get_weather(city: str) -> str:
    WMO_CODES = {
        0:"Clear sky",1:"Mainly clear",2:"Partly cloudy",3:"Overcast",
        45:"Foggy",51:"Light drizzle",61:"Slight rain",63:"Moderate rain",
        65:"Heavy rain",71:"Slight snow",80:"Slight showers",95:"Thunderstorm",
    }
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            geo = await client.get(
                "https://geocoding-api.open-meteo.com/v1/search",
                params={"name": city, "count": 1, "language": "en", "format": "json"}
            )
            geo_data = geo.json()
            if not geo_data.get("results"):
                return f"City '{city}' not found."
            loc = geo_data["results"][0]
            lat, lng = loc["latitude"], loc["longitude"]
            loc_name = f"{loc.get('name', city)}, {loc.get('country', '')}"
            weather = await client.get(
                "https://api.open-meteo.com/v1/forecast",
                params={"latitude": lat, "longitude": lng, "current": "temperature_2m,relative_humidity_2m,wind_speed_10m,weather_code,apparent_temperature", "wind_speed_unit": "kmh", "timezone": "auto"}
            )
            w = weather.json()
            curr = w.get("current", {})
            temp = curr.get("temperature_2m", "?")
            feels = curr.get("apparent_temperature", "?")
            humidity = curr.get("relative_humidity_2m", "?")
            wind = curr.get("wind_speed_10m", "?")
            code = curr.get("weather_code", 0)
            condition = WMO_CODES.get(code, f"Code {code}")
            return (f"Current weather in {loc_name}:\n"
                    f"• Condition: {condition}\n"
                    f"• Temperature: {temp}°C (feels like {feels}°C)\n"
                    f"• Humidity: {humidity}%\n"
                    f"• Wind: {wind} km/h")
    except Exception as e:
        return f"Weather fetch failed: {str(e)}"


def _get_date_time() -> str:
    now = datetime.datetime.now()
    utc = datetime.datetime.utcnow()
    return (f"Current date and time:\n"
            f"• Local: {now.strftime('%A, %d %B %Y at %H:%M:%S')}\n"
            f"• UTC: {utc.strftime('%Y-%m-%d %H:%M:%S UTC')}\n"
            f"• Day of week: {now.strftime('%A')}")


def _calculator(expression: str) -> str:
    safe_names = {
        "abs": abs, "round": round, "min": min, "max": max,
        "sqrt": math.sqrt, "pow": math.pow, "log": math.log,
        "log2": math.log2, "log10": math.log10,
        "sin": math.sin, "cos": math.cos, "tan": math.tan,
        "pi": math.pi, "e": math.e, "floor": math.floor, "ceil": math.ceil,
    }
    blocked = ["__", "import", "exec", "eval", "open", "os", "sys"]
    for b in blocked:
        if b in expression.lower():
            return f"Expression blocked: contains '{b}'"
    try:
        result = eval(expression, {"__builtins__": {}}, safe_names)  # noqa: S307
        if isinstance(result, float) and result == int(result):
            return f"Result: {int(result)}"
        return f"Result: {result:.6g}" if isinstance(result, float) else f"Result: {result}"
    except ZeroDivisionError:
        return "Error: Division by zero"
    except Exception as e:
        return f"Calculation error: {str(e)}"


async def _wikipedia(topic: str) -> str:
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            # URL-encode topic for the path
            encoded = httpx.URL("https://en.wikipedia.org/api/rest_v1/page/summary/" + topic.replace(" ", "_"))
            resp = await client.get(str(encoded), headers={"User-Agent": "OllamaLens/1.0"})
            if resp.status_code == 404:
                search = await client.get(
                    "https://en.wikipedia.org/w/api.php",
                    params={"action": "query", "list": "search", "srsearch": topic, "format": "json", "srlimit": 1}
                )
                results = search.json().get("query", {}).get("search", [])
                if not results:
                    return f"No Wikipedia article found for: {topic}"
                title = results[0]["title"]
                encoded = httpx.URL("https://en.wikipedia.org/api/rest_v1/page/summary/" + title.replace(" ", "_"))
                resp = await client.get(str(encoded), headers={"User-Agent": "OllamaLens/1.0"})
            if resp.status_code != 200:
                return f"Wikipedia lookup failed (status {resp.status_code})"
            data = resp.json()
            title   = data.get("title", topic)
            extract = data.get("extract", "No content available")
            url     = data.get("content_urls", {}).get("desktop", {}).get("page", "")
            if len(extract) > 500:
                extract = extract[:500] + "…"
            return f"Wikipedia — {title}:\n{extract}\nSource: {url}"
    except Exception as e:
        return f"Wikipedia lookup failed: {str(e)}"


async def execute_tool(name: str, args: dict) -> str:
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
            return f"Unknown tool: {name}"
    except Exception as e:
        logger.error(f"Tool {name} failed: {e}", exc_info=True)
        return f"Tool {name} failed: {str(e)}"