/* Combined Invoice for AliExpress - settings for companies, invoice texts and language. */
(async () => {
  'use strict';
  const S = globalThis.AliFaSettings;
  const I = globalThis.AliFaI18n;
  const $ = (id) => document.getElementById(id);
  let settings = await S.load();
  I.setLang(settings.lang);
  // no company yet (e.g. right after installation): show how to begin
  $('welcome').hidden = settings.profiles.some((p) => String(p.name || '').trim());

  const FIELDS = [
    ['name', 'opt.f.name', 'c6'],
    ['street', 'opt.f.street', 'c3'],
    ['city', 'opt.f.city', 'c3'],
    ['country', 'opt.f.country', 'c2'],
    ['ico', 'opt.f.ico', 'c2'],
    ['dic', 'opt.f.dic', 'c2'],
    ['icdph', 'opt.f.icdph', 'c2'],
  ];

  function esc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function applyTexts() {
    document.documentElement.lang = I.lang();
    I.apply(document);
    $('lang').innerHTML = I.langOptions(I.lang());
    $('docLang').innerHTML = I.langOptions(settings.invoiceLang || 'en');
    document.title = `${I.t('brand')} - ${I.t('opt.title')}`;
    try {
      $('version').textContent = 'v' + chrome.runtime.getManifest().version;
    } catch (e) {
      $('version').textContent = globalThis.ALIFA_VERSION ? 'v' + globalThis.ALIFA_VERSION : ''; // preview outside the extension
    }
  }

  function render() {
    $('profiles').innerHTML = settings.profiles.map((p, i) => `
      <div class="card" data-index="${i}">
        <div class="grid">
          ${FIELDS.map(([key, label, cls]) => `<label class="${cls}">${esc(I.t(label))}<input data-field="${key}" type="text" value="${esc(p[key])}"></label>`).join('')}
        </div>
        <div class="row">
          <label class="default"><input type="radio" name="default" value="${esc(p.id)}" ${p.id === settings.profileId ? 'checked' : ''}> ${esc(I.t('opt.default'))}</label>
          <span class="spacer"></span>
          <button type="button" class="btn danger" data-remove="${i}" ${settings.profiles.length < 2 ? 'disabled' : ''}>${esc(I.t('opt.remove'))}</button>
        </div>
      </div>`).join('');
    $('title').value = settings.title;
    $('prefix').value = settings.numberPrefix;
    $('supplier').value = settings.supplier;
    $('euNote').value = settings.euNote;
    $('euDefault').checked = settings.euDefault !== false;
    $('shipNote').value = settings.shipNote;
    $('shipNoteOn').checked = !!settings.shipNoteOn;
    $('invoiceNote').value = settings.invoiceNote || '';
    $('docLang').value = settings.invoiceLang || 'en';
  }

  function collect() {
    const profiles = [...document.querySelectorAll('#profiles .card')].map((card, i) => {
      const p = { id: settings.profiles[i].id };
      for (const [key] of FIELDS) p[key] = card.querySelector(`[data-field="${key}"]`).value.trim();
      return p;
    });
    const def = document.querySelector('input[name="default"]:checked');
    return Object.assign({}, settings, {
      profiles,
      profileId: def ? def.value : profiles[0].id,
      title: $('title').value.trim() || S.DEFAULTS.title,
      numberPrefix: $('prefix').value.trim() || S.DEFAULTS.numberPrefix,
      supplier: $('supplier').value.trim(),
      euNote: $('euNote').value.trim() || S.DEFAULTS.euNote,
      euDefault: $('euDefault').checked,
      shipNote: $('shipNote').value.trim() || S.DEFAULTS.shipNote,
      shipNoteOn: $('shipNoteOn').checked,
      invoiceNote: $('invoiceNote').value.trim(),
      invoiceLang: $('docLang').value || 'en',
      lang: I.lang(),
    });
  }

  function flash(text) {
    $('status').textContent = text;
    setTimeout(() => { if ($('status').textContent === text) $('status').textContent = ''; }, 3000);
  }

  // the language is saved right away, other changes only with the Save button
  $('lang').addEventListener('change', async (e) => {
    settings = collect();
    I.setLang(e.target.value);
    settings.lang = I.lang();
    applyTexts();
    render();
    const stored = await S.load();
    stored.lang = settings.lang;
    await S.save(stored);
  });
  $('docLang').addEventListener('change', async () => {
    settings = collect();
    const stored = await S.load();
    stored.invoiceLang = settings.invoiceLang;
    await S.save(stored);
  });
  $('add').addEventListener('click', () => {
    settings = collect();
    settings.profiles.push({ id: 'p' + Date.now().toString(36), name: '', street: '', city: '', country: '', ico: '', dic: '', icdph: '' });
    render();
  });
  $('profiles').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-remove]');
    if (!btn) return;
    settings = collect();
    const removed = settings.profiles.splice(Number(btn.dataset.remove), 1)[0];
    if (removed && removed.id === settings.profileId) settings.profileId = settings.profiles[0].id;
    render();
  });
  $('save').addEventListener('click', async () => {
    settings = collect();
    await S.save(settings);
    flash(I.t('opt.saved'));
  });
  // backup: companies and texts to a file and back (e.g. when reinstalling the extension)
  $('export').addEventListener('click', () => {
    const data = JSON.stringify(S.toExport(collect()), null, 2);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([data], { type: 'application/json' }));
    a.download = 'combined-invoice-settings.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });
  $('import').addEventListener('change', async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    let imported = null;
    try {
      imported = S.fromExport(JSON.parse(await file.text()));
    } catch (err) {
      imported = null;
    }
    if (!imported) {
      flash(I.t('opt.importFailed'));
      return;
    }
    settings = Object.assign({}, collect(), imported);
    if (imported.lang) I.setLang(imported.lang);
    settings.lang = I.lang();
    if (!settings.profiles.some((p) => p.id === settings.profileId)) settings.profileId = settings.profiles[0].id;
    applyTexts();
    render();
    await S.save(settings);
    flash(I.t('opt.imported'));
  });
  $('reset').addEventListener('click', () => {
    settings = Object.assign(JSON.parse(JSON.stringify(S.DEFAULTS)), { lang: I.lang() });
    render();
    flash(I.t('opt.resetDone'));
  });

  applyTexts();
  render();
})();
