/*
 * Receipts in the shape AliExpress returns them (queryOrderReceiptInfo). Order numbers, titles and stores are made up.
 * No delivery address, card number masked. Used by the tests and by the invoice.html preview outside the extension.
 */
(function (root) {
  const card = (amount, date) => ({
    cardNo: '************0000',
    methodCode: 'MIXEDCARD',
    methodName: 'Card',
    paymentAmount: amount,
    paymentAmountStr: 'EUR ' + amount,
    paymentDate: date,
  });

  // Payment of €37.70 on 16 Aug 2026: three orders from one checkout.
  const payment3770 = [
    {
      orderId: '1000000000010001',
      orderTime: 'Aug 16, 2026',
      itemsTotal: '€ 8,16',
      shippingFee: '€ 1,99',
      totalDiscountAmount: '€ 1,55',
      allDiscount: '€ 1,55',
      totalReceivableTaxAmount: '€ 3,69',
      includedTaxDisplay: '€ 2,30',
      orderTotal: '€ 12,29',
      paymentInfo: card('12.29', 'Aug 16, 2026'),
      subOrders: [{
        amount: '€ 8,16',
        itemCount: 1,
        itemTitle: 'Screwdriver bit set, 24 pcs, magnetic',
        relateInfo: 'Set A',
        sellerName: 'Example Tools Store',
      }],
    },
    {
      orderId: '1000000000010002',
      orderTime: 'Aug 16, 2026',
      itemsTotal: '€ 8,31',
      shippingFee: '€ 0,78',
      totalDiscountAmount: '€ 1,57',
      allDiscount: '€ 1,57',
      totalReceivableTaxAmount: '€ 3,69',
      includedTaxDisplay: '€ 2,09',
      orderTotal: '€ 11,21',
      paymentInfo: card('11.21', 'Aug 16, 2026'),
      subOrders: [{
        amount: '€ 8,31',
        itemCount: 1,
        itemTitle: 'Water tank float replacement for robot vacuum, 6 pcs',
        relateInfo: 'Transparent White',
        sellerName: 'Example Parts Store',
      }],
    },
    {
      orderId: '1000000000010003',
      orderTime: 'Aug 16, 2026',
      itemsTotal: '€ 10,14',
      shippingFee: '€ 2,45',
      totalDiscountAmount: '€ 2,08',
      allDiscount: '€ 2,08',
      totalReceivableTaxAmount: '€ 3,69',
      includedTaxDisplay: '€ 2,65',
      orderTotal: '€ 14,20',
      paymentInfo: card('14.20', 'Aug 16, 2026'),
      subOrders: [{
        amount: '€ 3,38',
        itemCount: 3,
        itemTitle: 'Nickel strip for 18650 battery welding',
        relateInfo: '18650 0.15x23x18.5mm,2M',
        sellerName: 'Example Battery Store',
      }],
    },
  ];

  // Order with a discount on import charges: the group and its sub-line have the same amount,
  // the sub-line must not be counted a second time.
  const subsidy = {
    orderId: '1000000000020001',
    orderTime: 'Sep 27, 2026',
    itemsTotal: '€ 33,30',
    shippingFee: '€ 0,00',
    totalReceivableTaxAmount: '€ 3,22',
    totalSubsidyTaxAmount: '-€ 1,99',
    mergeTaxDiscountAmount: '-€ 1,99',
    includedTaxDisplay: '€ 6,46',
    orderTotal: '€ 34,53',
    paymentInfo: card('34.53', 'Sep 27, 2026'),
    subOrders: [{
      amount: '€ 16,65',
      itemCount: 2,
      itemTitle: 'Fan module for robot vacuum cleaner',
      relateInfo: 'Type D',
      sellerName: 'Example Home Store',
    }],
  };

  // AliExpress lists €0.01 shipping on the receipt but leaves it out of the order total
  // (18.70 + 0.01 + 3.69 = 22.40, paid by card 22.39).
  const pennyShipping = {
    orderId: 'okt20-a',
    orderTime: 'Oct 20, 2026',
    itemsTotal: '€ 18,70',
    shippingFee: '€ 0,01',
    totalReceivableTaxAmount: '€ 3,69',
    includedTaxDisplay: '€ 4,18',
    orderTotal: '€ 22,39',
    paymentInfo: card('22.39', 'Oct 20, 2026'),
    subOrders: [{ amount: '€ 3,74', itemCount: 5, itemTitle: 'Mini water pump 5V', relateInfo: '1 W', sellerName: 'Example Pump Store' }],
  };

  // Goods from an EU warehouse: no import charges, VAT is included but the receipt gives no VAT amount.
  const euWarehouse = {
    orderId: 'sep27-d',
    orderTime: 'Sep 27, 2026',
    itemsTotal: '€ 59,42',
    shippingFee: '€ 11,64',
    includeTax: 'true',
    orderTotal: '€ 71,06',
    paymentInfo: card('71.06', 'Sep 27, 2026'),
    subOrders: [{ amount: '€ 59,42', itemCount: 1, itemTitle: 'Scooter controller', relateInfo: '', sellerName: 'Example EU Store' }],
  };

  // Order list as the panel reads it from the page (the "Total" amount of each order).
  // The ids are only descriptive.
  const orderList = [
    { id: 'okt20-a', cents: 2239, date: '2026-10-20' },
    { id: 'okt19-a', cents: 2177, date: '2026-10-19' },
    { id: 'okt19-b', cents: 3578, date: '2026-10-19' },
    { id: 'okt19-c', cents: 1225, date: '2026-10-19' },
    { id: 'sep30-a', cents: 4653, date: '2026-09-30' },
    { id: 'sep27-a', cents: 3453, date: '2026-09-27' },
    { id: 'sep27-b', cents: 655, date: '2026-09-27' },
    { id: 'sep27-c', cents: 2735, date: '2026-09-27' },
    { id: 'sep27-d', cents: 7106, date: '2026-09-27' },
    { id: 'sep27-e', cents: 4115, date: '2026-09-27' },
    { id: 'aug16-a', cents: 1229, date: '2026-08-16' },
    { id: 'aug16-b', cents: 1121, date: '2026-08-16' },
    { id: 'aug16-c', cents: 1420, date: '2026-08-16' },
  ];

  const fixtures = {
    payment3770,
    subsidy,
    pennyShipping,
    euWarehouse,
    orderList,
    demoDraft: {
      createdAt: '2026-10-24T10:00:00.000Z',
      bankCents: 3770,
      receipts: payment3770,
      listTotals: { '1000000000010001': 1229, '1000000000010002': 1121, '1000000000010003': 1420 },
    },
  };

  if (typeof module === 'object' && module.exports) module.exports = fixtures;
  else root.ALIFA_FIXTURES = fixtures;
})(typeof globalThis !== 'undefined' ? globalThis : this);
