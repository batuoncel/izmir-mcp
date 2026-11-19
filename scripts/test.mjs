// Uçtan uca test: sunucuyu gerçek bir MCP istemcisiyle başlatır ve Demo Day senaryolarını çalıştırır.
// Kullanım: npm run build && npm test
//   (a) Bornova -> Konak canlı rota
//   (b) birden çok kaynak: hava + ulaşım + ücret, etkinlik + ulaşım
//   (c) kaynak çökünce anlaşılır cevap (SIMULE_KAPALI ile)
// Canlı kaynaklar (İzmir API) ara ara çöktüğü için canlı veri içeriğini değil, aracın doğru davranmasını kontrol eder.

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

async function baglan(env = {}) {
  const client = new Client({ name: "test", version: "1.0.0" });
  await client.connect(
    new StdioClientTransport({ command: process.execPath, args: ["build/index.js"], env: { ...process.env, ...env }, stderr: "ignore" }),
  );
  return client;
}

const AYRINTI = process.argv.includes("--ayrinti");
let hata = 0;
async function cagir(client, ad, args, beklenen = {}) {
  const t = Date.now();
  const r = await client.callTool({ name: ad, arguments: args });
  const text = r.content.map((c) => c.text).join("\n");
  const ok =
    (beklenen.hata === undefined || !!r.isError === beklenen.hata) &&
    (!beklenen.icerir || beklenen.icerir.every((s) => text.includes(s))) &&
    (!beklenen.biri || beklenen.biri.some((s) => text.includes(s)));
  if (!ok) hata++;
  console.log(`${ok ? "✅" : "❌"} ${ad} ${JSON.stringify(args)} (${Date.now() - t} ms)${r.isError ? " [isError]" : ""}`);
  if (AYRINTI || !ok) console.log(text.split("\n").map((l) => "   " + l).join("\n"));
  return text;
}
const kontrol = (ad, ok, detay = "") => {
  if (!ok) hata++;
  console.log(`${ok ? "✅" : "❌"} ${ad}${detay ? " — " + detay : ""}`);
};

const c = await baglan();
const { tools } = await c.listTools();
console.log(`Araçlar (${tools.length}): ${tools.map((t) => t.name).join(", ")}`);
const { prompts } = await c.listPrompts();
console.log(`Prompt'lar (${prompts.length}): ${prompts.map((p) => p.name).join(", ")}`);
kontrol("11 araç", tools.length === 11);
kontrol("4 prompt", prompts.length === 4);
const p = await c.getPrompt({ name: "su_an_nasil_giderim", arguments: { nereden: "Bornova", nereye: "Konak" } });
kontrol("Prompt metni üretiliyor", p.messages[0].content.text.includes("Bornova") && p.messages[0].content.text.includes("ulasim_rota"));

console.log("\n===== (a) Bornova'dan Konak'a şu an =====");
await cagir(c, "ulasim_rota", { nereden: "Bornova", nereye: "Konak" }, { hata: false, icerir: ["M1 metro", "Konak metro istasyonu"] });

console.log("\n===== Aktarmalı ve farklı türler =====");
await cagir(c, "ulasim_rota", { nereden: "Karşıyaka İskele", nereye: "Konak" }, { hata: false, icerir: ["vapur"] });
await cagir(c, "ulasim_rota", { nereden: "Narlıdere", nereye: "Bostanlı" }, { hata: false, icerir: ["1 aktarma"] });
await cagir(c, "ulasim_rota", { nereden: "Bornova", nereye: "Havalimanı" }, { hata: false, biri: ["204", "İZBAN"] });
await cagir(c, "ulasim_rota", { nereden: "Xyzqwe", nereye: "Konak" }, { hata: true });

console.log("\n===== (b) Birden çok kaynak =====");
await cagir(c, "hava_durumu", { yer: "Bornova", gun: 2 }, { hata: false, icerir: ["°C"] });
await cagir(c, "hava_kalitesi", { yer: "Bornova" }, { hata: false });
await cagir(c, "ulasim_bilgisi_ara", { soru: "öğrenci genç kartı tek biniş ücreti kaç TL" }, { hata: false, icerir: ["Genç (TL)", "35,00"] });
await cagir(c, "ulasim_bilgisi_ara", { soru: "kartımı kaybettim ne yapmalıyım" }, { hata: false, icerir: ["Kayıp"] });
await cagir(c, "ulasim_bilgisi_ara", { soru: "uzay mekiği bileti" }, { hata: true });
await cagir(c, "nobetci_eczaneler", { yer: "Alsancak", adet: 3 }, { hata: false });
await cagir(c, "kultur_sanat_etkinlikleri", { kategori: "Konser", gun: 14, adet: 3 }, { hata: false });

console.log("\n===== Sefer saatleri =====");
await cagir(c, "toplu_tasima_seferleri", { sistem: "metro", nereden: "Bornova", nereye: "Konak" }, { icerir: ["Kaymakamlık"] });
await cagir(c, "toplu_tasima_seferleri", { sistem: "tramvay", nereden: "Karşıyaka" }, { biri: ["Karşıyaka Tramvayı", "yanıt vermiyor"] });
await cagir(c, "toplu_tasima_seferleri", { sistem: "izban", nereden: "Karşıyaka", nereye: "Alsancak" });
await cagir(c, "toplu_tasima_seferleri", { sistem: "vapur", nereden: "Karşıyaka", nereye: "Konak" });
await cagir(c, "toplu_tasima_seferleri", { sistem: "vapur" }, { icerir: ["Bostanlı"] });

console.log("\n===== Diğer araçlar =====");
await cagir(c, "durak_ara", { ad: "Bornova Metro" }, { hata: false, icerir: ["30009"] });
await cagir(c, "duraga_yaklasan_otobusler", { durakId: 30009 });
await cagir(c, "otobus_konumlari", { hatNo: 35 });
await cagir(c, "kaynak_durumu", {});
await c.close();

console.log("\n===== (c) Kaynak çökünce (SIMULE_KAPALI=eczane,hava,otobus,etkinlik,vapur,havaDurumu) =====");
const k = await baglan({ SIMULE_KAPALI: "eczane,hava,otobus,etkinlik,vapur,havaDurumu" });
await cagir(k, "nobetci_eczaneler", { yer: "Bornova" }, { hata: true, icerir: ["yanıt vermiyor"] });
await cagir(k, "kultur_sanat_etkinlikleri", {}, { hata: true, icerir: ["yanıt vermiyor"] });
await cagir(k, "hava_durumu", {}, { hata: true, icerir: ["yanıt vermiyor"] });
await cagir(k, "hava_kalitesi", { yer: "Konak" }, { hata: false, icerir: ["resmi istasyon verisi yok"] });
await cagir(k, "ulasim_rota", { nereden: "Karşıyaka İskele", nereye: "Konak" }, { hata: false, icerir: ["İZDENİZ vapur sefer servisi şu an yanıt vermiyor"] });
await cagir(k, "ulasim_bilgisi_ara", { soru: "aktarma ücretsiz mi" }, { hata: false, icerir: ["90 Dakika"] });
await cagir(k, "kaynak_durumu", {}, { icerir: ["❌"] });
await k.close();

console.log(hata ? `\n${hata} test başarısız` : "\nTüm testler geçti");
process.exit(hata ? 1 : 0);
