// Uzak sürüm testi: build/http.js'i geçici bir anahtarla başlatır, kimlik doğrulamayı ve bir araç çağrısını dener, sonra kapatır.
// Kullanım: npm run build && node scripts/test-http.mjs

import { spawn } from "node:child_process";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const PORT = 3917;
const ANAHTAR = "test-anahtari-" + Math.random().toString(36).slice(2);
const URL_ = `http://localhost:${PORT}`;
const sunucu = spawn(process.execPath, ["build/http.js"], { env: { ...process.env, MCP_API_KEY: ANAHTAR, PORT: String(PORT) }, stdio: "ignore" });

let hata = 0;
const kontrol = (ad, ok, detay = "") => {
  if (!ok) hata++;
  console.log(`${ok ? "✅" : "❌"} ${ad}${detay ? " — " + detay : ""}`);
};

try {
  for (let i = 0; i < 30; i++) {
    try {
      if ((await fetch(`${URL_}/saglik`)).ok) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  const saglik = await (await fetch(`${URL_}/saglik`)).json();
  kontrol("GET /saglik", saglik.durum === "ok", JSON.stringify(saglik));

  const post = (headers) =>
    fetch(`${URL_}/mcp`, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...headers }, body: "{}" });
  kontrol("Anahtarsız istek reddedilir", (await post({})).status === 401);
  kontrol("Yanlış anahtar reddedilir", (await post({ authorization: "Bearer yanlis" })).status === 401);

  const c = new Client({ name: "test-http", version: "1.0.0" });
  await c.connect(new StreamableHTTPClientTransport(new URL(`${URL_}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${ANAHTAR}` } } }));
  const { tools } = await c.listTools();
  kontrol("Doğru anahtarla araç listesi", tools.length === 11, `${tools.length} araç`);
  const r = await c.callTool({ name: "durak_ara", arguments: { ad: "Konak" } });
  kontrol("Araç çağrısı (durak_ara)", !r.isError && r.content[0].text.includes("Konak"));
  const x = await c.callTool({ name: "toplu_tasima_seferleri", arguments: { sistem: "metro", nereden: "Bornova", nereye: "Konak" } });
  kontrol("Canlı araç çağrısı (metro)", x.content[0].text.includes("Konak"), x.content[0].text.split("\n")[0]);
  await c.close();
} catch (e) {
  kontrol("Beklenmeyen hata", false, e.message);
} finally {
  sunucu.kill();
}
console.log(hata ? `${hata} test başarısız` : "HTTP testleri geçti");
process.exit(hata ? 1 : 0);
