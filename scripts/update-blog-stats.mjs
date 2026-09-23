/**
 * update-blog-stats.mjs
 *
 * Pulls Pop Fuel blog pageview data from Google Analytics 4 (GA4 Data API)
 * and writes a small JSON file that the storefront reads to render the
 * "Latest / Trending / Most Viewed" widgets dynamically.
 *
 * This script does NOT touch BigCommerce at all. It only reads from GA4 and
 * writes a JSON file to ./public/blog-stats.json in this repo. The GitHub
 * Actions workflow (see .github/workflows/update-blog-stats.yml) commits
 * that file and GitHub Pages serves it as a plain static file, which the
 * theme fetches at page-load time. No BigCommerce API account is required
 * for this piece.
 *
 * Required environment variables (set as GitHub Actions secrets, see README.md):
 *   GA4_PROPERTY_ID              - numeric GA4 property id, e.g. "384021110"
 *   GA4_SERVICE_ACCOUNT_JSON     - the full contents of the service account
 *                                  JSON key file (as a single-line string)
 *
 * Optional environment variables:
 *   BLOG_PATH_PREFIX             - default "/p-o-p-fuel-a-merchandisers-blog/"
 *   BLOG_LAUNCH_DATE             - "all time" start date for Most Viewed,
 *                                  format YYYY-MM-DD, default "2020-01-01"
 *   TRENDING_WINDOW_DAYS         - lookback window for Trending, default 7
 *   TOP_N                        - how many posts per list, default 6
 */

import { BetaAnalyticsDataClient } from '@google-analytics/data';
import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

const PROPERTY_ID = requireEnv('GA4_PROPERTY_ID');
const SERVICE_ACCOUNT_JSON = requireEnv('GA4_SERVICE_ACCOUNT_JSON');

const BLOG_PATH_PREFIX = process.env.BLOG_PATH_PREFIX || '/p-o-p-fuel-a-merchandisers-blog/';
const BLOG_LAUNCH_DATE = process.env.BLOG_LAUNCH_DATE || '2020-01-01';
const TRENDING_WINDOW_DAYS = Number(process.env.TRENDING_WINDOW_DAYS || 7);
const TOP_N = Number(process.env.TOP_N || 6);

function requireEnv(name) {
    const value = process.env[name];
    if (!value) {
          console.error(`Missing required environment variable: ${name}`);
          process.exit(1);
    }
    return value;
}

// The service account key is passed in as a JSON string (see README for how
// to put it into a GitHub secret). Parse it and hand it to the client
// directly, rather than writing it to a credentials file on disk.
const credentials = JSON.parse(SERVICE_ACCOUNT_JSON);

const analyticsDataClient = new BetaAnalyticsDataClient({
    credentials: {
          client_email: credentials.client_email,
          private_key: credentials.private_key,
    },
    projectId: credentials.project_id,
});

/**
 * Runs a GA4 report for pagePath + pageTitle + screenPageViews over a given
 * date range, restricted to the blog, and returns the top N pages sorted by
 * views descending. Excludes the blog index page itself and any /tag/...
 * listing pages, since we only want individual post pages here.
 */
async function topBlogPosts({ startDate, endDate, limit }) {
    const [response] = await analyticsDataClient.runReport({
          property: `properties/${PROPERTY_ID}`,
          dateRanges: [{ startDate, endDate }],
          dimensions: [{ name: 'pagePath' }, { name: 'pageTitle' }],
          metrics: [{ name: 'screenPageViews' }],
          dimensionFilter: {
                  andGroup: {
                            expressions: [
                              {
                                            filter: {
                                                            fieldName: 'pagePath',
                                                            stringFilter: { matchType: 'BEGINS_WITH', value: BLOG_PATH_PREFIX },
                                            },
                              },
                              {
                                            notExpression: {
                                                            filter: {
                                                                              fieldName: 'pagePath',
                                                                              stringFilter: { matchType: 'CONTAINS', value: '/tag/' },
                                                            },
                                            },
                              },
                                      ],
                  },
          },
          orderBys: [{ metric: { metricName: 'screenPageViews' }, desc: true }],
          limit: 200, // pull extra rows; we de-dupe/trim below
    });

  const rows = response.rows || [];
    const seenPaths = new Set();
    const posts = [];

  for (const row of rows) {
        const pagePath = row.dimensionValues[0].value;
        const pageTitle = row.dimensionValues[1].value;
        const views = Number(row.metricValues[0].value || 0);

      // Skip the blog index/root and anything that isn't a real post page
      // (e.g. "/p-o-p-fuel-a-merchandisers-blog/" or "...blog/?sort=trending").
      const trimmed = pagePath.replace(BLOG_PATH_PREFIX, '').replace(/^\/|\/$/g, '');
        if (!trimmed || trimmed.includes('?')) continue;

      // GA4 sometimes reports the same post's path more than once if there are
      // query-string variants; keep only the first (highest-view) occurrence.
      const cleanPath = pagePath.split('?')[0];
        if (seenPaths.has(cleanPath)) continue;
        seenPaths.add(cleanPath);

      posts.push({
              title: pageTitle.replace(/\s*-\s*Clip Strip Corp\.?\s*$/i, '').trim(),
              url: cleanPath,
              views,
      });
  }

  return posts.slice(0, limit);
}

function isoDateDaysAgo(days) {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - days);
    return d.toISOString().slice(0, 10);
}

async function main() {
    const today = new Date().toISOString().slice(0, 10);

  console.log(`Pulling "Most Viewed" (all-time: ${BLOG_LAUNCH_DATE} to ${today})...`);
    const mostViewed = await topBlogPosts({
          startDate: BLOG_LAUNCH_DATE,
          endDate: today,
          limit: TOP_N,
    });

  console.log(`Pulling "Trending" (last ${TRENDING_WINDOW_DAYS} days)...`);
    const trending = await topBlogPosts({
          startDate: isoDateDaysAgo(TRENDING_WINDOW_DAYS),
          endDate: today,
          limit: TOP_N,
    });

  const payload = {
        generatedAt: new Date().toISOString(),
        trendingWindowDays: TRENDING_WINDOW_DAYS,
        mostViewed,
        trending,
  };

  const outDir = path.resolve('public');
    await mkdir(outDir, { recursive: true });
    const outPath = path.join(outDir, 'blog-stats.json');
    await writeFile(outPath, JSON.stringify(payload, null, 2));

  console.log(`Wrote ${outPath}`);
    console.log(`  Most Viewed: ${mostViewed.length} posts`);
    console.log(`  Trending:    ${trending.length} posts`);
}

main().catch((err) => {
    console.error('Failed to update blog stats:', err);
    process.exit(1);
});
