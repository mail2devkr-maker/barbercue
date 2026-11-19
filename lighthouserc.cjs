const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");

const targetFile = resolve(__dirname, "apps/web/.next/seo-lighthouse-targets.json");
let urls;
try {
  urls = JSON.parse(readFileSync(targetFile, "utf8"));
} catch (error) {
  throw new Error("Run the SEO crawl smoke check before Lighthouse CI to discover real city, locality and salon routes.", { cause: error });
}

if (!Array.isArray(urls) || ![5, 6].includes(urls.length) || urls.some((url) => typeof url !== "string")) {
  throw new Error("The SEO crawl smoke check must produce five core routes, plus a locality only when the sitemap has real inventory for one.");
}

module.exports = {
  ci: {
    collect: {
      url: urls,
      numberOfRuns: 3,
      settings: {
        onlyCategories: ["performance", "seo", "accessibility", "best-practices"],
      },
    },
    assert: {
      assertions: {
        "categories:seo": ["error", { minScore: 0.9 }],
        "categories:performance": ["warn", { minScore: 0.5 }],
        "largest-contentful-paint": ["warn", { maxNumericValue: 2500 }],
        "cumulative-layout-shift": ["warn", { maxNumericValue: 0.1 }],
        "total-blocking-time": ["warn", { maxNumericValue: 200 }],
      },
    },
    upload: {
      target: "filesystem",
      outputDir: "apps/web/.next/lighthouse-reports",
    },
  },
};
