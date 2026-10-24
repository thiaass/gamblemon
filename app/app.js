'use strict';

/* Ponte con l'app (WebView2). Se manca, la pagina gira in modalità dimostrazione. */
const wv = window.chrome?.webview;

const VETRINA_MINIMA = { tema: 'normale', eventi: [], novita: [] };

const DEMO_STATO = {
  tipo: 'stato',
  versione: '2.15.1',
  edizioni: [
    { id: 'classic', nome: 'Gamblemon Classic' },
    { id: 'light', nome: 'Gamblemon Light' },
    { id: 'ultra', nome: 'Gamblemon Ultra' }
  ],
  edizione: 'classic',
  account: null,
  soloLauncher: false,
  base: ''
};

const SEZIONI = {
  gioca: 'Gioca',
  novita: 'Novità',
  proposte: 'Proposte',
  extra: 'Extra'
};

/* Stato interno della pagina */
const ui = {
  edizione: '',
  edizioni: [],
  occupato: false,
  vetrinaRichiesta: false,
  novita: [],
  focusPrecedente: null,
  timerDemo: null,
  sezione: '',
  // cosa e' ogni edizione (dalla vetrina, cosi' si cambia senza toccare l'app)
  descrizioni: {}
};

const $ = (id) => document.getElementById(id);

/* ---------- Comunicazione ---------- */

function invia(obj) {
  if (wv) {
    wv.postMessage(obj);
  } else {
    simulaApp(obj);
  }
}

function gestisci(dati) {
  let d = dati;
  if (typeof d === 'string') {
    try { d = JSON.parse(d); } catch { return; }
  }
  if (!d || typeof d !== 'object' || typeof d.tipo !== 'string') return;

  switch (d.tipo) {
    case 'stato': gestisciStato(d); break;
    case 'avanzamento': gestisciAvanzamento(d); break;
    case 'codice': gestisciCodice(d); break;
    case 'fatto': gestisciFatto(d); break;
    case 'errore': gestisciErrore(d); break;
    case 'extra_stato':
    case 'extra_esito':
      if (window.Extra && typeof window.Extra.messaggio === 'function') window.Extra.messaggio(d);
      break;
    case 'proposta_esito':
      if (window.Proposte && typeof window.Proposte.esito === 'function') window.Proposte.esito(d);
      break;
    default: break;
  }
}

/* ---------- Messaggi dall'app ---------- */

function gestisciStato(d) {
  if (Array.isArray(d.edizioni)) {
    mostraEdizioni(d.edizioni, typeof d.edizione === 'string' ? d.edizione : ui.edizione);
  } else if (typeof d.edizione === 'string' && d.edizione) {
    segnaEdizione(d.edizione);
  }
  if ('account' in d) mostraAccount(d.account);
  const nota = $('nota-launcher');
  if (nota) nota.hidden = d.soloLauncher !== true;

  if (!ui.vetrinaRichiesta) {
    ui.vetrinaRichiesta = true;
    caricaVetrina(typeof d.base === 'string' ? d.base : '');
  }
}

function gestisciAvanzamento(d) {
  const percento = Math.max(0, Math.min(100, Number(d.percento) || 0));
  const progresso = $('progresso');
  if (progresso) {
    progresso.hidden = false;
    progresso.setAttribute('aria-valuenow', String(Math.round(percento)));
  }
  const barra = $('progresso-barra');
  if (barra) barra.style.width = percento + '%';
  if (typeof d.testo === 'string') scriviStato(d.testo, false);
}

function gestisciCodice(d) {
  if (typeof d.codice !== 'string' || !d.codice) return;
  const valore = $('codice-valore');
  if (valore) valore.textContent = d.codice;
  const link = $('codice-sito');
  const sito = typeof d.sito === 'string' ? d.sito : '';
  if (link) {
    link.textContent = sito;
    link.href = /^https?:\/\//i.test(sito) ? sito : '#';
  }
  const riquadro = $('riquadro-codice');
  if (riquadro) riquadro.hidden = false;
  // il codice serve subito: si torna nella sezione Gioca
  if (ui.sezione !== 'gioca') vaiA('gioca');
}

