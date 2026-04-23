# kakao-mcp-server

macOS에서 카카오톡 채팅을 MCP 툴로 읽을 수 있는 HTTP MCP 서버입니다.  
Claude Desktop, claude.ai 커스텀 커넥터 등 MCP를 지원하는 모든 클라이언트에서 사용할 수 있습니다.

## 사전 준비

- macOS + 카카오톡 Mac 앱 설치
- [`kakaocli`](https://github.com/silver-flight-group/kakaocli) 설치
- Node.js 18+
- 터미널 앱에 **전체 디스크 접근 권한** 부여 (시스템 설정 → 개인 정보 보호 및 보안)

```bash
brew install silver-flight-group/tap/kakaocli
```

## 설치

```bash
git clone https://github.com/ZenNavi/kakao-mcp-server.git
cd kakao-mcp-server
npm install
```

## 실행

```bash
node index.js
# Kakao MCP server listening on http://localhost:7777/mcp
```

환경변수:

| 변수 | 기본값 | 설명 |
|---|---|---|
| `PORT` | `7777` | HTTP 포트 |
| `KAKAOCLI_PATH` | `kakaocli` | kakaocli 바이너리 경로 |

## 로그인 자동 실행 (launchd)

재부팅 후에도 자동으로 서버가 뜨게 하려면 launchd에 등록합니다.

```bash
cp com.kakao.mcp-server.plist.example ~/Library/LaunchAgents/com.kakao.mcp-server.plist
```

`~/Library/LaunchAgents/com.kakao.mcp-server.plist`를 열어 `/YOUR/PATH/TO/`를 실제 경로로 수정한 뒤:

```bash
launchctl load ~/Library/LaunchAgents/com.kakao.mcp-server.plist
```

## MCP 툴

### `list_chats`
카카오톡 채팅방 목록을 조회합니다.

| 파라미터 | 기본값 | 최대값 | 설명 |
|---|---|---|---|
| `limit` | 20 | 100 | 가져올 채팅방 수 |

### `get_messages`
특정 채팅방의 메시지를 조회합니다. 첨부파일 URL도 포함됩니다.

| 파라미터 | 기본값 | 최대값 | 설명 |
|---|---|---|---|
| `chat` | (필수) | — | 채팅방 이름 (부분 일치) |
| `since` | `7d` | — | 기간: `today` \| `yesterday` \| `7d` \| `30d` \| `YYYY-MM-DD` |
| `limit` | 50 | 500 | 가져올 메시지 수 |

### `search_messages`
**전체 채팅방**에서 키워드로 메시지를 검색합니다.

| 파라미터 | 기본값 | 최대값 | 설명 |
|---|---|---|---|
| `query` | (필수) | — | 검색 키워드 |
| `limit` | 20 | 100 | 결과 수 |

### `extract_tasks`
채팅 메시지에서 작업 항목(요청, 버그, 기능추가, 완료, 견적)을 자동으로 추출합니다.

| 파라미터 | 기본값 | 최대값 | 설명 |
|---|---|---|---|
| `chat` | (필수) | — | 채팅방 이름 (부분 일치) |
| `since` | `30d` | — | 기간: `today` \| `yesterday` \| `7d` \| `30d` \| `YYYY-MM-DD` |

## Claude Desktop 연결

### 로컬 연결

`claude_desktop_config.json`에 추가:

```json
{
  "mcpServers": {
    "kakao": {
      "url": "http://localhost:7777/mcp"
    }
  }
}
```

### Tailscale Funnel로 원격 연결 (claude.ai 커스텀 커넥터)

Tailscale이 설치되어 있다면 공개 HTTPS 주소를 만들 수 있습니다.

```bash
# Tailscale Funnel 활성화
tailscale funnel --bg --https=443 http://localhost:7777
```

출력되는 주소(예: `https://your-hostname.tail-xxxx.ts.net`)에 `/mcp`를 붙여서  
claude.ai → 설정 → 커스텀 커넥터에 등록합니다.

```
https://your-hostname.tail-xxxx.ts.net/mcp
```

> Tailscale Funnel은 인터넷에 공개되므로, 신뢰하는 네트워크 환경에서 사용하세요.

## License

MIT
