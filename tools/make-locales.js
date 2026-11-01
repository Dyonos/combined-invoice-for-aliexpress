// Generates _locales/<language>/messages.json (extension name and description in Chrome and the Web Store):
// node tools/make-locales.js
'use strict';
const fs = require('fs');
const path = require('path');
const I = require('../src/i18n.js');

// Chrome has no "pt", only pt_PT / pt_BR
const CHROME_LOCALE = { pt: 'pt_PT' };

const DESCRIPTION = {
  en: 'Combines selected AliExpress orders into one invoice whose total matches the bank payment.',
  sk: 'Spojí vybrané objednávky z AliExpressu do jednej faktúry, ktorej suma sedí s platbou z banky.',
  cs: 'Spojí vybrané objednávky z AliExpressu do jedné faktury, jejíž částka sedí s platbou z banky.',
  hu: 'A kiválasztott AliExpress-rendeléseket egy számlába egyesíti, amelynek összege egyezik a banki fizetéssel.',
  pl: 'Łączy wybrane zamówienia z AliExpress w jedną fakturę, której kwota zgadza się z płatnością z banku.',
  de: 'Fasst ausgewählte AliExpress-Bestellungen zu einer Rechnung zusammen, deren Betrag mit der Bankzahlung übereinstimmt.',
  es: 'Une los pedidos seleccionados de AliExpress en una factura cuyo total coincide con el pago bancario.',
  fr: 'Regroupe les commandes AliExpress sélectionnées en une facture dont le total correspond au paiement bancaire.',
  pt: 'Junta as encomendas selecionadas do AliExpress numa fatura cujo total corresponde ao pagamento bancário.',
  ru: 'Объединяет выбранные заказы AliExpress в один счёт, сумма которого совпадает с банковским платежом.',
  ro: 'Combină comenzile AliExpress selectate într-o singură factură al cărei total corespunde cu plata bancară.',
  it: 'Riunisce gli ordini AliExpress selezionati in un’unica fattura il cui totale corrisponde al pagamento bancario.',
  nl: 'Voegt geselecteerde AliExpress-bestellingen samen tot één factuur waarvan het totaal overeenkomt met de bankbetaling.',
  tr: 'Seçilen AliExpress siparişlerini, toplamı banka ödemesiyle eşleşen tek bir faturada birleştirir.',
  uk: 'Об’єднує вибрані замовлення AliExpress в один рахунок, сума якого збігається з банківським платежем.',
  ja: '選択したAliExpressの注文を、合計が銀行明細の金額と一致する1つの請求書にまとめます。',
  ko: '선택한 AliExpress 주문을 합계가 은행 거래 금액과 일치하는 하나의 인보이스로 합칩니다.',
};

const ACTION = {
  en: 'open My orders',
  sk: 'otvoriť Moje objednávky',
  cs: 'otevřít Moje objednávky',
  hu: 'Rendeléseim megnyitása',
  pl: 'otwórz Moje zamówienia',
  de: 'Meine Bestellungen öffnen',
  es: 'abrir Mis pedidos',
  fr: 'ouvrir Mes commandes',
  pt: 'abrir As minhas encomendas',
  ru: 'открыть «Мои заказы»',
  ro: 'deschideți Comenzile mele',
  it: 'apri I miei ordini',
  nl: 'Mijn bestellingen openen',
  tr: 'Siparişlerim sayfasını aç',
  uk: 'відкрити «Мої замовлення»',
  ja: '「私の注文」を開く',
  ko: '“내 주문” 열기',
};

const root = path.join(__dirname, '..', '_locales');
for (const { code } of I.LANGS) {
  const brand = I.STRINGS[code].storeName;
  const messages = {
    extName: { message: brand },
    extDescription: { message: DESCRIPTION[code] },
    actionTitle: { message: `${brand} - ${ACTION[code]}` },
  };
  const dir = path.join(root, CHROME_LOCALE[code] || code);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'messages.json'), JSON.stringify(messages, null, 2) + '\n');
  console.log(path.relative(path.join(__dirname, '..'), path.join(dir, 'messages.json')));
}
