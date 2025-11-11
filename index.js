const puppeteer = require('puppeteer');
const fs = require('fs').promises;

class PlayStationScraper {
    constructor() {
        this.browser = null;
        this.page = null;
        this.baseUrl = 'https://store.playstation.com';
    }

    async init() {
        console.log('Pokretanje browsera...');
        try {
            this.browser = await puppeteer.launch({
                headless: "new",
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage'
                ],
                ignoreHTTPSErrors: true,
                timeout: 60000
            });
            
            this.page = await this.browser.newPage();
            
            // Postavi user agent da izgleda kao pravi browser
            await this.page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
            
            // Postavi viewport
            await this.page.setViewport({ width: 1920, height: 1080 });
            
            console.log('Browser uspešno pokrenut!');
        } catch (error) {
            console.error('Greška pri pokretanju browsera:', error.message);
            throw error;
        }
    }

    async scrapeGamePrices(searchTerm = '', category = 'games', limit = 20) {
        try {
            console.log(`Pretraga za: ${searchTerm || 'sve igre'}...`);
            
            // Konstruiši URL za PlayStation Store
            let url = `${this.baseUrl}/en-rs/category/${category}`;
            if (searchTerm) {
                url = `${this.baseUrl}/en-rs/search/${encodeURIComponent(searchTerm)}`;
            }

            console.log(`Pristupanje URL-u: ${url}`);
            await this.page.goto(url, { 
                waitUntil: 'networkidle2',
                timeout: 30000 
            });

            // Sačekaj da se učitaju igre
            await new Promise(resolve => setTimeout(resolve, 3000));

            // Izvuci podatke o igrama
            const games = await this.page.evaluate((limit) => {
                const gameElements = document.querySelectorAll('a[href*="/product/"]');
                const results = [];
                
                gameElements.forEach((element, index) => {
                    if (index >= limit) return;
                    
                    try {
                        // Pokušaj da nađeš naziv igre
                        const titleElement = element.querySelector('span[data-qa*="title"], h3, .product-title, [class*="title"]');
                        const title = titleElement ? titleElement.innerText.trim() : 'N/A';
                        
                        // Pokušaj da nađeš cenu
                        const priceElement = element.querySelector('span[data-qa*="price"], .price, [class*="price"]');
                        const price = priceElement ? priceElement.innerText.trim() : 'N/A';
                        
                        // Pokušaj da nađeš link
                        const link = element.href || 'N/A';
                        
                        // Pokušaj da nađeš sliku
                        const imageElement = element.querySelector('img');
                        const image = imageElement ? imageElement.src : 'N/A';
                        
                        if (title !== 'N/A' && price !== 'N/A') {
                            results.push({
                                title,
                                price,
                                link,
                                image
                            });
                        }
                    } catch (error) {
                        console.error('Greška pri ekstrakciji podataka:', error);
                    }
                });
                
                return results;
            }, limit);

            // Ukloni duplikate
            const uniqueGames = games.filter((game, index, self) =>
                index === self.findIndex((g) => g.title === game.title)
            );

            return uniqueGames;
        } catch (error) {
            console.error('Greška pri scrapovanju:', error.message);
            throw error;
        }
    }

    // Helper funkcija za sigurno izvršavanje evaluate operacija
    async safeEvaluate(fn, retries = 3) {
        for (let i = 0; i < retries; i++) {
            try {
                // Proveri da li je page još uvek validan
                if (!this.page) {
                    throw new Error('Page is null');
                }
                
                try {
                    if (this.page.isClosed()) {
                        throw new Error('Page is closed');
                    }
                } catch (closedError) {
                    // Ako isClosed() baca grešku, page je verovatno detached
                    if (i < retries - 1) {
                        console.log(`  ⚠️  Page problem detektovan, pokušavam ponovo (${i + 1}/${retries})...`);
                        await new Promise(resolve => setTimeout(resolve, 1000));
                        continue;
                    }
                    throw new Error('Page is closed or detached');
                }
                
                // Pokušaj da izvršiš funkciju
                return await this.page.evaluate(fn);
            } catch (error) {
                const errorMessage = error.message || error.toString() || '';
                
                // Ako je greška zbog detached frame-a, pokušaj ponovo
                if (errorMessage.includes('detached') || 
                    errorMessage.includes('Frame') || 
                    errorMessage.includes('Target closed') ||
                    errorMessage.includes('Execution context was destroyed') ||
                    errorMessage.includes('Session closed')) {
                    if (i < retries - 1) {
                        console.log(`  ⚠️  Detached frame detektovan, pokušavam ponovo (${i + 1}/${retries})...`);
                        // Sačekaj malo pre ponovnog pokušaja
                        await new Promise(resolve => setTimeout(resolve, 1500));
                        
                        // Pokušaj da osvežiš stranicu ako je moguće
                        try {
                            if (this.page && !this.page.isClosed()) {
                                await this.page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
                                await new Promise(resolve => setTimeout(resolve, 2000));
                            }
                        } catch (reloadError) {
                            // Ako reload ne uspe, pokušaj ponovo sa evaluate
                        }
                        continue;
                    }
                }
                
                // Ako nije detached frame greška ili su potrošeni svi retry-ovi, baci grešku
                if (i === retries - 1) {
                    throw error;
                }
            }
        }
    }

    async scrapeGameDetails(gameUrl) {
        try {
            let retryCount = 0;
            const maxRetries = 2;
            
            while (retryCount <= maxRetries) {
                try {
                    console.log(`Učitavanje detalja za: ${gameUrl}${retryCount > 0 ? ` (pokušaj ${retryCount + 1})` : ''}`);
                    
                    // Navigate to the page sa boljim error handling-om
                    try {
                        await this.page.goto(gameUrl, { 
                            waitUntil: 'domcontentloaded',
                            timeout: 60000 
                        });
                    } catch (navError) {
                        const errorMsg = navError.message || navError.toString();
                        if (errorMsg.includes('detached') || errorMsg.includes('Target closed') || errorMsg.includes('Frame')) {
                            // Ako je page zatvoren, kreiraj novi
                            if (retryCount < maxRetries) {
                                console.log('  ⚠️  Page zatvoren, kreiram novi...');
                                try {
                                    if (this.page && !this.page.isClosed()) {
                                        await this.page.close();
                                    }
                                } catch (e) {
                                    // Ignoriši greške pri zatvaranju
                                }
                                this.page = await this.browser.newPage();
                                await this.page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
                                await this.page.setViewport({ width: 1920, height: 1080 });
                                retryCount++;
                                await new Promise(resolve => setTimeout(resolve, 1000));
                                continue;
                            }
                        }
                        throw navError;
                    }

                    // Sačekaj da se stranica potpuno učita
                    await new Promise(resolve => setTimeout(resolve, 3000));
                    
                    // Wait for network to be idle
                    try {
                        await this.page.waitForLoadState?.('networkidle') || await new Promise(resolve => setTimeout(resolve, 2000));
                    } catch (e) {
                        // Ignoriši ako waitForLoadState nije dostupan
                    }

                    // Scroll down to trigger lazy loading - koristi safeEvaluate
                    await this.safeEvaluate(() => {
                        window.scrollTo(0, document.body.scrollHeight / 2);
                    });
                    
                    // Sačekaj da se stranica potpuno učita i JavaScript se izvrši
                    await new Promise(resolve => setTimeout(resolve, 3000));
                    
                    // Scroll back up - koristi safeEvaluate
                    await this.safeEvaluate(() => {
                        window.scrollTo(0, 0);
                    });
                    
                    await new Promise(resolve => setTimeout(resolve, 2000));
                    
                    // Pokušaj da sačekaš da se prikaže naslov
                    try {
                        await this.page.waitForSelector('h1', { timeout: 10000 });
                    } catch (e) {
                        // Ako selektor ne postoji, nastavi dalje
                    }
                    
                    break; // Ako sve prođe uspešno, izađi iz retry loop-a
                } catch (error) {
                    const errorMessage = error.message || error.toString();
                    if (errorMessage.includes('detached') || errorMessage.includes('Target closed') || errorMessage.includes('Frame')) {
                        if (retryCount < maxRetries) {
                            retryCount++;
                            console.log(`  ⚠️  Greška: ${errorMessage}, pokušavam ponovo...`);
                            await new Promise(resolve => setTimeout(resolve, 2000));
                            continue;
                        }
                    }
                    // Ako nije detached frame greška ili su potrošeni svi retry-ovi, baci grešku
                    throw error;
                }
            }

            // Koristi safeEvaluate umesto direktnog page.evaluate
            const details = await this.safeEvaluate(() => {
                // Funkcija za čitanje teksta iz elementa
                const getText = (selector) => {
                    try {
                        const element = document.querySelector(selector);
                        if (element) {
                            return element.innerText?.trim() || element.textContent?.trim() || null;
                        }
                    } catch (e) {
                        return null;
                    }
                    return null;
                };
                
                // Funkcija za čitanje meta tagova
                const getMeta = (name, property) => {
                    let element = null;
                    if (name) {
                        element = document.querySelector(`meta[name="${name}"]`) || 
                                  document.querySelector(`meta[property="${name}"]`);
                    }
                    if (!element && property) {
                        element = document.querySelector(`meta[property="${property}"]`);
                    }
                    return element ? element.getAttribute('content') : null;
                };
                
                // Funkcija za pronalaženje teksta pomoću više selektora
                const findText = (selectors) => {
                    for (const selector of selectors) {
                        const text = getText(selector);
                        if (text && text !== '' && text !== 'N/A') return text;
                    }
                    return null;
                };
                
                // Pokušaj da pročitaš JSON-LD struktuirane podatke
                let jsonLdData = null;
                try {
                    const jsonLdScript = document.querySelector('script[type="application/ld+json"]');
                    if (jsonLdScript) {
                        jsonLdData = JSON.parse(jsonLdScript.textContent);
                    }
                } catch (e) {
                    // Ignoriši greške
                }

                // Naziv igre - više opcija
                let title = findText([
                    'h1[data-qa="mfe-game-title#name"]',
                    'h1.pdp-product-name',
                    'h1[class*="product-name"]',
                    'h1[data-qa*="product-name"]',
                    'h1',
                    '[data-qa="product-name"]',
                    '.product-title'
                ]);
                
                // Pokušaj iz meta tagova
                if (!title) {
                    title = getMeta('og:title') || getMeta('twitter:title') || getMeta('title');
                }
                
                // Pokušaj iz JSON-LD
                if (!title && jsonLdData) {
                    if (jsonLdData.name) title = jsonLdData.name;
                    else if (jsonLdData.headline) title = jsonLdData.headline;
                }

                // Funkcija za pronalaženje svih cena na stranici
                const findAllPrices = () => {
                    const prices = [];
                    // Poboljšan regex pattern za cene (uključuje turske lire i različite formate)
                    const pricePattern = /[₺$€£¥₹]\s*\d+[\.,]?\d*|\d+[\.,]\d+\s*[₺$€£¥₹]|TL\s*\d+[\.,]?\d*|\d+[\.,]?\d*\s*TL/i;
                    
                    // Specifični selektori koje koristi PlayStation Store
                    const priceSelectors = [
                        // Opštiji selektori za label elemente koji sadrže cene (različite verzije igara)
                        'div.psw-pdp-card-anchor label div.psw-l-anchor.psw-l-stack-left span span span span',
                        'div.psw-pdp-card-anchor label div.psw-l-anchor span span span',
                        'label div.psw-l-anchor.psw-l-stack-left.psw-fill-x span span span',
                        'label[class*="psw"] div[class*="psw-l-anchor"] span span span',
                        'label > div.psw-l-anchor > span > span > span',
                        'div.psw-pdp-card-anchor label span span span',
                        // Pokušaj da nađeš sve label elemente i onda cene unutar njih
                        'label span span span',
                        'label span[class*="psw"] span span',
                        '[data-qa="mfeCtaMain#offer0#finalPrice"]',
                        '[data-qa="mfeCtaMain#offer0#finalPrice"] span',
                        '[data-qa*="finalPrice"]',
                        '[data-qa*="price"]',
                        '.price-display__price',
                        '[class*="price-display"]',
                        '[class*="final-price"]',
                        'span[class*="price"]',
                        '[aria-label*="price" i]',
                        'button[class*="price"]',
                        '[class*="cta"] [class*="price"]',
                        // Prošireni selektori za label elemente (različite verzije)
                        'label div[class*="psw-l-anchor"] span',
                        'label[class*="psw"] span span',
                        '.psw-pdp-card-anchor label span',
                        'div[class*="psw-pdp"] label span span span'
                    ];
                    
                    // Prvo probaj specifične selektore
                    for (const selector of priceSelectors) {
                        try {
                            const elements = document.querySelectorAll(selector);
                            elements.forEach(el => {
                                const text = el.innerText?.trim() || el.textContent?.trim();
                                if (text && (pricePattern.test(text) || text.match(/\d+[\.,]\d+/))) {
                                    // Filtrirati samo validne cene
                                    if (text.length < 50 && 
                                        !text.toLowerCase().includes('confirm') &&
                                        !text.toLowerCase().includes('select') &&
                                        !text.toLowerCase().includes('choose')) {
                                        prices.push(text);
                                    }
                                }
                            });
                        } catch (e) {
                            // Ignoriši greške sa selektorima
                        }
                    }
                    
                    // Poseban pristup: traži sve label elemente u psw-pdp-card-anchor i izvuci cene
                    try {
                        const cardAnchors = document.querySelectorAll('div.psw-pdp-card-anchor, div[class*="pdp-card"]');
                        cardAnchors.forEach(card => {
                            const labels = card.querySelectorAll('label');
                            labels.forEach(label => {
                                // Traži sve span elemente unutar labela
                                const spans = label.querySelectorAll('span span span, span span span span');
                                spans.forEach(span => {
                                    const text = span.innerText?.trim() || span.textContent?.trim();
                                    if (text && pricePattern.test(text) && text.length < 50) {
                                        if (!text.toLowerCase().includes('confirm') &&
                                            !text.toLowerCase().includes('select')) {
                                            prices.push(text);
                                        }
                                    }
                                });
                            });
                        });
                    } catch (e) {
                        // Ignoriši greške
                    }
                    
                    // Ako nisu pronađene cene, pokušaj opštiji pristup
                    if (prices.length === 0) {
                        const allElements = document.querySelectorAll('span, div, button, p, label');
                        allElements.forEach(el => {
                            const text = el.innerText?.trim() || el.textContent?.trim();
                            if (text && pricePattern.test(text) && text.length < 50) {
                                // Izbjegni elemente koji nisu cene
                                if (!text.toLowerCase().includes('confirm') && 
                                    !text.toLowerCase().includes('rating') &&
                                    !text.toLowerCase().includes('download') &&
                                    !text.toLowerCase().includes('size')) {
                                    prices.push(text);
                                }
                            }
                        });
                    }
                    
                    return [...new Set(prices)]; // Ukloni duplikate
                };
                
                // Pronađi sve cene
                let allPrices = findAllPrices();
                
                // Funkcija za ekstraktovanje numeričke vrednosti iz cene
                const extractPriceValue = (priceStr) => {
                    if (!priceStr) return 0;
                    const match = priceStr.match(/(\d+)[\.,](\d+)/);
                    if (match) {
                        return parseFloat(match[1] + '.' + match[2]);
                    }
                    return 0;
                };
                
                // Filtriraj i sortiraj cene
                // Prvo ukloni "Free" ako postoje druge cene
                const paidPrices = allPrices.filter(p => 
                    !p.toLowerCase().includes('free') && 
                    !p.toLowerCase().includes('ücretsiz') &&
                    !p.toLowerCase().includes('bedava') &&
                    extractPriceValue(p) > 0
                );
                
                // Ako postoje plaćene cene, uzmi najvišu
                let price = null;
                if (paidPrices.length > 0) {
                    // Sortiraj po vrednosti (najviša prva)
                    paidPrices.sort((a, b) => extractPriceValue(b) - extractPriceValue(a));
                    price = paidPrices[0];
                } else if (allPrices.length > 0) {
                    // Ako nema plaćenih, uzmi prvu pronađenu
                    price = allPrices[0];
                }
                
                // Ako i dalje nije pronađena cena, pokušaj meta tagove
                if (!price) {
                    price = getMeta('product:price:amount');
                }
                
                // Pokušaj iz JSON-LD
                if (!price && jsonLdData) {
                    if (jsonLdData.offers && jsonLdData.offers.price) {
                        price = jsonLdData.offers.price;
                        if (jsonLdData.offers.priceCurrency) {
                            price = `${jsonLdData.offers.priceCurrency} ${price}`;
                        }
                    }
                }
                
                // Ako je još uvek null, postavi na N/A
                price = price || 'N/A';

                // Originalna cena (ako je na popustu)
                const originalPrice = findText([
                    '[data-qa="mfeCtaMain#offer0#originalPrice"]',
                    '.price-display__strikethrough',
                    '[class*="original-price"]',
                    '[class*="was-price"]',
                    '[class*="strikethrough"]'
                ]);

                // Popust
                const discount = findText([
                    '[data-qa="mfeCtaMain#offer0#discountBadge"]',
                    '[class*="discount-badge"]',
                    '[class*="discount"]',
                    '[class*="sale-badge"]',
                    '[class*="save"]'
                ]);

                // Opis
                const description = findText([
                    '[data-qa="mfe-game-overview#description"]',
                    '[data-qa*="description"]',
                    '.pdp-product-description',
                    '[class*="product-description"]',
                    '[class*="description"] p',
                    'p[class*="description"]'
                ]);

                // Rating
                const rating = findText([
                    '[data-qa="mfe-star-rating#overall-rating"]',
                    '[data-qa*="rating"]',
                    '[class*="rating"]',
                    '[class*="star-rating"]',
                    '[aria-label*="rating" i]'
                ]);

                // Platforma
                const platform = findText([
                    '[data-qa="mfe-game-title#platform"]',
                    '[data-qa*="platform"]',
                    '[class*="platform"]'
                ]);

                // Izdavač/Developer
                const publisher = findText([
                    '[data-qa="mfe-game-title#publisher"]',
                    '[data-qa*="publisher"]',
                    '[class*="publisher"]'
                ]);

                // Datum izlaska
                const releaseDate = findText([
                    '[data-qa="mfe-game-title#release-date"]',
                    '[data-qa*="release"]',
                    '[class*="release-date"]'
                ]);

                // Kategorije/Žanrovi
                const genres = Array.from(document.querySelectorAll('[data-qa*="genre"], [class*="genre"]'))
                    .map(el => el.innerText?.trim() || el.textContent?.trim())
                    .filter(text => text && text !== '');

                // Slika
                const image = document.querySelector('img[data-qa="game-overview#hero-image"], img[class*="hero"], img[class*="product-image"]')?.src || null;

                return {
                    title: title || 'N/A',
                    price: price || 'N/A',
                    allPrices: allPrices.length > 0 ? allPrices : null, // Sve pronađene cene
                    originalPrice: originalPrice || null,
                    discount: discount || null,
                    description: description ? description.substring(0, 1000) : 'N/A',
                    rating: rating || 'N/A',
                    platform: platform || null,
                    publisher: publisher || null,
                    releaseDate: releaseDate || null,
                    genres: genres.length > 0 ? genres : null,
                    image: image || null
                };
            });

            // Prikaži sve pronađene cene u konzoli
            if (details.allPrices && details.allPrices.length > 0) {
                console.log(`  📊 Pronađene cene: ${details.allPrices.join(', ')}`);
            }
            
            // Ako cena nije pronađena ili je "Free", pokušaj još jednom sa dodatnim čekanjem
            if (details.price === 'N/A' || !details.price || details.price.toLowerCase().includes('free')) {
                console.log('  ⚠️  Cena nije pronađena ili je Free, pokušavam ponovo...');
                await new Promise(resolve => setTimeout(resolve, 3000));
                
                // Scroll ponovo da se učitaju svi elementi - koristi safeEvaluate
                await this.safeEvaluate(() => {
                    window.scrollTo(0, document.body.scrollHeight / 3);
                });
                await new Promise(resolve => setTimeout(resolve, 2000));
                await this.safeEvaluate(() => {
                    window.scrollTo(0, 0);
                });
                await new Promise(resolve => setTimeout(resolve, 1000));
                
                // Pokušaj ponovo da pročitaš cenu sa poboljšanom logikom - koristi safeEvaluate
                const retryDetails = await this.safeEvaluate(() => {
                    const pricePattern = /[₺$€£¥₹]\s*\d+[\.,]?\d*|\d+[\.,]\d+\s*[₺$€£¥₹]|TL\s*\d+[\.,]?\d*|\d+[\.,]?\d*\s*TL/i;
                    const prices = [];
                    
                    // Fokusiraj se na label elemente
                    const labels = document.querySelectorAll('div.psw-pdp-card-anchor label, label[class*="psw"]');
                    labels.forEach(label => {
                        const text = label.innerText || label.textContent;
                        if (text && pricePattern.test(text)) {
                            const matches = text.match(pricePattern);
                            if (matches) {
                                matches.forEach(match => {
                                    if (!match.toLowerCase().includes('free') && 
                                        !match.toLowerCase().includes('confirm')) {
                                        prices.push(match.trim());
                                    }
                                });
                            }
                        }
                    });
                    
                    // Ako nema rezultata, traži opštije
                    if (prices.length === 0) {
                        const allText = document.body.innerText || document.body.textContent;
                        const matches = allText.match(new RegExp(pricePattern, 'gi'));
                        if (matches) {
                            matches.forEach(match => {
                                if (!match.toLowerCase().includes('free') && 
                                    match.match(/\d+/)) {
                                    prices.push(match.trim());
                                }
                            });
                        }
                    }
                    
                    return [...new Set(prices)];
                });
                
                if (retryDetails && retryDetails.length > 0) {
                    // Uzmi najvišu cenu
                    const extractValue = (p) => {
                        const match = p.match(/(\d+)[\.,]?(\d*)/);
                        return match ? parseFloat(match[1] + (match[2] ? '.' + match[2] : '')) : 0;
                    };
                    retryDetails.sort((a, b) => extractValue(b) - extractValue(a));
                    details.price = retryDetails[0];
                    if (details.allPrices) {
                        details.allPrices = [...new Set([...details.allPrices, ...retryDetails])];
                    } else {
                        details.allPrices = retryDetails;
                    }
                    console.log(`  ✅ Cena pronađena: ${details.price}`);
                }
            }

            return {
                url: gameUrl,
                ...details,
                scrapedAt: new Date().toISOString()
            };
        } catch (error) {
            console.error('Greška pri učitavanju detalja:', error.message);
            return {
                url: gameUrl,
                error: error.message,
                scrapedAt: new Date().toISOString()
            };
        }
    }

    async readUrlsFromFile(filename = 'games.txt') {
        try {
            const content = await fs.readFile(filename, 'utf-8');
            const lines = content.split('\n');
            
            const urls = lines
                .map(line => line.trim())
                .filter(line => line && !line.startsWith('#')) // Ignoriši prazne linije i komentare
                .filter(line => line.startsWith('http')); // Samo URL-ovi
            
            return urls;
        } catch (error) {
            if (error.code === 'ENOENT') {
                console.error(`Fajl ${filename} ne postoji. Kreiraj fajl sa URL-ovima igara.`);
            } else {
                console.error(`Greška pri čitanju fajla ${filename}:`, error.message);
            }
            throw error;
        }
    }

    async scrapeGamesFromFile(filename = 'games.txt', delayBetweenRequests = 3000) {
        try {
            const urls = await this.readUrlsFromFile(filename);
            
            if (urls.length === 0) {
                console.log('Nema URL-ova za scrapovanje u fajlu.');
                return [];
            }

            console.log(`Pronađeno ${urls.length} URL-ova za scrapovanje.\n`);
            
            const results = [];
            
            for (let i = 0; i < urls.length; i++) {
                const url = urls[i];
                console.log(`[${i + 1}/${urls.length}] Scrapovanje: ${url}`);
                
                try {
                    const details = await this.scrapeGameDetails(url);
                    results.push(details);
                    
                    if (details.error) {
                        console.log(`  ❌ Greška: ${details.error}\n`);
                    } else {
                        console.log(`  ✅ ${details.title} - ${details.price}\n`);
                    }
                } catch (error) {
                    const errorMsg = error.message || error.toString();
                    console.log(`  ❌ Greška: ${errorMsg}\n`);
                    results.push({
                        url,
                        error: errorMsg,
                        scrapedAt: new Date().toISOString()
                    });
                }
                
                // Sačekaj između zahteva da ne preopteretiš server
                // Povećan delay da se smanji šansa za detached frame greške
                if (i < urls.length - 1) {
                    await new Promise(resolve => setTimeout(resolve, delayBetweenRequests));
                }
            }
            
            return results;
        } catch (error) {
            console.error('Greška pri scrapovanju iz fajla:', error.message);
            throw error;
        }
    }

    async saveToFile(data, filename = 'playstation-games.json') {
        try {
            await fs.writeFile(filename, JSON.stringify(data, null, 2), 'utf-8');
            console.log(`Podaci sačuvani u ${filename}`);
        } catch (error) {
            console.error('Greška pri čuvanju fajla:', error.message);
            throw error;
        }
    }

    async close() {
        if (this.browser) {
            await this.browser.close();
            console.log('Browser zatvoren.');
        }
    }
}

