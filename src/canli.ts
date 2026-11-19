// Canlı kaynak çağrıları ve tarife hesapları (otobüs, metro, tramvay, İZBAN, vapur).

import { IZMIR_API, KAYNAKLAR, KaynakHatasi, bayatNotu, getir, type Sonuc } from "./kaynak.js";
import { hataMetni, izmirSaati, saatToDakika } from "./ortak.js";
import { METRO_TARIFE_YEDEK, RAYLI_TARIHI } from "./veri.js";

export const diziMi = (v: unknown) => (Array.isArray(v) ? null : "beklenmeyen cevap biçimi");

// ---------- Tipler ----------

export interface YaklasanOtobus {
  KalanDurakSayisi: number;
  HattinYonu: number;
  HatNumarasi: number;
  HatAdi: string;
  OtobusId: number;
  EngelliMi: boolean;
  BisikletAparatliMi: boolean;
}
export interface OtobusKonum {
  OtobusId: number;
  Yon: number;
  KoorX: string;
  KoorY: string;
}
/** Metro ve tramvay aynı biçimi kullanır: zaman dilimi başına sefer aralığı. */
export interface SiklikSatiri {
  TarifeId: number;
  BaslangicSaati: string;
  BitisSaati: string;
  Aralik: number;
}
export interface IzbanSefer {
  HareketSaati: string;
  VarisSaati: string;
}
export interface VapurHat {
  hatAdi: string;
  seferSatirlari: {
    IptalMi: boolean | null;
    IptalAciklama: string | null;
    Aciklama: string | null;
    seferSaatleri: { KalkisSaati: string | null; VarisSaati: string | null }[];
  }[];
}

// ---------- Çağrılar ----------

export const yaklasanOtobusler = (durakId: number) =>
  getir<YaklasanOtobus[]>({
    kaynak: "otobus",
    url: `${IZMIR_API}/iztek/duragayaklasanotobusler/${durakId}`,
    tazeSn: 30,
    bayatSn: 600, // 10 dk'dan eski "canlı" konum işe yaramaz
    dogrula: diziMi,
  });

/** Metro tarifesi; API ve önbellek ikisi de yoksa sunucuya gömülü tarifeye düşer. */
export async function metroSeferleri(): Promise<Sonuc<SiklikSatiri[]> & { notu: string }> {
  try {
    const r = await getir<SiklikSatiri[]>({ kaynak: "metro", url: `${IZMIR_API}/metro/sefersaatleri`, tazeSn: 6 * 3600, bayatSn: 7 * 24 * 3600, dogrula: diziMi });
    return { ...r, notu: bayatNotu(r, "metro") };
  } catch (e) {
    const sebep = e instanceof KaynakHatasi ? e.sebep : (e as Error).message;
    return {
      veri: METRO_TARIFE_YEDEK,
      bayat: true,
      yasSn: 0,
      notu: `\n⚠️ ${KAYNAKLAR.metro} şu an yanıt vermiyor (${sebep}); sunucuya gömülü ${RAYLI_TARIHI} tarihli tarife kullanıldı.`,
    };
  }
}

export const tramvaySeferleri = (apiHatId: number) =>
  getir<SiklikSatiri[]>({ kaynak: "tramvay", url: `${IZMIR_API}/tramvay/seferler/${apiHatId}`, tazeSn: 6 * 3600, bayatSn: 7 * 24 * 3600, dogrula: diziMi });

export const izbanSeferleri = (a: number, b: number) =>
  getir<IzbanSefer[]>({ kaynak: "izban", url: `${IZMIR_API}/izban/sefersaatleri/${a}/${b}`, tazeSn: 6 * 3600, bayatSn: 7 * 24 * 3600, dogrula: diziMi });

/** İZDENİZ gün kodu: Pazartesi=1 … Pazar=7 */
export function izdenizGunu(): number {
  return { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 }[izmirSaati().gun] ?? 1;
}

export const vapurSeferleri = (a: number, b: number) =>
  getir<VapurHat[]>({
    kaynak: "vapur",
    url: `${IZMIR_API}/izdeniz/vapursaatleri/${a}/${b}/${izdenizGunu()}/0`,
    tazeSn: 1800, // iptaller gün içinde değişebilir
    bayatSn: 24 * 3600,
    dogrula: diziMi,
  });

