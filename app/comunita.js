/* Proposte online (thias 24/10): l'app parla col Worker Cloudflare «gamblemon-proposte".
   - Collegamento: l'app ha un token suo; il giocatore scrive in gioco /collega CODICE.
   - Proponi: il form di proposte.js; qui si rimpiccioliscono le immagini e si invia.
   - Idee della community: approvate e inserite, con like/dislike e commenti.
   - Le mie: lo stato delle proprie proposte; quelle con un consiglio si correggono e si rimandano.
   Notifiche e premi (approvata +100, inserita +1000) arrivano in gioco, dal server. */
(function () {
  'use strict';

  var API = 'https://gamblemon-proposte.proposte-worker.workers.dev';
  var STATI = { attesa: 'In attesa', approvata: 'Approvata', rifiutata: 'Rifiutata', consigliata: 'Da correggere', inserita: 'Nel gioco' };
  var CATEGORIE = { meccaniche: 'Meccaniche', oggetti: 'Oggetti', skin: 'Skin', altro: 'Altro' };
  var MAX_LATO = 1600, MAX_BYTE = 1400000;

  var $ = function (id) { return document.getElementById(id); };
  var token = null, collegato = false, nome = '', mioUuid = '', timerIo = null, scheda = 'proponi';

  function leggiToken() {
    try { token = localStorage.getItem('gm-token'); } catch (e) {}
    if (!token || token.length < 32) {
      var b = new Uint8Array(32);
      crypto.getRandomValues(b);
      token = Array.prototype.map.call(b, function (x) { return ('0' + x.toString(16)).slice(-2); }).join('');
      try { localStorage.setItem('gm-token', token); } catch (e) {}
    }
  }

  function api(percorso, metodo, corpo) {
    return fetch(API + percorso, {
      method: metodo || 'GET',
      headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: corpo ? JSON.stringify(corpo) : undefined
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (d) {
        if (!r.ok) throw new Error(d.errore || 'Errore di rete, riprova.');
        return d;
      });
    }, function () { throw new Error('Non riesco a raggiungere le proposte. Controlla la connessione.'); });
  }

  function el(tag, classe, testo) {
    var e = document.createElement(tag);
    if (classe) e.className = classe;
    if (testo != null) e.textContent = testo;
    return e;
  }

  function quando(t) {
    var s = Math.round((Date.now() - t) / 1000);
    if (s < 60) return 'adesso';
    if (s < 3600) return Math.floor(s / 60) + ' min fa';
    if (s < 86400) return Math.floor(s / 3600) + ' h fa';
    return new Date(t).toLocaleDateString('it-IT', { day: 'numeric', month: 'short' });
  }

  /* ---------- collegamento ---------- */

  function controllaIo() {
    return api('/io').then(function (d) {
      collegato = !!d.collegato;
      nome = d.nome || '';
      mioUuid = d.uuid || '';
      disegnaCollega();
      if (collegato) clearInterval(timerIo);
    }).catch(function () {});
  }

  function nuovoCodice() {
    var c = $('com-codice');
    c.textContent = '…';
    api('/collega', 'POST', { token: token }).then(function (d) {
      c.textContent = d.codice;
      clearInterval(timerIo);
      timerIo = setInterval(controllaIo, 4000);
      // il codice scade dopo 10 minuti: poi si smette di controllare
      setTimeout(function () { clearInterval(timerIo); }, d.scade * 1000);
    }).catch(function (e) { c.textContent = '—'; $('com-collega-errore').textContent = e.message; });
  }

  function disegnaCollega() {
    var box = $('com-collega');
    box.hidden = collegato;
    $('com-chi').textContent = collegato ? 'Collegato come ' + nome : '';
    if (!collegato && $('com-codice').textContent === '') nuovoCodice();
  }

  /* ---------- invio (chiamato dal form di proposte.js) ---------- */

  function rimpicciolisci(im) {
    return new Promise(function (ok) {
      var i = new Image();
      i.onload = function () {
        var lato = Math.max(i.naturalWidth, i.naturalHeight);
        var byte = Math.floor((im.dati.length - im.dati.indexOf(',') - 1) * 3 / 4);
        if (lato <= MAX_LATO && byte <= MAX_BYTE) { ok(im); return; }
        var k = Math.min(1, MAX_LATO / lato), q = 0.85, dati;
        var c = document.createElement('canvas');
        do {
          c.width = Math.round(i.naturalWidth * k);
          c.height = Math.round(i.naturalHeight * k);
          c.getContext('2d').drawImage(i, 0, 0, c.width, c.height);
          dati = c.toDataURL('image/webp', q);
          k *= 0.8; q = Math.max(0.6, q - 0.1);
        } while (dati.length * 0.75 > MAX_BYTE && c.width > 300);
        ok({ nome: im.nome, tipo: 'image/webp', dati: dati });
      };
      i.onerror = function () { ok(im); };
      i.src = im.dati;
    });
  }

  function invia(oggetto) {
    var esito = function (ok, testo) { if (window.Proposte) window.Proposte.esito({ ok: ok, testo: testo }); };
    if (!collegato) { esito(false, 'Prima collega l’app: in gioco scrivi /collega ' + ($('com-codice').textContent || 'CODICE')); return; }
    Promise.all((oggetto.immagini || []).map(rimpicciolisci)).then(function (ims) {
      return api('/proposte', 'POST', { categoria: oggetto.categoria, titolo: oggetto.titolo, testo: oggetto.testo, link: oggetto.link, immagini: ims });
    }).then(function (d) {
      esito(true, d.testo);
    }).catch(function (e) { esito(false, e.message); });
  }

  /* ---------- liste ---------- */

  function immagini(p) {
    if (!p.immagini.length) return null;
    var box = el('div', 'com-imm');
    p.immagini.forEach(function (id) {
      var i = el('img');
      i.loading = 'lazy';
      i.alt = 'Immagine della proposta';
      // le immagini delle proposte non pubbliche si chiedono col token (sono solo dell'autore)
      fetch(API + '/immagini/' + id, { headers: { 'Authorization': 'Bearer ' + token } })
        .then(function (r) { return r.ok ? r.blob() : null; })
        .then(function (b) { if (b) i.src = URL.createObjectURL(b); });
      i.onclick = function () { $('com-grande-img').src = i.src; $('com-grande').hidden = false; };
      box.appendChild(i);
    });
    return box;
  }

  function linkDi(p) {
    if (!p.link.length) return null;
    var box = el('div', 'com-link');
    p.link.forEach(function (u) {
      var a = el('button', 'com-link-voce', u.replace(/^https?:\/\//, ''));
      a.type = 'button';
      a.title = u;
      a.onclick = function () {
        if (window.chrome && window.chrome.webview) window.chrome.webview.postMessage({ tipo: 'apri', url: u });
        else window.open(u, '_blank', 'noopener');
      };
      box.appendChild(a);
    });
    return box;
  }

  // la testa della skin Minecraft (mc-heads.net, dallo UUID del giocatore)
  function faccia(uuid, lato) {
    var i = el('img', 'com-faccia');
    i.width = i.height = lato;
    i.alt = '';
    i.loading = 'lazy';
    i.src = 'https://mc-heads.net/avatar/' + encodeURIComponent(uuid || 'MHF_Steve') + '/' + lato * 2;
    return i;
  }

  function testa(p) {
    var t = el('div', 'com-testa');
    t.appendChild(faccia(p.autoreUuid, 20));
    t.appendChild(el('span', 'com-cat', CATEGORIE[p.categoria] || p.categoria));
    var st = el('span', 'com-stato com-stato-' + p.stato, STATI[p.stato] || p.stato);
    t.appendChild(st);
    t.appendChild(el('span', 'com-autore', p.autore + ' · ' + quando(p.aggiornata)));
    return t;
  }

  function voti(p) {
    var box = el('div', 'com-voti');
    function bottone(valore, simbolo, etichetta) {
      var b = el('button', 'com-voto' + (p.mioVoto === valore ? ' su' : ''));
      b.type = 'button';
      b.setAttribute('aria-label', etichetta);
      b.setAttribute('aria-pressed', p.mioVoto === valore ? 'true' : 'false');
      b.innerHTML = simbolo;
      var n = el('span', null, String(valore === 1 ? p.su : p.giu));
      b.appendChild(n);
      b.onclick = function () {
        if (!collegato) { vai('proponi'); return; }
        var nuovo = p.mioVoto === valore ? 0 : valore;
        api('/proposte/' + p.id + '/voto', 'POST', { valore: nuovo }).then(function (d) {
          p.su = d.su; p.giu = d.giu; p.mioVoto = d.mioVoto;
          box.replaceWith(voti(p));
        }).catch(function (e) { alert(e.message); });
      };
      return b;
    }
    box.appendChild(bottone(1, '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M12 4l8 10h-5v6H9v-6H4z"/></svg>', 'Mi piace'));
    box.appendChild(bottone(-1, '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M12 20L4 10h5V4h6v6h5z"/></svg>', 'Non mi piace'));
    return box;
  }

  function commenti(p) {
    var box = el('div', 'com-commenti');
    var apri = el('button', 'com-apri', p.commenti ? 'Commenti (' + p.commenti + ')' : 'Commenta');
    apri.type = 'button';
    apri.onclick = function () {
      apri.remove();
      var lista = el('div', 'com-lista-commenti');
      box.appendChild(lista);
      api('/proposte/' + p.id + '/commenti').then(function (d) {
        d.commenti.forEach(function (c) {
          var r = el('p', 'com-commento');
          r.appendChild(faccia(c.uuid, 16));
          r.appendChild(el('strong', null, c.nome));
          r.appendChild(document.createTextNode(' ' + c.testo));
          lista.appendChild(r);
        });
      });
      if (!collegato) { box.appendChild(el('p', 'com-nota', 'Collega l’app dalla scheda Proponi per commentare.')); return; }
      var riga = el('div', 'com-scrivi');
      var t = el('input', 'prop-input');
      t.maxLength = 500;
      t.placeholder = 'Scrivi un commento';
      var b = el('button', 'prop-btn-sec', 'Invia');
      b.type = 'button';
      b.onclick = function () {
        if (!t.value.trim()) return;
        b.disabled = true;
        api('/proposte/' + p.id + '/commenti', 'POST', { testo: t.value }).then(function () {
          var r = el('p', 'com-commento');
          r.appendChild(faccia(mioUuid, 16));
          r.appendChild(el('strong', null, nome));
          r.appendChild(document.createTextNode(' ' + t.value.trim()));
          lista.appendChild(r);
          t.value = '';
        }).catch(function (e) { alert(e.message); }).then(function () { b.disabled = false; });
      };
      t.onkeydown = function (e) { if (e.key === 'Enter') b.click(); };
      riga.appendChild(t);
      riga.appendChild(b);
      box.appendChild(riga);
    };
    box.appendChild(apri);
    return box;
  }

  function correggi(p, carta) {
    var f = el('div', 'com-correggi');
    var titolo = el('input', 'prop-input'); titolo.maxLength = 80; titolo.value = p.titolo;
    var testo = el('textarea', 'prop-input prop-area'); testo.maxLength = 2000; testo.rows = 5; testo.value = p.testo;
    var b = el('button', 'prop-invia', 'Rimanda la proposta');
    b.type = 'button';
    var esito = el('p', 'com-nota');
    b.onclick = function () {
      b.disabled = true;
      api('/proposte/' + p.id, 'PUT', { categoria: p.categoria, titolo: titolo.value, testo: testo.value, link: p.link })
        .then(function () { carica(); })
        .catch(function (e) { esito.textContent = e.message; b.disabled = false; });
    };
    f.appendChild(titolo); f.appendChild(testo); f.appendChild(b); f.appendChild(esito);
    carta.appendChild(f);
  }

  function carta(p, mie) {
    var c = el('article', 'com-carta');
    c.appendChild(testa(p));
    c.appendChild(el('h3', 'com-titolo', p.titolo));
    c.appendChild(el('p', 'com-testo', p.testo));
    var l = linkDi(p); if (l) c.appendChild(l);
    var im = immagini(p); if (im) c.appendChild(im);
    if (p.consiglio && p.stato === 'consigliata') {
      c.appendChild(el('p', 'com-consiglio', 'Consiglio di thias: ' + p.consiglio));
      var b = el('button', 'prop-btn-sec', 'Correggi');
      b.type = 'button';
      b.onclick = function () { b.remove(); correggi(p, c); };
      c.appendChild(b);
    }
    if (p.stato === 'approvata' || p.stato === 'inserita') {
      var piede = el('div', 'com-piede');
      piede.appendChild(voti(p));
      c.appendChild(piede);
      if (!mie) c.appendChild(commenti(p));
    }
    return c;
  }

  function carica() {
    var lista = $('com-lista');
    lista.textContent = '';
    if (scheda === 'mie' && !collegato) { lista.appendChild(el('p', 'com-vuoto', 'Collega l’app dalla scheda Proponi per vedere le tue proposte.')); return; }
    lista.appendChild(el('p', 'com-vuoto', 'Carico…'));
    var ordina = $('com-ordina').value;
    api(scheda === 'mie' ? '/proposte/mie' : '/proposte').then(function (d) {
      lista.textContent = '';
      var ps = d.proposte.slice();
      if (scheda === 'idee' && ordina === 'voti') ps.sort(function (a, b) { return (b.su - b.giu) - (a.su - a.giu); });
      if (!ps.length) {
        lista.appendChild(el('p', 'com-vuoto', scheda === 'mie' ? 'Non hai ancora mandato proposte.' : 'Ancora nessuna idea approvata. Proponi la prima!'));
        return;
      }
      ps.forEach(function (p) { lista.appendChild(carta(p, scheda === 'mie')); });
    }).catch(function (e) { lista.textContent = ''; lista.appendChild(el('p', 'com-vuoto errore', e.message)); });
  }

  function vai(s) {
    scheda = s;
    document.querySelectorAll('.com-scheda').forEach(function (b) {
      var su = b.dataset.scheda === s;
      b.classList.toggle('su', su);
      b.setAttribute('aria-selected', su ? 'true' : 'false');
    });
    $('form-proposta').hidden = s !== 'proponi';
    $('com-collega').hidden = s !== 'proponi' || collegato;
    $('com-elenco').hidden = s === 'proponi';
    $('com-ordina').hidden = s !== 'idee';
    if (s !== 'proponi') carica();
  }

  function init() {
    leggiToken();
    var sez = $('sez-proposte');
    if (!sez) return;
    document.querySelectorAll('.com-scheda').forEach(function (b) { b.onclick = function () { vai(b.dataset.scheda); }; });
    $('com-nuovo').onclick = nuovoCodice;
    $('com-ordina').onchange = carica;
    $('com-grande').onclick = function () { this.hidden = true; };
    controllaIo();
    vai('proponi');
  }

  window.Comunita = { invia: invia };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
