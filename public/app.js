/* Sophia's browser client. All cooking decisions and mutations run on the server. */
'use strict';

const app = document.querySelector('#app');
const ui = {
  state: null,
  catalog: [],
  provider: { mode: 'demo', label: 'Local demo' },
  view: 'cook',
  dishId: 'fried-rice',
  servings: 3,
  portions: [],
  busy: false,
  recipeQuery: '',
  recipeCategory: 'All dishes',
  recipePage: 0,
  pantryQuery: '',
  forecast: null,
  forecastConfig: null,
  awayDays: 0,
  confirmPantry: false,
  speak: false,
  kitchen: false,
  kitchenNote: null,
  timer: null,
  voice: { state: 'idle', detail: '', handsFree: false },
  messages: [{ role: 'assistant', content: 'A kitchen for everyone.\nWhat shall we make together?' }],
};

const esc = value =>
  String(value ?? '').replace(
    /[&<>"']/g,
    ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch],
  );
const iconPaths = {
  cook: '<path d="M4 10h16M5 10l1.5 8h11L19 10M8 6V3m4 3V2m4 4V3M2 10h2m16 0h2"/>',
  pantry: '<path d="M6 8h12v13H6zM8 3h8v5H8zM6 12h12M9 15h6"/>',
  bag: '<path d="M5 7h14l1 14H4L5 7zM8 8V6a4 4 0 018 0v2"/>',
  history: '<path d="M3 11a9 9 0 119 10M3 5v6h6M12 7v5l3 2"/>',
  leaf: '<path d="M19 3C8 2 2 8 6 16c7 5 15-1 13-13zM5 20L16 8M10 14l-1-5m1 5 5 1"/>',
  arrow: '<path d="M5 12h14m-5-5 5 5-5 5"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  people: '<circle cx="9" cy="7" r="3"/><path d="M3 21v-3a6 6 0 0112 0v3M16 4a3 3 0 010 6m2 5c2 1 3 3 3 6"/>',
  split: '<path d="M12 21v-7M5 3v4l7 7 7-7V3M2 6l3-3 3 3m8 0 3-3 3 3"/>',
  spark: '<path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3z"/>',
  chat: '<path d="M20 11a8 8 0 01-8 8H5l-4 3 2-7a8 8 0 1117-4zM7 10h10M7 14h6"/>',
  reset: '<path d="M4 9a8 8 0 118 11M4 3v6h6"/>',
  send: '<path d="m4 12 16-8-5 16-3-7-8-1zm8 1 8-9"/>',
  volume: '<path d="M4 9h4l5-4v14l-5-4H4zM17 8a6 6 0 010 8m3-11a10 10 0 010 14"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  bowl: '<path d="M3 11h18a9 9 0 01-18 0zM7 20h10M8 7V4m4 3V2m4 5V4"/>',
  chevron: '<path d="m9 5 7 7-7 7"/>',
  lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 018 0v3M12 14v3"/>',
  mic: '<rect x="9" y="2.5" width="6" height="11.5" rx="3"/><path d="M5.5 11a6.5 6.5 0 0013 0M12 17.5V21m-3.5 0h7"/>',
  expand: '<path d="M4 9V4h5m6 0h5v5M4 15v5h5m6 0h5v-5"/>',
  repeat: '<path d="m17 2 3 3-3 3M4 11V9a4 4 0 014-4h12M7 22l-3-3 3-3m16-3v2a4 4 0 01-4 4H4"/>',
  mute: '<path d="M4 9h4l5-4v14l-5-4H4zm13 .5 5 5m0-5-5 5"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="2.5"/>',
  timer: '<circle cx="12" cy="13.5" r="7.5"/><path d="M12 10v3.5l2.5 1.5M9.5 2.5h5M12 2.5V6"/>',
};
function icon(name, size = 18, className = '') {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" class="${className}" aria-hidden="true">${iconPaths[name] || iconPaths.leaf}</svg>`;
}

function foodArt(type, hero = false) {
  const common =
    '<ellipse cx="130" cy="146" rx="93" ry="84" fill="#7a775e" opacity=".08"/><circle cx="125" cy="125" r="101" fill="#fbfaf2"/><circle cx="125" cy="125" r="86" fill="#e1e2cf"/><circle cx="125" cy="125" r="78" fill="#fcf9e8"/>';
  let food = '';
  if (type === 'pasta') {
    food = '<circle cx="125" cy="125" r="68" fill="#cd7444"/>';
    for (let i = 0; i < 25; i++) {
      const a = i * 2.4;
      const r = 14 + (i % 5) * 10;
      const x = 125 + Math.cos(a) * r;
      const y = 125 + Math.sin(a) * r;
      food += `<rect x="${x - 11}" y="${y - 5}" width="24" height="10" rx="5" transform="rotate(${i * 37} ${x} ${y})" fill="${i % 3 ? '#efb773' : '#e9a65e'}"/><path d="M${x - 6} ${y}h13" stroke="#d5894e" stroke-width="1" transform="rotate(${i * 37} ${x} ${y})"/>`;
    }
    food +=
      '<path d="M99 83c-20-17-31 2-13 13 15 2 13-13 13-13zm49 65c-22-13-30 9-12 16 15-1 12-16 12-16zm5-62c-1-24 22-24 21-5-6 12-21 5-21 5z" fill="#5f7b47"/>';
  } else if (type === 'wraps') {
    food =
      '<path d="m72 78 80-15 38 102-79 19z" fill="#d0aa6d"/><path d="m67 81 76-13 38 98-77 19z" fill="#efdab0"/><path d="m95 74 17 36 48-16-14-27z" fill="#678455"/><path d="m98 77 6 16 44-15-5-11z" fill="#e89362"/><path d="m110 70 7 17 27-10-4-11z" fill="#a9b563"/><path d="m100 113 59-15m-51 37 59-15m-51 37 59-15" stroke="#d7bd91" stroke-width="3"/><path d="m58 118 54-8 33 74-55 10z" fill="#dfc48e"/><path d="m55 119 52-8 30 73-52 10z" fill="#f1dfb8"/><path d="m63 117 13 27 34-12-8-20z" fill="#71935d"/><path d="m73 117 7 15 28-10-5-10z" fill="#da8b58"/><path d="m79 149 33-8m-24 29 33-8" stroke="#d1b786" stroke-width="3"/>';
  } else if (['curry', 'greens', 'soup', 'porridge'].includes(type)) {
    const colour = { curry: '#d49a58', greens: '#80924f', soup: '#cb7957', porridge: '#e3d1a8' }[type];
    food = `<circle cx="125" cy="125" r="70" fill="${colour}"/><ellipse cx="108" cy="96" rx="39" ry="17" fill="#fff6dc" opacity=".12"/>`;
    for (let i = 0; i < 11; i++) {
      const x = 92 + ((i * 31) % 66),
        y = 88 + ((i * 23) % 72);
      food += `<rect x="${x}" y="${y}" width="14" height="12" rx="${type === 'porridge' ? 6 : 3}" fill="${type === 'greens' ? '#f3dfaa' : type === 'soup' ? '#ebc09b' : '#e9c27b'}" transform="rotate(${i * 31} ${x} ${y})"/>`;
    }
    food +=
      '<path d="M101 105c-17-12-22 5-8 12 10 1 8-12 8-12zm45 37c-17-12-22 5-8 12 10 1 8-12 8-12z" fill="#63844e"/>';
  } else if (type === 'breakfast') {
    food =
      '<ellipse cx="125" cy="125" rx="73" ry="62" fill="#e8ba64"/><path d="M58 123q68 64 134 0" fill="#f2d389"/><path d="m92 89 13 4m40 17 12 4m-67 29 16 3m27 22 11-3" stroke="#c78051" stroke-width="5" stroke-linecap="round"/><circle cx="122" cy="100" r="4" fill="#7a9451"/><circle cx="151" cy="143" r="4" fill="#7a9451"/>';
  } else if (type === 'idli') {
    food =
      '<ellipse cx="96" cy="104" rx="41" ry="33" fill="#e6dfc7"/><ellipse cx="96" cy="98" rx="40" ry="29" fill="#f6f0d9"/><ellipse cx="156" cy="117" rx="40" ry="33" fill="#e6dfc7"/><ellipse cx="156" cy="111" rx="39" ry="29" fill="#f8f2df"/><ellipse cx="115" cy="158" rx="41" ry="32" fill="#e6dfc7"/><ellipse cx="115" cy="152" rx="40" ry="29" fill="#f5edcf"/>';
  } else if (type === 'sandwich') {
    food =
      '<path d="m65 78 126 9-60 101z" fill="#c79556"/><path d="m66 87 121 8-58 98z" fill="#6f8b50"/><path d="m65 98 116 7-55 94z" fill="#ce7855"/><path d="m61 102 121 8-57 93z" fill="#e4c992"/><path d="m67 108 104 7-49 80z" fill="#f4e3b9"/>';
  } else if (type === 'noodles') {
    food = '<circle cx="125" cy="125" r="70" fill="#d6af6d"/>';
    for (let i = 0; i < 12; i++)
      food += `<path d="M${76 + i * 3} ${81 + i * 7}q65-22 97 16q-60 30-99 4" stroke="${i % 2 ? '#f0d28d' : '#e8c178'}" stroke-width="4" fill="none"/>`;
    food += '<path d="m88 103 12 27m49-43-6 27m15 26-23 8" stroke="#779453" stroke-width="6" stroke-linecap="round"/>';
  } else {
    food = '<circle cx="125" cy="125" r="70" fill="#e6d39f"/>';
    for (let i = 0; i < 62; i++) {
      const a = i * 2.399;
      const r = Math.sqrt(i / 62) * 65;
      const x = 125 + Math.cos(a) * r;
      const y = 125 + Math.sin(a) * r;
      food += `<ellipse cx="${x}" cy="${y}" rx="${i % 4 === 0 ? 4 : 6}" ry="${i % 4 === 0 ? 4 : 2.2}" fill="${['#f3e5bc', '#dca76d', '#eaba73', '#95a56b', '#e9ddae'][i % 5]}" transform="rotate(${i * 41} ${x} ${y})"/>`;
    }
    food +=
      '<path d="M89 78c-13-8-24 4-14 14 14 7 14-14 14-14zm56 75c-14-8-22 6-11 14 13 3 11-14 11-14zm22-64c-11-7-22 7-10 15 12 3 10-15 10-15z" fill="#63844e"/><path d="m100 117 13 5m24-35 12 4m-39 67 13 3m28-34 12 2" stroke="#db8752" stroke-width="6" stroke-linecap="round"/>';
  }
  return `<svg viewBox="0 0 250 250" fill="none" aria-hidden="true">${hero ? '<path d="m24 47 15-15m0 0 14 15m-14-15v38M205 183l12 12m-12-12-12 12m12-12v33" stroke="#c3caa9" stroke-width="1.5"/><path d="M18 140c20-9 32 5 20 15-17 4-20-15-20-15zm183-92c-6-20 19-22 18-7-7 13-18 7-18 7z" fill="#b3be92"/>' : ''}${common}${food}${hero ? '<path d="m208 32-18 73" stroke="#918c6e" stroke-width="5" stroke-linecap="round"/><path d="m217 34-18 73" stroke="#d1c4a0" stroke-width="5" stroke-linecap="round"/>' : ''}</svg>`;
}