function nascondiCodice() {
  const riquadro = $('riquadro-codice');
  if (riquadro) riquadro.hidden = true;
}

function gestisciFatto(d) {
  scriviStato(typeof d.testo === 'string' ? d.testo : '', false);
  nascondiCodice();
  // Il gioco sta partendo: GIOCA resta disattivato
  impostaDisattivati(true);
  document.body.classList.remove('occupato');
}

function gestisciErrore(d) {
  scriviStato(typeof d.testo === 'string' ? d.testo : 'Si è verificato un errore.', true);
  const progresso = $('progresso');
  if (progresso) progresso.hidden = true;
  nascondiCodice();
  impostaOccupato(false);
}

/* ---------- Navigazione ---------- */

function vaiA(nome) {
  if (!Object.prototype.hasOwnProperty.call(SEZIONI, nome)) nome = 'gioca';
  ui.sezione = nome;
  Object.keys(SEZIONI).forEach((s) => {
    const sez = $('sez-' + s);
    if (sez) sez.hidden = s !== nome;
  });
  document.querySelectorAll('.nav-voce').forEach((voce) => {
    const attiva = voce.dataset.sezione === nome;
    voce.classList.toggle('attiva', attiva);
    if (attiva) voce.setAttribute('aria-current', 'page');
    else voce.removeAttribute('aria-current');
  });
  const titolo = $('barra-titolo');
  if (titolo) titolo.textContent = SEZIONI[nome];
  // la barra in fondo serve solo in Gioca
  const barraGioca = $('barra-gioca');
  if (barraGioca) barraGioca.hidden = nome !== 'gioca';
  if (nome !== 'gioca') chiudiEdizioni(false);
}

function clicNav(e) {
  const voce = e.target.closest('.nav-voce');
  if (!voce || !voce.dataset.sezione) return;
  vaiA(voce.dataset.sezione);
}

/* ---------- Edizioni ---------- */

function nomeCorto(e) {
  // il nome corto (Classic, Light, Ultra): «Gamblemon» c'e' gia' nel logo
  return typeof e.nome === 'string' && e.nome ? e.nome.replace(/^Gamblemon\s+/i, '') : e.id;
}

function mostraEdizioni(lista, scelta) {
  const valide = lista.filter((e) => e && typeof e.id === 'string' && e.id);
  ui.edizioni = valide.map((e) => ({ id: e.id, nome: nomeCorto(e) }));
  const contenitore = $('edizione-lista');
  if (contenitore) {
    contenitore.replaceChildren();
    ui.edizioni.forEach((e) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'edizione';
      btn.setAttribute('role', 'option');
      btn.setAttribute('aria-selected', 'false');
      btn.dataset.id = e.id;
      btn.textContent = e.nome;
      btn.disabled = ui.occupato;
      contenitore.appendChild(btn);
    });
  }
  const esiste = valide.some((e) => e.id === scelta);
  segnaEdizione(esiste ? scelta : (valide[0]?.id || ''));
}

function segnaEdizione(id) {
  ui.edizione = id;
  if (window.Extra && typeof window.Extra.edizione === 'function') window.Extra.edizione(id);
  const desc = $('edizione-desc');
  if (desc) desc.textContent = typeof ui.descrizioni[id] === 'string' ? ui.descrizioni[id] : '';
  document.querySelectorAll('#edizione-lista .edizione').forEach((btn) => {
    const attiva = btn.dataset.id === id;
    btn.classList.toggle('attiva', attiva);
    btn.setAttribute('aria-selected', attiva ? 'true' : 'false');
  });
  const voce = ui.edizioni.find((e) => e.id === id);
  const btnEd = $('edizione-btn');
  if (btnEd) {
    const nome = voce ? voce.nome : id;
    // se il bottone ha uno span per il nome (accanto alla freccia) si scrive li'
    const posto = btnEd.querySelector('.edizione-nome');
    if (posto) posto.textContent = nome;
    else btnEd.textContent = nome;
    btnEd.setAttribute('aria-label', 'Edizione: ' + nome);
  }
}

function listaAperta() {
  const lista = $('edizione-lista');
  return !!lista && !lista.hidden;
}

