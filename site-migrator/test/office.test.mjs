import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { parseAddress, parseOfficeHours, classifyPhone } from "../src/chrome/office.mjs";

/** Footer prose as it actually reads once the markup is flattened. */
const FOOTER =
  "Contact Info Call (413) 779-8699 Text (413) 781-7645 " +
  "41 Taylor Street, 4th Floor Springfield, MA 01103 " +
  "Office Hours Monday7:30 am - 2:30 pm Tuesday9:00 am - 8:00 pm " +
  "Wednesday9:00 am - 6:00 pm Thursday12:00 pm - 8:00 pm " +
  "© 2026 Taylor Street Dental | Sitemap | Privacy Policy";

describe("address parsing", () => {
  test("reads a real footer address", () => {
    const address = parseAddress(FOOTER);
    assert.deepEqual(address, {
      lines: ["41 Taylor Street", "4th Floor"],
      city: "Springfield",
      state: "MA",
      postalCode: "01103",
      country: null,
    });
  });

  test("is not fooled by phone numbers earlier in the text", () => {
    // Scanning forwards for a street number finds the phone number first.
    const address = parseAddress("Call (413) 779-8699 100 Main St, Boston, MA 02101");
    assert.deepEqual(address.lines, ["100 Main St"]);
    assert.equal(address.city, "Boston");
  });

  test("handles a comma-separated unit", () => {
    const address = parseAddress("200 Oak Ave, Suite 4, Portland, OR 97205");
    assert.deepEqual(address.lines, ["200 Oak Ave", "Suite 4"]);
    assert.equal(address.city, "Portland");
  });

  test("handles a plain single-line address", () => {
    const address = parseAddress("15 Elm Road, Austin, TX 78701");
    assert.deepEqual(address.lines, ["15 Elm Road"]);
    assert.equal(address.city, "Austin");
  });

  test("supports a ZIP+4", () => {
    assert.equal(parseAddress("15 Elm Road, Austin, TX 78701-1234").postalCode, "78701-1234");
  });

  test("returns nothing rather than a half-parsed address", () => {
    // A wrong address is worse than none: it looks deliberately filled in.
    assert.equal(parseAddress("Call us on (413) 779-8699"), null);
    assert.equal(parseAddress("Open Monday to Friday"), null);
    assert.equal(parseAddress(""), null);
  });
});

describe("office hours parsing", () => {
  test("reads days run together with their times", () => {
    // Day and times sit in separate elements, so the flattened text has no
    // separator between them.
    const hours = parseOfficeHours(FOOTER);
    assert.deepEqual(hours, [
      { day: "Monday", hours: "7:30 am - 2:30 pm", note: "" },
      { day: "Tuesday", hours: "9:00 am - 8:00 pm", note: "" },
      { day: "Wednesday", hours: "9:00 am - 6:00 pm", note: "" },
      { day: "Thursday", hours: "12:00 pm - 8:00 pm", note: "" },
    ]);
  });

  test("accepts separators and abbreviations", () => {
    const hours = parseOfficeHours("Mon: 8:00 am – 5:00 pm  Tue 9 am to 6 pm");
    assert.equal(hours[0].day, "Monday");
    assert.equal(hours[0].hours, "8:00 am - 5:00 pm");
    assert.equal(hours[1].day, "Tuesday");
  });

  test("records a closed day", () => {
    assert.deepEqual(parseOfficeHours("Sunday Closed"), [
      { day: "Sunday", hours: "Closed", note: "" },
    ]);
  });

  test("does not repeat a day mentioned twice", () => {
    const hours = parseOfficeHours("Monday 8 am - 5 pm ... Monday 8 am - 5 pm");
    assert.equal(hours.length, 1);
  });

  test("finds nothing in text with no hours", () => {
    assert.deepEqual(parseOfficeHours("Contact us any time"), []);
  });
});

describe("phone classification", () => {
  test("distinguishes a texting number from the phone line", () => {
    // Practices commonly list both, and putting an SMS number on a phone link
    // sends callers to a number that will not answer.
    assert.equal(classifyPhone({ href: "sms:+14137817645", label: "Text" }).type, "sms");
    assert.equal(classifyPhone({ href: "tel:+14137798699", label: "Call" }).type, "phone");
  });

  test("falls back to the label when the scheme does not say", () => {
    assert.equal(classifyPhone({ href: "tel:+1413", label: "Text Us" }).type, "sms");
  });

  test("strips the call-to-action from the display value", () => {
    assert.equal(
      classifyPhone({ href: "tel:+14137798699", label: "Call (413) 779-8699" }).display,
      "(413) 779-8699"
    );
  });

  test("formats a bare number when there is no label", () => {
    assert.equal(classifyPhone({ href: "tel:+14137798699", label: "" }).display, "(413) 779-8699");
  });
});
