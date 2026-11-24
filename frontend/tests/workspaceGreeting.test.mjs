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
    globalThis.HTMLElement = dom.window.HTMLElement;
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    dom.window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
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
    delete globalThis.HTMLElement;
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

const defaultCover = "/images/default-wedding-hero.jpg";
const personalCover = "/api/weddings/1/cover/?v=0123456789abcdef";
const coverSrc = () => container.querySelector(".workspace-hero-image").getAttribute("src");

async function coverClick(label) {
    const button = [...container.querySelectorAll("button")].find((node) => node.textContent === label);
    assert.ok(button, label);
    await act(() => button.click());
}

async function selectCover(type) {
    const input = container.querySelector('dialog input[type="file"]');
    Object.defineProperty(input, "files", { configurable: true, value: [
        new dom.window.File(["cover"], "cover.png", { type }),
    ] });
    await act(() => input.dispatchEvent(new dom.window.Event("change", { bubbles: true })));
}

test("previews a local selection, preserves the cover on cancel, saves and confirms removal", async (t) => {
    let cover = null;
    t.mock.method(URL, "createObjectURL", () => "blob:preview");
    const revoke = t.mock.method(URL, "revokeObjectURL", () => {});
    t.mock.method(globalThis, "fetch", async (url, options) => {
        if (url === "/api/auth/csrf/") {
            document.cookie = "csrftoken=cover-test";
            return Response.json({});
        }
        if (url === "/api/weddings/1/cover/") {
            assert.equal(options.credentials, "same-origin");
            assert.equal(options.headers["X-CSRFToken"], "cover-test");
            assert.equal(options.headers["Content-Type"], undefined);
            if (options.method === "POST") {
                assert.equal(options.body.get("cover").name, "cover.png");
                cover = personalCover;
            } else {
                assert.equal(options.method, "DELETE");
                cover = null;
            }
            return Response.json({ cover_image_url: cover });
        }
        return Response.json([wedding(1, [], { cover_image_url: cover })]);
    });
    await render();
    assert.equal(coverSrc(), defaultCover);
    await coverClick("שינוי תמונת רקע");
    await selectCover("image/svg+xml");
    assert.match(container.querySelector("dialog [role=alert]").textContent, /בחרו תמונה/);
    await selectCover("image/png");
    assert.equal(container.querySelector("dialog img").getAttribute("src"), "blob:preview");
    await coverClick("ביטול");
    assert.equal(container.querySelector("dialog"), null);
    assert.equal(coverSrc(), defaultCover);
    assert.equal(revoke.mock.callCount(), 1);
    await coverClick("שינוי תמונת רקע");
    await selectCover("image/png");
    await coverClick("שמירת תמונה");
    assert.equal(coverSrc(), personalCover);
    await coverClick("שינוי תמונת רקע");
    await coverClick("חזרה לתמונת ברירת המחדל");
    assert.equal(coverSrc(), personalCover);
    await coverClick("אישור הסרה");
    assert.equal(coverSrc(), defaultCover);
    assert.equal(container.querySelector("dialog"), null);
});

test("uses only the selected wedding's cover and recovers from image load failure", async (t) => {
    mockWeddings(t, [wedding(1, [], { cover_image_url: personalCover }), wedding(2, [])]);
    await render();
    assert.equal(coverSrc(), personalCover);
    const select = container.querySelector(".workspace-settings select");
    await act(() => {
        select.value = "2";
        select.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
    });
    assert.equal(coverSrc(), defaultCover);
    await act(() => {
        select.value = "1";
        select.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
    });
    assert.equal(coverSrc(), personalCover);
    await act(() => container.querySelector(".workspace-hero-image").dispatchEvent(new dom.window.Event("error")));
    assert.equal(coverSrc(), defaultCover);
});

