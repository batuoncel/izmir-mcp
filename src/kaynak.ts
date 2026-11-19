// Dış veri kaynaklarına erişim: zaman aşımı + yeniden deneme + önbellek + bayat veri yedeği.
//
// Akış:
//   1) Önbellekte taze kayıt varsa onu dön (API'ye hiç gitme).
//   2) Yoksa API'yi dene (her deneme ZAMAN_ASIMI_MS, toplam DENEME_SAYISI kez).
//   3) API çökmüşse ve önbellekte bayat (ama BAYAT_SN'den genç) kayıt varsa onu "bayat" işaretiyle dön.
//   4) Hiçbiri yoksa KaynakHatasi fırlat; araç bunu kullanıcıya anlaşılır bir mesaja çevirir.

import { fetch } from "undici";
import { dispatcher, dnsIsit } from "./dns.js";
import { onbellek } from "./onbellek.js";

export const IZMIR_API = process.env.IZMIR_API_URL ?? "https://openapi.izmir.bel.tr/api";
export const ETKINLIK_API = process.env.ETKINLIK_API_URL ?? "https://acikveriwapi.izmir.bel.tr/KulturSanat/EtkinlikleriGetir";
dnsIsit([new URL(IZMIR_API).hostname, new URL(ETKINLIK_API).hostname, "air-quality-api.open-meteo.com", "api.open-meteo.com"]);
// İzmir API'si ara ara bağlantıyı ~10 sn askıda bırakıyor; kısa zaman aşımı + birkaç deneme, tek uzun beklemeden iyi sonuç veriyor.
const ZAMAN_ASIMI_MS = Number(process.env.ZAMAN_ASIMI_MS ?? 6_000);
const DENEME_SAYISI = Number(process.env.DENEME_SAYISI ?? 3);
/** Devre kesici: bir kaynak tüm denemelerde çöktüyse bu süre boyunca tekrar beklemeden hemen hata dön. */
const DEVRE_ACIK_MS = Number(process.env.DEVRE_ACIK_MS ?? 30_000);
const sonCokus = new Map<string, number>();