function apriEdizioni() {
  const lista = $('edizione-lista');
  const btn = $('edizione-btn');
  if (!lista || ui.occupato || (btn && btn.disabled)) return;
  lista.hidden = false;
  if (btn) btn.setAttribute('aria-expanded', 'true');
  const opzioni = Array.from(lista.querySelectorAll('.edizione'));
  const scelta = opzioni.find((o) => o.dataset.id === ui.edizione) || opzioni[0];
  if (scelta) scelta.focus();
}

/* rimettiFocus: true quando si chiude da tastiera o dopo una scelta */
function chiudiEdizioni(rimettiFocus) {
  const lista = $('edizione-lista');
  if (!lista || lista.hidden) return false;
  lista.hidden = true;
  const btn = $('edizione-btn');
  if (btn) {
    btn.setAttribute('aria-expanded', 'false');
    if (rimettiFocus !== false && !btn.disabled) btn.focus();
  }
  return true;
}

function clicEdizioneBtn() {
  if (listaAperta()) chiudiEdizioni(true);
  else apriEdizioni();
}

function clicEdizione(e) {
  const btn = e.target.closest('.edizione');
  if (!btn || ui.occupato || btn.disabled) return;
  const id = btn.dataset.id;
  if (id && id !== ui.edizione) {
    segnaEdizione(id);
    invia({ tipo: 'edizione', edizione: id });
  }
  chiudiEdizioni(true);
}

function tastoLista(e) {
  const lista = $('edizione-lista');
  if (!lista) return;
  const opzioni = Array.from(lista.querySelectorAll('.edizione:not([disabled])'));
  if (!opzioni.length) return;
  const i = opzioni.indexOf(document.activeElement);
  let prossimo = -1;
  if (e.key === 'ArrowDown') prossimo = i < 0 ? 0 : (i + 1) % opzioni.length;
  else if (e.key === 'ArrowUp') prossimo = i < 0 ? opzioni.length - 1 : (i - 1 + opzioni.length) % opzioni.length;
  else if (e.key === 'Home') prossimo = 0;
  else if (e.key === 'End') prossimo = opzioni.length - 1;
  else if (e.key === 'Tab') { chiudiEdizioni(false); return; }
  if (prossimo >= 0) {
    e.preventDefault();
    opzioni[prossimo].focus();
  }
}

function tastoEdizioneBtn(e) {
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    apriEdizioni();
  }
}

/* ---------- Account e stato ---------- */

function mostraAccount(nome) {
  const riga = $('account');
  const esci = $('btn-esci');
  const presente = typeof nome === 'string' && nome.trim() !== '';
  if (riga) {
    const iniziale = presente ? (Array.from(nome.trim())[0] || '?').toLocaleUpperCase('it-IT') : '?';
    let quadrato = riga.querySelector('.account-iniziale');
    if (!quadrato) {
      quadrato = creaElemento('span', 'account-iniziale');
      quadrato.setAttribute('aria-hidden', 'true');
      riga.appendChild(quadrato);
    }
    quadrato.textContent = iniziale;
    const etichetta = presente ? 'Accesso come ' + nome.trim() : 'Non hai ancora fatto l\'accesso';
    riga.title = etichetta;
    riga.setAttribute('aria-label', etichetta);
    if (riga.tagName !== 'BUTTON' && !riga.hasAttribute('role')) riga.setAttribute('role', 'img');
    riga.classList.toggle('senza-account', !presente);
  }
  if (esci) esci.hidden = !presente;
}

function scriviStato(testo, errore) {
  const p = $('stato-testo');
  if (!p) return;
  p.textContent = testo;
  p.classList.toggle('errore', !!errore);
}

function impostaDisattivati(on) {
  const gioca = $('btn-gioca');
  if (gioca) gioca.disabled = on;
  const btnEd = $('edizione-btn');
  if (btnEd) btnEd.disabled = on;
  document.querySelectorAll('#edizione-lista .edizione').forEach((b) => { b.disabled = on; });
  if (on) chiudiEdizioni(false);
}

function impostaOccupato(on) {
  ui.occupato = on;
  impostaDisattivati(on);
  document.body.classList.toggle('occupato', on);
}

/* ---------- Vetrina ---------- */

