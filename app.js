const ABV = {
  zero: [0, 0.5],
  low: [0.5, 3.5],
  mid: [3.5, 4.4],
  full: [4.4, 6],
  strong: [6, 99],
};

const STORES = {
  danmurphys: { label: "Dan Murphy’s", box: "store-dan", cls: "dan" },
  liquorland: { label: "Liquorland", box: "store-ll", cls: "ll" },
  bws: { label: "BWS", box: "store-bws", cls: "bws" },
};

const $ = (id) => document.getElementById(id);

function money(n) {
  return Number(n).toFixed(2);
}

function abvText(v) {
  return v == null ? "—" : `${v}%`;
}

function storeLabel(store) {
  return STORES[store]?.label || store;
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
      chg: beer.chgShelf7,
      histKey: "shelf",
    };
  }
  return {
    perL: beer.dealPerL,
    price: beer.dealPrice,
    units: beer.dealUnits,
    deal: beer.dealDeal,
    rank: beer.rankDeal,
    kind: beer.dealKind === "shelf" ? "" : beer.dealKind,
    chg: beer.chgDeal7,
    histKey: "deal",
  };
}

function chgKind(chg) {
  if (chg == null || Math.abs(chg) < 0.05) return "";
  return chg < 0 ? "down" : "up";
}

function inChgFilter(chg, filter) {
  if (!filter) return true;
  const kind = chgKind(chg);
  if (filter === "down") return kind === "down";
  if (filter === "up") return kind === "up";
  if (filter === "unchanged") return !kind;
  return true;
}

function fmtDay(d) {
  const [, m, day] = String(d).split("-");
  return `${Number(day)}/${Number(m)}`;
}

function chgTitle(hist, key, today) {
  if (!Array.isArray(hist) || hist.length < 2) return "";
  return hist
    .slice(0, -1)
    .map((p) => {
      const delta = moneyRound(today - p[key]);
      const kind = chgKind(delta);
      const arrow = kind === "down" ? "↓" : kind === "up" ? "↑" : "·";
      const mag = kind ? ` ${arrow}$${money(Math.abs(delta))}` : " same";
      return `${fmtDay(p.d)} $${money(p[key])} → today $${money(today)}${mag}`;
    })
    .join("\n");
}

function moneyRound(n) {
  return Math.round(n * 100) / 100;
}

function chgCell(chg, hist, key, today) {
  const kind = chgKind(chg);
  const title = chgTitle(hist, key, today);
  const attr = title ? ` title="${title.replaceAll('"', "&quot;")}"` : "";
  if (!kind) return `<td class="num chg muted"${attr}>—</td>`;
  const arrow = kind === "down" ? "↓" : "↑";
  const days = Array.isArray(hist) && hist.length ? `${fmtDay(hist[0].d)}–${fmtDay(hist.at(-1).d)}` : "7d";
  return `<td class="num chg ${kind}"${attr}>${arrow}$${money(Math.abs(chg))}<small>${days}</small></td>`;
}

function render(data) {
  const q = $("q").value.trim().toLowerCase();
  const style = $("style").value;
  const abv = $("abv").value;
  const chg = $("chg").value;
  const mode = document.querySelector('input[name="mode"]:checked').value;
  const on = {};
  for (const [id, meta] of Object.entries(STORES)) {
    on[id] = $(meta.box).checked;
  }

  const universe = data.beers.filter((beer) => on[beer.store]);

  const ranked = [...universe].sort((a, b) => {
    const ta = ticket(a, mode).perL;
    const tb = ticket(b, mode).perL;
    return ta - tb || a.name.localeCompare(b.name);
  });
  const rankOf = new Map(ranked.map((beer, i) => [`${beer.store}:${beer.sku}`, i + 1]));

  const shown = ranked.filter((beer) => {
    if (style && beer.style !== style) return false;
    if (!inAbvBand(beer, abv)) return false;
    if (!inChgFilter(ticket(beer, mode).chg, chg)) return false;
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
      const moved = chgKind(t.chg);
      return `<tr class="${moved ? `moved-${moved}` : ""}">
        <td class="num rank">${rank}</td>
        <td><a href="${beer.url}" rel="noopener noreferrer">${beer.name}</a></td>
        <td class="store ${STORES[beer.store]?.cls || ""}">${storeLabel(beer.store)}</td>
        <td>${beer.style || "—"}</td>
        <td class="num">${abvText(beer.abv)}</td>
        <td class="num"><strong>$${money(t.perL)}</strong></td>
        ${chgCell(t.chg, beer.hist, t.histKey, t.perL)}
        <td>$${money(t.price)} · ${t.deal}${kind ? `<span class="deal-kind">${kind}</span>` : ""}</td>
      </tr>`;
    })
    .join("");

  const extra = shown.length > 800 ? ` Showing first 800.` : "";
  $("count").textContent = `${shown.length} of ${universe.length} beers in this ranking.${extra}`;
  labelChgOptions(universe, mode);
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

function storeCounts(data) {
  return Object.keys(STORES)
    .map((id) => `${data.stores?.[id]?.count ?? 0} ${STORES[id].label}`)
    .join(" · ");
}

function moveCounts(beers, mode) {
  let down = 0;
  let up = 0;
  for (const beer of beers) {
    const kind = chgKind(ticket(beer, mode).chg);
    if (kind === "down") down++;
    if (kind === "up") up++;
  }
  return { down, up };
}

function labelChgOptions(beers, mode) {
  const { down, up } = moveCounts(beers, mode);
  const sel = $("chg");
  for (const opt of sel.options) {
    if (opt.value === "down") opt.textContent = `Dropped (${down})`;
    if (opt.value === "up") opt.textContent = `Rose (${up})`;
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
const moves = moveCounts(data.beers, "deal");
$("updated").textContent =
  `${data.beers.length} beers · updated ${when.toLocaleString("en-AU")} · ` +
  storeCounts(data) +
  ` · ${moves.down} dropped / ${moves.up} rose this week`;
fillStyles(data.beers);
render(data);

for (const id of ["q", "style", "abv", "chg", "store-dan", "store-ll", "store-bws"]) {
  $(id).addEventListener("input", () => render(data));
  $(id).addEventListener("change", () => render(data));
}
for (const el of document.querySelectorAll('input[name="mode"]')) {
  el.addEventListener("change", () => render(data));
}
