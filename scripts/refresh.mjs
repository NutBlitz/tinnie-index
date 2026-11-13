/**
 * Pull public beer catalogues from Dan Murphy's, Liquorland, and BWS,
 * rank by cheapest listed dollars per litre, write data/beers.json
 * and public/beers.json.
 *
 * No login. Member tickets and multi-buys are used only when the
 * retailer already prints them on the public page.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

function moneyRound(n) {
  return Math.round(n * 100) / 100;
}

function unitsFromUom(uom) {
  const m = String(uom || "").toUpperCase().match(/(\d+)/);
  return m ? Number(m[1]) : 1;
}

function dealFromUnits(units) {
  if (units <= 1) return "each";
  if (units >= 16) return `case (${units})`;
  return `pack (${units})`;
}

function inferStyle(name) {
  const n = String(name).toLowerCase();
  if (/ginger/.test(n)) return "Ginger Beer";
  if (/cider/.test(n)) return "Cider";
  if (/\bxpa\b/.test(n)) return "XPA";
  if (/\bipa\b|india pale/.test(n)) return "IPA";
  if (/pale ale|hazy/.test(n)) return "Pale Ale";
  if (/stout|porter/.test(n)) return "Stout";
  if (/pilsner|\bpils\b/.test(n)) return "Pilsner";
  if (/wheat|hefe|weiss/.test(n)) return "Wheat Beer";
  if (/lager|cerveza|super dry|extra dry|mid strength|gold mid|crisp|draught/.test(n)) {
    return "Lager";
  }
  if (/\bale\b/.test(n)) return "Ale";
  return "Other";
}

function skipName(name) {
  return /home brew|gift pack|gift set|tasting pack|twin glass|glass pack|crown seal|carbonation|brew enhancer|diy|pet caps|dextrose|spice of life|miniatures|hip flask/i.test(
    name || "",
  );
}

function skipSpirit(name, ml, units = 1, abv = null) {
  const n = String(name || "");
  if (skipName(n)) return true;
  if (!ml || ml < 200 || ml > 1500) return true;
  if (abv != null && abv < 15) return true;
  if (
    /boxtail|premix|\brtd\b|seltzer|canned cocktail|vodka cruiser|\budl\b|cooler|\bruski\b|\b-?196\b|twisted|gee up|\bscwipp\b|& dry|and dry|& tonic|and tonic|\bsoda\b|margarita|makgeolli|\bcask\b|smirnoff ice/i.test(
      n,
    )
  ) {
    return true;
  }
  const namedAbv = n.match(/(\d+(?:\.\d+)?)\s*%/);
  if (namedAbv && Number(namedAbv[1]) < 15) return true;
  if (/\bcola\b|lemonade|& coke|and cola|\bmixer\b|\bcarton\b/i.test(n)) return true;
  if (/\bcan\b|\bcans\b|\d+\s*p(?:ac)?k\b/i.test(n) && ml <= 500) return true;
  if (
    ml <= 440 &&
    /\b(lemon|grape|passion|pineapple|raspberry|watermelon|mango|peach|berr(?:y|ies)|fruits?|orange|lime)\b/i.test(n)
  ) {
    return true;
  }
  if (units > 4 && ml <= 440) return true;
  return false;
}

function abvMax(kind) {
  return kind === "spirit" ? 80 : 15;
}

function perLOk(perL, kind) {
  if (!Number.isFinite(perL)) return false;
  if (kind === "spirit") return perL >= 15 && perL <= 400;
  return perL >= 2 && perL <= 40;
}

function inferAbv(name, existing, kind = "beer") {
  const max = abvMax(kind);
  if (existing != null && existing >= 0 && existing <= max) return existing;
  const n = String(name || "");
  const pct = n.match(/(\d+(?:\.\d+)?)\s*%/);
  if (pct) {
    const a = Number(pct[1]);
    if (a >= 0 && a <= max) return a;
  }
  if (kind === "beer") {
    if (/\b0\.0\b/.test(n)) return 0;
    if (/ultra low alcohol/i.test(n)) return 0.5;
    if (/\bbirell\b/i.test(n)) return 0.5;
    if (/non[-\s]?alcoholic|\balcohol[-\s]?free\b/i.test(n)) return 0;
    if (/\bzero\b/i.test(n) && !/carb|sugar|joule/i.test(n)) return 0;
  }
  return existing ?? null;
}

function inferSpiritStyle(name, listed) {
  const n = String(name || "").toLowerCase();
  if (/whisky|whiskey|bourbon|scotch|\brye\b/.test(n)) return "Whisky";
  if (/\bgin\b/.test(n)) return "Gin";
  if (/vodka/.test(n)) return "Vodka";
  if (/\brum\b/.test(n)) return "Rum";
  if (/tequila|mezcal/.test(n)) return "Tequila";
  if (/brandy|cognac|armagnac/.test(n)) return "Brandy";
  if (/liqueur|baileys|sambuca|midori|advocaat/.test(n)) return "Liqueur";
  if (/aperol|campari|vermouth|amaro/.test(n)) return "Aperitif";
  const raw = String(listed || "").trim();
  if (/^(whisky|whiskey|bourbon|scotch|gin|vodka|rum|tequila|mezcal|brandy|cognac|liqueur|aperitif|armagnac)$/i.test(raw)) {
    return raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase();
  }
  return "Spirits";
}

function ratingFromShop(score, count, source) {
  const n = toNum(score);
  if (n == null || n <= 0 || n > 5) return null;
  return { score: moneyRound(n), count: Number(count) || 0, source };
}

function coreName(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9.]+/g, " ")
    .replace(/\b\d+(?:\.\d+)?(?:\s*x\s*\d+(?:\.\d+)?)+\s*m?l\b/g, " ")
    .replace(/\b\d+(?:\.\d+)?\s*m?l\b/g, " ")
    .replace(/\b\d+\s*x\s*\d+\b/g, " ")
    .replace(/\b(cans?|bottles?|longnecks?|stubbies|pack|packs|case|pk|carton|fully imported)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function fillAbvFromKnown(rows, known) {
  const byCore = new Map();
  for (const beer of known) {
    if (beer.abv == null) continue;
    const key = coreName(beer.name);
    if (key.length < 8 || key.split(" ").length < 2) continue;
    const set = byCore.get(key) || new Set();
    set.add(beer.abv);
    byCore.set(key, set);
  }
  let filled = 0;
  for (const row of rows) {
    if (row.abv != null) continue;
    const set = byCore.get(coreName(row.name));
    if (set && set.size === 1) {
      row.abv = [...set][0];
      filled++;
    }
  }
  return filled;
}

function baseSku(sku) {
  return String(sku || "").split("_")[0];
}

function abvFromLlProduct(product, kind = "beer") {
  if (!product) return null;
  let abv = toNum(product.alcoholPercent);
  if (abv == null) {
    const prop = (product.productProperties || []).find((p) =>
      /alcohol content/i.test(p.key || ""),
    );
    abv = toNum(prop?.value);
  }
  if (abv != null && (abv < 0 || abv > abvMax(kind))) return null;
  return abv;
}

function loadAbvCache(prevBeers) {
  const cache = {};
  const file = path.join(ROOT, "data", "ll-abv.json");
  if (fs.existsSync(file)) {
    try {
      Object.assign(cache, JSON.parse(fs.readFileSync(file, "utf8")));
    } catch {
      // ignore a broken cache and rebuild it
    }
  }
  for (const row of prevBeers || []) {
    if (row.store !== "liquorland" || row.abv == null) continue;
    const sku = baseSku(row.sku);
    if (cache[sku] == null) cache[sku] = row.abv;
  }
  return cache;
}

function saveAbvCache(cache) {
  fs.mkdirSync(path.join(ROOT, "data"), { recursive: true });
  fs.writeFileSync(
    path.join(ROOT, "data", "ll-abv.json"),
    JSON.stringify(cache, null, 0),
  );
}

function abvFromBwsProduct(product, kind = "beer") {
  if (!product) return null;
  const max = abvMax(kind);
  for (const key of ["alcohol%", "webalcoholpercentage", "alcoholpercentage"]) {
    const abv = toNum(detail(product, key));
    if (abv != null && abv >= 0 && abv <= max) return abv;
  }
  return null;
}

function abvFromBwsProducts(products, kind = "beer") {
  for (const product of products || []) {
    const abv = abvFromBwsProduct(product, kind);
    if (abv != null) return abv;
  }
  return null;
}

function loadBwsAbvCache(prevBeers) {
  const cache = {};
  const file = path.join(ROOT, "data", "bws-abv.json");
  if (fs.existsSync(file)) {
    try {
      Object.assign(cache, JSON.parse(fs.readFileSync(file, "utf8")));
    } catch {
      // ignore a broken cache and rebuild it
    }
  }
  for (const row of prevBeers || []) {
    if (row.store !== "bws" || row.abv == null) continue;
    for (const sku of bwsProductCodes(row)) {
      if (cache[sku] == null) cache[sku] = row.abv;
    }
  }
  return cache;
}

function saveBwsAbvCache(cache) {
  fs.mkdirSync(path.join(ROOT, "data"), { recursive: true });
  fs.writeFileSync(
    path.join(ROOT, "data", "bws-abv.json"),
    JSON.stringify(cache, null, 0),
  );
}

function bwsProductCodes(row) {
  const codes = [];
  const url = String(row.url || "").match(/\/product\/(\d+)/);
  if (url) codes.push(url[1]);
  if (row.sku) codes.push(String(row.sku));
  return [...new Set(codes)];
}

async function fillBwsAbv(rows, cache) {
  const rowKind = rows.find((r) => r.kind)?.kind || "beer";
  for (const row of rows) {
    if (row.abv != null) continue;
    for (const sku of bwsProductCodes(row)) {
      if (cache[sku] != null) {
        row.abv = cache[sku];
        break;
      }
    }
  }
  const missing = [];
  const seen = new Set();
  for (const row of rows) {
    if (row.abv != null) continue;
    for (const sku of bwsProductCodes(row)) {
      if (!sku || seen.has(sku)) continue;
      seen.add(sku);
      missing.push(sku);
    }
  }
  let filled = 0;
  await mapPool(missing, 6, async (sku) => {
    try {
      const json = await fetchJson(`https://api.bws.com.au/apis/ui/Product/${encodeURIComponent(sku)}`, {
        headers: {
          origin: "https://bws.com.au",
          referer: "https://bws.com.au/",
        },
      });
      const abv = abvFromBwsProducts(json.Products, rowKind);
      if (abv != null) {
        cache[sku] = abv;
        filled++;
      }
    } catch {
      // keep going; a missing PDP should not kill the refresh
    }
    await new Promise((r) => setTimeout(r, 40));
  });
  for (const row of rows) {
    if (row.abv != null) continue;
    for (const sku of bwsProductCodes(row)) {
      if (cache[sku] != null) {
        row.abv = cache[sku];
        break;
      }
    }
  }
  return { missing: missing.length, filled };
}

async function mapPool(items, concurrency, fn) {
  let i = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (i < items.length) {
      const item = items[i++];
      await fn(item);
    }
  });
  await Promise.all(workers);
}

async function fillLiquorlandAbv(rows, cache, kind = "beer") {
  const cat = kind === "spirit" ? "spirits" : "beer";
  for (const row of rows) {
    if (row.abv != null) continue;
    const cached = cache[baseSku(row.sku)];
    if (cached != null) row.abv = cached;
  }
  const missing = [];
  const seen = new Set();
  for (const row of rows) {
    if (row.abv != null) continue;
    const sku = baseSku(row.sku);
    if (!sku || seen.has(sku)) continue;
    seen.add(sku);
    missing.push(sku);
  }
  let filled = 0;
  await mapPool(missing, 6, async (sku) => {
    try {
      const json = await fetchJson(
        `https://www.liquorland.com.au/api/products/ll/nsw/${cat}/${encodeURIComponent(sku)}`,
        {
          headers: {
            origin: "https://www.liquorland.com.au",
            referer: "https://www.liquorland.com.au/beer-and-cider",
          },
        },
      );
      const abv = abvFromLlProduct(json.product, kind);
      if (abv != null) {
        cache[sku] = abv;
        filled++;
      }
    } catch {
      // keep going; Incapsula or a missing PDP should not kill the refresh
    }
    await new Promise((r) => setTimeout(r, 40));
  });
  for (const row of rows) {
    if (row.abv != null) continue;
    const cached = cache[baseSku(row.sku)];
    if (cached != null) row.abv = cached;
  }
  return { missing: missing.length, filled };
}

function rankBy(rows, key) {
  const sorted = [...rows].sort(
    (a, b) => a[key] - b[key] || a.name.localeCompare(b.name),
  );
  const map = new Map(sorted.map((row, i) => [row.sku + ":" + row.store, i + 1]));
  return map;
}

function applyRanks(rows) {
  const deal = rankBy(rows, "dealPerL");
  const shelf = rankBy(rows, "shelfPerL");
  for (const row of rows) {
    const id = row.sku + ":" + row.store;
    row.rankDeal = deal.get(id);
    row.rankShelf = shelf.get(id);
  }
  rows.sort((a, b) => a.dealPerL - b.dealPerL || a.name.localeCompare(b.name));
}

async function fetchJson(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: {
      accept: "application/json, text/plain, */*",
      "user-agent": UA,
      ...(options.headers || {}),
    },
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`${url} → HTTP ${res.status} ${text.slice(0, 180)}`);
  }
  return JSON.parse(text);
}

