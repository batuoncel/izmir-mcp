// Küçük yardımcılar: Türkçe metin karşılaştırma, mesafe, İstanbul saati.

const TR_HARF: Record<string, string> = { ı: "i", İ: "i", ş: "s", ğ: "g", ü: "u", ö: "o", ç: "c", â: "a", î: "i", û: "u" };

/** "Bornova Metro", "BORNOVA METRO" ve "bornova metro" aynı sonucu versin diye sadeleştirir. */
export function sadelestir(s: string): string {
  return s
    .toLocaleLowerCase("tr")
    .replace(/[ışğüöçâîûİ]/g, (h) => TR_HARF[h] ?? h)
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** İki nokta arası kuş uçuşu mesafe (metre). */
export function mesafeM(enlem1: number, boylam1: number, enlem2: number, boylam2: number): number {
  const R = 6_371_000;
  const r = Math.PI / 180;
  const a =
    Math.sin(((enlem2 - enlem1) * r) / 2) ** 2 +
    Math.cos(enlem1 * r) * Math.cos(enlem2 * r) * Math.sin(((boylam2 - boylam1) * r) / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(a)));
}

/** Sunucu nerede çalışırsa çalışsın İzmir saatini verir. */
export function izmirSaati(tarih = new Date()) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/Istanbul",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      weekday: "short",
      hourCycle: "h23",
    })
      .formatToParts(tarih)
      .map((x) => [x.type, x.value]),
  );
  const dakika = Number(p.hour) * 60 + Number(p.minute);
  return {
    tarih: `${p.year}-${p.month}-${p.day}`,
    saat: `${p.hour}:${p.minute}`,
    dakika, // gece yarısından beri geçen dakika
    gun: p.weekday as string, // Mon, Tue, ... Sat, Sun
  };
}

/** "06:30:00" -> 390 */
export function saatToDakika(s: string): number {
  const [h, m] = s.split(":").map(Number);
  return h * 60 + m;
}

/** API'deki "38,42" gibi virgüllü sayıları çevirir. */
export function sayi(s: string | number | null | undefined): number {
  return typeof s === "number" ? s : Number(String(s ?? "").replace(",", "."));
}

export function metin(text: string) {
  return { content: [{ type: "text" as const, text }] };
}

export function hataMetni(text: string) {
  return { isError: true, content: [{ type: "text" as const, text }] };
}
