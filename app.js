(function () {
  'use strict';
  var CENTRO = [45.6105, 8.8975]; // Castellanza
  var COLORI = { in_corso: '#dc2626', programmato: '#64748b', concluso: '#15803d' };
  var ETICHETTE_STATO = { in_corso: 'Cantiere in corso', programmato: 'Lavori in programma', concluso: 'Lavori conclusi' };
  var ETICHETTE_TIPO = { viabilita: 'Viabilità', avviso: 'Avviso', urgente: 'Urgente', concluso: 'Concluso' };
  var REFRESH_MS = 60000;
  var ant = new URLSearchParams(location.search).get('anteprima');
  var FILE_DATI = ant && /^[a-z0-9]{4,20}$/.test(ant) ? 'anteprima-' + ant + '.json' : 'dati.json';

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

  function $(id) { return document.getElementById(id); }
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
    $('sottotitolo').textContent = s.sottotitolo || '';
    $('stamp').textContent = 'Ultimo aggiornamento: ' + fmtData(d.aggiornatoIl, true);
    document.title = (s.titolo || 'Cantieri') + ' – Comune di Castellanza';

    if (s.situazioneOggi) { $('oggi').hidden = false; $('oggiTesto').innerHTML = paragrafi(s.situazioneOggi); }
    else { $('oggi').hidden = true; }

    var ev = d.aggiornamenti.filter(function (a) { return a.inEvidenza || a.tipo === 'urgente'; });
    $('evidenza').innerHTML = ev.length ? '<h2>In evidenza</h2>' + ev.map(function (a) { return card(a, d.tratti, true); }).join('') : '';

    // Mappa
    livello.clearLayers(); linee = {};
    var bounds = [];
    var sopra = { programmato: 0, concluso: 1, in_corso: 2 };
    var tratti = d.tratti.slice().sort(function (a, b) { return sopra[a.stato] - sopra[b.stato]; });
    // 1) tracciato completo tratteggiato sotto a tutto
    tratti.forEach(function (t) {
      if (!t.coords || t.coords.length < 2) return;
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
    percorsi.forEach(function (p) {
      var pl = L.polyline(p.linee || p.coords, { color: p.colore, weight: 5, opacity: .8 })
        .bindPopup('<strong>' + esc(p.titolo) + '</strong>');
      pl.addTo(livello); pl.bringToBack(); linee['perc-' + p.id] = pl;
      (p.linee || [p.coords]).forEach(function (l) { bounds = bounds.concat(l); });
    });
    $('percorsi').innerHTML = percorsi.length ? '<h3>Percorsi alternativi consigliati</h3>' + percorsi.map(function (p) {
      var ind = (p.indicazioni || []).map(function (dir) {
        return '<div class="direzione"><h4>' + esc(dir.titolo) + '</h4><ol class="passi">' + dir.passi.map(function (x) {
          return '<li><span>' + esc(x.testo) + '</span>' + (x.distanza ? '<span class="dist">' + esc(x.distanza) + '</span>' : '') + '</li>';
        }).join('') + '</ol>' +
          (dir.mappa && /^https:\/\/www\.google\.com\/maps\//.test(dir.mappa)
            ? '<a class="btn-maps" style="background:' + esc(p.colore) + '" href="' + esc(dir.mappa) + '" target="_blank" rel="noopener">Apri il percorso in Google Maps</a>' : '') +
          '</div>';
      }).join('');
      return '<div class="percorso"><span class="sw-p" style="background:' + esc(p.colore) + '"></span><div class="percorso-corpo">' +
        '<button type="button" class="link-tratto tit" data-tratto="perc-' + esc(p.id) + '">' + esc(p.titolo) + '</button>' +
        (p.testo ? paragrafi(p.testo) : '') + '<div class="direzioni">' + ind + '</div></div></div>';
    }).join('') : '';
    // legenda dentro la mappa
    var voci = ['<div><span class="lg tratteggio"></span>Tracciato completo dei lavori</div>'];
    if (d.tratti.some(function (t) { return t.stato === 'in_corso'; })) voci.push('<div><span class="lg" style="background:' + COLORI.in_corso + '"></span>Cantiere in corso</div>');
    if (d.tratti.some(function (t) { return t.stato === 'concluso'; })) voci.push('<div><span class="lg" style="background:' + COLORI.concluso + '"></span>Lavori conclusi</div>');
    percorsi.forEach(function (p) { voci.push('<div><span class="lg" style="background:' + esc(p.colore) + '"></span>' + esc(p.etichetta || 'Percorso alternativo consigliato') + '</div>'); });
    legendaMappa.getContainer().innerHTML = voci.join('');
    var conLinee = bounds.length > 0;
    $('map').style.display = conLinee ? '' : 'none';
    document.querySelector('#mappaBox h2').textContent = conLinee ? 'Dove sono i cantieri' : 'Le strade interessate dai lavori';
    if (conLinee) map.invalidateSize();
    $('notaMappa').textContent = conLinee ? (s.notaMappa || '') : '';
    if (primoFit && bounds.length) { map.fitBounds(bounds, { padding: [24, 24] }); primoFit = false; }

    var ordine = { in_corso: 0, programmato: 1, concluso: 2 };
    $('legenda').innerHTML = d.tratti.slice().sort(function (a, b) { return ordine[a.stato] - ordine[b.stato]; }).map(function (t) {
      return '<li><span class="sw ' + esc(t.stato) + '"></span><span>' +
        (linee[t.id] ? '<button type="button" class="link-tratto" data-tratto="' + esc(t.id) + '">' + esc(t.nome) + '</button>' : esc(t.nome)) +
        ' <span class="stato">· ' + esc(ETICHETTE_STATO[t.stato]) + '</span></span></li>';
    }).join('');

    // Filtro
    var sel = $('filtroTratto'); var cur = sel.value;
    sel.innerHTML = '<option value="">Tutte le strade</option>' + d.tratti.map(function (t) {
      return '<option value="' + esc(t.id) + '">' + esc(t.nome) + '</option>';
    }).join('');
    sel.value = cur;
    renderLista();

    $('contatti').innerHTML = s.contatti ? paragrafi(s.contatti) : '';
    inviaAltezza();
  }

  function renderLista() {
    var d = datiCorrenti; if (!d) return;
    var f = $('filtroTratto').value;
    var lista = d.aggiornamenti.filter(function (a) { return !f || a.trattoId === f; });
    $('lista').innerHTML = lista.length ? lista.map(function (a) { return card(a, d.tratti, false); }).join('') :
      '<p class="vuoto">Nessun aggiornamento per questa strada.</p>';
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
    } else {
      $('filtroTratto').value = id; renderLista();
    }
  });
  $('filtroTratto').addEventListener('change', renderLista);

  // Altezza automatica dell'iframe nel sito del Comune
  function inviaAltezza() {
    if (window.parent === window) return;
    var h = document.documentElement.scrollHeight;
    window.parent.postMessage({ tipo: 'cantiere-live-altezza', altezza: h }, '*');
  }
  window.addEventListener('resize', inviaAltezza);

  function carica() {
    fetch(FILE_DATI + '?t=' + Date.now(), { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (d) {
      if (d.aggiornatoIl === ultimaVersione && oggiRoma() === giornoMostrato) return;
      ultimaVersione = d.aggiornatoIl;
      render(d);
      if (location.hash && primoCaricamento) {
        var el = document.querySelector(location.hash);
        if (el) el.scrollIntoView();
      }
      primoCaricamento = false;
    }).catch(function () {
      $('stamp').textContent = 'Connessione assente: i dati potrebbero non essere aggiornati';
    });
  }
  var primoCaricamento = true;
  carica();
  setInterval(carica, REFRESH_MS);
  document.addEventListener('visibilitychange', function () { if (!document.hidden) carica(); });
})();
