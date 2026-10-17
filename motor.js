// O visor 3D do configurador: lê a ficha, pinta zonas, troca peças, voa a câmara, anima, muda de ambiente.
// Desenha só quando alguma coisa muda (ou quando há animação ou mar à vista). O barco chega normalizado:
// comprimento em X (proa em +X), cima em Y, quilha em y=0, metros reais (scripts/normaliza.py).
import * as THREE from './vendor/three.module.js';
import { GLTFLoader } from './vendor/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from './vendor/addons/libs/meshopt_decoder.module.js';
import { RoomEnvironment } from './vendor/addons/environments/RoomEnvironment.js';
import { Sky } from './vendor/addons/objects/Sky.js';
import { Water } from './vendor/addons/objects/Water.js';
import { DecalGeometry } from './vendor/addons/geometries/DecalGeometry.js';
import CameraControls from './vendor/camera-controls.module.js';

CameraControls.install({ THREE });

// acabamentos: o que cada palavra da ficha quer dizer em material físico
const ACABAMENTO = {
  gelcoat: { roughness: 0.3, metalness: 0, clearcoat: 0.6, clearcoatRoughness: 0.08 },
  solido: { roughness: 0.32, metalness: 0, clearcoat: 0.35, clearcoatRoughness: 0.12 },
  metalizado: { roughness: 0.38, metalness: 0.3, clearcoat: 1, clearcoatRoughness: 0.04 }, // metal a mais reflecte o estúdio e apaga a cor (azul noite saía prata)
  perolado: { roughness: 0.28, metalness: 0.2, clearcoat: 1, clearcoatRoughness: 0.04, iridescence: 0.35, iridescenceIOR: 1.4 },
  mate: { roughness: 0.68, metalness: 0.05, clearcoat: 0, clearcoatRoughness: 0 },
  tecido: { roughness: 0.92, metalness: 0, clearcoat: 0, sheen: 1, sheenRoughness: 0.6 },
  pele: { roughness: 0.55, metalness: 0, clearcoat: 0.15, clearcoatRoughness: 0.4 },
  madeira: { roughness: 0.62, metalness: 0, clearcoat: 0 },
  inox: { roughness: 0.16, metalness: 1, clearcoat: 0 },
  vidro: { roughness: 0.05, metalness: 0, clearcoat: 1, transparent: true, opacity: 0.55 },
  borracha: { roughness: 0.85, metalness: 0, clearcoat: 0 },
};

// teca desenhada em canvas: tábuas, veio e calafeto da cor escolhida (sem imagens para descarregar)
function texturaTeca(tom = '#9a6a3c', calafeto = '#151515', larguraTabua = 64) {
  const W = 1024, H = 1024, c = document.createElement('canvas'); c.width = W; c.height = H;
  const x = c.getContext('2d'), base = new THREE.Color(tom);
  let semente = 7; const rnd = () => ((semente = (semente * 16807) % 2147483647) / 2147483647);
  for (let y = 0; y < H; y += larguraTabua) {
    const v = 0.86 + rnd() * 0.24, cor = base.clone().multiplyScalar(v);
    x.fillStyle = `#${cor.getHexString()}`; x.fillRect(0, y, W, larguraTabua);
    for (let k = 0; k < 26; k++) { // veio
      x.strokeStyle = `rgba(${rnd() < 0.5 ? '40,22,10' : '255,230,190'},${0.05 + rnd() * 0.07})`; x.lineWidth = 1 + rnd() * 2;
      x.beginPath(); const yy = y + rnd() * larguraTabua; x.moveTo(0, yy);
      for (let xx = 0; xx <= W; xx += 64) x.lineTo(xx, yy + Math.sin(xx / (80 + rnd() * 90) + k) * 2.5);
      x.stroke();
    }
    x.fillStyle = calafeto; x.fillRect(0, y, W, Math.max(3, larguraTabua * 0.08)); // junta
    const corte = (rnd() * W) | 0; x.fillRect(corte, y, 3, larguraTabua); // topo de tábua
  }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}

function tinge(m) {
  m.userData.tinge = true;
  m.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
      #ifdef USE_MAP
        float lum = dot(sampledDiffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));
        diffuseColor.rgb = diffuse * clamp(lum * 1.35, 0.0, 1.15);
      #endif`);
  };
  m.customProgramCacheKey = () => 'tinge';
}

// relevos (mapas de normais) desenhados em canvas: dão textura aos estofos sem descarregar imagens
const RELEVOS = {};
function relevo(tipo) {
  if (RELEVOS[tipo]) return RELEVOS[tipo];
  const N = 256, alt = new Float32Array(N * N);
  let s = 11; const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    let h = 0;
    if (tipo === 'tecido') { const fx = Math.sin(x / N * Math.PI * 64), fy = Math.sin(y / N * Math.PI * 64); h = (((x >> 2) + (y >> 2)) % 2 ? fx : fy) * 0.5 + rnd() * 0.25; }
    else if (tipo === 'pele') { h = rnd() * 0.35; }
    else if (tipo === 'vinil') { h = Math.sin(x / N * Math.PI * 128) * Math.sin(y / N * Math.PI * 128) * 0.3 + rnd() * 0.1; }
    else if (tipo === 'eva') { h = ((x % 32 < 2) || (y % 32 < 2)) ? -1 : rnd() * 0.15; }
    alt[y * N + x] = h;
  }
  if (tipo === 'pele') for (let k = 0; k < 3; k++) { const b = alt.slice(); for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) { let m = 0; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) m += b[((y + dy + N) % N) * N + ((x + dx + N) % N)]; alt[y * N + x] = m / 9; } }
  const c = document.createElement('canvas'); c.width = c.height = N; const cx = c.getContext('2d'), img = cx.createImageData(N, N);
  const forca = { tecido: 2.2, pele: 6, vinil: 2.5, eva: 3 }[tipo] || 2;
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const dx = (alt[y * N + (x + 1) % N] - alt[y * N + (x - 1 + N) % N]) * forca, dy = (alt[((y + 1) % N) * N + x] - alt[((y - 1 + N) % N) * N + x]) * forca;
    const l = Math.hypot(dx, dy, 1), i = (y * N + x) * 4;
    img.data[i] = (-dx / l * 0.5 + 0.5) * 255; img.data[i + 1] = (-dy / l * 0.5 + 0.5) * 255; img.data[i + 2] = (1 / l * 0.5 + 0.5) * 255; img.data[i + 3] = 255;
  }
  cx.putImageData(img, 0, 0);
  const tx = new THREE.CanvasTexture(c); tx.wrapS = tx.wrapT = THREE.RepeatWrapping; tx.colorSpace = THREE.NoColorSpace;
  tx.repeat.setScalar({ tecido: 5, pele: 3, vinil: 6, eva: 2 }[tipo] || 4);
  return (RELEVOS[tipo] = tx);
}
const RUGOSIDADE = { tecido: 0.92, pele: 0.5, vinil: 0.38, eva: 0.85 };