function number(value) {
  const n = Number(value);
  return Number.isFinite(n) ? new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(n) : esc(value);
}
function date(value, full = false) {
  if (!value) return 'Just now';
  const d = new Date(value);
  return Number.isNaN(d.valueOf())
    ? esc(value)
    : d.toLocaleDateString(
        undefined,
        full ? { month: 'short', day: 'numeric', year: 'numeric' } : { month: 'short', day: 'numeric' },
      );
}
function selectedDish() {
  return ui.catalog.find(d => d.id === ui.dishId) || ui.catalog[0];
}
function variantLabel(dishId, id) {
  const dish = ui.catalog.find(d => d.id === dishId);
  return dish?.variants?.find(v => v.id === id)?.label || String(id || 'Original').replaceAll('-', ' ');
}
function cookedHistory() {
  return (ui.state?.history || []).filter(h => h.confirmed === true);
}
function initPortions() {
  const dish = selectedDish();
  if (!dish) return;
  const people = ui.state?.household || [];
  ui.portions = Array.from({ length: ui.servings }, (_, i) => {
    const old = ui.portions[i];
    const person = people[i];
    return {
      name: old?.name || person?.name || `Person ${i + 1}`,
      variant: dish.variants.some(v => v.id === old?.variant)
        ? old.variant
        : dish.variants.some(v => v.id === person?.preference)
          ? person.preference
          : dish.defaultVariant || dish.variants[0]?.id,
    };
  });
}

async function unlock() {
  if (document.querySelector('#access-dialog'))
    return new Promise(resolve => document.addEventListener('sophia-unlocked', resolve, { once: true }));
  const dialog = document.createElement('dialog');
  dialog.id = 'access-dialog';
  dialog.className = 'reset-dialog';
  dialog.innerHTML = `<form id="access-form"><span class="eyebrow">Your private kitchen</span><h2>Welcome to Sophia.</h2><p>Enter the access code provided with this demo to open the kitchen.</p><div class="field" style="margin:20px 0"><label for="access-code">Access code</label><input id="access-code" type="password" autocomplete="current-password" required autofocus><p id="access-error" role="alert" style="color:#9a513a;font-size:14px"></p></div><button class="button button-primary button-full" type="submit">${icon('lock', 14)} Open my kitchen</button></form>`;
  document.body.append(dialog);
  dialog.addEventListener('cancel', e => e.preventDefault());
  dialog.showModal();
  return new Promise(resolve => {
    dialog.querySelector('form').addEventListener('submit', async event => {
      event.preventDefault();
      const button = dialog.querySelector('button');
      button.disabled = true;
      try {
        const response = await fetch('/api/unlock', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ accessCode: dialog.querySelector('input').value }),
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'That code did not match.');
        dialog.close();
        dialog.remove();
        document.dispatchEvent(new Event('sophia-unlocked'));
        resolve();
      } catch (error) {
        dialog.querySelector('#access-error').textContent = error.message;
        button.disabled = false;
      }
    });
  });
}

async function api(path, data, retried = false) {
  const payload =
    data === undefined
      ? undefined
      : { ...(ui.state && path !== '/api/unlock' ? { revision: ui.state.revision } : {}), ...data };
  const response = await fetch(path, {
    method: payload === undefined ? 'GET' : 'POST',
    headers: payload === undefined ? {} : { 'Content-Type': 'application/json' },
    ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
  });
  let result;
  try {
    result = await response.json();
  } catch {
    throw new Error('The kitchen could not read the server response. Please try again.');
  }
  if (response.status === 401 && result.code === 'access_required' && !retried) {
    await unlock();
    return api(path, data, true);
  }
  if (response.status === 409) {
    try {
      applyEnvelope(await api('/api/state'));
    } catch {
      throw new Error(
        'The kitchen changed in another tab. The latest state could not be loaded; refresh the page before trying again.',
      );
    }
    throw new Error('The kitchen changed in another tab. The latest state is loaded; review it and try again.');
  }
  if (!response.ok) throw new Error(result.error || 'Something went wrong. Please try again.');
  return result;
}
function applyEnvelope(result) {
  if (result.state) {
    if (ui.state && result.state.revision !== ui.state.revision) {
      ui.forecast = null;
      ui.forecastConfig = null;
    }
    ui.state = result.state;
  }
  if (result.catalog) ui.catalog = Array.isArray(result.catalog) ? result.catalog : Object.values(result.catalog);
  if (result.provider) ui.provider = result.provider;
}
function toast(message, error = false) {
  const node = document.createElement('div');
  node.className = `toast${error ? ' error' : ''}`;
  node.textContent = message;
  document.querySelector('#toast-region').append(node);
  setTimeout(() => node.remove(), error ? 7000 : 4500);
}
async function mutate(path, data, message) {
  if (ui.busy) return;
  ui.busy = true;
  render();
  try {
    const result = await api(path, data);
    applyEnvelope(result);
    if (message) toast(message);
    return result;
  } catch (error) {
    toast(error.message, true);
  } finally {
    ui.busy = false;
    render();
  }
}

function shell() {
  const viewTitles = {
    cook: 'Cook together',
    pantry: 'My pantry',
    groceries: 'Grocery plan',
    history: 'Cooking history',
  };
  const session = ui.state.session;
  return `<div class="app-shell" ${ui.kitchen ? 'inert' : ''}>
    <aside class="sidebar" aria-label="Main navigation">
      <div class="brand" aria-label="Sophia"><span class="brand-mark" aria-hidden="true">s</span><span class="brand-word">sophia<span style="color:#a9b48f">.</span></span></div>
      <p class="sidebar-subtitle">A kitchen for everyone</p>
      <nav class="nav">${[
        ['cook', 'cook', 'Cook together'],
        ['pantry', 'pantry', 'My pantry'],
        ['groceries', 'bag', 'Grocery plan'],
        ['history', 'history', 'History'],
      ]
        .map(
          ([id, symbol, label]) =>
            `<button class="nav-item ${ui.view === id ? 'active' : ''}" data-view="${id}" ${ui.view === id ? 'aria-current="page"' : ''}>${icon(symbol, 18)}<span>${label}</span>${id === 'cook' && session?.status === 'cooking' ? '<span class="nav-dot"></span>' : ''}</button>`,
        )
        .join('')}</nav>
      <div class="sidebar-note">${icon('leaf', 24)}<h3>Good food.<br>Less repeated work.</h3><p>Cook a shared base, then make a little room for everyone's preferences.</p></div>
      <div class="sidebar-bottom"><span class="household-avatar">${esc((ui.state.household?.[0]?.name || 'S').slice(0, 1))}</span><div style="flex:1"><strong class="small">Our home kitchen</strong><p class="small muted">${ui.state.household?.length || 0} people · sample household</p></div><button class="text-button" data-action="reset" aria-label="Reset demo kitchen" title="Reset demo kitchen">${icon('reset', 15)}</button></div>
    </aside>
    <div class="workspace"><header class="topbar"><div class="breadcrumbs"><span class="crumb-root">My kitchen ${icon('chevron', 10)}</span> <strong>${viewTitles[ui.view]}</strong></div><div class="topbar-right">${ui.timer ? timerPill() : ''}<span class="simulation-pill"><span class="status-light"></span>Alexa+ web simulation</span>${micButton('topbar-mic')}<button class="assistant-toggle" data-action="focus-chat" aria-label="Ask Sophia">${icon('spark', 15)} Ask Sophia</button></div></header>
      <div class="page-layout"><main class="main-content" id="main-content" tabindex="-1">${{ cook: cookView, pantry: pantryView, groceries: groceriesView, history: historyView }[ui.view]()}<footer class="page-footer"><span>Built for the everyday joy of sharing a meal · Sample household</span><span class="footer-leaf">${icon('leaf', 12)} Thoughtfully together</span></footer></main>${aside()}</div>
    </div></div>
    <div class="voice-float">${voiceIndicator()}<span data-voice-status aria-hidden="true">${esc(voiceStatusText())}</span>${stopSpeakingButton('float')}</div>
    ${ui.kitchen ? kitchenView() : ''}`;
}

function welcome(title, subtitle, eyebrow = 'Your everyday kitchen') {
  return `<div class="welcome-row"><div><span class="eyebrow">${esc(eyebrow)}</span><h1>${title}</h1><p>${esc(subtitle)}</p></div><span class="today-stamp">${new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })}</span></div>`;
}

function cookView() {
  const session = ui.state.session;
  if (session?.status === 'cooking') return activeSession(session);
  return `${welcome('Good food, made together.', 'One shared start. A plate that feels right for everyone.')}
    ${session?.status === 'completed' ? `<div class="completed-card">${icon('check', 29)}<h2>A little something for everyone.</h2><p>${esc(session.title)} is recorded. Your pantry and grocery suggestions are updated.</p><button class="button button-primary" data-view="groceries">Plan my groceries ${icon('arrow', 14)}</button></div>` : `<section class="hero-card" aria-labelledby="hero-title"><div class="hero-copy"><span class="eyebrow">Different tastes. One kitchen.</span><h2 id="hero-title">Start together.<br>Finish your way.</h2><p>A shared meal doesn't have to mean the same plate. Let Sophia find the right moment to split.</p><button class="button button-primary" data-action="scroll-recipes">Let's cook something ${icon('arrow', 14)}</button></div><div class="hero-art">${foodArt('fried-rice', true)}</div><span class="floating-label">${icon('split', 11)} One base. Everyone's taste.</span></section>`}
    <div class="feature-strip"><div class="feature-item"><span class="feature-icon">${icon('people', 16)}</span><div><strong>Everyone considered</strong><p>Personal portions, together</p></div></div><div class="feature-item"><span class="feature-icon">${icon('split', 16)}</span><div><strong>Split at the right time</strong><p>Step-by-step guidance</p></div></div><div class="feature-item"><span class="feature-icon">${icon('bag', 16)}</span><div><strong>Plan from real meals</strong><p>Groceries with a reason</p></div></div></div>
    ${recipeBrowser()}
    ${planBuilder()}`;
}

function recipeBrowser() {
  const normalize = value =>
    String(value)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  const words = normalize(ui.recipeQuery).split(' ').filter(Boolean);
  const matches = ui.catalog.filter(
    d =>
      (ui.recipeCategory === 'All dishes' || d.category === ui.recipeCategory) &&
      words.every(word => normalize([d.name, ...(d.aliases || []), ...(d.ingredients || [])].join(' ')).includes(word)),
  );
  const pages = Math.max(1, Math.ceil(matches.length / 6));
  ui.recipePage = Math.min(ui.recipePage, pages - 1);
  const visible = matches.slice(ui.recipePage * 6, (ui.recipePage + 1) * 6);
  return `<section id="recipes"><div class="section-heading"><div><h2>What's on the menu?</h2><p>Everyday favourites, with room for everyone's taste.</p></div><span class="small muted">${ui.catalog.length} dishes</span></div>
    <div class="recipe-tools"><div class="field"><label for="recipe-search">Find a dish or ingredient</label><input type="search" id="recipe-search" placeholder="Try poha, paneer, dosa…" value="${esc(ui.recipeQuery)}" autocomplete="off"></div><p>Indian favourites & easy everyday meals<br>Vegetarian bases and egg options</p></div>
    <div class="recipe-filters" aria-label="Recipe categories">${['All dishes', ...new Set(ui.catalog.map(d => d.category))].map(category => `<button type="button" data-recipe-category="${esc(category)}" aria-pressed="${ui.recipeCategory === category}">${esc(category)}</button>`).join('')}</div>
    <p class="recipe-count" role="status">${matches.length ? `${ui.recipePage * 6 + 1}–${Math.min((ui.recipePage + 1) * 6, matches.length)} of ${matches.length} dishes` : 'No matching dishes. Try another name or ingredient.'}</p>
    <div class="dish-grid">${visible.map(d => `<button class="dish-card ${d.id === ui.dishId ? 'selected' : ''}" data-dish="${esc(d.id)}" aria-pressed="${d.id === ui.dishId}"><div class="dish-art ${esc(d.art || d.id)}">${foodArt(d.art || d.id)}<span class="dish-choose">${icon(d.id === ui.dishId ? 'check' : 'arrow', 13)}</span></div><div class="dish-info"><h3>${esc(d.name)}</h3><div class="dish-meta">${icon('clock', 11)} Timing varies <span style="margin:0 3px">·</span> ${esc(d.variants.length)} finishes</div><p class="dish-desc">${esc(d.description)}</p><span class="dish-tag">${esc(d.category)}</span></div></button>`).join('')}</div>
    ${pages > 1 ? `<div class="recipe-pagination"><button class="button button-small button-outline" data-action="recipes-prev" ${ui.recipePage === 0 ? 'disabled' : ''}>Previous</button><span>Page ${ui.recipePage + 1} of ${pages}</span><button class="button button-small button-outline" data-action="recipes-next" ${ui.recipePage === pages - 1 ? 'disabled' : ''}>Next dishes ${icon('arrow', 12)}</button></div>` : ''}</section>`;
}

function planBuilder() {
  const dish = selectedDish();
  if (!dish) return '';
  return `<form id="plan-form" class="plan-builder"><div class="builder-top"><div><h3>Who's coming to the table?</h3><p>${esc(dish.name)} · one named portion per serving</p></div><div class="serving-stepper" aria-label="Servings"><button type="button" data-action="fewer" ${ui.servings <= 1 || ui.busy ? 'disabled' : ''} aria-label="One fewer serving">−</button><span aria-live="polite">${ui.servings}</span><button type="button" data-action="more" ${ui.servings >= 6 || ui.busy ? 'disabled' : ''} aria-label="One more serving">+</button></div></div><div class="portion-builder">${ui.portions.map((p, i) => `<div class="portion-field"><label for="portion-name-${i}">Person ${i + 1}</label><input class="portion-name" id="portion-name-${i}" data-portion-name="${i}" name="person-${i}" value="${esc(p.name)}" required maxlength="40" aria-label="Name for portion ${i + 1}"><select data-portion-variant="${i}" aria-label="Dish variation for ${esc(p.name)}">${dish.variants.map(v => `<option value="${esc(v.id)}" ${p.variant === v.id ? 'selected' : ''}>${esc(v.label)}</option>`).join('')}</select></div>`).join('')}</div><div class="builder-footer"><p>Sophia will show shared steps and the point where each portion goes its own way.</p><button class="button button-primary" type="submit" ${ui.busy ? 'disabled' : ''}>${ui.busy ? 'Preparing…' : 'Build our cooking plan'} ${icon('arrow', 14)}</button></div></form>`;
}

