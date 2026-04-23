import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { createServer } from "http";
import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);
const PORT = parseInt(process.env.PORT || "7777", 10);
const KAKAOCLI = process.env.KAKAOCLI_PATH || "kakaocli";
const URL_RE = /https?:\/\/[^\s]+/g;

// Run kakaocli and parse JSON output
async function runKakaocli(args) {
  let stdout;
  try {
    ({ stdout } = await execFileAsync(KAKAOCLI, args, {
      maxBuffer: 50 * 1024 * 1024,
      timeout: 30_000,
      killSignal: "SIGTERM",
    }));
  } catch (err) {
    const detail = err.stderr?.trim() || err.message;
    throw new Error(`kakaocli ${args[0]} failed: ${detail}`);
  }
  try {
    return JSON.parse(stdout);
  } catch {
    throw new Error(`kakaocli ${args[0]}: invalid JSON — ${stdout.slice(0, 200)}`);
  }
}

// Extract attachment URLs from message text
function extractAttachments(text = "") {
  const urls = (text.match(URL_RE) || []).map((url) => url.replace(/[.,!?)\]]+$/, ""));
  return urls.map((url) => ({ url, filename: url.split("/").pop() || "file" }));
}

// Convert friendly since values to kakaocli arg + optional date filter
// Returns { kakaocliArg: "7d", filterDate: null | "YYYY-MM-DD" }
function parseSince(since = "7d") {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const dateStr = (d) =>
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

  if (since === "today") {
    const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const hoursAgo = Math.ceil((now - midnight) / 3_600_000) + 1; // +1h buffer for boundary inclusivity
    return { kakaocliArg: `${hoursAgo}h`, filterDate: dateStr(now) };
  }

  if (since === "yesterday") {
    const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
    return { kakaocliArg: "50h", filterDate: dateStr(yesterday) }; // 2 days + buffer; filterDate constrains to yesterday only
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(since)) {
    const target = new Date(since + "T00:00:00");
    const daysAgo = Math.ceil((now - target) / 86_400_000) + 1;
    if (daysAgo <= 0) {
      return { kakaocliArg: "1d", filterDate: since };
    }
    return { kakaocliArg: `${daysAgo}d`, filterDate: since };
  }

  return { kakaocliArg: since, filterDate: null };
}

// Filter messages by exact date prefix match (YYYY-MM-DD)
function filterByDate(messages, filterDate) {
  if (!filterDate) return messages;
  return messages.filter((m) => (m.timestamp || "").startsWith(filterDate));
}

// ─── Task patterns (from kakao-task-extractor.js) ────────────────────────────

const WORK_PATTERNS = [
  { type: "request", regex: /수정\s?요청|작업\s?요청|부탁|해주세요|해줄\s?수\s?있|개발\s?요청|추가\s?요청|확인\s?요청/i },
  { type: "bug",     regex: /오류|에러|error|bug|버그|안\s?됩니다|안\s?돼요|문제\s?가|먹통|접속\s?안/i },
  { type: "feature", regex: /기능\s?추가|신규\s?개발|만들어|구현|적용|연동|추가해/i },
  { type: "done",    regex: /완료했습니다|완료됐습니다|작업\s?완료|반영\s?완료|확인\s?해봐\s?주|확인\s?부탁/i },
  { type: "quote",   regex: /견적|비용|얼마|금액|청구|정산/i },
];

const STATUS_MAP = { request: "progress", bug: "progress", feature: "quoted", done: "done", quote: "quoted" };

function classifyMessage(text) {
  for (const p of WORK_PATTERNS) {
    if (p.regex.test(text)) return p.type;
  }
  return null;
}

