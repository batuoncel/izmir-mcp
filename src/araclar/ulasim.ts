// Ulaşım araçları: rota, durak arama, yaklaşan otobüsler, otobüs konumları, sefer saatleri.

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { AG_OZET, BEKLEME_VARSAYILAN, TUR_SIMGE, dugumAdi, hatAdi, noktaBul, rotaBul, type Bacak, type Rota } from "../ag.js";
import {
  anlikAralik,
  dkSaat,
  hataCevabi,
  izbanSeferleri,
  metroSeferleri,
  sonrakiIzbanlar,
  sonrakiVapurlar,
  tramvaySeferleri,
  vapurSeferleri,
  yaklasanOtobusler,
  type OtobusKonum,
} from "../canli.js";
import { IZMIR_API, KAYNAKLAR, bayatNotu, getir } from "../kaynak.js";
import { hataMetni, izmirSaati, metin, sadelestir, sayi } from "../ortak.js";
import { GTFS_TARIHI, IZBAN, METRO, durak, durakAra, durakHatlariListesi, istasyonBul, yakinDuraklar, yerBul } from "../veri.js";

const DURAK_BASI_DK = 2;

// ---------- Rota için canlı bekleme hesabı ----------

interface BacakSonuc {
  bekleme: number;
  surus: number;
  not: string; // kullanıcıya gösterilecek canlı bilgi
  gecersiz?: string; // bu seçenek şu an kullanılamaz (sefer yok, hat kapalı)
  uyari?: string; // kaynak çöktü vb.
}

type Onbellek = Map<string, Promise<unknown>>;
function bir<T>(ob: Onbellek, k: string, f: () => Promise<T>): Promise<T> {
  if (!ob.has(k)) {
    const p = f();
    p.catch(() => {});
    ob.set(k, p);
  }
  return ob.get(k) as Promise<T>;
}

async function bacakCanli(b: Bacak, varisDk: number, simdi: number, ilkBacak: boolean, ob: Onbellek): Promise<BacakSonuc> {
  const varsayilan = BEKLEME_VARSAYILAN[b.hat.tur];
  const sonuc: BacakSonuc = { bekleme: varsayilan, surus: b.surusDk, not: "" };
  try {
    switch (b.hat.tur) {
      case "otobus": {
        if (!ilkBacak) {
          sonuc.not = "aktarma durağındaki bekleme tahmini";
          break;
        }
        const r = await bir(ob, `o${b.binis.id}`, () => yaklasanOtobusler(b.binis.id));
        const gelenler = r.veri
          .filter((o) => String(o.HatNumarasi) === b.hat.kod)
          .map((o) => o.KalanDurakSayisi * DURAK_BASI_DK)
          .sort((x, y) => x - y);
        const durakVaris = varisDk - simdi; // durağa kaç dk sonra varılıyor
        const yetisilen = gelenler.find((g) => g >= durakVaris);
        if (yetisilen !== undefined) {
          sonuc.bekleme = yetisilen - durakVaris;
          sonuc.not = `CANLI: en yakın ${b.hat.kod} ${yetisilen / DURAK_BASI_DK} durak uzakta (~${yetisilen} dk)`;
        } else {
          sonuc.bekleme = 15;
          sonuc.not = gelenler.length ? `CANLI: yaklaşan ${b.hat.kod} çok yakın, yetişmek zor; sonrakini bekle` : `CANLI: şu an durağa yaklaşan ${b.hat.kod} görünmüyor`;
        }
        if (r.bayat) sonuc.uyari = bayatNotu(r, "otobus").trim();
        break;
      }
      case "metro": {
        const r = await bir(ob, "metro", () => metroSeferleri());
        const a = anlikAralik(r.veri, varisDk);
        if (a.aralik === null) sonuc.gecersiz = `metro şu an çalışmıyor (ilk sefer ${a.ilkSefer})`;
        else {
          sonuc.bekleme = Math.ceil(a.aralik / 2);
          sonuc.not = `her ${a.aralik} dk'da bir`;
        }
        if (r.notu) sonuc.uyari = r.notu.trim();
        break;
      }
      case "tramvay": {
        if (!b.hat.apiId) break;
        const r = await bir(ob, `t${b.hat.apiId}`, () => tramvaySeferleri(b.hat.apiId!));
        const a = anlikAralik(r.veri, varisDk);
        if (a.aralik === null) sonuc.gecersiz = `tramvay şu an çalışmıyor (ilk sefer ${a.ilkSefer})`;
        else {
          sonuc.bekleme = Math.ceil(a.aralik / 2);
          sonuc.not = `her ${a.aralik} dk'da bir`;
        }
        if (r.bayat) sonuc.uyari = bayatNotu(r, "tramvay").trim();
        break;
      }
      case "izban": {
        const r = await bir(ob, `i${b.binis.id}-${b.inis.id}`, () => izbanSeferleri(b.binis.id, b.inis.id));
        const s = sonrakiIzbanlar(r.veri, varisDk, 2);
        if (!s.length) sonuc.gecersiz = "bugün bu yönde İZBAN seferi kalmadı";
        else {
          sonuc.bekleme = s[0].kalkisDk - varisDk;
          sonuc.surus = s[0].sureDk || b.surusDk;
          sonuc.not = `kalkış ${s[0].kalkis}, varış ${s[0].varis}${s[1] ? ` (sonraki ${s[1].kalkis})` : ""}`;
        }
        if (r.bayat) sonuc.uyari = bayatNotu(r, "izban").trim();
        break;
      }
      case "vapur": {
        const r = await bir(ob, `v${b.binis.id}-${b.inis.id}`, () => vapurSeferleri(b.binis.id, b.inis.id));
        const s = sonrakiVapurlar(r.veri, varisDk, 4);
        const iptaller = s.filter((x) => x.iptal);
        const ilk = s.find((x) => !x.iptal);
        if (!ilk) sonuc.gecersiz = "bugün bu iskeleden sefer kalmadı";
        else {
          sonuc.bekleme = ilk.kalkisDk - varisDk;
          sonuc.surus = ilk.sureDk || b.surusDk;
          sonuc.not =
            `kalkış ${ilk.kalkis}, varış ${ilk.varis}` +
            (iptaller.length ? ` — DİKKAT: ${iptaller.map((x) => `${x.kalkis} seferi iptal${x.not ? ` (${x.not})` : ""}`).join(", ")}` : "");
        }
        if (r.bayat) sonuc.uyari = bayatNotu(r, "vapur").trim();
        break;
      }
    }
  } catch {
    sonuc.uyari = `⚠️ ${KAYNAKLAR[b.hat.tur === "otobus" ? "otobus" : b.hat.tur]} şu an yanıt vermiyor; bu bacakta bekleme tahmini (${varsayilan} dk).`;
  }
  return sonuc;
}

