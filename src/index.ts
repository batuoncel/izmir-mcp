// Yerel sürüm: Claude Desktop / Claude Code sunucuyu stdio üzerinden başlatır.
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { sunucuOlustur } from "./sunucu.js";

await sunucuOlustur().connect(new StdioServerTransport());
console.error("izmir-acik-veri MCP sunucusu stdio üzerinden çalışıyor");
