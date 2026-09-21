const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-5.6-luna';

function clean(value, fallback='') {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function localChat(message, ads=[]) {
  const q = clean(message).toLowerCase();
  const budgetMatch = q.match(/(?:chini ya|under|less than|hadi)\s*(?:tsh\s*)?([\d,\.]+)/i);
  const budget = budgetMatch ? Number(budgetMatch[1].replace(/[,\.]/g, '')) : null;
  const words = q.split(/\s+/).filter(Boolean);
  const results = ads.filter(a => {
    const hay = [a.name, a.category, a.desc].map(v => String(v || '').toLowerCase()).join(' ');
    const matchesWord = words.some(w => w.length >= 3 && hay.includes(w));
    const matchesBudget = budget == null || (Number(a.price) > 0 && Number(a.price) <= budget);
    return matchesWord && matchesBudget;
  }).slice(0, 5);

  if (results.length) {
    return 'Nimepata hizi bidhaa kwenye SokoAds:\n' +
      results.map((a, i) => `${i + 1}. ${a.name} — TSh ${Number(a.price || 0).toLocaleString('en-TZ')}${a.category ? ' (' + a.category + ')' : ''}`).join('\n') +
      '\n\nUnaweza kutumia search ya Marketplace kuona tangazo kamili.';
  }

  if (/habari|hello|hi|mambo|vipi/.test(q)) {
    return 'Habari! 👋 Mimi ni SokoAds AI. Naweza kukusaidia kutafuta bidhaa kwenye catalog au kuboresha tangazo lako.';
  }

  if (/tangazo|advert|maelezo|description/.test(q)) {
    return 'Ninaweza kukusaidia kuboresha tangazo. Andika jina la bidhaa, bei na maelezo yake kwenye sehemu ya “Weka Tangazo”, kisha bonyeza “AI Andika Maelezo”.';
  }

  return 'Kwa sasa SokoAds AI iko kwenye hali ya msingi kwa sababu huduma ya AI ya mtandaoni haina credits. Bado naweza kukusaidia kutafuta bidhaa zilizopo kwenye SokoAds. Jaribu mfano: “Natafuta simu chini ya TSh 500,000”.';
}

async function openai(prompt) {
  if (!OPENAI_API_KEY) {
    const e = new Error('AI is not configured. Add OPENAI_API_KEY to the server environment.');
    e.status = 503;
    throw e;
  }

  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + OPENAI_API_KEY,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      input: prompt,
      max_output_tokens: 700
    })
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const e = new Error(data.error?.message || 'AI request failed.');
    e.status = response.status;
    throw e;
  }

  const text = data.output_text || (Array.isArray(data.output)
    ? data.output.flatMap(x => x.content || []).map(x => x.text || '').join('')
    : '');

  return text.trim();
}

async function chat(message, ads=[]) {
  const catalog = ads.slice(0,40).map(a => ({
    name:a.name, price:a.price, category:a.category, desc:a.desc, featured:!!a.featured
  }));

  const prompt = [
    'You are SokoAds AI, a helpful Swahili-first marketplace assistant for Tanzania.',
    'Help users discover products, understand listings, improve ads, and answer general marketplace questions.',
    'Never invent a product, price, seller, phone number, payment status, or availability. Use only the catalog when recommending products.',
    'If the catalog does not contain a suitable product, say so clearly and suggest a search/category instead.',
    'Keep answers concise, friendly, practical, and in Swahili unless the user asks for English.',
    'Current SokoAds catalog JSON:',
    JSON.stringify(catalog),
    'User message:',
    clean(message)
  ].join('\n\n');

  try {
    return await openai(prompt);
  } catch (error) {
    console.error('SokoAds AI online provider unavailable:', error.message);
    return localChat(message, ads);
  }
}

async function writeAd(body) {
  const name=clean(body.name), category=clean(body.category,'General');
  const price=clean(String(body.price||'')), notes=clean(body.notes);

  const prompt = [
    'You are an expert Tanzanian marketplace copywriter.',
    'Write a truthful SokoAds listing in Swahili. Do not invent specifications or claims.',
    'Return exactly three short sections: TITLE, DESCRIPTION, TAGS.',
    'Make the title attractive but accurate; description should be ready to paste; tags should be comma-separated.',
    'Product:', name, 'Category:', category, 'Price:', price, 'Seller notes:', notes
  ].join('\n');

  try {
    return await openai(prompt);
  } catch (error) {
    console.error('SokoAds AI copywriter unavailable:', error.message);
    const safeNotes = notes || 'Wasiliana na muuzaji kwa maelezo zaidi.';
    return [
      'TITLE: ' + name,
      'DESCRIPTION: ' + name + (category ? ' — ' + category + '.' : '.') + ' Bei: TSh ' + (price || 'Wasiliana na muuzaji') + '. ' + safeNotes + ' Wasiliana na muuzaji kwa maelezo zaidi.',
      'TAGS: SokoAds, ' + category + ', ' + name
    ].join('\n');
  }
}

module.exports = { chat, writeAd };
