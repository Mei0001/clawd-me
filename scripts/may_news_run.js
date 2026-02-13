const fs = require('fs');
const Parser = require('rss-parser');

const feedsPath = process.argv[2] || 'data/may_news_feeds.json';
const statePath = process.argv[3] || 'data/may_news_state.json';
const outCandidatesPath = process.argv[4] || 'data/_may_news_candidates.json';

function readJson(p){
  return JSON.parse(fs.readFileSync(p,'utf8'));
}

function writeJson(p, obj){
  fs.mkdirSync(require('path').dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(obj, null, 2));
}

function normUrl(raw){
  try {
    const u = new URL(raw);
    // strip common tracking
    ['utm_source','utm_medium','utm_campaign','utm_term','utm_content','ref','s','cmpid'].forEach(k=>u.searchParams.delete(k));
    // Some feeds use ?output=1 etc; keep other params.
    // drop empty ?
    if ([...u.searchParams.keys()].length === 0) u.search = '';
    return u.toString();
  } catch {
    return raw;
  }
}

function toIsoDate(item){
  const d = item.isoDate || item.pubDate || item.published || item.date;
  const dt = d ? new Date(d) : null;
  if (!dt || isNaN(dt)) return null;
  return dt.toISOString();
}

async function main(){
  const feeds = readJson(feedsPath);
  const state = readJson(statePath);
  const cutoff = new Date(state.lastRun || Date.now() - 24*3600*1000);
  const parser = new Parser({
    timeout: 20000,
    requestOptions: { timeout: 20000 }
  });

  async function parseWithTimeout(url, ms=25000){
    return await Promise.race([
      parser.parseURL(url),
      new Promise((_, rej)=>setTimeout(()=>rej(new Error('Timeout after '+ms+'ms')), ms))
    ]);
  }

  const seen = new Set((state.seenUrls || []).map(normUrl));
  const now = new Date();
  const items = [];
  const errors = [];

  for (const [cat, list] of Object.entries(feeds)){
    for (const f of list){
      try {
        const feed = await parseWithTimeout(f.rss);
        for (const it of (feed.items || [])){
          const iso = toIsoDate(it);
          if (!iso) continue;
          const dt = new Date(iso);
          if (dt <= cutoff) continue;
          const link = normUrl(it.link || it.guid || '');
          if (!link) continue;
          if (seen.has(link)) continue;
          items.push({
            cat,
            source: f.name,
            title: (it.title || '').trim(),
            link,
            published: iso,
            summary: (it.contentSnippet || it.summary || it.content || '').toString().replace(/\s+/g,' ').trim().slice(0, 500)
          });
        }
      } catch (err){
        errors.push({ cat, name: f.name, rss: f.rss, err: String(err) });
      }
    }
  }

  // global de-dupe by link
  const uniq = new Map();
  for (const it of items){
    if (!uniq.has(it.link)) uniq.set(it.link, it);
  }
  const out = Array.from(uniq.values()).sort((a,b)=>b.published.localeCompare(a.published));

  const result = {
    generatedAt: now.toISOString(),
    cutoff: cutoff.toISOString(),
    count: out.length,
    items: out,
    errors
  };

  writeJson(outCandidatesPath, result);
  // Also print brief
  console.log(JSON.stringify({ count: out.length, errors: errors.length, cutoff: cutoff.toISOString() }, null, 2));
  process.exit(0);
}

main().catch(e=>{ console.error(e); process.exit(1); });
