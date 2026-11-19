// MCP prompt'ları: Claude Desktop'ta "+" menüsünden tek tıkla seçilen hazır görevler.
// Demo Day senaryolarını ve sık kullanılan birleşik soruları kapsar. Argümanlar MCP gereği metindir.

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

const mesaj = (text: string) => ({ messages: [{ role: "user" as const, content: { type: "text" as const, text } }] });

export function promptlar(server: McpServer) {
  server.registerPrompt(
    "su_an_nasil_giderim",
    {
      title: "Şu an nasıl giderim?",
      description: "İki yer arasında canlı rota, ücret ve hava durumuna göre öneri (Demo senaryosu a)",
      argsSchema: {
        nereden: z.string().describe("Başlangıç, ör. Bornova"),
        nereye: z.string().describe("Varış, ör. Konak"),
      },
    },
    ({ nereden, nereye }) =>
      mesaj(
        `${nereden}'dan ${nereye}'ya şu an toplu taşımayla nasıl giderim? ulasim_rota ile en iyi seçenekleri bul ve canlı bilgiye (yaklaşan otobüs, sıradaki vapur/İZBAN, iptaller) göre en mantıklısını öner. ` +
          `Önerdiğin yolculukta yağmura ya da rüzgâra yakalanma ihtimali için hava_durumu'na bak; vapur veya uzun yürüyüş varsa bunu dikkate al. ` +
          `Son olarak tam bilet ücretini ve aktarma kuralını ulasim_bilgisi_ara ile kontrol edip kısaca ekle. Kısa ve maddeli cevap ver.`,
      ),
  );

  server.registerPrompt(
    "semt_ozeti",
    {
      title: "Bugün semtimde neler var?",
      description: "Bir semt için hava durumu, hava kalitesi, nöbetçi eczane ve yakın etkinlikler (Demo senaryosu b: birden çok kaynak)",
      argsSchema: { semt: z.string().describe("Semt, ör. Karşıyaka") },
    },
    ({ semt }) =>
      mesaj(
        `${semt} için bugünün kısa bir özetini çıkar: hava_durumu (şu an ve akşam yağış var mı), hava_kalitesi (dışarıda spor yapmak uygun mu), ` +
          `en yakın 3 nöbetçi eczane (nobetci_eczaneler) ve önümüzdeki 3 gündeki belediye etkinlikleri (kultur_sanat_etkinlikleri). ` +
          `Her başlık 2-3 satırı geçmesin. Bir kaynak çalışmıyorsa bunu açıkça yaz, diğerleriyle devam et.`,
      ),
  );

  server.registerPrompt(
    "etkinlige_git",
    {
      title: "Bu hafta bir etkinliğe gidelim",
      description: "Belediyenin bu haftaki etkinliklerinden birini seçip oraya nasıl gidileceğini ve ücretini bulur",
      argsSchema: {
        nereden: z.string().describe("Nereden yola çıkılacak, ör. Bornova"),
        tur: z.string().optional().describe("İsteğe bağlı etkinlik türü: Konser, Tiyatro, Sergi, Sinema..."),
      },
    },
    ({ nereden, tur }) =>
      mesaj(
        `Bu hafta İzmir Büyükşehir Belediyesi'nin ${tur ? `${tur} türündeki ` : ""}etkinliklerine kultur_sanat_etkinlikleri ile bak ve bana uygun 2-3 tanesini öner. ` +
          `Seçtiğim biri için (yoksa ilkini al) açıklamadaki mekânı bul ve ${nereden}'dan oraya ulasim_rota ile nasıl gidileceğini çıkar. ` +
          `Etkinlik akşamsa hava_durumu ile o akşam yağmur olup olmadığını da kontrol et.`,
      ),
  );

  server.registerPrompt(
    "kaynak_kontrolu",
    {
      title: "Veri kaynakları çalışıyor mu?",
      description: "Tüm veri kaynaklarını kontrol eder ve çalışmayanlar için ne yapılabileceğini anlatır (Demo senaryosu c)",
    },
    () =>
      mesaj(
        `kaynak_durumu aracıyla İzmir veri kaynaklarını kontrol et. Çalışmayan kaynak varsa hangi soruların etkileneceğini ve ` +
          `hangi araçların yine de çalışacağını (gömülü durak/hat verisi, önbellek) sade bir dille açıkla. Değer uydurma.`,
      ),
  );
}
