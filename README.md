# Pop Fuel blog stats automation

Pulls GA4 pageview data for the blog once a day (or week) and publishes a
small `blog-stats.json` file that the storefront reads to populate the
Latest / Trending / Most Viewed sections dynamically, instead of the manually
typed-in snapshot that's there today.

## How it fits together

1. A GitHub Actions workflow runs on a schedule.
2. It runs `scripts/update-blog-stats.mjs`, which calls the GA4 Data API
   (read-only) and writes `public/blog-stats.json`.
3. The workflow publishes that `public/` folder to GitHub Pages.
4. The storefront's client-side JS fetches that JSON file at page load and
   renders the three sections from it.

Nothing here touches BigCommerce or requires a BigCommerce API account --
the only credential involved is a read-only GA4 service account.

## One-time setup

### 1. Create a Google Cloud service account with GA4 read access

You (or whoever owns the Google Cloud / GA4 account) will need to do this --
I can't create credentials on your behalf.

1. Go to https://console.cloud.google.com/ and either pick an existing
   project or create a new one (any name, e.g. "clipstrip-blog-stats").
2. In the left menu, go to **APIs & Services -> Library**, search for
   "Google Analytics Data API", and click **Enable**.
3. Go to **APIs & Services -> Credentials -> Create Credentials -> Service
   account**. Give it any name (e.g. `blog-stats-reader`). You don't need to
   grant it any project-level roles -- click through and finish.
4. Open the service account you just created, go to the **Keys** tab,
   **Add Key -> Create new key -> JSON**, and download it. This file contains
   a `client_email` and `private_key` -- keep it private, don't commit it
   anywhere.
5. Go to https://analytics.google.com/, open **Admin** for the Clip Strip
   Corp GA4 property, go to **Property Access Management**, click the **+**
   button, and add the service account's email address (the `client_email`
   value from the JSON file, looks like
   `blog-stats-reader@your-project.iam.gserviceaccount.com`) with the
   **Viewer** role. This is read-only -- it can't change anything in GA4.
6. Note your **GA4 property ID**: in GA4 Admin -> Property Settings, it's the
   numeric ID at the top (e.g. `384021110` -- NOT the "measurement ID" that
   starts with `G-`).

### 2. Create the GitHub repo and add secrets

1. Create a new (can be private) GitHub repo and push these files to it.
2. Go to the repo's **Settings -> Secrets and variables -> Actions**, and add
   two repository secrets:
   - `GA4_PROPERTY_ID` -- the numeric property ID from step 1.6 above.
   - `GA4_SERVICE_ACCOUNT_JSON` -- paste the *entire contents* of the JSON key
     file you downloaded in step 1.4, as-is.
3. Go to **Settings -> Pages**, and under "Build and deployment", set
   **Source: Deploy from a branch**, **Branch: gh-pages** (the workflow
   creates this branch automatically on its first run -- if it's not listed
   yet, run the workflow once first via the Actions tab, then come back here).
4. Once Pages is live, your JSON will be reachable at:
   `https://<your-github-username>.github.io/<repo-name>/blog-stats.json`

### 3. Run it once manually to confirm it works

Go to the repo's **Actions** tab, select "Update blog stats from GA4" in the
left sidebar, click **Run workflow**. Check the run's logs -- it should print
how many Most Viewed / Trending posts it found. Then visit the Pages URL
from step 2.4 above and confirm you see real data.

### 4. Wire it into the theme

This part I'll do directly once the JSON feed is live -- I'll pull the
current blog.html / blog-post.html from the Stencil file editor and swap the
static snapshot for a fetch against your `blog-stats.json` URL (see
`storefront-fetch-example.js` in this folder for the general shape of what
that looks like).

## Adjusting the schedule

Daily vs. weekly is just the `cron` line in
`.github/workflows/update-blog-stats.yml`:

- Daily at 6am UTC (default): `0 6 * * *`
- Weekly, every Monday at 6am UTC: `0 6 * * 1`

## Adjusting what counts as "Trending"

`TRENDING_WINDOW_DAYS` (default 7) controls the lookback window for
Trending. `TOP_N` (default 6) controls how many posts show up in each list.
Both can be set as extra repo secrets or left at their defaults -- see the
commented-out `env:` lines in the workflow file.
