# Decklist Auto-Filler

A browser extension that fills Yu-Gi-Oh! deck list forms for you. Build your deck on a simulator, paste its YDKE link or choose its .ydk file, press **Fill deck list**, and every card goes into the site's own form.

**Install:** [Chrome Web Store](https://chromewebstore.google.com/detail/decklist-auto-filler/knjanhkpoicpjebbkpcnbinkbdhhpfld) · [Firefox Add-ons](https://addons.mozilla.org/firefox/addon/decklist-auto-filler/) (desktop and Android) · [Download a release](https://github.com/ObjectOrientedCodeTalker/decklistautofiller/releases)

## Where it works

- **The Side Deck** (events.thesidedeck.com), on the deck list editor
- **Konami's tournament registration site** (registration.yugioh-card.com), for standard and Genesys deck lists
- **Konami's Neuron card database** (db.yugioh-card.com), on the deck builder

The extension runs only on those deck editor pages. It fills in the form and nothing more: you still verify and submit your deck list on the appropriate site as usual.

## What it does

- Reads a YDKE link or a .ydk file from Duelingbook, EDOPro, YGO Omega and other simulators.
- Replaces the cards already on the list, or adds to them.
- Checks your Main, Extra and Side Deck counts against your deck when it finishes.
- Lists any card it couldn't add, so you can add it by hand, with a link to report it.
- Shows the deck as card images, kept in sync as the list changes.
- Clears a whole deck list in one step.

Card names, Konami IDs and images come from [decklistautofiller_api](https://github.com/ObjectOrientedCodeTalker/decklistautofiller_api), which updates daily as new sets release. A card the extension couldn't add can be reported there as an issue.

## Installing from a release

The Chrome Web Store or Firefox Add-ons is the easiest way to install, and keeps the extension up to date. To install a specific version yourself instead:

1. Open [Releases](https://github.com/ObjectOrientedCodeTalker/decklistautofiller/releases) and download `decklist-auto-filler-<version>.zip` from the version you want. The changes in each version are listed on its release and in [CHANGELOG.md](CHANGELOG.md).
2. Unzip it into a folder you'll keep. The browser loads the extension from that folder, so don't delete it.
3. Load the folder:
   - **Chrome:** open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked** and choose the folder.
   - **Firefox:** open `about:debugging`, go to **This Firefox**, click **Load Temporary Add-on** and choose `manifest.json` in the folder. Firefox removes it when it restarts.

An extension installed this way doesn't update itself: download the new release and load it again.

## Building from source

Load this folder the same way as an unzipped release. To build the zip, run `node tools/package.mjs` (Node 18 or newer). It writes `dist/decklist-auto-filler-<version>.zip`, which works for both Chrome and Firefox. Pushing a version tag (`v2.1.0`) builds the zip and publishes it as a release.

## License

[MIT](LICENSE). This covers the extension's code only: card names and images belong to Konami.

## Disclaimer

Not affiliated with or endorsed by Konami, The Side Deck, Duelingbook, EDOPro or YGO Omega. Yu-Gi-Oh! is a trademark of Konami.