async function caricaVetrina(base) {
  let urlJson;
  try {
    urlJson = new URL('vetrina.json', base || location.href);
  } catch {
    urlJson = new URL('vetrina.json', location.href);
  }
  let vetrina = VETRINA_MINIMA;
  try {
    const risposta = await fetch(urlJson, { cache: 'no-store' });
    if (!risposta.ok) throw new Error('HTTP ' + risposta.status);
    const dati = await risposta.json();
    if (dati && typeof dati === 'object') vetrina = dati;
  } catch {
    vetrina = VETRINA_MINIMA;
  }
  mostraVetrina(vetrina, urlJson);
}

function risolviImmagine(img, urlJson) {
  if (typeof img !== 'string' || !img) return '';
  try { return new URL(img, urlJson).href; } catch { return ''; }
}

function versionePrincipale(v) {
  return String(v).split('.').slice(0, 2).join('.');
}

/* Svuota la copertina tenendo gli effetti di Halloween; restituisce il punto d'inserimento */
function svuotaBanner(banner) {
  Array.from(banner.children).forEach((figlio) => {
    if (figlio.id !== 'fx-halloween') figlio.remove();
  });
  const fx = $('fx-halloween');
  return fx && fx.parentNode === banner ? fx : null;
}

/* La copertina della sezione Gioca: l'ultimo aggiornamento, col numero grande e la sua immagine */
function mostraAggiornamento(a, urlJson) {
  const banner = $('banner');
  if (!banner) return;
  const prima = svuotaBanner(banner);
  const src = risolviImmagine(a.immagine, urlJson);
  const nome = typeof a.nome === 'string' ? a.nome : '';
  if (src) {
    const img = creaElemento('img', 'banner-img');
    img.alt = 'Gamblemon ' + versionePrincipale(a.versione) + (nome ? ': ' + nome : '');
    img.src = src;
    img.addEventListener('error', () => img.remove(), { once: true });
    banner.insertBefore(img, prima);
  }
  const testo = creaElemento('div', 'banner-testo');
  const data = leggiData(a.data);
  testo.append(
    creaElemento('p', 'banner-versione', versionePrincipale(a.versione)),
    creaElemento('h2', 'banner-nome', nome),
    creaElemento('p', 'banner-data', data ? formattaData(data, true) : ''),
    creaElemento('p', 'banner-desc', typeof a.testo === 'string' ? a.testo : '')
  );
  // tutte le informazioni dell'aggiornamento stanno a parte, dietro al tasto Info
  if (Array.isArray(a.dettagli) && a.dettagli.length) {
    const info = creaElemento('button', 'banner-info', 'Info');
    info.type = 'button';
    info.setAttribute('aria-label', 'Info sull\'aggiornamento ' + versionePrincipale(a.versione));
    info.addEventListener('click', () => apriInfo(a));
    testo.appendChild(info);
  }
  banner.insertBefore(testo, prima);
  banner.hidden = false;
}

function mostraVetrina(v, urlJson) {
  applicaTema(v.tema);
  ui.descrizioni = v.edizioni && typeof v.edizioni === 'object' ? v.edizioni : {};
  if (ui.edizione) segnaEdizione(ui.edizione);
  const eventi = Array.isArray(v.eventi) ? v.eventi : [];
  const evento = eventi.find((e) => e && typeof e === 'object' && e.attivo === true);
  // l'aggiornamento ha il posto in alto; l'evento c'e' solo se non c'e' un aggiornamento da mostrare
  if (v.aggiornamento && typeof v.aggiornamento === 'object' && v.aggiornamento.versione) mostraAggiornamento(v.aggiornamento, urlJson);
  else mostraBanner(evento, urlJson);
  const novita = Array.isArray(v.novita) ? v.novita.filter((n) => n && typeof n === 'object') : [];
  mostraNovita(novita, urlJson);
}

function applicaTema(tema) {
  const halloween = tema === 'halloween';
  document.body.classList.remove('tema-halloween', 'tema-normale');
  document.body.classList.add(halloween ? 'tema-halloween' : 'tema-normale');
}