// Glavna funkcija
async function main() {
    const scraper = new PlayStationScraper();
    
    try {
        await scraper.init();
        
        // Proveri da li postoji fajl sa URL-ovima
        try {
            const urls = await scraper.readUrlsFromFile('games.txt');
            
            if (urls.length > 0) {
                // Scrapuj igre iz fajla
                console.log('\n=== Scrapovanje igara iz games.txt ===\n');
                // Povećan delay na 3000ms (3 sekunde) da se smanji šansa za detached frame greške
                const games = await scraper.scrapeGamesFromFile('games.txt', 3000);
                
                if (games.length > 0) {
                    await scraper.saveToFile(games, 'scraped-games.json');
                    
                    console.log('\n=== Rezultati ===');
                    console.log(`Ukupno scrapovano: ${games.length} igara`);
                    const successful = games.filter(g => !g.error).length;
                    const failed = games.filter(g => g.error).length;
                    console.log(`Uspešno: ${successful}`);
                    console.log(`Neuspešno: ${failed}`);
                }
                return;
            }
        } catch (fileError) {
            // Ako fajl ne postoji ili je prazan, nastavi sa default ponašanjem
            console.log('Fajl games.txt ne postoji ili je prazan. Koristim default mod.');
        }
        
        // Default: Scrapovanje popularnih igara
        console.log('\n=== Scrapovanje popularnih igara ===');
        const games = await scraper.scrapeGamePrices('', 'games', 20);
        
        if (games.length === 0) {
            console.log('Nisu pronađene igre. Pokušavam alternativni pristup...');
            
            // Alternativni pristup - direktno scrapovanje sa glavne stranice
            await scraper.page.goto('https://store.playstation.com/en-rs/category/44d8bb20-653e-431e-8ad0-c0a365f68d2f', {
                waitUntil: 'networkidle2',
                timeout: 30000
            });
            
            // Sačekaj da se stranica potpuno učita
            await new Promise(resolve => setTimeout(resolve, 5000));
            
            const alternativeGames = await scraper.page.evaluate(() => {
                const results = [];
                const gameCards = document.querySelectorAll('[class*="product-tile"], [class*="game-tile"], a[href*="/product/"]');
                
                gameCards.forEach(card => {
                    try {
                        const titleEl = card.querySelector('span, h3, [class*="title"]');
                        const priceEl = card.querySelector('[class*="price"], span[data-qa*="price"]');
                        
                        if (titleEl && priceEl) {
                            results.push({
                                title: titleEl.innerText.trim(),
                                price: priceEl.innerText.trim(),
                                link: card.href || card.closest('a')?.href || 'N/A'
                            });
                        }
                    } catch (e) {
                        // Ignoriši greške
                    }
                });
                
                return results.slice(0, 20);
            });
            
            if (alternativeGames.length > 0) {
                console.log(`\nPronađeno ${alternativeGames.length} igara:`);
                alternativeGames.forEach((game, index) => {
                    console.log(`${index + 1}. ${game.title} - ${game.price}`);
                });
                
                await scraper.saveToFile(alternativeGames, 'playstation-games.json');
            } else {
                console.log('Još uvek nisu pronađene igre. PlayStation Store možda ima zaštitu protiv scrapovanja.');
                console.log('Preporučujem korisćenje PlayStation Store API-ja ili ručno podešavanje selektora.');
            }
        } else {
            console.log(`\nPronađeno ${games.length} igara:`);
            games.forEach((game, index) => {
                console.log(`${index + 1}. ${game.title} - ${game.price}`);
            });
            
            // Sačuvaj u fajl
            await scraper.saveToFile(games, 'playstation-games.json');
        }
        
    } catch (error) {
        console.error('Greška:', error);
    } finally {
        await scraper.close();
    }
}

// Pokreni ako je direktno pozvan
if (require.main === module) {
    main();
}

module.exports = PlayStationScraper;
