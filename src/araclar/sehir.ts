// Şehir araçları: nöbetçi eczane, hava kalitesi, hava durumu, kültür sanat etkinlikleri.

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { noktaBul } from "../ag.js";
import { diziMi, hataCevabi } from "../canli.js";
import { ETKINLIK_API, IZMIR_API, KAYNAKLAR, bayatNotu, getir } from "../kaynak.js";
import { hataMetni, izmirSaati, mesafeM, metin, sadelestir, sayi } from "../ortak.js";
import { HAVA_ISTASYONLARI } from "../veri.js";

interface Eczane {
  Adi: string;
  Telefon: string;
  Adres: string;
  Bolge: string;
  BolgeAciklama: string;
  LokasyonX: string; // enlem
  LokasyonY: string; // boylam
}
interface HavaOlcum {
  OlcumTarihi: string;
  BolgeId: number;
  GazAdi: string;
  OlcumDegeri: string;
}
interface Etkinlik {
  ad: string;
  kisaAciklama: string | null;
  aciklama: string | null;
  yasSiniriAdi: string | null;
  sonrakiSeansBaslangic: string | null;
  sonrakiSeansBitis: string | null;
  kategoriler: { ad: string }[];
  organizator: { ad: string } | null;
}
interface Tahmin {
  current: { time: string; temperature_2m: number; apparent_temperature: number; precipitation: number; weather_code: number; wind_speed_10m: number; relative_humidity_2m: number };
  hourly: { time: string[]; temperature_2m: number[]; precipitation_probability: number[]; weather_code: number[] };
  daily: { time: string[]; temperature_2m_max: number[]; temperature_2m_min: number[]; precipitation_probability_max: number[]; precipitation_sum: number[]; weather_code: number[]; wind_speed_10m_max: number[] };
}

/** WMO hava kodları */
function havaKodu(k: number): string {
  if (k === 0) return "açık";
  if (k <= 2) return "az bulutlu";
  if (k === 3) return "kapalı";
  if (k === 45 || k === 48) return "sisli";
  if (k >= 51 && k <= 57) return "çiseleme";
  if (k >= 61 && k <= 65) return k === 65 ? "kuvvetli yağmur" : "yağmurlu";
  if (k === 66 || k === 67) return "dondurucu yağmur";
  if (k >= 71 && k <= 77) return "kar";
  if (k >= 80 && k <= 82) return k === 82 ? "şiddetli sağanak" : "sağanak";
  if (k === 85 || k === 86) return "kar sağanağı";
  if (k >= 95) return "gök gürültülü fırtına";
  return `kod ${k}`;
}

function aqiYorum(aqi: number): string {
  if (aqi <= 20) return "iyi";
  if (aqi <= 40) return "makul";
  if (aqi <= 60) return "orta";
  if (aqi <= 80) return "kötü";
  if (aqi <= 100) return "çok kötü";
  return "son derece kötü";
}

