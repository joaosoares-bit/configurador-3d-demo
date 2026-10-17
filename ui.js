// O painel do configurador, construído a partir da ficha. Liga as regras (regras.js) ao visor (motor.js).
import * as R from './regras.js';
import { criaVisor } from './motor.js';

const h = (tag, attrs = {}, ...filhos) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else if (k === 'html') e.innerHTML = v; else e.setAttribute(k, v === true ? '' : v);
  }
  for (const f of filhos.flat(9)) if (f != null && f !== false) e.append(f.nodeType ? f : document.createTextNode(f));
  return e;
};
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

export async function montaConfigurador(raiz, ficha, { base } = {}) {
  const lingua = ficha.lingua || 'pt-PT';
  const T = { pt: { resumo: 'Resumo', total: 'Total', padrao: 'de série', incluido: 'incluído', proposta: 'Pedir proposta', link: 'Copiar link', copiado: 'Link copiado', imagem: 'Descarregar imagem', ar: 'Ver no meu espaço', glb: 'Modelo 3D (.glb)', anterior: 'Anterior', seguinte: 'Seguinte', carregar: 'A preparar o', nome: 'Escreva o nome', semNome: 'sem nome', ambiente: 'Ambiente', vistas: 'Vistas', desde: 'Preço desde', preco: 'Preço', iva: 'IVA não incluído' } }.pt;
  const fmt = (v) => R.formata(v, ficha.preco?.moeda || 'EUR', lingua);
  let estado = R.estadoInicial(ficha);
  const doLink = new URLSearchParams(location.hash.slice(1)).get('c');
  if (doLink) estado = R.descodifica(ficha, doLink) || estado;

  /* ---------- esqueleto ---------- */
  const palco = h('div', { class: 'cf-palco' });
  const carga = h('div', { class: 'cf-carga' },
    ficha.capa ? h('img', { src: new URL(ficha.capa, base).href, alt: '' }) : null,
    h('div', { class: 'cf-carga-txt' }, h('span', {}, `${T.carregar} ${ficha.nome}`), h('b', { 'data-pct': '' }, '0%')),
    h('div', { class: 'cf-carga-barra' }, h('i')));
  const vistas = h('div', { class: 'cf-vistas', role: 'toolbar', 'aria-label': T.vistas });
  const ambientes = h('div', { class: 'cf-ambientes', role: 'toolbar', 'aria-label': T.ambiente });
  const cartaoPonto = h('div', { class: 'cf-cartao', hidden: true, role: 'dialog', 'aria-live': 'polite' });
  palco.append(carga, vistas, ambientes, cartaoPonto);
  const painel = h('aside', { class: 'cf-painel' });
  const cab = h('header', { class: 'cf-cab' },
    h('div', { class: 'cf-marca' }, ficha.marca || ''),
    h('h1', { class: 'cf-modelo' }, ficha.nome),
    h('p', { class: 'cf-medidas', 'data-medidas': '' }),
    ficha.creditos ? h('p', { class: 'cf-creditos' }, ficha.creditos) : null);
  const passosNav = h('nav', { class: 'cf-passos', role: 'tablist' });
  const corpo = h('div', { class: 'cf-corpo' });
  const barra = h('footer', { class: 'cf-barra' },
    h('div', { class: 'cf-total' }, h('span', {}, ficha.preco ? T.preco : ''), h('b', { 'data-total': '' })),
    h('button', { type: 'button', class: 'cf-btn cf-btn-sec', 'data-ant': '' }, T.anterior),
    h('button', { type: 'button', class: 'cf-btn', 'data-seg': '' }, T.seguinte));
  painel.append(cab, passosNav, corpo, barra);
  const aviso = h('div', { class: 'cf-aviso', role: 'status', 'aria-live': 'polite' });
  raiz.classList.add('cf'); raiz.append(palco, painel, aviso);

  /* ---------- o visor ---------- */
  const visor = await criaVisor(palco, ficha, {
    base,
    aoProgresso: (k) => { carga.querySelector('[data-pct]').textContent = Math.round(k * 100) + '%'; carga.style.setProperty('--p', k); },
    aoPronto: () => setTimeout(() => carga.classList.add('feito'), 150),
  });
  const md = visor.medidas;
  cab.querySelector('[data-medidas]').textContent = ficha.medidas || `${md.comprimento.toFixed(1)} m × ${md.boca.toFixed(2)} m`;
  for (const n of visor.cameras) vistas.append(h('button', { type: 'button', class: 'cf-chip', onclick: () => visor.voa(n) }, n));
  const ambs = ficha.ambientes || [['estudio', 'Estúdio'], ['mar', 'Mar'], ['por-do-sol', 'Pôr do sol'], ['noite', 'Noite']];
  let ambAct = ficha.ambienteInicial || 'estudio';
  if (ambs.length > 1) for (const [id, nome] of ambs) ambientes.append(h('button', { type: 'button', class: 'cf-chip', 'aria-pressed': String(id === ambAct), onclick: (e) => {
    ambAct = id; visor.poeAmbiente(id); ambientes.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b === e.currentTarget)));
  } }, nome));
  if (ficha.corte) {
    let dentro = false;
    const b = h('button', { type: 'button', class: 'cf-chip cf-chip-corte', 'aria-pressed': 'false', onclick: () => { dentro = visor.corte(!dentro); b.setAttribute('aria-pressed', String(dentro)); b.textContent = dentro ? (ficha.corte.fechar || 'Fechar') : (ficha.corte.nome || 'Ver por dentro'); } }, ficha.corte.nome || 'Ver por dentro');
    ambientes.prepend(b);
  }
  visor.pontos.forEach((pt) => pt.b.addEventListener('click', () => {
    cartaoPonto.hidden = false; cartaoPonto.innerHTML = `<button type="button" class="cf-fecha" aria-label="Fechar">×</button><h3>${esc(pt.p.titulo)}</h3><p>${esc(pt.p.texto || '')}</p>`;
    cartaoPonto.querySelector('button').onclick = () => (cartaoPonto.hidden = true);
    if (pt.p.camera) visor.voa(pt.p.camera);
  }));

  /* ---------- passos e grupos ---------- */
  const passos = ficha.passos || [{ id: 'tudo', nome: 'Configurar', grupos: ficha.grupos.map((g) => g.id) }];
  passos.push({ id: 'resumo', nome: T.resumo, resumo: true });
  let passo = 0;
  const telemovel = () => matchMedia('(max-width: 900px)').matches;
  const reduzMov = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const tabs = passos.map((p, i) => h('button', { type: 'button', role: 'tab', class: 'cf-passo', onclick: () => vai(i) }, h('i', {}, String(i + 1)), p.nome));
  passosNav.append(...tabs);
  barra.querySelector('[data-ant]').onclick = () => vai(passo - 1);
  barra.querySelector('[data-seg]').onclick = () => vai(passo + 1);

  function vai(i) {
    passo = Math.max(0, Math.min(passos.length - 1, i));
    tabs.forEach((t, k) => { t.setAttribute('aria-selected', String(k === passo)); t.classList.toggle('feito', k < passo); });
    barra.querySelector('[data-ant]').disabled = passo === 0;
    barra.querySelector('[data-seg]').hidden = passo === passos.length - 1;
    const p = passos[passo];
    if (p.camera) visor.voa(p.camera);
    desenha(); corpo.scrollTop = 0;
    // o separador escolhido ao centro, só na horizontal (scrollIntoView também mexia a página na vertical)
    const tb = tabs[passo]; passosNav.scrollTo({ left: tb.offsetLeft - (passosNav.clientWidth - tb.clientWidth) / 2, behavior: 'smooth' });
    // no telemóvel, quem carrega em «Seguinte» lá em baixo volta ao início das opções do passo novo (só se já passou dele)
    if (telemovel() && passosNav.getBoundingClientRect().top < 0) passosNav.scrollIntoView({ block: 'start', behavior: reduzMov ? 'auto' : 'smooth' });
  }

  function muda(gid, oid, ligar) {
    const r = R.escolhe(ficha, estado, gid, oid, ligar);
    estado = r.estado;
    const g = ficha.grupos.find((x) => x.id === gid), o = g.opcoes?.find((x) => x.id === oid);
    if (o?.camera || g.camera) visor.voa(o?.camera || g.camera);
    visor.aplica(estado, ficha);
    if (r.saiu.length) avisa(r.saiu.map((s) => `${s.nome} saiu: ${s.porque}`).join(' · '));
    history.replaceState(null, '', '#c=' + R.codifica(estado));
    desenha();
  }

  let tAviso;
  function avisa(txt) { aviso.textContent = txt; aviso.classList.add('ver'); clearTimeout(tAviso); tAviso = setTimeout(() => aviso.classList.remove('ver'), 4200); }

  function amostraCor(g, o, on, bloq) {
    const fin = o.acabamento || ficha.zonas?.[o.zona || g.zona]?.acabamento || 'solido';
    return h('button', { type: 'button', class: `cf-amostra fin-${fin}`, 'aria-pressed': String(on), disabled: !!bloq, title: bloq || `${o.nome}${o.preco ? ' · +' + fmt(o.preco) : ''}`,
      'aria-label': `${o.nome}${o.preco ? ', mais ' + fmt(o.preco) : ''}${bloq ? '. ' + bloq : ''}`, style: `--c:${o.hex || '#ccc'}`, onclick: () => muda(g.id, o.id, true) },
      h('span', { class: 'cf-amostra-cor' }));
  }

  function desenha() {
    corpo.replaceChildren();
    const p = passos[passo];
    if (p.resumo) return desenhaResumo();
    const pr = R.preco(ficha, estado), inc = R.incluidas(ficha, estado);
    for (const gid of p.grupos) {
      const g = ficha.grupos.find((x) => x.id === gid); if (!g) continue;
      const v = estado[g.id];
      const sel = (g.opcoes || []).filter((o) => (Array.isArray(v) ? v.includes(o.id) : v === o.id));
      const sec = h('section', { class: `cf-grupo tipo-${g.tipo}` },
        h('div', { class: 'cf-grupo-cab' }, h('h2', {}, g.nome),
          g.tipo !== 'texto' && !R.multiplo(g) ? h('span', { class: 'cf-escolha' }, sel[0]?.nome || '—', sel[0]?.padrao ? h('i', {}, T.padrao) : null) : null),
        g.descricao ? h('p', { class: 'cf-grupo-desc' }, g.descricao) : null);
      if ((g.tipo === 'cor' || g.tipo === 'material') && g.opcoes.every((o) => o.hex)) {
        const lista = h('div', { class: 'cf-amostras' });
        for (const o of g.opcoes) lista.append(amostraCor(g, o, sel.includes(o), R.bloqueio(ficha, estado, g.id, o.id)));
        sec.append(lista);
        if (sel[0]?.preco) sec.append(h('p', { class: 'cf-preco-op' }, '+' + fmt(sel[0].preco)));
      } else if (g.tipo === 'texto') {
        const inp = h('input', { type: 'text', class: 'cf-texto', maxlength: g.max || 24, value: v || '', placeholder: T.nome, 'aria-label': g.nome });
        inp.addEventListener('input', () => { clearTimeout(inp._t); inp._t = setTimeout(() => muda(g.id, inp.value), 250); });
        sec.append(inp); if (g.preco) sec.append(h('p', { class: 'cf-preco-op' }, '+' + fmt(g.preco)));
      } else {
        const lista = h('div', { class: R.multiplo(g) ? 'cf-extras' : 'cf-cartoes' });
        for (const o of g.opcoes) {
          const on = sel.includes(o), bloq = on ? null : R.bloqueio(ficha, estado, g.id, o.id), multi = R.multiplo(g);
          const incl = inc.has(`${g.id}:${o.id}`);
          lista.append(h('button', { type: 'button', class: 'cf-cartao-op', 'aria-pressed': String(on), disabled: !!bloq || (incl && on && multi),
            onclick: () => muda(g.id, o.id, multi ? !on : true) },
            o.imagem ? h('img', { src: new URL(o.imagem, base).href, alt: '', loading: 'lazy' }) : null,
            h('span', { class: 'cf-op-nome' }, o.nome),
            o.descricao ? h('span', { class: 'cf-op-desc' }, o.descricao) : null,
            bloq ? h('span', { class: 'cf-op-bloq' }, bloq) : null,
            h('span', { class: 'cf-op-preco' }, incl ? T.incluido : o.preco ? '+' + fmt(o.preco) : o.padrao ? T.padrao : '')));
        }
        sec.append(lista);
      }
      corpo.append(sec);
    }
    barra.querySelector('[data-total]').textContent = ficha.preco ? fmt(pr.total) : '';
  }

  function desenhaResumo() {
    const pr = R.preco(ficha, estado);
    const tab = h('table', { class: 'cf-resumo' },
      h('tbody', {}, ...pr.linhas.map((l) => h('tr', {}, h('th', {}, l.grupo), h('td', {}, l.nome), h('td', { class: 'num' }, l.incluido ? T.incluido : l.preco ? fmt(l.preco) : l.padrao ? T.padrao : '—')))),
      ficha.preco ? h('tfoot', {}, h('tr', {}, h('th', { colspan: 2 }, T.total, ficha.preco.nota ? h('small', {}, ficha.preco.nota) : null), h('td', { class: 'num' }, fmt(pr.total)))) : null);
    const link = () => location.href.split('#')[0] + '#c=' + R.codifica(estado);
    const acoes = h('div', { class: 'cf-acoes' },
      h('button', { type: 'button', class: 'cf-btn', onclick: () => pedeProposta(pr, link()) }, T.proposta),
      h('button', { type: 'button', class: 'cf-btn cf-btn-sec', onclick: async () => { await navigator.clipboard?.writeText(link()); avisa(T.copiado); } }, T.link),
      h('button', { type: 'button', class: 'cf-btn cf-btn-sec', onclick: async () => descarrega(await visor.fotografia(2), `${ficha.id || 'barco'}.png`) }, T.imagem),
      /iPhone|iPad|Macintosh/.test(navigator.userAgent) && 'ontouchend' in document
        ? h('button', { type: 'button', class: 'cf-btn cf-btn-sec', onclick: async () => abreAR(await visor.exportaUSDZ()) }, T.ar)
        : h('button', { type: 'button', class: 'cf-btn cf-btn-sec', onclick: async () => descarrega(await visor.exportaGLB(), `${ficha.id || 'barco'}.glb`) }, T.glb));
    corpo.append(tab, acoes);
    barra.querySelector('[data-total]').textContent = ficha.preco ? fmt(pr.total) : '';
  }

  function pedeProposta(pr, link) {
    const linhas = pr.linhas.map((l) => `• ${l.grupo}: ${l.nome}`).join('\n');
    const txt = `${ficha.nome}\n${linhas}\n${ficha.preco ? 'Total: ' + fmt(pr.total) + '\n' : ''}${link}`;
    const c = ficha.contacto || {};
    if (c.whatsapp) open(`https://wa.me/${c.whatsapp.replace(/\D/g, '')}?text=${encodeURIComponent(txt)}`, '_blank', 'noopener');
    else if (c.email) location.href = `mailto:${c.email}?subject=${encodeURIComponent('Proposta ' + ficha.nome)}&body=${encodeURIComponent(txt)}`;
    else if (c.formulario) location.href = `${c.formulario}?config=${encodeURIComponent(R.codifica(estado))}`;
    else { navigator.clipboard?.writeText(txt); avisa(T.copiado); }
  }
  function descarrega(blob, nome) { const a = h('a', { href: URL.createObjectURL(blob), download: nome }); document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); }
  function abreAR(blob) { const a = h('a', { rel: 'ar', href: URL.createObjectURL(blob) }, h('img', { alt: '' })); document.body.append(a); a.click(); a.remove(); }

  visor.aplica(estado, ficha);
  vai(0);
  return { visor, get estado() { return estado; }, muda, vai };
}
