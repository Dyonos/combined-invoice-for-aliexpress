# Publishing in the Chrome Web Store

Steps for the maintainer. The texts and answers are ready in this folder, copy them from here.

## 1. Package

```
npm test
node tools/build-store.js
```

This creates `dist/combined-invoice-for-aliexpress-<version>.zip`. Before packaging, the script checks that the
default settings contain no company and that no file contains a string from the denylist
(`../ali-faktura-denylist.txt` outside the repository, or the path in the `ALIFA_DENYLIST` variable).

## 2. Developer account (once)

1. Open https://chrome.google.com/webstore/devconsole and sign in with the Google account that will own the extension.
2. Pay the one-time registration fee (5 USD), confirm the contact e-mail and verify your identity if Google asks for it.
3. Declare whether you are a trader under EU rules. For a free extension that sells nothing this is usually "non-trader". The store shows the contact details of traders.

## 3. New item

In the Developer Dashboard click **Add new item** and upload the ZIP from step 1.

### Store listing

Copy from `store/listing.md`:

- the description (English, used for all languages),
- category **Productivity > Tools**,
- icon `store/icon-store-128.png`,
- screenshots `store/screenshots/*.png` (1280 x 800),
- small promo tile `store/promo-440x280.png`,
- homepage and support URLs (the GitHub repository).

The name and the short description come from the extension itself (`_locales`).

### Privacy practices

Copy the answers from `store/privacy-practices.md` (single purpose, permission justification, no remote code,
data categories and the three certifications). Privacy policy URL:
https://github.com/Dyonos/combined-invoice-for-aliexpress/blob/main/PRIVACY.md

### Distribution

- Visibility: **Public**
- Regions: all
- Price: free

## 4. Submit for review

Click **Submit for review**. The review usually takes a few days and the result comes by e-mail. After approval, add
the store link to the README (section Install).

## 5. New version

1. Raise the version in `manifest.json` and `package.json` and add the change to `CHANGELOG.md`.
2. Run `npm test` and `node tools/build-store.js`.
3. In the Dashboard open the item, **Package > Upload new package**, then **Submit for review** again.

When the look changes, regenerate the screenshots with `node tools/make-store-images.js`.
