// Mapeador: diz o que é cada peça de um modelo qualquer (CAD, web, fotografias, IA) e escreve o início da ficha.
import * as THREE from './vendor/three.module.js';
import { GLTFLoader } from './vendor/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from './vendor/addons/libs/meshopt_decoder.module.js';
import { RoomEnvironment } from './vendor/addons/environments/RoomEnvironment.js';
import CameraControls from './vendor/camera-controls.module.js';
CameraControls.install({ THREE });

const $ = (s) => document.querySelector(s);
const catalogo = await (await fetch('./catalogo.json')).json();
const ZONAS = catalogo.zonas;

const palco = $('#palco');
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.AgXToneMapping;
palco.prepend(renderer.domElement);
const cena = new THREE.Scene(); cena.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
const cam = new THREE.PerspectiveCamera(32, 1, 0.05, 5000);
const ctl = new CameraControls(cam, renderer.domElement);
const relogio = new THREE.Clock();
function ajusta() { const w = palco.clientWidth, h = palco.clientHeight; renderer.setSize(w, h, false); cam.aspect = w / h; cam.updateProjectionMatrix(); }
new ResizeObserver(ajusta).observe(palco); ajusta();
(function laco() { requestAnimationFrame(laco); ctl.update(relogio.getDelta()); renderer.render(cena, cam); })();

let pecas = [], nomeModelo = 'modelo', raiz = null, maiorClara = 0, modoPontos = false, modoNome = false, sitioNome = null, caixaR = 10; const pontos = [];
const corDe = (m) => { const c = [].concat(m.material)[0]?.color; return c ? '#' + c.getHexString() : '#999'; };

