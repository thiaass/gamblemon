'use strict';
/* Modulo Proposte di Gamblemon: espone window.Proposte = { init(invia), esito(d), reset() } */
(function () {
  // Limiti
  var MAX_TITOLO = 80;
  var MAX_TESTO = 2000;
  var MAX_LINK = 5;
  var MAX_IMMAGINI = 4;
  var MAX_BYTE = 4 * 1024 * 1024;
  var TIPI = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
  var CATEGORIA_DEFAULT = 'meccaniche';
  var ATTESA_ESITO_MS = 60000;

  // Stato interno
  var inviaFn = null;
  var avviato = false;
  var categoria = CATEGORIA_DEFAULT;
  var immagini = [];      // {nome, tipo, dati}
  var letture = [];       // promesse di FileReader ancora in corso
  var inLettura = 0;      // quante immagini sono in lettura
  var inviando = false;
  var timerEsito = null;
  var el = {};

  function $(id) { return document.getElementById(id); }

  // ---------- Utilità ----------
  function mostraErrore(msg) { if (el.errore) el.errore.textContent = msg || ''; }

  function pulisciEsito() {
    if (!el.esito) return;
    el.esito.textContent = '';
    el.esito.classList.remove('ok', 'errore');
  }

  // Quando l'utente modifica un campo, il vecchio esito sparisce
  function modificato() {
    if (!inviando) pulisciEsito();
  }

  function aggiornaContatori() {
    if (el.contTitolo) el.contTitolo.textContent = el.titolo.value.length + ' / ' + MAX_TITOLO;
    if (el.contTesto) el.contTesto.textContent = el.testo.value.length + ' / ' + MAX_TESTO;
  }

  function aggiornaInvia() {
    var t = el.titolo.value.trim().length;
    var x = el.testo.value.trim().length;
    var valido = t >= 1 && t <= MAX_TITOLO && x >= 1 && x <= MAX_TESTO;
    el.invia.disabled = !valido || inviando;
  }

  // ---------- Categorie (radiogroup) ----------
  function scegliCategoria(cat, focus) {
    var voci = el.categorie.querySelectorAll('.prop-cat');
    for (var i = 0; i < voci.length; i++) {
      var v = voci[i];
      var attiva = v.getAttribute('data-cat') === cat;
      v.setAttribute('aria-checked', attiva ? 'true' : 'false');
      v.tabIndex = attiva ? 0 : -1;
      if (attiva) {
        categoria = cat;
        if (focus) v.focus();
      }
    }
  }

  function tastoCategoria(e) {
    var voci = Array.prototype.slice.call(el.categorie.querySelectorAll('.prop-cat'));
    var corr = voci.indexOf(document.activeElement);
    if (corr < 0) return;
    var passo = 0;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') passo = 1;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') passo = -1;
    else return;
    e.preventDefault();
    var nuovo = voci[(corr + passo + voci.length) % voci.length];
    scegliCategoria(nuovo.getAttribute('data-cat'), true);
    modificato();
  }

  // ---------- Link ----------
  function righeLink() { return el.linkLista.querySelectorAll('.prop-link-riga'); }

  function rinumeraLink() {
    var righe = righeLink();
    for (var i = 0; i < righe.length; i++) {
      righe[i].querySelector('.prop-link').setAttribute('aria-label', 'Link ' + (i + 1));
    }
    el.linkAggiungi.disabled = righe.length >= MAX_LINK;
  }

  function aggiungiRigaLink(focus) {
    if (righeLink().length >= MAX_LINK) return;
    var riga = document.createElement('div');
    riga.className = 'prop-link-riga';

    var inp = document.createElement('input');
    inp.type = 'url';
    inp.className = 'prop-link';
    inp.placeholder = 'https://…';
    inp.autocomplete = 'off';
    inp.addEventListener('input', modificato);
    // Invio dentro un link non invia il form
    inp.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') e.preventDefault();
    });

    var togli = document.createElement('button');
    togli.type = 'button';
    togli.className = 'prop-link-togli';
    togli.textContent = '×';
    togli.setAttribute('aria-label', 'Rimuovi link');
    togli.addEventListener('click', function () {
      if (righeLink().length <= 1) {
        // Ultima riga: la svuoto soltanto
        inp.value = '';
        inp.focus();
      } else {
        riga.parentNode.removeChild(riga);
        rinumeraLink();
        el.linkAggiungi.focus();
      }
      mostraErrore('');
      modificato();
    });

    riga.appendChild(inp);
    riga.appendChild(togli);
    el.linkLista.appendChild(riga);
    rinumeraLink();
    if (focus) inp.focus();
  }

  // Restituisce {link:[...]} oppure {errore:'...'}
  function raccogliLink() {
    var righe = righeLink();
    var out = [];
    for (var i = 0; i < righe.length; i++) {
      var v = righe[i].querySelector('.prop-link').value.trim();
      if (!v) continue;
      var ok = /^https?:\/\//i.test(v);
      if (ok) {
        try { new URL(v); } catch (err) { ok = false; }
      }
      if (!ok) {
        return { errore: 'Il link ' + (i + 1) + ' non è valido: deve iniziare con http:// o https://' };
      }
      out.push(v);
    }
    return { link: out };
  }

  // ---------- Immagini ----------
  function disegnaAnteprime() {
    el.anteprime.textContent = '';
    immagini.forEach(function (im) {
      var box = document.createElement('div');
      box.className = 'prop-anteprima';
      var img = document.createElement('img');
      img.src = im.dati;
      img.alt = im.nome;
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'prop-togli';
      b.textContent = '×';
      b.setAttribute('aria-label', 'Rimuovi immagine «' + im.nome + '»');
      b.addEventListener('click', function () {
        var pos = immagini.indexOf(im);
        if (pos >= 0) immagini.splice(pos, 1);
        disegnaAnteprime();
        mostraErrore('');
        modificato();
        el.file.focus();
      });
      box.appendChild(img);
      box.appendChild(b);
      el.anteprime.appendChild(box);
    });
  }

  function leggiFile(file) {
    return new Promise(function (risolvi) {
      var fr = new FileReader();
      fr.onload = function () {
        immagini.push({ nome: file.name, tipo: file.type, dati: String(fr.result) });
        risolvi(true);
      };
      fr.onerror = function () { risolvi(false); };
      fr.readAsDataURL(file);
    });
  }

  function aggiungiFile(lista) {
    var file = Array.prototype.slice.call(lista || []);
    if (!file.length) return;
    var errori = [];
    var daLeggere = [];
    file.forEach(function (f) {
      if (TIPI.indexOf(f.type) < 0 || f.size > MAX_BYTE) {
        errori.push('Immagine «' + f.name + '» non accettata: solo png, jpg, webp o gif fino a 4 MB');
        return;
      }
      if (immagini.length + inLettura + daLeggere.length >= MAX_IMMAGINI) {
        if (errori.indexOf('Puoi allegare al massimo 4 immagini') < 0) {
          errori.push('Puoi allegare al massimo 4 immagini');
        }
        return;
      }
      daLeggere.push(f);
    });
    mostraErrore(errori.join('. '));
    if (!daLeggere.length) return;
    modificato();
    inLettura += daLeggere.length;
    daLeggere.forEach(function (f) {
      var p = leggiFile(f).then(function (ok) {
        inLettura--;
        letture = letture.filter(function (x) { return x !== p; });
        if (ok) {
          disegnaAnteprime();
        } else {
          mostraErrore('Impossibile leggere l\'immagine «' + f.name + '»');
        }
      });
      letture.push(p);
    });
  }

  function apriSelettore() { el.file.click(); }

  // ---------- Invio ----------
  function sblocca() {
    inviando = false;
    el.form.classList.remove('invio');
    clearTimeout(timerEsito);
    timerEsito = null;
    aggiornaInvia();
  }

  function scriviEsito(testo, ok) {
    el.esito.textContent = testo;
    el.esito.classList.remove('ok', 'errore');
    el.esito.classList.add(ok ? 'ok' : 'errore');
  }

  function alSubmit(e) {
    e.preventDefault();
    if (inviando) return;
    var titolo = el.titolo.value.trim();
    var testo = el.testo.value.trim();
    if (!titolo || !testo || titolo.length > MAX_TITOLO || testo.length > MAX_TESTO) return;

    var r = raccogliLink();
    if (r.errore) { mostraErrore(r.errore); return; }

    mostraErrore('');
    pulisciEsito();
    inviando = true;
    el.form.classList.add('invio');
    el.invia.disabled = true;

    // Aspetta le letture ancora in corso, poi invia
    Promise.all(letture.slice()).then(function () {
      if (!inviando) return;
      var oggetto = {
        tipo: 'proposta',
        categoria: categoria,
        titolo: titolo,
        testo: testo,
        link: r.link,
        immagini: immagini.map(function (im) {
          return { nome: im.nome, tipo: im.tipo, dati: im.dati };
        })
      };
      // Se l'app non risponde entro 60 secondi sblocco il form
      timerEsito = setTimeout(function () {
        sblocca();
        scriviEsito('L\'app non ha risposto. Riprova.', false);
      }, ATTESA_ESITO_MS);
      try {
        if (typeof inviaFn === 'function') inviaFn(oggetto);
      } catch (err) {
        sblocca();
        scriviEsito('Non è stato possibile inviare la proposta. Riprova.', false);
      }
    });
  }

  // ---------- API pubblica ----------
  function reset() {
    if (!avviato) return;
    el.titolo.value = '';
    el.testo.value = '';
    el.linkLista.textContent = '';
    aggiungiRigaLink(false);
    immagini = [];
    disegnaAnteprime();
    el.file.value = '';
    scegliCategoria(CATEGORIA_DEFAULT, false);
    mostraErrore('');
    aggiornaContatori();
    aggiornaInvia();
  }

  function esito(d) {
    if (!avviato) return;
    d = d || {};
    var ok = d.ok === true;
    sblocca();
    var testo = d.testo ? String(d.testo) :
      (ok ? 'Proposta inviata, grazie!' : 'Non è stato possibile inviare la proposta. Riprova.');
    if (ok) reset();
    scriviEsito(testo, ok);
  }

  function init(invia) {
    inviaFn = invia;
    if (avviato) return;
    el.form = $('form-proposta');
    if (!el.form) return;
    el.categorie = $('prop-categorie');
    el.titolo = $('prop-titolo');
    el.testo = $('prop-testo');
    el.contTitolo = $('prop-contatore-titolo');
    el.contTesto = $('prop-contatore-testo');
    el.linkLista = $('prop-link-lista');
    el.linkAggiungi = $('prop-link-aggiungi');
    el.drop = $('prop-drop');
    el.file = $('prop-file');
    el.scegli = $('prop-scegli');
    el.anteprime = $('prop-anteprime');
    el.errore = $('prop-errore');
    el.invia = $('prop-invia');
    el.esito = $('prop-esito');
    // Se manca un elemento essenziale esco senza errori
    if (!el.categorie || !el.titolo || !el.testo || !el.linkLista || !el.linkAggiungi ||
        !el.file || !el.anteprime || !el.invia) return;
    if (!el.scegli) el.scegli = el.drop || el.file;
    avviato = true;

    // Categorie
    var voci = el.categorie.querySelectorAll('.prop-cat');
    for (var i = 0; i < voci.length; i++) {
      voci[i].addEventListener('click', function (e) {
        scegliCategoria(e.currentTarget.getAttribute('data-cat'), false);
        modificato();
      });
    }
    el.categorie.addEventListener('keydown', tastoCategoria);
    scegliCategoria(CATEGORIA_DEFAULT, false);

    // Titolo e testo
    el.titolo.maxLength = MAX_TITOLO;
    el.testo.maxLength = MAX_TESTO;
    function alInput() {
      aggiornaContatori();
      aggiornaInvia();
      mostraErrore('');
      modificato();
    }
    el.titolo.addEventListener('input', alInput);
    el.testo.addEventListener('input', alInput);

    // Link
    el.linkAggiungi.addEventListener('click', function () { aggiungiRigaLink(true); });
    el.linkLista.textContent = '';
    aggiungiRigaLink(false);

    // Immagini: selettore file
    el.file.addEventListener('change', function () {
      aggiungiFile(el.file.files);
      el.file.value = '';
    });
    el.scegli.addEventListener('click', function (e) {
      // #prop-scegli è una <label for="prop-file">: senza preventDefault il selettore si aprirebbe due volte
      e.preventDefault();
      e.stopPropagation();
      apriSelettore();
    });
    if (el.drop) {
      el.drop.addEventListener('click', apriSelettore);
      el.drop.addEventListener('keydown', function (e) {
        // Il tasto interno #prop-scegli gestisce da solo Invio/Spazio
        if (e.target !== el.drop) return;
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          apriSelettore();
        }
      });
      ['dragenter', 'dragover'].forEach(function (nome) {
        el.drop.addEventListener(nome, function (e) {
          e.preventDefault();
          el.drop.classList.add('sopra');
        });
      });
      el.drop.addEventListener('dragleave', function () { el.drop.classList.remove('sopra'); });
      el.drop.addEventListener('drop', function (e) {
        e.preventDefault();
        el.drop.classList.remove('sopra');
        if (e.dataTransfer) aggiungiFile(e.dataTransfer.files);
      });
    }
    // Un drop fuori dal riquadro non deve aprire il file nella pagina
    window.addEventListener('dragover', function (e) { e.preventDefault(); });
    window.addEventListener('drop', function (e) { e.preventDefault(); });

    el.form.addEventListener('submit', alSubmit);

    aggiornaContatori();
    aggiornaInvia();
  }

  window.Proposte = { init: init, esito: esito, reset: reset };
})();
