import assert from "node:assert/strict";
import { after, afterEach, before, beforeEach, test } from "node:test";
import { JSDOM } from "jsdom";
import { act, createElement } from "react";
import { createServer } from "vite";

const dom = new JSDOM("<div id='app'></div>", { url: "http://localhost:5173/" });
const container = dom.window.document.querySelector("#app");
const originalFormData = globalThis.FormData;
let server, createRoot, VenuesPage, root;
let venues, quotes, calls;

const venue = (id = 1, name = "אולם לבדיקה") => ({
    id, name, location: "חיפה", contact_name: "", phone: "", website: "", capacity: 250,
    notes: "", description: "", images: [], status: "interested", is_favorite: false,
    created_at: "2026-11-19T10:00:00Z", updated_at: "2026-11-19T10:00:00Z",
});
const quote = (id = 1) => ({
    id, event_date: null, price_per_guest: "350.10", minimum_guests: 200,
    additional_costs: "1000.09", notes: "",
    created_at: "2026-11-19T10:00:00Z", updated_at: "2026-11-19T10:00:00Z",
});
const website = "https://venue.example.com/";
const token = "A".repeat(43);
const candidate = (id) => ({ image_url: `${website}${id}.jpg`, source_url: website, alt_text: `תמונה ${id}` });
const savedImage = (id, is_primary = false) => ({
    ...candidate(id), id, is_primary, sort_order: id, created_at: "2026-11-19T10:00:00Z",
});
const preview = (count = 2) => ({
    preview_token: token, expires_in: 300, metadata: {
        source_url: website, name: "שם מהאתר", description: "תיאור מהאתר", address: "כתובת מהאתר",
        phone: "04-1234567", images: Array.from({ length: count }, (_, i) => candidate(i + 1)),
    },
});

async function openImport() {
    await click("פרטים והצעות מחיר");
    await click("ייבוא פרטים ותמונות");
}

async function changeWebsite(value) {
    const input = container.querySelector('.venue-import input[name="website"]');
    const setValue = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value").set;
    await act(() => {
        setValue.call(input, value);
        input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
    });
}

test("imports a preview from the saved website, limits selection, saves the exact contract, and refreshes the cover", async (t) => {
    venues[0].website = website;
    mockApi(t, (url, method, options) => {
        if (url.endsWith("/metadata-preview/")) {
            assert.equal(method, "POST");
            assert.equal(options.headers["X-CSRFToken"], "venues-test");
            assert.deepEqual(JSON.parse(options.body), {});
            return Response.json(preview(21));
        }
        if (url === "/api/weddings/7/venues/1/images/" && method === "POST") {
            assert.deepEqual(JSON.parse(options.body), {
                preview_token: token, images: Array.from({ length: 20 }, (_, i) => ({ image_url: candidate(i + 1).image_url })),
            });
            assert.equal(options.credentials, "same-origin");
            venues[0].images = [savedImage(1, true), savedImage(2)];
            return Response.json({ images: venues[0].images });
        }
        if (url === "/api/weddings/7/venues/1/" && method === "GET") {
            return Response.json({ ...venues[0], name: "שם מעודכן מהשרת" });
        }
    });
    await render();
    assert.match(container.querySelector(".venue-card-cover").textContent, /עדיין אין תמונות/);
    await openImport();
    assert.equal(container.querySelector('.venue-import input[name="website"]').value, website);
    await click("תצוגה מקדימה");
    assert.match(container.textContent, /שם מהאתר.*תיאור מהאתר.*כתובת מהאתר.*04-1234567/s);
    assert.match(container.querySelector("#venue-detail-title").textContent, /אולם לבדיקה/);
    const choices = [...container.querySelectorAll(".venue-candidate input")];
    assert.equal(choices.length, 21);
    for (const choice of choices.slice(0, 20)) await act(() => choice.click());
    assert.equal(choices[20].disabled, true);
    await act(() => choices[19].click());
    assert.equal(choices[20].disabled, false);
    await act(() => choices[19].click());
    await click("שמירת התמונות שנבחרו");
    assert.equal(container.querySelectorAll(".venue-media > .venue-gallery li").length, 2);
    assert.match(container.querySelector("#venue-detail-title").textContent, /שם מעודכן מהשרת/);
    assert.equal(calls.some(({ method }) => method === "PATCH"), false);
    await click("חזרה לאולמות");
    const cover = container.querySelector(".venue-card-cover img");
    assert.equal(cover.src, candidate(1).image_url);
    await act(() => cover.dispatchEvent(new dom.window.Event("error")));
    assert.match(container.querySelector(".venue-card-cover").textContent, /התמונה אינה זמינה/);
});

