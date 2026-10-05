const MAX_PAGE_BYTES = 650_000;
const MAX_PDF_BYTES = 5 * 1024 * 1024;
const MAX_ROOT_PAGES = 5;
const MAX_DETAIL_PAGES = 2;
const MAX_SOURCES = 5;
const MAX_EXCERPT_CHARS = 1_700;
const REQUEST_TIMEOUT_MS = 7_000;
const SEARCH_BUDGET_MS = 8_500;
const SOURCE_SEARCH_LINK = "/community.html";

const ALLOWED_HOST_ROOTS = Object.freeze([
  "greatertzaneen.gov.za",
  "maruleng.gov.za",
  "mopani.gov.za",
  "limpopo.gov.za",
  "gov.za",
  "dpsa.gov.za",
  "ldoh.gov.za",
  "postoffice.co.za",
  "geonames.org"
]);

const STOP_WORDS = new Set([
  "a", "an", "the", "for", "who", "what", "why", "how", "can", "could", "would", "please",
  "help", "me", "explain", "tell", "understand", "about", "does", "do", "is", "are", "was", "were",
  "to", "of", "and", "or", "in", "on", "at", "by", "with", "from", "using", "use", "be", "it",
  "this", "that", "these", "those", "my", "your", "our", "their", "i", "we", "you", "them", "they",
  "give", "show", "latest", "current", "today", "now", "near", "around", "local", "official", "source",
  "sources", "please", "find", "search", "look", "up", "happening", "posted", "publish", "published"
]);

