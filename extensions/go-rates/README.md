# JourneyPerfect Go Rates (private Chrome extension)

Reads the Hilton rates **you** can see in your own signed-in Chrome and sends them to your
JourneyPerfect account, so Opportunities can compare Go Hilton (team member) rates with
public ones.

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
   extension never sees your credentials.
2. On JourneyPerfect, open an Opportunities search and click **Open Go rate tabs**.
3. A new, unfocused Chrome window opens. Its first tab shows run progress. Up to 3 Hilton
   searches open at a time (4 max), at least 3 seconds apart. Each tab closes after its rates
   are sent, or after 60 seconds if nothing usable shows up.
4. The toolbar badge shows `captured/total`, and the JourneyPerfect page updates as results
   arrive.

The popup also offers:

- **Capture this tab**: reads the Hilton tab you're looking at and files it under the current
  run's matching item (same check-in/check-out dates, else the first item not yet captured).
  Useful when a tab timed out, or when you browsed to a better page yourself.
- **Stop**: closes the run's tabs and stops opening new ones. Closing the run window does the
  same.
- **Debug: copy page snapshot**: see Troubleshooting.

Only one run happens at a time. Starting a new one from JourneyPerfect replaces the current run.

## Privacy

- It reads only `www.hilton.com` pages that the current run opened, plus any tab you explicitly
  click **Capture this tab** or **Debug** on.
- It sends only property names and codes, brand, coordinates, displayed prices, currency and
  rate labels (for example "Team Member Rate" or "strikethrough") to the JourneyPerfect address
  the run came from. JourneyPerfect, `www.journeyperfect.com` and `localhost:3000` are the only
  destinations the extension accepts.
- It never reads or sends cookies, passwords, account names, points balances, or anything from
  other sites. The run's token stays in session memory and is cleared when Chrome quits.
- Permissions: `tabs` and `storage`, plus host access to hilton.com and journeyperfect.com.
  It loads no remote code.

## How rates are classified

| What's on the card | Reported as |
| --- | --- |
| Price with "Team Member", "Go Hilton" or "TMTP" next to it | `PRIVATE_HILTON_GO`, labelled with that text |
| Strikethrough, "was", or "standard" price | `PUBLIC` |
| A single unlabelled price while signed in on a page with Go Hilton branding | `PRIVATE_HILTON_GO`, with `rateLabel` starting "inferred" |
| Anything else | `PUBLIC` |
| Any price while signed out | `PUBLIC`, with `rateLabel: "signed-out"` |

If Hilton's bot protection shows its "Access Denied" or "Reference #18.…" page, that item is
reported as `blocked` and the run stops opening tabs. Wait a while and try again later. The
extension does not try to get around a block.

## Troubleshooting

- **Nothing captured, or wrong prices**: open the Hilton results page in a normal tab, open the
  popup, click **Debug: copy page snapshot**, and paste the result to us. It contains the page
  URL (dates and property only), the page title, the selectors that matched, and the names,
  prices and labels the extractor found. It contains no cookies or account details.
- **"Not ready, reload the Hilton tab"**: the tab was open before the extension was installed or
  reloaded. Refresh it.
- **Every price is marked `signed-out`**: sign into Go Hilton in this Chrome profile and run the
  search again.
- **The run stopped with "capture rejected (401/403)"**: the run's token expired or belongs to a
  different account. Start the run again from JourneyPerfect.

## Development

- No build step. `lib/extract.js` holds every Hilton selector in one `SELECTORS` object and
  documents each one as an assumption. It runs both as a content script and in node.
- Tests: `node --test extensions/go-rates/test`. They cover the pure helpers, plan validation and
  the manifest. No DOM library is installed in the repo, so DOM walking is not unit-tested; the
  fixtures in `test/fixtures/` are hand-written approximations, not captured pages.
- Icons: `node extensions/go-rates/tools/make-icons.js`.