function activeSession(session) {
  const steps = session.steps || [];
  const completed = steps.filter(s => s.status === 'completed').length;
  const next = steps.find(s => s.status !== 'completed');
  const isSplit = next?.phase === 'split' && !session.confirmedSplit;
  return `${welcome('Let’s make something good.', 'Follow the shared steps, then finish each portion your way.', 'Your cooking session')}
    <section class="session-banner"><span class="eyebrow">${session.servings} people · ${session.estimatedMinutes ? `About ${esc(session.estimatedMinutes)} min · ` : ''}${esc(session.recipeVersion ? `Recipe v${session.recipeVersion}` : 'Guided cooking')}</span><div class="session-heading"><div><h2>${esc(session.title)}</h2></div><div class="session-heading-side"><span class="status-badge">Cooking together</span><button class="button button-primary" id="open-kitchen" data-action="kitchen-open">${icon('expand', 15)} Kitchen mode</button><button class="button button-quiet" data-action="cancel-meal" ${ui.busy ? 'disabled' : ''}>Cancel meal</button></div></div><div class="progress-track" role="progressbar" aria-label="Cooking progress" aria-valuenow="${completed}" aria-valuemin="0" aria-valuemax="${steps.length}"><div class="progress-fill" style="width:${steps.length ? (completed / steps.length) * 100 : 0}%"></div></div><div class="session-progress"><span>${completed} of ${steps.length} steps complete</span><span>${session.confirmedSplit ? 'Portions separated' : 'Shared preparation'}</span></div></section>
    <div class="portion-lanes">${session.portions.map(p => `<div class="portion-lane">${icon('bowl', 20)}<h4>${esc(p.name)}'s plate</h4><p>${esc(variantLabel(session.dishId, p.variant))}</p></div>`).join('')}</div>
    ${session.recipeNote ? `<p class="notice">${esc(session.recipeNote)}</p>` : ''}
    <details class="ingredients-details"><summary>What you'll use <span>${session.ingredients?.length || 0} ingredients for ${session.servings} portions</span></summary><div class="ingredient-grid">${(session.ingredients || []).map(item => `<div><span>${esc(item.name)}</span><strong>${number(item.quantity)} ${esc(item.unit)}</strong></div>`).join('')}</div><p class="small muted">Quantities cover every portion.</p></details>
    ${session.shortages?.length ? `<p class="notice warm">Short on ${session.shortages.map(item => `${esc(item.name)} (${number(item.missingQuantity)} ${esc(item.unit)})`).join(', ')}.</p>` : ''}
    ${next ? `<section class="next-step-card"><span class="eyebrow">${isSplit ? 'The moment to split' : 'Your next step'}</span><h3>${esc(next.title)}</h3><p>${esc(next.instruction)}</p><div class="next-step-actions"><button class="button ${isSplit ? 'button-orange' : 'button-primary'}" data-action="complete-step" data-step="${esc(next.id)}" data-split="${isSplit}" ${ui.busy ? 'disabled' : ''}>${icon(isSplit ? 'split' : 'check', 15)} ${ui.busy ? 'Saving…' : isSplit ? 'I have separated the portions' : 'Done — next step'}</button>${ui.timer ? '' : timerControls(next, 'card')}</div>${ui.timer ? timerControls(next, 'card') : ''}</section>` : `<section class="next-step-card"><span class="eyebrow">Ready to serve</span><h3>Everyone's plate is ready.</h3><p>Confirm the meal to update your pantry and history.</p><button class="button button-primary" data-action="finish" ${ui.busy ? 'disabled' : ''}>${icon('check', 15)} Confirm meal cooked</button>${ui.timer ? timerControls(null, 'card') : ''}</section>`}
    <section class="timeline"><div class="timeline-heading"><h3>Your cooking path</h3><span class="small muted">Shared → separate → serve</span></div>${steps.map((step, i) => `<div class="step-row ${step.status === 'completed' ? 'completed' : next?.id === step.id ? 'current' : ''}"><span class="step-number">${step.status === 'completed' ? icon('check', 12) : i + 1}</span><div><h4>${esc(step.title)}${step.portion ? ` <span class="muted">· ${esc(step.portion)}</span>` : ''}</h4><p>${esc(step.instruction)}</p><span class="step-phase">${step.phase === 'split' ? 'Separate portions' : step.phase === 'shared' ? 'Shared preparation' : 'Personal finish'}</span></div><span class="step-time">${step.durationMinutes ? `${esc(step.durationMinutes)} min` : ''}</span></div>`).join('')}</section>
    <form class="alter-card" id="alter-form"><h3>Change of plans?</h3><p>Leave an ingredient out for everyone or for one plate.</p><div class="inline-form"><div class="field"><label for="omit-ingredient">Leave out</label><select id="omit-ingredient" name="omitIngredient" required>${(session.ingredients || []).map(ingredient => `<option value="${esc(ingredient.id)}">${esc(ingredient.name)}</option>`).join('')}</select></div><div class="field"><label for="alter-portion">For whom?</label><select id="alter-portion" name="portionName"><option value="">Everyone</option>${session.portions.map(p => `<option value="${esc(p.name)}">${esc(p.name)}</option>`).join('')}</select></div><button class="button button-outline" type="submit" ${ui.busy ? 'disabled' : ''}>Check this change</button></div><p class="notice warm">Preferences and allergies are different. Separating food later cannot remove an allergen or undo cross-contact.</p></form>
    <form class="alter-card" id="variant-form"><h3>A different finish?</h3><p>Switch a plate that isn't finished yet to another finish.</p><div class="inline-form"><div class="field"><label for="variant-person">Person</label><select name="portionName" id="variant-person">${session.portions.map(p => `<option value="${esc(p.name)}">${esc(p.name)}</option>`).join('')}</select></div><div class="field"><label for="new-variant">New finish</label><select name="variant" id="new-variant">${(ui.catalog.find(d => d.id === session.dishId)?.variants || []).map(v => `<option value="${esc(v.id)}">${esc(v.label)}</option>`).join('')}</select></div><button class="button button-outline" type="submit" ${ui.busy ? 'disabled' : ''}>Update this portion</button></div></form>`;
}

function pantryView() {
  const pantry = ui.state.pantry || [];
  const visiblePantry = pantry.filter(item => item.name.toLowerCase().includes(ui.pantryQuery.toLowerCase().trim()));
  return `${welcome('A little pantry awareness.', 'Keep quantities up to date so Sophia can plan around what you have.', 'Know what’s already here')}
    <div class="pantry-summary"><div><strong>${pantry.filter(p => Number(p.quantity) > 0).length}</strong><span>Ingredients in stock</span></div><div><strong>${pantry.filter(p => p.kind === 'staple').length}</strong><span>Pantry staples</span></div><div><strong>${pantry.filter(p => p.kind === 'fresh').length}</strong><span>Fresh ingredients</span></div></div>
    <div class="field pantry-search"><label for="pantry-search">Find an ingredient</label><input type="search" id="pantry-search" placeholder="Try paneer, oats, rice…" value="${esc(ui.pantryQuery)}"></div>
    ${!visiblePantry.length ? '<p class="notice">No matching ingredients in this recipe library.</p>' : ''}
    ${['staple', 'fresh']
      .filter(kind => visiblePantry.some(p => p.kind === kind))
      .map(
        kind =>
          `<section class="pantry-group"><div class="section-heading"><h3>${kind === 'staple' ? 'The everyday staples' : 'Fresh for the week'}</h3><span class="small muted">Quantity you confirm</span></div><div class="pantry-table">${visiblePantry
            .filter(p => p.kind === kind)
            .map(
              p =>
                `<form class="pantry-row" data-pantry-form="${esc(p.id)}"><span class="ingredient-icon">${icon(kind === 'staple' ? 'pantry' : 'leaf', 16)}</span><label class="pantry-name" for="quantity-${esc(p.id)}">${esc(p.name)}${p.source === 'recipe-library' && !p.confirmed ? '<small>Not recorded yet</small>' : ''}</label><input type="number" min="0" max="100000" step="any" value="${esc(p.quantity)}" id="quantity-${esc(p.id)}" name="quantity" required aria-label="${esc(p.name)} quantity"><span class="pantry-unit">${esc(p.unit)}</span><button type="submit" class="pantry-save" ${ui.busy ? 'disabled' : ''} aria-label="Save ${esc(p.name)} quantity">Save</button></form>`,
            )
            .join('')}</div></section>`,
      )
      .join('')}`;
}

function groceriesView() {
  const count = cookedHistory().length;
  return `${welcome('Next month, a little easier.', 'A useful shopping plan starts with what you actually cooked.', 'From your kitchen, with context')}
    <div class="hero-card" style="min-height:202px"><div class="hero-copy"><span class="eyebrow">Habits, not guesses</span><h2>Your meals.<br>Your grocery rhythm.</h2><p>Staples for the month. Fresh ingredients for each week. Every suggestion has a reason.</p></div><div class="hero-art" style="top:0;opacity:.7">${foodArt('wraps', true)}</div></div>
    <form class="forecast-form" id="forecast-form"><h3>Build a four-week grocery plan</h3><p>${count ? `Based on ${count} cooked meals${ui.state.demo?.enabled ? ', including sample meals' : ''}.` : 'Cook and confirm your first meal to start your history.'}</p><div class="inline-form"><div class="field"><label for="away-days">Days away in the next four weeks</label><input type="number" id="away-days" name="awayDays" min="0" max="28" value="${ui.awayDays}" required></div><div class="field"><label for="forecast-period">Planning period</label><select id="forecast-period" disabled><option>4 weeks · 28 days</option></select></div></div><label class="checkbox-label"><input type="checkbox" name="confirmPantry" ${ui.confirmPantry ? 'checked' : ''}><span>Subtract what's already in my pantry</span></label><button class="button button-primary" type="submit" ${ui.busy ? 'disabled' : ''}>${icon('bag', 14)} ${ui.busy ? 'Planning…' : 'Suggest my groceries'}</button></form>
    ${ui.forecast ? forecastResults(ui.forecast) : `<div class="empty-state">${icon('bag', 27)}<h3>A list with a reason.</h3><p>Monthly staples and a fresh list for each week.</p></div>`}
    ${savedShoppingView()}`;
}