test("uses an override website and confirms image deletion before refreshing the gallery", async (t) => {
    const override = "https://different.example.com/";
    venues[0] = { ...venues[0], website, images: [savedImage(1, true), savedImage(2)] };
    mockApi(t, (url, method, options) => {
        if (url.endsWith("/metadata-preview/")) {
            assert.deepEqual(JSON.parse(options.body), { website: override });
            return Response.json(preview());
        }
        if (url.endsWith("/images/1/")) {
            assert.equal(method, "DELETE");
            assert.equal(options.headers["X-CSRFToken"], "venues-test");
            assert.equal(options.body, undefined);
            venues[0].images = [savedImage(2)];
            return new Response(null, { status: 204 });
        }
        if (url === "/api/weddings/7/venues/1/") return Response.json(venues[0]);
    });
    await render();
    await openImport();
    await changeWebsite(override);
    await click("תצוגה מקדימה");
    await click("מחיקת תמונה");
    assert.match(container.querySelector("dialog").textContent, /להסיר את התמונה/);
    await click("ביטול", container.querySelector("dialog"));
    assert.equal(calls.some(({ method }) => method === "DELETE"), false);
    await click("מחיקת תמונה");
    await click("אישור מחיקה", container.querySelector("dialog"));
    assert.deepEqual([...container.querySelectorAll(".venue-media > .venue-gallery img")].map(({ src }) => src), [candidate(2).image_url]);
    assert.match(container.textContent, /התמונה הוסרה מהגלריה/);
});

for (const [status, code, expected] of [
    [429, "preview_rate_limited", /יותר מדי ניסיונות/],
    [502, "inaccessible_website", /לא הצלחנו להגיע לאתר/],
    [403, "", /לא ניתן לאמת/],
    [0, "", /החיבור לשרת נכשל/],
]) {
    test(`shows a localized media error for ${status || "a failed connection"}`, async (t) => {
        venues[0].website = website;
        mockApi(t, (url) => url.endsWith("/metadata-preview/")
            ? status ? Response.json({ error: { code, message: "private detail" } }, { status })
                : Promise.reject(new TypeError("private detail"))
            : undefined);
        await render();
        await openImport();
        await click("תצוגה מקדימה");
        assert.match(container.querySelector('[role="alert"]').textContent, expected);
        assert.doesNotMatch(container.textContent, /private detail/);
    });
}

test("prevents double submits and asks for a fresh preview after token expiry", async (t) => {
    venues[0].website = website;
    const pending = Promise.withResolvers();
    mockApi(t, (url) => {
        if (url.endsWith("/metadata-preview/")) return Response.json(preview());
        if (url.endsWith("/images/")) return pending.promise;
    });
    await render();
    await openImport();
    await click("תצוגה מקדימה");
    await act(() => container.querySelector(".venue-candidate input").click());
    const saveButton = [...container.querySelectorAll("button")].find((button) => button.textContent === "שמירת התמונות שנבחרו");
    await act(() => { saveButton.click(); saveButton.click(); });
    assert.equal(calls.filter(({ url, method }) => url.endsWith("/images/") && method === "POST").length, 1);
    await act(() => pending.resolve(Response.json({ error: { code: "invalid_preview" } }, { status: 400 })));
    assert.match(container.querySelector('[role="alert"]').textContent, /תוקף התצוגה המקדימה פג/);
    assert.equal(container.querySelector(".venue-candidate"), null);
});