interface CanliRota {
  rota: Rota;
  bacaklar: (Bacak & BacakSonuc & { binisDk: number; inisDk: number })[];
  varisDk: number;
  toplamDk: number;
  gecersiz?: string;
  uyarilar: string[];
}

async function canlandir(r: Rota, simdi: number, ob: Onbellek): Promise<CanliRota> {
  let t = simdi + r.yurumeBasDk;
  const bacaklar: CanliRota["bacaklar"] = [];
  const uyarilar: string[] = [];
  let gecersiz: string | undefined;
  for (let i = 0; i < r.bacaklar.length; i++) {
    if (i > 0) t += r.aktarmaYurumeDk + 2;
    const b = r.bacaklar[i];
    const c = await bacakCanli(b, t, simdi, i === 0, ob);
    if (c.gecersiz) gecersiz ??= c.gecersiz;
    if (c.uyari) uyarilar.push(c.uyari);
    const binisDk = t + c.bekleme;
    const inisDk = binisDk + c.surus;
    bacaklar.push({ ...b, ...c, binisDk, inisDk });
    t = inisDk;
  }
  const varisDk = t + r.yurumeSonDk;
  return { rota: r, bacaklar, varisDk, toplamDk: Math.round(varisDk - simdi), gecersiz, uyarilar };
}