/* Converte "YYYY-MM-DD" in Date locale */
function leggiData(testo) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(testo || ''));
  if (!m) return null;
  const data = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return isNaN(data) ? null : data;
}

function formattaData(data, conAnno) {
  const opzioni = conAnno
    ? { day: 'numeric', month: 'long', year: 'numeric' }
    : { day: 'numeric', month: 'long' };
  return data.toLocaleDateString('it-IT', opzioni);
}

function formattaPeriodo(dal, al) {
  const inizio = leggiData(dal);
  const fine = leggiData(al);
  if (inizio && fine) {
    const stessoAnno = inizio.getFullYear() === fine.getFullYear();
    return 'dal ' + formattaData(inizio, !stessoAnno) + ' al ' + formattaData(fine, true);
  }
  if (inizio) return 'dal ' + formattaData(inizio, true);
  if (fine) return 'fino al ' + formattaData(fine, true);
  return '';
}

function creaElemento(tag, classe, testo) {
  const el = document.createElement(tag);
  if (classe) el.className = classe;
  if (testo) el.textContent = testo;
  return el;
}

function mostraBanner(evento, urlJson) {
  const banner = $('banner');
  if (!banner) return;
  const prima = svuotaBanner(banner);
  if (!evento) {
    banner.hidden = true;
    return;
  }
  const nome = typeof evento.nome === 'string' ? evento.nome : '';
  const src = risolviImmagine(evento.immagine, urlJson);
  if (src) {
    const img = creaElemento('img', 'banner-img');
    img.alt = nome;
    img.src = src;
    img.addEventListener('error', () => img.remove(), { once: true });
    banner.insertBefore(img, prima);
  }
  const testo = creaElemento('div', 'banner-testo');
  testo.append(
    creaElemento('h2', 'banner-nome', nome),
    creaElemento('p', 'banner-date', formattaPeriodo(evento.dal, evento.al)),
    creaElemento('p', 'banner-desc', typeof evento.testo === 'string' ? evento.testo : '')
  );
  banner.insertBefore(testo, prima);
  banner.hidden = false;
}

/* Nome classe del tag: minuscolo, senza spazi né accenti */
function classeTag(tag) {
  return String(tag || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]/g, '');
}

function creaScheda(n, i, urlJson) {
  const titolo = typeof n.titolo === 'string' ? n.titolo : '';
  const scheda = creaElemento('button', 'scheda');
  scheda.type = 'button';
  scheda.dataset.i = String(i);

  const src = risolviImmagine(n.immagine, urlJson);
  if (src) {
    const img = creaElemento('img', 'scheda-img');
    img.alt = titolo;
    img.loading = 'lazy';
    img.src = src;
    img.addEventListener('error', () => {
      img.remove();
      scheda.classList.add('senza-immagine');
      if (ui.novita[i]) ui.novita[i].immagine = '';
    }, { once: true });
    scheda.appendChild(img);
  } else {
    scheda.classList.add('senza-immagine');
  }

  const corpo = creaElemento('div', 'scheda-corpo');
  const meta = creaElemento('div', 'scheda-meta');
  if (typeof n.tag === 'string' && n.tag) {
    const slug = classeTag(n.tag);
    meta.appendChild(creaElemento('span', slug ? 'tag tag-' + slug : 'tag', n.tag));
  }
  const data = leggiData(n.data);
  if (data) meta.appendChild(creaElemento('span', 'scheda-data', formattaData(data, true)));
  // prima il titolo, poi tag e data (niente etichetta sopra il titolo)
  corpo.append(
    creaElemento('h3', 'scheda-titolo', titolo),
    meta,
    creaElemento('p', 'scheda-testo', typeof n.testo === 'string' ? n.testo : '')
  );
  scheda.appendChild(corpo);
  return { scheda, voce: { titolo, immagine: src } };
}

function mostraNovita(lista, urlJson) {
  const contenitore = $('novita');
  ui.novita = [];
  if (!contenitore) return;
  contenitore.replaceChildren();
  lista.forEach((n, i) => {
    const { scheda, voce } = creaScheda(n, i, urlJson);
    ui.novita.push(voce);
    contenitore.appendChild(scheda);
  });
}

/* ---------- Overlay immagine e pannello Info ---------- */

