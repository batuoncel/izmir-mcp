// ESHOT GTFS verisinden sunucunun kullandığı küçük veri dosyasını üretir: data/eshot.json
//
// Kullanım:
//   1) https://www.eshot.gov.tr/gtfs/bus-eshot-gtfs.zip dosyasını indirip bir klasöre açın
//   2) node scripts/gtfs-hazirla.mjs <gtfs-klasoru>
//
// Çıktı: duraklar (id, ad, konum) ve her hat-yön için sıralı durak listesi.
// 85 MB'lık stop_times.txt'yi satır satır okur, hafızaya tamamını almaz.

import { createReadStream, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createInterface } from "node:readline";
import { join } from "node:path";

const dir = process.argv[2];
if (!dir) {
  console.error("Kullanım: node scripts/gtfs-hazirla.mjs <gtfs-klasoru>");
  process.exit(1);
}

function csv(file) {
  const [header, ...rows] = readFileSync(join(dir, file), "utf8").replace(/^﻿/, "").trim().split(/\r?\n/);
  const cols = header.split(",");
  return rows.map((line) => {
    const v = line.split(",");
    return Object.fromEntries(cols.map((c, i) => [c, v[i]]));
  });
}

const stops = csv("stops.txt").map((s) => ({
  id: Number(s.stop_id),
  ad: s.stop_name.trim(),
  enlem: Number(Number(s.stop_lat).toFixed(6)),
  boylam: Number(Number(s.stop_lon).toFixed(6)),
}));
const routes = new Map(csv("routes.txt").map((r) => [r.route_id, { no: r.route_short_name, ad: r.route_long_name.trim() }]));

// trip -> (hat, yön)
const tripInfo = new Map();
for (const t of csv("trips.txt")) tripInfo.set(t.trip_id, { route: t.route_id, yon: Number(t.direction_id) });

// Her trip'in durak dizisi; her hat-yön için en uzun diziyi sakla (ana güzergah)
const best = new Map(); // "route|yon" -> number[]
let curTrip = null;
let cur = [];
function flush() {
  if (!curTrip) return;
  const info = tripInfo.get(curTrip);
  if (info) {
    const key = `${info.route}|${info.yon}`;
    const seq = cur.sort((a, b) => a[0] - b[0]).map((x) => x[1]);
    if (!best.has(key) || best.get(key).length < seq.length) best.set(key, seq);
  }
  cur = [];
}

const rl = createInterface({ input: createReadStream(join(dir, "stop_times.txt")) });
let first = true;
let cols;
for await (const line of rl) {
  if (first) {
    cols = line.replace(/^﻿/, "").split(",");
    first = false;
    continue;
  }
  const v = line.split(",");
  const trip = v[cols.indexOf("trip_id")];
  if (trip !== curTrip) {
    flush();
    curTrip = trip;
  }
  cur.push([Number(v[cols.indexOf("stop_sequence")]), Number(v[cols.indexOf("stop_id")])]);
}
flush();

const hatlar = [];
for (const [key, duraklar] of best) {
  const [routeId, yon] = key.split("|");
  const r = routes.get(routeId);
  if (!r) continue;
  hatlar.push({ hatNo: r.no, ad: r.ad, yon: Number(yon), duraklar });
}
hatlar.sort((a, b) => Number(a.hatNo) - Number(b.hatNo) || a.yon - b.yon);

mkdirSync("data", { recursive: true });
const out = { kaynak: "ESHOT GTFS (bus-eshot-gtfs.zip)", uretildi: new Date().toISOString().slice(0, 10), duraklar: stops, hatlar };
writeFileSync("data/eshot.json", JSON.stringify(out));
console.log(`${stops.length} durak, ${hatlar.length} hat-yön yazıldı -> data/eshot.json`);
