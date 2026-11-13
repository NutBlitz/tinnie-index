# Tinnie Index

Australia’s cheapest listed beer and spirits, ranked by dollars per litre.

Unofficial. Independent. Public domain ([Unlicense](LICENSE)). Not affiliated with Dan Murphy’s, Liquorland, BWS, Endeavour Group, or Untappd.

## What it does

- Pulls the public beer and spirits catalogues from Dan Murphy’s, Liquorland, and BWS (no login).
- Converts pack and case tickets into **$/L**.
- Uses Dan Murphy’s **member** prices and Liquorland / BWS **multi-buys** when they beat the shelf.
- Shows Untappd community ratings when a drink can be matched, otherwise the retailer’s own reviews.
- Serves a static site you can host on GitHub Pages.

Rank is among the drink type you picked and the stores you ticked, not just the current search.

## Run it locally

Needs Node 20+.

```bash
npm start
```

Open [http://localhost:4173](http://localhost:4173).

Refresh prices (from an Australian IP if the retailers block the cloud):

```bash
npm run refresh
```

That writes `data/beers.json` and `public/beers.json`.

## Put it on GitHub

From this folder, after `gh` is installed and logged in:

```bash
git add .
git commit -m "Launch Tinnie Index"
gh repo create tinnie-index --public --source=. --remote=origin --push
gh api -X POST repos/{owner}/tinnie-index/pages -f build_type=workflow
```

Then in the repo: **Settings → Pages → Source → GitHub Actions**. The `pages.yml` workflow publishes `public/`. Share `https://<you>.github.io/tinnie-index/`.

## Daily refresh

`.github/workflows/refresh.yml` runs once a day, tries to re-fetch both catalogues, and deploys `public/` to GitHub Pages.

Retailer APIs often block datacentre IPs. If the Action fails, the last good snapshot stays live. Run `npm run refresh` on a home connection and push.

## Prices can be wrong

Listings are parsed, not purchased. Confirm on the retailer site before you drive.

## License

This is free and unencumbered software released into the public domain. See [LICENSE](LICENSE).