// ---------- Hesaplar ----------

const TARIFE_ADI = { 1: "hafta içi", 2: "cumartesi", 3: "pazar" } as Record<number, string>;

/** Şu anki sefer aralığı (dk); hat kapalıysa null ve ilk sefer saati. */
export function anlikAralik(seferler: SiklikSatiri[], dakika = izmirSaati().dakika): { aralik: number | null; tarife: string; ilkSefer?: string } {
  const g = izmirSaati().gun;
  const tarifeId = g === "Sat" ? 2 : g === "Sun" ? 3 : 1;
  const satirlar = seferler.filter((x) => x.TarifeId === tarifeId);
  for (const x of satirlar) {
    const bas = saatToDakika(x.BaslangicSaati);
    let bit = saatToDakika(x.BitisSaati);
    if (bit <= bas) bit += 1440; // gece yarısını geçen dilim (ör. 20:00-00:20)
    const simdi = dakika < bas && dakika + 1440 < bit ? dakika + 1440 : dakika;
    if (simdi >= bas && simdi < bit) return { aralik: x.Aralik, tarife: TARIFE_ADI[tarifeId] };
  }
  const ilk = satirlar.map((x) => x.BaslangicSaati).sort()[0];
  return { aralik: null, tarife: TARIFE_ADI[tarifeId], ilkSefer: ilk?.slice(0, 5) };
}

export function sonrakiIzbanlar(seferler: IzbanSefer[], sonraDk = izmirSaati().dakika, adet = 4) {
  return seferler
    .filter((x) => saatToDakika(x.HareketSaati) >= sonraDk)
    .sort((x, y) => saatToDakika(x.HareketSaati) - saatToDakika(y.HareketSaati))
    .slice(0, adet)
    .map((x) => ({
      kalkis: x.HareketSaati.slice(0, 5),
      varis: x.VarisSaati.slice(0, 5),
      kalkisDk: saatToDakika(x.HareketSaati),
      sureDk: (saatToDakika(x.VarisSaati) - saatToDakika(x.HareketSaati) + 1440) % 1440,
    }));
}

export function sonrakiVapurlar(hatlar: VapurHat[], sonraDk = izmirSaati().dakika, adet = 4) {
  const seferler: { kalkis: string; varis: string; kalkisDk: number; sureDk: number; iptal: boolean; not: string }[] = [];
  for (const h of hatlar) {
    for (const s of h.seferSatirlari ?? []) {
      const k = s.seferSaatleri?.find((x) => x.KalkisSaati)?.KalkisSaati;
      const v = [...(s.seferSaatleri ?? [])].reverse().find((x) => x.VarisSaati)?.VarisSaati;
      if (!k || !v) continue;
      const kd = saatToDakika(k);
      if (kd < sonraDk) continue;
      seferler.push({
        kalkis: k.slice(0, 5),
        varis: v.slice(0, 5),
        kalkisDk: kd,
        sureDk: (saatToDakika(v) - kd + 1440) % 1440,
        iptal: !!s.IptalMi,
        not: [s.IptalAciklama, s.Aciklama].map((x) => (x ?? "").trim()).filter(Boolean).join(" "),
      });
    }
  }
  return seferler.sort((a, b) => a.kalkisDk - b.kalkisDk).slice(0, adet);
}

export function hataCevabi(e: unknown) {
  if (e instanceof KaynakHatasi) {
    return hataMetni(
      `${e.message} Önbellekte de kullanılabilir veri yok. ` +
        `Bu, sunucunun değil İzmir BB veri servisinin geçici bir sorunu; birkaç dakika sonra tekrar denenebilir. ` +
        `Kullanıcıya bu kaynağın şu an çalışmadığını açıkça söyle ve tahmini veri uydurma.`,
    );
  }
  return hataMetni(`Beklenmeyen hata: ${(e as Error).message}`);
}

export const dkSaat = (dk: number) => {
  const m = ((Math.round(dk) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
};