function apriOverlay(i) {
  const voce = ui.novita[i];
  if (!voce || !voce.immagine) return;
  const overlay = $('overlay');
  const img = $('overlay-img');
  if (!overlay || !img) return;
  ui.focusPrecedente = document.activeElement;
  img.src = voce.immagine;
  img.alt = voce.titolo;
  const didascalia = $('overlay-didascalia');
  if (didascalia) didascalia.textContent = voce.titolo;
  overlay.hidden = false;
  overlay.classList.add('aperto');
  overlay.tabIndex = -1;
  overlay.focus();
}

function apriInfo(a) {
  const pannello = $('info');
  const corpo = $('info-corpo');
  if (!pannello || !corpo) return;
  const nome = typeof a.nome === 'string' ? a.nome : '';
  const titolo = $('info-titolo');
  if (titolo) titolo.textContent = 'Gamblemon ' + versionePrincipale(a.versione) + (nome ? ': ' + nome : '');
  corpo.replaceChildren();
  for (const sez of Array.isArray(a.dettagli) ? a.dettagli : []) {
    if (!sez || typeof sez !== 'object') continue;
    if (typeof sez.titolo === 'string') corpo.appendChild(creaElemento('h3', 'info-sezione', sez.titolo));
    const ul = creaElemento('ul', 'info-punti');
    for (const p of Array.isArray(sez.punti) ? sez.punti : []) if (typeof p === 'string') ul.appendChild(creaElemento('li', '', p));
    corpo.appendChild(ul);
  }
  corpo.scrollTop = 0;
  ui.focusPrecedente = document.activeElement;
  pannello.hidden = false;
  const chiudi = $('info-chiudi');
  if (chiudi) chiudi.focus();
}

function chiudiInfo() {
  const pannello = $('info');
  if (!pannello || pannello.hidden) return false;
  pannello.hidden = true;
  const precedente = ui.focusPrecedente;
  ui.focusPrecedente = null;
  if (precedente && typeof precedente.focus === 'function') precedente.focus();
  return true;
}

function chiudiOverlay() {
  const overlay = $('overlay');
  if (!overlay || overlay.hidden) return false;
  overlay.classList.remove('aperto');
  overlay.hidden = true;
  const precedente = ui.focusPrecedente;
  ui.focusPrecedente = null;
  if (precedente && typeof precedente.focus === 'function') precedente.focus();
  return true;
}

/* ---------- Azioni dell'utente ---------- */

function clicGioca() {
  if (ui.occupato) return;
  impostaOccupato(true);
  scriviStato('Preparazione in corso…', false);
  const progresso = $('progresso');
  if (progresso) {
    progresso.hidden = false;
    progresso.setAttribute('aria-valuenow', '0');
  }
  const barra = $('progresso-barra');
  if (barra) barra.style.width = '0%';
  invia({ tipo: 'gioca', edizione: ui.edizione });
}

function clicDocumento(e) {
  // clic fuori dal selettore: la lista delle edizioni si chiude
  if (listaAperta() && !e.target.closest('#edizioni') && !e.target.closest('#edizione-lista') && !e.target.closest('#edizione-btn')) {
    chiudiEdizioni(false);
  }
  // Link esterni: si aprono nel browser
  const link = e.target.closest('a[href]');
  if (link && /^https?:\/\//i.test(link.href)) {
    e.preventDefault();
    invia({ tipo: 'apri', url: link.href });
    return;
  }
  if (link && link.getAttribute('href') === '#') e.preventDefault();
}

function clicNovita(e) {
  const scheda = e.target.closest('.scheda');
  if (!scheda) return;
  apriOverlay(Number(scheda.dataset.i));
}

function mousedownBarra(e) {
  if (e.button !== 0 || e.target.closest('.barra-tasti')) return;
  invia({ tipo: 'trascina' });
}

function tastoPremuto(e) {
  if (e.key !== 'Escape') return;
  if (chiudiEdizioni(true)) { e.preventDefault(); return; }
  if (chiudiInfo()) { e.preventDefault(); return; }
  if (chiudiOverlay()) e.preventDefault();
}

