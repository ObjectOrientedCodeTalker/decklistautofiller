# Decklist Auto-Filler

A browser extension that fills Yu-Gi-Oh! deck list forms for you. Build your deck on a simulator, paste its YDKE link or choose its .ydk file, press **Fill deck list**, and every card goes into the site's own form.

**Install:** [Chrome Web Store](https://chromewebstore.google.com/detail/decklist-auto-filler/knjanhkpoicpjebbkpcnbinkbdhhpfld)

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

## Running it from this folder

**Chrome:** open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked** and choose this folder.

**Firefox:** open `about:debugging`, go to **This Firefox**, click **Load Temporary Add-on** and choose `manifest.json`.

To build the zip for the stores, run `node tools/package.mjs` (Node 18 or newer). It writes `dist/decklist-auto-filler-<version>.zip`, which works for both Chrome and Firefox.

## License

[MIT](LICENSE). This covers the extension's code only: card names and images belong to Konami.
## Disclaimer

Not affiliated with or endorsed by Konami, The Side Deck, Duelingbook, EDOPro or YGO Omega. Yu-Gi-Oh! is a trademark of Konami.