/** Demo için: SIMULE_KAPALI=eczane,hava gibi verilen kaynaklar çökmüş gibi davranır. */
const SIMULE_KAPALI = new Set(
  (process.env.SIMULE_KAPALI ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
);

/** Kullanıcıya gösterilecek kaynak adları. */
export const KAYNAKLAR = {
  otobus: "ESHOT canlı otobüs servisi",
  metro: "İzmir Metro sefer servisi",
  izban: "İZBAN sefer servisi",
  eczane: "Nöbetçi eczane servisi (İzmir BB)",
  hava: "İzmir BB hava kalitesi ölçümleri",
  havaCanli: "Open-Meteo hava kalitesi modeli",
  etkinlik: "İzmir BB kültür sanat etkinlikleri servisi",
  tramvay: "İzmir tramvay sefer servisi",
  vapur: "İZDENİZ vapur sefer servisi",
  havaDurumu: "Open-Meteo hava durumu servisi",
} as const;
export type KaynakAdi = keyof typeof KAYNAKLAR;

export class KaynakHatasi extends Error {
  constructor(
    public kaynak: KaynakAdi,
    public sebep: string,
  ) {
    super(`${KAYNAKLAR[kaynak]} şu an yanıt vermiyor (${sebep}).`);
  }
}

export interface Sonuc<T> {
  veri: T;
  /** API'ye ulaşılamadı, önbellekteki eski veri dönüyor. */
  bayat: boolean;
  /** Verinin kaç saniye önce alındığı. */
  yasSn: number;
}

interface Secenek {
  kaynak: KaynakAdi;
  url: string;
  /** Bu süre boyunca önbellekteki veri taze sayılır. */
  tazeSn: number;
  /** API çökünce bu yaşa kadar eski veri yedek olarak kullanılabilir. */
  bayatSn?: number;
  /** Cevap 200 olsa bile içerik hatalıysa hata mesajı döndürür. */
  dogrula?: (veri: unknown) => string | null;
}

const bekle = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function cek(url: string, kaynak: KaynakAdi, dogrula?: Secenek["dogrula"]): Promise<unknown> {
  if (SIMULE_KAPALI.has(kaynak)) throw new Error("simülasyon: kaynak kapalı");
  let sonHata: Error = new Error("bilinmeyen hata");
  for (let i = 0; i < DENEME_SAYISI; i++) {
    try {
      const res = await fetch(url, {
        signal: AbortSignal.timeout(ZAMAN_ASIMI_MS),
        dispatcher,
        headers: { accept: "application/json", "user-agent": "izmir-acik-veri-mcp" },
        redirect: "manual", // API hata durumunda error.izmir.bel.tr'ye yönlendiriyor
      });
      if (res.status !== 200) throw new Error(`HTTP ${res.status}`);
      const veri = await res.json();
      const hata = dogrula?.(veri);
      if (hata) throw new Error(hata);
      return veri;
    } catch (e) {
      const err = e as Error & { cause?: { code?: string } };
      sonHata =
        err.name === "TimeoutError"
          ? new Error(`${ZAMAN_ASIMI_MS / 1000} sn içinde cevap gelmedi`)
          : err.cause?.code
            ? new Error(`bağlantı hatası: ${err.cause.code}`)
            : err;
      if (i < DENEME_SAYISI - 1) await bekle(500 * (i + 1));
    }
  }
  throw sonHata;
}

export async function getir<T>(s: Secenek): Promise<Sonuc<T>> {
  const ob = await onbellek();
  const anahtar = `${s.kaynak}:${s.url}`;
  const bayatSn = s.bayatSn ?? 24 * 3600;

  let kayit = null;
  try {
    kayit = await ob.al<T>(anahtar);
  } catch {
    /* önbellek hatası API'yi engellemesin */
  }
  if (kayit && Date.now() - kayit.zaman < s.tazeSn * 1000 && !SIMULE_KAPALI.has(s.kaynak)) {
    return { veri: kayit.veri, bayat: false, yasSn: Math.round((Date.now() - kayit.zaman) / 1000) };
  }

  try {
    const cokus = sonCokus.get(s.kaynak);
    if (cokus && Date.now() - cokus < DEVRE_ACIK_MS) {
      throw new Error(`${Math.round((Date.now() - cokus) / 1000)} sn önce de yanıt vermedi`);
    }
    const veri = (await cek(s.url, s.kaynak, s.dogrula)) as T;
    sonCokus.delete(s.kaynak);
    await ob.koy(anahtar, { veri, zaman: Date.now() }, bayatSn).catch(() => {});
    return { veri, bayat: false, yasSn: 0 };
  } catch (e) {
    if (!sonCokus.has(s.kaynak) || Date.now() - sonCokus.get(s.kaynak)! >= DEVRE_ACIK_MS) sonCokus.set(s.kaynak, Date.now());
    if (kayit && !SIMULE_KAPALI.has(s.kaynak)) {
      return { veri: kayit.veri, bayat: true, yasSn: Math.round((Date.now() - kayit.zaman) / 1000) };
    }
    throw new KaynakHatasi(s.kaynak, (e as Error).message);
  }
}

/** Bayat veri kullanıldıysa cevaba eklenecek uyarı satırı. */
export function bayatNotu(s: Sonuc<unknown>, kaynak: KaynakAdi): string {
  if (!s.bayat) return "";
  const dk = Math.round(s.yasSn / 60);
  return `\n⚠️ ${KAYNAKLAR[kaynak]} şu an yanıt vermiyor; ${dk} dakika önce alınmış önbellek verisi gösteriliyor.`;
}

/** Sağlık kontrolü: önbelleği atlayıp kaynağa tek, kısa bir istek atar. */
export async function yokla(kaynak: KaynakAdi, url: string): Promise<{ kaynak: string; durum: "çalışıyor" | "çöktü"; sureMs: number; not?: string }> {
  const t = Date.now();
  try {
    if (SIMULE_KAPALI.has(kaynak)) throw new Error("simülasyon: kaynak kapalı");
    const res = await fetch(url, { signal: AbortSignal.timeout(6000), redirect: "manual", dispatcher });
    if (res.status !== 200) throw new Error(`HTTP ${res.status}`);
    await res.arrayBuffer();
    return { kaynak: KAYNAKLAR[kaynak], durum: "çalışıyor", sureMs: Date.now() - t };
  } catch (e) {
    const err = e as Error;
    return {
      kaynak: KAYNAKLAR[kaynak],
      durum: "çöktü",
      sureMs: Date.now() - t,
      not: err.name === "TimeoutError" ? "6 sn içinde cevap yok" : err.message,
    };
  }
}
