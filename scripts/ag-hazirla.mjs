// Tramvay ve vapur ağını üretir: data/ag.json
//
// Kullanım:
//   1) https://www.tramizmir.com/gtfs/rail-tramizmir-gtfs.zip dosyasını indirip bir klasöre açın
//   2) node scripts/ag-hazirla.mjs <tramvay-gtfs-klasoru>
//
// Tramvay: GTFS'ten her hat-yön için en uzun seferin durak dizisi.
// Vapur: İZDENİZ API'sinden iskeleler + her iskele çifti için sefer var mı ve ortalama süre (hafta içi tarifesi).

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const dir = process.argv[2];
if (!dir) {
  console.error("Kullanım: node scripts/ag-hazirla.mjs <tramvay-gtfs-klasoru>");
  process.exit(1);
}
const API = "https://openapi.izmir.bel.tr/api";

function csv(file) {
  const [header, ...rows] = readFileSync(join(dir, file), "utf8").replace(/^﻿/, "").trim().split(/\r?\n/);
  const cols = header.split(",");
  return rows.map((line) => Object.fromEntries(line.split(",").map((v, i) => [cols[i], v])));
}

// ---- Tramvay
const tStops = csv("stops.txt")
  .filter((s) => s.location_type !== "1")
  .map((s) => ({ id: Number(s.stop_id), ad: s.stop_name.trim(), enlem: Number(s.stop_lat), boylam: Number(s.stop_lon) }));
const tRoutes = new Map(csv("routes.txt").map((r) => [r.route_id, r.route_long_name.trim()]));
const tripInfo = new Map(csv("trips.txt").map((t) => [t.trip_id, { route: t.route_id, yon: Number(t.direction_id || 0) }]));
const seqs = new Map();
for (const st of csv("stop_times.txt")) {
  if (!seqs.has(st.trip_id)) seqs.set(st.trip_id, []);
  seqs.get(st.trip_id).push([Number(st.stop_sequence), Number(st.stop_id), st.arrival_time]);
}
const best = new Map();
for (const [trip, arr] of seqs) {
  const info = tripInfo.get(trip);
  if (!info) continue;
  arr.sort((a, b) => a[0] - b[0]);
  const key = `${info.route}|${info.yon}`;
  if (!best.has(key) || best.get(key).length < arr.length) best.set(key, arr);
}
const dk = (s) => {
  const [h, m, sn] = s.split(":").map(Number);
  return h * 60 + m + (sn || 0) / 60;
};
const tramHatlar = [...best].map(([key, arr]) => {
  const [route, yon] = key.split("|");
  const sure = dk(arr[arr.length - 1][2]) - dk(arr[0][2]);
  return {
    hat: route,
    ad: tRoutes.get(route) ?? route,
    yon: Number(yon),
    duraklar: arr.map((x) => x[1]),
    dkPerDurak: Number((sure / Math.max(1, arr.length - 1)).toFixed(2)),
  };
});
console.log(`Tramvay: ${tStops.length} durak, ${tramHatlar.length} hat-yön`);

// ---- Vapur
async function getir(url) {
  for (let i = 0; i < 6; i++) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(20000) });
      if (r.ok) return r.json();
    } catch {}
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw new Error(`Alınamadı: ${url}`);
}
const iskeleler = (await getir(`${API}/izdeniz/iskeleler`))
  .filter((x) => x.AktifMi)
  .map((x) => ({ id: x.IskeleId, ad: x.Adi, enlem: x.Enlem, boylam: x.Boylam, arabali: x.ArabaliVapurIskelesiMi }));

const baglantilar = [];
for (const a of iskeleler) {
  for (const b of iskeleler) {
    if (a.id === b.id) continue;
    let v;
    try {
      v = await getir(`${API}/izdeniz/vapursaatleri/${a.id}/${b.id}/4/0`);
    } catch {
      continue;
    }
    const sureler = [];
    for (const hat of Array.isArray(v) ? v : []) {
      for (const s of hat.seferSatirlari ?? []) {
        const k = s.seferSaatleri?.find((x) => x.KalkisSaati)?.KalkisSaati;
        const vr = s.seferSaatleri?.findLast((x) => x.VarisSaati)?.VarisSaati;
        if (k && vr) sureler.push((dk(vr) - dk(k) + 1440) % 1440);
      }
    }
    if (!sureler.length) continue;
    sureler.sort((x, y) => x - y);
    baglantilar.push({ a: a.id, b: b.id, sureDk: sureler[Math.floor(sureler.length / 2)], gunlukSefer: sureler.length });
  }
}
console.log(`Vapur: ${iskeleler.length} iskele, ${baglantilar.length} iskele çifti arasında sefer var`);

writeFileSync(
  "data/ag.json",
  JSON.stringify({ uretildi: new Date().toISOString().slice(0, 10), tramvay: { duraklar: tStops, hatlar: tramHatlar }, vapur: { iskeleler, baglantilar } }),
);
console.log("-> data/ag.json");
