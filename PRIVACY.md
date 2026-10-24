# Privacy policy - Combined Invoice for AliExpress

Last updated: 24 October 2026

Combined Invoice for AliExpress ("the extension") is a browser extension that combines AliExpress orders paid with one bank payment into one invoice. This policy explains which data it uses and where the data stays.

## Data the extension processes

- **Order data from your AliExpress account.** When you search by amount or create an invoice, the extension reads the order receipts of the orders on your AliExpress "My orders" page (order numbers, dates, items, quantities, prices, shipping, discounts, fees, taxes, the paid amount and the masked card number shown by AliExpress). It reads them through the AliExpress website you are signed in to, using your own session. Delivery addresses from the receipts are discarded and never stored.
- **Data you enter.** Your company details (name, address, company ID, tax ID, VAT ID), invoice texts and settings, and the bank amount and payment date you type in.

## Where the data is stored

All data stays in your browser:

- settings and the last created invoice in the extension's local storage (`chrome.storage.local`),
- the current order selection in the session storage of the AliExpress tab.

## What the extension does not do

- It does not send any data to the developer or to any third party. It has no server of its own.
- It does not use analytics, tracking or advertising.
- It does not sell or share data and does not use it for any purpose other than creating the invoice.

## Permissions

- `storage`: saves your settings and the last invoice locally in the browser.
- Access to the AliExpress "My orders" page (`aliexpress.com/p/order/index.html`): adds the selection panel and reads your order receipts.

## Deleting your data

Removing the extension in `chrome://extensions` deletes all data it stored. On the extension's settings page you can also restore the default settings at any time.

## Contact

Questions or problems: please open an issue at https://github.com/Dyonos/combined-invoice-for-aliexpress/issues
