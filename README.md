# PlayStation Store Scraper

Web scraper za izvlačenje cena igrica sa Sony PlayStation Store sajta.

## Instalacija

1. Instaliraj dependencies:
```bash
npm install
```

## Korišćenje

### Scrapovanje igara iz fajla (Preporučeno)

1. Otvori `games.txt` fajl i dodaj URL-ove igara koje želiš da scrape-uješ (jedan URL po liniji):
```
https://store.playstation.com/en-rs/product/EP0001-CUSA12345_00-EXAMPLEGAME001
https://store.playstation.com/en-rs/product/EP0002-CUSA67890_00-EXAMPLEGAME002
```

2. Pokreni scraper:
```bash
npm start
```

Scraper će automatski pročitati URL-ove iz `games.txt` i scrape-ovati detalje svake igre.

### Osnovno korišćenje (bez fajla)

Ako `games.txt` ne postoji ili je prazan, scraper će pokušati da scrape-uje popularne igre:
```bash
npm start
```

### Programski pristup

```javascript
const PlayStationScraper = require('./index.js');

async function scrapeGames() {
    const scraper = new PlayStationScraper();
    
    try {
        await scraper.init();
        
        // Scrapovanje igara iz fajla
        const games = await scraper.scrapeGamesFromFile('games.txt', 2000);
        console.log(games);
        
        // Scrapovanje detalja konkretne igre
        const details = await scraper.scrapeGameDetails('https://store.playstation.com/en-rs/product/...');
        console.log(details);
        
        // Scrapovanje igara po pretrazi
        const searchResults = await scraper.scrapeGamePrices('FIFA', 'games', 10);
        console.log(searchResults);
        
        // Čuvanje u fajl
        await scraper.saveToFile(games, 'my-games.json');
        
    } catch (error) {
        console.error('Greška:', error);
    } finally {
        await scraper.close();
    }
}

scrapeGames();
```

## Metode

### `scrapeGamePrices(searchTerm, category, limit)`
Scrapuje liste igara sa PlayStation Store.

- `searchTerm` (string, opciono): Termin za pretragu
- `category` (string, default: 'games'): Kategorija za scrapovanje
- `limit` (number, default: 20): Maksimalan broj igara za izvlačenje

Vraća: Array objekata sa `title`, `price`, `link`, `image`

### `scrapeGameDetails(gameUrl)`
Scrapuje detaljne informacije o konkretnoj igri.

- `gameUrl` (string): URL igre na PlayStation Store

Vraća: Objekat sa `url`, `title`, `price`, `originalPrice`, `discount`, `description`, `rating`, `scrapedAt`

### `readUrlsFromFile(filename)`
Čita URL-ove iz tekstualnog fajla.

- `filename` (string, default: 'games.txt'): Ime fajla sa URL-ovima

Vraća: Array URL-ova

### `scrapeGamesFromFile(filename, delayBetweenRequests)`
Scrapuje sve igre čiji su URL-ovi u fajlu.

- `filename` (string, default: 'games.txt'): Ime fajla sa URL-ovima
- `delayBetweenRequests` (number, default: 2000): Kašnjenje između zahteva u milisekundama

Vraća: Array objekata sa detaljima igara

### `saveToFile(data, filename)`
Čuva podatke u JSON fajl.

- `data` (object/array): Podaci za čuvanje
- `filename` (string, default: 'playstation-games.json'): Ime fajla

## Napomene

- PlayStation Store koristi JavaScript za renderovanje sadržaja, pa je potreban Puppeteer
- Struktura sajta se može promeniti, pa možda bude potrebno ažurirati selektore
- Poštujte rate limiting i terms of service PlayStation Store-a
- Za produkciju, razmotrite korišćenje službenog PlayStation Store API-ja
- Neke igre mogu biti nedostupne u određenim regionima (geografsko ograničenje)
- Scraper koristi više metoda za izvlačenje podataka (CSS selektori, meta tagovi, JSON-LD, regex)
- Ako cena nije pronađena, scraper će automatski pokušati ponovo sa dodatnim čekanjem

## Format fajla games.txt

Fajl `games.txt` može sadržati:
- URL-ove igara (jedan po liniji)
- Komentare (linije koje počinju sa `#`)
- Prazne linije (ignorišu se)

Primer:
```
# Moje omiljene igre
https://store.playstation.com/en-rs/product/EP0001-CUSA12345_00-GAME1
https://store.playstation.com/en-rs/product/EP0002-CUSA67890_00-GAME2

# Dodatne igre
https://store.playstation.com/en-rs/product/EP0003-CUSA11111_00-GAME3
```

### Kako pronaći URL-ove igara?

1. Otvori PlayStation Store u browseru: https://store.playstation.com
2. Pronađi igru koju želiš
3. Kopiraj URL iz browser adresne trake
4. Dodaj URL u `games.txt` fajl

## Rezultat

- Ako koristiš `games.txt`: Scraper će kreirati `scraped-games.json` fajl sa detaljima svih igara.
- Ako ne koristiš `games.txt`: Scraper će kreirati `playstation-games.json` fajl sa podacima o igrama.

## Zahtevi

- Node.js 14 ili noviji
- npm ili yarn

## Dependencies

- `puppeteer`: Za kontrolu headless browsera
- `cheerio`: Za parsiranje HTML-a (dodatna podrška)
