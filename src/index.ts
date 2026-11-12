import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const IZMIR_OPENAPI = "https://openapi.izmir.bel.tr/api";
const TIMEOUT_MS = 15_000;

const server = new McpServer({ name: "izmir-acik-veri", version: "0.1.0" });

// 1) Iskelet testi: Claude Desktop baglantisinin calistigini gosterir.
server.registerTool(
  "merhaba",
  {
    title: "Merhaba",
    description: "Sunucunun calistigini test eder. Verilen isme Izmir'den selam doner.",
    inputSchema: { isim: z.string().describe("Selamlanacak kisinin adi") },
  },
  async ({ isim }) => ({
    content: [{ type: "text", text: `Merhaba ${isim}, Izmir Acik Veri MCP sunucusu calisiyor!` }],
  }),
);

// 2) Ilk gercek veri: ESHOT hattindaki otobuslerin anlik konumlari.
// Not: API'de KoorX enlem, KoorY boylam ve ondalik ayraci virgul.
server.registerTool(
  "otobus_konumlari",
  {
    title: "Hattaki otobuslerin anlik konumu",
    description:
      "Bir ESHOT otobus hattindaki (or. 35, 202) tum otobuslerin canli konumunu (enlem/boylam) ve yonunu getirir.",
    inputSchema: { hatNo: z.number().int().positive().describe("ESHOT hat numarasi, or. 35") },
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
      const ozet =
        otobusler.length === 0
          ? `${hatNo} numarali hatta su an seferde otobus yok.`
          : `${hatNo} numarali hatta su an ${otobusler.length} otobus var.`;
      return { content: [{ type: "text", text: `${ozet}\n${JSON.stringify(otobusler, null, 2)}` }] };
    } catch (err) {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: `ESHOT canli konum servisine su an ulasilamiyor (${(err as Error).message}). Biraz sonra tekrar deneyin.`,
          },
        ],
      };
    }
  },
);

await server.connect(new StdioServerTransport());
console.error("izmir-acik-veri MCP sunucusu stdio uzerinden calisiyor");