test("aborts old preview and save responses when navigating between venues and weddings", async (t) => {
    venues[0].website = website;
    venues.push({ ...venue(2, "אולם שני"), website });
    const latePreview = Promise.withResolvers();
    const lateSave = Promise.withResolvers();
    let previewSignal, saveSignal;
    mockApi(t, (url, method, options) => {
        if (url === "/api/weddings/8/venues/") return Response.json([]);
        if (url.endsWith("/1/metadata-preview/")) { previewSignal = options.signal; return latePreview.promise; }
        if (url.endsWith("/2/metadata-preview/")) return Response.json(preview());
        if (url.endsWith("/2/images/") && method === "POST") { saveSignal = options.signal; return lateSave.promise; }
    });
    await render();
    await openImport();
    await click("תצוגה מקדימה");
    await click("חזרה לאולמות");
    assert.equal(previewSignal.aborted, true);
    await click("פרטים והצעות מחיר", container.querySelectorAll(".venue-management-cards li")[1]);
    await act(() => latePreview.resolve(Response.json(preview())));
    assert.doesNotMatch(container.textContent, /שם מהאתר/);
    await click("ייבוא פרטים ותמונות");
    await click("תצוגה מקדימה");
    await act(() => container.querySelector(".venue-candidate input").click());
    await click("שמירת התמונות שנבחרו");
    await render(8);
    assert.equal(saveSignal.aborted, true);
    await act(() => lateSave.resolve(Response.json({ images: [savedImage(1, true)] })));
    assert.doesNotMatch(container.textContent, /התמונות נשמרו/);
    assert.equal(calls.some(({ url }) => url === "/api/weddings/7/venues/2/"), false);
});

before(async () => {
    globalThis.window = dom.window;
    globalThis.document = dom.window.document;
    globalThis.HTMLElement = dom.window.HTMLElement;
    globalThis.FormData = dom.window.FormData;
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    dom.window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
    ({ createRoot } = await import("react-dom/client"));
    server = await createServer({ configFile: false, server: { middlewareMode: true, ws: false, watch: null } });
    ({ default: VenuesPage } = await server.ssrLoadModule("/src/VenuesPage.tsx"));
});

after(async () => {
    await server?.close();
    dom.window.close();
    globalThis.FormData = originalFormData;
    delete globalThis.HTMLElement;
    delete globalThis.IS_REACT_ACT_ENVIRONMENT;
    delete globalThis.document;
    delete globalThis.window;
});

beforeEach(() => {
    root = createRoot(container);
    venues = [venue()];
    quotes = [quote()];
    calls = [];
    document.cookie = "csrftoken=venues-test";
});
afterEach(async () => { await act(() => root.unmount()); });

