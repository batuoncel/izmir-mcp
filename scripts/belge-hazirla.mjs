// RAG için ulaşım bilgi belgelerini indirir, temizler ve parçalara böler: data/belgeler.json
//
// Kullanım: node scripts/belge-hazirla.mjs
//
// Kaynaklar açık veri kataloğunda listelenen sayfalar (ulasim-ucret-tarifeleri, izmir-ulasim-rehberi) ve
// bu sayfaların bağlantı verdiği İzmirim Kart bilgi sayfalarıdır. Fiyatlar değişince script yeniden çalıştırılmalı.

import { writeFileSync } from "node:fs";

const KAYNAKLAR = [
  { ad: "İzmirim Kart – Tarife ve Ücretlendirme", url: "https://www.izmirimkart.com.tr/tarife-ve-ucretlendirme" },
  { ad: "İzmirim Kart – Sıkça Sorulan Sorular", url: "https://www.izmirimkart.com.tr/sikca-sorulan-sorular" },
  { ad: "İzmir BB – Ulaşım Rehberi", url: "https://www.izmir.bel.tr/tr/UlasimHizmetleri/18/81" },
];

const VARLIK = { nbsp: " ", amp: "&", quot: '"', lt: "<", gt: ">", rsquo: "'", lsquo: "'", ldquo: '"', rdquo: '"', ndash: "–", mdash: "—", hellip: "…" };

function temizle(html) {
  let t = html
    .replace(/<(script|style|noscript|svg|nav|header|footer|form|select|button)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    // Tablo satırı tek satır olsun: hücre içindeki <br> ve satır sonları sütun başlıklarını bölmesin
    .replace(/<tr[\s\S]*?<\/tr>/gi, (m) => m.replace(/<br\s*\/?>/gi, " ").replace(/\s+/g, " ") + "\n")
    .replace(/<\/(td|th)>/gi, " | ")
    .replace(/<(br|\/p|\/div|\/li|\/tr|\/h[1-6]|\/table|\/ul|\/ol|\/section|\/article)[^>]*>/gi, "\n")
    .replace(/<h([1-6])[^>]*>/gi, "\n## ")
    .replace(/<li[^>]*>/gi, "\n- ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, n) => VARLIK[n.toLowerCase()] ?? m);
  const satirlar = t
    .split("\n")
    .map((s) => s.replace(/[ \t]+/g, " ").replace(/(\s*\|\s*)+$/, "").trim())
    .filter((s) => s.length > 2);
  // Menü kalıntısı: çok kısa, rakamsız, art arda tekrar eden satırları at
  const gorulen = new Set();
  return satirlar.filter((s) => {
    if (gorulen.has(s)) return false;
    gorulen.add(s);
    return s.length >= 25 || /\d/.test(s) || s.startsWith("## ") || s.startsWith("- ");
  });
}

/** Satırları ~700 karakterlik parçalara toplar; başlıklarda yeni parça başlatır. */
function parcala(satirlar, kaynak) {
  const parcalar = [];
  let baslik = kaynak.ad;
  let buf = [];
  const bitir = () => {
    const metin = buf.join("\n").trim();
    if (metin.length > 80) parcalar.push({ kaynak: kaynak.ad, url: kaynak.url, baslik, metin });
    buf = [];
  };
  for (const s of satirlar) {
    if (s.startsWith("## ")) {
      bitir();
      baslik = s.slice(3).trim() || baslik;
      continue;
    }
    if (buf.join("\n").length + s.length > 700) bitir();
    buf.push(s);
  }
  bitir();
  return parcalar;
}

/** Next.js sitelerinde içerik HTML'de değil, self.__next_f.push(...) içindeki veri yükünde durur. */
function nextYuku(html) {
  let yuk = "";
  for (const m of html.matchAll(/self\.__next_f\.push\(\[1,"((?:[^"\\]|\\.)*)"\]\)/g)) {
    try {
      yuk += JSON.parse(`"${m[1]}"`);
    } catch {
      /* bozuk parça */
    }
  }
  return yuk;
}

/** Yükteki schema.org FAQPage kaydını soru-cevap parçalarına çevirir. */
function sssParcalari(yuk, kaynak) {
  const i = yuk.indexOf('{"@context":"https://schema.org","@type":"FAQPage"');
  if (i < 0) return [];
  let derinlik = 0;
  let j = i;
  for (; j < yuk.length; j++) {
    if (yuk[j] === "{") derinlik++;
    else if (yuk[j] === "}" && --derinlik === 0) break;
  }
  try {
    const faq = JSON.parse(yuk.slice(i, j + 1));
    return faq.mainEntity.map((q) => ({
      kaynak: kaynak.ad,
      url: kaynak.url,
      baslik: q.name.trim(),
      metin: `Soru: ${q.name.trim()}\nCevap: ${temizle(q.acceptedAnswer?.text ?? "").join(" ")}`,
    }));
  } catch {
    return [];
  }
}

/** Yükteki görünen metinler ("children":"...") – içerik HTML'de olmayan sayfalar için. */
function yukMetinleri(yuk) {
  const metinler = [];
  for (const m of yuk.matchAll(/"children":"((?:[^"\\]|\\.){30,})"/g)) {
    try {
      metinler.push(...temizle(JSON.parse(`"${m[1]}"`)));
    } catch {}
  }
  return [...new Set(metinler)];
}

async function getir(url) {
  for (let i = 0; i < 4; i++) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(40000), headers: { "user-agent": "Mozilla/5.0 izmir-acik-veri-mcp" } });
      if (r.ok) return r.text();
      console.error(`  HTTP ${r.status}`);
    } catch (e) {
      console.error(`  deneme ${i + 1}: ${e.message}`);
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  return null;
}

const parcalar = [];
for (const k of KAYNAKLAR) {
  const html = await getir(k.url);
  if (!html) {
    console.error(`ATLANDI: ${k.url}`);
    continue;
  }
  const yuk = nextYuku(html);
  let p = sssParcalari(yuk, k);
  if (!p.length) p = parcala(temizle(html), k);
  if (!p.length && yuk) p = parcala(yukMetinleri(yuk), k);
  // Next.js "sayfa bulunamadı" şablonu her sayfanın yükünde durur; sadece içerik yoksa 404 say
  if (p.length <= 1 && p.some((x) => x.metin.includes("could not be found"))) {
    console.error(`ATLANDI (404 sayfası): ${k.url}`);
    continue;
  }
  console.log(`${k.ad}: ${p.length} parça`);
  parcalar.push(...p);
}
if (!parcalar.length) {
  console.error("Hiç belge alınamadı; data/belgeler.json değiştirilmedi.");
  process.exit(1);
}
writeFileSync("data/belgeler.json", JSON.stringify({ uretildi: new Date().toISOString().slice(0, 10), parcalar }, null, 1));
console.log(`${parcalar.length} parça -> data/belgeler.json`);
