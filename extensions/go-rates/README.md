# JourneyPerfect Go Rates (private Chrome extension)

Reads the Hilton and Marriott rates **you** can see in your own Chrome and sends them to your
JourneyPerfect account, so Opportunities can compare your private rates (Go Hilton team member,
Marriott Friends & Family) with public ones.

For every destination + dates it opens up to four tabs: **Hilton Go**, **Hilton public**,
**Marriott F&F** (the search with your F&F rate code) and **Marriott public** (the same search
without it). Go Hilton shows one price per hotel, so the public price has to come from its own
search; JourneyPerfect pairs the two by property code (Hilton ctyhocn, Marriott MARSHA code).

It is a convenience reader, not an automation or evasion tool. It opens normal tabs at a human
pace after you click a button, never clicks, types or scrolls on Hilton pages, never touches
cookies or passwords, and uses no fingerprinting or stealth tricks.

## Install

1. Open `chrome://extensions`.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and pick this folder (`extensions/go-rates`).
4. Pin "JourneyPerfect Go Rates" to the toolbar if you want to see the badge.

After pulling an update, click the reload icon on the extension's card, then refresh any open
JourneyPerfect and Hilton tabs.

## Use

1. Sign into Go Hilton in Chrome yourself, once (`https://www.hilton.com/en/go-hilton/`). The
   extension never sees your credentials. Marriott F&F uses the rate code configured in
   JourneyPerfect (`privateRates.marriott.rateCode`); sign in to Marriott too if your program needs it.
2. On JourneyPerfect, open an Opportunities search and click **Open Go rate tabs**.
3. A new, unfocused Chrome window opens. Its first tab shows run progress. Up to 3 searches open
   at a time (4 max), at least 3 seconds apart, 24 tabs per run at most. Each tab closes after
   its rates are sent, or after 60 seconds if nothing usable shows up.
4. The toolbar badge shows `captured/total`, and the JourneyPerfect page updates as results
   arrive.

The popup also offers:

- **Capture this tab**: reads the Hilton or Marriott tab you're looking at and files it under the
  current run's matching item for that site (same check-in/check-out dates, else the first item
  not yet captured; a tab you browsed to yourself is treated as the private search). Useful when
  a tab timed out, or when you browsed to a better page yourself.
- **Stop**: closes the run's tabs and stops opening new ones. Closing the run window does the
  same.
- **Debug: copy page snapshot**: see Troubleshooting.

Only one run happens at a time. Starting a new one from JourneyPerfect replaces the current run.

## Privacy

- It reads only `www.hilton.com` / `www.marriott.com` pages that the current run opened, plus any
  tab you explicitly click **Capture this tab** or **Debug** on.
- It sends only property names and codes, brand, coordinates, displayed prices, currency and
  rate labels (for example "Team Member Rate" or "strikethrough") to the JourneyPerfect address
  the run came from. JourneyPerfect, `www.journeyperfect.com` and `localhost:3000` are the only
  destinations the extension accepts.
- It never reads or sends cookies, passwords, account names, points balances, or anything from
  other sites. The run's token stays in session memory and is cleared when Chrome quits.
- Snapshots never include Marriott's `corporateCode` / `clusterCode` URL parameters.
- Permissions: `tabs` and `storage`, plus host access to hilton.com, marriott.com and
  journeyperfect.com.
  It loads no remote code.

## How rates are classified

The **tab's item** decides, not the page. Each card yields one observation from its cheapest
displayed price; strikethrough ("was") prices are ignored.

| Tab | Reported as |
| --- | --- |
| Hilton Go (PRIVATE) | `PRIVATE_HILTON_GO`, `rateLabel` = rate text next to the price, else "Go Hilton search" |
| Hilton Go while signed out | `PUBLIC`, `rateLabel: "signed-out"` |
| Marriott F&F (PRIVATE) | `PRIVATE_MARRIOTT_FF`, `rateLabel` = rate text next to the price, else "MMF search" |
| Hilton public / Marriott public | `PUBLIC`, `rateLabel: "public search"` |

The server enforces the same rule (a PUBLIC tab can only store PUBLIC rates; a PRIVATE tab stores
PUBLIC only for "signed-out" prices). If a brand's public search shows the same prices as the
private one (within $1 for 80% of hotels), JourneyPerfect treats that public search as unreliable
and claims no savings for it.

If Hilton's or Marriott's bot protection shows its "Access Denied", "Reference #18.…" or "We're
having trouble" page, that item is reported as `blocked` and the run stops opening tabs. Wait a
while and try again later. The extension does not try to get around a block.

### Search URLs

The URLs come from JourneyPerfect config (`privateRates.hilton.searchUrlTemplate`,
`privateRates.hilton.publicSearchUrlTemplate`, `privateRates.marriott.searchUrlTemplate`,
`privateRates.marriott.publicSearchUrlTemplate`). The defaults are best guesses; paste a real URL
from your own search with the values replaced by `{location}`, `{checkIn}`/`{checkOut}`
(YYYY-MM-DD), `{checkInMDY}`/`{checkOutMDY}` (MM/DD/YYYY), `{adults}`, `{lat}`, `{lng}` and
`{rateCode}`. A URL that is not https on the brand's own host falls back to the default.

## Troubleshooting

- **Nothing captured, or wrong prices**: open the Hilton results page in a normal tab, open the
  popup, click **Debug: copy page snapshot**, and paste the result to us. It contains the page
  URL (dates and property only), the page title, the selectors that matched, and the names,
  prices and labels the extractor found. It contains no cookies or account details.
- **"Not ready, reload the Hilton tab"**: the tab was open before the extension was installed or
  reloaded. Refresh it.
- **Every Hilton price is marked `signed-out`**: sign into Go Hilton in this Chrome profile and run
  the search again.
- **No Marriott tabs open**: your account needs the Marriott F&F entitlement and an admin must set
  `privateRates.marriott.rateCode`.
- **The run stopped with "capture rejected (401/403)"**: the run's token expired or belongs to a
  different account. Start the run again from JourneyPerfect.

## Development

- No build step. `lib/extract.js` holds every Hilton selector in `SELECTORS` and every Marriott
  selector in `MARRIOTT_SELECTORS`, each documented as an assumption. It runs both as a content
  script and in node. `content/hilton.js` and `content/marriott.js` are the same script with a
  different `BRAND`.
- Tests: `node --test 'extensions/go-rates/test/*.test.js'`. They cover the pure helpers, plan validation and
  the manifest, and walk the fixture pages through `test/mini-dom.js` (a tiny DOM, since no DOM
  library is installed). The fixtures in `test/fixtures/` (Hilton and Marriott) are hand-written
  approximations, not captured pages.
- Icons: `node extensions/go-rates/tools/make-icons.js`.