function groceryRows(items) {
  if (!items?.length)
    return '<div class="grocery-row"><p class="small muted">Nothing to buy in this category.</p></div>';
  return items
    .map(
      item =>
        `<div class="grocery-row"><div><h4>${esc(item.name || item.ingredient || item.id)}</h4><p class="grocery-reason">${esc(item.reason || item.explanation || 'Based on ingredients used in confirmed meals.')}</p></div><span class="grocery-quantity">${item.firstWeekQuantity !== undefined && Number(item.firstWeekQuantity) !== Number(item.quantity) ? `${number(item.firstWeekQuantity)} ${esc(item.unit)}<small>First week</small><small>Later: ${number(item.quantity)} ${esc(item.unit)}/week</small>` : `${number(item.buyQuantity ?? item.quantity ?? item.suggestedQuantity ?? 0)} ${esc(item.unit)}`}</span></div>`,
    )
    .join('');
}
function forecastResults(forecast, { saved = false } = {}) {
  const monthly = forecast.monthly || forecast.staples || [];
  const weekly = forecast.weekly || forecast.fresh || [];
  const notes = (forecast.notes || [])
    .map(n => (typeof n === 'string' ? n : n.message || n.text || ''))
    .filter(Boolean);
  return `<section ${saved ? '' : 'aria-live="polite"'}><div class="forecast-head"><h3>${saved ? 'Your saved grocery estimates' : 'Your grocery suggestions'}</h3><span class="status-badge">${forecast.pantryApplied ? 'Confirmed stock deducted' : 'Before pantry deductions'}</span></div><p class="small muted" style="margin-bottom:15px">${esc(forecast.historyCount ?? cookedHistory().length)} confirmed meals · ${esc(forecast.weeks || 4)} weeks · ${esc(forecast.awayDays ?? ui.awayDays)} days away${forecast.demoHistoryCount ? ' · includes sample meals' : ''}</p><div class="forecast-lists"><div class="grocery-list"><div class="grocery-list-head"><span class="eyebrow">Buy for the month</span><h3>Pantry staples</h3><p>For ${esc(forecast.weeks || 4)} weeks</p></div>${groceryRows(monthly)}</div><div class="grocery-list fresh"><div class="grocery-list-head"><span class="eyebrow">Buy a little at a time</span><h3>Fresh, each week</h3><p>Per week</p></div>${groceryRows(weekly)}</div></div>${notes.length ? `<ul class="forecast-notes">${notes.map(n => `<li>${esc(n)}</li>`).join('')}</ul>` : ''}${saved ? '' : `<button class="button button-outline" data-action="save-shopping" ${ui.busy || (!monthly.length && !weekly.length) ? 'disabled' : ''}>${icon('check', 14)} Save this shopping plan</button>`}</section>`;
}

function savedShoppingView() {
  const saved = ui.state.shoppingPlan;
  if (saved && typeof saved === 'object') {
    const savedDate = new Date(saved.savedAt || saved.generatedAt);
    const when = Number.isFinite(savedDate.valueOf())
      ? savedDate.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
      : 'a previous session';
    return `<details class="ingredients-details" ${ui.forecast ? '' : 'open'}><summary>Saved shopping plan <span>Read-only snapshot</span></summary><p class="small muted">Saved ${esc(when)} · ${esc(saved.awayDays || 0)} days away</p>${forecastResults(saved, { saved: true })}</details>`;
  }
  const items = ui.state.shopping || [];
  if (!items.length) return '';
  const monthly = items.filter(item => item.cadence === 'monthly');
  const weekly = items.filter(item => item.cadence === 'weekly');
  const other = items.filter(item => !['monthly', 'weekly'].includes(item.cadence));
  return `<details class="ingredients-details" ${ui.forecast ? '' : 'open'}><summary>Previously saved shopping list <span>${items.length} saved items</span></summary><div class="forecast-lists">${monthly.length ? `<div class="grocery-list"><div class="grocery-list-head"><h3>Monthly staples</h3><p>Previously saved quantities</p></div>${groceryRows(monthly)}</div>` : ''}${weekly.length ? `<div class="grocery-list fresh"><div class="grocery-list-head"><h3>Fresh, each week</h3><p>Previously saved weekly quantities</p></div>${groceryRows(weekly)}</div>` : ''}${other.length ? `<div class="grocery-list"><div class="grocery-list-head"><h3>Saved quantities</h3><p>Planning period not recorded</p></div>${groceryRows(other)}</div>` : ''}</div></details>`;
}

function historyView() {
  const history = cookedHistory();
  const requests = (ui.state.requests || []).filter(
    request => !request.status || ['asked', 'planned'].includes(request.status),
  );
  const recent = [...history].sort(
    (a, b) =>
      new Date(b.cookedAt || b.completedAt || b.at || b.createdAt || 0) -
      new Date(a.cookedAt || a.completedAt || a.at || a.createdAt || 0),
  );
  return `${welcome('Your kitchen, remembered.', 'What you cooked helps Sophia make more useful plans next time.', 'A little history goes a long way')}
    ${ui.state.demo?.enabled ? `<div class="notice warm"><p>${esc(ui.state.demo.label || 'This demo includes sample cooking history.')}</p><button class="button button-small button-outline" data-action="clear-history" style="margin-top:11px">Start my own cooking history ${icon('arrow', 12)}</button></div>` : ''}
    <div class="history-stats"><div class="stat-card"><strong>${history.length}</strong><span>Confirmed meals</span></div><div class="stat-card"><strong>${history.reduce((sum, h) => sum + Number(h.servings || h.portions?.length || 0), 0)}</strong><span>Portions cooked</span></div><div class="stat-card"><strong>${requests.length}</strong><span>Meal requests</span></div></div>
    <div class="section-heading"><div><h2>Meals that made it to the table</h2></div></div>
    ${
      recent.length
        ? recent
            .map(
              h =>
                `<article class="history-item"><span class="history-icon">${icon('bowl', 21)}</span><div><h3>${esc(h.title || h.name || ui.catalog.find(d => d.id === h.dishId)?.name || 'Cooked meal')}</h3><p>${esc(h.servings || h.portions?.length || '—')} portions${
                  h.portions?.length
                    ? ` · ${h.portions
                        .map(p => esc(variantLabel(h.dishId, p.variant)))
                        .filter((v, i, a) => a.indexOf(v) === i)
                        .join(', ')}`
                    : ''
                }</p></div><div class="history-date">${date(h.cookedAt || h.completedAt || h.at || h.createdAt)}<br>${h.demo || h.sample || String(h.id).startsWith('seed') ? 'Sample meal' : 'Confirmed cooked'}</div></article>`,
            )
            .join('')
        : `<div class="empty-state">${icon('history', 28)}<h3>Your first meal starts the story.</h3><p>Choose a dish, follow the cooking steps, and confirm it was cooked to add it here.</p><button class="button button-primary" data-view="cook">Cook together ${icon('arrow', 14)}</button></div>`
    }
    ${
      requests.length
        ? `<div class="section-heading" style="margin-top:28px"><div><h2>Requests and plans</h2></div></div>${requests
            .slice(-4)
            .reverse()
            .map(
              r =>
                `<article class="history-item"><span class="history-icon">${icon('chat', 20)}</span><div><h3>${esc(r.title || ui.catalog.find(d => d.id === r.dishId)?.name || r.text || r.message || 'Meal request')}</h3><p>${esc(r.status || 'Requested')}</p></div><span class="history-date">${date(r.at || r.createdAt)}</span></article>`,
            )
            .join('')}`
        : ''
    }`;
}

function aside() {
  const activity = activityFeed(4);
  return `<aside class="aside" aria-label="Sophia assistant and kitchen activity"><section class="assistant-card" id="assistant"><div class="assistant-head"><div class="assistant-head-row"><div class="assistant-identity"><span class="assistant-orb" aria-hidden="true"></span><div><strong>Ask Sophia</strong><p>Your kitchen companion</p></div></div><span class="provider-badge" title="${esc(ui.provider.label)}">${ui.provider.mode === 'bedrock' ? 'AWS Bedrock' : 'Demo mode'}</span></div>${voiceRepliesButton()}</div><div class="chat-transcript" id="chat-transcript" role="log" aria-live="polite" aria-relevant="additions text">${ui.messages.map(m => `<div class="chat-entry ${m.role}"><div class="chat-entry-label">${m.role === 'assistant' ? icon('spark', 12) + ' Sophia' : m.voice ? icon('mic', 12) + ' You, by voice' : 'You'}</div><div class="chat-entry-body">${esc(m.content)}</div></div>`).join('')}${ui.busy ? '<div class="chat-entry"><div class="chat-entry-label">Sophia</div><div class="chat-entry-body">A moment, I’m checking your kitchen…</div></div>' : ''}</div><div class="chat-chips"><button class="chat-chip" data-chat="What can I cook with my pantry?">What can I cook with what I have?</button><button class="chat-chip" data-chat="What is my next cooking step?">Help me with my next step</button><button class="chat-chip" data-chat="How does the grocery forecast work?">Plan next month's groceries</button></div><form id="chat-form" class="chat-form"><label class="visually-hidden" for="chat-input">Ask Sophia</label><input id="chat-input" name="message" placeholder="Type, or tap the mic" maxlength="1500" autocomplete="off" required ${ui.busy ? 'disabled' : ''}>${micButton('chat-mic')}<button class="send-button" type="submit" aria-label="Send message" ${ui.busy ? 'disabled' : ''}>${icon('send', 15)}</button></form>${voiceBar()}</section>
    <section class="help-card"><span class="eyebrow">A little less guesswork</span><h3>Tomorrow's groceries,<br>from yesterday's meals.</h3><p>Suggestions learn from the meals you cook.</p><button class="text-button" data-view="groceries">Explore your grocery plan ${icon('arrow', 12)}</button></section>
    <section class="activity-card"><span class="eyebrow">Around your kitchen</span><ul class="activity-list">${activity.length ? activity.map(a => `<li><div>${esc(a.message)}${a.count > 1 ? ` <span class="activity-count" title="Repeated ${a.count} times">×${a.count}</span>` : ''}<time datetime="${esc(a.at)}">${date(a.at)}${a.count > 1 ? ' · latest' : ''}</time></div></li>`).join('') : '<li><div>Your kitchen is ready. Choose a dish to get started.</div></li>'}</ul><button class="text-button" data-action="reset" style="font-size:12px">Reset sample kitchen</button></section></aside>`;
}

function activityFeed(limit) {
  // Chat requests log the same notice every time; show each distinct message once, newest first.
  const groups = new Map();
  for (const item of [...(ui.state.activity || [])].reverse()) {
    const group = groups.get(item.message);
    if (group) group.count++;
    else groups.set(item.message, { ...item, count: 1 });
  }
  return [...groups.values()].slice(0, limit);
}

