# Factdock for Obsidian

Search primary sources on any country's web — in your own language — without leaving Obsidian, and put each result into your notes with its source.

Factdock is a multilingual search engine for primary sources (109 languages). It searches a country's web in that country's own language and shows you the original pages: government notices, official records, research papers. This plugin brings that search into Obsidian.

## What it does

- **Factdock: Search** (command palette) or the search icon in the ribbon. Select text in a note first to use it as the search terms.
- Choose the **country** to search and the **language** for the results. Factdock never guesses the country.
- See the **price before every search**. No credits are used until you press *Search*.
- Results appear in the right sidebar. For each result:
  - **Insert into note** — adds the result at the cursor as a citation callout with its link, publisher and date.
  - **New note** — creates one note per result, with the source in its properties (`url`, `publisher`, `published`, `original_language`, `query`, `country`, `retrieved`).
  - **Open original** — opens the source page.
- Titles, links, publishers and dates are inserted exactly as Factdock returned them.

Tools in this version: Standard search (web, by country or language sphere) and Academic search. This version runs on Obsidian for desktop. The interface follows Obsidian's language (38 languages).

## Setup

1. Sign in to [Factdock](https://fact-dock.com) and open the **API** page.
2. Issue a **personal API key** (paid plans). It starts with `fdu_` and is shown only once.
3. In Obsidian: **Settings → Community plugins → Factdock**, paste the key and press **Check**.

## Network use

This plugin sends your search terms and the options you chose to Factdock (`https://fact-dock.com/mcp`) **only when you start a search**, and asks Factdock for the current price before a search. Nothing else from your vault is sent. The plugin has no telemetry.

## Account

A Factdock account on a **paid plan** and a personal API key are required.

## Payment

Each search uses credits from your Factdock plan. **The price is shown before every search** and no credits are used until you confirm. Saving results into notes is free. Daily limits and automatic refunds when Factdock fails are the same as for Factdock's API.

Factdock only searches and shows published information for reference. It is not legal, medical, veterinary, financial or investment advice.

## Privacy

See Factdock's privacy policy: https://fact-dock.com/en/legal/privacy/

## License

MIT
