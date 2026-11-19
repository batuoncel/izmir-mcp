// Önbellek: REDIS_URL varsa Redis, yoksa süreç içi hafıza.
// Her kayıt alındığı zamanla saklanır; böylece kaynak çökünce "bayat ama işe yarar" veri dönebiliriz.

import { createClient } from "redis";

export interface Kayit<T> {
  veri: T;
  zaman: number; // ms (Date.now)
}

export interface Onbellek {
  tur: "redis" | "hafiza";
  al<T>(anahtar: string): Promise<Kayit<T> | null>;
  koy<T>(anahtar: string, kayit: Kayit<T>, omurSn: number): Promise<void>;
}

class HafizaOnbellek implements Onbellek {
  tur = "hafiza" as const;
  private m = new Map<string, { kayit: Kayit<unknown>; bitis: number }>();

  async al<T>(anahtar: string) {
    const e = this.m.get(anahtar);
    if (!e) return null;
    if (e.bitis < Date.now()) {
      this.m.delete(anahtar);
      return null;
    }
    return e.kayit as Kayit<T>;
  }

  async koy<T>(anahtar: string, kayit: Kayit<T>, omurSn: number) {
    if (this.m.size > 2000) this.m.delete(this.m.keys().next().value!);
    this.m.set(anahtar, { kayit, bitis: Date.now() + omurSn * 1000 });
  }
}

class RedisOnbellek implements Onbellek {
  tur = "redis" as const;
  // Redis istemci tipi sürümler arası çok değişkendir; sadece get/set kullandığımız için dar bir tip yeterli.
  constructor(private c: { get(k: string): Promise<string | null>; set(k: string, v: string, o: { EX: number }): Promise<unknown> }) {}

  async al<T>(anahtar: string) {
    const s = await this.c.get(`izmir:${anahtar}`);
    return s ? (JSON.parse(s) as Kayit<T>) : null;
  }

  async koy<T>(anahtar: string, kayit: Kayit<T>, omurSn: number) {
    await this.c.set(`izmir:${anahtar}`, JSON.stringify(kayit), { EX: omurSn });
  }
}

let ornek: Onbellek | null = null;

export async function onbellek(): Promise<Onbellek> {
  if (ornek) return ornek;
  const url = process.env.REDIS_URL;
  if (url) {
    try {
      const c = createClient({ url, socket: { connectTimeout: 3000, reconnectStrategy: (n) => Math.min(n * 500, 5000) } });
      c.on("error", (e) => console.error("Redis hatası:", e.message));
      await c.connect();
      ornek = new RedisOnbellek(c);
      console.error("Önbellek: Redis");
      return ornek;
    } catch (e) {
      console.error(`Redis'e bağlanılamadı (${(e as Error).message}), hafıza önbelleği kullanılıyor`);
    }
  }
  ornek = new HafizaOnbellek();
  return ornek;
}
