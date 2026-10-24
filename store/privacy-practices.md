# Privacy practices - answers for the Chrome Web Store Developer Dashboard

Tab **Privacy practices** of the item.

## Single purpose

Combine selected AliExpress orders that were paid with one bank payment into one invoice whose total matches the payment.

## Permission justification

**storage**
Saves the user's company details (invoice recipient), invoice texts, language and the last created invoice locally in the browser (`chrome.storage.local`).

**Host permission** (content scripts on `https://*.aliexpress.com/p/order/index.html*`)
The extension runs only on the AliExpress "My orders" page. It adds checkboxes and a panel there and reads the order receipts of the signed-in user through the page's own AliExpress request library to build the invoice. It does not run on any other site.

## Remote code

No, I am not using remote code. All JavaScript is included in the package.

## Data usage

Check these categories:

- **Personally identifiable information** - company name, address and company/tax/VAT IDs that the user types in as the invoice recipient. Stored only locally.
- **Financial and payment information** - order amounts, prices, the paid amount and the masked card number from the AliExpress order receipts. Processed and stored only locally.
- **Website content** - order data read from the AliExpress "My orders" page and receipts.

Do not check: health information, authentication information, personal communications, location, web history, user activity.

Certify all three statements:

- I do not sell or transfer user data to third parties, outside of the approved use cases.
- I do not use or transfer user data for purposes that are unrelated to my item's single purpose.
- I do not use or transfer user data to determine creditworthiness or for lending purposes.

## Privacy policy URL

https://github.com/Dyonos/combined-invoice-for-aliexpress/blob/main/PRIVACY.md