const LOCAL_CONTEXT = /\b(?:sekororo|ga[ -]?sekororo|ga[ -]?mamahlola|metz|moetladimo|mahlakung|tzaneen|mopani|maruleng|limpopo|limpopian|limpopians|my area|our area|near me|around here)\b/i;
const NEARBY_CONTEXT = /\b(?:sekororo|ga[ -]?sekororo|ga[ -]?mamahlola|metz|moetladimo|mahlakung|tzaneen|mopani|maruleng)\b/i;
const LIVE_OR_LOCAL_INTENT = /\b(?:current|currently|latest|recent|today|tonight|this week|open now|available now|happening|vacanc(?:y|ies)|jobs?|careers?|learnerships?|tenders?|notices?|news|updates?|renovat(?:e|ed|ion|ions)|construct(?:ion|ed|ing)?|projects?|roadworks?|roads?|water supply|electricity|service interruptions?|hospital|clinic|health service|post office|opening hours?|contact details?)\b/i;
const JOB_INTENT = /\b(?:vacanc(?:y|ies)|jobs?|careers?|learnerships?|employment|work posts?|recruitment|dpsa|z83)\b/i;
const NOTICE_INTENT = /\b(?:notice|notices|announcement|announcements|latest news|what(?:'s| is) happening|service interruption|water supply|electricity|municipal update)\b/i;
const PROJECT_INTENT = /\b(?:road|roadworks?|infrastructure|renovat(?:e|ed|ion|ions)|construct(?:ion|ed|ing)?|project|projects|tender|tenders|water scheme|maintenance|repair)\b/i;
const HEALTH_INTENT = /\b(?:hospital|clinic|health|nurse|doctor|medical facility|health service)\b/i;
const POSTAL_INTENT = /\b(?:post office|postal|post-office|mail branch|moetladimo branch)\b/i;
const COMMUNITY_SOURCE_INTENT = /\b(?:vacanc(?:y|ies)|jobs?|careers?|learnerships?|employment|work posts?|recruitment|dpsa|z83|notice|notices|announcement|announcements|latest news|what(?:'s| is) happening|service interruption|water supply|electricity|municipal update|road|roadworks?|infrastructure|renovat(?:e|ed|ion|ions)|construct(?:ion|ed|ing)?|project|projects|tender|tenders|water scheme|maintenance|repair|hospital|clinic|health|nurse|doctor|medical facility|health service|post office|postal|post-office|mail branch|moetladimo branch)\b/i;
const GENERIC_PLACES = /^(?:my area|our area|near me|around here|south africa|nationally|limpopo|limpopians?|today|tomorrow|tonight|this week|next week|the next week|the coming week|weekend|the weekend|monday|tuesday|wednesday|thursday|friday|saturday|sunday|morning|afternoon|evening|the morning|the afternoon|the evening|\d+.*)$/i;

const SOURCE_SEEDS = Object.freeze([
  { id: "limpopo-jobs", title: "Limpopo Provincial Government — Jobs and Career Opportunities", url: "https://www.limpopo.gov.za/?page_id=3454", category: "jobs", boosts: /vacanc|career|circular|closing|advert|recruit/i },
  { id: "limpopo-erecruitment", title: "Limpopo Provincial Government eRecruitment — Browse Vacancies", url: "https://erecruitment.limpopo.gov.za/browse", category: "jobs", boosts: /vacanc|job|department|reference|browse|closing/i },
  { id: "limpopo-erecruitment-health", title: "Limpopo Provincial Government — Health Department Vacancies", url: "https://erecruitment.limpopo.gov.za/browse?office=HEALTH", category: "jobs", boosts: /health|nurse|doctor|clinical|hospital|vacanc|closing/i },
  { id: "limpopo-erecruitment-education", title: "Limpopo Provincial Government — Education Department Vacancies", url: "https://erecruitment.limpopo.gov.za/browse?office=EDU", category: "jobs", boosts: /education|teacher|school|educator|vacanc|closing/i },
  { id: "limpopo-erecruitment-roads", title: "Limpopo Provincial Government — Public Works and Roads Vacancies", url: "https://erecruitment.limpopo.gov.za/browse?office=PWRI", category: "jobs", boosts: /public works|road|infrastructure|engineer|vacanc|closing/i },
  { id: "limpopo-erecruitment-agriculture", title: "Limpopo Provincial Government — Agriculture Department Vacancies", url: "https://erecruitment.limpopo.gov.za/browse?office=AGRI", category: "jobs", boosts: /agricultur|farm|agri|vacanc|closing/i },
  { id: "limpopo-erecruitment-premier", title: "Limpopo Provincial Government — Office of the Premier Vacancies", url: "https://erecruitment.limpopo.gov.za/browse?office=OTP", category: "jobs", boosts: /premier|administrat|management|vacanc|closing/i },
  { id: "maruleng-jobs", title: "Maruleng Local Municipality — Vacancies", url: "https://www.maruleng.gov.za/pages/vacancies.php", category: "jobs", localOnly: true, boosts: /vacanc|job|career|closing|advert/i },
  { id: "gtm-jobs", title: "Greater Tzaneen Municipality — Current Vacancies", url: "https://www.greatertzaneen.gov.za/?q=current_vacancies", category: "jobs", localOnly: true, boosts: /vacanc|job|career|closing|advert/i },
  { id: "mopani-jobs", title: "Mopani District Municipality — Vacancies", url: "https://www.mopani.gov.za/vacancies/vacancies.php", category: "jobs", localOnly: true, boosts: /vacanc|job|career|learnership|closing|advert/i },
  { id: "dpsa-jobs", title: "DPSA — Public Service Vacancy Circular", url: "https://www.dpsa.gov.za/newsroom/psvc/", category: "jobs", boosts: /circular|vacanc|department|closing|advert/i },
  { id: "gov-jobs", title: "Government of South Africa — Government Jobs This Week", url: "https://www.gov.za/government-jobs-week", category: "jobs", boosts: /circular|vacanc|z83|closing|jobs/i },
  { id: "maruleng-notices", title: "Maruleng Local Municipality — Notices", url: "https://www.maruleng.gov.za/pages/notices.php", category: "notices", localOnly: true, boosts: /notice|idp|budget|project|road|water|published/i },
  { id: "maruleng-tenders", title: "Maruleng Local Municipality — Tenders", url: "https://www.maruleng.gov.za/pages/tenders.php", category: "projects", localOnly: true, boosts: /tender|bid|closing|advertised|award/i },
  { id: "gtm-notices", title: "Greater Tzaneen Municipality — Notices and Local Updates", url: "https://www.greatertzaneen.gov.za/", category: "notices", localOnly: true, boosts: /notice|road|project|service|water|electric|news|update/i },
  { id: "gtm-notice-archive", title: "Greater Tzaneen Municipality — Archived Notices", url: "https://www.greatertzaneen.gov.za/?q=archived_notices", category: "notices", localOnly: true, boosts: /notice|date|water|electric|disruption|closing/i },
  { id: "mopani-notices", title: "Mopani District Municipality — Notices", url: "https://www.mopani.gov.za/newsroom/notice.php", category: "notices", localOnly: true, boosts: /notice|water|service|community|public|date/i },
  { id: "mopani-news", title: "Mopani District Municipality — Newsroom", url: "https://www.mopani.gov.za/newsroom/latest_news.php", category: "notices", localOnly: true, boosts: /news|project|water|road|update|community/i },
  { id: "dpw-news", title: "Limpopo Department of Public Works, Roads and Infrastructure — News and Notices", url: "https://www.dpw.limpopo.gov.za/", category: "notices", boosts: /road|maintenance|project|notice|latest|district|date/i },
  { id: "gtm-idp", title: "Greater Tzaneen Municipality — Integrated Development Plan", url: "https://www.greatertzaneen.gov.za/?q=idp_26_27", category: "projects", localOnly: true, boosts: /idp|project|road|water|budget|approved/i },
  { id: "mopani-tenders", title: "Mopani District Municipality — Advertised Tenders", url: "https://www.mopani.gov.za/tenders/adver_tenders.php", category: "projects", boosts: /tender|bid|closing|advertised|road|water/i },
  { id: "dpw-tenders", title: "Limpopo DPWRI — Advertised Tenders", url: "https://www.dpw.limpopo.gov.za/pages/advertised_tenders.php", category: "projects", boosts: /tender|bid|closing|tzaneen|district/i },
  { id: "ldoh-hospitals", title: "Limpopo Department of Health — District Hospitals", url: "https://www.ldoh.gov.za/?q=node/18", category: "services", boosts: /hospital|sekororo|mopani|phone|location/i },
  { id: "ldoh-clinics", title: "Limpopo Department of Health — District Clinics", url: "https://www.ldoh.gov.za/?q=node/26", category: "services", boosts: /clinic|sekororo|maruleng|phone|location/i },
  { id: "sapo-locations", title: "South African Post Office — Official Locations and Branch List", url: "https://www.postoffice.co.za/tools/postofficelocations.html", category: "services", boosts: /moetladimo|metz|branch|post office|location/i },
  { id: "maruleng-idp", title: "Maruleng Local Municipality — Reviewed 2024/25 IDP", url: "https://lg.treasury.gov.za/supportingdocs/LIM335/LIM335_IDP%20Final_2025_Y_20240531T110414Z_mashilanem.pdf", category: "services", localOnly: true, boosts: /maruleng|metz|sekororo|ga-mamahlola|municipal|ward/i }
]);

export const COMMUNITY_SOURCE_DIRECTORY = Object.freeze([
  {
    id: "jobs",
    title: "Government and municipal jobs",
    description: "Start with the official employer or government advert. Check its reference number, application method and closing date; never pay to secure a job.",
    sources: [
      { title: "Limpopo Provincial Government jobs", url: "https://www.limpopo.gov.za/?page_id=3454", description: "Provincial vacancy circulars and closing dates." },
      { title: "Limpopo eRecruitment portal", url: "https://erecruitment.limpopo.gov.za/browse", description: "Search provincial vacancies by title, reference number or department; check each advert's location and closing date." },
      { title: "Maruleng Local Municipality vacancies", url: "https://www.maruleng.gov.za/pages/vacancies.php", description: "Official local-employer vacancy table; verify each closing date in the original advert." },
      { title: "Greater Tzaneen Municipality vacancies", url: "https://www.greatertzaneen.gov.za/?q=current_vacancies", description: "The municipality's dedicated current-vacancies page; verify each advert directly." },
      { title: "Mopani District Municipality vacancies", url: "https://www.mopani.gov.za/vacancies/vacancies.php", description: "Municipal vacancy and learnership adverts; check closing dates inside each advert." },
      { title: "DPSA public-service vacancy circular", url: "https://www.dpsa.gov.za/newsroom/psvc/", description: "Use the latest dated circular and the relevant department's original advert." },
      { title: "South African government jobs directory", url: "https://www.gov.za/about-government/government-jobs", description: "Links to national department career pages." },
      { title: "Department of Employment and Labour — job-fee warning", url: "https://www.labour.gov.za/work-seekers-warned-not-to-pay-for-employment-%E2%80%93-department-of-employment-and-labour", description: "Official advice: work seekers should not pay for employment services." }
    ]
  },
  {
    id: "notices",
    title: "Public notices and local updates",
    description: "Municipal and provincial pages may contain both current and archived items. Check the publication date and whether a notice has been superseded.",
    sources: [
      { title: "Greater Tzaneen Municipality", url: "https://www.greatertzaneen.gov.za/", description: "Dated municipal notices and local news." },
      { title: "Greater Tzaneen archived notices", url: "https://www.greatertzaneen.gov.za/?q=archived_notices", description: "Useful for discovery; entries include old and past service alerts." },
      { title: "Maruleng Local Municipality notices", url: "https://www.maruleng.gov.za/pages/notices.php", description: "Official notices/document list; it mixes recent and historical items and does not show a publication date for every document." },
      { title: "Mopani District Municipality notices", url: "https://www.mopani.gov.za/newsroom/notice.php", description: "Open linked documents to check their dates and affected communities." },
      { title: "Limpopo Public Works, Roads and Infrastructure", url: "https://www.dpw.limpopo.gov.za/", description: "Provincial roads, project information, notices and news." },
      { title: "Maruleng Local Municipality tenders", url: "https://www.maruleng.gov.za/pages/tenders.php", description: "Advertised, RFQ and awarded records are separate; an award or old tender does not prove work is underway." },
      { title: "Mopani District Municipality advertised tenders", url: "https://www.mopani.gov.za/tenders/adver_tenders.php", description: "A tender is procurement information, not proof that construction is underway." }
    ]
  },
  {
    id: "services",
    title: "Nearby public services",
    description: "The official records reviewed list Sekororo hospital separately from Sekororo clinic. The Post Office listing supports a Moetladimo branch; a branch officially named “Metz Post Office” was not verified.",
    sources: [
      { title: "Limpopo Department of Health — hospitals", url: "https://www.ldoh.gov.za/?q=node/18", description: "Official district hospital directory, including Sekororo hospital." },
      { title: "Limpopo Department of Health — clinics", url: "https://www.ldoh.gov.za/?q=node/26", description: "Official clinic directory; Sekororo clinic is a separate listing." },
      { title: "South African Post Office — branch locations", url: "https://www.postoffice.co.za/tools/postofficelocations.html", description: "Official location page and active-site branch list; confirm operating hours with the branch." },
      { title: "Maruleng Local Municipality — 2024/25 IDP", url: "https://lg.treasury.gov.za/supportingdocs/LIM335/LIM335_IDP%20Final_2025_Y_20240531T110414Z_mashilanem.pdf", description: "Municipal background and settlement context; not a live notice or current works feed." },
      { title: "Maruleng Thusong Service Centre", url: "https://www.gov.za/about-government/contact-directory/lp-thusong/maruleng-thusong-service-centre", description: "Government directory entry describing an address next to Sekororo Hospital in Metz Village." },
      { title: "Ga-Sekororo place reference", url: "https://www.geonames.org/1002777", description: "Gazetteer locality point used as the representative forecast location; not a household-level pin." }
    ]
  }
]);

export const COMMUNITY_PLACE_RECORDS = Object.freeze([
  {
    name: "Sekororo hospital",
    category: "Mopani District hospital",
    locality: "Sekororo, Maruleng Local Municipality, Limpopo",
    phone: "015 383 9400",
    sourceTitle: "Limpopo Department of Health — Mopani District Hospitals",
    sourceUrl: "https://www.ldoh.gov.za/?q=node/18",
    checkedAt: "2026-10-05",
    note: "The department lists the hospital separately from SEKORORO clinic. Confirm contact details before travel."
  },
  {
    name: "SEKORORO clinic",
    category: "Clinic",
    locality: "Maruleng, Mopani District, Limpopo",
    phone: "015 383 9925/26",
    sourceTitle: "Limpopo Department of Health — Mopani District Clinics",
    sourceUrl: "https://www.ldoh.gov.za/?q=node/26",
    checkedAt: "2026-10-05",
    note: "This is a separate facility listing from Sekororo hospital."
  },
  {
    name: "Moetladimo Branch",
    category: "South African Post Office — active-site listing",
    locality: "Limpopo East; postal code 0891",
    phone: "015 791 6053",
    sourceTitle: "South African Post Office — List of Post Offices (Active Sites)",
    sourceUrl: "https://www.postoffice.co.za/Tools/postoffices.pdf",
    checkedAt: "2026-10-05",
    note: "The checked official list does not name a ‘Metz Post Office’ or give a street address. Call to confirm current hours and location."
  },
  {
    name: "Mahlakung Shopping Centre",
    category: "Shopping centre (private project name, not a government facility record)",
    locality: "Metz, Limpopo",
    sourceTitle: "MDS Architecture — Mahlakung Shopping Centre project",
    sourceUrl: "https://www.mdsarch.co.za/portfolio-items/mahlakung-shopping-centre/",
    checkedAt: "2026-10-05",
    note: "The reviewed project page supports the name and locality, but not an authoritative street address or point coordinate."
  },
  {
    name: "Maruleng Thusong Service Centre",
    category: "Government service centre",
    locality: "Next to Sekororo Hospital, Maruleng Central, 75 Metz Village, Maruleng",
    sourceTitle: "South African Government — Maruleng Thusong Service Centre",
    sourceUrl: "https://www.gov.za/about-government/contact-directory/lp-thusong/maruleng-thusong-service-centre",
    checkedAt: "2026-10-05",
    note: "This is the address as published in the government directory; confirm before travelling."
  }
]);

export function shouldSearchCommunitySources(question) {
  const text = String(question || "").trim();
  if (!text || !LIVE_OR_LOCAL_INTENT.test(text) || !COMMUNITY_SOURCE_INTENT.test(text)) return false;
  const local = LOCAL_CONTEXT.test(text);
  const cues = [...text.matchAll(/\b(?:in|at|around|near|for)\s+([a-z][a-z'’-]*(?:\s+[a-z][a-z'’-]*){0,2})/gi)];
  const explicitPlace = cues.reverse().map(match => match[1].trim()).find(value => !GENERIC_PLACES.test(value));
  if (explicitPlace && !LOCAL_CONTEXT.test(explicitPlace)) return false;
  return local || !explicitPlace;
}

function sourceSeedsForQuestion(question) {
  const text = String(question || "");
  const nearby = NEARBY_CONTEXT.test(text);
  const provinceWide = /\b(?:limpopo|limpopians?|provincial|provincewide)\b/i.test(text) && !nearby;
  const national = /\b(?:south africa|national(?:ly)?|across the country)\b/i.test(text) && !nearby;
  const explicitLocation = /\b(?:in|at|around|near)\s+(?!me\b)[a-z]/i.test(text);
  const local = nearby || (!provinceWide && !national && !explicitLocation) || /\b(?:near me|my area|our area|around here)\b/i.test(text);
  const selected = [];
  const add = seed => { if (seed && !selected.includes(seed)) selected.push(seed); };

  if (JOB_INTENT.test(text)) {
    if (national) {
      add(SOURCE_SEEDS.find(seed => seed.id === "dpsa-jobs"));
      add(SOURCE_SEEDS.find(seed => seed.id === "gov-jobs"));
    } else if (provinceWide) {
      add(SOURCE_SEEDS.find(seed => seed.id === "limpopo-jobs"));
      add(SOURCE_SEEDS.find(seed => seed.id === "limpopo-erecruitment"));
      add(SOURCE_SEEDS.find(seed => seed.id === "dpsa-jobs"));
      add(SOURCE_SEEDS.find(seed => seed.id === "gov-jobs"));
    } else if (local) {
      add(SOURCE_SEEDS.find(seed => seed.id === "maruleng-jobs"));
      add(SOURCE_SEEDS.find(seed => seed.id === "gtm-jobs"));
      add(SOURCE_SEEDS.find(seed => seed.id === "mopani-jobs"));
      add(SOURCE_SEEDS.find(seed => seed.id === "limpopo-erecruitment"));
    } else {
      add(SOURCE_SEEDS.find(seed => seed.id === "limpopo-jobs"));
      add(SOURCE_SEEDS.find(seed => seed.id === "limpopo-erecruitment"));
      add(SOURCE_SEEDS.find(seed => seed.id === "dpsa-jobs"));
      add(SOURCE_SEEDS.find(seed => seed.id === "gov-jobs"));
    }
    const departmentIds = [];
    if (/\b(?:health|nurs(?:e|es|ing)|doctor|clinical|hospital|clinic)\b/i.test(text)) departmentIds.push("limpopo-erecruitment-health");
    if (/\b(?:education|teacher|teaching|school|educator)\b/i.test(text)) departmentIds.push("limpopo-erecruitment-education");
    if (/\b(?:public works|road|roads|infrastructure|engineer|construction|maintenance)\b/i.test(text)) departmentIds.push("limpopo-erecruitment-roads");
    if (/\b(?:agriculture|agricultural|farming|farmer)\b/i.test(text)) departmentIds.push("limpopo-erecruitment-agriculture");
    if (/\b(?:premier|administrative|administration)\b/i.test(text)) departmentIds.push("limpopo-erecruitment-premier");
    if (!national) {
      if (!departmentIds.length) departmentIds.push("limpopo-erecruitment-health");
      for (const id of departmentIds.slice(0, 1)) add(SOURCE_SEEDS.find(seed => seed.id === id));
    }
  }

  if (NOTICE_INTENT.test(text) || PROJECT_INTENT.test(text) || local) {
    if (PROJECT_INTENT.test(text) && /\b(?:tender|tenders|bid|procurement)\b/i.test(text)) {
      if (local) add(SOURCE_SEEDS.find(seed => seed.id === "maruleng-tenders"));
      add(SOURCE_SEEDS.find(seed => seed.id === "mopani-tenders"));
      add(SOURCE_SEEDS.find(seed => seed.id === "dpw-tenders"));
    }
    if (local) add(SOURCE_SEEDS.find(seed => seed.id === "maruleng-notices"));
    add(SOURCE_SEEDS.find(seed => seed.id === "gtm-notices"));
    add(SOURCE_SEEDS.find(seed => seed.id === "mopani-notices"));
    if (NOTICE_INTENT.test(text)) add(SOURCE_SEEDS.find(seed => seed.id === "gtm-notice-archive"));
    if (PROJECT_INTENT.test(text)) {
      add(SOURCE_SEEDS.find(seed => seed.id === "dpw-news"));
      add(SOURCE_SEEDS.find(seed => seed.id === "gtm-idp"));
      add(SOURCE_SEEDS.find(seed => seed.id === "mopani-news"));
    }
  }

  if (HEALTH_INTENT.test(text)) {
    add(SOURCE_SEEDS.find(seed => seed.id === "ldoh-hospitals"));
    add(SOURCE_SEEDS.find(seed => seed.id === "ldoh-clinics"));
  }
  if (POSTAL_INTENT.test(text)) add(SOURCE_SEEDS.find(seed => seed.id === "sapo-locations"));
  if (local && !selected.length) add(SOURCE_SEEDS.find(seed => seed.id === "maruleng-idp"));
  return selected.slice(0, MAX_ROOT_PAGES);
}

export function decodeHtmlEntities(value = "") {
  const named = { nbsp: " ", amp: "&", quot: "\"", apos: "'", lt: "<", gt: ">", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", mdash: "—", ndash: "–" };
  return String(value).replace(/&(#x[0-9a-f]+|#\d+|nbsp|amp|quot|apos|lt|gt|rsquo|lsquo|rdquo|ldquo|mdash|ndash);/gi, (entity, code) => {
    if (code[0] !== "#") return named[code.toLowerCase()] ?? entity;
    const point = code[1].toLowerCase() === "x" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
    try { return String.fromCodePoint(point); } catch { return entity; }
  });
}

export function stripCommunityHtml(value = "") {
  return decodeHtmlEntities(String(value)
    .replace(/<!--([\s\S]*?)-->/g, " ")
    .replace(/<(script|style|noscript|svg|nav|footer)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|li|h[1-6]|tr|div|section|article|blockquote|header)\s*>/gi, "\n")
    .replace(/<[^>]+>/g, " "))
    .replace(/[\t\f\v ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function normalizeCommunityUrl(value, baseUrl) {
  try {
    const url = new URL(decodeHtmlEntities(String(value || "").trim()), baseUrl);
    if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443")) return null;
    const host = url.hostname.toLowerCase();
    if (!ALLOWED_HOST_ROOTS.some(root => host === root || host.endsWith(`.${root}`))) return null;
    url.hash = "";
    return url.href;
  } catch {
    return null;
  }
}

function queryTerms(value) {
  const words = String(value || "").normalize("NFKC").toLowerCase().match(/[\p{L}\p{N}]+(?:[-'][\p{L}\p{N}]+)*/gu) || [];
  return [...new Set(words.filter(word => (word.length >= 3 || word === "ai") && !STOP_WORDS.has(word)))].slice(0, 20);
}

function findDate(text) {
  const value = String(text || "");
  return value.match(/\b20\d{2}-\d{2}-\d{2}\b/)?.[0]
    || value.match(/\b\d{1,2}[/. -]\d{1,2}[/. -]20\d{2}\b/)?.[0]
    || value.match(/\b\d{1,2}\s+(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+20\d{2}\b/i)?.[0]
    || value.match(/\b(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{1,2},?\s+20\d{2}\b/i)?.[0]
    || "";
}

function extractAnchors(markup, baseUrl) {
  const html = String(markup || "").slice(0, MAX_PAGE_BYTES);
  const anchors = /<a\b[^>]*href\s*=\s*(["'])(.*?)\1[^>]*>([\s\S]*?)<\/a>/gi;
  const output = [];
  const seen = new Set();
  let match;
  while ((match = anchors.exec(html)) && output.length < 100) {
    const url = normalizeCommunityUrl(match[2], baseUrl);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    const name = stripCommunityHtml(match[3]).replace(/\s+/g, " ").trim().slice(0, 180);
    if (!name) continue;
    const nearby = html.slice(Math.max(0, match.index - 220), Math.min(html.length, anchors.lastIndex + 320));
    const snippet = stripCommunityHtml(nearby).slice(0, 500);
    output.push({ name, url, date: findDate(snippet), snippet, source: "official-listing" });
  }
  return output;
}

function rankCandidates(question, candidates, boosts = /$^/) {
  const terms = queryTerms(question);
  const seen = new Set();
  return candidates.map((candidate, index) => {
    const name = String(candidate.name || "").toLowerCase();
    const url = String(candidate.url || "").toLowerCase();
    const snippet = String(candidate.snippet || "").toLowerCase();
    let score = Number(candidate.score) || 0;
    for (const term of terms) {
      if (name.includes(term)) score += 4;
      if (url.includes(term)) score += 2;
      if (snippet.includes(term)) score += 1;
    }
    if (boosts.test(`${name} ${url} ${snippet}`)) score += 2;
    if (/\.pdf(?:$|[?#])/i.test(url)) score += 0.5;
    return { ...candidate, score, originalIndex: index };
  }).filter(candidate => {
    if (!candidate.url || candidate.score <= 0 || seen.has(candidate.url)) return false;
    seen.add(candidate.url);
    return true;
  }).sort((a, b) => b.score - a.score || a.originalIndex - b.originalIndex);
}

function relevantExcerpt(value, question, limit = MAX_EXCERPT_CHARS) {
  const clean = String(value || "").replace(/\u0000/g, " ").replace(/[\t\f\v ]+/g, " ").replace(/ *\n */g, "\n").trim();
  if (clean.length <= limit) return clean;
  if (JOB_INTENT.test(question)) {
    const listingStart = clean.toLowerCase().lastIndexOf("available positions");
    if (listingStart >= 0) return clean.slice(listingStart).trim().slice(0, limit);
  }
  const terms = queryTerms(question);
  const lines = clean.split(/\n+/).map(line => line.trim()).filter(Boolean);
  if (lines.length < 2 || !terms.length) return clean.slice(0, limit);
  const scored = lines.map((line, index) => {
    const lower = line.toLowerCase();
    const score = terms.reduce((total, term) => total + (lower.includes(term) ? 1 : 0), 0);
    return { index, score };
  }).filter(entry => entry.score > 0).sort((a, b) => b.score - a.score);
  if (!scored.length) return clean.slice(0, limit);
  const chosen = new Set();
  for (const entry of scored) {
    for (let index = Math.max(0, entry.index - 1); index <= Math.min(lines.length - 1, entry.index + 1); index++) chosen.add(index);
    if ([...chosen].reduce((total, index) => total + lines[index].length + 1, 0) >= limit) break;
  }
  let excerpt = "";
  for (const index of [...chosen].sort((a, b) => a - b)) {
    const addition = `${excerpt ? "\n" : ""}${lines[index]}`;
    if (excerpt.length + addition.length > limit) {
      excerpt += addition.slice(0, limit - excerpt.length);
      break;
    }
    excerpt += addition;
  }
  return excerpt || clean.slice(0, limit);
}

async function fetchOfficialResponse(value, fetcher, deadlineAt) {
  let url = normalizeCommunityUrl(value);
  if (!url) return null;
  for (let redirects = 0; redirects <= 2; redirects++) {
    const remainingMs = Math.min(REQUEST_TIMEOUT_MS, deadlineAt - Date.now());
    if (remainingMs <= 0) return null;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), remainingMs);
    let response;
    try {
      response = await fetcher(url, {
        redirect: "manual",
        headers: { Accept: "text/html, text/plain, application/pdf;q=0.9", "User-Agent": "TMJ-AI-Agent/1.0" },
        signal: controller.signal
      });
    } catch (error) {
      clearTimeout(timer);
      throw error;
    }
    if (!response || typeof response.status !== "number") {
      clearTimeout(timer);
      return null;
    }
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      clearTimeout(timer);
      const location = response.headers?.get?.("location");
      if (!location) return null;
      url = normalizeCommunityUrl(new URL(location, url).href);
      if (!url) return null;
      continue;
    }
    if (!response.ok) {
      clearTimeout(timer);
      return null;
    }
    const finalUrl = normalizeCommunityUrl(response.url || url);
    if (!finalUrl) {
      clearTimeout(timer);
      return null;
    }
    const length = Number(response.headers?.get?.("content-length") || 0);
    if (length > MAX_PDF_BYTES) {
      clearTimeout(timer);
      return null;
    }
    return { response, url: finalUrl, cleanup: () => clearTimeout(timer) };
  }
  return null;
}

async function readBoundedBytes(response, maxBytes) {
  const reader = response.body?.getReader?.();
  if (!reader) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    return { bytes: bytes.slice(0, maxBytes), complete: bytes.byteLength <= maxBytes };
  }
  const chunks = [];
  let total = 0;
  let complete = true;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const remaining = maxBytes - total;
    if (value.byteLength > remaining) {
      if (remaining > 0) chunks.push(value.slice(0, remaining));
      total = maxBytes;
      complete = false;
      try { await reader.cancel(); } catch { /* response size limit reached */ }
      break;
    }
    chunks.push(value);
    total += value.byteLength;
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { bytes, complete };
}

async function fetchOfficialDocument(candidate, fetcher, pdfParser, question, deadlineAt) {
  let result;
  try {
    const initialUrl = normalizeCommunityUrl(candidate.url);
    if (!initialUrl) return null;
    result = await fetchOfficialResponse(initialUrl, fetcher, deadlineAt);
    if (!result) return null;
    const response = result.response;
    const contentType = String(response.headers?.get?.("content-type") || "").toLowerCase();
    const isPdf = /\.pdf(?:$|[?#])/i.test(result.url) || contentType.includes("application/pdf");
    let text = "";
    let pdfLinks = [];
    if (isPdf) {
      if (typeof pdfParser !== "function") return null;
      const declaredSize = Number(response.headers?.get?.("content-length") || 0);
      if (declaredSize > MAX_PDF_BYTES) return null;
      const { bytes, complete } = await readBoundedBytes(response, MAX_PDF_BYTES);
      if (!complete) return null;
      const parsed = await pdfParser(bytes);
      text = String(parsed?.text || "");
    } else {
      if (contentType && !contentType.includes("text/html") && !contentType.includes("text/plain")) return null;
      const { bytes } = await readBoundedBytes(response, MAX_PAGE_BYTES);
      const markup = new TextDecoder().decode(bytes);
      text = contentType.includes("text/plain") ? markup : stripCommunityHtml(markup);
      pdfLinks = extractAnchors(markup, result.url).filter(link => /\.pdf(?:$|[?#])/i.test(link.url));
    }
    const completeText = `${candidate.snippet || ""}\n${text}`.replace(/\u0000/g, " ").trim();
    const content = relevantExcerpt(completeText, question, MAX_EXCERPT_CHARS);
    if (content.length < 35) return null;
    const titleMatch = isPdf ? null : text.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
    const title = titleMatch ? stripCommunityHtml(titleMatch[1]).slice(0, 180) : candidate.name;
    return {
      name: String(candidate.name || candidate.title || title || "Official public source").slice(0, 180),
      url: result.url,
      date: String(candidate.date || "").slice(0, 50),
      type: "official_public",
      content,
      pdfLinks,
      score: Number(candidate.score) || 0
    };
  } catch {
    return null;
  } finally {
    result?.cleanup?.();
  }
}

export async function searchCommunitySources(question, options = {}) {
  const fetcher = options.fetcher || globalThis.fetch;
  const pdfParser = options.pdfParser;
  const searchUrl = SOURCE_SEARCH_LINK;
  if (!shouldSearchCommunitySources(question) || typeof fetcher !== "function") return { searchUrl, checkedAt: new Date().toISOString(), sources: [] };
  const requestedBudget = Number(options.budgetMs);
  const budgetMs = Number.isFinite(requestedBudget) ? Math.min(Math.max(requestedBudget, 1), SEARCH_BUDGET_MS) : SEARCH_BUDGET_MS;
  const deadlineAt = Date.now() + budgetMs;
  const seeds = sourceSeedsForQuestion(question).slice(0, MAX_ROOT_PAGES);
  if (!seeds.length) return { searchUrl, checkedAt: new Date().toISOString(), sources: [] };

  const roots = await Promise.all(seeds.map(async seed => {
    const fetched = await fetchOfficialDocument({ ...seed, score: 15, snippet: "" }, fetcher, pdfParser, question, deadlineAt);
    if (!fetched) return null;
    fetched.seedId = seed.id;
    fetched.pdfLinks = fetched.pdfLinks.map(link => ({ ...link, score: 2, rootId: seed.id }));
    return fetched;
  }));
  const rootSources = roots.filter(Boolean);
  const allLinks = rootSources.flatMap(source => source.pdfLinks || []);
  const rankedLinks = deadlineAt > Date.now() ? rankCandidates(question, allLinks).slice(0, MAX_DETAIL_PAGES) : [];
  const details = await Promise.all(rankedLinks.map(link => fetchOfficialDocument(link, fetcher, pdfParser, question, deadlineAt)));
  const sources = [];
  const seen = new Set();
  for (const source of [...details.filter(Boolean), ...rootSources].sort((a, b) => b.score - a.score)) {
    if (!source.content || seen.has(source.url)) continue;
    seen.add(source.url);
    sources.push({ name: source.name, url: source.url, date: source.date || "", type: source.type, content: source.content });
    if (sources.length >= MAX_SOURCES) break;
  }
  const checkedAt = new Date().toISOString();
  for (const source of sources) source.checkedAt = checkedAt;
  return { searchUrl, checkedAt, sources };
}
