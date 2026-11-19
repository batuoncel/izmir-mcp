// Çok türlü ulaşım ağı ve aktarmalı rota bulma.
//
// Ağ: ESHOT otobüs (GTFS), M1 metro, İZBAN, tramvaylar (GTFS) ve İZDENİZ vapurları.
// Her hat sıralı durak dizisidir; birbirine 300 m'den yakın duraklar arasında yürüyerek aktarma yapılabilir.
// Arama: en fazla 1 aktarma (2 biniş). Önce varışa giden hatlardan "buradan binersen varışa kaç dk" tablosu kurulur,
// sonra başlangıçtan binilen her hattın sonraki duraklarından bu tabloya yürüme mesafesinde bir durak aranır.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { mesafeM, sadelestir } from "./ortak.js";
import { DURAKLAR, HATLAR, IZBAN, METRO, durakAra, istasyonBul } from "./veri.js";

export type Tur = "otobus" | "metro" | "izban" | "tramvay" | "vapur";

export interface Dugum {
  i: number;
  tur: Tur;
  id: number; // kaynağın kendi kimliği (ESHOT durak no, istasyon/iskele id)
  ad: string;
  enlem: number;
  boylam: number;
}

export interface AgHat {
  i: number;
  tur: Tur;
  kod: string; // "930", "M1", "İZBAN", "Konak Tramvayı", "Vapur Karşıyaka-Konak"
  ad: string;
  yon: number;
  dugumler: number[];
  sure: number[]; // ilk duraktan itibaren birikimli dakika
  apiId?: number; // tramvay sefer sıklığı API'sindeki hat no
}

const AG = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "data", "ag.json"), "utf8")) as {
  tramvay: { duraklar: { id: number; ad: string; enlem: number; boylam: number }[]; hatlar: { hat: string; ad: string; yon: number; duraklar: number[]; dkPerDurak: number }[] };
  vapur: { iskeleler: { id: number; ad: string; enlem: number; boylam: number }[]; baglantilar: { a: number; b: number; sureDk: number; gunlukSefer: number }[] };
};

export const BEKLEME_VARSAYILAN: Record<Tur, number> = { otobus: 8, metro: 3, izban: 7, tramvay: 5, vapur: 10 };
const YURUME_M_DK = 75; // dakikada metre
const YURUME_KATSAYI = 1.3; // kuş uçuşundan gerçek yola
const AKTARMA_YARICAP = 300;
const AKTARMA_CEZASI = 2; // dk: ineni bulma, yön değiştirme

export const yurumeDk = (m: number) => Math.round((m * YURUME_KATSAYI) / YURUME_M_DK);

// ---------- Ağ kurulumu ----------

export const DUGUMLER: Dugum[] = [];
export const AG_HATLAR: AgHat[] = [];
const anahtar = new Map<string, number>();

function dugumEkle(tur: Tur, id: number, ad: string, enlem: number, boylam: number): number {
  const k = `${tur}:${id}`;
  const v = anahtar.get(k);
  if (v !== undefined) return v;
  const i = DUGUMLER.length;
  DUGUMLER.push({ i, tur, id, ad, enlem, boylam });
  anahtar.set(k, i);
  return i;
}
export const dugumBul = (tur: Tur, id: number) => {
  const i = anahtar.get(`${tur}:${id}`);
  return i === undefined ? undefined : DUGUMLER[i];
};

function hatEkle(h: Omit<AgHat, "i">) {
  if (h.dugumler.length < 2) return;
  AG_HATLAR.push({ ...h, i: AG_HATLAR.length });
}
const esit = (n: number, dk: number) => Array.from({ length: n }, (_, k) => Number((k * dk).toFixed(1)));

// Otobüs
for (const d of DURAKLAR) dugumEkle("otobus", d.id, d.ad, d.enlem, d.boylam);
for (const h of HATLAR) {
  const dg = h.duraklar.map((id) => anahtar.get(`otobus:${id}`)).filter((x): x is number => x !== undefined);
  hatEkle({ tur: "otobus", kod: h.hatNo, ad: h.ad, yon: h.yon, dugumler: dg, sure: esit(dg.length, 2) });
}

// Metro (M1, iki yön)
const metroDg = METRO.map((s) => dugumEkle("metro", s.id, s.ad, s.enlem, s.boylam));
hatEkle({ tur: "metro", kod: "M1", ad: `${METRO[0].ad} – ${METRO[METRO.length - 1].ad}`, yon: 0, dugumler: metroDg, sure: esit(metroDg.length, 2) });
hatEkle({ tur: "metro", kod: "M1", ad: `${METRO[METRO.length - 1].ad} – ${METRO[0].ad}`, yon: 1, dugumler: [...metroDg].reverse(), sure: esit(metroDg.length, 2) });

