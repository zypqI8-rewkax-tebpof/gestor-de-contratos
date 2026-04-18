// dashboard.js
// Dashboard con gráfico (canvas) + actividad reciente.

(function(){
  const LS = {
    clients: 'budget_clients_app_v1',
    items: 'budget_items_app_v1',
    budgets: 'budget_budgets_app_v1',
    contracts: 'budget_contracts_app_v1',
  };

  function loadJSON(k, def){
    const raw = localStorage.getItem(k);
    if(!raw) return def;
    try{ return JSON.parse(raw); }catch{ return def; }
  }

  function fmtDate(iso){
    if(!iso) return '—';
    try{
      const d = new Date(iso);
      return d.toLocaleString('es-PY', { dateStyle:'short', timeStyle:'short' });
    }catch{ return '—'; }
  }

  function setText(id, v){
    const el = document.getElementById(id);
    if(el) el.textContent = String(v ?? '—');
  }

  function monthKey(d){
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth()+1).padStart(2,'0');
    return `${yyyy}-${mm}`;
  }

  function monthLabel(key){
    const [y,m] = key.split('-');
    const date = new Date(Number(y), Number(m)-1, 1);
    return date.toLocaleDateString('es-PY', { month:'short' });
  }

  function buildSeries(budgets){
    const now = new Date();
    const keys = [];
    for(let i=5;i>=0;i--){
      const d = new Date(now.getFullYear(), now.getMonth()-i, 1);
      keys.push(monthKey(d));
    }
    const counts = Object.fromEntries(keys.map(k=>[k,0]));

    budgets.forEach(b=>{
      const d = new Date(b.issueDate || b.createdAt || Date.now());
      const k = monthKey(d);
      if(counts[k] !== undefined) counts[k]++;
    });

    return {
      keys,
      labels: keys.map(monthLabel),
      values: keys.map(k=>counts[k] || 0)
    };
  }

  function roundRect(ctx, x, y, w, h, r){
    const radius = Math.min(r, w/2, h/2);
    ctx.beginPath();
    ctx.moveTo(x+radius, y);
    ctx.arcTo(x+w, y, x+w, y+h, radius);
    ctx.arcTo(x+w, y+h, x, y+h, radius);
    ctx.arcTo(x, y+h, x, y, radius);
    ctx.arcTo(x, y, x+w, y, radius);
    ctx.closePath();
  }

  function drawChart(labels, values){
    const canvas = document.getElementById('dashChart');
    if(!canvas) return;
    const ctx = canvas.getContext('2d');

    const cssW = canvas.clientWidth || 900;
    const cssH = canvas.clientHeight || 260;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    ctx.setTransform(dpr,0,0,dpr,0,0);

    ctx.clearRect(0,0,cssW,cssH);

    ctx.fillStyle = '#fbfdff';
    ctx.fillRect(0,0,cssW,cssH);

    const padding = { l: 42, r: 14, t: 14, b: 34 };
    const w = cssW - padding.l - padding.r;
    const h = cssH - padding.t - padding.b;

    const maxV = Math.max(3, ...values);

    ctx.strokeStyle = '#e3e9f3';
    ctx.lineWidth = 1;
    for(let i=0;i<=3;i++){
      const y = padding.t + (h/3)*i;
      ctx.beginPath();
      ctx.moveTo(padding.l, y);
      ctx.lineTo(padding.l+w, y);
      ctx.stroke();
    }

    const n = values.length;
    const gap = 10;
    const barW = Math.max(20, (w - gap*(n-1)) / n);

    for(let i=0;i<n;i++){
      const v = values[i];
      const barH = (v/maxV) * (h-6);
      const x = padding.l + i*(barW+gap);
      const y = padding.t + h - barH;

      const grad = ctx.createLinearGradient(0,y,0,y+barH);
      grad.addColorStop(0,'#0aa3ff');
      grad.addColorStop(1,'#0b3a6a');

      ctx.fillStyle = grad;
      roundRect(ctx, x, y, barW, barH, 10);
      ctx.fill();

      ctx.fillStyle = '#0b1220';
      ctx.font = '700 12px ui-sans-serif, system-ui';
      ctx.textAlign = 'center';
      ctx.fillText(String(v), x + barW/2, y - 6);

      ctx.fillStyle = '#4b5a70';
      ctx.font = '700 12px ui-sans-serif, system-ui';
      ctx.fillText(labels[i], x + barW/2, padding.t + h + 20);
    }

    ctx.fillStyle = '#17314f';
    ctx.font = '800 12px ui-sans-serif, system-ui';
    ctx.textAlign = 'left';
    ctx.fillText('Presupuestos / mes', padding.l, 12);
  }

  function renderRecent(){
    const host = document.getElementById('dashRecent');
    if(!host) return;

    const budgets = loadJSON(LS.budgets, [])
      .slice()
      .sort((a,b)=>String(b.createdAt||'').localeCompare(String(a.createdAt||'')))
      .slice(0,5);

    if(!budgets.length){
      host.innerHTML = '<div class="muted">Todavía no hay presupuestos guardados.</div>';
      return;
    }

    host.innerHTML = budgets.map(b=>{
      return `
        <div class="recent__item">
          <div>
            <div><strong>${b.number || ''}</strong> — ${b.client?.name || ''}</div>
            <div class="muted">${fmtDate(b.createdAt)} · ${b.currency || 'PYG'}</div>
          </div>
          <div class="recent__actions">
            <button class="btn btn--ghost" data-open-budget="${b.id}"><i class="bi bi-box-arrow-in-right"></i> Abrir</button>
          </div>
        </div>
      `;
    }).join('');
  }

  function refresh(){
    const clients = loadJSON(LS.clients, []);
    const items = loadJSON(LS.items, []);
    const budgets = loadJSON(LS.budgets, []);
    const contracts = loadJSON(LS.contracts, []);

    setText('statClients', clients.length);
    setText('statItems', items.length);
    setText('statBudgets', budgets.length);
    setText('statContracts', contracts.length);

    const lastBudget = budgets.slice().sort((a,b)=>String(b.createdAt||'').localeCompare(String(a.createdAt||'')))[0];
    setText('statLastBudget', lastBudget ? `${lastBudget.number || ''} · ${fmtDate(lastBudget.createdAt)}` : '—');

    setText('statLastBackup', localStorage.getItem('budget_last_backup') || '—');

    const series = buildSeries(budgets);
    drawChart(series.labels, series.values);

    renderRecent();
  }

  document.addEventListener('click', (e)=>{
    const btn = e.target.closest('[data-open-budget]');
    if(!btn) return;
    const id = btn.getAttribute('data-open-budget');
    window.dispatchEvent(new CustomEvent('dashboard:open-budget', { detail:{ id } }));
  });

  document.addEventListener('DOMContentLoaded', ()=>{
    refresh();
    document.getElementById('btnDashConfig')?.addEventListener('click', ()=>{
      document.getElementById('btnOpenConfig')?.click();
    });
    window.addEventListener('resize', ()=>{
      const budgets = loadJSON(LS.budgets, []);
      const series = buildSeries(budgets);
      drawChart(series.labels, series.values);
    });
  });

  window.addEventListener('app:data-changed', refresh);
})();
