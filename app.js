const ABV = {
  zero: [0, 0.5],
  low: [0.5, 3.5],
  mid: [3.5, 4.4],
  full: [4.4, 6],
  strong: [6, 99],
};

const $ = (id) => document.getElementById(id);

function money(n) {
  return Number(n).toFixed(2);
}

function abvText(v) {
  return v == null ? "—" : `${v}%`;
}

function storeLabel(store) {
  return store === "danmurphys" ? "Dan Murphy’s" : "Liquorland";
}

function kindLabel(kind) {
  if (kind === "member") return "member";
  if (kind === "multibuy") return "multi-buy";
  return "";
}

function inAbvBand(beer, band) {
  if (!band) return true;
  if (band === "unknown") return beer.abv == null;
  const [lo, hi] = ABV[band];
  return beer.abv != null && beer.abv >= lo && beer.abv < hi;
}

function ticket(beer, mode) {
  if (mode === "shelf") {
    return {
      perL: beer.shelfPerL,
      price: beer.shelfPrice,
      units: beer.shelfUnits,
      deal: beer.shelfDeal,
      rank: beer.rankShelf,
      kind: "",
    };
  }
  return {
    perL: beer.dealPerL,
    price: beer.dealPrice,
    units: beer.dealUnits,
    deal: beer.dealDeal,
    rank: beer.rankDeal,
    kind: beer.dealKind === "shelf" ? "" : beer.dealKind,
  };
}

function render(data) {
  const q = $("q").value.trim().toLowerCase();
  const style = $("style").value;
  const abv = $("abv").value;
  const dan = $("store-dan").checked;
  const ll = $("store-ll").checked;
  const mode = document.querySelector('input[name="mode"]:checked').value;

  const universe = data.beers.filter((beer) => {
    if (beer.store === "danmurphys" && !dan) return false;
    if (beer.store === "liquorland" && !ll) return false;
    return true;
  });

  const ranked = [...universe].sort((a, b) => {
    const ta = ticket(a, mode).perL;
    const tb = ticket(b, mode).perL;
    return ta - tb || a.name.localeCompare(b.name);
  });
  const rankOf = new Map(ranked.map((beer, i) => [`${beer.store}:${beer.sku}`, i + 1]));

  const shown = ranked.filter((beer) => {
    if (style && beer.style !== style) return false;
    if (!inAbvBand(beer, abv)) return false;
    if (q && !`${beer.name} ${beer.brand} ${beer.style}`.toLowerCase().includes(q)) {
      return false;
    }
    return true;
  });

  $("rows").innerHTML = shown
    .slice(0, 800)
    .map((beer) => {
      const t = ticket(beer, mode);
      const rank = rankOf.get(`${beer.store}:${beer.sku}`);
      const kind = kindLabel(t.kind);
      return `<tr>
        <td class="num rank">${rank}</td>
        <td><a href="${beer.url}" rel="noopener noreferrer">${beer.name}</a></td>
        <td class="store ${beer.store === "danmurphys" ? "dan" : "ll"}">${storeLabel(beer.store)}</td>
        <td>${beer.style || "—"}</td>
        <td class="num">${abvText(beer.abv)}</td>
        <td class="num"><strong>$${money(t.perL)}</strong></td>
        <td>$${money(t.price)} · ${t.deal}${kind ? `<span class="deal-kind">${kind}</span>` : ""}</td>
      </tr>`;
    })
    .join("");

  const extra = shown.length > 800 ? ` Showing first 800.` : "";
  $("count").textContent = `${shown.length} of ${universe.length} beers in this ranking.${extra}`;
}

function fillStyles(beers) {
  const set = [...new Set(beers.map((b) => b.style).filter(Boolean))].sort();
  const sel = $("style");
  for (const style of set) {
    const opt = document.createElement("option");
    opt.value = style;
    opt.textContent = style;
    sel.append(opt);
  }
}

let data;
try {
  const beersUrl = new URL("./beers.json", import.meta.url);
  beersUrl.searchParams.set("t", String(Date.now()));
  const res = await fetch(beersUrl, { cache: "no-store" });
  if (!res.ok) throw new Error(`beers.json HTTP ${res.status}`);
  data = await res.json();
} catch (err) {
  $("updated").textContent = "Could not load the beer list. Refresh the page.";
  $("count").textContent = String(err.message || err);
  throw err;
}
const when = new Date(data.updatedAt);
$("updated").textContent =
  `${data.beers.length} beers · updated ${when.toLocaleString("en-AU")} · ` +
  `${data.stores.danmurphys.count} Dan Murphy’s · ${data.stores.liquorland.count} Liquorland`;
fillStyles(data.beers);
render(data);

for (const id of ["q", "style", "abv", "store-dan", "store-ll"]) {
  $(id).addEventListener("input", () => render(data));
  $(id).addEventListener("change", () => render(data));
}
for (const el of document.querySelectorAll('input[name="mode"]')) {
  el.addEventListener("change", () => render(data));
}
