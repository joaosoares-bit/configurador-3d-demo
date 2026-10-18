// Estado, regras e preço do configurador. Sem 3D e sem DOM: testa-se com node (regras.test.mjs).
//
// A ficha descreve grupos de opções. Cada grupo tem um tipo:
//   cor | material | variante  -> escolhe-se UMA opção (rádio)
//   extra | equipamento        -> liga/desliga cada opção (caixa)
//   texto                      -> texto livre (nome do barco)
//   pacote                     -> UMA opção que inclui outras (níveis de equipamento)
// Cada opção pode ter: preco, padrao, requer[], exclui[], inclui[] (ids "grupo:opcao" ou só "opcao"),
// consulta (true = o estaleiro não publica o preço: mostra-se «sob consulta» e o total avisa).

export const UNICOS = new Set(['cor', 'material', 'variante', 'pacote', 'motor', 'layout', 'ambiente']);
export const multiplo = (g) => !UNICOS.has(g.tipo) && g.tipo !== 'texto';

export function indice(ficha) {
  const op = new Map(); // "grupo:opcao" -> { g, o }
  for (const g of ficha.grupos) for (const o of g.opcoes || []) op.set(`${g.id}:${o.id}`, { g, o });
  const resolve = (ref) => {
    if (op.has(ref)) return ref;
    for (const k of op.keys()) if (k.endsWith(':' + ref)) return k;
    return null;
  };
  return { op, resolve };
}

// estado: { grupo: 'opcao' | ['op1','op2'] | 'texto' }
export function estadoInicial(ficha) {
  const e = {};
  for (const g of ficha.grupos) {
    if (g.tipo === 'texto') { e[g.id] = g.padrao || ''; continue; }
    const pad = (g.opcoes || []).filter((o) => o.padrao);
    e[g.id] = multiplo(g) ? pad.map((o) => o.id) : (pad[0] || (g.opcional ? null : g.opcoes[0]) || {}).id ?? null;
  }
  return aplicaInclusoes(ficha, e);
}

export function escolhidas(ficha, e) {
  const r = [];
  for (const g of ficha.grupos) {
    const v = e[g.id];
    if (g.tipo === 'texto') continue;
    for (const id of Array.isArray(v) ? v : v ? [v] : []) r.push(`${g.id}:${id}`);
  }
  return r;
}

// o que cada pacote escolhido inclui fica escolhido e a custo zero
export function incluidas(ficha, e) {
  const { op, resolve } = indice(ficha);
  const s = new Set();
  for (const k of escolhidas(ficha, e)) for (const ref of op.get(k)?.o.inclui || []) { const r = resolve(ref); if (r) s.add(r); }
  return s;
}

function aplicaInclusoes(ficha, e) {
  const { op } = indice(ficha);
  for (const k of incluidas(ficha, e)) {
    const [gid, oid] = k.split(':'); const g = op.get(k).g;
    if (multiplo(g)) { if (!e[gid].includes(oid)) e[gid] = [...e[gid], oid]; } else e[gid] = oid;
  }
  return e;
}

// porque é que uma opção não pode ser escolhida agora (null = pode)
export function bloqueio(ficha, e, gid, oid) {
  const { op, resolve } = indice(ficha);
  const k = `${gid}:${oid}`, o = op.get(k)?.o; if (!o) return 'não existe';
  const sel = new Set(escolhidas(ficha, e));
  const nome = (r) => op.get(r)?.o.nome || r;
  for (const ref of o.requer || []) {
    const alts = String(ref).split('|').map(resolve).filter(Boolean);
    if (alts.length && !alts.some((r) => sel.has(r))) return `Pede ${alts.map(nome).join(' ou ')}`;
  }
  return null;
}

