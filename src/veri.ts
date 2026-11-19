// Sunucuyla birlikte gelen sabit veri: ESHOT durak/hat listesi (GTFS) ve metro/İZBAN istasyonları.
// Bu veri ağ gerektirmez; canlı API'ler çökse bile durak arama ve rota bulma çalışır.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { mesafeM, sadelestir } from "./ortak.js";

const DATA = join(dirname(fileURLToPath(import.meta.url)), "..", "data");

export interface Durak {
  id: number;
  ad: string;
  enlem: number;
  boylam: number;
}
export interface Hat {
  hatNo: string;
  ad: string;
  yon: number;
  duraklar: number[];
}
export interface Istasyon {
  id: number;
  ad: string;
  enlem: number;
  boylam: number;
}

const eshot = JSON.parse(readFileSync(join(DATA, "eshot.json"), "utf8")) as {
  uretildi: string;
  duraklar: Durak[];
  hatlar: Hat[];
};
const rayli = JSON.parse(readFileSync(join(DATA, "rayli.json"), "utf8")) as {
  uretildi: string;
  metro: Istasyon[];
  izban: Istasyon[];
  metroSefer: { TarifeId: number; BaslangicSaati: string; BitisSaati: string; Aralik: number }[];
};
/** Metro API çökerse kullanılan gömülü tarife (sefer aralıkları nadiren değişir). */
export const METRO_TARIFE_YEDEK = rayli.metroSefer;
export const RAYLI_TARIHI = rayli.uretildi;

export const DURAKLAR = eshot.duraklar;
export const HATLAR = eshot.hatlar;
export const METRO = rayli.metro; // Evka-3 -> Kaymakamlık sırasıyla
export const IZBAN = rayli.izban; // Aliağa -> Selçuk sırasıyla
export const GTFS_TARIHI = eshot.uretildi;

const durakById = new Map(DURAKLAR.map((d) => [d.id, d]));
const durakAdi = new Map(DURAKLAR.map((d) => [d.id, sadelestir(d.ad)]));

/** Durak -> o duraktan geçen hat numaraları */
const durakHatlari = new Map<number, Set<string>>();
for (const h of HATLAR) {
  for (const id of h.duraklar) {
    if (!durakHatlari.has(id)) durakHatlari.set(id, new Set());
    durakHatlari.get(id)!.add(h.hatNo);
  }
}

export const durak = (id: number) => durakById.get(id);
export const durakHatlariListesi = (id: number) =>
  [...(durakHatlari.get(id) ?? [])].sort((a, b) => Number(a) - Number(b) || a.localeCompare(b));

/** İsim benzerliği puanı: tam eşleşme > başlıyor > kelime olarak geçiyor > içinde geçiyor. */
function puan(ad: string, sorgu: string): number {
  if (ad === sorgu) return 100;
  if (ad.startsWith(sorgu + " ")) return 70;
  if (ad.startsWith(sorgu)) return 60;
  if (` ${ad} `.includes(` ${sorgu} `)) return 50;
  if (ad.includes(sorgu)) return 30;
  const kelimeler = sorgu.split(" ");
  if (kelimeler.length > 1 && kelimeler.every((k) => ad.includes(k))) return 25;
  return 0;
}

export function durakAra(sorgu: string, limit = 10): (Durak & { puan: number })[] {
  const q = sadelestir(sorgu);
  if (!q) return [];
  const sonuc: (Durak & { puan: number })[] = [];
  for (const d of DURAKLAR) {
    const p = puan(durakAdi.get(d.id)!, q);
    if (p > 0) sonuc.push({ ...d, puan: p + Math.min(10, durakHatlari.get(d.id)?.size ?? 0) });
  }
  return sonuc.sort((a, b) => b.puan - a.puan || a.ad.length - b.ad.length).slice(0, limit);
}

export function istasyonBul(liste: Istasyon[], sorgu: string): Istasyon | undefined {
  const q = sadelestir(sorgu).replace(/\b(metro|metrosu|istasyonu|izban|gar|gari)\b/g, "").trim();
  if (!q) return undefined;
  let best: Istasyon | undefined;
  let bestP = 0;
  for (const s of liste) {
    const p = puan(sadelestir(s.ad), q);
    if (p > bestP) {
      best = s;
      bestP = p;
    }
  }
  return bestP >= 50 ? best : undefined;
}

export interface Yer {
  ad: string;
  enlem: number;
  boylam: number;
  kaynak: string;
}

/** "Bornova", "Alsancak", "Karşıyaka İskele" gibi bir yer adını koordinata çevirir. */
export function yerBul(sorgu: string): Yer | undefined {
  const m = istasyonBul(METRO, sorgu);
  if (m) return { ad: `${m.ad} (metro istasyonu)`, enlem: m.enlem, boylam: m.boylam, kaynak: "metro" };
  const z = istasyonBul(IZBAN, sorgu);
  if (z) return { ad: `${z.ad} (İZBAN istasyonu)`, enlem: z.enlem, boylam: z.boylam, kaynak: "izban" };
  const d = durakAra(sorgu, 15);
  if (!d.length) return undefined;
  // En iyi puanlı durakların ortası: tek bir uç durağa takılmamak için
  const ust = d.filter((x) => x.puan >= d[0].puan - 10).slice(0, 8);
  const enlem = ust.reduce((s, x) => s + x.enlem, 0) / ust.length;
  const boylam = ust.reduce((s, x) => s + x.boylam, 0) / ust.length;
  return { ad: d[0].ad, enlem, boylam, kaynak: "durak" };
}

export function yakinDuraklar(enlem: number, boylam: number, limit = 5) {
  return DURAKLAR.map((d) => ({ ...d, mesafe: mesafeM(enlem, boylam, d.enlem, d.boylam) }))
    .sort((a, b) => a.mesafe - b.mesafe)
    .slice(0, limit);
}

/** İzmir BB hava kalitesi ölçüm istasyonları (açık veri: hava-kalitesi-olcum-istasyonlari-konum-verisi). */
export const HAVA_ISTASYONLARI = [
  { bolgeId: 6, ad: "Çiğli", ilce: "Çiğli", enlem: 38.498056, boylam: 27.067778 },
  { bolgeId: 2, ad: "Bornova", ilce: "Bornova", enlem: 38.469167, boylam: 27.221389 },
  { bolgeId: 7, ad: "Bayraklı", ilce: "Bayraklı", enlem: 38.462222, boylam: 27.166667 },
  { bolgeId: 4, ad: "Karşıyaka", ilce: "Karşıyaka", enlem: 38.454167, boylam: 27.109722 },
  { bolgeId: 1, ad: "Alsancak", ilce: "Konak", enlem: 38.432222, boylam: 27.144444 },
  { bolgeId: 3, ad: "Güzelyalı", ilce: "Konak", enlem: 38.395833, boylam: 27.082778 },
  { bolgeId: 5, ad: "Şirinyer", ilce: "Buca", enlem: 38.3825, boylam: 27.148333 },
  { bolgeId: 8, ad: "Güzelbahçe", ilce: "Güzelbahçe", enlem: 38.373503, boylam: 26.88908 },
  { bolgeId: 9, ad: "Bergama", ilce: "Bergama", enlem: 39.111034, boylam: 27.191878 },
];