const sombraTex = (() => {
  let t = null;
  return () => {
    if (t) return t;
    const c = document.createElement('canvas'); c.width = c.height = 256; const x = c.getContext('2d');
    const g = x.createRadialGradient(128, 128, 0, 128, 128, 128);
    g.addColorStop(0, 'rgba(0,0,0,.62)'); g.addColorStop(0.5, 'rgba(0,0,0,.3)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    x.fillStyle = g; x.fillRect(0, 0, 256, 256); return (t = new THREE.CanvasTexture(c));
  };
})();

export async function criaVisor(el, ficha, { base = '', reduz = matchMedia('(prefers-reduced-motion: reduce)').matches, aoProgresso, aoPronto } = {}) {
  const url = (p) => new URL(p, base || location.href).href;
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance', preserveDrawingBuffer: false });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.AgXToneMapping; renderer.toneMappingExposure = 1.0;
  const dprAlto = Math.min(devicePixelRatio || 1, 2), dprBaixo = Math.min(devicePixelRatio || 1, 1.25);
  renderer.setPixelRatio(dprAlto);
  const tela = renderer.domElement; tela.className = 'cf-tela';
  tela.setAttribute('role', 'img'); tela.setAttribute('aria-label', `Vista 3D do ${ficha.nome}. Arraste para rodar.`);
  el.prepend(tela);

  let sujo = true, parado = 0, visivelNoEcra = true;
  const cena = new THREE.Scene();
  const pm = new THREE.PMREMGenerator(renderer);
  let envEstudio = pm.fromScene(new RoomEnvironment(), 0.04).texture;
  if (ficha.hdri !== false) {
    try {
      const { HDRLoader } = await import('./vendor/addons/loaders/HDRLoader.js');
      const hdr = await new HDRLoader().loadAsync(ficha.hdri ? url(ficha.hdri) : new URL('./estudio.hdr', import.meta.url).href);
      hdr.mapping = THREE.EquirectangularReflectionMapping; envEstudio = pm.fromEquirectangular(hdr).texture; hdr.dispose();
    } catch (e) { console.warn('HDRI de estúdio não carregou; fica a sala', e); }
  }
  cena.environment = envEstudio;
  cena.environmentRotation = new THREE.Euler(0, THREE.MathUtils.degToRad(ficha.rodarLuz ?? 160), 0);
  const cam = new THREE.PerspectiveCamera(32, 1, 0.1, 5000);
  const ctl = new CameraControls(cam, tela);
  Object.assign(ctl, { smoothTime: 0.32, draggingSmoothTime: 0.12, azimuthRotateSpeed: 0.6, polarRotateSpeed: 0.6, dollySpeed: 0.5, truckSpeed: 0 });
  ctl.minPolarAngle = 0.12 * Math.PI; ctl.maxPolarAngle = 0.495 * Math.PI;
  ctl.mouseButtons.right = CameraControls.ACTION.NONE; ctl.touches.two = CameraControls.ACTION.TOUCH_DOLLY;
  // a roda do rato desce a página; só com Ctrl/pinça aproxima (o 3D nunca prende o scroll)
  ctl.mouseButtons.wheel = CameraControls.ACTION.NONE;
  tela.addEventListener('wheel', (e) => { if (e.ctrlKey || e.metaKey) { e.preventDefault(); ctl.dolly(-e.deltaY * 0.01 * raio * 0.08, true); } }, { passive: false });
  tela.style.touchAction = 'pan-y';

  // luz: o ambiente faz quase tudo; uma luz de recorte desenha a silhueta
  const sol = new THREE.DirectionalLight(0xfff3e4, 1.4); cena.add(sol);
  const ceu = new THREE.HemisphereLight(0xdbe8f4, 0x1a2430, 0.35); cena.add(ceu);

  /* ---------- o modelo ---------- */
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const gltf = await loader.loadAsync(url(ficha.modelo), (ev) => aoProgresso?.(ev.total ? ev.loaded / ev.total : 0));
  const barco = gltf.scene; cena.add(barco);
  const caixa = new THREE.Box3().setFromObject(barco), tam = caixa.getSize(new THREE.Vector3()), centro = caixa.getCenter(new THREE.Vector3());
  const raio = tam.length() / 2;
  sol.position.set(-tam.x * 0.6, tam.x * 0.9, tam.x * 0.5);

  const sombra = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: sombraTex(), transparent: true, depthWrite: false }));
  sombra.rotation.x = -Math.PI / 2; sombra.position.set(centro.x, 0.002, centro.z); sombra.scale.set(tam.x * 1.25, tam.z * 1.9, 1); cena.add(sombra);

  // malhas e zonas: cada zona fica com materiais próprios (clonados), para pintar sem tocar no resto
  const malhas = []; barco.traverse((o) => { if (o.isMesh) { malhas.push(o); o.userData.nome = `${o.name}|${[].concat(o.material).map((m) => m.name).join(',')}`.replace(/_+/g, ' '); } }); // o GLTFLoader troca espaços por _
  const zonas = {}; const zonaDe = new Map();
  for (const [zid, z] of Object.entries(ficha.zonas || {})) {
    zonas[zid] = { mats: [], malhas: [], def: z };
    if (!z.procura) continue; // zona pela forma: trata-se mais abaixo
    const re = new RegExp(z.procura, 'i'); const fora = z.excepto ? new RegExp(z.excepto, 'i') : null;
    for (const m of malhas) {
      if (zonaDe.has(m) || !re.test(m.userData.nome) || (fora && fora.test(m.userData.nome))) continue;
      zonaDe.set(m, zid); zonas[zid].malhas.push(m);
    }
  }
  // zonas pela FORMA (modelos de uma peça só: fotografias, IA, CAD sem nomes). Cada triângulo vai para a primeira zona
  // cuja regra cumpre: altura (fracção da altura do barco, pode subir da popa para a proa), direcção da face, posição.
  const formas = Object.entries(ficha.zonas || {}).filter(([, z]) => z.forma);
  if (formas.length) {
    const vA = new THREE.Vector3(), vB = new THREE.Vector3(), vC = new THREE.Vector3(), nF = new THREE.Vector3(), e1 = new THREE.Vector3(), e2 = new THREE.Vector3();
    const reEm = (z) => z.forma.em ? new RegExp(z.forma.em, 'i') : null;
    const cumpre = (f, k, h, n) => {
      const ate = Array.isArray(f.ate) ? f.ate[0] + (f.ate[1] - f.ate[0]) * k : f.ate;
      const desde = Array.isArray(f.desde) ? f.desde[0] + (f.desde[1] - f.desde[0]) * k : f.desde;
      if (ate != null && h > ate) return false;
      if (desde != null && h < desde) return false;
      if (f.k && (k < f.k[0] || k > f.k[1])) return false;
      if (f.normal === 'cima' && n.y < 0.65) return false;
      if (f.normal === 'lado' && Math.abs(n.z) < 0.25 && Math.abs(n.x) < 0.6) return false;
      if (f.normal === 'baixo' && n.y > -0.2) return false;
      return true;
    };
    for (const m of malhas) {
      if (zonaDe.has(m)) continue;
      const cand = formas.filter(([, z]) => !reEm(z) || reEm(z).test(m.userData.nome));
      if (!cand.length) continue;
      const g = m.geometry, pos = g.attributes.position, idx = g.index ? g.index.array : null, nTri = (idx ? idx.length : pos.count) / 3;
      m.updateMatrixWorld(true); const mw = m.matrixWorld;
      const zonaTri = new Uint8Array(nTri); // 0 = resto, i+1 = cand[i]
      for (let f = 0; f < nTri; f++) {
        const a = idx ? idx[f * 3] : f * 3, b = idx ? idx[f * 3 + 1] : f * 3 + 1, c = idx ? idx[f * 3 + 2] : f * 3 + 2;
        vA.fromBufferAttribute(pos, a).applyMatrix4(mw); vB.fromBufferAttribute(pos, b).applyMatrix4(mw); vC.fromBufferAttribute(pos, c).applyMatrix4(mw);
        nF.crossVectors(e1.subVectors(vB, vA), e2.subVectors(vC, vA)).normalize();
        const cx = (vA.x + vB.x + vC.x) / 3, cy = (vA.y + vB.y + vC.y) / 3;
        const k = (cx - caixa.min.x) / tam.x, h = (cy - caixa.min.y) / tam.y;
        for (let i = 0; i < cand.length; i++) if (cumpre(cand[i][1].forma, k, h, nF)) { zonaTri[f] = i + 1; break; }
      }
      // reordena os triângulos por zona e cria um grupo (e um material) por zona
      const novos = []; const grupos = [];
      for (let z = 0; z <= cand.length; z++) {
        const ini = novos.length;
        for (let f = 0; f < nTri; f++) if (zonaTri[f] === z) novos.push(idx ? idx[f * 3] : f * 3, idx ? idx[f * 3 + 1] : f * 3 + 1, idx ? idx[f * 3 + 2] : f * 3 + 2);
        if (novos.length > ini) grupos.push([ini, novos.length - ini, z]);
      }
      g.setIndex(novos); g.clearGroups();
      const orig = [].concat(m.material)[0]; const mats = [orig];
      for (const [ini, n, z] of grupos) {
        let mi = 0;
        if (z) {
          const [zid] = cand[z - 1];
          zonas[zid].malhas.includes(m) || zonas[zid].malhas.push(m);
          if (!zonas[zid].formaMat) { zonas[zid].formaMat = orig.clone(); }
          mi = mats.push(zonas[zid].formaMat) - 1;
          zonas[zid].formaMats = zonas[zid].formaMats || new Set(); zonas[zid].formaMats.add(m);
        }
        g.addGroup(ini, n, mi);
      }
      m.material = mats; zonaDe.set(m, 'forma');
    }
  }
  const matsZona = new Map(); // zona -> material físico partilhado pelas malhas dela
  for (const [zid, z] of Object.entries(zonas)) {
    if (!z.malhas.length) continue;
    if (z.formaMat) { // a zona veio da forma: troca o material dentro dos grupos pelo físico
      const o = z.formaMat;
      const fis = new THREE.MeshPhysicalMaterial({ color: o.color?.clone() || new THREE.Color(1, 1, 1), map: o.map || null, normalMap: o.normalMap || null, roughness: o.roughness ?? 0.5, metalness: o.metalness ?? 0, side: o.side });
      fis.name = `zona:${zid}`; Object.assign(fis, ACABAMENTO[z.def.acabamento] || {});
      if (z.def.tingir && fis.map) tinge(fis);
      for (const m of z.malhas) m.material = m.material.map((x) => (x === o ? fis : x));
      matsZona.set(zid, fis); z.mats.push(fis); continue;
    }
    const orig = [].concat(z.malhas[0].material)[0];
    const fis = new THREE.MeshPhysicalMaterial({ color: orig.color?.clone() || new THREE.Color(1, 1, 1), map: orig.map || null, normalMap: orig.normalMap || null, roughness: orig.roughness ?? 0.5, metalness: orig.metalness ?? 0, side: orig.side });
    fis.name = `zona:${zid}`;
    Object.assign(fis, ACABAMENTO[z.def.acabamento] || {});
    for (const m of z.malhas) m.material = fis;
    matsZona.set(zid, fis); z.mats.push(fis);
  }
  // acabamentos por nome para as peças que não são zonas (inox, vidro, borracha) — o modelo vem com cores baças
  for (const m of malhas) {
    if (zonaDe.has(m)) continue;
    const n = m.userData.nome.toLowerCase();
    for (const [chave, re] of [['inox', /inox|stainless|chrome|cromad|steel|metal_alum|aluminium|aluminum/], ['vidro', /glass|vidro|cristal|crystal|acrylic|metraquilato|window/], ['borracha', /rubber|borracha|goma/]]) {
      if (re.test(n)) { m.material = m.material.clone(); Object.assign(m.material, ACABAMENTO[chave]); if (chave === 'inox' && m.material.color) m.material.color.setRGB(0.85, 0.86, 0.87); break; }
    }
  }

  // peças trocáveis (variantes): material próprio e já transparente desde o início, para o shader compilar ao abrir
  const visivel0 = (re) => { const r = new RegExp(re, 'i'); return malhas.filter((m) => r.test(m.userData.nome)); };
  const trocaveis = [...ficha.grupos.flatMap((g) => (g.opcoes || []).flatMap((o) => [].concat(o.mostra || [], o.esconde || []))), ...[].concat(ficha.corte?.esconde || [])];
  for (const re of trocaveis) for (const m of visivel0(re)) {
    if (m.userData.matProprio) continue;
    m.material = [].concat(m.material).map((x) => {
      const c = x.clone(); c.userData.opacidade = x.opacity; c.transparent = true;
      const zid = x.name?.startsWith('zona:') ? x.name.slice(5) : null; if (zid && zonas[zid]) zonas[zid].mats.push(c); // continua a pintar-se com a zona
      return c; });
    if (m.material.length === 1) m.material = m.material[0];
    m.userData.matProprio = true;
  }

  // sombras de contacto cozidas no Blender (atributo de cor nos vértices): multiplicam a cor, qualquer que ela seja
  const comAO = malhas.length && malhas.every((m) => m.geometry.attributes.color);
  if (comAO) for (const m of malhas) for (const x of [].concat(m.material)) { x.vertexColors = true; x.needsUpdate = true; }
  // sombras do sol em tempo real (o T-top desenha sombra no cockpit); só se desenham quando algo muda
  if (ficha.sombras !== false) {
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    sol.castShadow = true; const tam2 = Math.min(devicePixelRatio > 1.5 ? 2048 : 1024, 2048);
    sol.shadow.mapSize.set(tam2, tam2); sol.shadow.bias = -0.0012; sol.shadow.normalBias = 0.06; // sem riscas nas superfícies planas sol.shadow.radius = 4;
    const r = raio * 1.1, sc = sol.shadow.camera; sc.left = -r; sc.right = r; sc.top = r; sc.bottom = -r; sc.near = 0.1; sc.far = raio * 6;
    sol.target.position.copy(centro); cena.add(sol.target);
    for (const m of malhas) { m.castShadow = true; m.receiveShadow = true; }
  }

  /* ---------- câmaras ---------- */
  const L = tam.x, alvo0 = new THREE.Vector3(centro.x, tam.y * 0.32, centro.z);
  // vistas automáticas: só a direcção; a distância mede-se no momento, para o barco caber em qualquer ecrã
  const camerasAuto = {
    'Três quartos': { dir: [0.95, 0.36, 0.95] },
    'Perfil': { dir: [0, 0.16, 1] },
    'Popa': { dir: [-1, 0.34, 0.55] },
    'Proa': { dir: [1, 0.22, -0.32] },
    'De cima': { dir: [0.001, 1, 0.001], alvo: [centro.x, 0, centro.z] },
  };
  const cameras = { ...camerasAuto, ...(ficha.cameras || {}) };
  const cantos = []; for (let k = 0; k < 8; k++) cantos.push(new THREE.Vector3(k & 1 ? caixa.max.x : caixa.min.x, k & 2 ? caixa.max.y : caixa.min.y, k & 4 ? caixa.max.z : caixa.min.z));
  function distanciaQueCabe(alvo, dir) {
    // aproxima até a caixa projectada encher ~86% do palco (no telemóvel, 94%)
    const enche = el.clientWidth < 600 ? 0.94 : 0.86, q = new THREE.Vector3(), c = cam.clone();
    let d = raio * 2.5;
    for (let it = 0; it < 5; it++) {
      c.position.copy(alvo).addScaledVector(dir, d); c.lookAt(alvo); c.updateMatrixWorld(); c.updateProjectionMatrix();
      let m = 0; for (const p of cantos) { q.copy(p).project(c); m = Math.max(m, Math.abs(q.x), Math.abs(q.y)); }
      d *= m / enche;
    }
    return d;
  }
  const voa = (nome, suave = !reduz) => {
    const c = cameras[nome]; if (!c) return;
    if (c.dir) {
      const alvo = new THREE.Vector3(...(c.alvo || alvo0.toArray())), dir = new THREE.Vector3(...c.dir).normalize();
      const p = alvo.clone().addScaledVector(dir, distanciaQueCabe(alvo, dir));
      ctl.setLookAt(p.x, p.y, p.z, alvo.x, alvo.y, alvo.z, suave);
    } else ctl.setLookAt(...c.pos, ...c.alvo, suave);
    vistaActual = nome; acorda();
  };
  let vistaActual = ficha.cameraInicial || 'Três quartos';
  function ajusta() {
    const w = el.clientWidth, h = el.clientHeight; if (!w || !h) return;
    renderer.setSize(w, h, false); cam.aspect = w / h; cam.updateProjectionMatrix();
    ctl.minDistance = raio * 0.35; ctl.maxDistance = raio * 4.5; if (typeof voa === 'function' && !el.classList.contains('tocado') && cameras) voa(vistaActual, false); acorda();
  }
  new ResizeObserver(ajusta).observe(el); ajusta();
  voa(vistaActual, false);

  /* ---------- ambientes: estúdio, mar, pôr do sol, noite ---------- */
  let mar = null, ceuObj = null, ambiente = 'estudio';
  const chao = new THREE.Mesh(new THREE.CircleGeometry(L * 6, 64), new THREE.MeshStandardMaterial({ color: 0x0c0d10, roughness: 0.35, metalness: 0 }));
  chao.rotation.x = -Math.PI / 2; chao.position.y = -0.001; chao.visible = false; cena.add(chao);
  function poeAmbiente(nome) {
    ambiente = nome;
    const temMar = nome === 'mar' || nome === 'por-do-sol' || nome === 'noite';
    if (temMar && !mar) {
      const n = new THREE.TextureLoader().load(ficha.texturaAgua ? url(ficha.texturaAgua) : new URL('./agua-normais.jpg', import.meta.url).href, (t) => { t.wrapS = t.wrapT = THREE.RepeatWrapping; acorda(); });
      mar = new Water(new THREE.PlaneGeometry(L * 30, L * 30), { textureWidth: 1024, textureHeight: 1024, waterNormals: n, sunDirection: new THREE.Vector3(), sunColor: 0xfff4e0, waterColor: 0x06304a, distortionScale: 2.4, alpha: 1, fog: false });
      mar.material.uniforms.size.value = 32 / L; // ondulação à escala do barco (o shader mede em unidades do plano)
      mar.rotation.x = -Math.PI / 2; mar.position.y = (ficha.linhaDeAgua ?? 0.12) * tam.y; cena.add(mar);
      ceuObj = new Sky(); ceuObj.scale.setScalar(L * 60); cena.add(ceuObj);
    }
    if (mar) { mar.visible = temMar; ceuObj.visible = temMar; }
    sombra.visible = !temMar;
    chao.visible = nome === 'estudio-escuro';
    const elev = { mar: 14, 'por-do-sol': 2.2, noite: -3.5 }[nome] ?? 40;
    if (temMar) {
      const u = ceuObj.material.uniforms; u.turbidity.value = nome === 'por-do-sol' ? 8 : nome === 'noite' ? 2 : 4; u.rayleigh.value = nome === 'por-do-sol' ? 3 : nome === 'noite' ? 4 : 1.6;
      u.mieCoefficient.value = 0.005; u.mieDirectionalG.value = 0.8;
      const s = new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(90 - elev), THREE.MathUtils.degToRad(200));
      u.sunPosition.value.copy(s); mar.material.uniforms.sunDirection.value.copy(s).normalize();
      // o céu passa a ser a luz do barco
      if (nome === 'noite') { cena.environment = envEstudio; cena.environmentIntensity = 0.16; ceu.color.set(0x5a7bb0); ceu.intensity = 0.5; }
      else { cena.environment = envFromSky(); cena.environmentIntensity = 1; ceu.color.set(0xdbe8f4); ceu.intensity = 0.35; }
      cena.background = null;
      sol.position.copy(s).multiplyScalar(L * 2); sol.intensity = nome === 'noite' ? 0.35 : nome === 'por-do-sol' ? 1.8 : 1.5;
      sol.color.set(nome === 'por-do-sol' ? 0xffb37a : nome === 'noite' ? 0x9db8ff : 0xfff3e4);
      renderer.toneMappingExposure = nome === 'noite' ? 0.75 : nome === 'por-do-sol' ? 1.05 : 0.95;
      mar.material.uniforms.waterColor.value.set(nome === 'noite' ? 0x020a12 : nome === 'por-do-sol' ? 0x0a2a3e : 0x06304a);
    } else {
      cena.environment = envEstudio; cena.environmentIntensity = 1; ceu.color.set(0xdbe8f4); ceu.intensity = 0.35; sol.intensity = 1.4; sol.color.set(0xfff3e4); renderer.toneMappingExposure = 1.0;
      sol.position.set(-tam.x * 0.6, tam.x * 0.9, tam.x * 0.5);
    }
    luzes(nome === 'noite' || nome === 'por-do-sol');
    el.dataset.ambiente = nome; acorda();
  }
  let envCeu = null;
  function envFromSky() {
    const c = new THREE.Scene(); const s = new Sky(); s.scale.setScalar(1000); c.add(s);
    for (const k of Object.keys(ceuObj.material.uniforms)) s.material.uniforms[k].value = ceuObj.material.uniforms[k].value;
    envCeu?.dispose(); envCeu = pm.fromScene(c, 0).texture; return envCeu;
  }
  // luzes de navegação e LED subaquáticos acendem ao fim do dia (zona "luzes" na ficha)
  function luzes(on) {
    for (const zid of Object.keys(zonas)) {
      const z = zonas[zid].def; if (!z.luz) continue;
      const m = matsZona.get(zid); if (!m) continue;
      m.emissive = new THREE.Color(z.luz); m.emissiveIntensity = on || z.acesa ? (z.intensidade || 2.5) : 0;
    }
  }

  /* ---------- aplicar a configuração ---------- */
  const anim = []; const DUR = 650, ease = (k) => 1 - Math.pow(1 - k, 4);
  const fades = new Set(); let primeiraVez = true;
  const tecas = new Map();
  const aplicadas = new Map(); // zona -> opção já aplicada (não se repinta o que não mudou)
  function pintaZona(zid, op, chave = zid) {
    if (!matsZona.get(zid)) return;
    const ident = op._chave ? `${op.id}:${op._chave}` : op;
    if (aplicadas.get(chave) === ident) return; aplicadas.set(chave, ident); // por grupo: o tecido e a cor da mesma zona não se anulam
    if (op.relevo) zonas[zid].rel = op.relevo;
    const rel = zonas[zid].rel || zonas[zid].def.relevo;
    if (rel) for (const m of zonas[zid].mats) { m.normalMap = relevo(rel); m.normalScale = new THREE.Vector2(0.6, 0.6); m.roughness = RUGOSIDADE[rel] ?? m.roughness; if (rel !== 'tecido') m.sheen = 0; m.needsUpdate = true; }
    if (!op.hex && !op.teca && !op.textura) { acorda(); return; } // escolha de tecido: a cor vem de outro grupo
    const alvo = new THREE.Color(op.hex || '#ffffff');
    if (zonas[zid].def.luz) for (const m of zonas[zid].mats) { m.emissive = new THREE.Color(op.hex); zonas[zid].def.luz = op.hex; }
    zonas[zid].alvo = alvo.clone(); // a cor final (a animação ainda vai a meio quando o nome se escreve)
    const fin = ACABAMENTO[op.acabamento || zonas[zid].def.acabamento] || {};
    for (const m of zonas[zid].mats) {
      for (const [k, v] of Object.entries(fin)) if (typeof v === 'number' && k in m && k !== 'opacity') m[k] = v;
      if (rel) { m.roughness = RUGOSIDADE[rel] ?? m.roughness; m.sheen = rel === 'tecido' ? 1 : 0; } // o tecido escolhido manda no toque
      if (op.teca) { // material de teca desenhado: tom + calafeto
        const chave = `${op.teca.tom || op.hex}|${op.teca.calafeto || '#151515'}`;
        if (!tecas.has(chave)) tecas.set(chave, texturaTeca(op.teca.tom || op.hex, op.teca.calafeto || '#151515'));
        m.map = tecas.get(chave);
        m.map.repeat.set(op.teca.repeticao || L / 1.2, op.teca.repeticao || L / 1.2); m.color.set(0xffffff); m.needsUpdate = true; continue;
      }
      if (op.textura) {
        new THREE.TextureLoader().load(url(op.textura), (tx) => { tx.colorSpace = THREE.SRGBColorSpace; tx.wrapS = tx.wrapT = THREE.RepeatWrapping; tx.repeat.setScalar(op.repeticao || 4); m.map = tx; m.needsUpdate = true; acorda(); });
        m.color.set(op.tom || 0xffffff); continue;
      }
      if (m.map && !zonas[zid].def.manterTextura && !zonas[zid].def.tingir) { m.map = null; m.needsUpdate = true; }
      if (reduz) { m.color.copy(alvo); continue; }
      const i = anim.findIndex((a) => a.m === m); if (i >= 0) anim.splice(i, 1);
      anim.push({ m, de: m.color.clone(), para: alvo, t0: performance.now() });
    }
    acorda();
  }
  const visivel = (re) => { const r = new RegExp(re, 'i'); return malhas.filter((m) => r.test(m.userData.nome)); };
  let decal = null;
  let nomeFeito = null;
  function escreveNome(txt, def) {
    const chaveNome = `${txt}|${zonas.casco?.alvo?.getHexString() || ''}`;
    if (chaveNome === nomeFeito) return; nomeFeito = chaveNome;
    if (decal) { barco.remove(decal); decal.geometry.dispose(); decal.material.map?.dispose(); decal = null; }
    if (!txt || !def) return;
    const c = document.createElement('canvas'); c.width = 1024; c.height = 256; const x = c.getContext('2d');
    x.font = `${def.peso || 600} 150px ${def.fonte || 'Georgia, serif'}`; x.textAlign = 'center'; x.textBaseline = 'middle';
    // tinta do nome: a da ficha, ou a que contrasta com o casco escolhido (escura em casco claro, clara em casco escuro)
    let tinta = def.cor;
    if (!tinta || tinta === 'auto') { const c = zonas.casco?.alvo || matsZona.get('casco')?.color || new THREE.Color(1, 1, 1); tinta = c.getHSL({}).l > 0.45 ? '#1b2433' : '#f2efe8'; }
    x.fillStyle = tinta; x.fillText(txt, 512, 132);
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
    const alvos = visivel(def.malhas || def.zona || '.').filter((m) => m.visible);
    // sem posição na ficha, encontra o sítio sozinho: dispara um raio contra o casco, vindo de trás (popa) ou do lado (costado)
    let p, n;
    if (def.pos) { p = new THREE.Vector3(...def.pos); n = new THREE.Vector3(...(def.normal || [-1, 0, 0])); }
    else {
      const lado = def.lado || 'popa', ag = (ficha.linhaDeAgua ?? 0.12) * tam.y;
      const d = lado === 'popa' ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 0, -1);
      const vis = malhas.filter((m) => m.visible), rc = new THREE.Raycaster();
      // varre de baixo para cima: guarda as alturas onde o raio bate numa parede virada para fora (popa ou costado)
      const bons = [];
      // onde acaba o casco à popa (plataformas, motores, escadas e pranchas ficam mais atrás e não contam)
      const cz = zonas.casco?.malhas.length ? zonas.casco.malhas : malhas;
      const popaCasco = cz.reduce((a, m) => Math.min(a, new THREE.Box3().setFromObject(m).min.x), Infinity);
      const proaCasco = cz.reduce((a, m) => Math.max(a, new THREE.Box3().setFromObject(m).max.x), -Infinity);
      // só no casco: do mar até à borda (o topo da zona casco), nunca na superestrutura
      let borda = tam.y * 0.6;
      const fc = zonas.casco?.def.forma;
      if (fc?.ate != null) borda = Math.min(borda, caixa.min.y + tam.y * (Array.isArray(fc.ate) ? fc.ate[0] : fc.ate)); // zona pela forma: até à borda dela
      else if (zonas.casco?.malhas.length) { const bb = new THREE.Box3(); zonas.casco.malhas.forEach((m) => bb.expandByObject(m)); borda = Math.min(borda, bb.max.y); }
      for (let y = ag + tam.y * 0.02; y < borda; y += tam.y * 0.015) {
        const o = lado === 'popa' ? new THREE.Vector3(caixa.min.x - L, y, centro.z) : new THREE.Vector3(popaCasco + (proaCasco - popaCasco) * (def.ao ?? 0.22), y, caixa.max.z + L);
        rc.set(o, d); const h = rc.intersectObjects(vis, false)[0];
        const nn = h && h.face.normal.clone().transformDirection(h.object.matrixWorld);
        // na popa só conta o painel (os primeiros 6% do comprimento): um sofá ou um encosto mais à frente não é a popa
        // na popa só conta o painel; no costado só conta o próprio casco (não plataformas, defensas ou motores)
        const noPainel = lado === 'popa' ? (h && h.point.x < popaCasco + L * 0.04) : (h && (!zonas.casco?.malhas.length || zonas.casco.malhas.includes(h.object)));
        bons.push(h && noPainel && (lado === 'popa' ? nn.x < -0.75 : nn.z > 0.75) ? h : null);
      }
      // a maior faixa contínua de parede é o painel de popa (ou o costado); o nome vai ao meio dela
      let melhor = [], corrente = [];
      for (const h of bons.concat([null])) { if (h) corrente.push(h); else { if (corrente.length > melhor.length) melhor = corrente; corrente = []; } }
      if (!melhor.length) return;
      const hit = melhor[Math.floor(melhor.length / 2)];
      if (!alvos.includes(hit.object)) alvos.unshift(hit.object);
      for (const h of melhor) if (!alvos.includes(h.object)) alvos.push(h.object);
      p = hit.point; n = new THREE.Vector3();
      def._altura = melhor.length * tam.y * 0.015;
      if (lado === 'popa') n.set(-1, 0, 0); else n.set(0, 0, 1);
    }
    const ori = new THREE.Euler().setFromQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), n));
    const largura = def.largura || Math.min(def.lado === 'costado' ? L * 0.16 : tam.z * 0.55, (def._altura || 99) * 3.2);
    const geos = alvos.map((m) => new DecalGeometry(m, p, ori, new THREE.Vector3(largura, largura / 4, largura * 0.6)));
    const mat = new THREE.MeshPhysicalMaterial({ map: tex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, roughness: 0.3, clearcoat: 0.6 });
    decal = new THREE.Group(); decal.name = 'nome-do-barco'; geos.forEach((g) => g.attributes.position.count && decal.add(new THREE.Mesh(g, mat))); barco.add(decal); acorda(); // dentro do barco: balança com ele e vai no GLB do filme
  }

  let ultimoEstado = null, corteAtivo = false;
  function aplica(estado, ficha) {
    ultimoEstado = estado;
    // 1) visibilidade: as peças que alguma variante mostra só aparecem com essa variante escolhida
    const controlo = new Set(), ver = new Set(), esconder = new Set();
    for (const g of ficha.grupos) for (const o of g.opcoes || []) for (const re of [].concat(o.mostra || [])) visivel(re).forEach((m) => controlo.add(m));
    for (const g of ficha.grupos) {
      const v = estado[g.id]; const ids = Array.isArray(v) ? v : v ? [v] : [];
      for (const o of g.opcoes || []) {
        if (!ids.includes(o.id)) continue;
        for (const re of [].concat(o.mostra || [])) visivel(re).forEach((m) => ver.add(m));
        for (const re of [].concat(o.esconde || [])) visivel(re).forEach((m) => esconder.add(m));
        let op = o;
        if (o.igualA) { const gg = ficha.grupos.find((x) => x.id === o.igualA); const sel = gg?.opcoes.find((x) => x.id === estado[gg.id]); if (sel) op = { ...o, hex: sel.hex, acabamento: o.acabamento || sel.acabamento, _chave: sel.id }; }
        if (o.zona || g.zona) for (const zid of [].concat(o.zona || g.zona)) if (['cor', 'material'].includes(g.tipo)) pintaZona(zid, op, `${zid}|${g.id}`);
        if (g.tipo === 'ambiente') poeAmbiente(o.id);
      }
    }
    // «ver por dentro» (como a Hanse): tira o tejadilho e o que tapa o interior
    if (corteAtivo && ficha.corte) for (const re of [].concat(ficha.corte.esconde)) visivel(re).forEach((m) => esconder.add(m));
    // peças que entram e saem: aparecem e desaparecem em 350 ms (cada uma com o seu material, para não apagar as vizinhas)
    for (const m of malhas) {
      const quer = !esconder.has(m) && (!controlo.has(m) || ver.has(m));
      if (quer === m.visible && !m.userData.fade) continue;
      if (reduz || primeiraVez) { m.visible = quer; continue; } // a primeira vez não anima
      m.userData.fade = { de: m.visible ? 1 : 0, para: quer ? 1 : 0, t0: performance.now() };
      m.visible = true; fades.add(m);
    }
    primeiraVez = false;
    for (const g of ficha.grupos) if (g.tipo === 'texto') escreveNome(estado[g.id], g.decal);
    acorda();
  }

  /* ---------- animações (radar, balanço) e pontos ---------- */
  const rodar = (ficha.animacoes || []).filter((a) => a.tipo === 'rodar').map((a) => ({ a, ms: visivel(a.malhas) }));
  for (const r of rodar) for (const m of r.ms) { m.geometry.computeBoundingBox(); const c = m.geometry.boundingBox.getCenter(new THREE.Vector3()); m.geometry.translate(-c.x, -c.y, -c.z); m.position.add(c); }
  const balanco = (ficha.animacoes || []).find((a) => a.tipo === 'balanco');
  let animar = !reduz && (rodar.length > 0 || !!balanco);

  const pontosEl = document.createElement('div'); pontosEl.className = 'cf-pontos'; el.appendChild(pontosEl);
  const pontos = (ficha.pontos || []).map((p, i) => {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'cf-ponto'; b.dataset.i = i;
    b.innerHTML = `<span class="cf-ponto-aro"></span><span class="cf-ponto-rotulo">${p.titulo}</span>`;
    b.setAttribute('aria-label', `${p.titulo}: mostrar detalhes`);
    pontosEl.appendChild(b); return { p, b, v: new THREE.Vector3(...p.pos) };
  });
  const ray = new THREE.Raycaster(), tmp = new THREE.Vector3();
  let ultimaOclusao = 0;
  function posicionaPontos(t) {
    const w = el.clientWidth, h = el.clientHeight, verOcl = t - ultimaOclusao > 250;
    if (verOcl) ultimaOclusao = t;
    for (const pt of pontos) {
      tmp.copy(pt.v).project(cam);
      const fora = tmp.z > 1 || Math.abs(tmp.x) > 1.05 || Math.abs(tmp.y) > 1.05;
      pt.b.style.transform = `translate(${((tmp.x + 1) / 2) * w}px, ${((1 - tmp.y) / 2) * h}px)`;
      if (verOcl && !fora) { // escondido atrás do barco?
        const d = cam.position.distanceTo(pt.v); ray.set(cam.position, tmp.copy(pt.v).sub(cam.position).normalize()); ray.far = d - raio * 0.02;
        pt.b.classList.toggle('tapado', ray.intersectObjects(malhas.filter((m) => m.visible), false).length > 0);
      }
      pt.b.classList.toggle('fora', fora);
    }
  }

  /* ---------- o laço: desenha só quando é preciso ---------- */
  const relogio = new THREE.Clock();
  function acorda() { sujo = true; parado = 0; }
  ctl.addEventListener('control', () => { acorda(); if (renderer.getPixelRatio() !== dprBaixo) renderer.setPixelRatio(dprBaixo), ajustaSo(); });
  ctl.addEventListener('controlstart', () => el.classList.add('tocado'));
  const ajustaSo = () => renderer.setSize(el.clientWidth, el.clientHeight, false);
  new IntersectionObserver(([e]) => { visivelNoEcra = e.isIntersecting; if (visivelNoEcra) acorda(); }).observe(el);
  function laco(t) {
    requestAnimationFrame(laco);
    if (!visivelNoEcra) return;
    const dt = Math.min(relogio.getDelta(), 0.05);
    const mexeu = ctl.update(dt);
    let corre = false;
    if (anim.length) {
      for (let i = anim.length - 1; i >= 0; i--) { const a = anim[i], k = Math.max(0, Math.min(1, (t - a.t0) / DUR)); a.m.color.copy(a.de).lerp(a.para, ease(k)); if (k >= 1) anim.splice(i, 1); }
      corre = true;
    }
    if (fades.size) {
      for (const m of fades) {
        const f = m.userData.fade, k = Math.max(0, Math.min(1, (t - f.t0) / 350)), v = f.de + (f.para - f.de) * ease(k);
        for (const x of [].concat(m.material)) { x.opacity = v * (x.userData.opacidade ?? 1); x.depthWrite = v > 0.95; }
        if (k >= 1) { m.visible = f.para === 1; for (const x of [].concat(m.material)) { x.opacity = x.userData.opacidade ?? 1; x.depthWrite = true; } delete m.userData.fade; fades.delete(m); }
      }
      corre = true;
    }
    if (animar) {
      for (const r of rodar) for (const m of r.ms) m.rotation[r.a.eixo || 'y'] += dt * (r.a.rpm || 24) / 60 * Math.PI * 2;
      if (balanco && mar?.visible) { const s = t / 1000; barco.position.y = Math.sin(s * 0.9) * tam.y * (balanco.amplitude || 0.006); barco.rotation.x = Math.sin(s * 0.7) * 0.012; barco.rotation.z = Math.sin(s * 0.55) * 0.006; }
      corre = true;
    }
    if (mar?.visible) { mar.material.uniforms.time.value += dt * 0.6; corre = true; }
    if (!(mexeu || sujo || corre)) {
      // parado: sobe a nitidez uma vez e não desenha mais
      if (++parado === 8 && renderer.getPixelRatio() !== dprAlto) { renderer.setPixelRatio(dprAlto); ajustaSo(); renderer.render(cena, cam); }
      return;
    }
    sujo = false;
    renderer.render(cena, cam);
    if (pontos.length) posicionaPontos(t);
  }

  // aquecimento: com o mar ligado e todas as peças à vista, compila os shaders (também os do reflexo da água) e carrega
  // tudo na placa gráfica antes do primeiro clique — assim nenhuma troca de peça ou de ambiente engasga
  const comMar = (ficha.ambientes || [['mar']]).some(([id]) => ['mar', 'por-do-sol', 'noite'].includes(id));
  if (comMar) poeAmbiente('mar');
  await renderer.compileAsync(cena, cam);
  if (comMar) { // as versões do reflexo: desenhadas para uma textura, sem correção de cor
    const rt = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType });
    renderer.setRenderTarget(rt); await renderer.compileAsync(cena, cam); renderer.setRenderTarget(null); rt.dispose();
  }
  renderer.render(cena, cam);
  poeAmbiente(ficha.ambienteInicial || 'estudio');
  requestAnimationFrame(laco);
  aoPronto?.();

  return {
    aplica, voa, cameras: Object.keys(cameras), poeAmbiente, acorda,
    corte(on) { corteAtivo = on; if (ultimoEstado) aplica(ultimoEstado, ficha); if (on && ficha.corte?.camera) voa(ficha.corte.camera); return corteAtivo; },
    animar(on) { animar = on && !reduz; acorda(); },
    pontos,
    medidas: { comprimento: tam.x, boca: tam.z, altura: tam.y },
    // fotografia da configuração em alta resolução
    async fotografia(escala = 2) {
      const w = el.clientWidth, h = el.clientHeight, pr = renderer.getPixelRatio();
      renderer.setPixelRatio(Math.min(escala * (devicePixelRatio || 1), 3)); renderer.setSize(w, h, false); renderer.render(cena, cam);
      const b = await new Promise((ok) => tela.toBlob(ok, 'image/png'));
      renderer.setPixelRatio(pr); renderer.setSize(w, h, false); acorda(); return b;
    },
    // o barco configurado como GLB (para o Blender fazer o filme de cinema, ou AR no Android)
    async exportaGLB() {
      const { GLTFExporter } = await import('./vendor/addons/exporters/GLTFExporter.js');
      return new Promise((ok, ko) => new GLTFExporter().parse(barco, (r) => ok(new Blob([r], { type: 'model/gltf-binary' })), ko, { binary: true, onlyVisible: true }));
    },
    async exportaUSDZ() {
      const { USDZExporter } = await import('./vendor/addons/exporters/USDZExporter.js');
      const r = await new USDZExporter().parseAsync(barco, { quickLookCompatible: true });
      return new Blob([r], { type: 'model/vnd.usdz+zip' });
    },
    info() { return { malhas: malhas.length, zonas: Object.fromEntries(Object.entries(zonas).map(([k, z]) => [k, z.malhas.length])), triangulos: renderer.info.render.triangles, chamadas: renderer.info.render.calls }; },
    _three: { THREE, cena, cam, renderer, barco, malhas, ctl },
  };
}
