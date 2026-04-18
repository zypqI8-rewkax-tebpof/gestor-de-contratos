/*
  app.js — Gestor de Presupuestos (versión con Dashboard + Login + Logout)
  ----------------------------------------------------------------------
  ✅ Router de vistas (app-like)
  ✅ Modales apilables
  ✅ Dashboard separado (dashboard.js) + evento app:data-changed
  ✅ Login con PIN (overlay) + Cerrar sesión
  ✅ Guardar presupuesto -> ir a Historial + limpiar formulario + siguiente número
  ✅ PDF limpio (ventana dedicada)
  ✅ 100% localStorage
*/

// ============================
// Helpers
// ============================
const $ = (sel, root=document) => root.querySelector(sel);
const $$ = (sel, root=document) => [...root.querySelectorAll(sel)];

function escapeHtml(str){
  return String(str ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function clamp(n, min, max){ return Math.min(Math.max(n, min), max); }
function todayISO(){
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth()+1).padStart(2,'0');
  const dd = String(d.getDate()).padStart(2,'0');
  return `${yyyy}-${mm}-${dd}`;
}
function pad(n, len=4){ return String(n).padStart(len,'0'); }

// Soporta 10.5 / 10,5 / 1.234,56
function parseDecimalSmart(v){
  if(v === null || v === undefined) return 0;
  if(typeof v === 'number') return Number.isFinite(v) ? v : 0;
  let s = String(v).trim();
  if(!s) return 0;
  s = s.replace(/[^\d.,\-]/g,'');
  const hasComma = s.includes(',');
  const hasDot = s.includes('.');
  if(hasComma && hasDot) s = s.replace(/\./g,'').replace(',', '.');
  else if(hasComma && !hasDot) s = s.replace(',', '.');
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}
function parseGs(v){
  if(v === null || v === undefined) return 0;
  if(typeof v === 'number') return Number.isFinite(v) ? Math.round(v) : 0;
  let s = String(v).trim();
  if(!s) return 0;
  s = s.replace(/[^\d\-]/g,'');
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n) : 0;
}

function getCurrency(){ return $('#currency')?.value || 'PYG'; }
function parsePrice(v){ return (getCurrency()==='USD') ? parseDecimalSmart(v) : parseGs(v); }
function money(v, currency=null){
  const cur = currency || getCurrency();
  const digits = (cur === 'USD') ? 2 : 0;
  return new Intl.NumberFormat('es-PY', { style:'currency', currency:cur, maximumFractionDigits:digits }).format(v || 0);
}
function formatQty(n){
  const v = parseDecimalSmart(n);
  return new Intl.NumberFormat('es-PY', { maximumFractionDigits: 2 }).format(v || 0);
}

// ============================
// Toast
// ============================
function ensureToastStack(){
  let stack = $('#toastStack');
  if(!stack){
    stack = document.createElement('div');
    stack.id = 'toastStack';
    stack.className = 'toast-stack';
    document.body.appendChild(stack);
  }
  return stack;
}
function toast(msg, type='info'){
  const stack = ensureToastStack();
  const div = document.createElement('div');
  div.className = `toast ${type==='ok' ? 'toast--ok' : type==='err' ? 'toast--err' : ''}`;
  div.textContent = msg;
  stack.appendChild(div);
  while(stack.children.length > 5) stack.removeChild(stack.firstElementChild);
  setTimeout(()=>div.remove(), 2600);
}

// ============================
// LocalStorage keys
// ============================
const LS = {
  cfg: 'budget_cfg_app_v1',
  pin: 'budget_pin_app_v1',
  seq: 'budget_seq_app_v1',
  draft: 'budget_draft_app_v1',
  clients: 'budget_clients_app_v1',
  items: 'budget_items_app_v1',
  budgets: 'budget_budgets_app_v1',
  contracts: 'budget_contracts_app_v1'
};
const loadJSON = (k, def) => {
  const raw = localStorage.getItem(k);
  if(!raw) return def;
  try{ return JSON.parse(raw); }catch{ return def; }
};
const saveJSON = (k, v) => localStorage.setItem(k, JSON.stringify(v));

function emitDataChanged(){
  window.dispatchEvent(new CustomEvent('app:data-changed'));
}

// ============================
// Auth (PIN overlay) + sesión
// ============================
const SESSION_KEY = 'budget_session_unlocked_v1';
const loginOverlay = $('#loginOverlay');
const appShell = $('#appShell');

function getPin(){ return (localStorage.getItem(LS.pin) || '').trim(); }


function isValidPin(pin){
  const p = String(pin || '').trim();
  if(!p) return true; // PIN opcional
  return /^\d{4,8}$/.test(p);
}

function updateLogoutUI(){
  const hasPin = !!getPin();
  ['btnLogout','btnLogoutTop','btnLogoutMobile'].forEach(id => {
    const el = document.getElementById(id);
    if(el) el.style.display = hasPin ? '' : 'none';
  });
}
function isUnlocked(){ return sessionStorage.getItem(SESSION_KEY) === '1'; }
function unlockSession(){ sessionStorage.setItem(SESSION_KEY, '1'); }
function lockSession(){ sessionStorage.removeItem(SESSION_KEY); }

function setAppEnabled(enabled){
  if(!appShell) return;
  appShell.style.pointerEvents = enabled ? '' : 'none';
  appShell.style.filter = enabled ? '' : 'blur(2px)';
  appShell.style.opacity = enabled ? '' : '0.35';
}

function syncAuthLogo(){
  const authLogo = $('#authLogo');
  const fallback = $('#authLogoFallback');
  if(cfg.logoDataUrl){
    authLogo.src = cfg.logoDataUrl;
    authLogo.style.display = 'block';
    fallback.style.display = 'none';
  }else{
    authLogo.style.display = 'none';
    fallback.style.display = 'block';
  }
}

function showLogin(){
  const pin = getPin();
  if(!pin) return; // sin PIN no bloquea
  loginOverlay?.classList.add('open');
  loginOverlay?.setAttribute('aria-hidden','false');
  document.body.classList.add('auth-lock');
  setAppEnabled(false);
  syncAuthLogo();
  $('#pinInput')?.focus();
}
function hideLogin(){
  loginOverlay?.classList.remove('open');
  loginOverlay?.setAttribute('aria-hidden','true');
  document.body.classList.remove('auth-lock');
  setAppEnabled(true);
  if($('#pinInput')) $('#pinInput').value = '';
  if($('#pinError')) $('#pinError').textContent = '';
}

function tryLogin(){
  const pin = getPin();
  if(!pin){
    unlockSession();
    hideLogin();
    return;
  }
  const entered = ($('#pinInput')?.value || '').trim();
  if(entered === pin){
    unlockSession();
    hideLogin();
    toast('Sesión iniciada ✔', 'ok');
  }else{
    if($('#pinError')) $('#pinError').textContent = 'PIN incorrecto. Intentá de nuevo.';
    toast('PIN incorrecto', 'err');
    $('#pinInput')?.focus();
  }
}

$('#btnLogin')?.addEventListener('click', tryLogin);
$('#pinInput')?.addEventListener('keydown', (e)=>{ if(e.key==='Enter') tryLogin(); });
$('#btnTogglePin')?.addEventListener('click', ()=>{
  const input = $('#pinInput');
  if(!input) return;
  input.type = input.type === 'password' ? 'text' : 'password';
});

function logout(){
  lockSession();
  toast('Sesión cerrada', 'ok');
  closeMenu();
  // cerrar modales si hubiese
  while(topModal()) closeTopModal();
  goPage('bienvenida');
  showLogin();
}
$('#btnLogout')?.addEventListener('click', logout);
$('#btnLogoutTop')?.addEventListener('click', logout);
$('#btnLogoutMobile')?.addEventListener('click', ()=>{ closeMenu(); logout(); });

// ============================
// Router (vistas)
// ============================
const viewMeta = {
  bienvenida: { title:'Inicio', subtitle:'' },
  presupuesto: { title:'Presupuesto', subtitle:'' },
  historial: { title:'Historial', subtitle:'' },
  items: { title:'Ítems', subtitle:'' },
  clientes: { title:'Clientes', subtitle:'' },
  contratos: { title:'Contratos', subtitle:'' },
};

let currentView = 'bienvenida';
const viewEls = $$('.view[data-view]');
const navDesktop = $$('.navitem[data-view]');
const navDrawer = $$('#navDrawer .drawer__link[data-view]');
const appbarTitle = $('#appbarTitle');
const appbarSubtitle = $('#appbarSubtitle');

function setActiveNav(key){
  navDesktop.forEach(a => a.classList.toggle('active', a.dataset.view === key));
  navDrawer.forEach(a => a.classList.toggle('active', a.dataset.view === key));
}