// İZBAN: ana hat Alsancak'a uğramaz; Alsancak, Halkapınar'dan ayrılan kısa kol.
const izDg = IZBAN.map((s) => dugumEkle("izban", s.id, s.ad, s.enlem, s.boylam));
const alsancak = IZBAN.findIndex((s) => sadelestir(s.ad) === "alsancak");
const halkapinar = IZBAN.findIndex((s) => sadelestir(s.ad) === "halkapinar");
const anaHat = izDg.filter((_, k) => k !== alsancak);
const kuzeyAlsancak = alsancak >= 0 && halkapinar >= 0 ? [...izDg.slice(0, halkapinar + 1), izDg[alsancak]] : [];
for (const [dg, ad] of [
  [anaHat, `${IZBAN[0].ad} – ${IZBAN[IZBAN.length - 1].ad}`],
  [kuzeyAlsancak, `${IZBAN[0].ad} – Alsancak`],
] as const) {
  hatEkle({ tur: "izban", kod: "İZBAN", ad, yon: 0, dugumler: [...dg], sure: esit(dg.length, 2.8) });
  hatEkle({ tur: "izban", kod: "İZBAN", ad: ad.split(" – ").reverse().join(" – "), yon: 1, dugumler: [...dg].reverse(), sure: esit(dg.length, 2.8) });
}

// Tramvay
const TRAM_API: Record<string, number> = { KONAK: 1, KARSIYAKA: 3, CIGLI_IC: 5, CIGLI_DIS: 6, TURUNCU: 7 };
for (const d of AG.tramvay.duraklar) dugumEkle("tramvay", d.id, d.ad, d.enlem, d.boylam);
for (const h of AG.tramvay.hatlar) {
  const dg = h.duraklar.map((id) => anahtar.get(`tramvay:${id}`)).filter((x): x is number => x !== undefined);
  hatEkle({ tur: "tramvay", kod: h.ad, ad: h.ad, yon: h.yon, dugumler: dg, sure: esit(dg.length, h.dkPerDurak), apiId: TRAM_API[h.hat] });
}

// Vapur: her iskele çifti ayrı, iki duraklı bir "hat"
const iskeleAdi = new Map(AG.vapur.iskeleler.map((x) => [x.id, x.ad]));
for (const s of AG.vapur.iskeleler) dugumEkle("vapur", s.id, `${s.ad} İskelesi`, s.enlem, s.boylam);
for (const b of AG.vapur.baglantilar) {
  const a = anahtar.get(`vapur:${b.a}`)!;
  const c = anahtar.get(`vapur:${b.b}`)!;
  hatEkle({ tur: "vapur", kod: `Vapur ${iskeleAdi.get(b.a)}–${iskeleAdi.get(b.b)}`, ad: `${iskeleAdi.get(b.a)} → ${iskeleAdi.get(b.b)}`, yon: 0, dugumler: [a, c], sure: [0, b.sureDk] });
}

// Düğüm -> (hat, sıra)
const dugumHatlari: { hat: number; sira: number }[][] = DUGUMLER.map(() => []);
for (const h of AG_HATLAR) h.dugumler.forEach((d, sira) => dugumHatlari[d].push({ hat: h.i, sira }));

// Mekânsal ızgara (~330 m hücreler)
const HUCRE = 0.003;
const izgara = new Map<string, number[]>();
const hk = (e: number, b: number) => `${Math.floor(e / HUCRE)}:${Math.floor(b / HUCRE)}`;
for (const d of DUGUMLER) {
  const k = hk(d.enlem, d.boylam);
  if (!izgara.has(k)) izgara.set(k, []);
  izgara.get(k)!.push(d.i);
}

export function yakinDugumler(enlem: number, boylam: number, yaricapM: number): { d: Dugum; m: number }[] {
  const r = Math.ceil(yaricapM / 330);
  const ei = Math.floor(enlem / HUCRE);
  const bi = Math.floor(boylam / HUCRE);
  const out: { d: Dugum; m: number }[] = [];
  for (let x = -r; x <= r; x++)
    for (let y = -r; y <= r; y++)
      for (const i of izgara.get(`${ei + x}:${bi + y}`) ?? []) {
        const d = DUGUMLER[i];
        const m = mesafeM(enlem, boylam, d.enlem, d.boylam);
        if (m <= yaricapM) out.push({ d, m });
      }
  return out.sort((a, b) => a.m - b.m);
}

