/* Extra: il giocatore cerca su Modrinth mod lato client, resource pack e shader
   e li installa nella sua edizione del modpack.
   - Ricerca: fetch diretto all'api pubblica di Modrinth (20 risultati per volta).
   - Regole: ../manifest.json (cosa c'e' gia' nel modpack) e ../extra-regole.json (cosa e' bloccato).
   - Installazione e rimozione le fa l'app: qui si mandano i messaggi e si mostra l'esito.
   Senza l'app (pagina aperta nel browser) le risposte sono simulate. */
(function () {
  'use strict';

  var API = 'https://api.modrinth.com/v2/search';
  var PER_PAGINA = 20;
  var ATTESA_RICERCA = 350;
  var DURATA_ESITO = 5000;
  var NOMI_EDIZIONI = { classic: 'Classic', light: 'Light', ultra: 'Ultra' };
  var NOMI_TIPI = { mod: 'Mod', resourcepack: 'Resource pack', shader: 'Shader' };
  var FACETS = {
    mod: [['project_type:mod'], ['versions:1.21.1'], ['categories:fabric'],
      ['client_side:required', 'client_side:optional'], ['server_side:optional', 'server_side:unsupported']],
    resourcepack: [['project_type:resourcepack'], ['versions:1.21.1']],
    shader: [['project_type:shader'], ['versions:1.21.1'], ['categories:iris']]
  };
  var RE_PROGETTO = /cdn\.modrinth\.com\/data\/([^\/]+)\/versions/;

  var $ = function (id) { return document.getElementById(id); };

  var inviaApp = null, avviato = false;
  var edizione = 'classic', scheda = 'mod';
  var risultati = [], offset = 0, finiti = true, caricando = false, errore = '';
  var generazione = 0, timerRicerca = null, timerEsito = null;
  var installati = [], pendenti = {}, inRimozione = {};
  var regoleCaricate = false, nelModpack = {}, bloccati = {};
  // le mod del modpack per edizione ({file, cartella, id}) e i loro dati Modrinth (titolo, icona), per la scheda Installati
  var fileModpack = {}, infoModpack = {}, infoChieste = {};
  var cercatoAlmenoUnaVolta = false;

  function el(tag, classe, testo) {
    var e = document.createElement(tag);
    if (classe) e.className = classe;
    if (testo != null) e.textContent = testo;
    return e;
  }

  function invia(dati) {
    if (typeof inviaApp === 'function') {
      try { inviaApp(dati); } catch (e) { console.warn('Extra: invio non riuscito', e); }
    }
  }

  function abbrevia(n) {
    n = Number(n) || 0;
    function corto(x, suffisso) {
      var s = x.toFixed(1).replace(/\.0$/, '').replace('.', ',');
      return s + suffisso;
    }
    if (n >= 1e9) return corto(n / 1e9, 'G');
    if (n >= 1e6) return corto(n / 1e6, 'M');
    if (n >= 1e3) return corto(n / 1e3, 'k');
    return String(n);
  }

  /* ---------- regole ---------- */

  function leggiJson(url) {
    return fetch(url, { cache: 'no-store' }).then(function (r) {
      if (!r.ok) throw new Error('http ' + r.status);
      return r.json();
    });
  }

  function caricaRegole() {
    if (regoleCaricate) return;
    regoleCaricate = true;
    leggiJson('../manifest.json').then(function (m) {
      var eds = m && m.edizioni;
      if (!eds) return;
      var chiavi = Array.isArray(eds) ? eds.map(function (e, i) { return e && e.id ? e.id : String(i); }) : Object.keys(eds);
      chiavi.forEach(function (k, i) {
        var ed = Array.isArray(eds) ? eds[i] : eds[k];
        var insieme = {}, elenco = [];
        if (ed && Array.isArray(ed.mods)) {
          ed.mods.forEach(function (mod) {
            var t = mod && typeof mod.url === 'string' ? RE_PROGETTO.exec(mod.url) : null;
            if (t) insieme[decodeURIComponent(t[1])] = true;
            if (mod && mod.file) elenco.push({ file: mod.file, cartella: mod.cartella || 'mods', id: t ? decodeURIComponent(t[1]) : null });
          });
        }
        nelModpack[k] = insieme;
        fileModpack[k] = elenco;
      });
      ridisegna();
    }).catch(function () {});
    leggiJson('../extra-regole.json').then(function (r) {
      if (r && r.bloccati && typeof r.bloccati === 'object') {
        bloccati = r.bloccati;
        ridisegna();
      }
    }).catch(function () {});
  }

  function motivoBlocco(p) {
    if (Object.prototype.hasOwnProperty.call(bloccati, p.slug)) return String(bloccati[p.slug] || 'Bloccata');
    if (Object.prototype.hasOwnProperty.call(bloccati, p.project_id)) return String(bloccati[p.project_id] || 'Bloccata');
    return null;
  }

  function giaNelModpack(p) {
    var insieme = nelModpack[edizione];
    return !!(insieme && insieme[p.project_id]);
  }

  function installato(p) {
    for (var i = 0; i < installati.length; i++) {
      if (installati[i].progetto === p.project_id) return true;
    }
    return false;
  }

  /* ---------- ricerca ---------- */

  function urlRicerca(da) {
    var cerca = $('ext-cerca'), ordine = $('ext-ordine');
    var q = cerca ? cerca.value.trim() : '';
    var indice = ordine && /^(relevance|downloads|updated)$/.test(ordine.value) ? ordine.value : 'relevance';
    return API + '?query=' + encodeURIComponent(q) + '&limit=' + PER_PAGINA + '&offset=' + da +
      '&index=' + indice + '&facets=' + encodeURIComponent(JSON.stringify(FACETS[scheda]));
  }

  function nuovaRicerca() {
    clearTimeout(timerRicerca);
    if (scheda === 'installati') return;
    generazione++;
    risultati = [];
    offset = 0;
    finiti = true;
    errore = '';
    caricando = false;
    cercatoAlmenoUnaVolta = true;
    var lista = $('ext-lista');
    if (lista) lista.scrollTop = 0;
    carica();
  }

  function carica() {
    if (caricando || scheda === 'installati') return;
    var mia = generazione;
    caricando = true;
    errore = '';
    ridisegna();
    fetch(urlRicerca(offset)).then(function (r) {
      if (!r.ok) throw new Error('http ' + r.status);
      return r.json();
    }).then(function (d) {
      if (mia !== generazione) return;
      var hits = d && Array.isArray(d.hits) ? d.hits : [];
      risultati = risultati.concat(hits.filter(function (h) { return h && h.project_id; }));
      offset += hits.length;
      var totale = d && typeof d.total_hits === 'number' ? d.total_hits : null;
      finiti = hits.length < PER_PAGINA || (totale !== null && offset >= totale);
      caricando = false;
      ridisegna();
    }).catch(function () {
      if (mia !== generazione) return;
      caricando = false;
      errore = 'Non riesco a raggiungere Modrinth. Controlla la connessione e riprova.';
      ridisegna();
    });
  }

  function ricercaRitardata() {
    clearTimeout(timerRicerca);
    timerRicerca = setTimeout(nuovaRicerca, ATTESA_RICERCA);
  }

  /* ---------- disegno ---------- */

  function icona(url) {
    var vuota = el('span', 'ext-icona ext-icona-vuota');
    vuota.setAttribute('aria-hidden', 'true');
    if (typeof url !== 'string' || !/^https:\/\//i.test(url)) return vuota;
    var img = el('img', 'ext-icona');
    img.alt = '';
    img.loading = 'lazy';
    img.decoding = 'async';
    img.width = 48;
    img.height = 48;
    img.onerror = function () {
      img.onerror = null;
      if (img.parentNode) img.parentNode.replaceChild(vuota, img);
    };
    img.src = url;
    return img;
  }

  function bottoneRisultato(p) {
    var b = el('button', 'ext-btn');
    b.type = 'button';
    b.setAttribute('data-progetto', p.project_id);
    var titolo = p.title || p.slug || p.project_id;
    if (motivoBlocco(p) !== null) {
      b.classList.add('ext-btn-bloccata');
      b.textContent = 'Bloccata';
      b.disabled = true;
    } else if (giaNelModpack(p)) {
      b.classList.add('ext-btn-gia');
      b.textContent = 'Già nel modpack';
      b.disabled = true;
    } else if (inRimozione[p.project_id]) {
      b.classList.add('ext-btn-occupato');
      b.textContent = 'Rimozione…';
      b.disabled = true;
    } else if (installato(p)) {
      b.classList.add('ext-btn-installato');
      b.appendChild(el('span', 'ext-t-normale', 'Installato'));
      b.appendChild(el('span', 'ext-t-hover', 'Togli'));
      b.setAttribute('aria-label', titolo + ': installato, premi per toglierlo');
      b.addEventListener('click', function () { togli(p.project_id); });
    } else if (pendenti[p.project_id]) {
      b.classList.add('ext-btn-occupato');
      b.textContent = 'In installazione…';
      b.disabled = true;
    } else {
      b.classList.add('ext-btn-installa');
      b.textContent = 'Installa';
      b.setAttribute('aria-label', 'Installa ' + titolo);
      b.addEventListener('click', function () { installa(p); });
    }
    return b;
  }

  function rigaRisultato(p) {
    var riga = el('div', 'ext-riga');
    riga.appendChild(icona(p.icon_url));
    var info = el('div', 'ext-info');
    info.appendChild(el('div', 'ext-titolo', p.title || p.slug || p.project_id));
    if (p.author) info.appendChild(el('div', 'ext-autore', 'di ' + p.author));
    if (p.description) {
      var desc = el('div', 'ext-desc', p.description);
      desc.title = p.description;
      info.appendChild(desc);
    }
    var motivo = motivoBlocco(p);
    if (motivo !== null) info.appendChild(el('div', 'ext-motivo', motivo));
    var dl = el('span', 'ext-download', abbrevia(p.downloads));
    dl.setAttribute('aria-label', (Number(p.downloads) || 0).toLocaleString('it-IT') + ' download');
    dl.title = 'Download';
    info.appendChild(dl);
    riga.appendChild(info);
    riga.appendChild(bottoneRisultato(p));
    return riga;
  }

  function titoloDi(progetto) {
    for (var i = 0; i < installati.length; i++) {
      if (installati[i].progetto === progetto) return installati[i].titolo || installati[i].slug || progetto;
    }
    return progetto;
  }

  function rigaInstallato(x) {
    var riga = el('div', 'ext-riga');
    riga.appendChild(icona(null));
    var info = el('div', 'ext-info');
    info.appendChild(el('div', 'ext-titolo', x.titolo || x.slug || x.progetto));
    var dettagli = NOMI_TIPI[x.tipo] || x.tipo || '';
    if (x.versione) dettagli += (dettagli ? ' · ' : '') + x.versione;
    if (dettagli) info.appendChild(el('div', 'ext-autore', dettagli));
    if (x.dipendenzaDi) info.appendChild(el('div', 'ext-dip', 'serve a ' + titoloDi(x.dipendenzaDi)));
    riga.appendChild(info);
    if (!x.dipendenzaDi) {
      var b = el('button', 'ext-btn');
      b.type = 'button';
      b.setAttribute('data-progetto', x.progetto);
      if (inRimozione[x.progetto]) {
        b.classList.add('ext-btn-occupato');
        b.textContent = 'Rimozione…';
        b.disabled = true;
      } else {
        b.classList.add('ext-btn-togli');
        b.textContent = 'Togli';
        b.setAttribute('aria-label', 'Togli ' + (x.titolo || x.slug || x.progetto));
        b.addEventListener('click', function () { togli(x.progetto); });
      }
      riga.appendChild(b);
    }
    return riga;
  }

  /** Titoli e icone delle mod del modpack, una richiesta sola a Modrinth (/v2/projects). */
  function caricaInfoModpack() {
    var ids = (fileModpack[edizione] || []).map(function (x) { return x.id; }).filter(function (id) { return id && !infoChieste[id]; });
    if (!ids.length) return;
    ids.forEach(function (id) { infoChieste[id] = true; });
    leggiJson('https://api.modrinth.com/v2/projects?ids=' + encodeURIComponent(JSON.stringify(ids))).then(function (a) {
      (a || []).forEach(function (x) { if (x && x.id) infoModpack[x.id] = x; });
      if (scheda === 'installati') ridisegna();
    }).catch(function () { ids.forEach(function (id) { delete infoChieste[id]; }); });
  }

  function rigaModpack(x) {
    var info = x.id ? infoModpack[x.id] : null;
    var riga = el('div', 'ext-riga ext-riga-modpack');
    riga.appendChild(icona(info && info.icon_url));
    var box = el('div', 'ext-info');
    box.appendChild(el('div', 'ext-titolo', info && info.title ? info.title : x.file.replace(/.(jar|zip)$/i, '')));
    var tipo = x.cartella === 'resourcepacks' ? 'Resource pack' : x.cartella === 'shaderpacks' ? 'Shader' : 'Mod';
    box.appendChild(el('div', 'ext-autore', tipo + ' · fa parte di Gamblemon'));
    riga.appendChild(box);
    return riga;
  }

  function ridisegna() {
    var lista = $('ext-lista');
    if (!lista) return;
    var altri = $('ext-altri');
    var ricerca = $('ext-ricerca');
    var attivo = document.activeElement;
    var focusProgetto = attivo && lista.contains(attivo) && attivo.getAttribute ? attivo.getAttribute('data-progetto') : null;
    var scroll = lista.scrollTop;

    while (lista.firstChild) lista.removeChild(lista.firstChild);

    if (ricerca) ricerca.hidden = scheda === 'installati';

    if (scheda === 'installati') {
      if (altri) altri.hidden = true;
      // sopra quelli messi dal giocatore, sotto quelli del modpack (thias 24/10)
      lista.appendChild(el('h3', 'ext-gruppo', 'Installati da te'));
      if (!installati.length) lista.appendChild(el('p', 'ext-vuoto', 'Non hai ancora installato niente.'));
      installati.forEach(function (x) { if (x && x.progetto) lista.appendChild(rigaInstallato(x)); });
      var mp = fileModpack[edizione] || [];
      if (mp.length) {
        lista.appendChild(el('h3', 'ext-gruppo', 'Nel modpack (' + mp.length + ')'));
        caricaInfoModpack();
        mp.forEach(function (x) { lista.appendChild(rigaModpack(x)); });
      }
    } else {
      risultati.forEach(function (p) { lista.appendChild(rigaRisultato(p)); });
      if (!risultati.length) {
        var testo = errore || (caricando ? 'Cerco su Modrinth…' : (cercatoAlmenoUnaVolta ? 'Nessun risultato.' : ''));
        if (testo) lista.appendChild(el('p', 'ext-vuoto', testo));
      } else if (errore) {
        lista.appendChild(el('p', 'ext-vuoto', errore));
      }
      if (altri) {
        altri.hidden = finiti || !risultati.length;
        altri.disabled = caricando;
        altri.textContent = caricando && risultati.length ? 'Carico…' : 'Mostra altri';
      }
    }

    lista.scrollTop = scroll;
    if (focusProgetto) {
      var bottoni = lista.querySelectorAll('button[data-progetto]');
      for (var i = 0; i < bottoni.length; i++) {
        if (bottoni[i].getAttribute('data-progetto') === focusProgetto) {
          if (!bottoni[i].disabled) bottoni[i].focus();
          else lista.focus();
          break;
        }
      }
    }
  }

  function mostraEsito(ok, testo) {
    var box = $('ext-esito');
    if (!box) return;
    clearTimeout(timerEsito);
    box.textContent = testo || (ok ? 'Fatto.' : 'Qualcosa è andato storto.');
    box.classList.toggle('ok', !!ok);
    box.classList.toggle('errore', !ok);
    box.hidden = false;
    timerEsito = setTimeout(function () { box.hidden = true; }, DURATA_ESITO);
  }

  /* ---------- azioni ---------- */

  // La prima volta che si installa un extra, un avviso che resta 5 secondi prima di poter continuare (thias 25/10).
  // Dopo, la stessa informazione resta sempre nella sezione. Niente dati: e' solo un avviso.
  var AVVISO_KEY = 'gm-extra-avviso-visto', ATTESA_AVVISO_S = 5;

  function avvisoPrimaVolta(continua) {
    var visto = false;
    try { visto = localStorage.getItem(AVVISO_KEY) === '1'; } catch (e) {}
    if (visto) { continua(); return; }
    var box = el('div', 'ext-avviso');
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    box.appendChild(el('h3', null, 'Prima di installare un extra'));
    box.appendChild(el('p', null, 'Gli extra restano sul tuo PC. Le mod che cambiano il gioco sul server o danno vantaggi non si possono installare.'));
    var b = el('button', 'ext-btn ext-btn-installa');
    b.type = 'button';
    b.disabled = true;
    var n = ATTESA_AVVISO_S;
    b.textContent = 'Ho letto (' + n + ')';
    box.appendChild(b);
    document.getElementById('sez-extra').appendChild(box);
    var t = setInterval(function () {
      n -= 1;
      if (n > 0) { b.textContent = 'Ho letto (' + n + ')'; return; }
      clearInterval(t);
      b.disabled = false;
      b.textContent = 'Ho capito';
      b.addEventListener('click', function () {
        try { localStorage.setItem(AVVISO_KEY, '1'); } catch (e) {}
        box.remove();
        continua();
      });
    }, 1000);
  }

  function installa(p) {
    if (pendenti[p.project_id]) return;
    avvisoPrimaVolta(function () {
      pendenti[p.project_id] = true;
      ridisegna();
      var tipo = FACETS[p.project_type] ? p.project_type : (scheda !== 'installati' ? scheda : 'mod');
      invia({ tipo: 'extra_installa', edizione: edizione, progetto: p.project_id, tipoProgetto: tipo, titolo: p.title || p.slug || p.project_id, slug: p.slug || '' });
    });
  }

  function togli(progetto) {
    if (inRimozione[progetto]) return;
    inRimozione[progetto] = true;
    ridisegna();
    invia({ tipo: 'extra_rimuovi', edizione: edizione, progetto: progetto });
  }

  function richiediStato() {
    invia({ tipo: 'extra_stato', edizione: edizione });
  }

  function scegliScheda(nome, conFocus) {
    if (nome !== 'installati' && !FACETS[nome]) return;
    var cambiata = nome !== scheda;
    scheda = nome;
    var schede = document.querySelectorAll('#sez-extra .ext-scheda');
    for (var i = 0; i < schede.length; i++) {
      var attiva = schede[i].getAttribute('data-scheda') === nome;
      schede[i].classList.toggle('attiva', attiva);
      schede[i].setAttribute('aria-selected', attiva ? 'true' : 'false');
      schede[i].tabIndex = attiva ? 0 : -1;
      if (attiva && conFocus) schede[i].focus();
    }
    if (!sezioneVisibile() && !cercatoAlmenoUnaVolta) {
      ridisegna();
    } else if (nome === 'installati') {
      generazione++;
      caricando = false;
      ridisegna();
    } else if (cambiata || !cercatoAlmenoUnaVolta || !risultati.length) {
      nuovaRicerca();
    } else {
      ridisegna();
    }
  }

  /* ---------- apertura della sezione ---------- */

  function sezioneVisibile() {
    var sez = $('sez-extra');
    return !!(sez && !sez.hidden);
  }

  function aperta() {
    if (!sezioneVisibile()) return;
    caricaRegole();
    richiediStato();
    if (!cercatoAlmenoUnaVolta && scheda !== 'installati') nuovaRicerca();
  }

  function osservaApertura() {
    var sez = $('sez-extra');
    document.addEventListener('click', function (e) {
      var voce = e.target && e.target.closest ? e.target.closest('.nav-voce[data-sezione="extra"]') : null;
      if (voce) setTimeout(function () { if (!osservatore) aperta(); }, 0);
    });
    var osservatore = null;
    if (sez && window.MutationObserver) {
      var eraNascosta = sez.hidden;
      osservatore = new MutationObserver(function () {
        if (eraNascosta && !sez.hidden) aperta();
        eraNascosta = sez.hidden;
      });
      osservatore.observe(sez, { attributes: true, attributeFilter: ['hidden'] });
    }
    if (sezioneVisibile()) aperta();
  }

  /* ---------- simulazione senza app ---------- */

  function creaSimulatore() {
    var memoria = { classic: [], light: [], ultra: [] };
    function lista(ed) {
      if (!memoria[ed]) memoria[ed] = [];
      return memoria[ed];
    }
    function copia(ed) { return lista(ed).map(function (x) { var c = {}; for (var k in x) c[k] = x[k]; return c; }); }
    function rispondi(dati, ritardo) {
      setTimeout(function () { window.Extra.messaggio(dati); }, ritardo);
    }
    return function (m) {
      if (!m || !m.tipo) return;
      var ed = m.edizione || 'classic';
      if (m.tipo === 'extra_stato') {
        rispondi({ tipo: 'extra_stato', edizione: ed, installati: copia(ed) }, 150);
      } else if (m.tipo === 'extra_installa') {
        var l = lista(ed), gia = l.some(function (x) { return x.progetto === m.progetto; });
        if (!gia) {
          l.push({
            progetto: m.progetto, slug: m.slug || '', titolo: m.titolo || m.progetto,
            tipo: m.tipoProgetto || 'mod', versione: '1.0.0',
            file: (m.slug || m.progetto) + (m.tipoProgetto === 'mod' ? '.jar' : '.zip'), dipendenzaDi: null
          });
        }
        rispondi({ tipo: 'extra_esito', edizione: ed, ok: true, testo: (m.titolo || 'Il progetto') + ' è installato. (prova nel browser)', progetto: m.progetto, installati: copia(ed) }, 1000);
      } else if (m.tipo === 'extra_rimuovi') {
        var titolo = m.progetto;
        memoria[ed] = lista(ed).filter(function (x) {
          if (x.progetto === m.progetto) titolo = x.titolo || titolo;
          return x.progetto !== m.progetto && x.dipendenzaDi !== m.progetto;
        });
        rispondi({ tipo: 'extra_esito', edizione: ed, ok: true, testo: titolo + ' è stato tolto. (prova nel browser)', progetto: m.progetto, installati: copia(ed) }, 1000);
      }
    };
  }

  /* ---------- api pubblica ---------- */

  function init(funzioneInvia) {
    var app = !!(window.chrome && window.chrome.webview);
    inviaApp = app && typeof funzioneInvia === 'function' ? funzioneInvia : creaSimulatore();
    if (avviato) return;
    avviato = true;

    var schede = document.querySelectorAll('#sez-extra .ext-scheda');
    for (var i = 0; i < schede.length; i++) {
      schede[i].addEventListener('click', function (e) {
        scegliScheda(e.currentTarget.getAttribute('data-scheda'), false);
      });
      schede[i].addEventListener('keydown', function (e) {
        if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft' && e.key !== 'Home' && e.key !== 'End') return;
        var tutte = Array.prototype.slice.call(document.querySelectorAll('#sez-extra .ext-scheda'));
        var j = tutte.indexOf(e.currentTarget);
        if (e.key === 'ArrowRight') j = (j + 1) % tutte.length;
        else if (e.key === 'ArrowLeft') j = (j - 1 + tutte.length) % tutte.length;
        else if (e.key === 'Home') j = 0;
        else j = tutte.length - 1;
        e.preventDefault();
        scegliScheda(tutte[j].getAttribute('data-scheda'), true);
      });
    }

    var cerca = $('ext-cerca');
    if (cerca) {
      cerca.addEventListener('input', ricercaRitardata);
      cerca.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); nuovaRicerca(); } });
    }
    var ordine = $('ext-ordine');
    if (ordine) ordine.addEventListener('change', nuovaRicerca);
    var altri = $('ext-altri');
    if (altri) altri.addEventListener('click', function () { if (!finiti) carica(); });
    var lista = $('ext-lista');
    if (lista && !lista.hasAttribute('tabindex')) lista.tabIndex = -1;

    var etichetta = $('ext-edizione');
    if (etichetta) etichetta.textContent = NOMI_EDIZIONI[edizione] || edizione;
    scegliScheda(scheda, false);
    osservaApertura();
  }

  function messaggio(dati) {
    if (!dati || typeof dati !== 'object') return;
    var stessa = !dati.edizione || dati.edizione === edizione;
    if (dati.tipo === 'extra_stato') {
      if (dati.edizione === edizione && Array.isArray(dati.installati)) {
        installati = dati.installati.filter(function (x) { return x && x.progetto; });
        ridisegna();
      }
    } else if (dati.tipo === 'extra_esito') {
      mostraEsito(!!dati.ok, typeof dati.testo === 'string' ? dati.testo : '');
      if (stessa && Array.isArray(dati.installati)) {
        installati = dati.installati.filter(function (x) { return x && x.progetto; });
      }
      if (dati.progetto) {
        delete pendenti[dati.progetto];
        delete inRimozione[dati.progetto];
      }
      ridisegna();
    }
  }

  function cambiaEdizione(id) {
    if (typeof id !== 'string' || !id) return;
    edizione = id;
    var etichetta = $('ext-edizione');
    if (etichetta) etichetta.textContent = NOMI_EDIZIONI[id] || (id.charAt(0).toUpperCase() + id.slice(1));
    installati = [];
    pendenti = {};
    inRimozione = {};
    risultati = [];
    if (scheda !== 'installati' && (cercatoAlmenoUnaVolta || sezioneVisibile())) nuovaRicerca();
    else { cercatoAlmenoUnaVolta = false; ridisegna(); }
    richiediStato();
  }

  window.Extra = { init: init, messaggio: messaggio, edizione: cambiaEdizione };
})();
