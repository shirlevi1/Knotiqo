import assert from "node:assert/strict";
import { after, afterEach, before, beforeEach, test } from "node:test";
import { JSDOM } from "jsdom";
import { act, createElement } from "react";
import { createServer } from "vite";

const dom = new JSDOM("<div id='app'></div>", { url: "http://localhost:5173/" });
const container = dom.window.document.querySelector("#app");
const originalFormData = globalThis.FormData;
let server;
let createRoot;
let VenueSection;
let root;

before(async () => {
    globalThis.window = dom.window;
    globalThis.document = dom.window.document;
    globalThis.FormData = dom.window.FormData;
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    ({ createRoot } = await import("react-dom/client"));
    server = await createServer({
        configFile: false,
        server: { middlewareMode: true, ws: false, watch: null },
    });
    ({ default: VenueSection } = await server.ssrLoadModule("/src/components/VenueSection.tsx"));
});

after(async () => {
    await server?.close();
    dom.window.close();
    globalThis.FormData = originalFormData;
    delete globalThis.IS_REACT_ACT_ENVIRONMENT;
    delete globalThis.document;
    delete globalThis.window;
});

beforeEach(async () => {
    root = createRoot(container);
    await act(() => root.render(createElement(VenueSection)));
});

afterEach(async () => {
    await act(() => root.unmount());
});

async function click(selector) {
    const target = container.querySelector(selector);
    assert.ok(target, selector);
    await act(() => target.click());
}

async function submitVenue(fields) {
    const form = container.querySelector(".venue-editor");
    for (const [name, value] of Object.entries(fields)) form.elements.namedItem(name).value = value;
    await act(() => form.requestSubmit());
}

async function addVenue(fields) {
    await click(".venue-hero button");
    await submitVenue(fields);
}

test("starts empty and adds, edits and removes a venue entered by the user", async () => {
    assert.match(container.textContent, /עדיין אין אולמות ברשימה/);
    assert.equal(container.querySelectorAll(".venue-card").length, 0);

    await addVenue({ name: "אולם לבדיקה", location: "חיפה", price: "320.50", capacity: "150",
        image: "https://example.com/venue.jpg" });
    const card = container.querySelector(".venue-card");
    assert.match(card.textContent, /אולם לבדיקה/);
    assert.match(card.textContent, /חיפה/);
    assert.match(card.textContent, /320\.5/);
    assert.match(card.textContent, /150 אורחים/);
    assert.equal(card.querySelector("img").getAttribute("src"), "https://example.com/venue.jpg");

    await click('button[aria-label="עריכת אולם לבדיקה"]');
    await submitVenue({ capacity: "200" });
    assert.match(card.textContent, /200 אורחים/);
    await click('button[aria-label="הסרת אולם לבדיקה"]');
    assert.equal(container.querySelectorAll(".venue-card").length, 0);
    assert.match(container.textContent, /עדיין אין אולמות ברשימה/);
});

test("compares two to three venues and leaves absent data unspecified", async () => {
    for (const name of ["אולם א", "אולם ב", "אולם ג", "אולם ד"]) await addVenue({ name });

    await click('button[aria-label="השוואת אולם א"]');
    assert.equal(container.querySelector(".venue-comparison"), null);
    await click('button[aria-label="השוואת אולם ב"]');
    assert.equal(container.querySelectorAll(".venue-comparison-table thead th").length, 3);
    assert.equal(container.querySelectorAll(".venue-comparison-cards > li").length, 2);
    assert.match(container.querySelector(".venue-comparison").textContent, /לא הוזן/);

    await click('button[aria-label="השוואת אולם ג"]');
    assert.equal(container.querySelector('button[aria-label="השוואת אולם ד"]').disabled, true);
    assert.equal(container.querySelectorAll(".venue-comparison-cards > li").length, 3);
    await click('button[aria-label="הסרת אולם א"]');
    assert.equal(container.querySelector('button[aria-label="השוואת אולם ד"]').disabled, false);
    assert.equal(container.querySelectorAll(".venue-comparison-cards > li").length, 2);
});

test("keeps the venue form open when an optional value is invalid", async () => {
    await addVenue({ name: "אולם לבדיקה", price: "-1" });
    assert.match(container.querySelector('[role="alert"]').textContent, /מחיר לא שלילי/);
    assert.equal(container.querySelectorAll(".venue-card").length, 0);
    await click(".venue-editor button[type=button]");
    assert.equal(container.querySelector(".venue-editor"), null);
});
