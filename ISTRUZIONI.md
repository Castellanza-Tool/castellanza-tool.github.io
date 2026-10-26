# Pagina cantieri – come si aggiorna

Pagina pubblica: https://castellanza-tool.github.io/
Incorporata nel sito del Comune di Castellanza con un iframe.

Tutto il contenuto sta in `dati.json`. La pagina lo rilegge ogni minuto, quindi basta modificare il file e fare commit su `main`. GitHub Pages lo pubblica in circa un minuto.

## Procedura (per Claude)

1. Stefano manda l'informazione: una mail degli uffici, un'ordinanza, un appunto.
2. Si scrive un avviso chiaro per i cittadini e lo si aggiunge in cima ad `aggiornamenti`. Deve dire cosa cambia, dove, da quando, per chi e qual è l'alternativa.
3. Si aggiorna `settings.situazioneOggi` se cambia la situazione del giorno (stringa vuota = riquadro nascosto).
4. Si aggiorna lo `stato` dei tratti: `programmato`, `in_corso` oppure `concluso`.
5. Si aggiorna `aggiornatoIl` con l'ora attuale in formato ISO. È il valore che fa ridisegnare la pagina ai visitatori.
6. Si valida il JSON, si fa commit e push, e si restituisce a Stefano il testo pronto per WhatsApp.

## Regole

- Si pubblica solo ciò che è scritto nell'informazione ricevuta. Niente date, orari o percorsi dedotti.
- Se manca qualcosa di essenziale, o se una misura risulta solo proposta e non confermata, si chiede prima di pubblicare.
- `inEvidenza: true` va solo sull'avviso più importante del momento. Quando viene superato, si toglie dal precedente.
- `tipo` può essere `viabilita`, `avviso`, `urgente` oppure `concluso`.
- Sulla gestione del traffico e la sicurezza del cantiere si resta generici (es. "il traffico all'incrocio è regolato da personale addetto"), senza nominare uffici o comandi comunali.
- Un tratto può avere `inCorsoDal`/`inCorsoAl` (YYYY-MM-DD): in quei giorni la mappa lo mostra in corso (rosso), negli altri giorni con il suo `stato` normale. `dal`/`al` invece fanno sparire il tratto fuori dalle date: usarli solo per tratti temporanei creati apposta per una fase.
- Tratti e percorsi possono avere `sospesoDal`/`sospesoAl` (YYYY-MM-DD): in quei giorni spariscono dalla mappa (cantiere sospeso, strada riaperta) e poi tornano da soli. Vale anche per le voci di `settings.situazioni`. Una voce di `situazioni` può avere `introduzione`: sostituisce `settings.introduzione` nei suoi giorni (stringa vuota = nessuna introduzione).
- `coords` dei tratti: un elenco di [lat, lng] lungo la strada. Se è vuoto, la mappa resta nascosta.
- Nei testi di introduzione e situazioni `**testo**` viene mostrato in neretto. Una voce di `situazioni` con `testo` vuoto nasconde il riquadro "Come cambia la viabilità".
- Aggiornamento automatico del programma: quando cambiano `app.js` o `style.css`, usare lo stesso nuovo numero in tre punti: `?v=` in `index.html`, `VERSIONE` in `app.js` e `settings.versioneApp` in `dati.json`. Le pagine già aperte (anche nell'iframe del Comune) vedono il numero nuovo nei dati e si ricaricano da sole.
