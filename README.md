# İzmir Açık Veri MCP

İzmir'in açık verisini MCP üzerinden Claude'a bağlayan sunucu. Claude; otobüs, metro, İZBAN, tramvay ve vapuru birlikte değerlendirip
"Bornova'dan Konak'a şu an nasıl giderim?" sorusunu canlı veriyle cevaplar; nöbetçi eczane, hava durumu, hava kalitesi, belediye etkinlikleri
ve ulaşım ücretleri hakkındaki soruları da yanıtlar.

Yaşar Üniversitesi Gen-AI / Mekatronik Lab, Proje 09.

## Araçlar (11)

| Araç | Ne yapar | Kaynak |
|---|---|---|
| `ulasim_rota` | İki yer arası **aktarmalı** rota: otobüs + metro + İZBAN + tramvay + vapur. Her bacakta canlı bilgi (yaklaşan otobüs, sıradaki vapur/İZBAN, iptaller, sefer sıklığı), varış saati | Gömülü ağ + canlı API'ler |
| `toplu_tasima_seferleri` | Metro ve tramvay sefer sıklığı, İZBAN ve vapur kalkış saatleri, iptal edilen vapur seferleri | `metro/`, `tramvay/`, `izban/`, `izdeniz/` |
| `durak_ara` | Ada göre durak arar; durak no, konum, geçen hatlar | ESHOT GTFS (gömülü) |
| `duraga_yaklasan_otobusler` | Bir durağa şu an yaklaşan otobüsler | `iztek/duragayaklasanotobusler/{durak}` |
| `otobus_konumlari` | Bir hattaki bütün otobüslerin konumu + en yakın durak | `iztek/hatotobuskonumlari/{hat}` |
| `nobetci_eczaneler` | Bir yere en yakın nöbetçi eczaneler (adres, telefon, mesafe) | `ibb/nobetcieczaneler` |
| `hava_durumu` | Şu anki hava, 12 saatlik yağış olasılığı, 7 güne kadar tahmin | Open-Meteo |
| `hava_kalitesi` | Resmi istasyon ölçümleri (PM10, SO2) + saatlik güncel EAQI/PM2.5/NO2/O3 | `ibb/cevre/havadegerleri` + Open-Meteo |
| `kultur_sanat_etkinlikleri` | Belediyenin konser, tiyatro, sergi, sinema, atölye ve festivalleri | `acikveriwapi…/KulturSanat/EtkinlikleriGetir` |
| `ulasim_bilgisi_ara` | **RAG:** ücret tarifesi, 90 dk aktarma kuralı, İzmirim Kart SSS ve ulaşım rehberinde arama; cevap kaynak bağlantısıyla | Gömülü belgeler |
| `kaynak_durumu` | Tüm kaynakların çalışıp çalışmadığı ve yanıt süreleri | hepsi |

## Prompt'lar (4)

Claude Desktop'ta mesaj kutusundaki **+** menüsünden seçilen hazır görevler:

| Prompt | Ne yapar |
|---|---|
| `su_an_nasil_giderim` | Canlı rota + yolculuk sırasında yağmur var mı + bilet ücreti |
| `semt_ozeti` | Bir semt için hava, hava kalitesi, nöbetçi eczane, yakın etkinlikler |
| `etkinlige_git` | Bu haftaki belediye etkinliklerinden birini seçip oraya nasıl gidileceği |
| `kaynak_kontrolu` | Kaynakları kontrol edip çalışmayanların etkisini anlatır |

## Demo Day senaryoları

| Senaryo | Claude'a sorulacak | Ne olur |
|---|---|---|
| a) Canlı rota | "Bornova'dan Konak'a şu an nasıl giderim?" | M1 metro (8 istasyon, şu anki sefer aralığı, varış saati) + aktarmalı otobüs seçenekleri ve otobüsün kaç durak uzakta olduğu |
| b) İki kaynak | "Karşıyaka'dan Konak'a gideceğim, yağmur var mı, vapur mu otobüs mü?" veya "Öğrenci kartıyla Narlıdere'den Bostanlı'ya kaça ve nasıl giderim?" | `ulasim_rota` + `hava_durumu` / `ulasim_rota` + `ulasim_bilgisi_ara` |
| c) Kaynak çöktü | Sunucuyu `SIMULE_KAPALI=vapur` ile başlatıp "Karşıyaka'dan Konak'a vapurla gidebilir miyim?" | Vapur bacağı "servis yanıt vermiyor, bekleme tahmini" uyarısıyla döner; Claude bunu söyler, diğer seçeneklerle devam eder |