function duzMetin(html: string | null, uzunluk = 280): string {
  const t = (html ?? "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;|&#39;|&rsquo;|&lsquo;|&ldquo;|&rdquo;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
  return t.length > uzunluk ? t.slice(0, uzunluk).replace(/\s\S*$/, "") + "…" : t;
}

function tarihYaz(s: string | null): string {
  if (!s) return "?";
  const [g, sa] = s.split("T");
  const [y, a, d] = g.split("-");
  return `${d}.${a}.${y}${sa && sa !== "00:00:00" ? " " + sa.slice(0, 5) : ""}`;
}

const GUNLER = ["Pazar", "Pazartesi", "Salı", "Çarşamba", "Perşembe", "Cuma", "Cumartesi"];

export function sehirAraclari(server: McpServer) {
  // NÖBETÇİ ECZANE -----------------------------------------------------------
  server.registerTool(
    "nobetci_eczaneler",
    {
      title: "Nöbetçi eczaneler",
      description:
        "İzmir'de bugünkü nöbetçi eczaneleri verir (nöbet sabah 08:00'den ertesi sabah 08:00'e kadar). " +
        "yer verilirse (semt, durak, istasyon adı) o yere en yakın eczaneleri mesafesiyle sıralar; telefon ve adres içerir. " +
        "Eczaneye nasıl gidileceği için ulasim_rota ile birleştir.",
      inputSchema: {
        yer: z.string().optional().describe("Semt veya yer adı, ör. 'Bornova', 'Alsancak'"),
        adet: z.number().int().min(1).max(20).default(5).describe("Kaç eczane listelensin"),
      },
    },
    async ({ yer, adet }) => {
      try {
        const r = await getir<Eczane[]>({ kaynak: "eczane", url: `${IZMIR_API}/ibb/nobetcieczaneler`, tazeSn: 1800, bayatSn: 12 * 3600, dogrula: diziMi });
        const hepsi = r.veri.map((e) => ({ ...e, enlem: sayi(e.LokasyonX), boylam: sayi(e.LokasyonY) }));
        if (!yer) {
          const bolgeler = [...new Set(hepsi.map((e) => e.Bolge))].sort();
          return metin(`Bugün İzmir'de ${hepsi.length} nöbetçi eczane var. Hangi semtte aradığını sorup yer parametresiyle tekrar çağır.\nBölgeler: ${bolgeler.join(", ")}${bayatNotu(r, "eczane")}`);
        }
        const q = sadelestir(yer);
        const konum = noktaBul(yer);
        const sirali = hepsi
          .map((e) => ({
            ...e,
            mesafe: konum && e.enlem ? mesafeM(konum.enlem, konum.boylam, e.enlem, e.boylam) : Infinity,
            adEslesme: sadelestir(`${e.Bolge} ${e.BolgeAciklama} ${e.Adres}`).includes(q),
          }))
          .sort((a, b) => Number(b.adEslesme && a.mesafe > 3000) - Number(a.adEslesme && b.mesafe > 3000) || a.mesafe - b.mesafe)
          .slice(0, adet);
        if (!konum && !sirali.some((e) => e.adEslesme)) return hataMetni(`"${yer}" yeri bulunamadı. Bir semt, durak veya istasyon adı dene.`);
        return metin(
          `${konum ? konum.ad : yer} çevresindeki nöbetçi eczaneler:\n` +
            sirali
              .map(
                (e) =>
                  `• ${e.Adi} — ${e.Adres}, ${e.Bolge}${e.BolgeAciklama ? ` (${e.BolgeAciklama.trim()})` : ""}, tel: ${e.Telefon}` +
                  (Number.isFinite(e.mesafe) ? `, ~${(e.mesafe / 1000).toFixed(1)} km` : "") +
                  (e.enlem ? ` [konum: ${e.enlem},${e.boylam}]` : ""),
              )
              .join("\n") +
            `\nMesafeler kuş uçuşu. Gitmeden önce telefonla teyit etmek iyi olur.${bayatNotu(r, "eczane")}`,
        );
      } catch (e) {
        return hataCevabi(e);
      }
    },
  );

  // HAVA DURUMU --------------------------------------------------------------
  server.registerTool(
    "hava_durumu",
    {
      title: "Hava durumu ve tahmin",
      description:
        "İzmir'de bir yer için şu anki hava (sıcaklık, hissedilen, yağış, rüzgâr, nem), önümüzdeki saatlerin yağış olasılığı " +
        "ve günlük tahmin (en fazla 7 gün). Kaynak: Open-Meteo. 'Yağmur yağacak mı, vapura mı metroya mı bineyim?' gibi " +
        "sorularda ulasim_rota ile, dış mekân etkinliklerinde kultur_sanat_etkinlikleri ile birleştir.",
      inputSchema: {
        yer: z.string().optional().describe("Semt/yer adı, ör. 'Bornova'. Boşsa İzmir merkez (Konak)."),
        gun: z.number().int().min(1).max(7).default(3).describe("Kaç günlük tahmin"),
      },
    },
    async ({ yer, gun }) => {
      const konum = yer ? noktaBul(yer) : { ad: "İzmir merkez (Konak)", enlem: 38.4189, boylam: 27.1287 };
      if (!konum) return hataMetni(`"${yer}" yeri bulunamadı. Bir semt, durak veya istasyon adı dene.`);
      try {
        const r = await getir<Tahmin>({
          kaynak: "havaDurumu",
          url:
            `https://api.open-meteo.com/v1/forecast?latitude=${konum.enlem.toFixed(4)}&longitude=${konum.boylam.toFixed(4)}` +
            `&current=temperature_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m,relative_humidity_2m` +
            `&hourly=temperature_2m,precipitation_probability,weather_code` +
            `&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,precipitation_sum,wind_speed_10m_max` +
            `&timezone=Europe%2FIstanbul&forecast_days=7`,
          tazeSn: 900,
          bayatSn: 6 * 3600,
        });
        const v = r.veri;
        const c = v.current;
        const simdiSaat = c.time.slice(0, 13);
        const i0 = Math.max(0, v.hourly.time.findIndex((t) => t.startsWith(simdiSaat)));
        const saatlik = v.hourly.time
          .slice(i0 + 1, i0 + 13)
          .map((t, k) => ({ saat: t.slice(11, 16), olasilik: v.hourly.precipitation_probability[i0 + 1 + k], kod: v.hourly.weather_code[i0 + 1 + k], derece: v.hourly.temperature_2m[i0 + 1 + k] }));
        const yagisli = saatlik.filter((s) => s.olasilik >= 40);
        const satirlar = [
          `📍 ${konum.ad} — şu an (${c.time.slice(11, 16)}): ${c.temperature_2m}°C (hissedilen ${c.apparent_temperature}°C), ${havaKodu(c.weather_code)}, ` +
            `rüzgâr ${c.wind_speed_10m} km/sa, nem %${c.relative_humidity_2m}${c.precipitation > 0 ? `, yağış ${c.precipitation} mm` : ""}`,
          yagisli.length
            ? `☔ Önümüzdeki 12 saatte yağış olasılığı yüksek saatler: ${yagisli.map((s) => `${s.saat} (%${s.olasilik})`).join(", ")}`
            : `☀️ Önümüzdeki 12 saatte yağış beklenmiyor (en yüksek olasılık %${Math.max(0, ...saatlik.map((s) => s.olasilik))}).`,
          `\n📅 ${gun} günlük tahmin:`,
          ...v.daily.time.slice(0, gun).map((t, k) => {
            const g = GUNLER[new Date(t + "T12:00:00").getDay()];
            return (
              `• ${t.slice(8, 10)}.${t.slice(5, 7)} ${g}: ${havaKodu(v.daily.weather_code[k])}, ${v.daily.temperature_2m_min[k]}–${v.daily.temperature_2m_max[k]}°C, ` +
              `yağış olasılığı %${v.daily.precipitation_probability_max[k]}${v.daily.precipitation_sum[k] > 0 ? ` (${v.daily.precipitation_sum[k]} mm)` : ""}, rüzgâr en fazla ${v.daily.wind_speed_10m_max[k]} km/sa`
            );
          }),
        ];
        if (Math.max(...v.daily.wind_speed_10m_max.slice(0, 2)) >= 50) satirlar.push(`\n⚠️ Kuvvetli rüzgâr bekleniyor; vapur seferlerinde iptal olabilir, toplu_tasima_seferleri ile kontrol et.`);
        return metin(satirlar.join("\n") + bayatNotu(r, "havaDurumu"));
      } catch (e) {
        return hataCevabi(e);
      }
    },
  );

  // HAVA KALİTESİ ------------------------------------------------------------
  server.registerTool(
    "hava_kalitesi",
    {
      title: "Hava kalitesi",
      description:
        "İzmir'de hava kalitesi. İki kaynağı birleştirir: (1) İzmir BB ölçüm istasyonlarının resmi son günlük PM10/SO2 ortalamaları, " +
        "(2) Open-Meteo modelinden saatlik güncel Avrupa Hava Kalitesi İndeksi (EAQI), PM2.5, PM10, NO2, O3. " +
        "yer verilirse o yere en yakın istasyon ve o noktanın güncel değerleri döner; verilmezse tüm istasyonlar. " +
        "Bir kaynak çökerse diğeriyle cevap verir.",
      inputSchema: { yer: z.string().optional().describe("Semt/yer adı, ör. 'Bornova', 'Karşıyaka'") },
    },
    async ({ yer }) => {
      const konum = yer ? noktaBul(yer) : undefined;
      if (yer && !konum) return hataMetni(`"${yer}" yeri bulunamadı. Bir semt, durak veya istasyon adı dene.`);
      const istasyonlar = konum
        ? [...HAVA_ISTASYONLARI].sort((a, b) => mesafeM(konum.enlem, konum.boylam, a.enlem, a.boylam) - mesafeM(konum.enlem, konum.boylam, b.enlem, b.boylam)).slice(0, 1)
        : HAVA_ISTASYONLARI;
      const noktalar = konum ? [{ ad: konum.ad, enlem: konum.enlem, boylam: konum.boylam }] : istasyonlar.map((i) => ({ ad: i.ad, enlem: i.enlem, boylam: i.boylam }));

      const [resmi, model] = await Promise.allSettled([
        getir<HavaOlcum[]>({ kaynak: "hava", url: `${IZMIR_API}/ibb/cevre/havadegerleri/${izmirSaati().tarih}`, tazeSn: 3600, bayatSn: 3 * 24 * 3600, dogrula: diziMi }),
        getir<unknown>({
          kaynak: "havaCanli",
          url:
            `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${noktalar.map((n) => n.enlem.toFixed(4)).join(",")}` +
            `&longitude=${noktalar.map((n) => n.boylam.toFixed(4)).join(",")}&current=european_aqi,pm2_5,pm10,nitrogen_dioxide,ozone&timezone=Europe%2FIstanbul`,
          tazeSn: 900,
          bayatSn: 6 * 3600,
        }),
      ]);

      const satirlar: string[] = [];
      if (konum) satirlar.push(`📍 ${konum.ad}`);
      if (model.status === "fulfilled") {
        type Cur = { current: { time: string; european_aqi: number; pm2_5: number; pm10: number; nitrogen_dioxide: number; ozone: number } };
        const v = model.value.veri as Cur | Cur[];
        const dizi = Array.isArray(v) ? v : [v];
        satirlar.push(`\n🌫️ GÜNCEL (Open-Meteo modeli, ${dizi[0]?.current.time.replace("T", " ")}):`);
        dizi.forEach((d, i) => {
          const c = d.current;
          satirlar.push(`• ${noktalar[i].ad}: EAQI ${c.european_aqi} (${aqiYorum(c.european_aqi)}), PM2.5 ${c.pm2_5}, PM10 ${c.pm10}, NO2 ${c.nitrogen_dioxide}, O3 ${c.ozone} µg/m³`);
        });
        if (model.value.bayat) satirlar.push(bayatNotu(model.value, "havaCanli").trim());
      } else {
        satirlar.push(`\n⚠️ ${KAYNAKLAR.havaCanli} şu an yanıt vermiyor; güncel saatlik değer yok.`);
      }
      if (resmi.status === "fulfilled") {
        const gun = resmi.value.veri[0]?.OlcumTarihi?.slice(0, 10) ?? "?";
        satirlar.push(`\n🏛️ RESMİ ÖLÇÜM (İzmir BB istasyonları, ${gun} günlük ortalama):`);
        for (const ist of istasyonlar) {
          const olc = resmi.value.veri.filter((o) => o.BolgeId === ist.bolgeId);
          const pm10 = olc.find((o) => o.GazAdi === "PM10")?.OlcumDegeri;
          const so2 = olc.find((o) => o.GazAdi === "SO2")?.OlcumDegeri;
          satirlar.push(
            `• ${ist.ad} istasyonu (${ist.ilce}): PM10 ${pm10 || "ölçüm yok"}${pm10 ? " µg/m³" : ""}` +
              (pm10 && Number(pm10) > 50 ? " (günlük sınır 50'nin üstünde)" : "") +
              `, SO2 ${so2 || "ölçüm yok"}${so2 ? " µg/m³" : ""}` +
              (konum ? ` — sorulan yere ~${(mesafeM(konum.enlem, konum.boylam, ist.enlem, ist.boylam) / 1000).toFixed(1)} km` : ""),
          );
        }
        if (resmi.value.bayat) satirlar.push(bayatNotu(resmi.value, "hava").trim());
      } else {
        satirlar.push(`\n⚠️ ${KAYNAKLAR.hava} şu an yanıt vermiyor; resmi istasyon verisi yok.`);
      }
      if (resmi.status === "rejected" && model.status === "rejected") {
        return hataMetni("Hava kalitesi kaynaklarının ikisi de (İzmir BB ölçümleri ve Open-Meteo) şu an yanıt vermiyor. Kullanıcıya bunu söyle, değer uydurma.");
      }
      satirlar.push(`\nEAQI ölçeği: 0-20 iyi, 20-40 makul, 40-60 orta, 60-80 kötü, 80-100 çok kötü, 100+ son derece kötü. Hassas gruplar (astım, kalp hastalığı) 'orta' ve üstünde uzun dış mekân aktivitesini azaltmalı.`);
      return metin(satirlar.join("\n"));
    },
  );

  // KÜLTÜR SANAT ETKİNLİKLERİ ------------------------------------------------
  server.registerTool(
    "kultur_sanat_etkinlikleri",
    {
      title: "Belediye kültür sanat etkinlikleri",
      description:
        "İzmir Büyükşehir Belediyesi'nin duyurduğu güncel kültür sanat etkinlikleri: konser, tiyatro, sergi, sinema, atölye, festival. " +
        "Her etkinlik için tarih, kategori, yaş sınırı, düzenleyen ve kısa açıklama (mekân genelde açıklamada geçer) verir. " +
        "Kategori, kelime ve önümüzdeki gün sayısıyla süzülebilir. Etkinliğe nasıl gidileceği için ulasim_rota ile birleştir.",
      inputSchema: {
        kategori: z.enum(["Konser", "Tiyatro", "Sergi", "Sinema", "Atölye", "Festival", "Diğer"]).optional().describe("Etkinlik türü"),
        arama: z.string().optional().describe("Ad veya açıklamada geçen kelime, ör. 'senfoni', 'Kültürpark', 'çocuk'"),
        gun: z.number().int().min(1).max(90).default(7).describe("Bugünden itibaren kaç günlük etkinlikler (varsayılan 7)"),
        adet: z.number().int().min(1).max(20).default(8).describe("En fazla kaç etkinlik"),
      },
    },
    async ({ kategori, arama, gun, adet }) => {
      try {
        const r = await getir<Etkinlik[]>({ kaynak: "etkinlik", url: ETKINLIK_API, tazeSn: 3600, bayatSn: 2 * 24 * 3600, dogrula: diziMi });
        const bugun = izmirSaati().tarih;
        const bitisSiniri = new Date(Date.parse(bugun) + gun * 86_400_000).toISOString().slice(0, 10);
        const q = arama ? sadelestir(arama) : "";
        const liste = r.veri
          .filter((e) => {
            const bas = (e.sonrakiSeansBaslangic ?? "").slice(0, 10);
            const bit = (e.sonrakiSeansBitis ?? e.sonrakiSeansBaslangic ?? "").slice(0, 10);
            if (!bas) return false;
            if (bit < bugun || bas > bitisSiniri) return false;
            if (kategori && !e.kategoriler.some((k) => k.ad === kategori)) return false;
            if (q && !sadelestir(`${e.ad} ${e.kisaAciklama ?? ""} ${e.aciklama ?? ""}`).includes(q)) return false;
            return true;
          })
          .sort((a, b) => (a.sonrakiSeansBaslangic ?? "").localeCompare(b.sonrakiSeansBaslangic ?? ""));
        const filtre = [kategori, arama && `"${arama}"`, `önümüzdeki ${gun} gün`].filter(Boolean).join(", ");
        if (!liste.length) return metin(`Uygun etkinlik bulunamadı (${filtre}). Gün sayısını artırmayı veya filtreyi kaldırmayı dene.${bayatNotu(r, "etkinlik")}`);
        return metin(
          `İzmir BB kültür sanat etkinlikleri (${filtre}) — ${liste.length} sonuç${liste.length > adet ? `, ilk ${adet} gösteriliyor` : ""}:\n` +
            liste
              .slice(0, adet)
              .map((e) => {
                const bas = e.sonrakiSeansBaslangic;
                const bit = e.sonrakiSeansBitis;
                const tarih = bit && bit.slice(0, 10) !== bas?.slice(0, 10) ? `${tarihYaz(bas)} – ${tarihYaz(bit)}` : tarihYaz(bas);
                return (
                  `• ${e.ad.trim()} [${e.kategoriler.map((k) => k.ad).join(", ") || "-"}] — ${tarih}` +
                  `${e.yasSiniriAdi ? `, ${e.yasSiniriAdi}` : ""}${e.organizator?.ad ? `, düzenleyen: ${e.organizator.ad}` : ""}\n` +
                  `  ${duzMetin(e.kisaAciklama || e.aciklama)}`
                );
              })
              .join("\n") +
            `\nTarih, bir sonraki seansı gösterir; sergiler aralık boyunca açıktır.${bayatNotu(r, "etkinlik")}`,
        );
      } catch (e) {
        return hataCevabi(e);
      }
    },
  );
}