function rotaMetni(c: CanliRota, sira: number): string {
  const r = c.rota;
  const s: string[] = [`${sira}) Yaklaşık ${c.toplamDk} dk — varış ~${dkSaat(c.varisDk)}${r.bacaklar.length > 1 ? " (1 aktarma)" : " (aktarmasız)"}`];
  if (r.yurumeBasDk > 0) s.push(`   🚶 Yürü: ${dugumAdi(r.bacaklar[0].binis)} (~${r.yurumeBasDk} dk)`);
  c.bacaklar.forEach((b, i) => {
    if (i > 0) {
      s.push(
        b.binis.i === c.bacaklar[i - 1].inis.i
          ? `   🔁 Aynı yerde aktarma`
          : `   🔁 Aktarma: ~${r.aktarmaM} m yürü, ${dugumAdi(b.binis)} noktasına geç (~${r.aktarmaYurumeDk} dk)`,
      );
    }
    const birim = b.hat.tur === "otobus" || b.hat.tur === "tramvay" ? "durak" : b.hat.tur === "vapur" ? "" : "istasyon";
    s.push(
      `   ${TUR_SIMGE[b.hat.tur]} ${hatAdi(b)}: ${dugumAdi(b.binis)} → ${dugumAdi(b.inis)}` +
        (birim ? `, ${b.durakSayisi} ${birim}` : "") +
        `, ~${Math.round(b.surus)} dk yolculuk; biniş ~${dkSaat(b.binisDk)}` +
        (b.not ? ` [${b.not}]` : ""),
    );
  });
  if (r.yurumeSonDk > 0) s.push(`   🚶 İndikten sonra ~${r.yurumeSonDk} dk yürü`);
  return s.join("\n");
}

// ---------- Araçlar ----------