function voiceIndicator() {
  return '<span class="voice-indicator" aria-hidden="true"><i></i><i></i><i></i></span>';
}
function micButton(className = '') {
  const supported = Boolean(speechRecognition());
  return `<button type="button" class="mic-button ${className} ${supported ? '' : 'unsupported'}" data-action="mic" aria-pressed="${ui.voice.state === 'listening'}" aria-label="${supported ? 'Talk to Sophia. Tap, or hold while you speak.' : 'Voice input is not available in this browser'}" title="${supported ? 'Tap to talk, or hold while you speak' : 'Voice input needs Chrome, Edge or Safari'}">${icon('mic', className === 'mic-large' ? 34 : 17)}</button>`;
}
function handsFreeButton(className = '') {
  if (!speechRecognition()) return '';
  return `<button type="button" class="hands-free-toggle ${className} ${ui.voice.handsFree ? 'on' : ''}" data-action="hands-free" aria-pressed="${ui.voice.handsFree}" title="Keep listening between turns">Hands-free ${ui.voice.handsFree ? 'on' : 'off'}</button>`;
}
function voiceRepliesButton(className = '') {
  if (!canSpeak()) return '';
  return `<button type="button" class="voice-replies ${className} ${ui.speak ? 'on' : ''}" data-action="voice" aria-pressed="${ui.speak}" aria-label="Voice replies ${ui.speak ? 'on' : 'off'}" title="Sophia reads every reply and each new step aloud">${icon(ui.speak ? 'volume' : 'mute', 18)}<span>Voice replies ${ui.speak ? 'on' : 'off'}</span></button>`;
}
function stopSpeakingButton(className = '') {
  return `<button type="button" class="stop-speaking ${className}" data-action="stop-speaking">${icon('stop', 14)} Stop</button>`;
}
function voiceBar() {
  return `<div class="voice-bar">${voiceIndicator()}<span class="voice-status" data-voice-status>${esc(voiceStatusText())}</span>${stopSpeakingButton()}${handsFreeButton()}</div>`;
}

function timerPill() {
  const timer = ui.timer;
  return `<button class="timer-pill ${timer.done ? 'done' : ''}" data-action="timer-show" aria-label="${esc(timer.label)} timer">${icon('timer', 15)}<span data-timer-left>${timer.done ? '0:00' : clock(timer.endsAt - Date.now())}</span><span class="timer-pill-label">${timer.done ? 'Time’s up' : esc(timer.label)}</span></button>`;
}
function timerControls(step, kind) {
  const timer = ui.timer;
  if (timer) {
    const left = Math.max(0, timer.endsAt - Date.now());
    const digits = `<strong class="timer-digits" data-timer-left>${timer.done ? '0:00' : clock(left)}</strong>`;
    const ring = `<div class="timer-ring"><svg viewBox="0 0 120 120" aria-hidden="true"><circle cx="60" cy="60" r="52" class="ring-track"/><circle cx="60" cy="60" r="52" class="ring-fill" pathLength="100" data-timer-ring style="stroke-dashoffset:${timer.done ? 100 : 100 * (1 - left / timer.durationMs)}"/></svg>${digits}</div>`;
    return `<div class="timer-panel timer-${kind} ${timer.done ? 'done' : ''}" role="timer" aria-label="${esc(timer.label)} timer">${kind === 'kitchen' ? ring : `${icon('timer', 22)}${digits}`}<div class="timer-copy"><span class="timer-label">${timer.done ? 'Time’s up' : `${esc(durationText(timer.durationMs))} timer`}</span><span class="timer-for">${esc(timer.label)}</span><button class="button button-small ${kind === 'kitchen' ? 'timer-cancel' : 'button-outline'}" data-action="timer-cancel">${timer.done ? 'Dismiss' : 'Cancel timer'}</button></div></div>`;
  }
  if (!step?.durationMinutes) return '';
  return `<button class="button timer-start timer-${kind} ${kind === 'kitchen' ? '' : 'button-outline'}" data-action="timer-start" data-minutes="${esc(step.durationMinutes)}" data-label="${esc(step.title)}" data-step="${esc(step.id)}">${icon('timer', kind === 'kitchen' ? 26 : 15)} Start ${number(step.durationMinutes)}-minute timer</button>`;
}

function kitchenView() {
  const session = ui.state.session;
  const steps = session.steps || [];
  const completed = steps.filter(s => s.status === 'completed').length;
  const finished = session.status === 'completed';
  const next = finished ? null : steps.find(s => s.status !== 'completed');
  const isSplit = next?.phase === 'split' && !session.confirmedSplit;
  const dish = ui.catalog.find(d => d.id === session.dishId);
  const eyebrow = finished
    ? 'Meal recorded'
    : !next
      ? 'Ready to serve'
      : isSplit
        ? 'The moment to split'
        : next.phase === 'finish'
          ? `Personal finish · ${next.portion || 'one plate'}`
          : 'Shared preparation';
  const title = finished ? 'A little something for everyone.' : next ? next.title : 'Everyone’s plate is ready.';
  const text = finished
    ? `${session.title} is recorded. Your pantry and grocery suggestions are updated.`
    : next
      ? next.instruction
      : 'Confirm the meal to update your pantry and history.';
  const position = finished
    ? `All ${steps.length} steps complete`
    : next
      ? `Step ${steps.indexOf(next) + 1} of ${steps.length}`
      : `${steps.length} of ${steps.length} steps done`;
  const done = finished
    ? `<button class="kitchen-done" id="kitchen-done" data-action="kitchen-close">${icon('check', 30)} Back to my kitchen</button>`
    : next
      ? `<button class="kitchen-done ${isSplit ? 'split' : ''}" id="kitchen-done" data-action="complete-step" data-step="${esc(next.id)}" data-split="${isSplit}" ${ui.busy ? 'disabled' : ''}>${icon(isSplit ? 'split' : 'check', 30)} ${ui.busy ? 'Saving…' : isSplit ? 'Portions separated' : 'Done'}</button>`
      : `<button class="kitchen-done" id="kitchen-done" data-action="finish" ${ui.busy ? 'disabled' : ''}>${icon('check', 30)} ${ui.busy ? 'Saving…' : 'Confirm meal cooked'}</button>`;
  const note = ui.kitchenNote
    ? `<p class="kitchen-note"><span>You: “${esc(ui.kitchenNote.heard)}”</span> ${esc(ui.kitchenNote.reply)}</p>`
    : '';
  return `<div class="kitchen" role="dialog" aria-modal="true" aria-labelledby="kitchen-title">
    <header class="kitchen-top"><div class="kitchen-heading"><span class="brand-mark" aria-hidden="true">s</span><div><strong>${esc(session.title)}</strong><span>${esc(position)}</span></div></div>
      <div class="kitchen-progress" role="progressbar" aria-label="Cooking progress" aria-valuenow="${completed}" aria-valuemin="0" aria-valuemax="${steps.length}"><span style="width:${steps.length ? (completed / steps.length) * 100 : 0}%"></span></div>
      ${ui.timer && !finished ? timerPill() : ''}${voiceRepliesButton('kitchen-voice-replies')}<button class="kitchen-exit" data-action="kitchen-close" aria-label="Exit kitchen mode">${icon('close', 22)}<span>Exit</span></button></header>
    <div class="kitchen-main">
      <section class="kitchen-step ${isSplit ? 'split' : ''}" aria-live="polite"><span class="kitchen-eyebrow">${esc(eyebrow)}</span><h2 id="kitchen-title">${esc(title)}</h2><p class="kitchen-instruction">${esc(text)}</p>${note}</section>
      <aside class="kitchen-side" aria-label="Timer and portions">${finished ? '' : timerControls(next, 'kitchen')}
        <div><span class="kitchen-side-label">Who’s eating</span><ul class="kitchen-chips">${session.portions.map(p => `<li class="kitchen-chip ${next && (isSplit || next.portion === p.name) ? 'active' : ''}"><strong>${esc(p.name)}</strong><span>${esc(variantLabel(session.dishId, p.variant))}</span></li>`).join('')}</ul></div>
        <div class="kitchen-art">${foodArt(dish?.art || session.dishId)}</div></aside>
    </div>
    <footer class="kitchen-bottom">
      <div class="kitchen-voice">${micButton('mic-large')}<div class="kitchen-voice-copy"><strong data-voice-status>${esc(voiceStatusText())}</strong><span>Say “next”, “repeat”, “what’s next” or “start timer”.</span><div class="kitchen-toggles">${stopSpeakingButton('kitchen-toggle')}${handsFreeButton('kitchen-toggle')}</div></div></div>
      ${finished ? '' : `<button class="kitchen-repeat" data-action="repeat" aria-label="Repeat this step aloud">${icon('repeat', 24)}<span>Repeat</span></button>`}
      ${done}
    </footer></div>`;
}

function render() {
  if (!ui.state) return;
  const focused = document.activeElement;
  const focusId = focused?.id;
  const selection = focused?.selectionStart;
  const scroll = document.querySelector('#chat-transcript')?.scrollTop;
  if (ui.kitchen && !['cooking', 'completed'].includes(ui.state.session?.status)) closeKitchen(false);
  document.documentElement.classList.toggle('kitchen-open', ui.kitchen);
  app.innerHTML = shell();
  if (focusId && !ui.busy) {
    const replacement = document.getElementById(focusId);
    if (replacement) {
      replacement.focus({ preventScroll: true });
      if (typeof selection === 'number' && replacement.type !== 'number') {
        try {
          replacement.setSelectionRange(selection, selection);
        } catch {
          /* Select fields have no text selection. */
        }
      }
    }
  }
  const transcript = document.querySelector('#chat-transcript');
  if (transcript) transcript.scrollTop = scroll || 0;
}

async function sendChat(message, { spoken = false, heard = '' } = {}) {
  message = message.trim();
  if (!message) return;
  if (ui.busy) {
    if (spoken) voiceIdle('One moment, Sophia is still saving the last change.');
    return;
  }
  ui.messages.push({ role: 'user', content: message, ...(spoken ? { voice: true } : {}) });
  ui.busy = true;
  if (spoken) setVoiceState('thinking', heard || message);
  render();
  scrollChat();
  let reply;
  try {
    const result = await api('/api/chat', { message });
    applyEnvelope(result);
    if (result.forecast) {
      ui.forecast = result.forecast;
      ui.forecastConfig = {
        awayDays: result.forecast.awayDays || 0,
        confirmPantry: false,
        sourceRevision: result.sourceRevision ?? result.state?.revision ?? ui.state.revision,
      };
      ui.awayDays = result.forecast.awayDays || 0;
      ui.confirmPantry = false;
      ui.view = 'groceries';
    }
    reply = typeof result.reply === 'string' ? result.reply : result.reply?.text || 'Your kitchen is up to date.';
  } catch (error) {
    reply = `I couldn't complete that request: ${error.message}`;
    toast(error.message, true);
  }
  ui.messages.push({ role: 'assistant', content: reply });
  if (ui.kitchen) ui.kitchenNote = { heard: heard || message, reply };
  ui.busy = false;
  render();
  scrollChat();
  if (!spoken && !ui.kitchen) document.querySelector('#chat-input')?.focus({ preventScroll: true });
  // A spoken question always gets a spoken answer; typed questions follow the read-aloud toggle.
  if (spoken || ui.speak) speak(reply);
  else if (ui.voice.handsFree) voiceIdle();
}
function scrollChat() {
  const element = document.querySelector('#chat-transcript');
  if (element) element.scrollTop = element.scrollHeight;
}

/* Voice: push-to-talk or hands-free input through the Web Speech API. Recognised text goes to
   /api/chat exactly like a typed message; replies are read aloud with speechSynthesis. */
const speechRecognition = () => window.SpeechRecognition || window.webkitSpeechRecognition;
const voiceLang = /^en\b/i.test(navigator.language || '') ? navigator.language : 'en-US';
const VOICE_UNSUPPORTED =
  'Voice input isn’t available in this browser. Use Chrome, Edge or Safari to talk to Sophia, or type instead.';