// Aktarma komşuları önbelleği (düğüm başına bir kez hesaplanır)
const komsuOnbellek = new Map<number, { d: number; m: number }[]>();
function komsular(i: number) {
  let k = komsuOnbellek.get(i);
  if (!k) {
    const d = DUGUMLER[i];
    k = yakinDugumler(d.enlem, d.boylam, AKTARMA_YARICAP).map((x) => ({ d: x.d.i, m: x.m }));
    komsuOnbellek.set(i, k);
  }
  return k;
}

// ---------- Yer çözümleme ----------

export interface Nokta {
  ad: string;
  enlem: number;
  boylam: number;
}

/** Yer adını koordinata çevirir: istasyon/iskele adları önce, sonra durak adları. */
export function noktaBul(sorgu: string): Nokta | undefined {
  const q = sadelestir(sorgu);
  const iskeleIstendi = /\b(iskele|iskelesi|vapur)\b/.test(q);
  const temiz = q.replace(/\b(iskele|iskelesi|vapur|metro|metrosu|istasyonu|izban|tramvay|duragi)\b/g, "").trim();

  if (iskeleIstendi) {
    const s = AG.vapur.iskeleler.find((x) => sadelestir(x.ad) === temiz);
    if (s) return { ad: `${s.ad} İskelesi`, enlem: s.enlem, boylam: s.boylam };
  }
  const m = istasyonBul(METRO, sorgu);
  if (m) return { ad: `${m.ad} metro istasyonu`, enlem: m.enlem, boylam: m.boylam };
  const z = istasyonBul(IZBAN, sorgu);
  if (z) return { ad: `${z.ad} İZBAN istasyonu`, enlem: z.enlem, boylam: z.boylam };
  const s = AG.vapur.iskeleler.find((x) => sadelestir(x.ad) === temiz);
  if (s) return { ad: `${s.ad} İskelesi`, enlem: s.enlem, boylam: s.boylam };
  const t = AG.tramvay.duraklar.find((x) => sadelestir(x.ad) === temiz);
  if (t) return { ad: `${t.ad} tramvay durağı`, enlem: t.enlem, boylam: t.boylam };
  const d = durakAra(sorgu, 15);
  if (!d.length) return undefined;
  const ust = d.filter((x) => x.puan >= d[0].puan - 10).slice(0, 8);
  // Aynı adlı ama çok uzak duraklar (ör. başka ilçedeki "Konak" köyü) ortalamayı bozmasın
  const yakin = ust.filter((x) => mesafeM(x.enlem, x.boylam, ust[0].enlem, ust[0].boylam) < 2000);
  return {
    ad: d[0].ad,
    enlem: yakin.reduce((a, x) => a + x.enlem, 0) / yakin.length,
    boylam: yakin.reduce((a, x) => a + x.boylam, 0) / yakin.length,
  };
}

// ---------- Rota arama ----------

export interface Bacak {
  hat: AgHat;
  binis: Dugum;
  inis: Dugum;
  durakSayisi: number;
  surusDk: number;
}

export interface Rota {
  bacaklar: Bacak[];
  yurumeBasDk: number;
  aktarmaYurumeDk: number;
  aktarmaM: number;
  yurumeSonDk: number;
  /** bekleme varsayımlarıyla toplam süre (dk) */
  toplamDk: number;
}

function adaylar(n: Nokta) {
  let a = yakinDugumler(n.enlem, n.boylam, 700);
  if (a.length < 3) a = yakinDugumler(n.enlem, n.boylam, 1200);
  return a.map((x) => ({ d: x.d.i, yurume: yurumeDk(x.m) }));
}