function mockApi(t, override) {
    t.mock.method(globalThis, "fetch", async (url, options = {}) => {
        const method = options.method ?? "GET";
        calls.push({ url, method, options });
        if (url === "/api/auth/csrf/") return Response.json({});
        const custom = override?.(url, method, options);
        if (custom !== undefined) return custom;
        assert.match(url, /^\/api\/weddings\/7\/venues\//);
        if (method !== "GET") {
            assert.equal(options.credentials, "same-origin");
            assert.equal(options.headers["X-CSRFToken"], "venues-test");
        }
        const body = options.body ? JSON.parse(options.body) : undefined;
        if (method === "GET") return Response.json(url.includes("/quotes/") ? quotes : venues);
        if (url.includes("/quotes/")) {
            if (method === "DELETE") { quotes = []; return new Response(null, { status: 204 }); }
            const saved = { ...quote(), ...body };
            saved.price_per_guest = String(body.price_per_guest);
            saved.additional_costs = String(body.additional_costs);
            quotes = method === "POST" ? [...quotes, { ...saved, id: 2 }] : [saved];
            return Response.json(quotes.at(-1), { status: method === "POST" ? 201 : 200 });
        }
        if (method === "DELETE") { venues = []; return new Response(null, { status: 204 }); }
        const saved = { ...venue(), ...body };
        venues = method === "POST" ? [...venues, { ...saved, id: 2 }] : [saved];
        return Response.json(venues.at(-1), { status: method === "POST" ? 201 : 200 });
    });
}

async function render(weddingId = 7) {
    await act(() => root.render(createElement(VenuesPage, { weddingId, weddingName: "החתונה שלנו" })));
}
async function click(text, scope = container) {
    const button = [...scope.querySelectorAll("button")].find((node) => node.textContent === text);
    assert.ok(button, text);
    await act(() => button.click());
}
async function save(values) {
    const form = container.querySelector("form");
    for (const [name, value] of Object.entries(values)) form.elements.namedItem(name).value = String(value);
    await act(() => form.requestSubmit());
}

test("loads actual data and supports venue create, edit, favorite and confirmed cascade deletion", async (t) => {
    mockApi(t);
    await render();
    assert.match(container.textContent, /350\.10/);
    assert.match(container.textContent, /חיפה/);
    await click("הוספת אולם");
    await save({ name: "אולם חדש", location: "תל אביב" });
    assert.match(container.textContent, /פרטי האולם נשמרו/);
    const post = calls.find(({ method }) => method === "POST");
    assert.equal(JSON.parse(post.options.body).name, "אולם חדש");
    assert.equal(JSON.parse(post.options.body).capacity, null);
    assert.equal("wedding_id" in JSON.parse(post.options.body), false);

    await click("עריכת אולם", container.querySelector(".venue-management-cards li"));
    await save({ name: "שם מעודכן" });
    assert.match(container.textContent, /שם מעודכן/);
    const favoriteButton = container.querySelector('[aria-pressed]');
    await act(() => favoriteButton.click());
    assert.equal(container.querySelector('[aria-pressed]').getAttribute("aria-pressed"), "true");
    assert.deepEqual(JSON.parse(calls.findLast(({ method }) => method === "PATCH").options.body), { is_favorite: true });

    await click("מחיקת אולם");
    assert.match(container.querySelector("dialog").textContent, /תמחק גם את כל הצעות המחיר/);
    await click("ביטול", container.querySelector("dialog"));
    assert.equal(calls.some(({ method }) => method === "DELETE"), false);
    await click("מחיקת אולם");
    await click("אישור מחיקה", container.querySelector("dialog"));
    assert.equal(container.querySelectorAll(".venue-management-cards > li").length, 1);
    assert.doesNotMatch(container.textContent, /שם מעודכן/);
});

test("validates venue and quote inputs before writing HTTP requests", async (t) => {
    mockApi(t);
    await render();
    await click("הוספת אולם");
    await save({ name: " ", capacity: "1.5", website: "invalid" });
    assert.equal(container.querySelectorAll('[aria-invalid="true"]').length, 3);
    assert.equal(calls.some(({ method }) => method === "POST"), false);
    await click("ביטול");
    await click("פרטים והצעות מחיר");
    await click("הוספת הצעת מחיר");
    await save({ price_per_guest: "-1", minimum_guests: "0", additional_costs: "0.001" });
    assert.equal(container.querySelectorAll('[aria-invalid="true"]').length, 3);
    assert.equal(calls.some(({ method }) => method === "POST"), false);
});

test("shows all quotes and creates, edits and deletes a quote using exact decimal strings", async (t) => {
    mockApi(t);
    await render();
    await click("פרטים והצעות מחיר");
    assert.equal(container.querySelectorAll(".venue-quote-list > li").length, 1);
    await click("הוספת הצעת מחיר");
    await save({ event_date: "2027-06-15", price_per_guest: "351.23", minimum_guests: "201",
        additional_costs: "1000.09", notes: "הצעה נוספת" });
    const post = calls.find(({ method }) => method === "POST");
    assert.equal(post.url, "/api/weddings/7/venues/1/quotes/");
    assert.deepEqual(JSON.parse(post.options.body), { event_date: "2027-06-15", price_per_guest: "351.23",
        minimum_guests: 201, additional_costs: "1000.09", notes: "הצעה נוספת" });
    assert.equal(container.querySelectorAll(".venue-quote-list > li").length, 2);
    await click("עריכת הצעה", container.querySelector(".venue-quote-list li"));
    await save({ price_per_guest: "350.11", minimum_guests: "220" });
    assert.match(container.textContent, /350\.11/);
    await click("מחיקת הצעה", container.querySelector(".venue-quote-list li"));
    await click("אישור מחיקה", container.querySelector("dialog"));
    assert.equal(calls.findLast(({ method }) => method === "DELETE").url, "/api/weddings/7/venues/1/quotes/1/");
    assert.match(container.textContent, /הצעת המחיר נמחקה/);
});

for (const [status, message] of [[400, /בדקו את השדות/], [401, /לא ניתן לאמת/],
    [403, /לא ניתן לאמת/], [404, /אינם זמינים/], [503, /לא הצלחנו להשלים/]]) {
    test(`shows safe HTTP ${status} mutation errors and preserves the form`, async (t) => {
        mockApi(t, (_url, method) => method === "POST"
            ? Response.json({ name: ["provider internal details"] }, { status }) : undefined);
        await render();
        await click("הוספת אולם");
        await save({ name: "שם תקין" });
        assert.match(container.querySelector('[role="alert"]').textContent, message);
        assert.ok(container.querySelector("form"));
        assert.doesNotMatch(container.textContent, /provider internal details/);
        assert.equal(container.querySelector('button[type="submit"]').disabled, false);
    });
}

test("aborts an old wedding load and ignores its late response", async (t) => {
    const pending = Promise.withResolvers();
    let oldSignal;
    t.mock.method(globalThis, "fetch", (url, options) => {
        if (url === "/api/weddings/7/venues/") { oldSignal = options.signal; return pending.promise; }
        assert.equal(url, "/api/weddings/8/venues/");
        return Promise.resolve(Response.json([]));
    });
    await render(7);
    assert.match(container.textContent, /טוענים אולמות/);
    await render(8);
    assert.equal(oldSignal.aborted, true);
    await act(() => pending.resolve(Response.json([venue(1, "אולם מהחתונה הקודמת")])));
    assert.doesNotMatch(container.textContent, /אולם מהחתונה הקודמת/);
    assert.match(container.textContent, /רשימת האולמות שלכם מתחילה כאן/);
});

test("filters by name, status and favorite state", async (t) => {
    venues.push({ ...venue(2, "אולם אחר"), location: "ירושלים", status: "booked", is_favorite: true });
    mockApi(t);
    await render();
    const search = container.querySelector('input[type="search"]');
    const setValue = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value").set;
    await act(() => {
        setValue.call(search, "ירושלים");
        search.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
    });
    assert.equal(container.querySelectorAll(".venue-management-cards li").length, 1);
    await act(() => {
        setValue.call(search, "");
        search.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
    });
    const favoriteFilter = container.querySelector(".venue-management-filters input[type=checkbox]");
    await act(() => favoriteFilter.click());
    assert.equal(container.querySelectorAll(".venue-management-cards li").length, 1);
    assert.match(container.querySelector(".venue-management-cards").textContent, /אולם אחר/);
    const select = container.querySelector(".venue-management-filters select");
    await act(() => { select.value = "interested"; select.dispatchEvent(new dom.window.Event("change", { bubbles: true })); });
    assert.match(container.textContent, /לא נמצאו אולמות/);
});

test("keeps the confirmation dialog open when deletion fails", async (t) => {
    mockApi(t, (_url, method) => method === "DELETE" ? Response.json({}, { status: 404 }) : undefined);
    await render();
    await click("מחיקת אולם");
    await click("אישור מחיקה", container.querySelector("dialog"));
    assert.match(container.querySelector("dialog [role=alert]").textContent, /אינם זמינים/);
    assert.equal(container.querySelectorAll(".venue-management-cards li").length, 1);
});

test("loading prevents duplicate submission while the server is pending", async (t) => {
    const pending = Promise.withResolvers();
    mockApi(t, (_url, method) => method === "POST" ? pending.promise : undefined);
    await render();
    await click("הוספת אולם");
    const form = container.querySelector("form");
    form.elements.namedItem("name").value = "חדש";
    await act(() => {
        form.dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true }));
        form.dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true }));
    });
    assert.equal(calls.filter(({ method }) => method === "POST").length, 1);
    assert.equal(form.querySelector('button[type="submit"]').disabled, true);
    await act(() => pending.resolve(Response.json(venue(2, "חדש"), { status: 201 })));
    assert.match(container.textContent, /פרטי האולם נשמרו/);
});