const VOICE_ERRORS = {
  'not-allowed': 'Microphone access is blocked. Allow the microphone for this site in your browser, then try again.',
  'service-not-allowed': 'This browser won’t run speech recognition on this page. Try Chrome, or type instead.',
  'audio-capture': 'No microphone was found. Check that one is connected, or type instead.',
  network: 'Speech recognition couldn’t reach the browser’s speech service. Check your connection, or type instead.',
  'language-not-supported': 'Speech recognition doesn’t support this language here. Type instead.',
};
const voice = {
  recognition: null,
  pressedAt: 0,
  pointerStarted: false,
  restartTimer: 0,
  quickEnds: 0,
  speech: 0,
  pendingSpeech: 0,
  speakingSince: 0,
  pollyActive: false,
  pollySource: null,
  wakeLock: null,
};

function voiceStatusText() {
  const { state, detail, handsFree } = ui.voice;
  if (!speechRecognition()) return VOICE_UNSUPPORTED;
  if (state === 'listening')
    return detail ? `“${detail}”` : handsFree ? 'Listening… say “next”, “repeat” or “start timer”.' : 'Listening…';
  if (state === 'thinking') return `“${detail}” · thinking…`;
  if (state === 'speaking') return 'Speaking…';
  return (
    detail ||
    (handsFree
      ? 'Hands-free is on. Say “Sophia” before a question.'
      : 'Tap the mic to talk, or hold it while you speak.')
  );
}
function setVoiceState(state, detail = '') {
  ui.voice.state = state;
  ui.voice.detail = detail;
  document.documentElement.dataset.voice = state;
  const text = voiceStatusText();
  document.querySelectorAll('[data-voice-status]').forEach(node => {
    node.textContent = text;
  });
  document
    .querySelectorAll('[data-action="mic"]')
    .forEach(node => node.setAttribute('aria-pressed', String(state === 'listening')));
}
function voiceIdle(detail = '') {
  setVoiceState('idle', detail);
  if (ui.voice.handsFree) listenSoon();
}
function listenSoon(delay = 400) {
  clearTimeout(voice.restartTimer);
  voice.restartTimer = setTimeout(() => {
    if (!ui.voice.handsFree || voice.recognition) return;
    if (ui.busy || ['speaking', 'thinking'].includes(ui.voice.state)) return listenSoon(500);
    startListening();
  }, delay);
}

function startListening() {
  const Engine = speechRecognition();
  if (!Engine) {
    setVoiceState('idle');
    toast(VOICE_UNSUPPORTED, true);
    return;
  }
  if (voice.recognition) return;
  clearTimeout(voice.restartTimer);
  stopSpeaking();
  const recognition = new Engine();
  const started = Date.now();
  let heard = '',
    interim = '',
    failure = '';
  recognition.lang = voiceLang;
  recognition.interimResults = true;
  recognition.continuous = false;
  recognition.maxAlternatives = 1;
  recognition.onstart = () => {
    if (voice.recognition === recognition) setVoiceState('listening');
  };
  recognition.onresult = event => {
    if (voice.recognition !== recognition) return;
    const results = Array.from(event.results);
    heard = results
      .filter(r => r.isFinal)
      .map(r => r[0].transcript)
      .join(' ');
    interim = results
      .filter(r => !r.isFinal)
      .map(r => r[0].transcript)
      .join(' ');
    setVoiceState('listening', `${heard} ${interim}`.trim());
  };
  recognition.onerror = event => {
    failure = event.error;
  };
  recognition.onend = () => {
    if (voice.recognition !== recognition) return; // aborted on purpose, e.g. so Sophia can speak
    voice.recognition = null;
    const text = (heard || (failure ? '' : interim)).trim();
    if (text) {
      voice.quickEnds = 0;
      handleVoiceTranscript(text);
      return;
    }
    if (VOICE_ERRORS[failure]) {
      ui.voice.handsFree = false;
      render();
      setVoiceState('idle', VOICE_ERRORS[failure]);
      toast(VOICE_ERRORS[failure], true);
      return;
    }
    if (!ui.voice.handsFree) {
      setVoiceState('idle', failure === 'no-speech' ? 'I didn’t catch that. Tap the mic and try again.' : '');
      return;
    }
    voice.quickEnds = !failure && Date.now() - started < 1000 ? voice.quickEnds + 1 : 0;
    if (voice.quickEnds >= 3) {
      ui.voice.handsFree = false;
      render();
      setVoiceState('idle', 'Hands-free stopped because the microphone kept closing. Tap the mic to try again.');
      return;
    }
    voiceIdle();
  };
  voice.recognition = recognition;
  try {
    recognition.start();
  } catch {
    voice.recognition = null;
    setVoiceState('idle', 'Voice input couldn’t start. Try again in a moment.');
  }
}
function stopListening(abort = false) {
  const recognition = voice.recognition;
  if (!recognition) return;
  if (abort) {
    voice.recognition = null;
    recognition.abort();
    if (ui.voice.state === 'listening') setVoiceState('idle');
  } else recognition.stop();
}
function setHandsFree(on) {
  if (on && !speechRecognition()) {
    toast(VOICE_UNSUPPORTED, true);
    return;
  }
  ui.voice.handsFree = on;
  voice.quickEnds = 0;
  clearTimeout(voice.restartTimer);
  if (on) {
    unlockAudio();
    startListening();
  } else stopListening(true);
  render();
  setVoiceState(ui.voice.state);
  toast(
    on
      ? 'Hands-free is on. Say “next”, “repeat” or “start timer”. Start other questions with “Sophia”.'
      : 'Hands-free is off.',
  );
}

