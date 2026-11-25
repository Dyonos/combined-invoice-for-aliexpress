# Changelog

The version is in `manifest.json` and is shown in the panel header, on the invoice page and in the settings.

## 1.19.0 - 2026-11-25

- New short description in Chrome and the Chrome Web Store, in all 17 languages. It starts with the words people search for, such as "AliExpress invoice".
- After the third printed invoice, an installation from the Chrome Web Store asks once for a rating there. "Rate it" or "No, thanks" ends the request for good. Only the number of printed invoices is kept in the browser, and nothing is sent anywhere.

## 1.18.0 - 2026-11-25

- Changes right on the invoice: click a quantity, a unit price or the amount of a shipping, discount or fee line and type a new value. The line, the order total, the VAT (at the rate of the order) and the check against the bank amount are calculated again; the invoice number stays.
- Lines added by hand: "+ Item" and "+ Fee" under every order (a discount is a fee with a minus sign). They can be named and removed again, and shipping and fee lines can be renamed like item names.
- Changes stay with the invoice tab, also after a reload, and are in the CSV and ISDOC export. "Undo changes" puts everything back as on the receipts.
- The panel of the invoice page can be on the side (the default in wide windows), at the top or hidden. When it is hidden or scrolled away, a small bar with printing stays.

## 1.17.0 - 2026-11-23

- Several invoices in one PDF: under "Several payments at once", also for all orders of a period, "All invoices in one PDF" opens all prepared invoices on one page. Each invoice starts on a new printed page and keeps its own number and dates, the toolbar options apply to all of them, and the invoice numbers can be edited right on the invoices.
- Export for accounting on the invoice page: CSV with the lines and totals of the shown invoices, and ISDOC 6.0.2 electronic invoices (the Czech and Slovak standard), several invoices in one ZIP file. A credit note is exported as an ISDOC credit note.
- Invoices on one page with the same date and amount get different numbers.
- Older invoice drafts are also removed when they take up too much of the browser storage.

## 1.16.0 - 2026-11-23

- Credit notes for refunded orders: the invoice page switches to "Credit note" when an order has a refund.
- Invoice button next to every order and on the order detail page, for the invoice of one order.
- Invoices for all orders of a period, one per day or per order.
- Optional company logo, product images, stores, order status and order dates on the invoice; editable date of issue.
- The note "Compiled by the customer from AliExpress order receipts." is no longer printed (a footer note can still be set in the settings).

## 1.15.0 - 2026-11-01

- Several payments at once: paste amounts and dates from the bank statement (one payment per line), the extension finds the orders of each payment and opens one invoice per payment.
- Each invoice tab keeps its own data, so several invoices can be open at the same time.
- Store link in the README.

## 1.14.0 - 2026-11-01

- Amounts in the panel and on the invoice page use the currency of the orders (for example PLN, CZK, HUF or RON), not always euros. Amounts in lei are recognised.
- Interface and invoice in 17 languages: Romanian, Italian, Dutch, Turkish, Ukrainian, Japanese and Korean added.
- The invoice language is set separately from the interface, in the settings and on the invoice page. Default texts (title, notes) follow the invoice language.
- After installation the settings page opens with a short guide, and the panel points to Edit until a company is filled in.
- "Report a problem" link next to technical errors.
- `npm run check` checks the repository for personal data and runs before every `git push` (hook in `.githooks`).
- Store descriptions in all 17 languages.
- Page titles of the settings and the invoice page fixed.

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
