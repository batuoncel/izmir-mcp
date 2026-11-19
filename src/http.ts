// Uzak (hosted) sürüm: Streamable HTTP + API anahtarı.
//
//   POST /mcp      MCP uç noktası. Başlık: "Authorization: Bearer <MCP_API_KEY>" (veya "x-api-key: <anahtar>")
//   GET  /saglik   Sağlık kontrolü (anahtar gerekmez; Docker/Render bunu kullanır)
//
// Ortam değişkenleri: MCP_API_KEY (zorunlu, virgülle birden fazla), PORT (varsayılan 3000), REDIS_URL (isteğe bağlı)

import { timingSafeEqual } from "node:crypto";
import express, { type NextFunction, type Request, type Response } from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { SURUM, sunucuOlustur } from "./sunucu.js";
import { onbellek } from "./onbellek.js";

const ANAHTARLAR = (process.env.MCP_API_KEY ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
if (!ANAHTARLAR.length) {
  console.error("MCP_API_KEY tanımlı değil. Uzak sürüm anahtarsız çalışmaz; .env.example dosyasına bakın.");
  process.exit(1);
}
const PORT = Number(process.env.PORT ?? 3000);

function esit(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

function anahtarKontrol(req: Request, res: Response, next: NextFunction) {
  const auth = req.header("authorization");
  const verilen = auth?.startsWith("Bearer ") ? auth.slice(7).trim() : (req.header("x-api-key") ?? "");
  if (verilen && ANAHTARLAR.some((k) => esit(k, verilen))) return next();
  res.status(401).json({ jsonrpc: "2.0", error: { code: -32001, message: "Geçersiz veya eksik API anahtarı" }, id: null });
}

const app = express();
app.use(express.json({ limit: "1mb" }));

app.get("/saglik", async (_req, res) => {
  res.json({ durum: "ok", surum: SURUM, onbellek: (await onbellek()).tur });
});

// Durumsuz (stateless) mod: her istek için yeni sunucu + taşıyıcı. Yatay ölçeklemeye uygun.
app.post("/mcp", anahtarKontrol, async (req, res) => {
  const server = sunucuOlustur();
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  res.on("close", () => {
    transport.close();
    server.close();
  });
  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (e) {
    console.error("MCP isteği hatası:", e);
    if (!res.headersSent) res.status(500).json({ jsonrpc: "2.0", error: { code: -32603, message: "Sunucu hatası" }, id: null });
  }
});

// Durumsuz modda GET/DELETE (SSE oturumu) desteklenmiyor
app.all("/mcp", anahtarKontrol, (_req, res) => {
  res.status(405).set("Allow", "POST").json({ jsonrpc: "2.0", error: { code: -32000, message: "Sadece POST desteklenir" }, id: null });
});

await onbellek();
app.listen(PORT, () => console.error(`izmir-acik-veri MCP (HTTP) http://localhost:${PORT}/mcp adresinde çalışıyor`));