// escolher: devolve { estado, saiu: [{ id, nome, porque }] } — os conflitos resolvem-se sozinhos e avisa-se
export function escolhe(ficha, e0, gid, oid, ligar = true) {
  const { op, resolve } = indice(ficha);
  const g = ficha.grupos.find((x) => x.id === gid);
  let e = structuredClone(e0);
  if (g.tipo === 'texto') { e[gid] = String(oid).slice(0, g.max || 24); return { estado: e, saiu: [] }; }
  if (multiplo(g)) e[gid] = ligar ? [...new Set([...(e[gid] || []), oid])] : (e[gid] || []).filter((x) => x !== oid);
  else e[gid] = ligar ? oid : (g.opcional ? null : e[gid]);
  const saiu = [];
  const k = `${gid}:${oid}`, o = op.get(k)?.o;
  if (ligar && o) {
    // o que esta opção exclui sai; e o que exclui esta opção também sai
    for (const outro of escolhidas(ficha, e)) {
      if (outro === k) continue;
      const oo = op.get(outro).o;
      const choca = (o.exclui || []).map(resolve).includes(outro) || (oo.exclui || []).map(resolve).includes(k);
      if (choca) { e = retira(ficha, e, outro); saiu.push({ id: outro, nome: oo.nome, porque: `não combina com ${o.nome}` }); }
    }
  }
  // o que deixou de ter o que pede, sai (em cascata)
  for (let volta = 0; volta < 5; volta++) {
    let mudou = false;
    for (const outro of escolhidas(ficha, e)) {
      const [gg, oo] = outro.split(':');
      const b = bloqueio(ficha, e, gg, oo);
      if (b) {
        const gr = op.get(outro).g;
        if (multiplo(gr) || gr.opcional) { e = retira(ficha, e, outro); saiu.push({ id: outro, nome: op.get(outro).o.nome, porque: b.toLowerCase() }); mudou = true; }
        else {
          // num grupo de escolha única, passa para a primeira opção possível
          const alt = gr.opcoes.find((x) => !bloqueio(ficha, { ...e, [gg]: x.id }, gg, x.id));
          if (alt && alt.id !== oo) { e[gg] = alt.id; saiu.push({ id: outro, nome: op.get(outro).o.nome, porque: `${b.toLowerCase()}; ficou ${alt.nome}` }); mudou = true; }
        }
      }
    }
    if (!mudou) break;
  }
  return { estado: aplicaInclusoes(ficha, e), saiu };
}

function retira(ficha, e, k) {
  const [gid, oid] = k.split(':'); const g = ficha.grupos.find((x) => x.id === gid);
  if (multiplo(g)) e[gid] = e[gid].filter((x) => x !== oid); else e[gid] = g.opcional ? null : e[gid];
  return e;
}

export function preco(ficha, e) {
  const { op } = indice(ficha);
  const inc = incluidas(ficha, e);
  const linhas = [];
  let total = ficha.preco?.base || 0;
  for (const k of escolhidas(ficha, e)) {
    const { g, o } = op.get(k);
    const p = inc.has(k) ? 0 : (o.preco || 0);
    total += p;
    linhas.push({ id: k, grupo: g.nome, nome: o.nome, preco: p, incluido: inc.has(k), padrao: !!o.padrao, consulta: !!o.consulta && !inc.has(k) });
  }
  for (const g of ficha.grupos) if (g.tipo === 'texto' && e[g.id]) linhas.push({ id: g.id, grupo: g.nome, nome: `«${e[g.id]}»`, preco: g.preco || 0 }), (total += g.preco || 0);
  return { total, linhas, moeda: ficha.preco?.moeda || 'EUR', consulta: linhas.some((l) => l.consulta) }; // consulta: há opções sem preço público
}

export function formata(v, moeda = 'EUR', lingua = 'pt-PT') {
  return new Intl.NumberFormat(lingua, { style: 'currency', currency: moeda, maximumFractionDigits: 0 }).format(v);
}

// estado <-> endereço (para partilhar a configuração por link)
export function codifica(e) {
  const s = JSON.stringify(e);
  const b = typeof btoa === 'function' ? btoa(unescape(encodeURIComponent(s))) : Buffer.from(s).toString('base64');
  return b.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function descodifica(ficha, txt) {
  try {
    const b = txt.replace(/-/g, '+').replace(/_/g, '/');
    const s = typeof atob === 'function' ? decodeURIComponent(escape(atob(b))) : Buffer.from(b, 'base64').toString();
    const e = { ...estadoInicial(ficha), ...JSON.parse(s) };
    for (const g of ficha.grupos) if (!(g.id in e)) delete e[g.id];
    return e;
  } catch { return null; }
}
