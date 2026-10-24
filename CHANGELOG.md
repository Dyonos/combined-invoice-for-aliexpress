# Changelog

The version is in `manifest.json` and is shown in the panel header, on the invoice page and in the settings.

## 1.13.0 - 2026-10-24

- Public release preparation: new name "Combined Invoice for AliExpress" (localized in 10 languages), no personal data in the defaults, empty customer company to fill in.
- Settings backup: export and import of settings (companies, texts, language) as a JSON file.
- Optional note at the bottom of the invoice (default: "Compiled by the customer from AliExpress order receipts.").
- Chrome Web Store package script with a personal-data check, store listing texts, privacy policy and screenshots.

## 1.12.0 - 2026-10-24

- Interface in 10 languages (English by default, Slovak, Czech, Hungarian, Polish, German, Spanish, French, Portuguese, Russian), switchable in the panel, on the invoice page and in the settings. The invoice itself stays in English.

## 1.11.0

- "Shipping without tracking" adds "(no tracking)" to the "Shipping and fees" line.

## 1.10.0

- With a payment date, search by amount fills in orders that AliExpress skipped in the order list (orders of one checkout have consecutive numbers).
- "Shipping without tracking" option; both invoice options remember their last state.

## 1.9.0

- Add an order by its number (e.g. from the confirmation e-mail) even if the order list does not show it.

## 1.8.0

- Optional payment date for search by amount; also tries 1 to 3 days earlier.

## 1.7.0

- "Shipped from an EU warehouse" option can be on by default.

## 1.6.0

- "EU Stock" is added to the item variant line.

## 1.5.0

- Search by amount loads older orders by itself and only combines orders from one day.

## 1.4.0

- PDF without browser header and footer, page numbers only.

## 1.3.0

- "Shipping and fees" label, EU warehouse note per order.

## 1.2.0

- Removed VAT breakdowns from the invoice lines.

## 1.1.0

- Version shown in the panel, company selection in the panel, invoice in English with the AliExpress operator as supplier, payment and issue date = order date.

## 1.0.0

- First version: checkboxes on "My orders", bank amount, search by amount, invoice from the official order receipts with totals that match to the cent.
