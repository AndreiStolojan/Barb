// ─────────────────────────────────────────────────────────────────────────────
// scan-ai-input.service.js — pregătește "pachetul" de date trimis către AI.
//
// Ce face, pe scurt: ia un email deja parsat din baza de date și construiește un
// obiect mai mic și mai sigur, care va fi trimis modelului local Ollama pentru
// analiza semantică (vezi ollama-semantic.service.js). Aici se taie textul prea
// lung, se limitează numărul de linkuri și se adaugă contextul de brand (dacă
// expeditorul e un domeniu oficial verificat).
//
// De ce e nevoie de pasul ăsta: emailurile pot avea corpuri de text foarte lungi
// sau zeci de linkuri — trimiterea integrală ar încetini modelul AI (sau l-ar
// face să dea erori). Reducem inputul la "esențial", dar păstrăm informația
// relevantă pentru detectarea phishingului.
//
// Detalii: docs/detection-engine.md.
// ─────────────────────────────────────────────────────────────────────────────

// Elemente al căror CONȚINUT nu e text citibil de om. Trebuie eliminate cu totul,
// nu doar tagurile care le delimitează: un mail de brand are frecvent 3.000–8.000
// de caractere de CSS în <style>, iar dacă păstrăm doar conținutul, acesta umple
// tot bugetul MAX_AI_BODY_CHARS și modelul nu mai vede niciun cuvânt din mesajul
// real.
const NON_TEXT_ELEMENTS = new Set(['script', 'style', 'head', 'noscript', 'svg']);
// Sfârșiturile de bloc devin linie nouă, ca propozițiile să nu se lipească între
// ele când tagurile dispar ("Salut Andrei" + "Contul tău" != "Salut AndreiContul").
const BLOCK_ELEMENTS = new Set([
    'p', 'div', 'br', 'tr', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'table', 'blockquote',
]);
// Începutul unui tag: "<p", "</p", "<!DOCTYPE". Un "<" urmat de altceva
// (ex. "pret < 5 lei") e text obișnuit, ca în browser.
const TAG_START = /<(\/?)([a-z][a-z0-9]*)?/iy;

// Entitățile HTML uzuale. Le decodăm ca modelul să vadă text natural, nu "&amp;".
const HTML_ENTITIES = {
    '&nbsp;': ' ', '&amp;': '&', '&lt;': '<', '&gt;': '>',
    '&quot;': '"', '&#39;': "'", '&apos;': "'",
};

