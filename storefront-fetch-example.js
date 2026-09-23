/**
 * storefront-fetch-example.js
 *
 * REFERENCE snippet showing how the theme's client-side JS should consume
 * blog-stats.json once it's live on GitHub Pages. This is NOT a drop-in file --
 * your current blog.html / blog-post.html markup changed while this was being
 * planned out, so the exact selectors below will need to be matched up to
 * whatever IDs/classes your "Most Viewed" and "Trending" sections use now.
 * Send me the current theme files (or let me pull them from the live site)
 * and I'll wire this into the real markup directly rather than guessing.
 *
 * The one part that WON'T change regardless of markup: the fetch URL and the
 * shape of the data coming back.
 */

const BLOG_STATS_URL = 'https://<your-github-username>.github.io/<your-repo-name>/blog-stats.json';

async function loadBlogStats() {
  try {
    // cache: 'default' is fine here -- the file only changes once a day/week,
    // and GitHub Pages sets sane cache headers on its own.
    const res = await fetch(BLOG_STATS_URL);
    if (!res.ok) throw new Error(`blog-stats.json fetch failed: ${res.status}`);
    return await res.json();
    // Shape:
    // {
    //   generatedAt: "2026-09-23T06:00:12.000Z",
    //   trendingWindowDays: 7,
    //   mostViewed: [{ title, url, views }, ...],  // up to TOP_N, all-time
    //   trending:   [{ title, url, views }, ...],  // up to TOP_N, last N days
    // }
  } catch (err) {
    console.warn('Could not load blog-stats.json, leaving widgets as-is:', err);
    return null;
  }
}

function renderList(container, posts) {
  if (!container || !posts || !posts.length) return;
  container.innerHTML = posts
    .map(
      (p, i) => `
      <li>
        <a href="${p.url}">${p.title}<span class="blog-popular-views">${p.views.toLocaleString()} views</span></a>
      </li>`
    )
    .join('');
}

(async function initDynamicBlogWidgets() {
  const stats = await loadBlogStats();
  if (!stats) return; // fetch failed -- leave whatever static/fallback markup is already there

  // --- Most Viewed sidebar (adjust selector to match current markup) ---
  const mostViewedList = document.querySelector('.blog-popular-list');
  renderList(mostViewedList, stats.mostViewed);

  // --- Trending tab (adjust to however the tab currently swaps content) ---
  // If Trending is still driven by a ?sort=trending query param read on load,
  // hook in here instead of a click handler:
  const params = new URLSearchParams(location.search);
  if (params.get('sort') === 'trending') {
    const grid = document.querySelector('.blog-card-grid');
    // Trending posts don't have full card markup (image, excerpt, category
    // badge) from GA4 alone -- only title/url/views -- so this is a simplified
    // render. We can decide together whether Trending should reuse the full
    // card layout (fetching post metadata from BigCommerce) or a simpler list
    // like Most Viewed's.
    if (grid) {
      grid.innerHTML = stats.trending
        .map((p) => `<div class="blog-card"><a href="${p.url}">${p.title}</a> <span>${p.views} views (${stats.trendingWindowDays}d)</span></div>`)
        .join('');
    }
  }
})();