function detail(product, name) {
  return (product.AdditionalDetails || []).find((d) => d.Name === name)?.Value;
}

function toNum(v) {
  const n = parseFloat(String(v ?? "").replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) ? n : null;
}

function parseMl(title, liquor) {
  liquor = String(liquor || "");
  let ml = null;
  const titleMl = String(title).match(/(\d+(?:\.\d+)?)\s*mL/i);
  const titleL = String(title).match(/(\d+(?:\.\d+)?)\s*L\b/i);
  const liquorMl = liquor.match(/(\d+(?:\.\d+)?)\s*ML/i);
  const liquorL = liquor.match(/(\d+(?:\.\d+)?)\s*L$/i);
  if (titleMl) {
    const t = Number(titleMl[1]);
    if (t >= 200 && t <= 1500) ml = t;
  }
  if (ml == null && liquorMl) {
    const t = Number(liquorMl[1]);
    ml = t >= 2000 ? null : t;
  }
  if (ml == null && titleL) ml = Number(titleL[1]) * 1000;
  if (ml == null && liquorL) ml = Number(liquorL[1]) * 1000;
  return ml;
}

function parseMlDan(product, title) {
  return parseMl(title, detail(product, "webliquorsize"));
}

function unitsFromPrice(price, inner, cse) {
  const msg = String(price.Message || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
  const pack = String(price.PackType || "");
  let m;
  if ((m = msg.match(/for (\d+) packs?/))) return Number(m[1]) * (inner || 6);
  if ((m = msg.match(/for (\d+) bottles?/))) return Number(m[1]);
  if ((m = msg.match(/for (\d+) cases?/))) return Number(m[1]) * (cse || 24);
  if ((m = msg.match(/pack of (\d+)/))) return Number(m[1]);
  if (/per kit/.test(msg)) return null;
  if ((m = msg.match(/(?:case|block|pack)\s*\(?\s*(\d+)/))) return Number(m[1]);
  if ((m = msg.match(/\((\d+)\)/))) return Number(m[1]);
  if (/each|bottle|can/.test(msg) && !/pack|case|for /.test(msg)) return 1;
  if (pack === "Case") return cse || null;
  if (pack === "Pack") return inner || null;
  if (pack === "Bottle" || pack === "Can") return 1;
  if (/^each/.test(msg)) return 1;
  return null;
}

function skuMult(title, inner, cse, units) {
  if (units >= 8) return 1;
  if (inner && inner > 1) return 1;
  if (!(cse && cse <= 6)) return 1;
  const ten = title.match(/(\d+)\s*x\s*\d+(?:\.\d+)?\s*mL/i);
  const pk = title.match(/(\d+)\s*p(?:ac)?k/i);
  const n = ten ? Number(ten[1]) : pk ? Number(pk[1]) : 0;
  return n >= 8 && n <= 24 ? n : 1;
}

function mkDanOption(pr, price, member, inner, cse, title, ml, kind = "beer") {
  if (!(price > 0)) return null;
  let units = unitsFromPrice(pr, inner, cse);
  if (!units) return null;
  units *= skuMult(title, inner, cse, units);
  const litres = (units * ml) / 1000;
  const perL = price / litres;
  if (!perLOk(perL, kind)) return null;
  return {
    deal: String(pr.Message || "").replace(/\s+/g, " ").trim(),
    price: moneyRound(price),
    units,
    perL: moneyRound(perL),
    member: !!member,
    instore: /in-store|in store/i.test(pr.Message || ""),
  };
}

function pickBest(options) {
  if (!options.length) return null;
  const online = options.filter((o) => !o.instore);
  const pool = online.length ? online : options;
  return [...pool].sort((a, b) => a.perL - b.perL || a.price - b.price)[0];
}

async function loadDanMurphys(kind = "beer") {
  const pageSize = 100;
  const departments = kind === "spirit" ? ["spirits", "whisky"] : ["beer"];
  const headers = {
    "content-type": "application/json",
    origin: "https://www.danmurphys.com.au",
    referer:
      kind === "spirit"
        ? "https://www.danmurphys.com.au/spirits/all"
        : "https://www.danmurphys.com.au/beer/all",
  };
  const bundles = [];
  for (const department of departments) {
    const first = await fetchJson("https://api.danmurphys.com.au/apis/ui/Browse", {
      method: "POST",
      headers,
      body: JSON.stringify({
        department,
        filters: [],
        pageNumber: 1,
        pageSize,
        sortType: "Relevance",
        Location: "ListerFacet",
      }),
    });
    bundles.push(...(first.Bundles || []));
    const total = first.TotalRecordCount || 0;
    const pages = Math.max(1, Math.ceil(total / pageSize));
    for (let page = 2; page <= pages; page++) {
      const json = await fetchJson("https://api.danmurphys.com.au/apis/ui/Browse", {
        method: "POST",
        headers,
        body: JSON.stringify({
          department,
          filters: [],
          pageNumber: page,
          pageSize,
          sortType: "Relevance",
          Location: "ListerFacet",
        }),
      });
      bundles.push(...(json.Bundles || []));
      await new Promise((r) => setTimeout(r, 250));
    }
  }

  const rows = [];
  for (const bundle of bundles) {
    const product = bundle.Products?.[0];
    if (!product) continue;
    const title = String(detail(product, "producttitle") || product.Description || "")
      .replace(/<br\s*\/?>/gi, " ")
      .replace(/\s+/g, " ")
      .trim();
    const cat = detail(product, "webmaincategory") || "";
    if (cat === "otherdrinksandaccessories" || skipName(title)) continue;
    const ml = parseMlDan(product, title);
    if (!ml || ml < 200 || ml > 10000) continue;
    if (kind === "spirit" && skipSpirit(title, ml, 1, toNum(detail(product, "webalcoholpercentage")))) continue;
    const inner = toNum(detail(product, "webpacksizeinner"));
    const cse = toNum(detail(product, "webpacksizecase"));
    const options = [];
    for (const pr of Object.values(product.Prices || {})) {
      const cur = mkDanOption(pr, pr.Value, pr.IsMemberOffer, inner, cse, title, ml, kind);
      if (cur) options.push(cur);
      if (pr.BeforePromotion > 0) {
        const was = mkDanOption(pr, pr.BeforePromotion, false, inner, cse, title, ml, kind);
        if (was) options.push(was);
      }
    }
    const memberBest = pickBest(options);
    const guestBest = pickBest(options.filter((o) => !o.member)) || memberBest;
    if (!memberBest || !guestBest) continue;
    const brand = detail(product, "webbrandname") || "";
    let name = String(detail(product, "webtitle") || title)
      .replace(/<br\s*\/?>/gi, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (brand && !name.toLowerCase().startsWith(brand.toLowerCase())) name = `${brand} ${name}`;
    let style =
      kind === "spirit"
        ? inferSpiritStyle(name, detail(product, "webspiritstyle") || detail(product, "webwhiskystyle"))
        : detail(product, "webbeerstyle") || inferStyle(name);
    if (kind === "beer" && /cider/i.test(name)) style = "Cider";
    let abv = toNum(detail(product, "webalcoholpercentage"));
    if (abv != null && (abv < 0 || abv > abvMax(kind))) abv = null;
    abv = inferAbv(name, abv, kind);
    const shop = ratingFromShop(
      detail(product, "webaverageproductrating"),
      detail(product, "webtotalreviewcount"),
      "danmurphys",
    );
    rows.push({
      store: "danmurphys",
      kind,
      sku: String(product.Stockcode),
      name,
      brand: brand || name.split(" ")[0],
      style,
      abv,
      ml: Math.round(ml),
      url: `https://www.danmurphys.com.au/product/${product.Stockcode}/${product.UrlFriendlyName || ""}`,
      shelfPerL: guestBest.perL,
      shelfPrice: guestBest.price,
      shelfUnits: guestBest.units,
      shelfDeal: guestBest.deal.replace(/^\s+/, ""),
      dealPerL: memberBest.perL,
      dealPrice: memberBest.price,
      dealUnits: memberBest.units,
      dealDeal: memberBest.deal.replace(/^\s+/, ""),
      dealKind: memberBest.member && memberBest.perL < guestBest.perL - 0.005 ? "member" : "shelf",
      shopRating: shop,
    });
  }
  return rows;
}

async function loadLiquorland(kind = "beer") {
  const show = 200;
  const cat = kind === "spirit" ? "spirits" : "beer";
  const first = await fetchJson(
    `https://www.liquorland.com.au/api/products/ll/nsw/${cat}?page=1&show=${show}`,
    { headers: { origin: "https://www.liquorland.com.au", referer: `https://www.liquorland.com.au/${cat}` } },
  );
  const total = first.meta?.page?.productCount || first.products?.length || 0;
  const pages = Math.max(1, Math.ceil(total / show));
  const products = [...(first.products || [])];
  for (let page = 2; page <= pages; page++) {
    const json = await fetchJson(
      `https://www.liquorland.com.au/api/products/ll/nsw/${cat}?page=${page}&show=${show}`,
      { headers: { origin: "https://www.liquorland.com.au", referer: `https://www.liquorland.com.au/${cat}` } },
    );
    products.push(...(json.products || []));
    await new Promise((r) => setTimeout(r, 250));
  }

  const rows = [];
  for (const product of products) {
    if (skipName(product.name)) continue;
    const ml = Number(product.volumeMl);
    if (!ml || ml < 200 || ml > 10000) continue;
    if (kind === "spirit" && skipSpirit(product.name, ml, unitsFromUom(product.unitOfMeasure), toNum(product.alcoholPercent))) continue;
    const units = unitsFromUom(product.unitOfMeasure);
    const current = Number(product.price?.current);
    if (!(current > 0) || !units) continue;
    const litres = (units * ml) / 1000;
    const options = [];
    const add = (price, deal, offer, u, L) => {
      const perL = price / L;
      if (!perLOk(perL, kind)) return;
      options.push({
        price: moneyRound(price),
        deal,
        perL: moneyRound(perL),
        offer,
        units: u,
      });
    };
    add(current, dealFromUnits(units), false, units, litres);
    const promo = String(product.promotion?.calloutText || "");
    const mb = promo.match(/(\d+)\s*for\s*\$(\d+(?:\.\d+)?)/i);
    if (mb) {
      const n = Number(mb[1]);
      add(Number(mb[2]), promo, true, units * n, litres * n);
    }
    if (!options.length) continue;
    options.sort((a, b) => a.perL - b.perL || a.price - b.price);
    const best = options[0];
    const shelf = options.find((o) => !o.offer) || best;
    let name = String(product.name || "").replace(/\s+/g, " ").trim();
    const brand = product.brand || "";
    if (brand && !name.toLowerCase().startsWith(brand.toLowerCase())) name = `${brand} ${name}`;
    rows.push({
      store: "liquorland",
      sku: String(product.id),
      name,
      brand,
      kind,
      style: kind === "spirit" ? inferSpiritStyle(name) : inferStyle(name),
      abv: inferAbv(name, toNum(product.alcoholPercent), kind),
      ml: Math.round(ml),
      url: `https://www.liquorland.com.au/${String(product.productUrl || "").replace(/^\//, "")}`,
      shopRating: ratingFromShop(product.ratings?.average, product.ratings?.total, "liquorland"),
      shelfPerL: shelf.perL,
      shelfPrice: shelf.price,
      shelfUnits: shelf.units,
      shelfDeal: shelf.deal,
      dealPerL: best.perL,
      dealPrice: best.price,
      dealUnits: best.units,
      dealDeal: best.deal,
      dealKind: best.offer && best.perL < shelf.perL - 0.005 ? "multibuy" : "shelf",
    });
  }
  return rows;
}

function bwsAppOnly(tag, product) {
  const top = String(tag?.TopText || "");
  return /app/i.test(top) || product.PromotionType === "AppBasedOffer";
}

async function loadBws(kind = "beer") {
  const pageSize = 100;
  const group = kind === "spirit" ? "all-spirits" : "all-beer";
  const headers = {
    accept: "application/json",
    origin: "https://bws.com.au",
    referer: `https://bws.com.au/productgroup/${group}`,
  };
  const firstUrl =
    `https://api.bws.com.au/apis/ui/ProductGroup/Products/${group}` +
    `?ExcludeBanners=true&ExcludeFacets=true&Location=%2Fproductgroup%2F${group}` +
    `&pageNumber=1&pageSize=${pageSize}&sortType=ProductGroup_Relevance`;
  const first = await fetchJson(firstUrl, { headers });
  const total = first.TotalRecordCount || 0;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const items = [...(first.Items || [])];
  for (let page = 2; page <= pages; page++) {
    const json = await fetchJson(
      firstUrl.replace("pageNumber=1", `pageNumber=${page}`),
      { headers },
    );
    items.push(...(json.Items || []));
    await new Promise((r) => setTimeout(r, 250));
  }

  const rows = [];
  const seen = new Set();
  for (const item of items) {
    const products = item.Products || [];
    const options = [];
    const add = (product, price, units, ml, deal, offer) => {
      if (!(price > 0) || !units) return;
      const litres = (units * ml) / 1000;
      const perL = price / litres;
      if (!perLOk(perL, kind)) return;
      options.push({
        product,
        price: moneyRound(price),
        units,
        perL: moneyRound(perL),
        deal,
        offer,
      });
    };
    for (const product of products) {
      const title = String(product.Name || product.Title || item.Name || "")
        .replace(/<br\s*\/?>/gi, " ")
        .replace(/\s+/g, " ")
        .trim();
      if (skipName(title)) continue;
      const ml = parseMl(title, detail(product, "liquorsize") || product.PackageSize);
      if (!ml || ml < 200 || ml > 10000) continue;
      if (
        kind === "spirit" &&
        skipSpirit(title, ml, toNum(detail(product, "productunitquantity")) || 1, abvFromBwsProduct(product, kind))
      ) {
        continue;
      }
      const units = toNum(detail(product, "productunitquantity")) || 1;
      const current = Number(product.Price);
      const was = Number(product.WasPrice);
      add(product, current, units, ml, dealFromUnits(units), was > current);
      if (was > current) add(product, was, units, ml, dealFromUnits(units), false);
      const tag = product.FixedPricePromoTag;
      if (
        tag &&
        tag.TagType === "FixedPricePromo" &&
        tag.ProductMultiplier >= 2 &&
        tag.PromotionalPrice > 0 &&
        !bwsAppOnly(tag, product)
      ) {
        const n = Number(tag.ProductMultiplier);
        const label = `${String(tag.TopText || "").trim()} $${tag.PromotionalPrice}`.replace(/\s+/g, " ");
        add(product, Number(tag.PromotionalPrice), units * n, ml, label, true);
      }
    }
    if (!options.length) continue;
    options.sort((a, b) => a.perL - b.perL || a.price - b.price);
    const best = options[0];
    const shelf = options.find((o) => !o.offer) || best;
    const product = best.product;
    const brand = product.BrandName || detail(product, "brand_name") || "";
    let name = String(detail(product, "productname") || product.Name || "")
      .replace(/<br\s*\/?>/gi, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (brand && name && !name.toLowerCase().startsWith(String(brand).toLowerCase())) {
      name = `${brand} ${name}`;
    }
    if (skipName(name)) continue;
    const sku = String(item.PackParentStockCode || product.ParentStockCode || product.Stockcode);
    if (seen.has(sku)) continue;
    seen.add(sku);
    let abv = abvFromBwsProducts(products, kind);
    abv = inferAbv(name, abv, kind);
    let style =
      kind === "spirit"
        ? inferSpiritStyle(name, detail(product, "spirittype") || detail(product, "liquorstyle"))
        : detail(product, "liquorstyle") || inferStyle(name);
    if (!style || /^\d+$/.test(String(style)) || String(style).length < 3) {
      style = kind === "spirit" ? inferSpiritStyle(name) : inferStyle(name);
    }
    if (kind === "beer" && /cider/i.test(name)) style = "Cider";
    const ml = parseMl(name, detail(product, "liquorsize") || product.PackageSize);
    const shop = ratingFromShop(product.OverallRating, product.NumberOfReviews, "bws");
    rows.push({
      store: "bws",
      kind,
      sku,
      name,
      brand: brand || name.split(" ")[0],
      style,
      abv,
      ml: Math.round(ml || 0),
      url: `https://bws.com.au/product/${product.Stockcode}/${product.UrlFriendlyName || ""}`,
      shelfPerL: shelf.perL,
      shelfPrice: shelf.price,
      shelfUnits: shelf.units,
      shelfDeal: shelf.deal,
      dealPerL: best.perL,
      dealPrice: best.price,
      dealUnits: best.units,
      dealDeal: best.deal,
      dealKind: best.offer && best.perL < shelf.perL - 0.005 ? "multibuy" : "shelf",
      shopRating: shop,
    });
  }
  return rows.filter((row) => row.ml >= 200);
}

function parseUntappdSearch(html) {
  const out = [];
  const re =
    /<div class="beer-item"[\s\S]*?<p class="name">\s*<a href="([^"]+)">([^<]+)<\/a>[\s\S]*?<p class="brewery">\s*<a href="[^"]+">([^<]+)<\/a>[\s\S]*?data-rating="([0-9.]+)"/g;
  let m;
  while ((m = re.exec(html))) {
    const score = Number(m[4]);
    if (!(score > 0 && score <= 5)) continue;
    out.push({
      url: m[1].startsWith("http") ? m[1] : `https://untappd.com${m[1]}`,
      name: m[2].replace(/\s+/g, " ").trim(),
      brewery: m[3].replace(/\s+/g, " ").trim(),
      score: moneyRound(score),
    });
  }
  return out;
}

function queryForRating(row) {
  const brand = String(row.brand || "").trim();
  let core = coreName(row.name);
  if (brand) {
    const b = coreName(brand);
    if (b && (core === b || core.startsWith(b + " "))) core = core.slice(b.length).trim();
  }
  const q = `${brand} ${core}`.replace(/\s+/g, " ").trim();
  return q.slice(0, 80);
}

function pickUntappdHit(query, hits) {
  if (!hits.length) return null;
  const generic = new Set([
    "lager",
    "beer",
    "ale",
    "pale",
    "dry",
    "gold",
    "mid",
    "zero",
    "light",
    "premium",
    "original",
    "classic",
    "draught",
    "bitter",
    "pils",
    "pilsner",
    "stout",
    "cider",
  ]);
  const q = coreName(query);
  const qParts = q.split(" ").filter((w) => w.length > 2);
  const scored = hits.map((hit) => {
    const blob = coreName(`${hit.brewery} ${hit.name}`);
    const blobParts = new Set(blob.split(" "));
    const hitCount = qParts.filter((w) => blobParts.has(w)).length;
    const ratio = qParts.length ? hitCount / qParts.length : 0;
    return { hit, ratio, blob };
  });
  scored.sort((a, b) => b.ratio - a.ratio);
  const best = scored[0];
  if (!best || best.ratio < 0.6) return null;
  const first = qParts[0];
  if (first && !best.blob.split(" ").includes(first)) return null;
  const nameParts = coreName(best.hit.name)
    .split(" ")
    .filter((w) => w.length > 2 && !generic.has(w));
  const extra = nameParts.filter((w) => !qParts.includes(w));
  if (qParts.length <= 3 && extra.length >= 2) return null;
  return best.hit;
}

function loadUntappdCache() {
  const file = path.join(ROOT, "data", "untappd.json");
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return {};
  }
}

function saveUntappdCache(cache) {
  fs.mkdirSync(path.join(ROOT, "data"), { recursive: true });
  fs.writeFileSync(path.join(ROOT, "data", "untappd.json"), JSON.stringify(cache));
}

async function fillUntappdRatings(rows, cache, limit = 80) {
  const jobs = [];
  const seen = new Set();
  for (const row of rows) {
    const q = queryForRating(row);
    if (!q || q.length < 5 || seen.has(q)) continue;
    seen.add(q);
    if (cache[q] !== undefined) continue;
    jobs.push(q);
  }
  let filled = 0;
  for (const q of jobs.slice(0, limit)) {
    try {
      const json = await fetch(
        `https://untappd.com/search?q=${encodeURIComponent(q)}`,
        { headers: { accept: "text/html", "user-agent": UA } },
      );
      const html = await json.text();
      if (!json.ok || !/beer-item/.test(html)) continue;
      const hit = pickUntappdHit(q, parseUntappdSearch(html));
      cache[q] = hit
        ? { score: hit.score, url: hit.url, name: hit.name, brewery: hit.brewery }
        : null;
      if (hit) filled++;
    } catch {
      // leave uncached so a blocked search can retry next run
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  return { missing: jobs.length, filled };
}

function applyRatings(rows, cache) {
  for (const row of rows) {
    const q = queryForRating(row);
    const hit = cache[q];
    if (hit && hit.score) {
      row.rating = hit.score;
      row.ratingUrl = hit.url;
      row.ratingSource = "untappd";
    } else if (row.shopRating && row.shopRating.score) {
      row.rating = row.shopRating.score;
      row.ratingUrl = row.url;
      row.ratingSource = row.shopRating.source;
      row.ratingCount = row.shopRating.count;
    } else {
      row.rating = null;
      row.ratingUrl = null;
      row.ratingSource = null;
    }
    delete row.shopRating;
  }
}

const HISTORY_DAYS = 7;
const HISTORY_FILE = path.join(ROOT, "data", "price-history.json");

function todayStamp(d = new Date()) {
  return d.toISOString().slice(0, 10);
}

function loadHistory() {
  try {
    return JSON.parse(fs.readFileSync(HISTORY_FILE, "utf8"));
  } catch {
    return {};
  }
}

function saveHistory(history) {
  fs.mkdirSync(path.join(ROOT, "data"), { recursive: true });
  fs.writeFileSync(HISTORY_FILE, JSON.stringify(history));
}

function applyHistory(beers, history, day, prev, fetchedStores = null) {
  const cutoffDate = new Date(`${day}T00:00:00Z`);
  cutoffDate.setUTCDate(cutoffDate.getUTCDate() - (HISTORY_DAYS - 1));
  const cut = cutoffDate.toISOString().slice(0, 10);
  const prevMap = new Map(
    (prev?.beers || []).map((row) => [`${row.store}:${row.sku}`, row]),
  );
  const prevDay = String(prev?.updatedAt || "").slice(0, 10);
  const live = new Set();
  for (const beer of beers) {
    const id = `${beer.store}:${beer.sku}`;
    live.add(id);
    const series = Array.isArray(history[id]) ? history[id] : [];
    if (!series.length && prevDay && prevDay !== day && prevDay >= cut) {
      const old = prevMap.get(id);
      if (old && old.dealPerL != null) {
        series.push({ d: prevDay, deal: old.dealPerL, shelf: old.shelfPerL });
      }
    }
    if (!beer.kind) beer.kind = "beer";
    const fresh =
      !fetchedStores || fetchedStores[`${beer.store}:${beer.kind}`];
    if (fresh) {
      const point = { d: day, deal: beer.dealPerL, shelf: beer.shelfPerL };
      const last = series.at(-1);
      if (last && last.d === day) series[series.length - 1] = point;
      else series.push(point);
    }
    history[id] = series.filter((p) => p.d >= cut).slice(-HISTORY_DAYS);
    const window = history[id];
    beer.hist = window;
    const oldest = window[0];
    if (window.length >= 2 && oldest) {
      beer.chgDeal7 = moneyRound(beer.dealPerL - oldest.deal);
      beer.chgShelf7 = moneyRound(beer.shelfPerL - oldest.shelf);
    } else {
      beer.chgDeal7 = null;
      beer.chgShelf7 = null;
    }
  }
  for (const key of Object.keys(history)) {
    if (!live.has(key)) delete history[key];
  }
}

async function main() {
  const errors = [];
  const fetchedStores = {};
  let fetchedAny = false;
  const buckets = {
    "danmurphys:beer": [],
    "danmurphys:spirit": [],
    "liquorland:beer": [],
    "liquorland:spirit": [],
    "bws:beer": [],
    "bws:spirit": [],
  };

  async function tryLoad(key, label, fn) {
    try {
      const rows = await fn();
      buckets[key] = rows;
      fetchedStores[key] = rows.length > 0;
      fetchedAny = fetchedAny || rows.length > 0;
      console.log(`${label}: ${rows.length}`);
    } catch (err) {
      fetchedStores[key] = false;
      errors.push(`${label}: ${err.message}`);
      console.error(errors.at(-1));
    }
  }

  await tryLoad("danmurphys:beer", "Dan Murphy's beer", () => loadDanMurphys("beer"));
  await tryLoad("danmurphys:spirit", "Dan Murphy's spirits", () => loadDanMurphys("spirit"));
  await tryLoad("liquorland:beer", "Liquorland beer", () => loadLiquorland("beer"));
  await tryLoad("liquorland:spirit", "Liquorland spirits", () => loadLiquorland("spirit"));
  await tryLoad("bws:beer", "BWS beer", () => loadBws("beer"));
  await tryLoad("bws:spirit", "BWS spirits", () => loadBws("spirit"));

  const outFile = path.join(ROOT, "data", "beers.json");
  const rootFile = path.join(ROOT, "beers.json");
  const prevFile = fs.existsSync(outFile) ? outFile : fs.existsSync(rootFile) ? rootFile : null;
  const prev = prevFile ? JSON.parse(fs.readFileSync(prevFile, "utf8")) : { beers: [] };
  for (const row of prev.beers || []) {
    if (!row.kind) row.kind = "beer";
  }
  const keep = (store, kind) =>
    (prev.beers || []).filter((b) => b.store === store && (b.kind || "beer") === kind);
  for (const key of Object.keys(buckets)) {
    const [store, kind] = key.split(":");
    if (!buckets[key].length) buckets[key] = keep(store, kind);
  }
  const beers = Object.values(buckets).flat();
  for (const row of beers) {
    if (!row.kind) row.kind = "beer";
  }
  if (!beers.length) {
    throw new Error(`No drinks fetched.\n${errors.join("\n")}`);
  }
  const llBeer = buckets["liquorland:beer"];
  const llSpirit = buckets["liquorland:spirit"];
  const bwsBeer = buckets["bws:beer"];
  const bwsSpirit = buckets["bws:spirit"];
  const abvCache = loadAbvCache(prev.beers);
  try {
    const abv = await fillLiquorlandAbv(llBeer, abvCache, "beer");
    const abvS = await fillLiquorlandAbv(llSpirit, abvCache, "spirit");
    saveAbvCache(abvCache);
    console.log(`Liquorland ABV beer: ${abv.filled}/${abv.missing} · spirits: ${abvS.filled}/${abvS.missing}`);
  } catch (err) {
    errors.push(`Liquorland ABV: ${err.message}`);
    console.error(errors.at(-1));
  }
  const bwsAbvCache = loadBwsAbvCache(prev.beers);
  try {
    const abv = await fillBwsAbv(bwsBeer, bwsAbvCache);
    const abvS = await fillBwsAbv(bwsSpirit, bwsAbvCache);
    saveBwsAbvCache(bwsAbvCache);
    console.log(`BWS ABV beer: ${abv.filled}/${abv.missing} · spirits: ${abvS.filled}/${abvS.missing}`);
  } catch (err) {
    errors.push(`BWS ABV: ${err.message}`);
    console.error(errors.at(-1));
  }
  const copied = fillAbvFromKnown([...bwsBeer, ...bwsSpirit], beers);
  if (copied) console.log(`Copied ${copied} ABVs from matching catalogue drinks`);
  for (const rows of Object.values(buckets)) applyRanks(rows);
  const untappd = loadUntappdCache();
  try {
    const u = await fillUntappdRatings(beers, untappd, 80);
    saveUntappdCache(untappd);
    console.log(`Untappd: fetched ${u.filled}/${u.missing} missing searches`);
  } catch (err) {
    errors.push(`Untappd: ${err.message}`);
    console.error(errors.at(-1));
  }
  applyRatings(beers, untappd);
  const history = loadHistory();
  applyHistory(beers, history, todayStamp(), prev, fetchedStores);
  saveHistory(history);
  const byStore = (id) => beers.filter((b) => b.store === id).length;
  const payload = {
    updatedAt: fetchedAny ? new Date().toISOString() : prev.updatedAt || new Date().toISOString(),
    source: "Public Dan Murphy's, Liquorland, and BWS catalogues · Untappd ratings where matched",
    errors,
    stores: {
      danmurphys: { label: "Dan Murphy's", count: byStore("danmurphys") },
      liquorland: { label: "Liquorland", count: byStore("liquorland") },
      bws: { label: "BWS", count: byStore("bws") },
    },
    beers,
  };
  fs.mkdirSync(path.join(ROOT, "data"), { recursive: true });
  fs.mkdirSync(path.join(ROOT, "public"), { recursive: true });
  const json = JSON.stringify(payload);
  fs.writeFileSync(outFile, json);
  fs.writeFileSync(path.join(ROOT, "public", "beers.json"), json);
  if (fs.existsSync(path.join(ROOT, "index.html")) || fs.existsSync(rootFile)) {
    fs.writeFileSync(rootFile, json);
  }
  console.log(`Wrote ${payload.beers.length} beers → data/beers.json`);
  if (errors.length) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
