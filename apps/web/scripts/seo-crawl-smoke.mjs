import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const baseUrl = new URL(process.env.SEO_CRAWL_BASE_URL ?? "http://127.0.0.1:3001");
const canonicalOrigin = "https://fastque.com";
const webRoot = fileURLToPath(new URL("..", import.meta.url));

function decodeXml(value) {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'");
}

async function get(path) {
  const response = await fetch(new URL(path, baseUrl));
  const body = await response.text();
  return { response, body };
}

const robots = await get("/robots.txt");
assert.equal(robots.response.status, 200, "robots.txt should be served successfully");
assert.match(robots.body, /Sitemap:\s*https:\/\/fastque\.com\/sitemap\.xml/i);
assert.match(robots.body, /Sitemap:\s*https:\/\/fastque\.com\/sitemap-guides\.xml/i);

const xmlValidator = process.platform === "win32" ? "py" : "python3";
const xmlArgs = process.platform === "win32"
  ? ["-3", "-c", "import sys, xml.etree.ElementTree as ET; ET.fromstring(sys.stdin.buffer.read())"]
  : ["-c", "import sys, xml.etree.ElementTree as ET; ET.fromstring(sys.stdin.buffer.read())"];
async function readSitemap(path) {
  const sitemap = await get(path);
  assert.equal(sitemap.response.status, 200, `${path} should be served successfully`);
  assert.match(sitemap.response.headers.get("content-type") ?? "", /xml/i);
  assert.match(sitemap.body, /^<\?xml\s+version="1\.0"/i);
  assert.match(sitemap.body, /<urlset\b[^>]*xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9"/i);
  assert.match(sitemap.body, /<\/urlset>\s*$/i);
  const parsed = spawnSync(xmlValidator, xmlArgs, { input: sitemap.body, encoding: "utf8" });
  assert.equal(parsed.status, 0, `${path} XML must parse: ${parsed.stderr || parsed.error?.message || "unknown parser error"}`);
  return [...sitemap.body.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => decodeXml(match[1]));
}

const urls = await readSitemap("/sitemap.xml");
const guideUrls = await readSitemap("/sitemap-guides.xml");
assert.deepEqual(guideUrls, [
  "https://fastque.com/how-to-book",
  "https://fastque.com/how-live-queue-works",
  "https://fastque.com/salon-management-software",
]);
assert.ok(urls.length >= 10, "sitemap should include static and real discovery URLs");
assert.equal(new Set(urls).size, urls.length, "sitemap URLs should be unique");
for (const value of urls) {
  const url = new URL(value);
  assert.equal(url.origin, canonicalOrigin, "sitemap URLs should use the canonical public origin");
  assert.equal(url.search, "", "filtered/search variants should not appear in the sitemap");
  assert.doesNotMatch(url.hostname, /railway\.app$/i, "Railway hostnames must not appear in sitemap URLs");
  assert.doesNotMatch(url.pathname, /^\/(?:dashboard|employee|login|owner\/login|q|book)(?:\/|$)/i);
  assert.doesNotMatch(url.pathname, /^\/account(?:\/|$)/i);
}

const paths = urls.map((value) => new URL(value).pathname);
const cityPath = paths.find((path) => /^\/[a-z]{2}\/[a-z0-9-]+$/i.test(path));
const localityPath = paths.find((path) => /^\/[a-z]{2}\/[a-z0-9-]+\/areas\/[a-z0-9-]+$/i.test(path));
const salonPath = paths.find((path) => /^\/[a-z]{2}\/[a-z0-9-]+\/[a-z0-9-]+$/i.test(path));
assert.ok(cityPath, "sitemap should include a city with real salon inventory");
assert.ok(localityPath, "sitemap should include a locality that contains real salon inventory");
assert.ok(salonPath, "sitemap should include a public salon profile");

const targets = ["/", "/search", cityPath, localityPath, salonPath, "/services/haircut"];
for (const path of targets) {
  const { response, body } = await get(path);
  assert.equal(response.status, 200, `indexable route should return HTTP 200: ${path}`);
  assert.match(response.headers.get("content-type") ?? "", /text\/html/i);
  assert.match(body, /<h1\b/i, `indexable route should include server-rendered heading content: ${path}`);
  assert.match(body, new RegExp(`<link rel="canonical" href="${canonicalOrigin.replaceAll(".", "\\.")}${path === "/" ? "/" : path}"`, "i"));
  assert.doesNotMatch(body, /[a-z0-9.-]+\.railway\.app/i, "Railway hostnames must not leak into rendered HTML");
}

const searchPage = (await get("/search")).body;
const initialSearch = await get("/api/v1/salons?limit=12");
assert.equal(initialSearch.response.status, 200, "public discovery should supply initial search results");
const initialSearchData = JSON.parse(initialSearch.body);
assert.ok(Array.isArray(initialSearchData.items) && initialSearchData.items.length > 0, "default public search should return at least one real salon");
const firstName = String(initialSearchData.items[0]?.name ?? "").trim();
assert.ok(firstName, "initial public search result should include a real shop name");
const normalize = (value) => value
  .replace(/<[^>]*>/g, " ")
  .replace(/&amp;/g, "&")
  .replace(/&quot;/g, '"')
  .replace(/&#x27;|&#39;/g, "'")
  .replace(/&lt;/g, "<")
  .replace(/&gt;/g, ">")
  .replace(/[^\p{L}\p{N}]+/gu, " ")
  .trim()
  .toLocaleLowerCase("en-IN");
assert.ok(normalize(searchPage).includes(normalize(firstName)), "the default search page should render real discovery results in initial HTML");

const missing = await get("/in/seo-crawl-test/this-salon-does-not-exist");
assert.equal(missing.response.status, 404, "an invalid public salon profile should return HTTP 404");

const targetsFile = join(webRoot, ".next", "seo-lighthouse-targets.json");
await mkdir(join(webRoot, ".next"), { recursive: true });
await writeFile(targetsFile, `${JSON.stringify(targets.map((path) => new URL(path, baseUrl).toString()), null, 2)}\n`, "utf8");

console.log(JSON.stringify({
  result: "PASS",
  sitemapUrls: urls.length,
  educationSitemapUrls: guideUrls.length,
  crawledIndexablePages: targets.length,
  categories: ["home", "search", "city", "locality", "salon", "service"],
  xmlParsed: true,
  privateAndFilteredUrlsExcluded: true,
  invalidSalonReturns404: true,
  initialSearchSSRVerified: true,
}));
