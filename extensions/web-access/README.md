# web-access extension (local)

Adds four tools to pi:

- `web_search` - web discovery via Tavily or Brave Search API
- `web_fetch` - fast HTTP fetch + readability extraction
- `browser_fetch` - JS-rendered fetch via Playwright Chromium
- `site_crawl` - bounded BFS crawl from a start URL

Also adds command:

- `/web-access-status`

## Setup

1. Install dependencies:
   ```bash
   cd ~/.pi/agent/extensions/web-access
   npm install
   npx playwright install chromium
   ```

2. Configure at least one search provider key:
   - `TAVILY_API_KEY`
   - `BRAVE_SEARCH_API_KEY`

3. Reload in pi:
   ```text
   /reload
   ```

## Notes

- `web_fetch` is the default for normal pages (fast/cheap).
- `browser_fetch` is for JS-heavy pages.
- Output is truncated using pi defaults (50KB or 2000 lines), with full output written to a temp file when truncated.