const NUMBER_WORDS = {
  a: 1,
  an: 1,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  fifteen: 15,
  twenty: 20,
  thirty: 30,
  'forty-five': 45,
  forty: 40,
  sixty: 60,
};
function voiceCommand(raw) {
  const wake = /^(?:(?:hey|hi|ok|okay)\s+)?sophia\b[\s,.:;!?-]*/i;
  const woke = wake.test(raw);
  const message = raw.replace(wake, '').trim();
  const t = message
    .toLowerCase()
    .replace(/[’`]/g, "'")
    .replace(/[.,!?;:]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^(?:please|can you|could you|would you)\s+/, '')
    .replace(/\s+(?:please|thanks|thank you)$/, '');
  if (!t) return { type: 'wake' };
  if (
    /^(?:repeat|repeat (?:that|this|it|the step|step|the instructions?)|say (?:that|it) again|again|come again|pardon|what did you say)$/.test(
      t,
    )
  )
    return { type: 'repeat' };
  if (/^(?:stop|stop talking|quiet|be quiet|silence|shh+|shush)$/.test(t)) return { type: 'stop' };
  if (/\btimer\b/.test(t)) {
    if (/\b(?:cancel|stop|clear|end|dismiss|delete|turn off|reset)\b/.test(t)) return { type: 'timer-stop' };
    if (/\b(?:how (?:much|long)|left|remaining)\b/.test(t)) return { type: 'timer-left' };
    const amount = t.match(
      /\b(\d+(?:\.\d+)?|an?|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty|forty-five|forty|sixty)[ -](second|sec|minute|min|hour)s?\b/,
    );
    const unit = !amount ? 0 : amount[2].startsWith('s') ? 1000 : amount[2] === 'hour' ? 3600000 : 60000;
    if (/\b(?:start|set|begin|run|put|make|create|add|new)\b|^(?:a |the )?timer$/.test(t) || amount)
      return { type: 'timer-start', ms: amount ? (Number(amount[1]) || NUMBER_WORDS[amount[1]]) * unit : 0 };
  }
  if (/^(?:how much time|how long)(?: is)? (?:left|remaining)$|^time (?:left|remaining)$/.test(t))
    return { type: 'timer-left' };
  if (
    /^(?:what'?s|what is)(?: the)? next(?: step)?$|^what now$|^what do (?:i|we) do (?:now|next)$|^(?:read|tell me) the (?:next|current) step$/.test(
      t,
    )
  )
    return { type: 'chat', message: 'What is next?' };
  if (
    /^(?:ok(?:ay)? )?(?:next|next step|go next|move on|done|i'?m done|we'?re done|step done|it'?s done|that'?s done|finished|i'?ve finished|ready for the next step)$/.test(
      t,
    )
  )
    return { type: 'chat', message: 'Next' };
  if (/^(?:exit|close|leave|quit) (?:the )?kitchen(?: mode| view)?$/.test(t)) return { type: 'kitchen-close' };
  if (/^(?:open|start|enter|show) (?:the )?kitchen(?: mode| view)?$|^kitchen mode$/.test(t))
    return { type: 'kitchen-open' };
  // Hands-free hears the whole room, so only the short cooking commands work without the wake word.
  if (ui.voice.handsFree && !woke) return { type: 'ignore' };
  return { type: 'chat', message };
}
function handleVoiceTranscript(raw) {
  const command = voiceCommand(raw);
  if (command.type === 'chat') return sendChat(command.message, { spoken: true, heard: raw });
  if (command.type === 'ignore') {
    setVoiceState('idle', `Heard “${raw}”. Say “Sophia” first to ask a question.`);
    return listenSoon(1800);
  }
  if (command.type === 'stop') return voiceIdle();
  if (command.type === 'repeat') return repeatStep();
  if (command.type === 'kitchen-close') {
    closeKitchen();
    return voiceIdle();
  }
  if (command.type === 'kitchen-open') {
    if (['cooking', 'completed'].includes(ui.state.session?.status)) {
      openKitchen();
      return voiceIdle();
    }
    return localReply(raw, 'Start a cooking plan first, then I can open kitchen mode.');
  }
  const replies = {
    wake: () => 'Yes? I’m listening.',
    'timer-start': () => voiceTimer(command.ms),
    'timer-stop': () => {
      const had = ui.timer;
      cancelTimer();
      return had ? 'Timer cancelled.' : 'There’s no timer running.';
    },
    'timer-left': timerLeftText,
  };
  return localReply(raw, replies[command.type]());
}
function localReply(heard, reply) {
  // Timer and repeat commands are answered in the browser; log them so the transcript stays complete.
  ui.messages.push({ role: 'user', content: heard, voice: true }, { role: 'assistant', content: reply });
  if (ui.kitchen) ui.kitchenNote = { heard, reply };
  render();
  scrollChat();
  speak(reply);
}

/* Voice replies. Browser speechSynthesis by default; an Amazon Polly voice when the server says provider.speech === 'polly'. */
const VOICE_KEY = 'sophia-voice-replies';
let preferredVoice = null;
function pickVoice() {
  const voices = window.speechSynthesis.getVoices();
  const english = voices.filter(v => /^en(?:[-_]|$)/i.test(v.lang));
  preferredVoice =
    english.find(v => /^en[-_]IN$/i.test(v.lang)) || english.find(v => /Natural|Google|Online/i.test(v.name)) || null;
}
if ('speechSynthesis' in window) {
  pickVoice();
  window.speechSynthesis.addEventListener?.('voiceschanged', pickVoice);
}
function saveVoicePreference() {
  try {
    localStorage.setItem(VOICE_KEY, ui.speak ? 'on' : 'off');
  } catch {
    /* The choice still applies to this page. */
  }
}
function restoreVoicePreference() {
  try {
    ui.speak = localStorage.getItem(VOICE_KEY) === 'on';
  } catch {
    /* Voice replies stay off without storage. */
  }
}
const canSpeak = () => 'speechSynthesis' in window || ui.provider?.speech === 'polly';
function speechText(text) {
  // Replies can carry markdown or emoji; neither should be read out.
  return String(text)
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^\s*(?:[-*•]|#{1,6})\s+/gm, '')
    .replace(/[*_`~#>|]+/g, ' ')
    .replace(/[\p{Extended_Pictographic}\p{Emoji_Modifier}\u{1F1E6}-\u{1F1FF}\u{E0020}-\u{E007F}⃣️‍]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function speak(text, { queue = false } = {}) {
  text = speechText(text || '');
  if (!text || !canSpeak()) return voiceIdle();
  stopListening(true);
  clearTimeout(voice.restartTimer);
  if (!queue || voice.pollyActive) haltSpeech();
  const id = voice.speech;
  voice.speakingSince = Date.now();
  setVoiceState('speaking');
  if (ui.provider?.speech !== 'polly') return speakWithBrowser(text, id);
  speakWithPolly(text, id).catch(() => {
    voice.pollyActive = false;
    if (id === voice.speech) speakWithBrowser(text, id);
  });
}
function speakWithBrowser(text, id) {
  if (!('speechSynthesis' in window)) return speechFinished();
  // Chrome cuts off long utterances, so speak sentence-sized pieces.
  const parts = [];
  for (const sentence of text.match(/[^.!?…]+[.!?…]*[”"’)]*\s*/g) || [text]) {
    if (parts.length && parts[parts.length - 1].length + sentence.length < 200) parts[parts.length - 1] += sentence;
    else parts.push(sentence);
  }
  voice.pendingSpeech += parts.length;
  for (const part of parts) {
    const utterance = new SpeechSynthesisUtterance(part.trim());
    utterance.rate = 0.95;
    if (preferredVoice) utterance.voice = preferredVoice;
    utterance.lang = preferredVoice?.lang || voiceLang;
    utterance.onend = utterance.onerror = () => {
      if (id === voice.speech && --voice.pendingSpeech <= 0) speechFinished();
    };
    window.speechSynthesis.speak(utterance);
  }
}
async function speakWithPolly(text, id) {
  // Played through Web Audio: the page's CSP (default-src 'self') would block a data: or blob: <audio> source.
  voice.pollyActive = true;
  const context = unlockAudio();
  if (!context) throw new Error('No Web Audio');
  const response = await fetch('/api/speak', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  });
  const result = await response.json();
  if (!response.ok || typeof result.audio !== 'string') throw new Error(result.error || 'No audio returned');
  const bytes = Uint8Array.from(atob(result.audio), ch => ch.charCodeAt(0));
  const buffer = await context.decodeAudioData(bytes.buffer);
  await Promise.race([context.resume(), new Promise(resolve => setTimeout(resolve, 300))]);
  if (context.state !== 'running') throw new Error('Audio is not allowed to play yet');
  if (id !== voice.speech) return; // interrupted while the audio was loading
  const source = context.createBufferSource();
  source.buffer = buffer;
  source.connect(context.destination);
  source.onended = () => {
    if (voice.pollySource === source) voice.pollySource = null;
    if (id === voice.speech) {
      voice.pollyActive = false;
      speechFinished();
    }
  };
  voice.pollySource = source;
  source.start();
}
function haltSpeech() {
  voice.speech++;
  voice.pendingSpeech = 0;
  voice.pollyActive = false;
  try {
    voice.pollySource?.stop();
  } catch {
    /* Already finished. */
  }
  voice.pollySource = null;
  if ('speechSynthesis' in window) window.speechSynthesis.cancel();
}
function speechFinished() {
  voice.pendingSpeech = 0;
  if (ui.voice.state === 'speaking') voiceIdle();
}
function stopSpeaking() {
  haltSpeech();
  if (ui.voice.state === 'speaking') setVoiceState('idle');
}
function currentStep() {
  const session = ui.state?.session;
  return session?.status === 'cooking' ? session.steps.find(s => s.status !== 'completed') : null;
}
function repeatStep() {
  const session = ui.state?.session;
  const step = currentStep();
  if (step)
    return speak(
      `Step ${session.steps.indexOf(step) + 1} of ${session.steps.length}. ${step.title}. ${step.instruction}${step.durationMinutes && !ui.timer ? ` Say “start timer” for a ${number(step.durationMinutes)}-minute timer.` : ''}`,
    );
  if (session?.status === 'cooking')
    return speak('Every step is done. When everyone’s plate is ready, confirm the meal is cooked.');
  speak([...ui.messages].reverse().find(m => m.role === 'assistant')?.content || 'What shall we make together?');
}

/* Step timers run entirely in the browser. One timer at a time keeps the kitchen view readable. */
const TIMER_KEY = 'sophia-timer';
const baseTitle = document.title;
let audio = null,
  scheduledChime = null;
function clock(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600),
    m = Math.floor((total % 3600) / 60),
    s = total % 60;
  return `${h ? `${h}:${String(m).padStart(2, '0')}` : m}:${String(s).padStart(2, '0')}`;
}
function durationText(ms) {
  return ms < 60000 ? `${Math.round(ms / 1000)}-second` : `${number(ms / 60000)}-minute`;
}
function spokenDuration(ms) {
  const total = Math.max(0, Math.round(ms / 1000)),
    m = Math.floor(total / 60),
    s = total % 60;
  const part = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
  return m && s ? `${part(m, 'minute')} and ${part(s, 'second')}` : m ? part(m, 'minute') : part(s, 'second');
}
function saveTimer() {
  try {
    if (ui.timer) localStorage.setItem(TIMER_KEY, JSON.stringify(ui.timer));
    else localStorage.removeItem(TIMER_KEY);
  } catch {
    /* The timer still runs for this page without storage. */
  }
}
function restoreTimer() {
  try {
    const saved = JSON.parse(localStorage.getItem(TIMER_KEY) || 'null');
    if (saved && Number.isFinite(saved.endsAt) && saved.durationMs > 0 && Date.now() - saved.endsAt < 10 * 60000)
      ui.timer = saved;
  } catch {
    /* A missing or unreadable saved timer just means no timer. */
  }
}
function startTimer(ms, label, stepId = null) {
  if (!(ms > 0)) return 'Tell me how long, for example “start a 5-minute timer”.';
  unlockAudio();
  stopChime();
  ui.timer = { label, stepId, durationMs: ms, endsAt: Date.now() + ms, done: false };
  saveTimer();
  scheduleTimerChime();
  render();
  tick();
  return `${durationText(ms).replace(/^./, c => c.toUpperCase())} timer started for ${label}.`;
}
function voiceTimer(ms) {
  if (ui.timer && !ui.timer.done)
    return `A timer for ${ui.timer.label} is already running with ${spokenDuration(ui.timer.endsAt - Date.now())} left. Say “cancel timer” first.`;
  const step = currentStep();
  if (ms > 0) return startTimer(ms, step?.title || 'Kitchen timer', step?.id);
  if (step?.durationMinutes) return startTimer(step.durationMinutes * 60000, step.title, step.id);
  return 'Tell me how long, for example “start a 5-minute timer”.';
}
function cancelTimer() {
  stopChime();
  ui.timer = null;
  saveTimer();
  render();
  updateTitle();
}
function timerLeftText() {
  const timer = ui.timer;
  if (!timer) return 'There’s no timer running.';
  return timer.done
    ? `Your timer for ${timer.label} is done.`
    : `${spokenDuration(timer.endsAt - Date.now())} left on the ${timer.label} timer.`;
}
function timerFinished() {
  const timer = ui.timer;
  timer.done = true;
  saveTimer();
  // Keep a booked chime that has played or is about to; otherwise ring now.
  if (!(scheduledChime?.timer === timer && scheduledChime.at <= audio.currentTime + 1.5)) {
    stopChime();
    chime();
  }
  scheduledChime = null;
  navigator.vibrate?.([300, 150, 300]);
  const message = `Time’s up. Your ${durationText(timer.durationMs)} timer for ${timer.label} is done.`;
  toast(message);
  render();
  setTimeout(() => {
    if (ui.timer === timer) speak(message, { queue: ui.voice.state === 'speaking' });
  }, 1500);
}
function tick() {
  const timer = ui.timer;
  if (timer) {
    const left = Math.max(0, timer.endsAt - Date.now());
    const text = timer.done ? '0:00' : clock(left);
    document.querySelectorAll('[data-timer-left]').forEach(node => {
      if (node.textContent !== text) node.textContent = text;
    });
    document.querySelectorAll('[data-timer-ring]').forEach(node => {
      node.style.strokeDashoffset = String(timer.done ? 100 : 100 * (1 - left / timer.durationMs));
    });
    if (!timer.done && left <= 0) timerFinished();
  }
  updateTitle();
  // Some browsers never fire the last utterance's end event; don't leave hands-free waiting on it.
  if (
    ui.voice.state === 'speaking' &&
    !voice.pollyActive &&
    Date.now() - voice.speakingSince > 2000 &&
    !window.speechSynthesis?.speaking &&
    !window.speechSynthesis?.pending
  )
    speechFinished();
}
function updateTitle() {
  const timer = ui.timer;
  const title = !timer
    ? baseTitle
    : timer.done
      ? `Time’s up · ${baseTitle}`
      : `${clock(timer.endsAt - Date.now())} · ${baseTitle}`;
  if (document.title !== title) document.title = title;
}
function unlockAudio() {
  // Browsers only start audio after a tap or key press, so every voice and timer control calls this first.
  const Context = window.AudioContext || window.webkitAudioContext;
  if (!Context) return null;
  try {
    audio ||= new Context();
    if (audio.state === 'suspended') audio.resume().catch(() => {});
  } catch {
    audio = null;
  }
  return audio;
}
function chime(delaySeconds = 0) {
  if (!audio) return [];
  const start = audio.currentTime + Math.max(0, delaySeconds);
  const nodes = [];
  [0, 1].forEach(round =>
    [880, 1108.73, 1318.51].forEach((frequency, i) => {
      const at = start + round * 0.9 + i * 0.16;
      const tone = audio.createOscillator();
      const gain = audio.createGain();
      tone.type = 'sine';
      tone.frequency.value = frequency;
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(0.28, at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 1.1);
      tone.connect(gain).connect(audio.destination);
      tone.start(at);
      tone.stop(at + 1.2);
      nodes.push(gain);
    }),
  );
  return nodes;
}
async function scheduleTimerChime() {
  // The audio clock keeps time in a background tab, where timers are throttled, so book the chime in advance.
  stopChime();
  const timer = ui.timer;
  if (!audio || !timer || timer.done) return;
  try {
    await audio.resume();
  } catch {
    return;
  }
  if (audio.state !== 'running' || ui.timer !== timer || timer.done) return;
  const delay = (timer.endsAt - Date.now()) / 1000;
  scheduledChime = { timer, at: audio.currentTime + delay, nodes: chime(delay) };
}
function stopChime() {
  scheduledChime?.nodes.forEach(node => node.disconnect());
  scheduledChime = null;
}

/* Kitchen mode: one step at a time, readable from across the room. */
function openKitchen() {
  if (!['cooking', 'completed'].includes(ui.state.session?.status)) return;
  ui.kitchen = true;
  ui.kitchenNote = null;
  keepAwake(true);
  render();
  document.querySelector('#kitchen-done')?.focus({ preventScroll: true });
  if (ui.speak) repeatStep();
}
function closeKitchen(redraw = true) {
  ui.kitchen = false;
  ui.kitchenNote = null;
  keepAwake(false);
  if (!redraw) return;
  render();
  document.querySelector('#open-kitchen')?.focus({ preventScroll: true });
}
async function keepAwake(on) {
  try {
    if (on && !voice.wakeLock && 'wakeLock' in navigator && document.visibilityState === 'visible') {
      voice.wakeLock = await navigator.wakeLock.request('screen');
      voice.wakeLock.addEventListener('release', () => {
        voice.wakeLock = null;
      });
    }
    if (!on && voice.wakeLock) {
      const lock = voice.wakeLock;
      voice.wakeLock = null;
      await lock.release();
    }
  } catch {
    /* Keeping the screen on is a convenience; kitchen mode works without it. */
  }
}

app.addEventListener('click', async event => {
  const button = event.target.closest('button');
  if (!button || button.disabled) return;
  if (button.dataset.view) {
    ui.view = button.dataset.view;
    render();
    window.scrollTo({ top: 0, behavior: 'smooth' });
    return;
  }
  if (button.dataset.dish) {
    ui.dishId = button.dataset.dish;
    initPortions();
    render();
    document.querySelector('#plan-form')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return;
  }
  if (button.dataset.recipeCategory) {
    ui.recipeCategory = button.dataset.recipeCategory;
    ui.recipePage = 0;
    render();
    return;
  }
  if (button.dataset.chat) {
    sendChat(button.dataset.chat);
    return;
  }
  const action = button.dataset.action;
  if (action === 'recipes-prev' || action === 'recipes-next') {
    ui.recipePage += action === 'recipes-next' ? 1 : -1;
    render();
    document.querySelector('#recipes')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    return;
  }
  if (action === 'more' || action === 'fewer') {
    ui.servings = Math.min(6, Math.max(1, ui.servings + (action === 'more' ? 1 : -1)));
    initPortions();
    render();
  }
  if (action === 'scroll-recipes')
    document.querySelector('#recipes')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  if (action === 'focus-chat') {
    document.querySelector('#assistant')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    document.querySelector('#chat-input')?.focus({ preventScroll: true });
  }
  if (action === 'voice') {
    ui.speak = !ui.speak;
    saveVoicePreference();
    unlockAudio();
    render();
    if (ui.speak) speak('Voice replies are on.');
    else {
      stopSpeaking();
      toast('Voice replies off. Sophia answers aloud only when you talk to her.');
    }
    return;
  }
  if (action === 'stop-speaking') {
    stopSpeaking();
    if (ui.voice.handsFree) listenSoon();
    return;
  }
  if (action === 'mic') {
    unlockAudio();
    if (voice.pointerStarted) {
      voice.pointerStarted = false;
      return;
    }
    if (voice.recognition) stopListening();
    else startListening();
    return;
  }
  if (action === 'hands-free') {
    setHandsFree(!ui.voice.handsFree);
    return;
  }
  if (action === 'repeat') {
    unlockAudio();
    repeatStep();
    return;
  }
  if (action === 'kitchen-open') {
    openKitchen();
    return;
  }
  if (action === 'kitchen-close') {
    closeKitchen();
    return;
  }
  if (action === 'timer-start') {
    toast(
      startTimer(
        Number(button.dataset.minutes) * 60000,
        button.dataset.label || 'Kitchen timer',
        button.dataset.step || null,
      ),
    );
    return;
  }
  if (action === 'timer-cancel') {
    cancelTimer();
    return;
  }
  if (action === 'timer-show') {
    if (ui.kitchen) {
      document.querySelector('.kitchen .timer-panel')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    if (ui.state.session?.status === 'cooking') {
      ui.view = 'cook';
      render();
      document.querySelector('.next-step-card')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    return;
  }
  if (action === 'reset') document.querySelector('#reset-dialog').showModal();
  if (action === 'clear-history') document.querySelector('#history-dialog').showModal();
  if (action === 'cancel-meal') document.querySelector('#cancel-dialog').showModal();
  if (action === 'complete-step') {
    const done = await mutate(
      '/api/step',
      { stepId: button.dataset.step, confirmSplit: button.dataset.split === 'true' },
      button.dataset.split === 'true'
        ? 'Portions separated. Let’s finish each plate.'
        : 'Step completed. Your next step is ready.',
    );
    if (ui.kitchen) document.querySelector('#kitchen-done')?.focus({ preventScroll: true });
    if (done && ui.speak) repeatStep();
  }
  if (action === 'finish') {
    const done = await mutate('/api/finish', {}, 'Meal recorded. Your pantry and cooking history are updated.');
    if (ui.kitchen) document.querySelector('#kitchen-done')?.focus({ preventScroll: true });
    if (done && ui.speak) speak('Meal recorded. Enjoy your food.');
  }
  if (action === 'save-shopping' && ui.forecast) {
    if (!Number.isInteger(ui.forecastConfig?.sourceRevision))
      return toast('Generate a fresh grocery plan before saving it.', true);
    await mutate(
      '/api/shopping',
      {
        revision: ui.forecastConfig.sourceRevision,
        awayDays: ui.forecastConfig.awayDays,
        confirmPantry: ui.forecastConfig.confirmPantry === true,
      },
      'Shopping plan saved.',
    );
  }
});

// Hold the mic to talk; a quick tap listens until you stop speaking.
app.addEventListener('pointerdown', event => {
  if (event.button !== 0 || !event.target.closest('[data-action="mic"]')) return;
  unlockAudio();
  voice.pressedAt = Date.now();
  voice.pointerStarted = !voice.recognition;
  if (voice.pointerStarted) startListening();
});
document.addEventListener('pointerup', () => {
  if (!voice.pressedAt) return;
  const held = Date.now() - voice.pressedAt;
  voice.pressedAt = 0;
  if (held > 600 && voice.pointerStarted && voice.recognition) stopListening();
  setTimeout(() => {
    voice.pointerStarted = false;
  }); // after the click that follows, or if the pointer slid off
});
app.addEventListener('contextmenu', event => {
  if (event.target.closest('[data-action="mic"]')) event.preventDefault();
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && ui.kitchen) {
    event.preventDefault();
    closeKitchen();
  }
});
document.addEventListener('visibilitychange', () => {
  if (ui.kitchen) keepAwake(true);
});
// A timer restored after a reload can only book its chime once the page has been touched.
document.addEventListener('pointerdown', () => {
  if (ui.timer && !ui.timer.done && !scheduledChime) {
    unlockAudio();
    scheduleTimerChime();
  }
  if (ui.speak && ui.provider?.speech === 'polly') unlockAudio(); // Polly audio plays through Web Audio, which needs a tap first
});

app.addEventListener('input', event => {
  const input = event.target;
  if (input.id === 'chat-input' && ui.voice.state === 'speaking') stopSpeaking(); // typing interrupts Sophia
  if (input.id === 'recipe-search') {
    ui.recipeQuery = input.value;
    ui.recipePage = 0;
    render();
    return;
  }
  if (input.id === 'pantry-search') {
    ui.pantryQuery = input.value;
    render();
    return;
  }
  if (input.dataset.portionName !== undefined) ui.portions[Number(input.dataset.portionName)].name = input.value;
  if (input.id === 'away-days') ui.awayDays = Number(input.value);
});
app.addEventListener('change', event => {
  if (event.target.dataset.portionVariant !== undefined)
    ui.portions[Number(event.target.dataset.portionVariant)].variant = event.target.value;
  if (event.target.name === 'confirmPantry') ui.confirmPantry = event.target.checked;
});

app.addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.target;
  const formData = new FormData(form);
  if (form.id === 'chat-form') return sendChat(String(formData.get('message') || ''));
  if (ui.busy) return;
  if (form.id === 'plan-form') {
    const names = ui.portions.map(p => p.name.trim().toLowerCase());
    if (new Set(names).size !== names.length)
      return toast('Give each portion a different name so Sophia can keep them separate.', true);
    await mutate(
      '/api/plan',
      {
        dishId: ui.dishId,
        servings: ui.servings,
        portions: ui.portions.map(p => ({ name: p.name.trim(), variant: p.variant })),
      },
      'Your cooking plan is ready. Start with the shared preparation.',
    );
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  if (form.dataset.pantryForm)
    await mutate(
      '/api/pantry',
      { id: form.dataset.pantryForm, quantity: Number(formData.get('quantity')) },
      'Pantry quantity saved.',
    );
  if (form.id === 'alter-form')
    await mutate(
      '/api/alter',
      {
        omitIngredient: String(formData.get('omitIngredient')),
        ...(formData.get('portionName') ? { portionName: String(formData.get('portionName')) } : {}),
      },
      'Cooking plan updated. Review the remaining steps.',
    );
  if (form.id === 'variant-form')
    await mutate(
      '/api/alter',
      { variant: String(formData.get('variant')), portionName: String(formData.get('portionName')) },
      'That portion has a new finish. Review the updated plan.',
    );
  if (form.id === 'forecast-form') {
    ui.awayDays = Number(formData.get('awayDays'));
    ui.confirmPantry = formData.has('confirmPantry');
    const config = { weeks: 4, awayDays: ui.awayDays, confirmPantry: ui.confirmPantry };
    const result = await mutate('/api/forecast', config);
    if (result?.forecast) {
      ui.forecast = result.forecast;
      ui.forecastConfig = { ...config, sourceRevision: result.sourceRevision ?? ui.state.revision };
      render();
      toast('Your grocery suggestions are ready to review.');
    }
  }
});

document.querySelector('#reset-dialog').addEventListener('close', async event => {
  if (event.target.returnValue !== 'confirm') return;
  const result = await mutate('/api/reset', {}, 'Sample kitchen restored.');
  if (result) {
    ui.forecast = null;
    ui.view = 'cook';
    ui.messages = [{ role: 'assistant', content: 'A fresh start.\nWhat shall we make together?' }];
    initPortions();
    render();
  }
});

document.querySelector('#cancel-dialog').addEventListener('close', async event => {
  if (event.target.returnValue !== 'confirm') return;
  const result = await mutate('/api/cancel', {}, 'Meal cancelled. Nothing was recorded as cooked.');
  if (result) {
    ui.view = 'cook';
    initPortions();
    render();
  }
});

document.querySelector('#history-dialog').addEventListener('close', async event => {
  if (event.target.returnValue !== 'confirm') return;
  const result = await mutate(
    '/api/clear-history',
    {},
    'Cooking history cleared. Your next confirmed meal starts your own record.',
  );
  if (result) {
    ui.forecast = null;
    render();
  }
});

/** Bring back the saved chat after a reload, and say where the cook left off. */
function restoreConversation() {
  const turns = (ui.state.conversation || []).filter(
    turn => (turn.role === 'user' || turn.role === 'assistant') && typeof turn.content === 'string' && turn.content,
  );
  const session = ui.state.session;
  const step = session?.status === 'cooking' ? session.steps.find(s => s.status !== 'completed') : null;
  if (!turns.length && !step) return;
  ui.messages = turns.map(turn => ({ role: turn.role, content: turn.content }));
  if (step)
    ui.messages.push({
      role: 'assistant',
      content: `Welcome back. You're cooking ${session.title}. Next: ${step.title}.`,
    });
  else ui.messages.push({ role: 'assistant', content: 'Welcome back. What shall we make together?' });
}

async function boot() {
  try {
    const initialLoad = ui.state === null;
    applyEnvelope(await api('/api/state'));
    if (initialLoad && ui.state.shoppingPlan) {
      ui.awayDays = ui.state.shoppingPlan.awayDays || 0;
      ui.confirmPantry = ui.state.shoppingPlan.confirmPantry === true;
    }
    ui.servings = Math.min(6, Math.max(1, ui.state.household?.length || 3));
    ui.dishId = ui.catalog[0]?.id || 'fried-rice';
    initPortions();
    if (initialLoad) {
      restoreConversation();
      restoreTimer();
      restoreVoicePreference();
      setVoiceState('idle');
      setInterval(tick, 250);
    }
    render();
    if (initialLoad) scrollChat();
  } catch (error) {
    app.innerHTML = `<div class="boot-screen"><span class="brand-mark">s</span><h1>Your kitchen needs a moment.</h1><p>${esc(error.message)}</p><button class="button button-primary" id="retry-connection">Try again ${icon('arrow', 14)}</button></div>`;
    document.querySelector('#retry-connection').addEventListener('click', boot);
  }
}
boot();
