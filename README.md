# kakao-mcp-server

KakaoTalk MCP server for macOS — exposes kakaocli as MCP tools over HTTP so any MCP client (Claude Desktop, claude.ai custom connector, etc.) can read your KakaoTalk messages.

## Prerequisites

- macOS with KakaoTalk for Mac installed
- [`kakaocli`](https://github.com/silver-flight-group/kakaocli) installed via Homebrew
- Node.js 18+

```bash
brew install silver-flight-group/tap/kakaocli
```

Terminal app must have **Full Disk Access** granted in System Settings → Privacy & Security.

## Install

```bash
git clone https://github.com/bjkim92/kakao-mcp-server.git
cd kakao-mcp-server
npm install
```

## Run

```bash
node index.js
# Kakao MCP server listening on http://localhost:7777/mcp
```

Environment variables:

| Variable | Default | Description |
|---|---|---|
| `PORT` | `7777` | HTTP port |
| `KAKAOCLI_PATH` | `kakaocli` | Path to kakaocli binary |

## Auto-start with launchd

```bash
cp com.kakao.mcp-server.plist.example ~/Library/LaunchAgents/com.kakao.mcp-server.plist
# Edit paths in the plist if needed
launchctl load ~/Library/LaunchAgents/com.kakao.mcp-server.plist
```

## MCP Tools

### `list_chats`
List KakaoTalk chat rooms.

```json
{ "limit": 20 }
```

### `get_messages`
Get messages from a specific chat room, with attachment URL extraction.

```json
{
  "chat": "채팅방 이름 (partial match)",
  "since": "today | yesterday | 7d | 30d | YYYY-MM-DD",
  "limit": 50
}
```

### `search_messages`
Search messages across **all** chat rooms by keyword.

```json
{
  "query": "검색 키워드",
  "limit": 20
}
```

### `extract_tasks`
Extract work items (requests, bugs, features, completions, quotes) from chat messages automatically.

```json
{
  "chat": "채팅방 이름",
  "since": "30d"
}
```

## Connect to Claude Desktop

Add to your Claude Desktop MCP settings:

```json
{
  "mcpServers": {
    "kakao": {
      "url": "http://localhost:7777/mcp"
    }
  }
}
```

Or expose via Tailscale Funnel for remote access:

```bash
tailscale funnel --bg --https=443 http://localhost:7777
```

Then register `https://<your-tailnet-host>/mcp` as a custom connector in claude.ai.

## License

MIT