export function rotaBul(a: Nokta, b: Nokta, adet = 5): Rota[] {
  const O = adaylar(a);
  const D = adaylar(b);
  if (!O.length || !D.length) return [];

  // 1) Hedef tablosu: düğüm -> (hat, biniş sırası, iniş sırası, kalan maliyet) [hat başına en iyi]
  type Hedef = { hat: number; k: number; j: number; maliyet: number; yurumeSon: number };
  const hedef = new Map<number, Map<number, Hedef>>();
  for (const { d, yurume } of D) {
    for (const { hat, sira: j } of dugumHatlari[d]) {
      const h = AG_HATLAR[hat];
      for (let k = 0; k < j; k++) {
        const n = h.dugumler[k];
        const maliyet = h.sure[j] - h.sure[k] + yurume;
        let m = hedef.get(n);
        if (!m) hedef.set(n, (m = new Map()));
        const e = m.get(hat);
        if (!e || maliyet < e.maliyet) m.set(hat, { hat, k, j, maliyet, yurumeSon: yurume });
      }
    }
  }

  // 2) Başlangıçtan binilen hatlar
  const enIyi = new Map<string, Rota>();
  const kaydet = (anahtarStr: string, r: Rota) => {
    const e = enIyi.get(anahtarStr);
    if (!e || r.toplamDk < e.toplamDk) enIyi.set(anahtarStr, r);
  };
  const bacak = (h: AgHat, i: number, j: number): Bacak => ({
    hat: h,
    binis: DUGUMLER[h.dugumler[i]],
    inis: DUGUMLER[h.dugumler[j]],
    durakSayisi: j - i,
    surusDk: Math.round(h.sure[j] - h.sure[i]),
  });

  for (const { d: o, yurume: yBas } of O) {
    for (const { hat: h1i, sira: i } of dugumHatlari[o]) {
      const h1 = AG_HATLAR[h1i];
      const bek1 = BEKLEME_VARSAYILAN[h1.tur];
      // Aktarmasız
      const direkt = hedef.get(o)?.get(h1i);
      if (direkt && direkt.k === i) {
        kaydet(`${h1.kod}`, {
          bacaklar: [bacak(h1, i, direkt.j)],
          yurumeBasDk: yBas,
          aktarmaYurumeDk: 0,
          aktarmaM: 0,
          yurumeSonDk: direkt.yurumeSon,
          toplamDk: yBas + bek1 + direkt.maliyet,
        });
      }
      // Tek aktarmalı
      for (let k = i + 1; k < h1.dugumler.length; k++) {
        const surus1 = h1.sure[k] - h1.sure[i];
        if (surus1 > 90) break;
        for (const { d: n2, m } of komsular(h1.dugumler[k])) {
          const hm = hedef.get(n2);
          if (!hm) continue;
          const yAkt = yurumeDk(m);
          for (const e of hm.values()) {
            const h2 = AG_HATLAR[e.hat];
            if (h2.kod === h1.kod) continue;
            const toplam = yBas + bek1 + surus1 + yAkt + AKTARMA_CEZASI + BEKLEME_VARSAYILAN[h2.tur] + e.maliyet;
            kaydet(`${h1.kod}|${h2.kod}`, {
              bacaklar: [bacak(h1, i, k), bacak(h2, e.k, e.j)],
              yurumeBasDk: yBas,
              aktarmaYurumeDk: yAkt,
              aktarmaM: m,
              yurumeSonDk: e.yurumeSon,
              toplamDk: toplam,
            });
          }
        }
      }
    }
  }

  // 3) Sırala; aynı ilk hatla en fazla 2 seçenek, aktarmasız iyi bir seçenek varsa aktarmalı uzunları ele
  const sirali = [...enIyi.values()].sort((x, y) => x.toplamDk - y.toplamDk);
  const sonuc: Rota[] = [];
  const ilkHat = new Map<string, number>();
  for (const r of sirali) {
    const k = r.bacaklar[0].hat.kod;
    if ((ilkHat.get(k) ?? 0) >= 2) continue;
    if (sonuc.length && r.toplamDk > sonuc[0].toplamDk * 2 + 10) break;
    ilkHat.set(k, (ilkHat.get(k) ?? 0) + 1);
    sonuc.push(r);
    if (sonuc.length >= adet) break;
  }
  return sonuc;
}

export const TUR_SIMGE: Record<Tur, string> = { otobus: "🚌", metro: "🚇", izban: "🚆", tramvay: "🚊", vapur: "⛴️" };

export function dugumAdi(d: Dugum): string {
  switch (d.tur) {
    case "otobus":
      return `"${d.ad}" durağı (no ${d.id})`;
    case "metro":
      return `${d.ad} metro istasyonu`;
    case "izban":
      return `${d.ad} İZBAN istasyonu`;
    case "tramvay":
      return `${d.ad} tramvay durağı`;
    case "vapur":
      return d.ad;
  }
}

export function hatAdi(b: Bacak): string {
  const h = b.hat;
  switch (h.tur) {
    case "otobus":
      return `${h.kod} numaralı otobüs (${h.ad})`;
    case "metro":
      return `M1 metro (${DUGUMLER[h.dugumler[h.dugumler.length - 1]].ad} yönü)`;
    case "izban":
      return `İZBAN (${DUGUMLER[h.dugumler[h.dugumler.length - 1]].ad} yönü)`;
    case "tramvay":
      return `${h.ad} (${DUGUMLER[h.dugumler[h.dugumler.length - 1]].ad} yönü)`;
    case "vapur":
      return `vapur (${h.ad})`;
  }
}

export const AG_OZET = {
  dugum: DUGUMLER.length,
  hat: AG_HATLAR.length,
  vapurIskele: AG.vapur.iskeleler,
  tramvayHatlari: [...new Set(AG.tramvay.hatlar.map((h) => h.ad))],
  tramvayApi: TRAM_API,
  tramvayDuraklari: AG.tramvay.duraklar,
};