function goPage(key, {updateHash=true} = {}){
  if(!viewMeta[key]) key = 'bienvenida';
  currentView = key;
  viewEls.forEach(v => v.classList.remove('active'));
  $(`.view[data-view="${key}"]`)?.classList.add('active');
  setActiveNav(key);
  const meta = viewMeta[key];
  if(appbarTitle) appbarTitle.textContent = meta.title;
  if(appbarSubtitle) appbarSubtitle.textContent = meta.subtitle;
  if(updateHash) history.replaceState(null, '', `#${key}`);
  closeMenu();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

window.addEventListener('hashchange', ()=>{
  const h = (location.hash||'').replace('#','').trim();
  if(h) goPage(h, {updateHash:false});
});

// ============================
// Drawer
// ============================
const btnBurger = $('#btnBurger');
const drawer = $('#navDrawer');
const drawerBackdrop = $('#drawerBackdrop');
const btnDrawerClose = $('#btnDrawerClose');
const btnOpenConfigMobile = $('#btnOpenConfigMobile');

function openMenu(){
  drawer?.classList.add('is-open');
  drawerBackdrop?.classList.add('is-open');
  btnBurger?.setAttribute('aria-expanded','true');
  drawer?.setAttribute('aria-hidden','false');
  document.body.classList.add('nav-lock');
}
function closeMenu(){
  drawer?.classList.remove('is-open');
  drawerBackdrop?.classList.remove('is-open');
  btnBurger?.setAttribute('aria-expanded','false');
  drawer?.setAttribute('aria-hidden','true');
  document.body.classList.remove('nav-lock');
}
btnBurger?.addEventListener('click', ()=>drawer?.classList.contains('is-open') ? closeMenu() : openMenu());
drawerBackdrop?.addEventListener('click', closeMenu);
btnDrawerClose?.addEventListener('click', closeMenu);

// Click nav
document.addEventListener('click', (e)=>{
  const nav = e.target.closest('[data-view]');
  if(nav && (nav.classList.contains('navitem') || nav.classList.contains('drawer__link'))){
    e.preventDefault();
    goPage(nav.dataset.view);
    return;
  }
  const jump = e.target.closest('[data-jump]');
  if(jump){
    e.preventDefault();
    goPage(jump.dataset.jump);
  }
});

$('#btnQuickPreview')?.addEventListener('click', ()=>{
  if(currentView !== 'presupuesto'){
    goPage('presupuesto');
    setTimeout(()=>$('#btnPreview')?.click(), 60);
  }else $('#btnPreview')?.click();
});
$('#btnQuickSave')?.addEventListener('click', ()=>{
  if(currentView !== 'presupuesto'){
    goPage('presupuesto');
    setTimeout(()=>$('#btnSaveBudget')?.click(), 60);
  }else $('#btnSaveBudget')?.click();
});

// ============================
// Modales apilables
// ============================
const modalStack = [];
function openStackModal(modalEl){
  if(!modalEl) return;
  if(!modalStack.includes(modalEl)) modalStack.push(modalEl);
  const z = 1200 + (modalStack.length-1) * 30;
  modalEl.style.setProperty('--z', z);
  modalEl.classList.add('open');
  modalEl.setAttribute('aria-hidden','false');
  document.body.classList.add('modal-lock');
}
function closeStackModal(modalEl){
  if(!modalEl) return;
  modalEl.classList.remove('open');
  modalEl.setAttribute('aria-hidden','true');
  modalEl.style.removeProperty('--z');
  const idx = modalStack.indexOf(modalEl);
  if(idx >= 0) modalStack.splice(idx, 1);
  if(modalStack.length === 0) document.body.classList.remove('modal-lock');
}
function topModal(){
  return modalStack.length ? modalStack[modalStack.length-1] : null;
}
function closeTopModal(){
  const m = topModal();
  if(m) closeStackModal(m);
}
function bindOverlayClose(modalId, overlayId){
  const m = document.getElementById(modalId);
  const ov = document.getElementById(overlayId);
  ov?.addEventListener('click', ()=>{ if(topModal() === m) closeStackModal(m); });
}

bindOverlayClose('configModal','configOverlay');
bindOverlayClose('clientModal','clientOverlay');
bindOverlayClose('clientsManagerModal','clientsManagerOverlay');
bindOverlayClose('previewModal','modalOverlay');

document.addEventListener('keydown', (e)=>{
  if(e.key === 'Escape'){
    if(topModal()) return closeTopModal();
    closeMenu();
  }
});

// ============================
// Estado
// ============================
let cfg = {
  companyName: 'Focus Advisers',
  companyRuc: '',
  companyAddress: '',
  companyPhone: '',
  companyEmail: '',
  companyTagline: '',
  logoDataUrl: ''
};
let clients = [];
let itemsCatalog = [];
let budgets = [];
let contracts = [];

let editingClientId = null;
let editingClientPageId = null;
let editingItemId = null;

// ============================
// Validación helpers
// ============================
function setFieldError(inputEl, message){
  if(!inputEl) return;
  inputEl.classList.add('is-invalid','shake');
  inputEl.classList.remove('is-valid');
  setTimeout(()=>inputEl.classList.remove('shake'), 450);
  const scope = inputEl.closest('form') || document;
  const p = scope.querySelector(`.field-error[data-error-for="${inputEl.id}"]`);
  if(p){ p.textContent = message || ''; p.classList.add('show'); }
}
function clearFieldError(inputEl){
  if(!inputEl) return;
  inputEl.classList.remove('is-invalid','shake');
  inputEl.classList.add('is-valid');
  const scope = inputEl.closest('form') || document;
  const p = scope.querySelector(`.field-error[data-error-for="${inputEl.id}"]`);
  if(p){ p.textContent=''; p.classList.remove('show'); }
}
function clearFormErrors(formEl){
  if(!formEl) return;
  $$('.is-invalid,.is-valid', formEl).forEach(el=>el.classList.remove('is-invalid','is-valid','shake'));
  $$('.field-error', formEl).forEach(p=>{ p.textContent=''; p.classList.remove('show'); });
}
function isEmailLike(v){
  const s = String(v||'').trim();
  if(!s) return true;
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i.test(s);
}

// ============================
// Configuración
// ============================
const brandLogo = $('#brandLogo');
const brandLogoFallback = $('#brandLogoFallback');
function applyBrandLogo(){
  if(cfg.logoDataUrl){
    brandLogo.src = cfg.logoDataUrl;
    brandLogo.style.display = 'block';
    brandLogoFallback.style.display = 'none';
  }else{
    brandLogo.style.display = 'none';
    brandLogoFallback.style.display = 'block';
  }
}
function loadConfig(){
  cfg = { ...cfg, ...loadJSON(LS.cfg, {}) };
  $('#cfgCompanyName').value = cfg.companyName || '';
  $('#cfgCompanyRuc').value = cfg.companyRuc || '';
  $('#cfgCompanyAddress').value = cfg.companyAddress || '';
  $('#cfgCompanyPhone').value = cfg.companyPhone || '';
  $('#cfgCompanyEmail').value = cfg.companyEmail || '';
  $('#cfgCompanyTagline').value = cfg.companyTagline || '';
  $('#cfgPin').value = (localStorage.getItem(LS.pin) || '').trim();
    updateLogoutUI();
  applyBrandLogo();
}
function saveConfig(){
  cfg.companyName = $('#cfgCompanyName').value.trim();
  cfg.companyRuc = $('#cfgCompanyRuc').value.trim();
  cfg.companyAddress = $('#cfgCompanyAddress').value.trim();
  cfg.companyPhone = $('#cfgCompanyPhone').value.trim();
  cfg.companyEmail = $('#cfgCompanyEmail').value.trim();
  cfg.companyTagline = $('#cfgCompanyTagline').value.trim();
  saveJSON(LS.cfg, cfg);
  applyBrandLogo();
  emitDataChanged();
}
function validateConfig(){
  const form = $('#configForm');
  clearFormErrors(form);
  let ok = true;
  const name = $('#cfgCompanyName').value.trim();
  const email = $('#cfgCompanyEmail').value.trim();
  if(!name){ setFieldError($('#cfgCompanyName'), 'El nombre de empresa es obligatorio.'); ok=false; }
  else clearFieldError($('#cfgCompanyName'));
  if(email && !isEmailLike(email)){ setFieldError($('#cfgCompanyEmail'), 'Email inválido.'); ok=false; }
  else if(email) clearFieldError($('#cfgCompanyEmail'));
  if(!ok) toast('Revisá los campos marcados.', 'err');
  return ok;
}
const configModal = $('#configModal');
function openConfigModal(){ openStackModal(configModal); clearFormErrors($('#configForm')); }
function closeConfigModal(){ closeStackModal(configModal); }
$('#btnOpenConfig')?.addEventListener('click', openConfigModal);
btnOpenConfigMobile?.addEventListener('click', ()=>{ closeMenu(); openConfigModal(); });
$('#btnCloseConfigModal')?.addEventListener('click', closeConfigModal);

$('#logoInput')?.addEventListener('change', (e)=>{
  const file = e.target.files?.[0];
  if(!file) return;
  const reader = new FileReader();
  reader.onload = ()=>{
    cfg.logoDataUrl = reader.result;
    saveJSON(LS.cfg, cfg);
    applyBrandLogo();
    toast('Logo actualizado ✔', 'ok');
    emitDataChanged();
  };
  reader.readAsDataURL(file);
});

$('#btnSaveConfigModal')?.addEventListener('click', () => {
  if(!validateConfig()) return;

  const pinValue = ($('#cfgPin').value || '').trim();

  // ✅ Validación PIN: 4 a 8 dígitos numéricos (PIN opcional)
  if(!isValidPin(pinValue)) {
    toast('PIN inválido: usá 4 a 8 dígitos numéricos.', 'err');
    const el = $('#cfgPin');
    el?.focus();
    el?.classList.add('is-invalid','shake');
    setTimeout(()=>el?.classList.remove('shake'), 450);
    return;
  }

  saveConfig();
  localStorage.setItem(LS.pin, pinValue);

  // Si se eliminó el PIN, liberar sesión y ocultar overlay
  if(!pinValue){
    unlockSession();
    hideLogin();
  }

  updateLogoutUI();
  toast('Configuración guardada ✔', 'ok');
  closeConfigModal();

  // Si hay PIN configurado y aún no se desbloqueó, mostrar login
  const pin = getPin();
  if(pin && !isUnlocked()) showLogin();
});

$('#btnResetConfig')?.addEventListener('click', ()=>{
  if(!confirm('¿Restablecer configuración?')) return;
  localStorage.removeItem(LS.cfg);
  localStorage.removeItem(LS.pin);
  cfg = {
    companyName: 'Focus Advisers',
    companyRuc: '',
    companyAddress: '',
    companyPhone: '',
    companyEmail: '',
    companyTagline: '',
    logoDataUrl: ''
  };
  loadConfig();
  toast('Configuración restablecida ✔', 'ok');
  emitDataChanged();
});

// Export/Import JSON
$('#btnExportJson')?.addEventListener('click', ()=>{
  const payload = {
    cfg: localStorage.getItem(LS.cfg),
    pin: localStorage.getItem(LS.pin),
    clients: localStorage.getItem(LS.clients),
    items: localStorage.getItem(LS.items),
    budgets: localStorage.getItem(LS.budgets),
    contracts: localStorage.getItem(LS.contracts),
    draft: localStorage.getItem(LS.draft),
    seq: localStorage.getItem(LS.seq)
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type:'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `backup_presupuestos_${todayISO()}.json`;
  a.click();
  setTimeout(()=>URL.revokeObjectURL(a.href), 1200);
  localStorage.setItem('budget_last_backup', new Date().toLocaleString('es-PY', {dateStyle:'short', timeStyle:'short'}));
  emitDataChanged();
});
$('#btnImportJson')?.addEventListener('click', ()=>$('#importJsonFile')?.click());
$('#importJsonFile')?.addEventListener('change', (e)=>{
  const file = e.target.files?.[0];
  if(!file) return;
  const reader = new FileReader();
  reader.onload = ()=>{
    try{
      const payload = JSON.parse(reader.result);
      if(payload.cfg != null) localStorage.setItem(LS.cfg, payload.cfg);
      if(payload.pin != null) localStorage.setItem(LS.pin, payload.pin);
      if(payload.clients != null) localStorage.setItem(LS.clients, payload.clients);
      if(payload.items != null) localStorage.setItem(LS.items, payload.items);
      if(payload.budgets != null) localStorage.setItem(LS.budgets, payload.budgets);
      if(payload.contracts != null) localStorage.setItem(LS.contracts, payload.contracts);
      if(payload.draft != null) localStorage.setItem(LS.draft, payload.draft);
      if(payload.seq != null) localStorage.setItem(LS.seq, payload.seq);
      toast('Importación OK ✔', 'ok');
      initData();
      emitDataChanged();
    }catch{
      toast('JSON inválido', 'err');
    }
  };
  reader.readAsText(file);
});

// ============================
// Datos (load)
// ============================
function initData(){
  loadConfig();
  clients = loadJSON(LS.clients, []);
  itemsCatalog = loadJSON(LS.items, []);
  budgets = loadJSON(LS.budgets, []);
  contracts = loadJSON(LS.contracts, []);
  renderAll();
  loadDraft();
  emitDataChanged();
}

// ============================
// Clientes
// ============================
function normDoc(doc){ return String(doc||'').trim().toUpperCase().replace(/\s+/g,''); }
function saveClients(){ saveJSON(LS.clients, clients); renderClients(); emitDataChanged(); }

function renderClientSelect(){
  const sel = $('#clientSelect');
  if(!sel) return;
  const cur = sel.value;
  sel.innerHTML = `<option value="">— Seleccionar —</option>` +
    clients.slice().sort((a,b)=>(a.name||'').localeCompare(b.name||''))
      .map(c=>`<option value="${c.id}">${escapeHtml(c.name)} — ${escapeHtml(c.doc||'')}</option>`)
      .join('');
  if(cur && clients.some(c=>c.id===cur)) sel.value = cur;
}

function fillClientMainForm(c){
  $('#clientName').value = c?.name || '';
  $('#clientDoc').value = c?.doc || '';
  $('#clientPhone').value = c?.phone || '';
  $('#clientAddress').value = c?.address || '';
  $('#clientEmail').value = c?.email || '';
}

function upsertClient(clientObj){
  const docKey = normDoc(clientObj.doc);
  const byDoc = clients.find(c=>normDoc(c.doc)===docKey);
  if(byDoc && byDoc.id !== clientObj.id) clientObj.id = byDoc.id;
  const idx = clients.findIndex(c=>c.id===clientObj.id);
  if(idx>=0) clients[idx]=clientObj; else clients.push(clientObj);
  saveClients();
  return clientObj;
}

function deleteClient(id){
  clients = clients.filter(c=>c.id!==id);
  saveClients();
  if($('#clientSelect').value === id) $('#clientSelect').value='';
}

// Cliente modal
const clientModal = $('#clientModal');
function openClientModal(mode='new', client=null){
  openStackModal(clientModal);
  clearFormErrors($('#clientForm'));

  if(mode==='edit' && client){
    editingClientId = client.id;
    $('#clientModalTitle').textContent = 'Editar cliente';
    $('#cmName').value = client.name || '';
    $('#cmDoc').value = client.doc || '';
    $('#cmPhone').value = client.phone || '';
    $('#cmAddress').value = client.address || '';
    $('#cmEmail').value = client.email || '';
  }else{
    editingClientId = null;
    $('#clientModalTitle').textContent = 'Nuevo cliente';
    $('#cmName').value=''; $('#cmDoc').value=''; $('#cmPhone').value=''; $('#cmAddress').value=''; $('#cmEmail').value='';
  }
  $('#cmName').focus();
}
function closeClientModal(){ closeStackModal(clientModal); }

function validateClientModal(data){
  clearFormErrors($('#clientForm'));
  let ok=true;
  if(!data.name){ setFieldError($('#cmName'), 'Nombre obligatorio.'); ok=false; }
  else clearFieldError($('#cmName'));
  if(!data.doc){ setFieldError($('#cmDoc'), 'Documento obligatorio.'); ok=false; }
  else clearFieldError($('#cmDoc'));
  if(data.email && !isEmailLike(data.email)){ setFieldError($('#cmEmail'), 'Email inválido.'); ok=false; }
  else if(data.email) clearFieldError($('#cmEmail'));
  if(!ok) toast('Revisá los campos del cliente.', 'err');
  return ok;
}

$('#btnNewClient')?.addEventListener('click', ()=>openClientModal('new'));
$('#btnCloseClientModal')?.addEventListener('click', closeClientModal);

$('#btnSaveClientModal')?.addEventListener('click', ()=>{
  const data = {
    id: editingClientId || (crypto?.randomUUID ? crypto.randomUUID() : String(Date.now())),
    name: $('#cmName').value.trim(),
    doc: $('#cmDoc').value.trim(),
    phone: $('#cmPhone').value.trim(),
    address: $('#cmAddress').value.trim(),
    email: $('#cmEmail').value.trim(),
  };
  if(!validateClientModal(data)) return;
  const saved = upsertClient(data);
  $('#clientSelect').value = saved.id;
  fillClientMainForm(saved);
  toast('Cliente guardado ✔', 'ok');
  closeClientModal();
});

$('#clientSelect')?.addEventListener('change', ()=>{
  const id = $('#clientSelect').value;
  const c = clients.find(x=>x.id===id);
  if(c) fillClientMainForm(c);
});

$('#btnSaveClientQuick')?.addEventListener('click', ()=>{
  const data = {
    id: $('#clientSelect').value || (crypto?.randomUUID ? crypto.randomUUID() : String(Date.now())),
    name: $('#clientName').value.trim(),
    doc: $('#clientDoc').value.trim(),
    phone: $('#clientPhone').value.trim(),
    address: $('#clientAddress').value.trim(),
    email: $('#clientEmail').value.trim(),
  };
  if(!data.name || !data.doc){ toast('Completá nombre y documento del cliente.', 'err'); return; }
  if(data.email && !isEmailLike(data.email)){ toast('Email inválido', 'err'); return; }
  const saved = upsertClient(data);
  $('#clientSelect').value = saved.id;
  toast('Cliente guardado ✔', 'ok');
});

// Gestor clientes modal
const clientsManagerModal = $('#clientsManagerModal');
function openClientsManager(){ openStackModal(clientsManagerModal); renderClientsManager(); $('#clientsSearch')?.focus(); }
function closeClientsManager(){ closeStackModal(clientsManagerModal); }
$('#btnManageClients')?.addEventListener('click', openClientsManager);
$('#btnCloseClientsManager')?.addEventListener('click', closeClientsManager);
$('#btnNewClientFromManager')?.addEventListener('click', ()=>openClientModal('new'));
$('#clientsSearch')?.addEventListener('input', renderClientsManager);

function renderClientsManager(){
  const body = $('#clientsManagerBody');
  if(!body) return;
  const q = ($('#clientsSearch')?.value || '').trim().toLowerCase();
  const list = clients.slice().sort((a,b)=>(a.name||'').localeCompare(b.name||''))
    .filter(c=>!q || (c.name||'').toLowerCase().includes(q) || (c.doc||'').toLowerCase().includes(q));

  body.innerHTML = list.length ? list.map(c=>`
    <tr>
      <td>${escapeHtml(c.name||'')}</td>
      <td>${escapeHtml(c.doc||'')}</td>
      <td>${escapeHtml(c.phone||'')}</td>
      <td>${escapeHtml(c.email||'')}</td>
      <td class="r">
        <button class="pill-btn" data-act="edit" data-id="${c.id}">Editar</button>
        <button class="pill-btn danger" data-act="del" data-id="${c.id}">Eliminar</button>
      </td>
    </tr>
  `).join('') : `<tr><td colspan="5" class="muted">Sin clientes.</td></tr>`;
}

$('#clientsManagerBody')?.addEventListener('click', (e)=>{
  const btn = e.target.closest('button[data-act]');
  if(!btn) return;
  const id = btn.dataset.id;
  const act = btn.dataset.act;
  const c = clients.find(x=>x.id===id);
  if(act==='edit' && c) openClientModal('edit', c);
  if(act==='del'){
    if(confirm('¿Eliminar cliente?')){ deleteClient(id); toast('Cliente eliminado ✔', 'ok'); }
  }
});

// Página clientes
function renderClientsPage(){
  const body = $('#clientsPageBody');
  if(!body) return;
  const q = ($('#clientsPageSearch')?.value || '').trim().toLowerCase();
  const list = clients.slice().sort((a,b)=>(a.name||'').localeCompare(b.name||''))
    .filter(c=>!q || (c.name||'').toLowerCase().includes(q) || (c.doc||'').toLowerCase().includes(q));

  body.innerHTML = list.length ? list.map(c=>`
    <tr>
      <td>${escapeHtml(c.name||'')}</td>
      <td>${escapeHtml(c.doc||'')}</td>
      <td>${escapeHtml(c.phone||'')}</td>
      <td>${escapeHtml(c.email||'')}</td>
      <td class="r">
        <button class="pill-btn" data-act="edit" data-id="${c.id}">Editar</button>
        <button class="pill-btn danger" data-act="del" data-id="${c.id}">Eliminar</button>
      </td>
    </tr>
  `).join('') : `<tr><td colspan="5" class="muted">Sin clientes.</td></tr>`;
}

$('#clientsPageSearch')?.addEventListener('input', renderClientsPage);
$('#btnSaveClientPage')?.addEventListener('click', ()=>{
  const data = {
    id: editingClientPageId || (crypto?.randomUUID ? crypto.randomUUID() : String(Date.now())),
    name: $('#clName').value.trim(),
    doc: $('#clDoc').value.trim(),
    phone: $('#clPhone').value.trim(),
    address: $('#clAddress').value.trim(),
    email: $('#clEmail').value.trim(),
  };
  if(!data.name || !data.doc) return toast('Nombre y documento son obligatorios.', 'err');
  if(data.email && !isEmailLike(data.email)) return toast('Email inválido.', 'err');
  upsertClient(data);
  editingClientPageId = null;
  toast('Cliente guardado ✔', 'ok');
});
$('#btnClearClientPage')?.addEventListener('click', ()=>{
  $('#clName').value=''; $('#clDoc').value=''; $('#clPhone').value=''; $('#clAddress').value=''; $('#clEmail').value='';
  editingClientPageId = null;
  toast('Formulario limpio ✔', 'ok');
});
$('#clientsPageBody')?.addEventListener('click', (e)=>{
  const btn = e.target.closest('button[data-act]');
  if(!btn) return;
  const id = btn.dataset.id;
  const act = btn.dataset.act;
  const c = clients.find(x=>x.id===id);
  if(!c) return;
  if(act==='edit'){
    editingClientPageId = c.id;
    $('#clName').value=c.name||''; $('#clDoc').value=c.doc||''; $('#clPhone').value=c.phone||''; $('#clAddress').value=c.address||''; $('#clEmail').value=c.email||'';
    toast('Editando cliente…', 'ok');
  }
  if(act==='del'){
    if(confirm('¿Eliminar cliente?')){ deleteClient(id); toast('Cliente eliminado ✔', 'ok'); }
  }
});

$('#btnExportClients')?.addEventListener('click', ()=>{
  downloadCSV(`clientes_${todayISO()}.csv`, ['Nombre','Documento','Teléfono','Dirección','Email'], clients.map(c=>[c.name,c.doc,c.phone,c.address,c.email]));
  toast('Exportación clientes ✔', 'ok');
});

// ============================
// Ítems (Catálogo)
// ============================
function saveItems(){ saveJSON(LS.items, itemsCatalog); renderItems(); emitDataChanged(); }

function renderCatalogSelect(){
  const sel = $('#catalogSelect');
  if(!sel) return;
  sel.innerHTML = `<option value="">— Seleccionar ítem —</option>` +
    itemsCatalog.slice().sort((a,b)=>(a.desc||'').localeCompare(b.desc||''))
      .map(it=>`<option value="${it.id}">${escapeHtml(it.desc)} — ${escapeHtml(String(it.price||''))}</option>`)
      .join('');
}

function renderItemsCatalog(){
  const body = $('#itemsCatalogBody');
  if(!body) return;
  const q = ($('#itemsSearch')?.value || '').trim().toLowerCase();
  const list = itemsCatalog.slice().sort((a,b)=>(a.desc||'').localeCompare(b.desc||''))
    .filter(it=>!q || (it.desc||'').toLowerCase().includes(q));

  body.innerHTML = list.length ? list.map(it=>`
    <tr>
      <td>${escapeHtml(it.desc||'')}</td>
      <td>${escapeHtml(String(it.price||''))}</td>
      <td>${escapeHtml(it.vat||'10')}</td>
      <td>${escapeHtml(it.unit||'')}</td>
      <td class="r">
        <button class="pill-btn" data-act="edit" data-id="${it.id}">Editar</button>
        <button class="pill-btn danger" data-act="del" data-id="${it.id}">Eliminar</button>
      </td>
    </tr>
  `).join('') : `<tr><td colspan="5" class="muted">Sin ítems.</td></tr>`;
}

function validateItemForm(){
  let ok = true;
  const desc = $('#itemDesc')?.value.trim();
  const priceTxt = $('#itemPrice')?.value.trim();
  if(!desc){ setFieldError($('#itemDesc'), 'La descripción es obligatoria.'); ok=false; }
  else clearFieldError($('#itemDesc'));
  if(!priceTxt || parsePrice(priceTxt) <= 0){ setFieldError($('#itemPrice'), 'El precio debe ser mayor a 0.'); ok=false; }
  else clearFieldError($('#itemPrice'));
  if(!ok) toast('Revisá los campos del ítem.', 'err');
  return ok;
}

$('#itemsSearch')?.addEventListener('input', renderItemsCatalog);
$('#btnSaveItem')?.addEventListener('click', ()=>{
  if(!validateItemForm()) return;
  const obj = {
    id: editingItemId || (crypto?.randomUUID ? crypto.randomUUID() : String(Date.now())),
    desc: $('#itemDesc').value.trim(),
    price: $('#itemPrice').value.trim(),
    vat: $('#itemVat').value || '10',
    unit: $('#itemUnit').value.trim(),
    updatedAt: new Date().toISOString()
  };
  const idx = itemsCatalog.findIndex(x=>x.id===obj.id);
  if(idx>=0) itemsCatalog[idx]=obj; else itemsCatalog.push(obj);
  saveItems();
  editingItemId = null;
  toast('Ítem guardado ✔', 'ok');
});
$('#btnClearItemForm')?.addEventListener('click', ()=>{
  $('#itemDesc').value=''; $('#itemPrice').value=''; $('#itemVat').value='10'; $('#itemUnit').value='';
  editingItemId = null;
  toast('Formulario limpio ✔', 'ok');
});

$('#itemsCatalogBody')?.addEventListener('click', (e)=>{
  const btn = e.target.closest('button[data-act]');
  if(!btn) return;
  const id = btn.dataset.id;
  const act = btn.dataset.act;
  const it = itemsCatalog.find(x=>x.id===id);
  if(!it) return;
  if(act==='edit'){
    editingItemId = it.id;
    $('#itemDesc').value = it.desc||'';
    $('#itemPrice').value = it.price||'';
    $('#itemVat').value = it.vat||'10';
    $('#itemUnit').value = it.unit||'';
    toast('Editando ítem…', 'ok');
  }
  if(act==='del'){
    if(confirm('¿Eliminar ítem?')){
      itemsCatalog = itemsCatalog.filter(x=>x.id!==id);
      saveItems();
      toast('Ítem eliminado ✔', 'ok');
    }
  }
});

$('#btnExportItems')?.addEventListener('click', ()=>{
  downloadCSV(`items_${todayISO()}.csv`, ['Descripción','Precio','IVA','Unidad'], itemsCatalog.map(i=>[i.desc,i.price,i.vat,i.unit]));
  toast('Exportación ítems ✔', 'ok');
});

// ============================
// Presupuesto: tabla ítems + totales
// ============================
const itemsBody = $('#itemsBody');

function vatRateOf(row){
  const v = row.querySelector('.vatType')?.value || 'EXE';
  if(v === '5') return 0.05;
  if(v === '10') return 0.10;
  return 0;
}

function createRow(data = {}){
  const tr = document.createElement('tr');
  tr.className = 'item-row';
  tr.dataset.lastEdited = data.lastEdited || '';

  tr.innerHTML = `
    <td><input class="cell-input desc" type="text" value="${escapeHtml(data.desc||'')}" placeholder="Descripción"></td>
    <td><input class="cell-input qty" type="text" value="${escapeHtml(data.qty||'1')}" placeholder="1"></td>
    <td><input class="cell-input price" type="text" value="${escapeHtml(data.price||'')}" placeholder="0"></td>
    <td>
      <select class="cell-input vatType">
        <option value="EXE">Exento</option>
        <option value="5">5%</option>
        <option value="10">10%</option>
      </select>
    </td>
    <td><input class="cell-input discPct" type="text" value="${escapeHtml(data.discPct||'')}" placeholder="0,00"></td>
    <td><input class="cell-input discAmt" type="text" value="${escapeHtml(data.discAmt||'')}" placeholder="0"></td>
    <td><input class="cell-input cell-total lineTotal" type="text" value="${escapeHtml(data.lineTotal||'')}" disabled></td>
    <td><button class="trash" type="button">🗑</button></td>
  `;

  tr.querySelector('.vatType').value = String(data.vatType || '10');

  tr.addEventListener('input', (e)=>{
    const t = e.target;
    if(t.classList.contains('discPct')) tr.dataset.lastEdited = 'pct';
    if(t.classList.contains('discAmt')) tr.dataset.lastEdited = 'amt';
    recalcTotals();
  });

  tr.querySelector('.discPct').addEventListener('blur', ()=>{
    const v = clamp(parseDecimalSmart(tr.querySelector('.discPct').value), 0, 100);
    tr.querySelector('.discPct').value = v > 0 ? v.toFixed(2) : '';
  });
  tr.querySelector('.discAmt').addEventListener('blur', ()=>{
    const v = parsePrice(tr.querySelector('.discAmt').value);
    tr.querySelector('.discAmt').value = v > 0 ? String(getCurrency()==='USD' ? v.toFixed(2) : Math.round(v)) : '';
  });

  tr.querySelector('.trash').addEventListener('click', ()=>{
    tr.remove();
    recalcTotals();
  });

  itemsBody.appendChild(tr);
  recalcRow(tr);
  return tr;
}

function recalcRow(row){
  const qty = parseDecimalSmart(row.querySelector('.qty').value);
  const price = parsePrice(row.querySelector('.price').value);
  const base = (qty||0)*(price||0);

  const pctIn = parseDecimalSmart(row.querySelector('.discPct').value);
  const amtIn = parsePrice(row.querySelector('.discAmt').value);
  let discAmt = 0;

  if(base <= 0){
    row.querySelector('.lineTotal').value='';
    row.dataset.base='0';
    row.dataset.baseAfterDisc='0';
    row.dataset.discount='0';
    row.dataset.vatRate=String(vatRateOf(row));
    row.dataset.total='0';
    return;
  }

  const last = row.dataset.lastEdited;
  if(last === 'pct'){
    const discPct = clamp(pctIn,0,100);
    discAmt = clamp(base*(discPct/100),0,base);
    row.querySelector('.discAmt').value = discAmt>0 ? (getCurrency()==='USD'?discAmt.toFixed(2):String(Math.round(discAmt))) : '';
  }else if(last === 'amt'){
    discAmt = clamp(amtIn,0,base);
    const discPct = clamp((discAmt/base)*100,0,100);
    row.querySelector('.discPct').value = discPct>0 ? discPct.toFixed(2) : '';
  }else{
    if(pctIn>0){
      const discPct = clamp(pctIn,0,100);
      discAmt = clamp(base*(discPct/100),0,base);
      row.querySelector('.discAmt').value = discAmt>0 ? (getCurrency()==='USD'?discAmt.toFixed(2):String(Math.round(discAmt))) : '';
    }else if(amtIn>0){
      discAmt = clamp(amtIn,0,base);
      const discPct = clamp((discAmt/base)*100,0,100);
      row.querySelector('.discPct').value = discPct>0 ? discPct.toFixed(2) : '';
    }
  }

  const baseAfter = base - discAmt;
  const rate = vatRateOf(row);
  const vat = baseAfter*rate;
  const totalLine = baseAfter + vat;

  row.querySelector('.lineTotal').value = getCurrency()==='USD' ? totalLine.toFixed(2) : String(Math.round(totalLine));

  row.dataset.base = String(base);
  row.dataset.baseAfterDisc = String(baseAfter);
  row.dataset.discount = String(discAmt);
  row.dataset.vatRate = String(rate);
  row.dataset.total = String(totalLine);
}

function getGlobalDiscount(subtotalAfterItemDiscount){
  const pctEl = $('#globalDiscPct');
  const amtEl = $('#globalDiscAmt');
  const pct = clamp(parseDecimalSmart(pctEl.value), 0, 100);
  const amt = (getCurrency()==='USD') ? parseDecimalSmart(amtEl.value) : parseGs(amtEl.value);
  let disc = 0;

  if(amt > 0){
    disc = clamp(amt, 0, subtotalAfterItemDiscount);
    const p = subtotalAfterItemDiscount>0 ? (disc/subtotalAfterItemDiscount)*100 : 0;
    pctEl.value = p>0 ? p.toFixed(2) : '';
  }else if(pct > 0){
    disc = clamp(subtotalAfterItemDiscount*(pct/100), 0, subtotalAfterItemDiscount);
    amtEl.value = disc>0 ? (getCurrency()==='USD'?disc.toFixed(2):String(Math.round(disc))) : '';
  }else{
    pctEl.value=''; amtEl.value='';
  }
  return disc;
}

function recalcTotals(){
  const rows = $$('.item-row');
  let sumBase=0, sumItemDisc=0;
  let baseExe=0, base5=0, base10=0;

  rows.forEach(r=>{
    recalcRow(r);
    const base = parseDecimalSmart(r.dataset.base);
    const disc = parseDecimalSmart(r.dataset.discount);
    const baseAfter = parseDecimalSmart(r.dataset.baseAfterDisc);
    const rate = parseDecimalSmart(r.dataset.vatRate);

    sumBase += base;
    sumItemDisc += disc;

    if(rate===0.05) base5 += baseAfter;
    else if(rate===0.10) base10 += baseAfter;
    else baseExe += baseAfter;
  });

  const subtotalAfterItemDisc = baseExe + base5 + base10;
  const globalDisc = getGlobalDiscount(subtotalAfterItemDisc);

  const totalTaxBase = subtotalAfterItemDisc || 1;
  const disc5 = globalDisc*(base5/totalTaxBase);
  const disc10 = globalDisc*(base10/totalTaxBase);

  const vat5 = Math.max(0, (base5-disc5)*0.05);
  const vat10 = Math.max(0, (base10-disc10)*0.10);
  const totalFinal = (subtotalAfterItemDisc - globalDisc) + vat5 + vat10;

  $('#subTotal').textContent = money(sumBase);
  $('#totalDiscount').textContent = money(sumItemDisc + globalDisc);
  $('#vat5').value = money(vat5);
  $('#vat10').value = money(vat10);
  $('#grandTotal').textContent = money(totalFinal);
}

function nextBudgetNumber(){
  const seq = parseInt(localStorage.getItem(LS.seq) || '1', 10);
  localStorage.setItem(LS.seq, String(seq + 1));
  return `P-${pad(seq,4)}`;
}

function ensureDefaults(){
  $('#issueDate').value = $('#issueDate').value || todayISO();
  if(!$('#budgetNumber').value.trim()) $('#budgetNumber').value = nextBudgetNumber();
}

function validateBeforePreview(){
  let ok=true;
  if(!$('#clientName').value.trim()) { setFieldError($('#clientName'), 'Nombre del cliente obligatorio.'); ok=false; }
  else clearFieldError($('#clientName'));

  if(!$('#clientDoc').value.trim()) { setFieldError($('#clientDoc'), 'Documento obligatorio.'); ok=false; }
  else clearFieldError($('#clientDoc'));

  const validRows = $$('.item-row').filter(r=>{
    const desc = r.querySelector('.desc')?.value.trim();
    const qty = parseDecimalSmart(r.querySelector('.qty')?.value);
    const price = parsePrice(r.querySelector('.price')?.value);
    return desc && qty>0 && price>0;
  });
  if(validRows.length===0){ toast('Cargá al menos 1 ítem válido.', 'err'); ok=false; }
  if(!ok) toast('Faltan datos para continuar.', 'err');
  return ok;
}

// Plantillas
const templates = {
  contabilidad: [
    { desc:'Contabilidad mensual', qty:'1', price:'0', vatType:'10' },
    { desc:'Presentación de DDJJ', qty:'1', price:'0', vatType:'10' },
  ],
  web: [
    { desc:'Landing page', qty:'1', price:'0', vatType:'10' },
    { desc:'Mantenimiento mensual', qty:'1', price:'0', vatType:'10' },
  ],
  fiscal: [
    { desc:'Asesoría fiscal', qty:'1', price:'0', vatType:'10' },
    { desc:'Revisión y planificación', qty:'1', price:'0', vatType:'10' },
  ]
};

$('#btnAddRow')?.addEventListener('click', ()=>{ createRow({}); recalcTotals(); });
$('#btnClearItems')?.addEventListener('click', ()=>{ itemsBody.innerHTML=''; createRow({}); recalcTotals(); });
$('#btnApplyTemplate')?.addEventListener('click', ()=>{
  const key = $('#templateSelect').value;
  if(!key || !templates[key]) return;
  itemsBody.innerHTML='';
  templates[key].forEach(it=>createRow(it));
  recalcTotals();
  toast('Plantilla aplicada ✔', 'ok');
});

$('#currency')?.addEventListener('change', ()=>recalcTotals());
$('#globalDiscPct')?.addEventListener('input', ()=>{ $('#globalDiscAmt').value=''; recalcTotals(); });
$('#globalDiscAmt')?.addEventListener('input', ()=>{ $('#globalDiscPct').value=''; recalcTotals(); });

$('#btnAddCatalogItem')?.addEventListener('click', ()=>{
  const id = $('#catalogSelect').value;
  if(!id) return toast('Seleccioná un ítem guardado.', 'err');
  const it = itemsCatalog.find(x=>x.id===id);
  if(!it) return toast('Ítem no encontrado.', 'err');
  createRow({ desc: it.desc, qty:'1', price: it.price, vatType: it.vat || '10' });
  recalcTotals();
  toast('Ítem agregado ✔', 'ok');
});

// ============================
// Presupuestos / contratos
// ============================
function computeBudgetTotalsFromData(b){
  let baseExe=0, base5=0, base10=0, sumBase=0, sumItemDisc=0;
  (b.items||[]).forEach(it=>{
    const qty = parseDecimalSmart(it.qty);
    const price = (b.currency==='USD') ? parseDecimalSmart(it.price) : parseGs(it.price);
    const base = (qty||0)*(price||0);

    let disc = (b.currency==='USD') ? parseDecimalSmart(it.discAmt) : parseGs(it.discAmt);
    if(!disc){
      const p = clamp(parseDecimalSmart(it.discPct), 0, 100);
      disc = base*(p/100);
    }
    disc = clamp(disc, 0, base);

    const after = base - disc;
    const vt = String(it.vatType||'EXE');
    if(vt==='5') base5 += after;
    else if(vt==='10') base10 += after;
    else baseExe += after;

    sumBase += base;
    sumItemDisc += disc;
  });

  const subtotalAfterItemDisc = baseExe + base5 + base10;
  let globalDisc = (b.currency==='USD') ? parseDecimalSmart(b.globalDiscAmt) : parseGs(b.globalDiscAmt);
  if(!globalDisc){
    const p = clamp(parseDecimalSmart(b.globalDiscPct), 0, 100);
    globalDisc = subtotalAfterItemDisc*(p/100);
  }
  globalDisc = clamp(globalDisc, 0, subtotalAfterItemDisc);

  const totalTaxBase = subtotalAfterItemDisc || 1;
  const disc5 = globalDisc*(base5/totalTaxBase);
  const disc10 = globalDisc*(base10/totalTaxBase);

  const vat5 = Math.max(0, (base5-disc5)*0.05);
  const vat10 = Math.max(0, (base10-disc10)*0.10);
  const totalFinal = (subtotalAfterItemDisc - globalDisc) + vat5 + vat10;

  return { sumBase, sumItemDisc, globalDisc, vat5, vat10, totalFinal };
}

function getBudgetDataFromForm(){
  const rows = $$('.item-row').map(row=>({
    desc: row.querySelector('.desc')?.value || '',
    qty: row.querySelector('.qty')?.value || '',
    price: row.querySelector('.price')?.value || '',
    vatType: row.querySelector('.vatType')?.value || 'EXE',
    discPct: row.querySelector('.discPct')?.value || '',
    discAmt: row.querySelector('.discAmt')?.value || '',
    lastEdited: row.dataset.lastEdited || ''
  }));

  return {
    id: (crypto?.randomUUID ? crypto.randomUUID() : String(Date.now())),
    number: $('#budgetNumber').value.trim(),
    issueDate: $('#issueDate').value || todayISO(),
    validUntil: $('#validUntil').value || '',
    currency: $('#currency').value || 'PYG',
    fxRate: $('#fxRate').value || '',
    clientId: $('#clientSelect').value || '',
    client: {
      name: $('#clientName').value.trim(),
      doc: $('#clientDoc').value.trim(),
      phone: $('#clientPhone').value.trim(),
      address: $('#clientAddress').value.trim(),
      email: $('#clientEmail').value.trim(),
    },
    globalDiscPct: $('#globalDiscPct').value || '',
    globalDiscAmt: $('#globalDiscAmt').value || '',
    notes: $('#notes').value.trim(),
    signName: $('#signName').value.trim(),
    signRole: $('#signRole').value.trim(),
    items: rows,
    createdAt: new Date().toISOString()
  };
}

function saveBudgets(){ saveJSON(LS.budgets, budgets); renderBudgets(); emitDataChanged(); }
function saveContracts(){ saveJSON(LS.contracts, contracts); renderContracts(); emitDataChanged(); }

function renderBudgets(){
  const body = $('#budgetsBody');
  if(!body) return;
  const q = ($('#budgetsSearch')?.value || '').trim().toLowerCase();
  const list = budgets.slice().sort((a,b)=>String(b.createdAt||'').localeCompare(String(a.createdAt||'')))
    .filter(b=>!q || (b.number||'').toLowerCase().includes(q) || (b.client?.name||'').toLowerCase().includes(q));

  body.innerHTML = list.length ? list.map(b=>{
    const t = computeBudgetTotalsFromData(b);
    const fmt = new Intl.NumberFormat('es-PY', { style:'currency', currency:(b.currency||'PYG'), maximumFractionDigits:(b.currency==='USD'?2:0) });
    return `
      <tr>
        <td>${escapeHtml(b.number||'')}</td>
        <td>${escapeHtml(b.issueDate||'')}</td>
        <td>${escapeHtml(b.client?.name||'')}</td>
        <td class="r"><strong>${fmt.format(t.totalFinal || 0)}</strong></td>
        <td class="r">
          <button class="pill-btn" data-act="view" data-id="${b.id}">Vista</button>
          <button class="pill-btn" data-act="edit" data-id="${b.id}">Editar</button>
          <button class="pill-btn danger" data-act="del" data-id="${b.id}">Eliminar</button>
        </td>
      </tr>
    `;
  }).join('') : `<tr><td colspan="5" class="muted">Sin presupuestos guardados.</td></tr>`;
}
$('#budgetsSearch')?.addEventListener('input', renderBudgets);

function loadBudgetToForm(b){
  $('#budgetNumber').value = b.number || '';
  $('#issueDate').value = b.issueDate || todayISO();
  $('#validUntil').value = b.validUntil || '';
  $('#currency').value = b.currency || 'PYG';
  $('#fxRate').value = b.fxRate || '';
  $('#clientSelect').value = b.clientId || '';
  fillClientMainForm(b.client || {});
  $('#globalDiscPct').value = b.globalDiscPct || '';
  $('#globalDiscAmt').value = b.globalDiscAmt || '';
  $('#notes').value = b.notes || '';
  $('#signName').value = b.signName || '';
  $('#signRole').value = b.signRole || '';

  itemsBody.innerHTML='';
  (b.items||[]).forEach(it=>createRow(it));
  if(!(b.items||[]).length) createRow({});
  recalcTotals();
  toast('Presupuesto cargado ✔', 'ok');
  goPage('presupuesto');
}

$('#budgetsBody')?.addEventListener('click', (e)=>{
  const btn = e.target.closest('button[data-act]');
  if(!btn) return;
  const id = btn.dataset.id;
  const act = btn.dataset.act;
  const b = budgets.find(x=>x.id===id);
  if(!b) return;
  if(act==='edit') loadBudgetToForm(b);
  if(act==='view') openPreviewFromBudget(b);
  if(act==='del'){
    if(!confirm('¿Eliminar presupuesto/contrato?')) return;
    budgets = budgets.filter(x=>x.id!==id);
    saveBudgets();
    contracts = contracts.filter(x=>x.id!==id);
    saveContracts();
    toast('Eliminado ✔', 'ok');
  }
});

function clearDraft(){ localStorage.removeItem(LS.draft); }
function resetBudgetForm(){
  // Mantener moneda seleccionada
  const cur = $('#currency').value;
  $('#budgetNumber').value = nextBudgetNumber();
  $('#issueDate').value = todayISO();
  $('#validUntil').value = '';
  $('#currency').value = cur;
  $('#fxRate').value = '';

  $('#clientSelect').value = '';
  $('#clientName').value = '';
  $('#clientDoc').value = '';
  $('#clientPhone').value = '';
  $('#clientAddress').value = '';
  $('#clientEmail').value = '';

  $('#globalDiscPct').value = '';
  $('#globalDiscAmt').value = '';
  $('#notes').value = '';
  $('#signName').value = '';
  $('#signRole').value = '';

  itemsBody.innerHTML = '';
  createRow({});
  recalcTotals();

  clearDraft();
}

$('#btnSaveBudget')?.addEventListener('click', ()=>{
  if(!validateBeforePreview()) return;
  ensureDefaults();
  const b = getBudgetDataFromForm();

  const idx = budgets.findIndex(x => (x.number||'').trim() === (b.number||'').trim());
  if(idx>=0) budgets[idx] = { ...b, id: budgets[idx].id };
  else budgets.push(b);
  saveBudgets();

  const totals = computeBudgetTotalsFromData(b);
  const fmt = new Intl.NumberFormat('es-PY', { style:'currency', currency:(b.currency||'PYG'), maximumFractionDigits:(b.currency==='USD'?2:0) });
  const contract = {
    id: (idx>=0 ? budgets[idx].id : b.id),
    number: b.number,
    issueDate: b.issueDate,
    validUntil: b.validUntil,
    currency: b.currency,
    clientName: b.client?.name || '',
    clientDoc: b.client?.doc || '',
    totalFinal: totals.totalFinal || 0,
    totalFinalText: fmt.format(totals.totalFinal || 0),
    createdAt: new Date().toISOString()
  };
  const cidx = contracts.findIndex(x=>x.id===contract.id);
  if(cidx>=0) contracts[cidx]=contract; else contracts.push(contract);
  saveContracts();

  toast('Presupuesto guardado ✔', 'ok');

  // limpiar y dejar listo el siguiente
  resetBudgetForm();

  // ir a historial (preferencia del usuario)
  goPage('historial');
});

$('#btnSendWhatsApp')?.addEventListener('click', ()=>{
  ensureDefaults();
  recalcTotals();
  const msg = `Presupuesto ${$('#budgetNumber').value.trim()}\n`+
    `Cliente: ${$('#clientName').value.trim() || 'Cliente'}\n`+
    `Total: ${$('#grandTotal').textContent}\n`+
    `Emisión: ${$('#issueDate').value}`;
  window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, '_blank');
});

// Contratos
function renderContracts(){
  const body = $('#contractsBody');
  if(!body) return;
  body.innerHTML = contracts.length ? contracts
    .slice().sort((a,b)=>String(b.createdAt||'').localeCompare(String(a.createdAt||'')))
    .map(c=>`
      <tr>
        <td>${escapeHtml(c.number||'')}</td>
        <td>${escapeHtml(c.issueDate||'')}</td>
        <td>${escapeHtml(c.validUntil||'')}</td>
        <td>${escapeHtml(c.currency||'PYG')}</td>
        <td>${escapeHtml(c.clientName||'')}</td>
        <td>${escapeHtml(c.clientDoc||'')}</td>
        <td class="r"><strong>${escapeHtml(c.totalFinalText||'')}</strong></td>
        <td class="r">
          <button class="pill-btn" data-act="view" data-id="${c.id}">Vista</button>
          <button class="pill-btn danger" data-act="del" data-id="${c.id}">Eliminar</button>
        </td>
      </tr>
    `).join('') : `<tr><td colspan="8" class="muted">Sin contratos emitidos.</td></tr>`;
}

$('#contractsBody')?.addEventListener('click', (e)=>{
  const btn = e.target.closest('button[data-act]');
  if(!btn) return;
  const id = btn.dataset.id;
  const act = btn.dataset.act;
  if(act==='del'){
    if(confirm('¿Eliminar del reporte?')){
      contracts = contracts.filter(x=>x.id!==id);
      saveContracts();
      toast('Contrato eliminado del reporte ✔', 'ok');
    }
  }
  if(act==='view'){
    const b = budgets.find(x=>x.id===id);
    if(b) openPreviewFromBudget(b);
    else toast('No se encontró el presupuesto base.', 'err');
  }
});

$('#btnExportContracts')?.addEventListener('click', ()=>{
  downloadCSV(`contratos_${todayISO()}.csv`,
    ['N° Presupuesto','Fecha emisión','Validez','Moneda','Cliente','Documento','Total'],
    contracts.map(c=>[c.number,c.issueDate,c.validUntil,c.currency,c.clientName,c.clientDoc,c.totalFinalText])
  );
  toast('Exportación contratos ✔', 'ok');
});

$('#btnExportBudgets')?.addEventListener('click', ()=>{
  const headers = [
    'Empresa','RUC','Dirección','Teléfono','Email','Leyenda',
    'N° Presupuesto','Fecha emisión','Validez','Moneda','Tipo cambio',
    'Cliente','Documento','Teléfono cliente','Dirección cliente','Email cliente',
    'Subtotal','Total descuentos','Desc global %','Desc global monto','IVA 5','IVA 10','Total final',
    'Observaciones','Firma','Cargo'
  ];
  const rows = budgets.map(b=>{
    const t = computeBudgetTotalsFromData(b);
    return [
      cfg.companyName, cfg.companyRuc, cfg.companyAddress, cfg.companyPhone, cfg.companyEmail, cfg.companyTagline,
      b.number, b.issueDate, b.validUntil, b.currency, b.fxRate,
      b.client?.name, b.client?.doc, b.client?.phone, b.client?.address, b.client?.email,
      t.sumBase, (t.sumItemDisc + t.globalDisc), b.globalDiscPct, b.globalDiscAmt, t.vat5, t.vat10, t.totalFinal,
      b.notes, b.signName, b.signRole
    ];
  });
  downloadCSV(`presupuestos_${todayISO()}.csv`, headers, rows);
  toast('Exportación presupuestos ✔', 'ok');
});

// ============================
// Vista previa + PDF
// ============================
const previewModal = $('#previewModal');
const printArea = $('#printArea');
function openPreview(){
  if(!validateBeforePreview()) return;
  ensureDefaults();
  recalcTotals();
  printArea.innerHTML = buildPreviewHtml();
  openStackModal(previewModal);
}
function closePreview(){ closeStackModal(previewModal); }
$('#btnPreview')?.addEventListener('click', openPreview);
$('#btnClosePreview')?.addEventListener('click', closePreview);

function buildPreviewHtml(){
  const budgetNumber = $('#budgetNumber').value.trim();
  const issueDate = $('#issueDate').value || '-';
  const validUntil = $('#validUntil').value || '-';
  const currency = getCurrency();
  const fxRate = parseGs($('#fxRate').value || '0');

  const client = {
    name: $('#clientName').value.trim() || '-',
    doc: $('#clientDoc').value.trim() || '-',
    phone: $('#clientPhone').value.trim() || '-',
    address: $('#clientAddress').value.trim() || '-',
    email: $('#clientEmail').value.trim() || '-'
  };

  const signName = $('#signName').value.trim();
  const signRole = $('#signRole').value.trim();
  const notes = $('#notes').value.trim() || '—';

  const rows = $$('.item-row').map(row=>{
    const desc = row.querySelector('.desc')?.value.trim() || '-';
    const qty = parseDecimalSmart(row.querySelector('.qty')?.value);
    const price = parsePrice(row.querySelector('.price')?.value);
    const vatType = row.querySelector('.vatType')?.value || 'EXE';

    const base = (qty||0)*(price||0);
    const discAmt = parseDecimalSmart(row.dataset.discount);
    const baseAfter = Math.max(0, base - discAmt);
    const rate = (vatType==='5') ? 0.05 : (vatType==='10' ? 0.10 : 0);
    const vat = baseAfter * rate;
    const total = baseAfter + vat;

    return { desc, qty, price, vatType, base, discAmt, vat, total };
  }).filter(r=>r.base > 0 && r.desc !== '-');

  let baseExe=0, base5=0, base10=0, sumBase=0, sumItemDisc=0;
  rows.forEach(r=>{
    sumBase += r.base;
    sumItemDisc += r.discAmt;
    const after = r.base - r.discAmt;
    if(r.vatType==='5') base5 += after;
    else if(r.vatType==='10') base10 += after;
    else baseExe += after;
  });

  const subtotalAfterItemDisc = baseExe + base5 + base10;
  const globalDisc = getGlobalDiscount(subtotalAfterItemDisc);
  const totalTaxBase = subtotalAfterItemDisc || 1;
  const disc5 = globalDisc * (base5/totalTaxBase);
  const disc10 = globalDisc * (base10/totalTaxBase);
  const vat5 = Math.max(0, (base5 - disc5) * 0.05);
  const vat10 = Math.max(0, (base10 - disc10) * 0.10);
  const totalFinal = (subtotalAfterItemDisc - globalDisc) + vat5 + vat10;

  const eqGs = (currency==='USD' && fxRate>0) ? (totalFinal * fxRate) : 0;

  const logoBlock = cfg.logoDataUrl
    ? `<div class="doc__logo"><img src="${cfg.logoDataUrl}" alt="Logo"></div>`
    : `<div class="doc__logo"><strong style="color:#0b3a6a;">LOGO</strong></div>`;

  const companyLines = [
    cfg.companyRuc ? `RUC: ${escapeHtml(cfg.companyRuc)}` : '',
    cfg.companyAddress ? escapeHtml(cfg.companyAddress) : '',
    cfg.companyPhone ? `Tel: ${escapeHtml(cfg.companyPhone)}` : '',
    cfg.companyEmail ? escapeHtml(cfg.companyEmail) : '',
    cfg.companyTagline ? escapeHtml(cfg.companyTagline) : ''
  ].filter(Boolean).join('<br>');

  const itemsHtml = rows.length ? rows.map(r=>`
    <tr>
      <td>${escapeHtml(r.desc)}</td>
      <td class="r">${formatQty(r.qty)}</td>
      <td class="r">${money(r.price)}</td>
      <td class="r">${r.vatType==='EXE' ? 'Exento' : (r.vatType+'%')}</td>
      <td class="r">${money(r.base)}</td>
      <td class="r">${money(r.discAmt)}</td>
      <td class="r"><strong>${money(r.total)}</strong></td>
    </tr>
  `).join('') : `<tr><td colspan="7" class="muted">Sin ítems cargados.</td></tr>`;

  const eqLine = (currency==='USD' && fxRate>0)
    ? `<div class="doc__field"><span>Equivalente (₲):</span> <strong>${new Intl.NumberFormat('es-PY',{style:'currency',currency:'PYG',maximumFractionDigits:0}).format(eqGs)}</strong></div>`
    : '';

  const footerLegal = `
    <div class="footer-legal">
      <strong>Este documento es solo informativo y NO VÁLIDO PARA EFECTOS FISCALES.</strong><br>
      Emitido para control interno y conocimiento del cliente.<br>
      Conserve este documento para su control.
    </div>
  `;

  return `
    <div class="doc">
      <div class="doc__head">
        <div class="doc__company">
          ${logoBlock}
          <div>
            <h3>${escapeHtml(cfg.companyName || 'Empresa')}</h3>
            <p>${companyLines || ''}</p>
          </div>
        </div>
        <div class="doc__meta">
          <span class="badge">PRESUPUESTO / CONTRATO</span>
          <dl>
            <dt>N° Presupuesto</dt><dd>${escapeHtml(budgetNumber)}</dd>
            <dt>Emisión</dt><dd>${escapeHtml(issueDate)}</dd>
            <dt>Validez</dt><dd>${escapeHtml(validUntil)}</dd>
            <dt>Moneda</dt><dd>${escapeHtml(currency)}</dd>
          </dl>
        </div>
      </div>

      <div class="doc__section">
        <h4>Datos del Cliente</h4>
        <div class="doc__box doc__grid">
          <div class="doc__field"><span>Razón social / Nombre:</span> ${escapeHtml(client.name)}</div>
          <div class="doc__field"><span>RUC / Documento:</span> ${escapeHtml(client.doc)}</div>
          <div class="doc__field"><span>Teléfono:</span> ${escapeHtml(client.phone)}</div>
          <div class="doc__field"><span>Email:</span> ${escapeHtml(client.email)}</div>
          <div class="doc__field full"><span>Dirección:</span> ${escapeHtml(client.address)}</div>
        </div>
      </div>

      <div class="doc__section doc__items">
        <h4>Ítems / Conceptos</h4>
        <div class="doc__box">
          <table>
            <thead>
              <tr>
                <th>Descripción</th>
                <th class="r">Cant.</th>
                <th class="r">P. Unit.</th>
                <th class="r">IVA</th>
                <th class="r">Subtotal</th>
                <th class="r">Desc.</th>
                <th class="r">Total ítem</th>
              </tr>
            </thead>
            <tbody>
              ${itemsHtml}
            </tbody>
            <tfoot>
              <tr>
                <td colspan="4"></td>
                <td class="r">${money(sumBase)}</td>
                <td class="r">${money(sumItemDisc + globalDisc)}</td>
                <td class="r">${money(totalFinal)}</td>
              </tr>
            </tfoot>
          </table>

          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:12px;">
            <div class="doc__field"><span>IVA 5%:</span> <strong>${money(vat5)}</strong></div>
            <div class="doc__field"><span>IVA 10%:</span> <strong>${money(vat10)}</strong></div>
            ${eqLine}
          </div>
        </div>
      </div>

      <div class="doc__section">
        <h4>Observaciones</h4>
        <div class="doc__box doc__notes">${escapeHtml(notes)}</div>
      </div>

      <div class="doc__section doc__signatures">
        <h4>Firmas</h4>
        <div class="sign-grid">
          <div class="sign-box">
            <div class="sign-line"></div>
            <div class="sign-meta">${escapeHtml(signName || ' ')}<small>Firma (Nombre del firmante)</small></div>
          </div>
          <div class="sign-box">
            <div class="sign-line"></div>
            <div class="sign-meta">${escapeHtml(signRole || ' ')}<small>Aclaración / Cargo</small></div>
          </div>
        </div>
      </div>

      <div class="doc__footer">${footerLegal}</div>
    </div>
  `;
}

function printPdfFromPreview(){
  const html = printArea.innerHTML || buildPreviewHtml();
  const w = window.open('', '_blank');
  if(!w){
    toast('Tu navegador bloqueó la ventana emergente.', 'err');
    return;
  }

  const css = `
    @page{ margin: 12mm; }
    *{ box-sizing:border-box; }
    body{ margin:0; padding:0; font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial; color:#0b1220; }
    .doc{ max-width: 900px; margin: 0 auto; background:#fff; color:#0b1220; padding: 18px; }
    .doc__head{ display:flex; justify-content:space-between; gap:14px; padding-bottom:12px; border-bottom:2px solid #0b3a6a; }
    .doc__company{ display:flex; gap:12px; align-items:flex-start; }
    .doc__logo{ width:64px; height:64px; border-radius:14px; border:1px solid #e3e9f3; display:flex; align-items:center; justify-content:center; overflow:hidden; }
    .doc__logo img{ width:100%; height:100%; object-fit:contain; }
    .badge{ display:inline-flex; padding:6px 10px; border-radius:999px; border:1px solid #dbe3f0; background:#f2f6fb; font-weight:900; font-size:12px; color:#17314f; }
    .doc__meta dl{ margin:10px 0 0; display:grid; grid-template-columns:auto auto; column-gap:10px; row-gap:4px; justify-content:end; font-size:12.5px; }
    .doc__meta dt{ color:#6b778a; }
    .doc__meta dd{ margin:0; font-weight:800; }
    .doc__section{ margin-top:14px; }
    .doc__section h4{ margin:0 0 8px; font-size:12.5px; color:#17314f; text-transform:uppercase; letter-spacing:.2px; }
    .doc__box{ border:1px solid #e3e9f3; border-radius:12px; padding:12px; background:#fbfdff; }
    .doc__grid{ display:grid; grid-template-columns: 1fr 1fr; gap:10px; }
    .doc__field{ font-size:12.8px; }
    .doc__field span{ color:#6b778a; font-weight:700; }
    .doc__items table{ width:100%; border-collapse:collapse; }
    .doc__items th, .doc__items td{ border-bottom:1px solid #eef2f8; padding:10px 8px; font-size:12.8px; vertical-align:top; }
    .doc__items th{ background:#f2f6fb; font-size:12px; color:#163252; text-align:left; }
    .r{ text-align:right; }
    .doc__items tfoot td{ border-top:2px solid #0b3a6a; font-weight:900; }
    .doc__notes{ white-space:pre-wrap; }
    .sign-grid{ display:grid; grid-template-columns:1fr 1fr; gap:18px; }
    .sign-box{ border:1px dashed #c8d3e3; border-radius:12px; padding:14px; min-height:92px; display:flex; flex-direction:column; justify-content:flex-end; background:#fff; }
    .sign-line{ height:1px; background:#0b3a6a; opacity:.45; margin:18px 0 8px; }
    .sign-meta{ font-size:12.5px; font-weight:800; color:#233754; }
    .sign-meta small{ display:block; font-weight:700; color:#6b778a; margin-top:2px; }
    .footer-legal{ border:1px solid #e3e9f3; border-radius:12px; background:#fbfdff; padding:12px; font-size:12.3px; color:#2a3a53; line-height:1.45; }
    .footer-legal strong{ color:#0b3a6a; }
    @media (max-width: 720px){ .doc__grid{ grid-template-columns:1fr; } .sign-grid{ grid-template-columns:1fr; } }
  `;

  w.document.open();
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>PDF</title><style>${css}</style></head><body>${html}</body></html>`);
  w.document.close();

  w.onload = ()=>{
    w.focus();
    w.print();
    setTimeout(()=>w.close(), 300);
  };
}

$('#btnPrint')?.addEventListener('click', ()=>{
  if(!printArea.innerHTML.trim()) printArea.innerHTML = buildPreviewHtml();
  printPdfFromPreview();
});

function openPreviewFromBudget(b){
  const snap = getDraftData();
  loadBudgetToForm(b);
  openPreview();
  setTimeout(()=>restoreDraftData(snap), 200);
}

// ============================
// Draft
// ============================
function getDraftData(){
  const rows = $$('.item-row').map(row=>({
    desc: row.querySelector('.desc')?.value || '',
    qty: row.querySelector('.qty')?.value || '',
    price: row.querySelector('.price')?.value || '',
    vatType: row.querySelector('.vatType')?.value || 'EXE',
    discPct: row.querySelector('.discPct')?.value || '',
    discAmt: row.querySelector('.discAmt')?.value || '',
    lastEdited: row.dataset.lastEdited || ''
  }));

  return {
    form: {
      budgetNumber: $('#budgetNumber').value,
      issueDate: $('#issueDate').value,
      validUntil: $('#validUntil').value,
      currency: $('#currency').value,
      fxRate: $('#fxRate').value,
      clientId: $('#clientSelect').value,
      clientName: $('#clientName').value,
      clientDoc: $('#clientDoc').value,
      clientPhone: $('#clientPhone').value,
      clientAddress: $('#clientAddress').value,
      clientEmail: $('#clientEmail').value,
      globalDiscPct: $('#globalDiscPct').value,
      globalDiscAmt: $('#globalDiscAmt').value,
      notes: $('#notes').value,
      signName: $('#signName').value,
      signRole: $('#signRole').value
    },
    items: rows
  };
}

function restoreDraftData(draft){
  if(!draft) return;
  if(draft.form){
    $('#budgetNumber').value = draft.form.budgetNumber || '';
    $('#issueDate').value = draft.form.issueDate || todayISO();
    $('#validUntil').value = draft.form.validUntil || '';
    $('#currency').value = draft.form.currency || 'PYG';
    $('#fxRate').value = draft.form.fxRate || '';
    $('#clientSelect').value = draft.form.clientId || '';
    $('#clientName').value = draft.form.clientName || '';
    $('#clientDoc').value = draft.form.clientDoc || '';
    $('#clientPhone').value = draft.form.clientPhone || '';
    $('#clientAddress').value = draft.form.clientAddress || '';
    $('#clientEmail').value = draft.form.clientEmail || '';
    $('#globalDiscPct').value = draft.form.globalDiscPct || '';
    $('#globalDiscAmt').value = draft.form.globalDiscAmt || '';
    $('#notes').value = draft.form.notes || '';
    $('#signName').value = draft.form.signName || '';
    $('#signRole').value = draft.form.signRole || '';
  }
  itemsBody.innerHTML='';
  (draft.items||[]).forEach(it=>createRow(it));
  if(!$$('.item-row').length) createRow({});
  recalcTotals();
}

function saveDraft(silent=false){
  saveJSON(LS.draft, getDraftData());
  if(!silent) toast('Borrador guardado ✔', 'ok');
}

function loadDraft(){
  const draft = loadJSON(LS.draft, null);
  if(draft) restoreDraftData(draft);
}

$('#btnSaveDraft')?.addEventListener('click', ()=>saveDraft(false));
setInterval(()=>{ try{ saveDraft(true); }catch{} }, 12000);

// ============================
// CSV
// ============================
function csvEscape(v){
  const s = String(v ?? '');
  if(/[",\n;]/.test(s)) return `"${s.replace(/"/g,'""')}"`;
  return s;
}
function downloadCSV(filename, headers, rows){
  const bom = '\uFEFF';
  const sep = ';';
  const csv = [headers.map(csvEscape).join(sep), ...rows.map(r=>r.map(csvEscape).join(sep))].join('\n');
  const blob = new Blob([bom + csv], { type:'text/csv;charset=utf-8;' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(()=>URL.revokeObjectURL(a.href), 1200);
}

// ============================
// Render All
// ============================
function renderClients(){
  renderClientSelect();
  renderClientsManager();
  renderClientsPage();
}
function renderItems(){
  renderCatalogSelect();
  renderItemsCatalog();
}
function renderAll(){
  renderClients();
  renderItems();
  renderBudgets();
  renderContracts();
}

// ============================
// Dashboard: abrir presupuesto desde actividad
// ============================
window.addEventListener('dashboard:open-budget', (e)=>{
  const id = e.detail?.id;
  if(!id) return;
  const b = budgets.find(x=>x.id===id);
  if(b) loadBudgetToForm(b);
  else goPage('historial');
});

// ============================
// INIT
// ============================
(function init(){
  initData();

  // defaults formulario
  $('#issueDate').value = $('#issueDate').value || todayISO();
  if(!$('#budgetNumber').value.trim()) $('#budgetNumber').value = nextBudgetNumber();
  if(!$$('.item-row').length) createRow({});
  recalcTotals();

  // abrir login si hay PIN y no hay sesión
  const pin = getPin();
  if(pin && !isUnlocked()) showLogin();
  else setAppEnabled(true);

  // vista inicial
  const h = (location.hash||'').replace('#','').trim();
  goPage(viewMeta[h] ? h : 'bienvenida');
})();
