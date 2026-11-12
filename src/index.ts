import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const IZMIR_OPENAPI = "https://openapi.izmir.bel.tr/api";
const TIMEOUT_MS = 15_000;

const server = new McpServer({ name: "izmir-acik-veri", version: "0.1.0" });

// 1) İskelet testi: Claude Desktop bağlantısının çalıştığını gösterir.
server.registerTool(
  "merhaba",
  {
    title: "Merhaba",
    description: "Sunucunun çalıştığını test eder. Verilen isme İzmir'den selam döner.",
    inputSchema: { isim: z.string().describe("Selamlanacak kişinin adı") },
  },
  async ({ isim }) => ({
    content: [{ type: "text", text: `Merhaba ${isim}, İzmir Açık Veri MCP sunucusu çalışıyor!` }],
  }),
);

// 2) İlk gerçek veri: ESHOT hattındaki otobüslerin anlık konumları.
// Not: API'de KoorX enlem, KoorY boylam ve ondalık ayracı virgül.
server.registerTool(
  "otobus_konumlari",
  {
    title: "Hattaki otobüslerin anlık konumu",
    description:
      "Bir ESHOT otobüs hattındaki (ör. 35, 202) tüm otobüslerin canlı konumunu (enlem/boylam) getirir. " +
      "'yon' alanı ESHOT'un yön kodudur (0 veya 1) ve otobüsün hattın iki yönünden hangisinde gittiğini gösterir; " +
      "hangi kodun hangi uca gittiği henüz doğrulanmadı, bu yüzden kullanıcıya yön adı söyleme, sadece aynı yönde giden otobüsleri grupla. " +
      "Aynı otobusId birden fazla konum kaydında görünebilir; otobüs sayısı olarak benzersiz otobusId sayısını kullan.",
    inputSchema: { hatNo: z.number().int().positive().describe("ESHOT hat numarası, ör. 35") },
  },
  async ({ hatNo }) => {
    try {
      const res = await fetch(`${IZMIR_OPENAPI}/iztek/hatotobuskonumlari/${hatNo}`, {
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as {
        HataMesaj?: string;
        HatOtobusKonumlari?: { OtobusId: number; Yon: number; KoorX: string; KoorY: string }[];
      };
      if (data.HataMesaj) throw new Error(data.HataMesaj);
      const otobusler = (data.HatOtobusKonumlari ?? []).map((o) => ({
        otobusId: o.OtobusId,
        yon: o.Yon,
        enlem: Number(o.KoorX.replace(",", ".")),
        boylam: Number(o.KoorY.replace(",", ".")),
      }));
      const benzersiz = new Set(otobusler.map((o) => o.otobusId)).size;
      const ozet =
        otobusler.length === 0
          ? `${hatNo} numaralı hatta şu an seferde otobüs yok.`
          : `${hatNo} numaralı hatta şu an ${otobusler.length} konum kaydı var, bunlar ${benzersiz} farklı otobüse ait.`;
      return { content: [{ type: "text", text: `${ozet}\n${JSON.stringify(otobusler, null, 2)}` }] };
    } catch (err) {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: `ESHOT canlı konum servisine şu an ulaşılamıyor (${(err as Error).message}). Biraz sonra tekrar deneyin.`,
          },
        ],
      };
    }
  },
);

await server.connect(new StdioServerTransport());
console.error("izmir-acik-veri MCP sunucusu stdio üzerinden çalışıyor");
