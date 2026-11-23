import assert from "node:assert/strict";
import { after, afterEach, before, beforeEach, test } from "node:test";
import { JSDOM } from "jsdom";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { createServer } from "vite";

const dom = new JSDOM("<div id='app'></div>", { url: "http://localhost:5173/" });
const container = dom.window.document.querySelector("#app");
const originalFormData = globalThis.FormData;
let server;
let WeddingWorkspace;
let root;

before(async () => {
    globalThis.window = dom.window;
    globalThis.document = dom.window.document;
    globalThis.FormData = dom.window.FormData;
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    server = await createServer({
        configFile: false,
        server: { middlewareMode: true, ws: false, watch: null },
    });
    ({ default: WeddingWorkspace } = await server.ssrLoadModule("/src/WeddingWorkspace.tsx"));
});

after(async () => {
    await server?.close();
    dom.window.close();
    globalThis.FormData = originalFormData;
    delete globalThis.IS_REACT_ACT_ENVIRONMENT;
    delete globalThis.document;
    delete globalThis.window;
});

beforeEach(() => { root = createRoot(container); });
afterEach(async () => {
    await act(() => root.unmount());
    window.history.replaceState(null, "", "/");
});

function wedding(id, memberships, names = {}) {
    return { id, name: `Wedding ${id}`, wedding_date: null, memberships, ...names };
}

function mockWeddings(t, weddings) {
    t.mock.method(globalThis, "fetch", async () => Response.json(weddings));
}

async function render(preferredWeddingId) {
    await act(() => root.render(createElement(WeddingWorkspace, { preferredWeddingId })));
    return container.querySelector(".workspace-hero");
}

test("uses only the active wedding's stored display names", async (t) => {
    mockWeddings(t, [
        wedding(1, [{ first_name: "דנה", display_name: "דנה לוי" }], {
            creator_display_name: "דנה", partner_display_name: "Liam",
        }),
        wedding(2, [
            { first_name: "נועה", display_name: "נועה כהן" },
            { first_name: "יובל", display_name: "יובל כהן" },
        ], { creator_display_name: "נועה", partner_display_name: "יובל" }),
    ]);

    const hero = await render(2);
    assert.equal(hero.querySelector(".eyebrow").textContent, "KNOTIQO · המרחב שלנו");
    assert.equal(hero.querySelector("h1").textContent, "הסיפור שלכם מתחיל כאן.");
    assert.equal(hero.querySelector("h2").textContent, "נועה ויובל");
    assert.equal(hero.querySelector(".workspace-subtitle").textContent, "כל הפרטים הקטנים בדרך ליום הגדול שלכם.");
    assert.equal(hero.dir, "rtl");
    assert.equal((await render(1)).querySelector("h2").textContent, "דנה & Liam");
    assert.ok(container.querySelector(".wedding-summary .partner-invitation"));
});

test("loads the existing shared workspace with both members and absent or blank couple names", async (t) => {
    const members = [
        { first_name: "נועה", display_name: "נועה כהן" },
        { first_name: "יובל", display_name: "יובל לוי" },
    ];
    t.mock.method(globalThis, "fetch", async (url) => {
        assert.equal(url, "/api/weddings/?include=memberships");
        return Response.json([
            wedding(1, members),
            wedding(2, members, { creator_display_name: "", partner_display_name: "" }),
        ]);
    });

    const hero = await render();
    assert.equal(hero.querySelector("h2"), null);
    const cards = container.querySelectorAll(".wedding-summary");
    assert.equal(cards.length, 2);
    for (const card of cards) {
        assert.equal(card.querySelectorAll(".wedding-members li").length, 2);
        assert.match(card.textContent, /נועה כהן/);
        assert.match(card.textContent, /יובל לוי/);
        assert.ok(card.querySelector(".budget-assistant summary"));
        assert.equal(card.querySelector(".partner-invitation"), null);
        assert.equal(card.querySelector(".couple-name-editor button").textContent, "השלמת שמות הזוג");
    }
    assert.equal(container.querySelector('[role="alert"]'), null);
});

test("completes the stored names with session CSRF and refreshes the hero", async (t) => {
    let names = {};
    t.mock.method(globalThis, "fetch", async (url, options) => {
        if (url === "/api/auth/csrf/") {
            document.cookie = "csrftoken=profile-test";
            return Response.json({});
        }
        if (url === "/api/weddings/1/couple-names/") {
            assert.equal(options.method, "PUT");
            assert.equal(options.credentials, "same-origin");
            assert.equal(options.headers["X-CSRFToken"], "profile-test");
            names = { creator_display_name: "דנה", partner_display_name: "יובל" };
            assert.deepEqual(JSON.parse(options.body), names);
            return Response.json(names);
        }
        assert.equal(url, "/api/weddings/?include=memberships");
        return Response.json([wedding(1, [{ first_name: "Account", display_name: "Account" }], names)]);
    });

    const hero = await render(1);
    assert.equal(hero.querySelector("h2"), null);
    await act(() => container.querySelector(".couple-name-editor button").click());
    const form = container.querySelector(".couple-name-form");
    form.elements.namedItem("creator_display_name").value = "  דנה  ";
    form.elements.namedItem("partner_display_name").value = "  יובל  ";
    await act(() => form.requestSubmit());

    assert.equal(hero.querySelector("h2").textContent, "דנה ויובל");
    assert.equal(container.querySelector(".couple-name-form"), null);
    assert.ok(container.querySelector(".partner-invitation"));
});

test("restores the dedicated venue route using only the authorized wedding ID", async (t) => {
    const urls = [];
    t.mock.method(globalThis, "fetch", async (url) => {
        urls.push(url);
        if (url === "/api/weddings/?include=memberships") {
            return Response.json([wedding(2, [{ display_name: "Member" }])]);
        }
        assert.equal(url, "/api/weddings/2/venues/");
        return Response.json([]);
    });
    window.history.replaceState(null, "", "/#/weddings/2/venues");
    await render();
    assert.equal(container.querySelector("h1").textContent, "המקום שבו הסיפור שלכם מתחיל.");
    assert.ok(urls.includes("/api/weddings/2/venues/"));
    await act(() => {
        window.history.replaceState(null, "", "/#/weddings/999/venues");
        window.dispatchEvent(new dom.window.Event("hashchange"));
    });
    assert.match(container.querySelector('[role="alert"]').textContent, /אינה זמינה/);
    assert.equal(urls.some((url) => url.includes("/999/")), false);
});
