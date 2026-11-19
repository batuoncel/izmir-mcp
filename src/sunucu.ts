// MCP sunucusu. Hem stdio (index.ts) hem uzak HTTP (http.ts) sürümü bunu kullanır.
// Araçlar konularına göre src/araclar/ altında; prompt'lar src/promptlar.ts'de.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { AG_OZET } from "./ag.js";
import { bilgiAraclari } from "./araclar/bilgi.js";
import { sehirAraclari } from "./araclar/sehir.js";
import { ulasimAraclari } from "./araclar/ulasim.js";
import { ETKINLIK_API, IZMIR_API, yokla } from "./kaynak.js";
import { onbellek } from "./onbellek.js";
import { izmirSaati, metin } from "./ortak.js";
import { promptlar } from "./promptlar.js";
import { GTFS_TARIHI } from "./veri.js";

export const SURUM = "2.0.0";

export function sunucuOlustur(): McpServer {
  const server = new McpServer(
    { name: "izmir-acik-veri", version: SURUM },
    {
      instructions:
        "İzmir Büyükşehir Belediyesi açık verisine erişim: otobüs, metro, İZBAN, tramvay ve vapurla aktarmalı canlı rota; nöbetçi eczaneler; " +
        "hava durumu ve hava kalitesi; belediyenin kültür sanat etkinlikleri; ulaşım ücretleri ve İzmirim Kart bilgileri. " +
        "'A'dan B'ye nasıl giderim' sorularında ulasim_rota'yı kullan. Ücret/kart sorularında ulasim_bilgisi_ara'yı kullan ve kaynağı belirt. " +
        "Bir araç bir kaynağın çöktüğünü söylerse bunu kullanıcıya açıkça ilet, veri uydurma; diğer kaynaklarla cevap vermeye devam et.",
    },
  );

  ulasimAraclari(server);
  sehirAraclari(server);
  bilgiAraclari(server);
  promptlar(server);

  server.registerTool(
    "kaynak_durumu",
    {
      title: "Veri kaynaklarının durumu",
      description:
        "Sunucunun kullandığı tüm İzmir veri kaynaklarının şu an çalışıp çalışmadığını ve yanıt sürelerini kontrol eder. " +
        "Bir araç hata verdiğinde veya kullanıcı 'hangi veriler çalışıyor' diye sorduğunda kullan.",
      inputSchema: {},
    },
    async () => {
      const sonuc = await Promise.all([
        yokla("otobus", `${IZMIR_API}/iztek/hatotobuskonumlari/35`),
        yokla("metro", `${IZMIR_API}/metro/sefersaatleri`),
        yokla("tramvay", `${IZMIR_API}/tramvay/seferler/1`),
        yokla("izban", `${IZMIR_API}/izban/istasyonlar`),
        yokla("vapur", `${IZMIR_API}/izdeniz/iskeleler`),
        yokla("eczane", `${IZMIR_API}/ibb/nobetcieczaneler`),
        yokla("hava", `${IZMIR_API}/ibb/cevre/havadegerleri/${izmirSaati().tarih}`),
        yokla("havaCanli", "https://air-quality-api.open-meteo.com/v1/air-quality?latitude=38.42&longitude=27.14&current=european_aqi"),
        yokla("havaDurumu", "https://api.open-meteo.com/v1/forecast?latitude=38.42&longitude=27.14&current=temperature_2m"),
        yokla("etkinlik", ETKINLIK_API),
      ]);
      const ob = await onbellek();
      return metin(
        sonuc.map((s) => `${s.durum === "çalışıyor" ? "✅" : "❌"} ${s.kaynak}: ${s.durum} (${s.sureMs} ms)${s.not ? ` — ${s.not}` : ""}`).join("\n") +
          `\n✅ Ulaşım ağı (${AG_OZET.dugum} durak/istasyon/iskele, ${AG_OZET.hat} hat): sunucuya gömülü (ESHOT GTFS ${GTFS_TARIHI}), her zaman çalışır` +
          `\n✅ Ücret ve kart belgeleri: sunucuya gömülü, her zaman çalışır` +
          `\nÖnbellek: ${ob.tur === "redis" ? "Redis" : "sunucu hafızası"}. Çöken kaynaklar için önbellekte veri varsa araçlar onu "bayat" uyarısıyla döner.`,
      );
    },
  );

  return server;
}
