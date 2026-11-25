// Generates _locales/<language>/messages.json (extension name and description in Chrome and the Web Store):
// node tools/make-locales.js
'use strict';
const fs = require('fs');
const path = require('path');
const I = require('../src/i18n.js');

// Chrome has no "pt", only pt_PT / pt_BR
const CHROME_LOCALE = { pt: 'pt_PT' };

const DESCRIPTION = {
  en: 'AliExpress invoice for one or more orders: one combined invoice that matches your bank payment, as PDF, CSV or ISDOC.',
  sk: 'Faktúra z AliExpressu za jednu aj viac objednávok: jedna faktúra, ktorej suma sedí s platbou z banky, v PDF, CSV aj ISDOC.',
  cs: 'Faktura z AliExpressu za jednu i více objednávek: jedna faktura, jejíž částka sedí s platbou z banky, v PDF, CSV i ISDOC.',
  hu: 'AliExpress-számla egy vagy több rendelésről: egyetlen összesítő számla a banki fizetés összegével, PDF, CSV vagy ISDOC formátumban.',
  pl: 'Faktura AliExpress za jedno lub kilka zamówień: jedna zbiorcza faktura o kwocie zgodnej z płatnością z banku, w PDF, CSV lub ISDOC.',
  de: 'AliExpress-Rechnung für eine oder mehrere Bestellungen: eine Sammelrechnung, die zur Bankzahlung passt, als PDF, CSV oder ISDOC.',
  es: 'Factura de AliExpress para uno o varios pedidos: una factura conjunta cuyo total coincide con el pago bancario, en PDF, CSV o ISDOC.',
  fr: 'Facture AliExpress pour une ou plusieurs commandes : une facture groupée au montant du paiement bancaire, en PDF, CSV ou ISDOC.',
  pt: 'Fatura do AliExpress: uma ou mais encomendas numa só fatura cujo total corresponde ao pagamento bancário, em PDF, CSV ou ISDOC.',
  ru: 'Счёт AliExpress за один или несколько заказов: сводный счёт, сумма которого совпадает с банковским платежом, в PDF, CSV или ISDOC.',
  ro: 'Factură AliExpress pentru una sau mai multe comenzi: o factură combinată, cu totalul egal cu plata bancară, în PDF, CSV sau ISDOC.',
  it: 'Fattura AliExpress per uno o più ordini: un’unica fattura cumulativa con totale pari al pagamento bancario, in PDF, CSV o ISDOC.',
  nl: 'AliExpress-factuur voor één of meer bestellingen: één verzamelfactuur die klopt met je bankbetaling, als PDF, CSV of ISDOC.',
  tr: 'AliExpress faturası: bir veya birden fazla sipariş için, toplamı banka ödemesiyle eşleşen tek bir fatura (PDF, CSV veya ISDOC).',
  uk: 'Рахунок AliExpress за одне чи кілька замовлень: один зведений рахунок, що збігається з банківським платежем, у PDF, CSV або ISDOC.',
  ja: 'AliExpressの請求書を作成。1件または複数の注文を、合計が銀行明細の金額と一致する1つの請求書にまとめ、PDF・CSV・ISDOC形式で出力できます。',
  ko: 'AliExpress 인보이스: 주문 한 건 또는 여러 건을 합계가 은행 거래 금액과 일치하는 하나의 인보이스로 합쳐 PDF, CSV, ISDOC 형식으로 내보낼 수 있습니다.',
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