Gerçek hayatta da sık oluyor: İzmir API'si ara ara 10-20 sn yanıt vermiyor.

## Rota nasıl bulunuyor?

```
yer adı ──▶ koordinat (istasyon / iskele / durak adı)
                 │
                 ▼
  700 m içindeki tüm duraklar, istasyonlar, iskeleler (yürüme süresiyle)
                 │
                 ▼
  ağda arama: aktarmasız + tek aktarmalı (aktarma = 300 m'ye kadar yürüyüş)
  ┌───────────────────────────────────────────────────────────────┐
  │ 11.868 durak/istasyon/iskele · 888 hat-yön                    │
  │ ESHOT otobüs (GTFS) · M1 metro · İZBAN · 5 tramvay hattı      │
  │ İZDENİZ: 11 iskele, 36 bağlantı                               │
  └───────────────────────────────────────────────────────────────┘
                 │  en iyi 7 aday (bekleme varsayımlarıyla)
                 ▼
  canlı bekleme: yaklaşan otobüs · sıradaki vapur/İZBAN (iptaller) · metro/tramvay sıklığı
                 │
                 ▼
  gerçek varış saatine göre yeniden sırala, ilk 4'ü göster
```

Arama 1-10 ms sürer; süreyi canlı API çağrıları belirler (paralel yapılır, aynı istek tekrarlanmaz).

## RAG: ulaşım bilgi belgeleri

`ulasim_bilgisi_ara`, açık veri kataloğunda listelenen ulaşım sayfalarından derlenen 64 parçada arar:

- İzmirim Kart tarife ve ücretlendirme (tüm fiyat tarifeleri, 90 dk aktarma, halk taşıt, Baykuş gece seferleri)
- İzmirim Kart sıkça sorulan sorular (kayıp kart, başvuru, bakiye…)
- İzmir BB ulaşım rehberi (havalimanı, otogar…)

Arama **BM25** ile yapılır: embedding servisi ya da API anahtarı gerektirmez, internetsiz çalışır. Türkçe ekler için kelimelerin ilk 5 harfi
karşılaştırılır ("öğrenciler" ve "öğrenciye" → "ogren"). Sorunun kelimelerinin en az yarısı parçada yoksa araç "belgelerde yok" der; Claude uydurmaz.