function ascolta(id, evento, gestore) {
  const el = $(id);
  if (el) el.addEventListener(evento, gestore);
  return el;
}

function registraEventi() {
  ascolta('barra', 'mousedown', mousedownBarra);
  ascolta('btn-riduci', 'click', () => invia({ tipo: 'riduci' }));
  ascolta('btn-chiudi', 'click', () => invia({ tipo: 'chiudi' }));
  ascolta('btn-gioca', 'click', clicGioca);
  ascolta('btn-esci', 'click', () => invia({ tipo: 'esci' }));
  ascolta('colonna', 'click', clicNav);
  ascolta('edizione-btn', 'click', clicEdizioneBtn);
  ascolta('edizione-btn', 'keydown', tastoEdizioneBtn);
  ascolta('edizione-lista', 'click', clicEdizione);
  ascolta('edizione-lista', 'keydown', tastoLista);
  ascolta('novita', 'click', clicNovita);
  ascolta('overlay', 'click', chiudiOverlay);
  ascolta('info-chiudi', 'click', chiudiInfo);
  const info = $('info');
  if (info) info.addEventListener('click', (e) => { if (e.target === info) chiudiInfo(); });
  document.addEventListener('click', clicDocumento);
  document.addEventListener('keydown', tastoPremuto);
}

/* ---------- Modalità dimostrazione ---------- */

const PASSI_DEMO = [
  { fino: 15, testo: 'Controllo gli aggiornamenti del modpack…' },
  { fino: 55, testo: 'Scarico le mod…' },
  { fino: 75, testo: 'Scarico le skin di Halloween…' },
  { fino: 90, testo: 'Scarico le configurazioni…' },
  { fino: 100, testo: 'Preparo Minecraft…' }
];

function simulaApp(obj) {
  if (!obj || typeof obj !== 'object') return;
  if (obj.tipo === 'gioca') simulaGioca();
  else if (obj.tipo === 'esci') mostraAccount(null);
  else if (obj.tipo === 'apri') window.open(obj.url, '_blank', 'noopener');
  else if (obj.tipo === 'proposta') {
    setTimeout(() => gestisci({ tipo: 'proposta_esito', ok: true, testo: 'Proposta inviata, grazie!' }), 1000);
  }
}

function simulaGioca() {
  clearInterval(ui.timerDemo);
  let percento = 0;
  ui.timerDemo = setInterval(() => {
    percento = Math.min(100, percento + 3);
    const passo = PASSI_DEMO.find((p) => percento <= p.fino) || PASSI_DEMO[PASSI_DEMO.length - 1];
    gestisci({ tipo: 'avanzamento', testo: passo.testo, percento });
    if (percento >= 100) {
      clearInterval(ui.timerDemo);
      gestisci({ tipo: 'fatto', testo: 'Il gioco sta partendo! (dimostrazione)' });
      // Solo in prova: dopo qualche secondo si può giocare di nuovo
      setTimeout(ripristinaDemo, 4000);
    }
  }, 120);
}

function ripristinaDemo() {
  impostaOccupato(false);
  const progresso = $('progresso');
  if (progresso) progresso.hidden = true;
  scriviStato('', false);
}

/* ---------- Avvio ---------- */

function avvia() {
  const progresso = $('progresso');
  if (progresso) progresso.hidden = true;
  const lista = $('edizione-lista');
  if (lista) lista.hidden = true;
  const btnEd = $('edizione-btn');
  if (btnEd) btnEd.setAttribute('aria-expanded', 'false');
  vaiA('gioca');
  mostraAccount(null);
  registraEventi();
  if (window.Proposte && typeof window.Proposte.init === 'function') {
    try { window.Proposte.init(window.Comunita ? window.Comunita.invia : invia); } catch (err) { console.warn('Proposte non disponibile', err); }
  }
  if (window.Extra && typeof window.Extra.init === 'function') {
    try { window.Extra.init(invia); } catch (err) { console.warn('Extra non disponibile', err); }
  }
  if (wv) {
    wv.addEventListener('message', (e) => gestisci(e.data));
  } else {
    gestisci(DEMO_STATO);
  }
  invia({ tipo: 'pronto' });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', avvia);
} else {
  avvia();
}
