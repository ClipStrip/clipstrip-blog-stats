import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export function combineRows(rows, prefix) {
  const counts = {};
  for (const row of rows) {
    const raw = row.dimensionValues[0].value.split('?')[0];
    if (!raw.startsWith(prefix)) continue;
    const slug = raw.slice(prefix.length).replace(/\/$/, '');
    if (!slug || slug.includes('/')) continue;
    const url = prefix + slug + '/';
    const count = Number(row.metricValues[0].value);
    if (Number.isFinite(count) && count >= 0) counts[url] = (counts[url] || 0) + count;
  }
  return counts;
}
export function dateRange(today, days) {
  const date = new Date(today + 'T12:00:00Z');
  date.setUTCDate(date.getUTCDate() - days + 1);
  return { startDate: date.toISOString().slice(0,10), endDate: today };
}
export function ranked(counts) {
  return Object.entries(counts).map(([url,views]) => ({url,views})).sort((a,b)=>b.views-a.views || a.url.localeCompare(b.url));
}
function decode(text) {
  return text.replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;|&apos;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&#(\d+);/g,(_,n)=>String.fromCodePoint(Number(n)));
}
async function enrich(post, origin) {
  const fallback = {...post,title:post.url.split('/').filter(Boolean).at(-1).replace(/-/g,' '),image:''};
  try {
    const response = await fetch(new URL(post.url,origin), {signal:AbortSignal.timeout(15000)});
    if(!response.ok) throw Error('Article unavailable');
    const html = await response.text();
    const meta = name => {
      const tags = html.match(/<meta\b[^>]*>/gi) || [];
      const tag = tags.find(t=>t.includes('"'+name+'"') || t.includes("'"+name+"'"));
      return decode(tag?.match(/content\s*=\s*["']([^"']*)["']/i)?.[1] || '');
    };
    const title = meta('og:title') || decode(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || fallback.title);
    const image = meta('og:image');
    return {...post,title:title.replace(/\s*[-|]\s*(Clip Strip Corp\.?|Lola Products)\s*$/i,'').trim(),image:/^https:\/\//.test(image)?image:''};
  } catch { return fallback; }
}
async function report(client, propertyId, prefix, startDate, endDate) {
  const rows=[];
  let offset=0;
  while(true){
    const [result] = await client.runReport({property:'properties/'+propertyId,dateRanges:[{startDate,endDate}],dimensions:[{name:'pagePath'}],metrics:[{name:'screenPageViews'}],dimensionFilter:{filter:{fieldName:'pagePath',stringFilter:{matchType:'BEGINS_WITH',value:prefix}}},limit:10000,offset});
    rows.push(...(result.rows||[]));
    offset += (result.rows||[]).length;
    if(offset >= Number(result.rowCount||0) || !result.rows?.length) break;
  }
  return combineRows(rows,prefix);
}
async function update(config) {
  const {BetaAnalyticsDataClient}=await import('@google-analytics/data');
  const credentials=JSON.parse(config.credentials);
  const client=new BetaAnalyticsDataClient({credentials:{client_email:credentials.client_email,private_key:credentials.private_key},projectId:credentials.project_id});
  // Use the last completed day in the stores' timezone; avoid partial-day rankings.
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());
  const part=type=>parts.find(x=>x.type===type).value;
  const date=new Date(part('year')+'-'+part('month')+'-'+part('day')+'T12:00:00Z');
  date.setUTCDate(date.getUTCDate()-1);
  const end=date.toISOString().slice(0,10), recent=dateRange(end,7), start='2020-01-01';
  const [allTimeCounts,recentCounts]=await Promise.all([report(client,config.id,config.prefix,start,end),report(client,config.id,config.prefix,recent.startDate,end)]);
  const popular=ranked(allTimeCounts).slice(0,6), trending=ranked(recentCounts).slice(0,6);
  const unique=[...new Map([...popular,...trending].map(p=>[p.url,p])).values()];
  const enriched=await Promise.all(unique.map(p=>enrich(p,config.origin)));
  const metadata=new Map(enriched.map(p=>[p.url,p]));
  const decorate=rows=>rows.map(p=>({...metadata.get(p.url),views:p.views}));
  const payload={generatedAt:new Date().toISOString(),source:'Google Analytics 4 API',propertyId:config.id,timeZone:'America/New_York',dataThrough:end,includesPartialToday:false,trendingWindowDays:7,mostViewedRange:{startDate:start,endDate:end},trendingRange:recent,mostViewed:decorate(popular),trending:decorate(trending),allTimeCounts,recentCounts};
  await mkdir('public',{recursive:true});
  await writeFile(resolve('public',config.file),JSON.stringify(payload,null,2));
  console.log(config.name+': updated '+Object.keys(allTimeCounts).length+' article counts through '+end);
}
async function main(){
  if(!process.env.GA4_SERVICE_ACCOUNT_JSON || !process.env.GA4_PROPERTY_ID) throw Error('ClipStrip analytics configuration is missing');
  await update({name:'ClipStrip',id:process.env.GA4_PROPERTY_ID,credentials:process.env.GA4_SERVICE_ACCOUNT_JSON,prefix:'/p-o-p-fuel-a-merchandisers-blog/',origin:'https://www.clipstrip.com',file:'blog-stats.json'});
  if(process.env.LOLA_GA4_SERVICE_ACCOUNT_JSON){
    await update({name:'Lola',id:'384021303',credentials:process.env.LOLA_GA4_SERVICE_ACCOUNT_JSON,prefix:'/blogs/news/',origin:'https://lolaproducts.com',file:'lola-blog-stats.json'});
  } else console.log('Lola credential not yet configured; ClipStrip refresh remains active.');
}
if(process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main().catch(error=>{console.error('Statistics refresh failed:',error.message);process.exitCode=1;});
