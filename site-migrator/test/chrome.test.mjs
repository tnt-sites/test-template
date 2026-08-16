import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { buildNavData, buildFooterData, buildSiteInfo, countNav } from "../src/chrome/index.mjs";

const extracted = (overrides = {}) => ({
  header: null,
  footer: null,
  siteName: "",
  addressBlocks: [],
  ...overrides,
});

describe("navigation data", () => {
  test("replaces the template's sample menu with the source's own", () => {
    const result = buildNavData(
      extracted({
        header: {
          logo: { source: "/assets/logo.svg", alt: "Practice logo" },
          nav: [{ name: "Home", path: "/", children: [] }],
        },
      }),
      { logoSource: "/images/logo.svg", logoAlt: "Logo", navData: [{ name: "Sample" }] }
    );

    assert.equal(result.logoSource, "/assets/logo.svg");
    assert.equal(result.logoAlt, "Practice logo");
    assert.deepEqual(result.navData, [{ name: "Home", path: "/", children: [] }]);
  });

  test("leaves the existing data alone when nothing was found", () => {
    const current = { logoSource: "/images/logo.svg", navData: [{ name: "Sample" }] };
    assert.deepEqual(buildNavData(extracted(), current), current);
  });

  test("counts a nested menu", () => {
    const nav = [
      { name: "Home", children: [] },
      {
        name: "Services",
        children: [
          { name: "Preventive", children: [{ name: "Cleanings", children: [] }] },
          { name: "Cosmetic", children: [] },
        ],
      },
    ];
    assert.equal(countNav(nav), 5);
  });
});

describe("footer data", () => {
  test("separates legal links from the main footer menu", () => {
    // Templates model these separately, and collapsing them puts a privacy
    // policy in the middle of the primary navigation.
    const result = buildFooterData(
      extracted({
        footer: {
          logo: null,
          links: [
            { name: "Home", path: "/" },
            { name: "Services", path: "/services/" },
            { name: "Privacy Policy", path: "/privacy-policy/" },
            { name: "Sitemap", path: "/sitemap/" },
          ],
        },
      }),
      {}
    );

    assert.deepEqual(result.links.map((l) => l.name), ["Home", "Services"]);
    assert.deepEqual(result.legalLinks.map((l) => l.name), ["Privacy Policy", "Sitemap"]);
  });

  test("drops duplicate links", () => {
    const result = buildFooterData(
      extracted({
        footer: {
          logo: null,
          links: [
            { name: "Home", path: "/" },
            { name: "Home", path: "/" },
          ],
        },
      }),
      {}
    );
    assert.equal(result.links.length, 1);
  });

  test("ignores links with no visible label", () => {
    const result = buildFooterData(
      extracted({ footer: { logo: null, links: [{ name: "", path: "/x/" }] } }),
      {}
    );
    assert.ok(!result.links, "an unlabelled link is not a menu entry");
  });
});

describe("site info", () => {
  test("collects socials and de-duplicates contact details across header and footer", () => {
    const result = buildSiteInfo(
      extracted({
        siteName: "Taylor Street Dental",
        header: {
          phones: [{ label: "Call", number: "+14137798699" }],
          emails: [],
        },
        footer: {
          phones: [{ label: "Phone", number: "+14137798699" }],
          emails: [{ label: "Email", address: "hi@example.com" }],
          socials: [{ label: "Facebook", icon: "social/facebook", link: "https://facebook.com/x" }],
          text: "",
        },
      }),
      {}
    );

    assert.equal(result.siteName, "Taylor Street Dental");
    assert.equal(result.socials[0].icon, "social/facebook");

    // Contact details live on the office record the template renders from,
    // not as loose top-level keys nothing reads.
    const office = result.offices[0];
    assert.equal(office.phones.length, 1, "the same number in two places is one number");
    assert.equal(office.emails.length, 1);
    assert.equal(office.emails[0].href, "mailto:hi@example.com");
  });

  test("puts address and opening hours on the office record", () => {
    const result = buildSiteInfo(
      extracted({
        footer: {
          phones: [],
          emails: [],
          socials: [],
          text: "41 Taylor Street, 4th Floor Springfield, MA 01103 Monday7:30 am - 2:30 pm",
          mapUrl: "https://maps.app.goo.gl/x",
        },
      }),
      {}
    );

    const office = result.offices[0];
    assert.equal(office.addresses[0].city, "Springfield");
    assert.equal(office.addresses[0].mapUrl, "https://maps.app.goo.gl/x");
    assert.equal(office.officeHours[0].day, "Monday");
  });

  test("keeps existing values when the source has none", () => {
    const current = { siteName: "Existing", socials: [{ label: "X" }] };
    assert.deepEqual(buildSiteInfo(extracted(), current), current);
  });
});