Canlı veri için RAG kullanılmaz (sefer saatleri, eczaneler API'den gelir); RAG sadece durağan belgeler içindir.

## Hata yönetimi ve önbellek

```
istek ─▶ önbellekte taze kayıt var mı? ── evet ─▶ dön
              │ hayır
              ▼
        devre kesici açık mı? (kaynak son 30 sn'de çöktü mü) ── evet ─┐
              │ hayır                                                 │
              ▼                                                       ▼
        API'yi dene (6 sn zaman aşımı, 3 deneme) ── çöktü ─▶ önbellekte eski kayıt var mı?
              │ başarılı                                    evet: "⚠️ X dk önceki veri" notuyla dön
              ▼                                             hayır: anlaşılır hata (isError)
        önbelleğe yaz, dön
```

- **Önbellek süreleri:** canlı otobüs 30 sn, vapur seferleri 30 dk (iptaller), eczane 30 dk, hava 15-60 dk, etkinlikler 1 saat, metro/tramvay/İZBAN tarifesi 6 saat.
- **Bayat veri sınırı:** canlı otobüs konumu 10 dakikadan eskiyse kullanılmaz.
- **Gömülü veri:** ulaşım ağı (durak, hat, istasyon, iskele), metro tarifesi ve ulaşım belgeleri sunucuyla gelir. API tamamen çökse bile rota bulma ve ücret soruları çalışır.
- **Kısmi çöküş:** `ulasim_rota` ve `hava_kalitesi` birden fazla kaynak kullanır; biri çökerse diğerleriyle cevap verir ve hangisinin eksik olduğunu yazar.
- **Önbellek:** `REDIS_URL` verilirse Redis, yoksa sunucu hafızası.
- **DNS önbelleği:** Bazı ağlarda DNS sunucusu çok yavaş (testte 3-33 sn); işletim sisteminin önbelleği dolunca tüm istekler aynı anda askıda kalıyordu. Sunucu adresleri kendi tutar, açılışta önceden çözer, süresi dolunca eskisini verip arka planda yeniler. Son adresler geçici klasöre (`izmir-mcp-dns.json`) de yazılır.

## Kurulum (yerel)

Gereken: Node.js 20+

```bash
npm install
npm run build
npm test
```

`npm test` sunucuyu gerçek bir MCP istemcisiyle başlatır, 11 aracı ve 4 prompt'u dener, Demo Day senaryolarını çalıştırır. Çıktıların tamamını görmek için `npm test -- --ayrinti`. Claude olmadan elle denemek için:

```bash
npm run inspect
```

### Claude Desktop'a bağlama

Claude Desktop → **Ayarlar → Developer → Edit Config** ile ayar dosyasını açın ve yolu kendi klasörünüze göre değiştirin:

```json
{
  "mcpServers": {
    "izmir-acik-veri": {
      "command": "node",
      "args": ["C:\\yol\\izmir-mcp\\build\\index.js"]
    }
  }
}
```

macOS'ta yol şöyle olur: `"/Users/kullanici/izmir-mcp/build/index.js"`. Senaryo (c) için aynı bloğa `"env": { "SIMULE_KAPALI": "vapur" }` ekleyin.

Sonra Claude Desktop'ı tamamen kapatıp açın (Windows'ta sistem tepsisinden, macOS'ta Cmd+Q ile).

### Claude Code'a bağlama

```bash
claude mcp add izmir-acik-veri --scope user -- node "$(pwd)/build/index.js"
```

## Canlı yayına alma (uzak sürüm)

`build/http.js`, Streamable HTTP üzerinden çalışır ve API anahtarı ister.

| Uç nokta | Açıklama |
|---|---|
| `POST /mcp` | MCP. Başlık: `Authorization: Bearer <anahtar>` (veya `x-api-key: <anahtar>`) |
| `GET /saglik` | Sağlık kontrolü, anahtar gerekmez |

### Render ile (önerilen, ücretsiz plan)

Repodaki `render.yaml` sunucuyu ve Redis'i birlikte kurar, API anahtarını da kendisi üretir.

1. Repoyu GitHub'a gönderin.
2. https://render.com → hesap açın → **New → Blueprint** → repoyu seçin → **Apply**.
3. Kurulum bitince `izmir-acik-veri-mcp` servisine girin. **Environment** sekmesinden `MCP_API_KEY` değerini kopyalayın, servis adresini (`https://….onrender.com`) not edin.
4. Kontrol: tarayıcıda `https://….onrender.com/saglik` adresi `{"durum":"ok",…}` dönmeli.
5. Claude Desktop'ı bu adrese bağlayın (aşağıda).

Not: Ücretsiz planda servis bir süre kullanılmazsa uyku moduna geçer; ilk istek uyanma yüzünden yavaş olabilir. Demo öncesi `/saglik` adresini bir kez açmak yeterli.

### Docker ile (kendi sunucunuzda, Redis dahil)

```bash
cp .env.example .env
```

`.env` içindeki `MCP_API_KEY`'i doldurun (üretmek için: `node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"`), sonra:

```bash
docker compose up -d --build
```

Docker olmadan: `MCP_API_KEY=... npm run start:http`. Kimlik doğrulama testi: `npm run test:http`.

### Claude Desktop'ı uzak sunucuya bağlama

```json
{
  "mcpServers": {
    "izmir-acik-veri-uzak": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "https://SUNUCU-ADRESI/mcp", "--header", "Authorization:Bearer ${IZMIR_MCP_KEY}"],
      "env": { "IZMIR_MCP_KEY": "anahtariniz" }
    }
  }
}
```

### Ortam değişkenleri

| Değişken | Varsayılan | Açıklama |
|---|---|---|
| `MCP_API_KEY` | - | Uzak sürüm için zorunlu; virgülle birden fazla anahtar |
| `PORT` | 3000 | HTTP portu (Render kendisi verir) |
| `REDIS_URL` | - | Verilirse Redis önbellek |
| `ZAMAN_ASIMI_MS` | 6000 | Her API denemesi için zaman aşımı |
| `DENEME_SAYISI` | 3 | API deneme sayısı |
| `SIMULE_KAPALI` | - | Demo: `otobus,metro,tramvay,izban,vapur,eczane,hava,havaCanli,havaDurumu,etkinlik` içinden çökmüş sayılacaklar |

## Veriyi güncelleme

Gömülü veri dosyaları `data/` klasöründedir. Hatlar, iskeleler veya fiyatlar değişince:

| Veri | Komut |
|---|---|
| ESHOT durak/hat (`data/eshot.json`) | https://www.eshot.gov.tr/gtfs/bus-eshot-gtfs.zip indirip açın, `npm run gtfs -- <klasör>` |
| Tramvay + vapur ağı (`data/ag.json`) | https://www.tramizmir.com/gtfs/rail-tramizmir-gtfs.zip indirip açın, `npm run ag -- <klasör>` (vapur bağlantıları API'den çekilir) |
| Ücret ve kart belgeleri (`data/belgeler.json`) | `npm run belgeler` |

Sonra `npm run build`.

## Proje yapısı

```
src/
  index.ts          stdio girişi (Claude Desktop / Code)
  http.ts           uzak sürüm: Express + Streamable HTTP + API anahtarı
  sunucu.ts         sunucu, kaynak_durumu aracı
  araclar/
    ulasim.ts       rota, sefer saatleri, durak, yaklaşan otobüs, otobüs konumu
    sehir.ts        eczane, hava durumu, hava kalitesi, etkinlikler
    bilgi.ts        RAG: ulaşım belgelerinde BM25 arama
  promptlar.ts      4 hazır prompt
  ag.ts             çok türlü ulaşım ağı ve aktarmalı rota arama
  canli.ts          canlı kaynak çağrıları, tarife hesapları
  kaynak.ts         fetch + yeniden deneme + devre kesici + bayat veri yedeği
  dns.ts            DNS önbelleği
  onbellek.ts       Redis veya hafıza önbelleği
  veri.ts           gömülü veri: duraklar, istasyonlar, durak arama
  ortak.ts          Türkçe metin, mesafe, İzmir saati
data/               eshot.json, ag.json, rayli.json, belgeler.json
scripts/            gtfs-hazirla, ag-hazirla, belge-hazirla, test, test-http
render.yaml         Render Blueprint
Dockerfile, docker-compose.yml
```

## API notları

- Otobüs API'sinde `KoorX` = enlem, `KoorY` = boylam; ondalık ayracı virgül (`"38,42"`).
- Durağa yaklaşan otobüs API'si durak numarası olarak GTFS `stop_id` kullanır (ör. Bornova Metro 30009).
- Metro ve tramvay `sefersaatleri`/`seferler`: `TarifeId` 1 = hafta içi, 2 = cumartesi, 3 = pazar. Tramvay API hat no: Konak 1/2, Karşıyaka 3/4, Çiğli iç 5, dış 6, Turuncu 7/8.
- İZDENİZ `vapursaatleri/{kalkış}/{varış}/{gün}/{detay}`: gün Pazartesi=1 … Pazar=7; seferlerde `IptalMi` alanı var.
- İZBAN ana hattı Alsancak'a uğramaz; Alsancak, Halkapınar'dan ayrılan koldur.
- `havadegerleri/{bugün}` bir önceki günün günlük ortalamasını döner (PM10, SO2).
- İZDENİZ GTFS dosyası (`ship-izdeniz-gtfs.zip`) zip değil HTML dönüyor; vapur ağı bu yüzden API'den kuruldu.
- `ibb/cbs/noktayayakinduraklar` ve ESHOT hat duyuruları dosyası testlerde erişilemedi.
- Veri kataloğu: https://acikveri.bizizmir.com

## Lisans

[MIT](LICENSE)
