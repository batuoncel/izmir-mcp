# İzmir Açık Veri MCP

İzmir'in açık verisini (ulaşım, nöbetçi eczane, hava kalitesi, duyurular) MCP üzerinden Claude'a bağlayan sunucu.
Yaşar Üniversitesi Gen-AI / Mekatronik Lab, Proje 09.

## Durum (1. hafta)

| Araç | Ne yapar | Kaynak |
|---|---|---|
| `merhaba` | Bağlantı testi | - |
| `otobus_konumlari` | Bir ESHOT hattındaki otobüslerin canlı konumu | `openapi.izmir.bel.tr/api/iztek/hatotobuskonumlari/{hatNo}` |

## Kurulum

Gereken: Node.js 20+

```bash
npm install
npm run build
```

Claude olmadan test etmek için (MCP Inspector):

```bash
npm run inspect
```

## Claude Desktop'a bağlama

`%APPDATA%\Claude\claude_desktop_config.json` dosyasına ekleyin (yolu kendi klasörünüze göre değiştirin), sonra Claude Desktop'ı tamamen kapatıp açın:

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

Deneme soruları: "merhaba aracını Batu için çalıştır", "35 numaralı hatta şu an kaç otobüs var?"

## API notları (1. hafta testi)

- **Canlı otobüs konumu çalışıyor.** Dikkat: `KoorX` = enlem, `KoorY` = boylam, ondalık ayracı virgül (`"38,42"`).
- **Nöbetçi eczaneler** (`/api/ibb/nobetcieczaneler`) 200 dönüyor; 2. haftanın kaynak adayı.
- **API kararsız:** aynı uç nokta bazen zaman aşımına düşüyor, bazen 0,5 sn'de dönüyor. `acikveriwapi.izmir.bel.tr` (durak/hat listeleri) testte 40 sn içinde cevap vermedi. Bu yüzden önbellek (Redis) ve yeniden deneme şart.
- Veri kataloğu: https://acikveri.bizizmir.com (CKAN API: `/api/3/action/package_search?q=eshot`)

## Sonraki adımlar

- 2. hafta: kalan iki kaynağın testi (eczane, hava kalitesi), durak bazlı "durağa yaklaşan otobüsler"
- Önbellek + yeniden deneme, uzak (HTTP) sürüm + API anahtarı, Docker
