// RAG: ulaşım bilgi belgelerinde (ücret tarifesi, İzmirim Kart SSS, ulaşım rehberi) arama.
//
// Belgeler scripts/belge-hazirla.mjs ile indirilip parçalara bölünür (data/belgeler.json).
// Arama BM25 ile yapılır: dış servis ya da API anahtarı gerektirmez. Türkçe ekler için kelimelerin
// ilk 5 harfi kullanılır ("öğrenciler", "öğrenciye" -> "ogren"). Bulunan parçalar kaynak bağlantısıyla döner;
// Claude cevabı bu parçalara dayandırır.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { hataMetni, metin, sadelestir } from "../ortak.js";

interface Parca {
  kaynak: string;
  url: string;
  baslik: string;
  metin: string;
}

const BELGE = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "..", "data", "belgeler.json"), "utf8")) as {
  uretildi: string;
  parcalar: Parca[];
};

const DURAK_KELIMELER = new Set(
  "ve ile bir bu su o da de mi mu mı mü ne nasil icin gibi kac kadar var yok olan olarak daha en cok her ya veya ama ancak hangi nedir neden niye ben benim biz bize siz sizin ise ki dir dur tir tur nin nun in un den dan ten tan".split(
    " ",
  ),
);

export function kelimeler(s: string): string[] {
  return sadelestir(s)
    .split(" ")
    .filter((k) => k.length > 1 && !DURAK_KELIMELER.has(k))
    .map((k) => (/^\d/.test(k) ? k : k.slice(0, 5)));
}

// BM25 dizini
const K1 = 1.2;
const B = 0.75;
const belgeler = BELGE.parcalar.map((p) => {
  const t = kelimeler(`${p.baslik} ${p.baslik} ${p.metin}`); // başlık iki kez: başlık eşleşmesi daha değerli
  const tf = new Map<string, number>();
  for (const k of t) tf.set(k, (tf.get(k) ?? 0) + 1);
  return { p, tf, uzunluk: t.length };
});
const ortUzunluk = belgeler.reduce((a, b) => a + b.uzunluk, 0) / Math.max(1, belgeler.length);
const df = new Map<string, number>();
for (const b of belgeler) for (const k of b.tf.keys()) df.set(k, (df.get(k) ?? 0) + 1);
const idf = (k: string) => Math.log(1 + (belgeler.length - (df.get(k) ?? 0) + 0.5) / ((df.get(k) ?? 0) + 0.5));

/** puan: BM25; kapsam: sorudaki kelimelerin parçada geçen oranı (alakasız tek kelime eşleşmesini elemek için). */
export function belgeAra(soru: string, adet = 4): { p: Parca; puan: number; kapsam: number }[] {
  const q = [...new Set(kelimeler(soru))];
  return belgeler
    .map((b) => {
      let puan = 0;
      let bulunan = 0;
      for (const k of q) {
        const f = b.tf.get(k);
        if (!f) continue;
        bulunan++;
        puan += idf(k) * ((f * (K1 + 1)) / (f + K1 * (1 - B + (B * b.uzunluk) / ortUzunluk)));
      }
      return { p: b.p, puan, kapsam: q.length ? bulunan / q.length : 0 };
    })
    .filter((x) => x.puan > 0)
    .sort((a, b) => b.puan - a.puan)
    .slice(0, adet);
}

export function bilgiAraclari(server: McpServer) {
  server.registerTool(
    "ulasim_bilgisi_ara",
    {
      title: "Ulaşım ücretleri ve kart bilgisi (belge arama)",
      description:
        "İzmir toplu ulaşım belgelerinde arama yapar: güncel ücret tarifesi (tam, öğrenci/genç, öğretmen, 60 yaş, kredi kartı, Bilet 35), " +
        "90 dakika aktarma kuralı, halk taşıt saatleri, İzmirim Kart sıkça sorulan soruları (kayıp kart, başvuru, dolum) ve havalimanı/otogar ulaşım rehberi. " +
        "Ücret, kart veya kural sorularında kullan; cevabı dönen parçalara dayandır ve kaynağı belirt. Belgede yoksa uydurma.",
      inputSchema: {
        soru: z.string().min(3).describe("Aranacak soru, ör. 'öğrenci kartıyla tek biniş kaç TL', 'kartımı kaybettim', 'havalimanına nasıl giderim'"),
        adet: z.number().int().min(1).max(8).default(4).describe("Kaç parça dönsün"),
      },
    },
    async ({ soru, adet }) => {
      const sonuc = belgeAra(soru, adet);
      if (!sonuc.length || sonuc[0].puan < 1 || Math.max(...sonuc.map((s) => s.kapsam)) < 0.5) {
        return hataMetni(`"${soru}" ile ilgili bir şey ulaşım belgelerinde bulunamadı. Kullanıcıya bu bilginin elimizdeki belgelerde olmadığını söyle; tahmin yürütme.`);
      }
      return metin(
        `Ulaşım belgelerinde "${soru}" için en ilgili ${sonuc.length} parça (belgeler ${BELGE.uretildi} tarihinde alındı):\n\n` +
          sonuc.map((s, i) => `[${i + 1}] ${s.p.kaynak} › ${s.p.baslik}\nKaynak: ${s.p.url}\n${s.p.metin}`).join("\n\n---\n\n") +
          `\n\nNot: Tablolarda sütunlar " | " ile ayrılmıştır; ilk satır sütun başlıklarıdır. Fiyatlar değişmiş olabilir, kesin bilgi için kaynağa yönlendir.`,
      );
    },
  );
}
