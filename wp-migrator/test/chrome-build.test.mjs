import assert from "node:assert/strict";
import test from "node:test";
import { buildNavData, buildFooterData } from "../src/chrome/build.mjs";

const nav = (children) => [{ name: "Contact", path: "", children }];

test("a header's own CTA keeps the template's styling and takes the source's words", () => {
  const next = buildNavData(
    { header: { buttons: [{ text: "Book Online", link: "https://s.hsone.io/abc" }], nav: [] } },
    { pageButtons: [{ variant: "primary", text: "Request an Appointment", link: "/request-an-appointment/" }] }
  );

  assert.equal(next.pageButtons[0].text, "Book Online");
  assert.equal(next.pageButtons[0].link, "https://s.hsone.io/abc");
  assert.equal(next.pageButtons[0].variant, "primary");
});

test("the template's placeholder CTA does not survive a header that has none", () => {
  const next = buildNavData(
    {
      header: {
        buttons: [],
        // A booking link in the menu is not a header button, and is not
        // promoted into one: the source header has no button to match.
        nav: nav([
          { name: "Contact Us", path: "contact.html", children: [] },
          { name: "Book an Appointment", path: "https://s.hsone.io/abc", children: [] },
        ]),
      },
    },
    { pageButtons: [{ text: "Request an Appointment", link: "/request-an-appointment/" }] }
  );

  assert.deepEqual(next.pageButtons, []);
});

test("only a column that is a list of page links is a footer link column", () => {
  const next = buildFooterData({
    footer: {
      columns: [
        { title: "", brand: true, logo: { source: "/logo.png", alt: "" }, links: [] },
        {
          title: "Quick Links",
          links: [
            { name: "About Us", path: "our-practice.html" },
            { name: "Smile Gallery", path: "smile-gallery.html" },
          ],
        },
        // Already modelled as siteInfo.offices and siteInfo.socials.
        {
          title: "Contact Us",
          links: [
            { name: "(732) 365-0123", path: "tel:+17323650123" },
            { name: "429 Highway 35", path: "https://share.google/abc" },
          ],
        },
        // A promotional band wearing a footer's clothes.
        { title: "Schedule Your Appointment", links: [{ name: "Book", path: "https://s.hsone.io/abc" }] },
      ],
    },
  });

  assert.deepEqual(
    next.linkColumns.map((c) => c.title),
    ["", "Quick Links"]
  );
  assert.equal(next.linkColumns[0].brand, true);
});

test("the source's copyright replaces the template's own credit line", () => {
  const next = buildFooterData({
    copyright: { text: "@2026 Chapel Hill Dental Arts", links: [] },
  });

  assert.equal(next.copyright.text, "@2026 Chapel Hill Dental Arts");
});