test("uses only the active wedding's stored display names", async (t) => {
    mockWeddings(t, [
        wedding(1, [{ first_name: "דנה", display_name: "דנה לוי" }], {
            creator_display_name: "דנה", partner_display_name: "Liam",
        }),
        wedding(2, [
            { first_name: "נועה", display_name: "נועה כהן" },
            { first_name: "יובל", display_name: "יובל כהן" },
        ], { creator_display_name: "נועה", partner_display_name: "יובל", wedding_date: "2027-06-15" }),
    ]);

    const hero = await render(2);
    assert.equal(hero.querySelector(".workspace-edition").textContent, "Wedding Atelier");
    assert.equal(hero.querySelector("h1").textContent, "נועה ויובל");
    assert.equal(hero.querySelector("time").dateTime, "2027-06-15");
    assert.equal(hero.closest(".wedding-workspace").dir, "rtl");
    assert.equal((await render(1)).querySelector("h1").textContent, "דנה & Liam");
    assert.ok(container.querySelector(".workspace-settings .partner-invitation"));
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
    assert.equal(hero.querySelector("h1").textContent, "Wedding 1");
    const settings = container.querySelector(".workspace-settings");
    assert.equal(settings.querySelectorAll(".wedding-members li").length, 2);
    assert.match(settings.textContent, /נועה כהן/);
    assert.match(settings.textContent, /יובל לוי/);
    assert.equal(settings.querySelector(".partner-invitation"), null);
    assert.equal(settings.querySelector(".couple-name-editor button").textContent, "השלמת שמות הזוג");
    assert.equal(container.querySelectorAll(".budget-assistant summary").length, 1);
    const select = settings.querySelector("select");
    assert.equal(select.options.length, 2);
    await act(() => {
        select.value = "2";
        select.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
    });
    assert.equal(container.querySelector(".workspace-hero h1").textContent, "Wedding 2");
    assert.ok(container.querySelector('a[href="#/weddings/2/venues/compare"]'));
    const planning = container.querySelector(".workspace-planning");
    const cards = [...planning.querySelectorAll(".workspace-tools > li")];
    assert.equal(cards.length, 4);
    assert.equal(cards[3].querySelector("h3").textContent, "רשימת המוזמנים");
    assert.match(cards[3].querySelector("a").textContent, /ניהול מוזמנים/);
    assert.equal(cards[3].querySelector("a").getAttribute("href"), "#/weddings/2/guests");
    assert.equal(planning.querySelector("header a[href$='/guests']"), null);
    const budgetButton = container.querySelector(".workspace-tools button");
    await act(() => budgetButton.click());
    assert.equal(container.querySelector(".budget-assistant").open, true);
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
    assert.equal(hero.querySelector("h1").textContent, "Wedding 1");
    await act(() => container.querySelector(".couple-name-editor button").click());
    const form = container.querySelector(".couple-name-form");
    form.elements.namedItem("creator_display_name").value = "  דנה  ";
    form.elements.namedItem("partner_display_name").value = "  יובל  ";
    await act(() => form.requestSubmit());

    assert.equal(hero.querySelector("h1").textContent, "דנה ויובל");
    assert.equal(container.querySelector(".couple-name-form"), null);
    assert.ok(container.querySelector(".partner-invitation"));
});

test("opens the authorized comparison route and returns to venue management", async (t) => {
    t.mock.method(globalThis, "fetch", async (url) => {
        if (url === "/api/weddings/?include=memberships") return Response.json([wedding(2, [])]);
        assert.equal(url, "/api/weddings/2/venues/");
        return Response.json([]);
    });
    window.history.replaceState(null, "", "/#/weddings/2/venues/compare");
    await render();
    assert.equal(container.querySelector(".venue-comparison h2").textContent, "השוואת אולמות");
    await act(() => container.querySelector(".venue-comparison button").click());
    assert.equal(window.location.hash, "#/weddings/2/venues");
    assert.equal(container.querySelector(".venue-comparison"), null);
});

test("shows loading, then a retryable error and an empty onboarding view", async (t) => {
    const pending = Promise.withResolvers();
    let attempts = 0;
    t.mock.method(globalThis, "fetch", async () => {
        attempts += 1;
        return attempts === 1 ? pending.promise : Response.json([]);
    });
    await render();
    assert.match(container.querySelector('[role="status"]').textContent, /טוענים/);
    await act(() => pending.resolve(Response.json({}, { status: 503 })));
    assert.ok(container.querySelector('[role="alert"]'));
    await act(() => container.querySelector("button").click());
    assert.ok(container.querySelector(".wedding-create form"));
    assert.equal(container.querySelector(".workspace-hero"), null);
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
