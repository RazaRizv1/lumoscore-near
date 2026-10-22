// The NEAR urls for sitemap.xml: every curated token page and the liquid Rhea pool pages.
//
// Built by _tools/_nearsitemapgen.js and BAKED into BAKED below by the combine (C:\LumosCore-Deploy\chains\
// near.js), which also adds the two lines to sitemap.xml.js that call this. Nothing is fetched per request:
// NEAR's list is curated, and a live fetch that failed would publish no NEAR pages without any error.
// Kept as its own module because sitemap.xml.js belongs to the Stellar repo and NEAR work does not touch it.

// Filled in by the LumosCore combine from _tools/nearsitemap.generated.json.
const BAKED = [];

export async function nearSitemapUrls() {
  return BAKED;
}
