(function () {
  'use strict';
  var CENTRO = [45.6105, 8.8975]; // Castellanza
  var COLORI = { in_corso: '#dc2626', programmato: '#64748b', concluso: '#15803d' };
  var ETICHETTE_STATO = { in_corso: 'Cantiere in corso', programmato: 'Lavori in programma', concluso: 'Lavori conclusi' };
  var ETICHETTE_TIPO = { viabilita: 'Viabilità', avviso: 'Avviso', urgente: 'Urgente', concluso: 'Concluso' };
  var REFRESH_MS = 60000;
  var FILE_DATI = 'dati.json';

  var map = L.map('map', { scrollWheelZoom: true }).setView(CENTRO, 15);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19, attribution: '&copy; contributori OpenStreetMap'
  }).addTo(map);
  var livello = L.layerGroup().addTo(map);
  var legendaMappa = L.control({ position: 'bottomleft' });
  legendaMappa.onAdd = function () { var div = L.DomUtil.create('div', 'legenda-mappa'); L.DomEvent.disableClickPropagation(div); return div; };
  legendaMappa.addTo(map);
  var linee = {};
  var ultimaVersione = null;
  var datiCorrenti = null;
  var primoFit = true;

  var finto = document.createElement('div');
  function $(id) { return document.getElementById(id) || finto; } // un elemento mancante non blocca la pagina
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function paragrafi(t) {
    return esc(t).split(/\n{2,}/).map(function (p) { return '<p>' + p.replace(/\n/g, '<br>') + '</p>'; }).join('');
  }
  function fmtData(iso, conOra) {
    var d = new Date(iso);
    var opt = { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Rome' };
    if (conOra) { opt.hour = '2-digit'; opt.minute = '2-digit'; }
    return d.toLocaleString('it-IT', opt);
  }

  function card(a, tratti, evidenza) {
    var t = tratti.filter(function (x) { return x.id === a.trattoId; })[0];
    var cls = 'card' + (a.tipo === 'urgente' ? ' urgente' : (evidenza ? ' hl' : ''));
    return '<article class="' + cls + '" id="agg-' + esc(a.id) + '">' +
      '<div class="meta"><span class="tag ' + esc(a.tipo) + '">' + esc(ETICHETTE_TIPO[a.tipo] || a.tipo) + '</span>' +
      '<time datetime="' + esc(a.data) + '">' + esc(fmtData(a.data, true)) + '</time>' +
      (t ? '<button type="button" class="link-tratto" data-tratto="' + esc(t.id) + '">' + esc(t.nome) + '</button>' : '') +
      '</div><h3>' + esc(a.titolo) + '</h3>' + paragrafi(a.testo) + '</article>';
  }

  function oggiRoma() {
    var p = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    return p; // YYYY-MM-DD
  }
  function attivo(x, oggi) { return (!x.dal || oggi >= x.dal) && (!x.al || oggi <= x.al); }
  var giornoMostrato = null;
  var lineeSpostate = [];
  function spostaLinea(coords, px) {
    var pts = coords.map(function (c) { return map.latLngToLayerPoint(c); });
    return pts.map(function (p, i) {
      var a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
      var dx = b.x - a.x, dy = b.y - a.y, len = Math.sqrt(dx * dx + dy * dy) || 1;
      return map.layerPointToLatLng(L.point(p.x - dy / len * px, p.y + dx / len * px));
    });
  }
  function aggiornaSpostate() {
    lineeSpostate.forEach(function (s) { s.layer.setLatLngs(spostaLinea(s.coords, s.px)); });
  }
  map.on('zoomend', aggiornaSpostate);
  function render(dOrig) {
    var oggi = oggiRoma(); giornoMostrato = oggi;
    var d = Object.assign({}, dOrig);
    d.tratti = (dOrig.tratti || []).filter(function (t) { return attivo(t, oggi); }).map(function (t) {
      if ((t.inCorsoDal || t.inCorsoAl) && attivo({ dal: t.inCorsoDal, al: t.inCorsoAl }, oggi)) return Object.assign({}, t, { stato: 'in_corso' });
      return t;
    });
    d.percorsi = (dOrig.percorsi || []).filter(function (p) { return attivo(p, oggi); });
    d.settings = Object.assign({}, dOrig.settings);
    var sit = (d.settings.situazioni || []).filter(function (x) { return attivo(x, oggi); })[0];
    if (sit) d.settings.situazioneOggi = sit.testo;
    d.aggiornamenti = (dOrig.aggiornamenti || []).map(function (a) {
      return (a.evidenzaAl && oggi > a.evidenzaAl) ? Object.assign({}, a, { inEvidenza: false }) : a;
    });
    datiCorrenti = d;
    var s = d.settings || {};
    $('titolo').textContent = s.titolo || '';
    $('stamp').textContent = 'Ultimo aggiornamento: ' + fmtData(d.aggiornatoIl, true);
    document.title = (s.titolo || 'Cantieri') + ' – Comune di Castellanza';

    if (s.introduzione) { $('presentazione').hidden = false; $('presTesto').innerHTML = paragrafi(s.introduzione); }
    else { $('presentazione').hidden = true; }
    if (s.situazioneOggi) { $('oggi').hidden = false; $('oggiTesto').innerHTML = paragrafi(s.situazioneOggi); }
    else { $('oggi').hidden = true; }

    // Mappa
    livello.clearLayers(); linee = {};
    var bounds = [];
    var sopra = { programmato: 0, concluso: 1, in_corso: 2 };
    var tratti = d.tratti.slice().sort(function (a, b) { return sopra[a.stato] - sopra[b.stato]; });
    // 1) tracciato completo tratteggiato sotto a tutto
    tratti.forEach(function (t) {
      if (!t.coords || t.coords.length < 2 || t.stato !== 'programmato') return;
      L.polyline(t.coords, { color: COLORI.programmato, weight: 5, opacity: .9, dashArray: '8 8', interactive: false }).addTo(livello);
    });
    // 2) tratti conclusi e in corso sopra il tratteggio
    tratti.forEach(function (t) {
      if (!t.coords || !t.coords.length) return;
      var popup = '<strong>' + esc(t.nome) + '</strong><br>' + esc(ETICHETTE_STATO[t.stato]) + (t.note ? '<br>' + esc(t.note) : '');
      var colore = COLORI[t.stato] || COLORI.programmato;
      var pl;
      if (t.coords.length === 1) {
        pl = L.circleMarker(t.coords[0], { radius: 12, color: '#fff', weight: 3, fillColor: colore, fillOpacity: 1 });
      } else if (t.stato === 'programmato') {
        pl = L.polyline(t.coords, { color: colore, weight: 14, opacity: 0 }); // area cliccabile sul tratteggio
      } else {
        pl = L.polyline(t.coords, { color: colore, weight: 8, opacity: .95 });
      }
      pl.bindPopup(popup).addTo(livello); linee[t.id] = pl;
      bounds = bounds.concat(t.coords);
    });
    // 3) percorsi alternativi consigliati, sotto al cantiere
    var percorsi = d.percorsi || [];
    lineeSpostate = [];
    percorsi.forEach(function (p) {
      var tutte = p.linee || [p.coords];
      var off = p.offsetLinee || [];
      var normali = [], spostate = [];
      tutte.forEach(function (l, i) { if (off[i]) spostate.push({ coords: l, px: off[i] }); else normali.push(l); });
      var pl = L.polyline(normali, { color: p.colore, weight: 5, opacity: .8 })
        .bindPopup('<strong>' + esc(p.titolo) + '</strong>');
      pl.addTo(livello); pl.bringToBack(); linee['perc-' + p.id] = pl;
      spostate.forEach(function (s) {
        var ls = L.polyline(s.coords, { color: p.colore, weight: 5, opacity: .9 }).bindPopup('<strong>' + esc(p.titolo) + '</strong>');
        ls.addTo(livello);
        lineeSpostate.push({ layer: ls, coords: s.coords, px: s.px });
      });
      (p.linee || [p.coords]).forEach(function (l) { bounds = bounds.concat(l); });
    });
    var pulsanti = [];
    percorsi.forEach(function (p) {
      (p.indicazioni || []).forEach(function (dir) {
        if (dir.mappa && /^https:\/\/www\.google\.com\/maps\//.test(dir.mappa)) {
          pulsanti.push('<a class="btn-maps" style="background:' + esc(p.colore) + '" href="' + esc(dir.mappa) + '" target="_blank" rel="noopener">' + esc(dir.titolo) + '</a>');
        }
      });
    });
    $('percorsi').innerHTML = pulsanti.length ? '<h2>Percorsi alternativi: apriteli in Google Maps</h2><div class="pulsanti">' + pulsanti.join('') + '</div>' : '';
    // legenda dentro la mappa
    var voci = [];
    if (d.tratti.some(function (t) { return t.stato === 'programmato'; })) voci.push('<div><span class="lg tratteggio"></span>Tracciato completo dei lavori</div>');
    var inCorso = d.tratti.filter(function (t) { return t.stato === 'in_corso'; });
    if (inCorso.length) voci.push('<div><span class="lg" style="background:' + COLORI.in_corso + '"></span>' + esc(inCorso[0].legenda || 'Cantiere in corso') + '</div>');
    if (d.tratti.some(function (t) { return t.stato === 'concluso'; })) voci.push('<div><span class="lg" style="background:' + COLORI.concluso + '"></span>Lavori conclusi</div>');
    percorsi.forEach(function (p) { voci.push('<div><span class="lg" style="background:' + esc(p.colore) + '"></span>' + esc(p.etichetta || 'Percorso alternativo consigliato') + '</div>'); });
    legendaMappa.getContainer().innerHTML = voci.join('');
    var conLinee = bounds.length > 0;
    $('map').style.display = conLinee ? '' : 'none';
    if (conLinee) map.invalidateSize();
    $('notaMappa').textContent = conLinee ? (s.notaMappa || '') : '';
    if (primoFit && bounds.length) { map.fitBounds(bounds, { padding: [24, 24] }); primoFit = false; }
    aggiornaSpostate();

    $('contatti').innerHTML = s.contatti ? paragrafi(s.contatti) : '';
    inviaAltezza();
  }

  document.addEventListener('click', function (e) {
    var b = e.target.closest('[data-tratto]'); if (!b) return;
    var id = b.getAttribute('data-tratto');
    if (linee[id]) {
      if (linee[id].getBounds) map.fitBounds(linee[id].getBounds(), { padding: [30, 30], maxZoom: 17 });
      else map.setView(linee[id].getLatLng(), 17);
      linee[id].openPopup();
      $('map').scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  });

  // Altezza automatica dell'iframe nel sito del Comune
  function inviaAltezza() {
    if (window.parent === window) return;
    var h = document.documentElement.scrollHeight;
    window.parent.postMessage({ tipo: 'cantiere-live-altezza', altezza: h }, '*');
  }
  window.addEventListener('resize', inviaAltezza);

  function carica() {
    fetch(FILE_DATI + '?t=' + Date.now(), { cache: 'no-store' }).then(function (r) { if (!r.ok) throw { attesa: true }; return r.json(); }).then(function (d) {
      if (d.aggiornatoIl === ultimaVersione && oggiRoma() === giornoMostrato) return;
      ultimaVersione = d.aggiornatoIl;
      try { render(d); mostrato = true; }
      catch (err) { ultimaVersione = null; avviso('Non riusciamo a mostrare gli aggiornamenti. Ricaricate la pagina tra qualche istante.'); return; }
      if (location.hash && primoCaricamento) {
        var el = document.querySelector(location.hash);
        if (el) el.scrollIntoView();
      }
      primoCaricamento = false;
    }).catch(function (e) {
      if (e && e.attesa && FILE_DATI !== 'dati.json') {
        $('stamp').textContent = 'Anteprima in preparazione: la pagina si aggiorna da sola appena è pronta (di solito due-quattro minuti).';
        setTimeout(carica, 15000);
        return;
      }
      avviso(mostrato ? 'Connessione assente: i dati potrebbero non essere aggiornati' : 'Non riusciamo a caricare gli aggiornamenti. Controllate la connessione e ricaricate la pagina.');
    });
  }
  var primoCaricamento = true;
  var mostrato = false;
  function avviso(t) { var el = $('stamp'); el.textContent = t; }
  // se dopo 12 secondi non è comparso nulla, lo diciamo invece di lasciare "Caricamento…"
  setTimeout(function () {
    if (!mostrato && FILE_DATI === 'dati.json') avviso('Il caricamento sta richiedendo più del previsto. Ricaricate la pagina.');
  }, 12000);
  carica();
  setInterval(carica, REFRESH_MS);
  document.addEventListener('visibilitychange', function () { if (!document.hidden) carica(); });
})();
