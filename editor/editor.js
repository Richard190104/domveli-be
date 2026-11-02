'use strict';

const REMOTE_URL = 'https://richard190104.github.io/domveli-be/config.json';
const labels = {
  categories: 'Kategórie', banners: 'Promo bannery', sets: 'Výhodné sety', footer: 'Pätička',
  favorites: 'Obľúbené produkty', deals: 'Výhodná ponuka', featuredProduct: 'Hlavný produkt', badge: 'Štítok (ribbon)',
  notificationsConfig: 'Popup notifikácie', navbannerConfig: 'Horné bannery',
  id: 'Identifikátor', name: 'Názov', title: 'Nadpis', subtitle: 'Podnadpis',
  kicker: 'Text nad nadpisom', uptitle: 'Text nad nadpisom', description: 'Popis',
  image: 'Obrázok', images: 'Obrázky', url: 'Odkaz', link: 'Odkaz', links: 'Odkazy',
  button: 'Text tlačidla', buttonText: 'Text tlačidla', linkText: 'Text odkazu',
  products: 'Produkty', price: 'Cena',
  oldPrice: 'Pôvodná cena', discount: 'Zľava', activeFrom: 'Aktívne od', activeTo: 'Aktívne do'
};
let config;
let activePath;
let dirty = false;
let directory;
// Obrázky ostávajú v pamäti stránky až do publikovania.
const memoryFiles = new Map();
function memoryDirectory(prefix = '') {
  return {
    queryPermission: async () => 'granted',
    getDirectoryHandle: async name => {
      if (name !== 'images' || prefix) throw new Error('Neplatný priečinok.');
      return memoryDirectory('images/');
    },
    getFileHandle: async name => ({
      getFile: async () => {
        const blob = memoryFiles.get(prefix + name);
        if (!blob) { const error = new Error('Súbor neexistuje.'); error.name = 'NotFoundError'; throw error; }
        return blob;
      },
      createWritable: async () => ({
        write: async content => { memoryFiles.set(prefix + name, content instanceof Blob ? content : new Blob([content])); },
        close: async () => {}, abort: async () => {}
      })
    }),
    removeEntry: async name => { memoryFiles.delete(prefix + name); }
  };
}
let fileQueue = Promise.resolve();
let fileError;
let busyUploads = 0;
let publishing = false;
let deploymentFailed = false;
let pendingCommit;
let reloadAfterClose = false;
function lockInterface(locked) {
  ['header','aside','main'].forEach(tag => { const node = document.querySelector(tag); if (node) node.inert = locked; });
  $('app').classList.toggle('locked', locked);
}
let deploymentTimer;
function startDeploymentTimer() {
  clearInterval(deploymentTimer);
  const started = Date.now();
  const update = () => {
    const seconds = Math.floor((Date.now()-started)/1000);
    $('deployment-timer').textContent = `${String(Math.floor(seconds/60)).padStart(2,'0')}:${String(seconds%60).padStart(2,'0')}`;
  };
  update(); deploymentTimer = setInterval(update,1000);
}
let managedImages = new Set();
const assets = new Map();
const $ = id => document.getElementById(id);
const clone = value => JSON.parse(JSON.stringify(value));
const at = path => path.reduce((value, key) => value[key], config);
const set = (path, value) => { at(path.slice(0, -1))[path.at(-1)] = value; changed(); };
function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

