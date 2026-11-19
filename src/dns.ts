// DNS önbelleği.
//
// Neden: Bazı ağlarda DNS sunucusu çok yavaş (testte 3-33 sn). İşletim sisteminin DNS önbelleği dolunca sorun görünmez,
// süresi bitince tüm istekler aynı anda askıda kalır ve alakasız kaynaklar (İzmir API + Open-Meteo) birlikte "çöker".
// Çözüm: çözülen adresleri süreç içinde tutar; süresi dolunca eski adresi hemen verip arka planda yeniler.

// Son çözülen adresler diske de yazılır; böylece yeni açılan süreç (ör. Claude Desktop yeniden başlayınca)
// DNS'i beklemeden son bilinen adresle bağlanır, arka planda yeniler.

import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import { readFileSync, writeFile } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Agent } from "undici";

const TAZE_MS = 5 * 60_000;
const DOSYA = process.env.DNS_ONBELLEK_DOSYASI ?? join(tmpdir(), "izmir-mcp-dns.json");
const kayitlar = new Map<string, { adresler: LookupAddress[]; zaman: number; yenileniyor?: Promise<LookupAddress[]> }>();

try {
  const disk = JSON.parse(readFileSync(DOSYA, "utf8")) as Record<string, LookupAddress[]>;
  for (const [host, adresler] of Object.entries(disk)) {
    if (Array.isArray(adresler) && adresler.length) kayitlar.set(host, { adresler, zaman: 0 }); // zaman 0: ilk kullanımda yenilenir
  }
} catch {
  /* dosya yoksa sorun değil */
}

function diskeYaz() {
  const veri = Object.fromEntries([...kayitlar].filter(([, k]) => k.adresler.length).map(([h, k]) => [h, k.adresler]));
  writeFile(DOSYA, JSON.stringify(veri), () => {});
}

function coz(host: string): Promise<LookupAddress[]> {
  const k = kayitlar.get(host);
  if (k?.yenileniyor) return k.yenileniyor;
  const p = new Promise<LookupAddress[]>((resolve, reject) =>
    dnsLookup(host, { all: true }, (err, adresler) => (err ? reject(err) : resolve(adresler))),
  )
    .then((adresler) => {
      kayitlar.set(host, { adresler, zaman: Date.now() });
      diskeYaz();
      return adresler;
    })
    .catch((e) => {
      const eski = kayitlar.get(host);
      if (eski) delete eski.yenileniyor;
      if (eski?.adresler.length) return eski.adresler; // yenileme başarısızsa eski adresle devam
      throw e;
    });
  kayitlar.set(host, { adresler: k?.adresler ?? [], zaman: k?.zaman ?? 0, yenileniyor: p });
  return p;
}

type Cb = (err: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void;

/** dns.lookup ile aynı imza; undici'nin connect.lookup seçeneğine verilir. */
export function onbellekliLookup(host: string, opts: { all?: boolean } | number | undefined, cb: Cb) {
  const all = typeof opts === "object" && opts?.all;
  const ver = (adresler: LookupAddress[]) => {
    if (!adresler.length) {
      const e: NodeJS.ErrnoException = new Error(`DNS: ${host} çözülemedi`);
      e.code = "ENOTFOUND";
      return cb(e, all ? [] : "");
    }
    const v4 = adresler.filter((a) => a.family === 4);
    const liste = v4.length ? v4 : adresler; // IPv6 sorunlu ağlarda önce IPv4
    if (all) cb(null, liste);
    else cb(null, liste[0].address, liste[0].family);
  };
  const k = kayitlar.get(host);
  if (k && k.adresler.length) {
    if (Date.now() - k.zaman > TAZE_MS && !k.yenileniyor) coz(host).catch(() => {});
    return ver(k.adresler);
  }
  coz(host).then(ver, (e) => cb(e, all ? [] : ""));
}

/** Sunucu açılırken kullanılacak alan adlarını önceden çözer; ilk araç çağrısı DNS beklemez. */
export function dnsIsit(hostlar: string[]) {
  for (const h of hostlar) coz(h).catch(() => {});
}

export const dispatcher = new Agent({
  connect: { lookup: onbellekliLookup as never },
  keepAliveTimeout: 30_000,
});