// sugestão: primeiro pelo nome (em várias línguas), depois pela cor e pela forma
function sugere(p, caixaBarco) {
  // separa camelCase e números ("LightGray" -> "light gray") e tira nomes de cor que parecem peças ("light gray" não é uma luz)
  const n = (' ' + p.nome.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_\-.#|]+/g, ' ').toLowerCase() + ' ')
    .replace(/\b(light|dark)\s*(gr[ae]y|blue|green|red|brown|beige)\b/g, ' cor ');
  for (const [id, z] of Object.entries(ZONAS)) if (new RegExp(`(^|[^a-z])(${z.procura})([^a-z]|$)`, 'i').test(n)) return id;
  const mat = [].concat(p.malha.material)[0]; const c = mat?.color; if (!c) return '';
  const hsl = {}; c.getHSL(hsl);
  if (mat.transparent && mat.opacity < 0.8) return 'vidro';
  if (mat.metalness > 0.6) return 'metal';
  const cx = p.caixa, alt = (cx.max.y - caixaBarco.min.y) / (caixaBarco.max.y - caixaBarco.min.y);
  if (hsl.h > 0.04 && hsl.h < 0.13 && hsl.s > 0.25 && hsl.l > 0.25 && hsl.l < 0.75) return 'teca';
  // a peça clara maior e comprida, a meia altura, é quase sempre o casco
  const tam = cx.getSize(new THREE.Vector3()), tb = caixaBarco.getSize(new THREE.Vector3());
  if (tam.x > tb.x * 0.7 && hsl.l > 0.6 && p.tri === maiorClara) return 'casco';
  if (tam.x > tb.x * 0.6 && cx.max.y < caixaBarco.min.y + tb.y * 0.25 && hsl.l < 0.45) return 'antivegetativa';
  return '';
}

async function carrega(url, nome) {
  if (raiz) { cena.remove(raiz); }
  const g = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync(url);
  raiz = g.scene; cena.add(raiz); nomeModelo = (nome || url).split('/').pop().replace(/\.(glb|gltf)$/i, '');
  const cb = new THREE.Box3().setFromObject(raiz); caixaR = cb.getSize(new THREE.Vector3()).length();
  pecas = [];
  const claras = []; raiz.traverse((o) => { if (o.isMesh) { const c = [].concat(o.material)[0].color, hs = {}; c?.getHSL(hs); if (hs.l > 0.6) claras.push((o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3); } });
  maiorClara = Math.max(0, ...claras);
  raiz.traverse((o) => {
    if (!o.isMesh) return;
    o.material = [].concat(o.material).map((m) => m.clone())[0];
    const caixa = new THREE.Box3().setFromObject(o);
    const p = { malha: o, nome: o.name.replace(/_+/g, ' '), material: [].concat(o.material)[0].name || '', tri: (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3, caixa, zona: '', oculta: false, variante: '' };
    p.sugestao = sugere({ ...p, nome: p.nome + ' ' + p.material }, cb); pecas.push(p);
  });
  pecas.sort((a, b) => b.tri - a.tri);
  const tb = cb.getSize(new THREE.Vector3()), cc = cb.getCenter(new THREE.Vector3());
  ctl.setLookAt(cc.x + tb.x * 0.9, tb.y * 1.4, cc.z + tb.x * 0.9, cc.x, tb.y * 0.35, cc.z, false);
  ctl.fitToBox(raiz, false, { paddingLeft: tb.x * 0.04, paddingRight: tb.x * 0.04, paddingTop: tb.y * 0.2, paddingBottom: tb.y * 0.2 });
  $('#largar').classList.add('oculto');
  $('[data-info]').textContent = `${nomeModelo}: ${pecas.length} peças, ${Math.round(pecas.reduce((a, p) => a + p.tri, 0)).toLocaleString('pt-PT')} triângulos, ${cb.getSize(new THREE.Vector3()).x.toFixed(1)} m de comprido.`;
  desenha();
}

const lista = $('[data-lista]');
let filtro = { texto: '', so: '' };
function desenha() {
  lista.replaceChildren();
  for (const p of pecas) {
    if (filtro.texto && !(p.nome + p.material).toLowerCase().includes(filtro.texto)) continue;
    if (filtro.so === 'sem' && p.zona) continue;
    if (filtro.so === 'sug' && !(p.sugestao && !p.zona)) continue;
    const li = document.createElement('li'); li.className = p.oculta ? 'oculta' : ''; p.li = li;
    const sel = document.createElement('select');
    sel.innerHTML = `<option value="">—</option>` + Object.entries(ZONAS).map(([id, z]) => `<option value="${id}">${z.nome}</option>`).join('') + `<option value="__nova">+ zona nova…</option>`;
    const zs = new Set(pecas.map((x) => x.zona).filter((z) => z && !ZONAS[z])); for (const z of zs) sel.insertAdjacentHTML('beforeend', `<option value="${z}">${z}</option>`);
    sel.value = p.zona || p.sugestao || ''; sel.classList.toggle('sugerido', !p.zona && !!p.sugestao);
    sel.onchange = () => { let v = sel.value; if (v === '__nova') v = (prompt('Nome da zona (sem espaços):') || '').trim().replace(/\s+/g, '-'); p.zona = v; desenha(); };
    li.innerHTML = `<span class="cor" style="background:${corDe(p.malha)}"></span><span class="n" title="${p.nome}">${p.nome}<small>${p.material} · ${Math.round(p.tri).toLocaleString('pt-PT')} tri</small></span>`;
    const olho = document.createElement('button'); olho.className = 'olho'; olho.type = 'button'; olho.textContent = p.oculta ? '◌' : '●'; olho.title = 'Esconder do configurador (sombras, chãos, peças duplicadas)';
    olho.onclick = () => { p.oculta = !p.oculta; p.malha.visible = !p.oculta; desenha(); };
    li.append(sel, olho);
    li.onmouseenter = () => realca(p, true); li.onmouseleave = () => realca(p, false);
    lista.append(li);
  }
  const feitas = pecas.filter((p) => p.zona).length, sug = pecas.filter((p) => !p.zona && p.sugestao).length;
  $('[data-resumo]').textContent = `${feitas} de ${pecas.length} peças com zona · ${sug} sugestões por aceitar · ${pecas.filter((p) => p.oculta).length} escondidas · ${pontos.length} pontos`;
}
function realca(p, on) { const m = p.malha.material; if (!m.emissive) return; m.emissive.set(on ? 0xb08d57 : 0x000000); m.emissiveIntensity = on ? 0.9 : 0; }

// clicar no barco encontra a peça na lista
const ray = new THREE.Raycaster(), rato = new THREE.Vector2(); let baixo = null;
renderer.domElement.addEventListener('pointerdown', (e) => (baixo = [e.clientX, e.clientY]));
renderer.domElement.addEventListener('pointerup', (e) => {
  if (!baixo || Math.hypot(e.clientX - baixo[0], e.clientY - baixo[1]) > 4 || !raiz) return;
  const r = renderer.domElement.getBoundingClientRect(); rato.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(rato, cam); const hit = ray.intersectObject(raiz, true).find((h) => h.object.visible);
  if (!hit) return;
  if (modoNome) { // o sítio onde se escreve o nome do barco: o ponto e a direcção da parede
    const nrm = hit.face.normal.clone().transformDirection(hit.object.matrixWorld);
    sitioNome = { malhas: '^' + escRe(hit.object.name.replace(/_+/g, ' ')) + '\\|', pos: hit.point.toArray().map((v) => +v.toFixed(3)), normal: nrm.toArray().map((v) => +v.toFixed(3)) };
    modoNome = false; $('[data-nome]').setAttribute('aria-pressed', 'false'); renderer.domElement.style.cursor = ''; desenha(); return;
  }
  if (modoPontos) { // marca um ponto de informação exactamente na superfície onde se clicou
    const titulo = prompt('Título do ponto (ex.: Posto de comando):'); if (!titulo) return;
    const texto = prompt('Texto curto (opcional):') || '';
    const nrm = hit.face.normal.clone().transformDirection(hit.object.matrixWorld);
    const pos = hit.point.clone().addScaledVector(nrm, 0.05);
    pontos.push({ titulo, texto, pos: pos.toArray().map((v) => +v.toFixed(3)) });
    const bola = new THREE.Mesh(new THREE.SphereGeometry(0.004 * caixaR, 16, 12), new THREE.MeshBasicMaterial({ color: 0xb08d57 })); bola.position.copy(pos); cena.add(bola);
    desenha(); return;
  }
  const p = pecas.find((x) => x.malha === hit.object); if (!p) return;
  filtro = { texto: '', so: '' }; $('[data-procura]').value = ''; desenha();
  pecas.forEach((x) => realca(x, false)); realca(p, true);
  document.querySelectorAll('li.realce').forEach((l) => l.classList.remove('realce'));
  p.li?.classList.add('realce'); p.li?.scrollIntoView({ block: 'center', behavior: 'smooth' }); p.li?.querySelector('select').focus();
});

$('[data-procura]').oninput = (e) => { filtro.texto = e.target.value.toLowerCase(); desenha(); };
document.querySelectorAll('[data-so]').forEach((b) => (b.onclick = () => { filtro.so = filtro.so === b.dataset.so ? '' : b.dataset.so; document.querySelectorAll('[data-so]').forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.so === filtro.so))); desenha(); }));
$('[data-pontos]').onclick = (e) => { modoPontos = !modoPontos; e.currentTarget.setAttribute('aria-pressed', String(modoPontos)); renderer.domElement.style.cursor = modoPontos ? 'crosshair' : ''; };
$('[data-nome]').onclick = (e) => { modoNome = !modoNome; e.currentTarget.setAttribute('aria-pressed', String(modoNome)); renderer.domElement.style.cursor = modoNome ? 'crosshair' : ''; };
$('[data-aceita]').onclick = () => { pecas.forEach((p) => { if (!p.zona && p.sugestao) p.zona = p.sugestao; }); desenha(); };