// Vysvetlivky: popis sekcií (riadok pod nadpisom) a polí (tooltip pri označení).
const SECTION_HINTS = {
  categories: 'Posuvný zoznam kariet kategórií na domovskej stránke. Každá karta vedie do kategórie v e-shope. Nadpisy a texty sekcií sú priamo v Shoptete.',
  footer: 'Krátky popis značky v pätičke webu.',
  banners: 'Tri promo bannery na domovskej stránke: jeden veľký (môže mať viac snímok, ktoré sa striedajú) a dva menšie. Počet a poradie určuje web.',
  sets: 'Karty produktov v posuvnom zozname Výhodné sety. Nadpis a úvod sekcie sú v Shoptete.',
  favorites: 'Posuvný zoznam Obľúbené produkty. Ako prvá karta sa zobrazí Hlavný produkt (väčšia, s ribbonom).',
  deals: 'Karty produktov v posuvnom zozname Výhodná ponuka. Nadpis a úvod sekcie sú v Shoptete.',
  featuredProduct: 'Zvýraznený produkt na začiatku Obľúbených produktov: väčšia karta s ribbonom.',
  notificationsConfig: 'Vyskakovacie oznámenia (popup) pre návštevníkov. Zobrazujú sa len v nastavenom období.',
  navbannerConfig: 'Pás s oznámením úplne hore na stránke.'
};
const FIELD_HINTS = {
  id: 'Interný identifikátor položky. Zákazníkom sa nezobrazuje, bez dôvodu ho nemeň.',
  name: 'Názov, ktorý sa zobrazí na karte.',
  title: 'Nadpis, ktorý sa zobrazí zákazníkom.',
  subtitle: 'Menší text pod nadpisom sekcie.',
  kicker: 'Krátky text nad nadpisom, zvyčajne veľkými písmenami.',
  uptitle: 'Krátky text nad nadpisom, zvyčajne veľkými písmenami.',
  description: 'Popisný text pod nadpisom.',
  image: 'Obrázok. Vyber súbor a nahrá sa automaticky (JPEG a PNG sa zmenšia a prevedú na WebP). Adresa sa nastaví sama.',
  images: 'Obrázky snímok. Vyber súbor a nahrá sa automaticky. Adresa sa nastaví sama.',
  url: 'Kam vedie kliknutie. Interný odkaz píš s lomkou na začiatku, napríklad /svetelne-zavesy/.',
  link: 'Kam vedie kliknutie. Interný odkaz píš s lomkou na začiatku, napríklad /svetelne-zavesy/.',
  links: 'Kam vedie kliknutie. Interný odkaz píš s lomkou na začiatku, napríklad /svetelne-zavesy/.',
  button: 'Text na tlačidle.',
  buttonText: 'Text na tlačidle.',
  linkText: 'Text odkazu.',
  price: 'Aktuálna cena tak, ako sa zobrazí zákazníkom, napríklad 47,90 €.',
  oldPrice: 'Pôvodná (prečiarknutá) cena. Nechaj prázdne, ak produkt nie je v zľave.',
  discount: 'Text zľavy na karte, napríklad -20 %. Nechaj prázdne, ak zľava nie je.',
  activeFrom: 'Od kedy sa oznámenie zobrazuje. Formát RRRR.MM.DD.',
  activeTo: 'Dokedy sa oznámenie zobrazuje. Formát RRRR.MM.DD.',
  badge: 'Text na ribbone, napríklad TOP VÝBER.',
  products: 'Karty produktov v tejto sekcii. Poradie môžeš meniť šípkami.',
  'banners.title': 'Nadpis snímky. Každá snímka má vlastný nadpis.',
  'banners.description': 'Text pod nadpisom snímky.',
  'banners.button': 'Text tlačidla banneru.',
  'banners.links': 'Kam vedie snímka. Interný odkaz píš s lomkou, napríklad /svetelne-zavesy/.',
  'featuredProduct.title': 'Názov hlavného produktu.',
  'featuredProduct.url': 'Stránka produktu v e-shope. Rovnaký produkt sa v zozname Obľúbených nezobrazí druhýkrát.',
  'categories.name': 'Názov kategórie na karte.',
  'categories.url': 'Adresa kategórie v e-shope, napríklad /svetelne-zavesy/.',
  'footer.description': 'Popis značky, ktorý sa zobrazí v pätičke.',
  'notificationsConfig.title': 'Nadpis vyskakovacieho okna.',
  'notificationsConfig.description': 'Text vyskakovacieho okna.',
  'notificationsConfig.link': 'Kam vedie tlačidlo v okne.',
  'notificationsConfig.buttonText': 'Text tlačidla v okne.'
};
function sectionKey(path) { return path[0] === 'DOMVELI_CONFIG' ? path[1] : path[0]; }
function hintFor(path) {
  const names = path.filter(item => typeof item === 'string');
  const key = names.at(-1), parent = names.at(-2);
  const section = sectionKey(path);
  return FIELD_HINTS[`${section}.${parent}.${key}`] || FIELD_HINTS[`${section}.${key}`] || FIELD_HINTS[key] || '';
}
function tip(text) {
  const wrap = el('span', 'tip');
  const trigger = el('button', 'tip-btn', '?');
  trigger.type = 'button'; trigger.setAttribute('aria-label', 'Vysvetlivka');
  const box = el('span', 'tip-text', text); box.setAttribute('role', 'tooltip');
  trigger.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); wrap.classList.toggle('open'); });
  trigger.addEventListener('blur', () => wrap.classList.remove('open'));
  wrap.append(trigger, box);
  return wrap;
}
function setLabel(field, text) { const label = field.querySelector('.field-label'); if (label) label.textContent = text; }
document.addEventListener('keydown', event => { if (event.key === 'Escape') document.querySelectorAll('.tip.open').forEach(node => node.classList.remove('open')); });
function message(text) { $('status').textContent = text; }
function changed() {
  dirty = true;
  $('state').textContent = 'Neuložené zmeny';
  $('json').textContent = JSON.stringify(config, null, 2);
  if (directory) queueCleanup();
}
function validate(value) {
  if (!value?.DOMVELI_CONFIG || !Array.isArray(value.DOMVELI_CONFIG.categories) ||
      !Array.isArray(value.DOMVELI_CONFIG.banners) ||
      !Array.isArray(value.notificationsConfig) || !Array.isArray(value.navbannerConfig)) {
    throw new Error('JSON nemá očakávané sekcie konfigurácie DOMVELI.');
  }
}
function accept(value, source) {
  validate(value);
  assets.forEach(asset => URL.revokeObjectURL(asset.preview));
  assets.clear();
  config = clone(value);
  dirty = false;
  $('state').textContent = 'Bez zmien';
  $('publish').disabled = !directory;
  referencedImages(config).forEach(name => managedImages.add(name));
  $('sections').replaceChildren();
  const sections = [...Object.keys(config.DOMVELI_CONFIG).map(key => ['DOMVELI_CONFIG', key]),
    ...Object.keys(config).filter(key => key !== 'DOMVELI_CONFIG').map(key => [key])];
  sections.forEach(path => {
    const button = el('button', '', labels[path.at(-1)] || path.at(-1));
    button.type = 'button';
    button.dataset.path = JSON.stringify(path);
    button.addEventListener('click', () => openSection(path));
    $('sections').append(button);
  });
  openSection(activePath && sections.some(p => JSON.stringify(p) === JSON.stringify(activePath)) ? activePath : sections[0]);
  $('json').textContent = JSON.stringify(config, null, 2);
  message(`Načítané: ${source}`);
}
function openSection(path) {
  activePath = path;
  $('section-hint').textContent = SECTION_HINTS[sectionKey(path)] || '';
  $('title').textContent = labels[path.at(-1)] || path.at(-1);
  $('sections').querySelectorAll('button').forEach(button => button.setAttribute('aria-current', String(button.dataset.path === JSON.stringify(path))));
  $('fields').replaceChildren(renderValue(at(path), path));
}
function button(text, action, className = '') {
  const node = el('button', className, text);
  node.type = 'button';
  node.addEventListener('click', action);
  return node;
}
function blank(value) {
  if (Array.isArray(value)) return [];
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, blank(item)]));
  if (typeof value === 'number') return 0;
  if (typeof value === 'boolean') return false;
  return '';
}
const templates = {
  categories: {id:'',name:'',url:'',image:''},
  items: {title:'',text:''},
  banners: {id:'',images:[],uptitle:'',title:[],description:[],button:'',links:[]},
  products: {name:'',image:'',url:'',price:'',oldPrice:'',discount:''},
  notificationsConfig: {title:'',description:'',images:[],buttonText:'',link:'',activeFrom:'',activeTo:''},
  navbannerConfig: {title:'',description:'',buttonText:'',link:''}
};
function renderValue(value, path) {
  const key = path.at(-1);
  if (value && !Array.isArray(value) && typeof value === 'object' &&
      path.length === 4 && path[0] === 'DOMVELI_CONFIG' && path[1] === 'sets' && path[2] === 'products') {
    return renderSetProduct(value, path);
  }
  if (value && !Array.isArray(value) && typeof value === 'object' &&
      path.length === 3 && path[0] === 'DOMVELI_CONFIG' && path[1] === 'banners') {
    return renderBanner(value, path);
  }
  if (Array.isArray(value)) {
    const wrapper = el('div', 'card');
    const arrayHead = el('h2', '', labels[key] || String(key));
    const arrayHint = hintFor(path); if (arrayHint) arrayHead.append(tip(arrayHint));
    wrapper.append(arrayHead);
    const isBanners = path.length === 2 && path[0] === 'DOMVELI_CONFIG' && key === 'banners';
    value.forEach((item, index) => {
      if (isBanners && index < 2) wrapper.append(el('h3', 'group-title', index === 0 ? 'Veľký banner' : 'Menšie bannery'));
      const card = el('div', 'card');
      const head = el('div', 'item-head');
      const itemTitle = Array.isArray(item?.title) ? item.title[0] : item?.title;
      const headText = isBanners
        ? `${index === 0 ? 'Veľký banner' : `Menší banner ${index}`}${item?.id ? ` (${item.id})` : ''}`
        : `${index + 1}. ${item?.name || itemTitle || item?.id || 'Položka'}`;
      head.append(el('strong', '', headText));
      const actions = el('div', 'item-actions');
      const move = delta => { [value[index],value[index + delta]] = [value[index + delta],value[index]]; changed(); openSection(activePath); };
      const up = button('↑', () => move(-1)); up.disabled = index === 0; up.setAttribute('aria-label', 'Presunúť vyššie');
      const down = button('↓', () => move(1)); down.disabled = index === value.length - 1; down.setAttribute('aria-label', 'Presunúť nižšie');
      actions.append(up, down, button('Odstrániť', () => {
        if (!confirm('Odstrániť túto položku?')) return;
        value.splice(index, 1); changed(); openSection(activePath);
      }, 'danger'));
      if (item && typeof item === 'object') actions.append(button('Duplikovať', () => { value.splice(index + 1, 0, clone(item)); changed(); openSection(activePath); }));
      // Počet a poradie bannerov určuje web (1 veľký + 2 menšie), preto sa tu nemenia.
      if (!isBanners) head.append(actions);
      card.append(head, renderValue(item, [...path, index])); wrapper.append(card);
    });
    if (!(path.length === 2 && path[0] === 'DOMVELI_CONFIG' && key === 'banners')) wrapper.append(button('+ Pridať položku', () => {
      value.push(clone(templates[key] || (value.length ? blank(value[0]) : '')));
      changed(); openSection(activePath);
    }));
    return wrapper;
  }
  if (value && typeof value === 'object') {
    const isSection = JSON.stringify(path) === JSON.stringify(activePath);
    const wrapper = el('fieldset', isSection ? 'card compact-object' : 'compact-object');
    const media = el('div', 'compact-media');
    const fields = el('div', 'compact-fields');
    const nested = el('div', 'compact-nested');
    for (const [childKey, item] of Object.entries(value)) {
      const field = renderValue(item, [...path, childKey]);
      if (childKey === 'image' || childKey === 'images') {
        media.append(field);
      } else if (item && typeof item === 'object') {
        nested.append(field);
      } else {
        if (['name','title','description'].includes(childKey)) field.className += ' compact-wide';
        fields.append(field);
      }
    }
    const content = el('div', media.children.length ? 'compact-content compact-with-media' : 'compact-content');
    if (media.children.length) content.append(media);
    content.append(fields); wrapper.append(content);
    if (nested.children.length) wrapper.append(nested);
    return wrapper;
  }
  const wrapper = el('div', 'field');
  const id = 'field-' + path.map(String).join('-');
  const label = el('label', 'field-label', labels[key] || (typeof key === 'number' ? `Hodnota ${key + 1}` : String(key)));
  label.htmlFor = id;
  const input = el(key === 'description' || path.at(-2) === 'description' ? 'textarea' : 'input');
  input.id = id;
  if (isImage(path)) {
    input.readOnly = true;
    input.className = 'image-url';
    input.title = 'Adresa sa nastaví automaticky po nahratí obrázka.';
  }
  if (input.tagName === 'INPUT') input.type = typeof value === 'boolean' ? 'checkbox' : typeof value === 'number' ? 'number' : 'text';
  if (typeof value === 'boolean') input.checked = value; else input.value = value ?? '';
  input.addEventListener('input', () => {
    set(path, typeof value === 'boolean' ? input.checked : typeof value === 'number' ? Number(input.value) : input.value);
    if (isImage(path)) updatePreview();
  });
  const row = el('div', 'label-row'); row.append(label);
  const help = hintFor(path); if (help) row.append(tip(help));
  wrapper.append(row, input);
  if (key === 'activeFrom' || key === 'activeTo') {
    input.placeholder = '2026.10.14';
    wrapper.append(el('span', 'small', 'Formát dátumu: RRRR.MM.DD alebo RRRR-MM-DD.'));
  }
  let updatePreview = () => {};
  if (isImage(path)) {
    const preview = el('img', 'image-preview'); preview.alt = 'Náhľad obrázka';
    const note = el('span', 'small');
    let previewVersion = 0;
    let localPreview;
    updatePreview = async () => {
      const version = ++previewVersion;
      const src = imageURL(input.value);
      preview.hidden = !src;
      if (src) preview.src = src; else preview.removeAttribute('src');
      note.textContent = '';
      if (directory && /^images\/[a-zA-Z0-9._-]+$/.test(input.value) && !assets.has(input.value)) {
        try {
          const file = await (await (await directory.getDirectoryHandle('images')).getFileHandle(input.value.slice(7))).getFile();
          if (version !== previewVersion) return;
          if (localPreview) URL.revokeObjectURL(localPreview);
          localPreview = URL.createObjectURL(file); preview.src = localPreview; preview.hidden = false;
        } catch { /* Existujúci vzdialený obrázok môže zatiaľ byť iba na GitHube. */ }
      }
    };
    preview.addEventListener('error', () => { preview.hidden = true; note.textContent = 'Náhľad sa nepodarilo načítať. Skontroluj adresu.'; });
    const picker = el('input'); picker.type = 'file'; picker.accept = 'image/jpeg,image/png,image/webp,image/avif,image/gif';
    picker.disabled = !directory;
    if (!directory) note.textContent = 'Najprv povoľ ukladanie do priečinka. Potom vyber obrázok.';
    picker.addEventListener('change', async () => {
      if (!picker.files[0]) return;
      if (!directory) { note.textContent = 'Najprv pripoj priečinok tlačidlom Povoliť ukladanie obrázkov.'; message(note.textContent); picker.value = ''; return; }
      if (publishing) return;
      busyUploads++; $('publish').disabled = true; picker.disabled = true; $('fields').inert = true;
      note.textContent = 'Spracúvam a ukladám obrázok…';
      try {
        if (await directory.queryPermission({mode:'readwrite'}) !== 'granted') {
          throw new Error('Zápis nie je povolený. Reštartuj lokálny server.');
        }
        const asset = await prepareImage(picker.files[0]);
        await fileQueue;
        const images = await directory.getDirectoryHandle('images', {create:true});
        await writeFile(images, asset.name, asset.blob);
        managedImages.add(asset.name);
        assets.set(asset.url, asset);
        input.value = asset.url; set(path, asset.url); updatePreview();
        await fileQueue;
        note.textContent = fileError ? `Obrázok uložený, ale mazanie starého zlyhalo: ${fileError.message}` : `Uložené: ${asset.url}`;
        message(note.textContent);
      } catch (error) { note.textContent = `Nahratie obrázka zlyhalo: ${error.message}`; message(note.textContent); }
      finally { busyUploads--; picker.value = ''; picker.disabled = false; $('publish').disabled = !directory || busyUploads > 0; $('fields').inert = busyUploads > 0; }
    });
    const tools = el('div', 'image-tools');
    tools.append(picker);
    wrapper.append(preview, tools, note); updatePreview();
    if (!directory) note.textContent = 'Spusti start-editor.cmd a otvor http://127.0.0.1:8765.';
  }
  return wrapper;
}
function renderSetProduct(product, path) {
  const wrapper = el('div', 'set-product-editor');
  const media = el('div', 'set-product-media');
  if ('image' in product) media.append(renderValue(product.image, [...path,'image']));
  const content = el('div', 'set-product-content');
  for (const key of ['name','url']) {
    if (key in product) content.append(renderValue(product[key], [...path,key]));
  }
  const prices = el('div', 'set-product-prices');
  for (const key of ['price','oldPrice','discount']) {
    if (key in product) prices.append(renderValue(product[key], [...path,key]));
  }
  content.append(prices);
  for (const [key,value] of Object.entries(product)) {
    if (!['image','name','url','price','oldPrice','discount'].includes(key)) content.append(renderValue(value,[...path,key]));
  }
  wrapper.append(media,content); return wrapper;
}
function renderBanner(banner, path) {
  const wrapper = el('div', 'banner-editor');
  const slideKeys = ['images','title','description','links','uptitle','button'];
  const arrays = slideKeys.filter(key => Array.isArray(banner[key]));
  const count = Math.max(1, ...arrays.map(key => banner[key].length));
  const common = el('div', 'banner-common');
  common.append(el('h2', '', 'Spoločné nastavenia'));
  const commonFields = el('div', 'banner-common-fields');
  for (const [key,value] of Object.entries(banner)) {
    if (arrays.includes(key) || key === 'image') continue;
    commonFields.append(renderValue(value,[...path,key]));
  }
  common.append(commonFields); wrapper.append(common);
  const slides = el('div', 'banner-slides');
  const commit = () => { changed(); openSection(activePath); };
  const populate = () => {
    arrays.forEach(key => {
      while (banner[key].length < count) banner[key].push(key === 'images' ? '' : (banner[key][0] || ''));
    });
  };
  for (let index = 0; index < count; index++) {
    const slide = el('section', 'banner-slide');
    const head = el('div', 'item-head');
    head.append(el('strong', '', `Snímka ${index + 1}`));
    const actions = el('div', 'item-actions');
    const move = delta => {
      populate();
      arrays.forEach(key => { [banner[key][index],banner[key][index+delta]] = [banner[key][index+delta],banner[key][index]]; });
      commit();
    };
    const up = button('↑', () => move(-1)); up.disabled = index === 0; up.setAttribute('aria-label','Presunúť snímku vyššie');
    const down = button('↓', () => move(1)); down.disabled = index === count-1; down.setAttribute('aria-label','Presunúť snímku nižšie');
    const remove = button('Odstrániť snímku', () => {
      if (!confirm('Odstrániť snímku aj jej texty a odkaz?')) return;
      arrays.forEach(key => banner[key].splice(index,1)); commit();
    },'danger');
    remove.disabled = count === 1;
    actions.append(up,down,remove); head.append(actions); slide.append(head);
    const content = el('div', 'banner-slide-content');
    const media = el('div', 'banner-slide-media');
    const imageKey = Array.isArray(banner.images) ? 'images' : 'image';
    const imagePath = imageKey === 'images' ? [...path,'images',index] : [...path,'image'];
    const imageField = renderValue(imageKey === 'images' ? banner.images[index] || '' : banner.image || '',imagePath);
    setLabel(imageField, 'Obrázok');
    media.append(imageField);
    if (!(imageKey === 'images' ? banner.images[index] : banner.image)) {
      media.append(el('p','small','Bez obrázka sa táto snímka na e-shope nezobrazí.'));
    }
    const texts = el('div', 'banner-slide-texts');
    for (const key of arrays.filter(key => key !== 'images')) {
      const field = renderValue(banner[key][index] ?? banner[key][0] ?? '',[...path,key,index]);
      setLabel(field, labels[key] || key);
      texts.append(field);
    }
    if (!texts.children.length) texts.append(el('p','small','Texty a odkaz sa nastavujú spoločné pre všetky snímky.'));
    content.append(media,texts); slide.append(content); slides.append(slide);
  }
  slides.append(button('+ Pridať snímku', () => {
    if (!Array.isArray(banner.images)) {
      banner.images = [banner.image || ''];
      arrays.push('images');
    }
    populate(); arrays.forEach(key => banner[key].push('')); commit();
  }));
  wrapper.append(slides); return wrapper;
}
function isImage(path) { return path.at(-1) === 'image' || path.at(-2) === 'images'; }
function imageURL(value) {
  if (!value) return '';
  if (assets.has(value)) return assets.get(value).preview;
  try {
    const url = new URL(value, value.startsWith('/user/') ? 'https://www.domveli.sk/' : REMOTE_URL);
    return ['http:', 'https:'].includes(url.protocol) ? url.href : '';
  } catch { return ''; }
}
async function prepareImage(file) {
  if (!['image/jpeg','image/png','image/webp','image/avif','image/gif'].includes(file.type)) throw new Error('Vyber PNG, JPEG, WebP, AVIF alebo GIF.');
  if (file.size > 20 * 1024 * 1024) throw new Error('Maximálna veľkosť obrázka je 20 MB.');
  let blob = file;
  let extension = { 'image/jpeg':'jpg', 'image/png':'png', 'image/webp':'webp', 'image/avif':'avif', 'image/gif':'gif' }[file.type];
  // GIF (animácie) zachováme; ostatné formáty zmenšíme na max 1400 px a uložíme ako WebP.
  if (['image/jpeg','image/png','image/webp','image/avif'].includes(file.type)) {
    const bitmap = await createImageBitmap(file);
    try {
      const scale = Math.min(1, 1400 / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const converted = await new Promise(resolve => canvas.toBlob(resolve, 'image/webp', .8));
      if (!converted) throw new Error('Obrázok sa nepodarilo spracovať.');
      if (converted.type === 'image/webp' && (scale < 1 || converted.size < file.size || file.type !== 'image/webp')) { blob = converted; extension = 'webp'; }
    } finally { bitmap.close(); }
  }
  const stem = file.name.replace(/\.[^.]+$/, '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,60) || 'obrazok';
  const name = `${stem}-${Date.now()}-${Math.random().toString(36).slice(2,8)}.${extension}`;
  return {name, url:`images/${name}`, blob, preview:URL.createObjectURL(blob)};
}
async function load(url, source) {
  const response = await fetch(`${url}?t=${Date.now()}`, {cache:'no-store', signal:AbortSignal.timeout(10000)});
  if (!response.ok) throw new Error(`Načítanie zlyhalo: HTTP ${response.status}`);
  accept(await response.json(), source);
}
async function writeFile(parent, name, content) {
  const handle = await parent.getFileHandle(name, {create:true});
  const stream = await handle.createWritable();
  try { await stream.write(content); await stream.close(); }
  catch (error) { await stream.abort().catch(() => {}); throw error; }
}
function referencedImages(value) {
  const names = new Set();
  function visit(item, key = '') {
    if (typeof item === 'string' && (key === 'image' || key === 'images')) {
      const match = /^images\/([a-zA-Z0-9][a-zA-Z0-9._-]*\.(?:webp|png|jpe?g|gif|avif))$/i.exec(item);
      if (match) names.add(match[1]);
    } else if (Array.isArray(item)) item.forEach(child => visit(child, key));
    else if (item && typeof item === 'object') Object.entries(item).forEach(([k,v]) => visit(v,k));
  }
  visit(value); return names;
}
function queueCleanup() {
  fileQueue = fileQueue.then(async () => {
    const used = referencedImages(config);
    let images;
    try { images = await directory.getDirectoryHandle('images'); }
    catch (error) { if (error.name === 'NotFoundError') return; throw error; }
    for (const name of managedImages) {
      if (used.has(name)) continue;
      try { await images.removeEntry(name); }
      catch (error) { if (error.name !== 'NotFoundError') throw error; }
      managedImages.delete(name);
      const asset = assets.get(`images/${name}`);
      if (asset) { URL.revokeObjectURL(asset.preview); assets.delete(`images/${name}`); }
    }
    fileError = null;
  }).catch(error => { fileError = error; message(`Mazanie obrázka zlyhalo: ${error.message}`); });
}
const SUPABASE_URL = 'https://cfhctleinkluxglwgrsj.supabase.co';
const SUPABASE_KEY = 'sb_publishable_bZIjdoU0ZzNlv9L00MR0rQ_3WUDxR6_';
const SESSION_KEY = 'domveli.editor.session';
let session = null;
async function supabaseAuth(grant, body) {
  const response = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=${grant}`, {
    method:'POST', headers:{apikey:SUPABASE_KEY,'Content-Type':'application/json'},
    body:JSON.stringify(body), signal:AbortSignal.timeout(15000)
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.msg || result.error_description || `Prihlásenie zlyhalo (HTTP ${response.status}).`);
  if (!result.access_token || !result.refresh_token) throw new Error('Supabase nevrátila úplnú reláciu.');
  session = {access_token:result.access_token, expires_at:Date.now()+(result.expires_in||3600)*1000-60000};
  try { localStorage.setItem(SESSION_KEY, JSON.stringify({refresh_token:result.refresh_token})); } catch {}
  return session;
}
function savedRefreshToken() {
  try { return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null')?.refresh_token; } catch { return null; }
}
async function accessToken() {
  if (session && session.expires_at > Date.now()) return session.access_token;
  const refresh = savedRefreshToken();
  if (!refresh) throw new Error('Najprv sa prihlás.');
  try { return (await supabaseAuth('refresh_token',{refresh_token:refresh})).access_token; }
  catch (error) { signOut(); throw error; }
}
function signOut() {
  session = null;
  try { localStorage.removeItem(SESSION_KEY); } catch {}
  $('gate').hidden = false; $('app').hidden = true;
}
async function callPublish(payload) {
  const response = await fetch(`${SUPABASE_URL}/functions/v1/domveli-publish`, {
    method:'POST',
    headers:{Authorization:`Bearer ${await accessToken()}`,'Content-Type':'application/json'},
    body:JSON.stringify(payload), signal:AbortSignal.timeout(120000)
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`Publikovanie zlyhalo (HTTP ${response.status}): ${result.error || result.message || 'chyba'}`);
  return result;
}
async function blobBase64(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = ''; for (let i=0;i<bytes.length;i+=8192) binary += String.fromCharCode(...bytes.subarray(i,i+8192));
  return btoa(binary);
}
async function publishGithub(snapshot) {
  const images = {};
  for (const name of referencedImages(snapshot)) {
    const blob = memoryFiles.get(`images/${name}`);
    if (blob) images[name] = await blobBase64(blob);
  }
  return (await callPublish({action:'publish', config:snapshot, images})).sha;
}
function deploymentStatus(text) {
  $('deployment-message').textContent = text;
  message(text);
}
async function waitForDeployment(sha, {attempts=120, sleep=() => new Promise(resolve => setTimeout(resolve,10000))} = {}) {
  for (let attempt=0;attempt<attempts;attempt++) {
    const result = await callPublish({action:'deployment', sha});
    const run = result.status === 'waiting' ? null : {status:result.status, conclusion:result.conclusion, html_url:result.url};
    if (run) {
      if (run.html_url?.startsWith('https://github.com/Richard190104/domveli-be/actions/runs/')) {
        $('deployment-link').href = run.html_url; $('deployment-link').hidden = false;
      }
      if (run.status === 'completed') {
        if (run.conclusion === 'success') return run;
        throw new Error(`GitHub Pages: ${run.conclusion || 'neúspešné nasadenie'}. Skontroluj Actions, oprav príčinu a spusti nasadenie znova.`);
      }
      $('deployment-phase').textContent = run.status === 'in_progress' ? 'Nasadzovanie na GitHub Pages' : 'Čakanie na GitHub Actions';
      deploymentStatus(run.status === 'in_progress' ? 'Súbory sú nahrané. GitHub Actions pripravuje a nasadzuje web…' : 'Súbory sú nahrané. Nasadenie čaká na spustenie…');
    } else {
      $('deployment-phase').textContent = 'Čakanie na GitHub Actions';
      deploymentStatus('Súbory sú nahrané. Čakám na spustenie GitHub Pages workflow…');
    }
    if (attempt < attempts-1) await sleep();
  }
  throw new Error('Nasadenie zatiaľ nie je potvrdené. Skontroluj GitHub Actions a obnov sledovanie.');
}
async function performPublish() {
  if (!directory || busyUploads || publishing && !deploymentFailed) return;
  deploymentFailed = false;
  publishing = true; $('publish').disabled = true;
  lockInterface(true);
  const dialog = $('deployment-dialog');
  if (!dialog.open) dialog.showModal();
  $('deployment-phase').textContent = pendingCommit ? 'Sledovanie nasadenia' : 'Nahrávanie súborov';
  startDeploymentTimer();
  $('deployment-close').textContent = 'Hotovo';
  $('deployment-close').hidden = true; $('deployment-retry').hidden = true; $('deployment-progress').hidden = false;
  try {
    if (!pendingCommit) {
    await fileQueue; if (fileError) throw fileError;
    const json = JSON.stringify(config,null,2) + '\n';
    const snapshot = JSON.parse(json); validate(snapshot);
    await writeFile(directory,'config.json',json);
    $('state').textContent = 'Lokálne uložené';
        deploymentStatus('JSON overený a uložený. Nahrávam config a obrázky do GitHubu…');
    pendingCommit = await publishGithub(snapshot);
    }
    dirty = false; $('state').textContent = 'Nahrané do GitHubu';
    $('deployment-phase').textContent = 'Čakanie na GitHub Actions';
    deploymentStatus('Súbory sú nahrané. Overujem stav nasadenia na GitHub Pages…');
    await waitForDeployment(pendingCommit);
    $('state').textContent = 'Deployed';
    $('deployment-phase').textContent = 'Nasadenie dokončené';
    deploymentStatus(`Deployed — zmeny z commitu ${pendingCommit.slice(0,7)} sú úspešne nasadené.`);
    pendingCommit = undefined;
    reloadAfterClose = true;
    publishing = false;
    $('deployment-close').hidden = false;
    $('deployment-close').focus();
  } catch (error) {
    deploymentFailed = true;
    publishing = false;
    $('state').textContent = pendingCommit ? 'Deploy nepotvrdený' : 'Nahratie zlyhalo';
    $('deployment-phase').textContent = pendingCommit ? 'Nasadenie nepotvrdené' : 'Chyba nahrávania';
    deploymentStatus(`${error.message}${/HTTP 403/.test(error.message) ? ' Token potrebuje aj oprávnenie Actions: Read.' : ''}`);
    $('deployment-retry').textContent = pendingCommit ? 'Obnoviť sledovanie' : 'Skúsiť nahratie znova';
    $('deployment-retry').hidden = false;
    $('deployment-close').textContent = 'Zavrieť';
    $('deployment-close').hidden = false;
    $('deployment-retry').focus();
  }
  finally { clearInterval(deploymentTimer); $('deployment-progress').hidden = true; }
}
$('publish').addEventListener('click', performPublish);
$('deployment-retry').addEventListener('click', performPublish);
$('deployment-dialog').addEventListener('cancel', event => event.preventDefault());
$('deployment-close').addEventListener('click', () => {
  if (publishing) return;
  deploymentFailed = false;
  pendingCommit = undefined;
  $('deployment-dialog').close();
  lockInterface(false);
  $('publish').disabled = false; $('publish').focus();
  if (reloadAfterClose) { reloadAfterClose = false; memoryFiles.clear(); load(REMOTE_URL, 'GitHub Pages').catch(error => message(`Načítanie zlyhalo: ${error.message}`)); }
});
window.addEventListener('beforeunload', event => { if (dirty || publishing) { event.preventDefault(); event.returnValue = ''; } });
directory = memoryDirectory();
function startEditor() {
  $('gate').hidden = true; $('app').hidden = false;
  load(REMOTE_URL, 'GitHub Pages').catch(error => {
    $('title').textContent = 'Načítaj konfiguráciu';
    message(`Config z GitHub Pages sa nepodarilo načítať: ${error.message}. Skús Načítať z webu.`);
  });
}
$('login').addEventListener('submit', async event => {
  event.preventDefault();
  $('login-submit').disabled = true; $('login-message').textContent = 'Prihlasujem…';
  try {
    await supabaseAuth('password',{email:$('email').value.trim(), password:$('password').value});
    $('password').value = ''; $('login-message').textContent = ''; startEditor();
  } catch (error) { $('login-message').textContent = error.message; }
  finally { $('login-submit').disabled = false; }
});
$('logout').addEventListener('click', () => { if (!dirty || confirm('Neuložené zmeny sa stratia. Odhlásiť?')) signOut(); });
if (savedRefreshToken()) accessToken().then(startEditor).catch(() => {});