export function ulasimAraclari(server: McpServer) {
  // ROTA ---------------------------------------------------------------------
  server.registerTool(
    "ulasim_rota",
    {
      title: "İki yer arası toplu taşıma (canlı, aktarmalı)",
      description:
        "İzmir'de iki yer arasında ŞU AN nasıl gidileceğini bulur. Otobüs, M1 metro, İZBAN, tramvaylar ve İZDENİZ vapurlarını birlikte değerlendirir; " +
        "aktarmasız ve tek aktarmalı en iyi seçenekleri süreye göre sıralar. Her bacak için canlı bilgi ekler: durağa yaklaşan otobüs, " +
        "sıradaki vapur/İZBAN kalkışı (iptaller dahil), metro/tramvay sefer sıklığı. Yer adları semt, durak, istasyon veya iskele olabilir " +
        "(ör. 'Bornova', 'Konak', 'Karşıyaka İskele', 'Havalimanı', 'Buca'). Ücret soruları için ulasim_bilgisi_ara ile birleştir.",
      inputSchema: {
        nereden: z.string().min(2).describe("Başlangıç yeri, ör. 'Bornova'"),
        nereye: z.string().min(2).describe("Varış yeri, ör. 'Konak'"),
      },
    },
    async ({ nereden, nereye }) => {
      const A = noktaBul(nereden);
      const B = noktaBul(nereye);
      if (!A || !B) {
        return hataMetni(
          `"${!A ? nereden : nereye}" için durak, istasyon veya iskele bulunamadı. Daha bilinen bir yer adı (semt, durak, metro/İZBAN istasyonu, iskele) dene ya da durak_ara ile doğru adı bul.`,
        );
      }
      const saat = izmirSaati();
      const adaylar = rotaBul(A, B, 7);
      if (!adaylar.length) {
        return metin(`${A.ad} ile ${B.ad} arasında en fazla bir aktarmayla giden toplu taşıma seçeneği bulunamadı. Arada bir aktarma noktası (Konak, Halkapınar, Bornova Metro, Karşıyaka İskele) üzerinden iki ayrı rota sorulabilir.`);
      }
      const ob: Onbellek = new Map();
      const canli = await Promise.all(adaylar.map((r) => canlandir(r, saat.dakika, ob)));
      const gecerli = canli.filter((c) => !c.gecersiz).sort((a, b) => a.toplamDk - b.toplamDk);
      const gecersiz = canli.filter((c) => c.gecersiz);

      const satirlar = [`🕒 İzmir saati ${saat.saat} — ${A.ad} → ${B.ad}`, ""];
      gecerli.slice(0, 4).forEach((c, i) => satirlar.push(rotaMetni(c, i + 1), ""));
      if (!gecerli.length) satirlar.push("Şu an çalışan bir seçenek yok.");
      const kapali = [...new Set(gecersiz.map((c) => c.gecersiz))];
      if (kapali.length) satirlar.push(`Şu an kullanılamayan seçenekler: ${kapali.join("; ")}.`);
      satirlar.push(
        `Not: Süreler tahminidir (otobüste durak başı ~${DURAK_BASI_DK} dk, yürüme ~75 m/dk). ` +
          `İzmirim Kart ile 90 dk içindeki aktarma ücretsizdir; ücret ayrıntısı için ulasim_bilgisi_ara. Hat verisi: ESHOT GTFS ${GTFS_TARIHI}.`,
      );
      const uyarilar = [...new Set(canli.flatMap((c) => c.uyarilar))];
      if (uyarilar.length) satirlar.push(...uyarilar);
      return metin(satirlar.join("\n"));
    },
  );

  // DURAK ARA ---------------------------------------------------------------
  server.registerTool(
    "durak_ara",
    {
      title: "ESHOT durağı ara",
      description:
        "Ada göre ESHOT otobüs durağı arar; durak numarasını, konumunu ve o duraktan geçen hatları verir. " +
        "duraga_yaklasan_otobusler aracı için gereken durak numarasını bulmakta kullan. Çevrimdışı çalışır.",
      inputSchema: { ad: z.string().min(2).describe("Durak adı veya bir kısmı, ör. 'Bornova Metro', 'Alsancak Gar'") },
    },
    async ({ ad }) => {
      const sonuc = durakAra(ad, 8);
      if (!sonuc.length) {
        const yer = yerBul(ad);
        if (!yer) return hataMetni(`"${ad}" adında durak bulunamadı. Farklı bir yazım dene.`);
        const yakin = yakinDuraklar(yer.enlem, yer.boylam, 5);
        return metin(
          `"${ad}" adında durak yok; ${yer.ad} çevresindeki duraklar:\n` +
            yakin.map((d) => `• ${d.ad} — durak ${d.id}, ${d.mesafe} m, hatlar: ${durakHatlariListesi(d.id).join(", ") || "-"}`).join("\n"),
        );
      }
      return metin(
        sonuc
          .map((d) => `• ${d.ad} — durak ${d.id} (${d.enlem}, ${d.boylam}), hatlar: ${durakHatlariListesi(d.id).join(", ") || "-"}`)
          .join("\n") + `\nAynı adlı iki durak genelde yolun iki karşı tarafıdır (iki ayrı yön).`,
      );
    },
  );

  // DURAĞA YAKLAŞAN OTOBÜSLER ----------------------------------------------
  server.registerTool(
    "duraga_yaklasan_otobusler",
    {
      title: "Durağa yaklaşan otobüsler (canlı)",
      description:
        "Bir ESHOT durağına şu an yaklaşan otobüsleri canlı olarak verir: hat, kaç durak uzakta, engelli/bisiklet uygunluğu. " +
        "Durak numarasını bilmiyorsan önce durak_ara aracını kullan. İstersen tek bir hatla sınırla.",
      inputSchema: {
        durakId: z.number().int().positive().describe("ESHOT durak numarası, ör. 30009 (Bornova Metro)"),
        hatNo: z.number().int().positive().optional().describe("Sadece bu hattı göster (isteğe bağlı)"),
      },
    },
    async ({ durakId, hatNo }) => {
      try {
        const r = await yaklasanOtobusler(durakId);
        const d = durak(durakId);
        const ad = d ? `${d.ad} (durak ${durakId})` : `durak ${durakId}`;
        let liste = r.veri;
        if (hatNo) liste = liste.filter((o) => o.HatNumarasi === hatNo);
        liste = [...liste].sort((a, b) => a.KalanDurakSayisi - b.KalanDurakSayisi);
        if (!liste.length) {
          return metin(`${ad}: şu an ${hatNo ? `${hatNo} numaralı hattan ` : ""}yaklaşan otobüs görünmüyor.${bayatNotu(r, "otobus")}`);
        }
        return metin(
          `${ad} — yaklaşan otobüsler (İzmir saati ${izmirSaati().saat}):\n` +
            liste
              .map(
                (o) =>
                  `• ${o.HatNumarasi} ${o.HatAdi.trim()}: ${o.KalanDurakSayisi} durak uzakta (~${o.KalanDurakSayisi * DURAK_BASI_DK} dk)` +
                  `${o.EngelliMi ? ", engelli erişimli" : ""}${o.BisikletAparatliMi ? ", bisiklet aparatlı" : ""}`,
              )
              .join("\n") +
            bayatNotu(r, "otobus"),
        );
      } catch (e) {
        return hataCevabi(e);
      }
    },
  );

  // HATTAKİ OTOBÜS KONUMLARI ----------------------------------------------
  server.registerTool(
    "otobus_konumlari",
    {
      title: "Hattaki otobüslerin anlık konumu",
      description:
        "Bir ESHOT hattındaki (ör. 35, 202) tüm otobüslerin canlı konumunu verir; her otobüs için en yakın durak adıyla birlikte. " +
        "'yon' ESHOT'un yön kodudur (0/1); aynı yöndeki otobüsleri grupla. " +
        "Aynı otobusId birden fazla konum kaydında görünebilir; otobüs sayısı olarak benzersiz otobusId sayısını kullan.",
      inputSchema: { hatNo: z.number().int().positive().describe("ESHOT hat numarası, ör. 35") },
    },
    async ({ hatNo }) => {
      try {
        const r = await getir<{ HataMesaj?: string; HatOtobusKonumlari?: OtobusKonum[] }>({
          kaynak: "otobus",
          url: `${IZMIR_API}/iztek/hatotobuskonumlari/${hatNo}`,
          tazeSn: 30,
          bayatSn: 600,
          dogrula: (v) => ((v as { HataMesaj?: string })?.HataMesaj ? (v as { HataMesaj: string }).HataMesaj : null),
        });
        const otobusler = (r.veri.HatOtobusKonumlari ?? []).map((o) => {
          const enlem = sayi(o.KoorX);
          const boylam = sayi(o.KoorY);
          const yakin = yakinDuraklar(enlem, boylam, 1)[0];
          return { otobusId: o.OtobusId, yon: o.Yon, enlem, boylam, yakinDurak: yakin ? `${yakin.ad} (${yakin.mesafe} m)` : null };
        });
        const benzersiz = new Set(otobusler.map((o) => o.otobusId)).size;
        const ozet =
          otobusler.length === 0
            ? `${hatNo} numaralı hatta şu an seferde otobüs yok.`
            : `${hatNo} numaralı hatta şu an ${otobusler.length} konum kaydı var, bunlar ${benzersiz} farklı otobüse ait.`;
        return metin(`${ozet}${bayatNotu(r, "otobus")}\n${JSON.stringify(otobusler, null, 1)}`);
      } catch (e) {
        return hataCevabi(e);
      }
    },
  );

  // SEFER SAATLERİ (metro / tramvay / İZBAN / vapur) ------------------------
  server.registerTool(
    "toplu_tasima_seferleri",
    {
      title: "Metro, tramvay, İZBAN ve vapur seferleri",
      description:
        "Raylı sistem ve vapur sefer bilgisi. metro: M1'in şu anki sefer sıklığı, istenirse iki istasyon arası yön ve süre. " +
        "tramvay: Konak, Karşıyaka ve Çiğli tramvaylarının şu anki sefer sıklığı ve durakları. " +
        "izban: iki istasyon arası sıradaki kalkışlar. vapur: iki iskele arası sıradaki İZDENİZ seferleri ve İPTAL edilen seferler. " +
        "nereden/nereye boş bırakılırsa istasyon/iskele listesi döner.",
      inputSchema: {
        sistem: z.enum(["metro", "tramvay", "izban", "vapur"]).describe("Ulaşım türü"),
        nereden: z.string().optional().describe("Kalkış istasyonu/iskelesi; tramvayda hat adı da olabilir ('Konak', 'Karşıyaka', 'Çiğli')"),
        nereye: z.string().optional().describe("Varış istasyonu/iskelesi (İZBAN ve vapur için gerekli)"),
      },
    },
    async ({ sistem, nereden, nereye }) => {
      const saat = izmirSaati();
      try {
        if (sistem === "metro") {
          const r = await metroSeferleri();
          const a = anlikAralik(r.veri);
          let t =
            a.aralik === null
              ? `Metro şu an çalışmıyor; ${a.tarife} tarifesinde ilk sefer ${a.ilkSefer}.`
              : `İzmir saati ${saat.saat}: metro ${a.tarife} tarifesinde her ${a.aralik} dakikada bir sefer yapıyor.`;
          if (nereden && nereye) {
            const x = istasyonBul(METRO, nereden);
            const y = istasyonBul(METRO, nereye);
            if (!x || !y) return hataMetni(`"${!x ? nereden : nereye}" bir metro istasyonu değil. İstasyonlar: ${METRO.map((s) => s.ad).join(", ")}`);
            const i = METRO.findIndex((s) => s.id === x.id);
            const j = METRO.findIndex((s) => s.id === y.id);
            t += `\n${x.ad} → ${y.ad}: ${(j > i ? METRO[METRO.length - 1] : METRO[0]).ad} yönüne bin, ${Math.abs(j - i)} istasyon, yaklaşık ${Math.abs(j - i) * 2} dk.`;
          } else {
            t += `\nİstasyonlar (sırasıyla): ${METRO.map((s) => s.ad).join(" – ")}`;
          }
          return metin(t + r.notu);
        }

        if (sistem === "tramvay") {
          const q = sadelestir(nereden ?? "");
          const hatlar = Object.entries(AG_OZET.tramvayApi).filter(([kod]) => !q || sadelestir(kod.replace("_", " ")).includes(q.split(" ")[0]) || (q.includes("cigli") && kod.startsWith("CIGLI")));
          const secilen = hatlar.length ? hatlar : Object.entries(AG_OZET.tramvayApi);
          const ADLAR: Record<string, string> = {
            KONAK: "Konak Tramvayı (Fahrettin Altay – Halkapınar)",
            KARSIYAKA: "Karşıyaka Tramvayı (Alaybey – Ataşehir)",
            CIGLI_IC: "Çiğli Tramvayı İç Hat (Mavi)",
            CIGLI_DIS: "Çiğli Tramvayı Dış Hat (Kırmızı)",
            TURUNCU: "Karşıyaka Ring Hat (Turuncu)",
          };
          const sonuc = await Promise.allSettled(secilen.map(([, id]) => tramvaySeferleri(id)));
          const satir = secilen.map(([kod], i) => {
            const s = sonuc[i];
            if (s.status === "rejected") return `• ${ADLAR[kod]}: sefer servisi yanıt vermiyor`;
            const a = anlikAralik(s.value.veri);
            return `• ${ADLAR[kod]}: ${a.aralik === null ? `şu an çalışmıyor (ilk sefer ${a.ilkSefer})` : `her ${a.aralik} dk'da bir (${a.tarife})`}${s.value.bayat ? " [önbellekten]" : ""}`;
          });
          return metin(`🚊 Tramvay sefer sıklığı, İzmir saati ${saat.saat}:\n${satir.join("\n")}`);
        }

        if (sistem === "izban") {
          if (!nereden || !nereye) return metin(`İZBAN istasyonları (kuzeyden güneye): ${IZBAN.map((s) => s.ad).join(" – ")}\nSefer saatleri için nereden ve nereye ver.`);
          const x = istasyonBul(IZBAN, nereden);
          const y = istasyonBul(IZBAN, nereye);
          if (!x || !y) return hataMetni(`"${!x ? nereden : nereye}" bir İZBAN istasyonu değil. İstasyonlar: ${IZBAN.map((s) => s.ad).join(", ")}`);
          const r = await izbanSeferleri(x.id, y.id);
          const s = sonrakiIzbanlar(r.veri, saat.dakika, 5);
          return metin(
            (s.length
              ? `🚆 İZBAN ${x.ad} → ${y.ad}, sıradaki kalkışlar (İzmir saati ${saat.saat}):\n` +
                s.map((v) => `• ${v.kalkis} kalkış, ${v.varis} varış (${v.kalkisDk - saat.dakika} dk sonra)`).join("\n")
              : `İZBAN ${x.ad} → ${y.ad}: bugün kalan sefer görünmüyor.`) + bayatNotu(r, "izban"),
          );
        }

        // vapur
        const iskeleler = AG_OZET.vapurIskele;
        if (!nereden || !nereye) return metin(`⛴️ İZDENİZ iskeleleri: ${iskeleler.map((x) => x.ad).join(", ")}\nSefer saatleri için nereden ve nereye ver.`);
        const bul = (q: string) => {
          const t = sadelestir(q).replace(/\b(iskele|iskelesi|vapur)\b/g, "").trim();
          return iskeleler.find((x) => sadelestir(x.ad) === t) ?? iskeleler.find((x) => sadelestir(x.ad).startsWith(t));
        };
        const x = bul(nereden);
        const y = bul(nereye);
        if (!x || !y) return hataMetni(`"${!x ? nereden : nereye}" bir İZDENİZ iskelesi değil. İskeleler: ${iskeleler.map((i) => i.ad).join(", ")}`);
        const r = await vapurSeferleri(x.id, y.id);
        const s = sonrakiVapurlar(r.veri, saat.dakika, 6);
        return metin(
          (s.length
            ? `⛴️ Vapur ${x.ad} → ${y.ad}, sıradaki seferler (İzmir saati ${saat.saat}):\n` +
              s.map((v) => `• ${v.kalkis} kalkış, ${v.varis} varış${v.iptal ? ` — İPTAL${v.not ? ` (${v.not})` : ""}` : ` (${v.kalkisDk - saat.dakika} dk sonra)`}`).join("\n")
            : `${x.ad} → ${y.ad}: bugün kalan sefer yok ya da bu iki iskele arasında doğrudan sefer bulunmuyor.`) + bayatNotu(r, "vapur"),
        );
      } catch (e) {
        return hataCevabi(e);
      }
    },
  );
}