// a ficha: zonas com os nomes exactos das peças; um grupo de cor por zona pintável, com a cor original como opção
const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function ficha() {
  const zonas = {}, grupos = [];
  for (const p of pecas) if (p.zona) (zonas[p.zona] ||= { nomes: [], cor: corDe(p.malha) }).nomes.push(p.nome);
  const fz = {};
  for (const [id, z] of Object.entries(zonas)) {
    fz[id] = { procura: '^(' + [...new Set(z.nomes)].map(escRe).join('|') + ')\\|', acabamento: ZONAS[id]?.acabamento || 'solido' };
    if (!['vidro', 'metal', 'luzes', 'logotipo'].includes(id)) grupos.push({ id, nome: ZONAS[id]?.nome || id, tipo: ZONAS[id]?.acabamento === 'madeira' ? 'material' : 'cor', zona: id,
      opcoes: [{ id: 'original', nome: 'Original', hex: z.cor, padrao: true }] });
  }
  if (sitioNome) grupos.push({ id: 'nome', nome: 'Nome do barco', tipo: 'texto', max: 20, decal: { ...sitioNome, cor: '#1b2433', fonte: 'Georgia, serif' } });
  const escondidas = pecas.filter((p) => p.oculta).map((p) => escRe(p.nome));
  if (escondidas.length) grupos.push({ id: 'oculto', nome: 'Peças escondidas', tipo: 'variante', interno: true, opcoes: [{ id: 'nao', nome: 'Não mostrar', padrao: true, esconde: ['^(' + escondidas.join('|') + ')\\|'] }] });
  const passos = [{ id: 'exterior', nome: 'Exterior', grupos: grupos.filter((g) => !g.interno && g.tipo !== 'texto').map((g) => g.id) }];
  if (sitioNome) passos.push({ id: 'nome', nome: 'Nome', grupos: ['nome'] });
  return { id: nomeModelo, marca: '', nome: nomeModelo, modelo: `../modelos/${nomeModelo}.glb`, zonas: fz, pontos, passos, grupos };
}
$('[data-copia]').onclick = async () => { await navigator.clipboard.writeText(JSON.stringify(ficha(), null, 2)); $('[data-copia]').textContent = 'Copiada'; setTimeout(() => ($('[data-copia]').textContent = 'Copiar ficha'), 1500); };
$('[data-descarrega]').onclick = () => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(ficha(), null, 2)], { type: 'application/json' })); a.download = `${nomeModelo}.json`; a.click(); };

// arrastar um ficheiro, ou ?modelo=
palco.addEventListener('dragover', (e) => e.preventDefault());
palco.addEventListener('drop', (e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) carrega(URL.createObjectURL(f), f.name); });
const q = new URLSearchParams(location.search).get('modelo'); if (q) await carrega(q);
window.mapeador = { get pecas() { return pecas; }, ficha, carrega };