function extractTasksFromMessages(messages) {
  const tasks = [];

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    const text = msg.text || "";
    const cls = classifyMessage(text);
    const attachments = extractAttachments(text);

    if (!cls) {
      if (attachments.length && tasks.length) {
        tasks[tasks.length - 1].attachments.push(...attachments);
      }
      continue;
    }

    const date = (msg.timestamp || "").slice(0, 10);
    const sender = msg.is_from_me ? "나" : (msg.sender || "상대방");
    const title = text.split("\n")[0].trim().slice(0, 60) || "작업 요청";
    const status = msg.is_from_me && cls === "done" ? "done" : STATUS_MAP[cls] || "progress";

    tasks.push({
      id: `kakao_${msg.id || i}`,
      source: "kakaotalk",
      title,
      date,
      status,
      memo: `[카톡] ${sender}: ${text.slice(0, 120)}`,
      attachments,
    });
  }

  const seen = new Set();
  return tasks.filter((t) => {
    const key = `${t.date}_${t.title.slice(0, 20)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ─── MCP Server factory ───────────────────────────────────────────────────────

function buildMcpServer() {
  const server = new McpServer({ name: "kakao-mcp-server", version: "1.0.0" });

  server.tool(
    "list_chats",
    "카카오톡 채팅방 목록을 조회합니다.",
    { limit: z.number().int().positive().max(100).optional().default(20) },
    async ({ limit }) => {
      const chats = await runKakaocli(["chats", "--json", "--limit", String(limit)]);
      return { content: [{ type: "text", text: JSON.stringify(chats, null, 2) }] };
    }
  );

  server.tool(
    "get_messages",
    "특정 채팅방의 메시지를 조회합니다. 첨부파일 URL 포함.",
    {
      chat: z.string().describe("채팅방 이름 (부분 일치)"),
      since: z
        .string()
        .optional()
        .default("7d")
        .describe("기간: today | yesterday | 7d | 30d | YYYY-MM-DD"),
      limit: z.number().int().positive().max(500).optional().default(50),
    },
    async ({ chat, since, limit }) => {
      const { kakaocliArg, filterDate } = parseSince(since);
      let messages = await runKakaocli([
        "messages",
        "--chat", chat,
        "--since", kakaocliArg,
        "--json",
      ]);
      if (!Array.isArray(messages)) {
        throw new Error(`kakaocli messages: expected array, got ${typeof messages}`);
      }
      if (filterDate) messages = filterByDate(messages, filterDate);
      messages = messages.slice(0, limit);

      const result = messages.map((m) => ({
        sender: m.sender,
        text: m.text,
        timestamp: m.timestamp,
        is_from_me: m.is_from_me,
        attachments: extractAttachments(m.text || ""),
      }));

      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    "extract_tasks",
    "채팅 메시지에서 작업 항목(요청, 버그, 기능추가, 완료, 견적)을 자동 추출합니다.",
    {
      chat: z.string().describe("채팅방 이름 (부분 일치)"),
      since: z
        .string()
        .optional()
        .default("30d")
        .describe("기간: today | yesterday | 7d | 30d | YYYY-MM-DD"),
    },
    async ({ chat, since }) => {
      const { kakaocliArg, filterDate } = parseSince(since);
      let messages = await runKakaocli([
        "messages",
        "--chat", chat,
        "--since", kakaocliArg,
        "--json",
      ]);
      if (!Array.isArray(messages)) {
        throw new Error(`kakaocli messages: expected array, got ${typeof messages}`);
      }
      if (filterDate) messages = filterByDate(messages, filterDate);

      const tasks = extractTasksFromMessages(messages);
      const summary = {
        total_messages: messages.length,
        extracted_tasks: tasks.length,
        by_status: tasks.reduce((acc, t) => {
          acc[t.status] = (acc[t.status] || 0) + 1;
          return acc;
        }, {}),
      };

      return {
        content: [{ type: "text", text: JSON.stringify({ summary, tasks }, null, 2) }],
      };
    }
  );

  return server;
}

// ─── HTTP Server ──────────────────────────────────────────────────────────────

async function readBody(req, maxBytes = 1 * 1024 * 1024) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > maxBytes) {
      req.destroy();
      throw new Error("Request body too large");
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString();
}

const httpServer = createServer(async (req, res) => {
  try {
    if (req.url !== "/mcp" || req.method !== "POST") {
      res.writeHead(405, { "Content-Type": "text/plain" });
      res.end("Kakao MCP Server — POST /mcp");
      return;
    }

    const rawBody = await readBody(req);
    let parsedBody;
    try {
      parsedBody = JSON.parse(rawBody);
    } catch {
      res.writeHead(400, { "Content-Type": "text/plain" });
      res.end("Invalid JSON");
      return;
    }

    const server = buildMcpServer();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on("close", () => {
      server.close().catch((err) => console.error("server.close() error:", err));
    });

    await server.connect(transport);
    await transport.handleRequest(req, res, parsedBody);
  } catch (err) {
    console.error("MCP request error:", err);
    if (!res.headersSent) {
      res.writeHead(500, { "Content-Type": "text/plain" });
      res.end("Internal server error");
    }
  }
});

httpServer.listen(PORT, () => {
  console.log(`Kakao MCP server listening on http://localhost:${PORT}/mcp`);
});

httpServer.on("error", (err) => {
  console.error("HTTP server error:", err);
  process.exit(1);
});

function shutdown(signal) {
  console.log(`Received ${signal}, shutting down...`);
  httpServer.close(() => {
    console.log("HTTP server closed");
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 5_000).unref();
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