// Transformă HTML în text simplu pentru analiza semantică. Folosit ca rezervă
// (fallback) când emailul nu are versiune de text simplu — adică exact cazul
// mailurilor de marketing și tranzacționale de brand.
//
// O singură trecere înainte cu indexOf, deci timp liniar. Varianta cu regex
// rescana până la finalul documentului la fiecare "<" sau "<!--" neînchis:
// 60 KB ostili costau ~5 s de CPU. Ca browserele, un comentariu, un tag sau un
// <style>/<script> neînchis ascunde tot restul documentului.
const stripHtmlTags = (htmlValue) => {
    const html = String(htmlValue || '');
    let text = '';
    let position = 0;

    while (position < html.length) {
        const tagStart = html.indexOf('<', position);

        if (tagStart === -1) {
            text += html.slice(position);
            break;
        }

        text += html.slice(position, tagStart);

        if (html.startsWith('<!--', tagStart)) {
            const commentEnd = html.indexOf('-->', tagStart + 4);
            if (commentEnd === -1) break;
            text += ' ';
            position = commentEnd + 3;
            continue;
        }

        TAG_START.lastIndex = tagStart;
        const [, closing, rawName] = TAG_START.exec(html);
        const isTag = Boolean(rawName) || /[!?/]/.test(html[tagStart + 1] || '');

        if (!isTag) {
            text += '<';
            position = tagStart + 1;
            continue;
        }

        const tagEnd = html.indexOf('>', tagStart + 1);
        if (tagEnd === -1) break;
        position = tagEnd + 1;

        const name = (rawName || '').toLowerCase();

        if (!closing && NON_TEXT_ELEMENTS.has(name)) {
            const closeTag = new RegExp(`</${name}\\s*>`, 'gi');
            closeTag.lastIndex = position;
            const closeMatch = closeTag.exec(html);
            if (!closeMatch) break;
            text += ' ';
            position = closeMatch.index + closeMatch[0].length;
            continue;
        }

        text += BLOCK_ELEMENTS.has(name) ? '\n' : ' ';
    }

    return text.replace(/&[a-z]+;|&#\d+;/gi, (entity) => HTML_ENTITIES[entity.toLowerCase()] ?? ' ');
};

// Înlocuiește orice succesiune de spații/taburi/linii noi cu un singur spațiu și
// elimină spațiile de la margini — curăță textul înainte de a-l trimite la AI.
const normalizeWhitespace = (textValue) => textValue.replace(/\s+/g, ' ').trim();

// Limite de lungime/numar pentru bucățile trimise la AI (în caractere, respectiv
// număr de linkuri). Scopul: input mic, rapid de procesat, dar suficient de
// informativ pentru model.
const MAX_AI_SUBJECT_CHARS = 180;
const MAX_AI_HEADER_CHARS = 180;
// Ridicat de la 1200: până acum bugetul era consumat de CSS (vezi stripHtmlTags),
// deci limita strânsă compensa zgomotul, nu costul. Pe text curat, 4000 de
// caractere acoperă corpul întreg al majorității mailurilor la un cost neglijabil.
const MAX_AI_BODY_CHARS = 4000;
const MAX_AI_LINKS = 6;
const MAX_AI_LINK_CHARS = 120;

// Taie un text la maximum `maxChars` caractere, pe ultima graniță de cuvânt dacă
// una e destul de aproape de limită — o tăiere în mijlocul cuvântului produce
// jumătăți de token care derutează modelul.
const truncateText = (textValue, maxChars) => {
    if (textValue.length <= maxChars) {
        return textValue;
    }

    const hardCut = textValue.slice(0, maxChars);
    const lastBoundary = hardCut.lastIndexOf(' ');

    return lastBoundary > maxChars * 0.8 ? hardCut.slice(0, lastBoundary) : hardCut;
};

// Construiește obiectul de input pentru AI dintr-un email și un context de brand
// (vine din verifySenderBrand, vezi scan.service.js). Acest obiect este trimis
// ca JSON modelului Ollama în ollama-semantic.service.js.
export const buildAiAnalysisInput = (email, brandContext = {}) => {
    // Preferăm corpul de text simplu; dacă nu există, scoatem tagurile din HTML;
    // dacă nici acela nu există, folosim "snippet"-ul (preview-ul scurt de la Gmail).
    const textBody = normalizeWhitespace(email.textBody || '');
    const rawAnalysisBody = textBody
        || normalizeWhitespace(stripHtmlTags(email.htmlBody || ''))
        || email.snippet || '';
    const analysisBody = truncateText(rawAnalysisBody, MAX_AI_BODY_CHARS);
    // Curățăm și normalizăm lista de linkuri găsite în email.
    const links = (email.links || [])
        .map((linkValue) => normalizeWhitespace(String(linkValue || '')))
        .filter(Boolean);
    // Păstrăm doar primele MAX_AI_LINKS linkuri, fiecare trunchiat la MAX_AI_LINK_CHARS.
    const limitedLinks = links
        .slice(0, MAX_AI_LINKS)
        .map((linkValue) => truncateText(linkValue, MAX_AI_LINK_CHARS));

    return {
        subject: truncateText(email.subject || '', MAX_AI_SUBJECT_CHARS),
        from: truncateText(email.from || '', MAX_AI_HEADER_CHARS),
        replyTo: truncateText(email.replyTo || '', MAX_AI_HEADER_CHARS),
        senderDomain: email.senderDomain || '',
        // Contextul de verificare a brandului e mereu prezent, ca promptul să poată
        // raționa despre domeniul real al expeditorului. brandName/officialDomains
        // se completează doar dacă expeditorul e un brand verificat.
        senderVerifiedBrand: Boolean(brandContext.senderVerifiedBrand),
        brandName: brandContext.brandName || null,
        officialDomains: brandContext.senderVerifiedBrand
            ? brandContext.officialDomains || []
            : [],
        body: analysisBody,
        links: limitedLinks,
        // Metadate suplimentare — nu sunt folosite direct în scor, dar ajută la
        // depanare/debug (ex: cât s-a trunchiat textul, câte linkuri au fost omise).
        metadata: {
            senderDomain: email.senderDomain || '',
            replyToDomain: email.replyToDomain || '',
            linkCount: email.linkCount || 0,
            linksIncludedCount: limitedLinks.length,
            linksTruncated: links.length > limitedLinks.length,
            bodyTruncated: rawAnalysisBody.length > analysisBody.length,
            bodyCharsIncluded: analysisBody.length,
        },
    };
};
