import assert from "node:assert/strict";
import { after, afterEach, before, beforeEach, test } from "node:test";
import { setTimeout as wait } from "node:timers/promises";
import { JSDOM } from "jsdom";
import { act, createElement } from "react";
import { createServer } from "vite";

const dom = new JSDOM("<div id='app'></div>", { url: "http://localhost:5173/" });
const container = dom.window.document.querySelector("#app");
const savedFormData = globalThis.FormData;
const base = "/api/weddings/7/guests/";
const importBase = base + "import/";
const guest = {
    id: 10, full_name: "נועה לוי", phone: "0501234567", email: "", side: "bride", category: "adult",
    family_group: "לוי", party_size: 3, unnamed_companions: 2, notes: "", tags: ["משפחה"],
    adult_count: null, child_count: null, infant_count: null, unclassified_count: 3,
    is_archived: false, created_at: "", updated_at: "",
};
const payload = (results = [guest], pagination = {}) => ({
    count: results.length, previous: null, next: null, results,
    summary: { records: 1, attendees: 3, unnamed_companions: 2, bride: 3, groom: 0, joint: 0, unassigned: 0,
        adult_count: 0, child_count: 0, infant_count: 0, unclassified_count: 3 },
    ...pagination,
});
let server, GuestsPage, WeddingWorkspace, root, createRoot;

before(async () => {
    globalThis.window = dom.window;
    globalThis.document = dom.window.document;
    globalThis.FormData = dom.window.FormData;
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    ({ createRoot } = await import("react-dom/client"));
    server = await createServer({ configFile: false, server: { middlewareMode: true, ws: false, watch: null } });
    ({ default: GuestsPage } = await server.ssrLoadModule("/src/GuestsPage.tsx"));
    ({ default: WeddingWorkspace } = await server.ssrLoadModule("/src/WeddingWorkspace.tsx"));
});
after(async () => {
    await server.close();
    dom.window.close();
    globalThis.FormData = savedFormData;
    delete globalThis.window;
    delete globalThis.document;
    delete globalThis.IS_REACT_ACT_ENVIRONMENT;
});
beforeEach(() => { root = createRoot(container); });
afterEach(async () => { await act(() => root.unmount()); window.history.replaceState(null, "", "/"); });

function mockApi(t, handle) {
    t.mock.method(globalThis, "fetch", async (url, options = {}) => {
        assert.equal(options.credentials, "same-origin");
        if (url === "/api/auth/csrf/") {
            document.cookie = "csrftoken=guest-test";
            return Response.json({});
        }
        const method = options.method ?? "GET";
        if (method !== "GET") assert.equal(options.headers["X-CSRFToken"], "guest-test");
        const path = new URL(url, window.location.origin);
        return handle(path, method, options);
    });
}
async function render(weddingId = 7) {
    await act(() => root.render(createElement(GuestsPage, { weddingId, weddingName: "חתונת הבדיקה" })));
    await settle();
}
async function settle(ms = 12) { await act(() => wait(ms)); }
async function click(label, scope = container) {
    const node = [...scope.querySelectorAll("button")].find((button) => button.textContent === label);
    assert.ok(node, label);
    await act(() => node.click());
}
async function choose(selector, value, scope = container) {
    const select = scope.querySelector(selector);
    assert.ok(select, selector);
    await act(() => {
        select.value = value;
        select.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
    });
}
async function search(value) {
    const input = container.querySelector('input[type="search"]');
    const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value").set;
    await act(() => {
        setter.call(input, value);
        input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
    });
    await settle(210);
}

test("lists server counts, paginates and applies search, side, category and archive filters", async (t) => {
    const requests = [];
    mockApi(t, ({ pathname, searchParams }) => {
        assert.equal(pathname, base);
        requests.push(Object.fromEntries(searchParams));
        return Response.json(payload(undefined, searchParams.get("page") === "1" ? { next: "next" } : { previous: "prev" }));
    });
    await render();
    assert.match(container.querySelector(".guest-summary").textContent, /מקומות למוזמנים3.*רשומות מוזמנים1.*מלווים ללא שם2/);
    assert.match(container.querySelector("tbody").textContent, /נועה לוי/);
    assert.match(container.querySelector("tbody").textContent, /מבוגרים 3/);
    await click("הבא");
    await settle();
    assert.equal(requests.at(-1).page, "2");
    await search("050");
    await choose(".guest-filters label:nth-child(2) select", "bride");
    await choose(".guest-filters label:nth-child(3) select", "child");
    await choose(".guest-filters label:nth-child(4) select", "archived");
    await settle(210);
    assert.deepEqual(requests.at(-1), { archive: "archived", page: "1", search: "050", side: "bride", category: "child" });
});

test("creates, preserves form data on validation errors, edits, archives and restores", async (t) => {
    let saved;
    let fail = true;
    mockApi(t, ({ pathname, searchParams }, method, options) => {
        if (method === "GET") return Response.json(payload(saved && saved.is_archived === (searchParams.get("archive") === "archived") ? [saved] : []));
        if (method === "POST" || method === "PATCH") {
            const values = JSON.parse(options.body);
            if (fail) { fail = false; return Response.json({ full_name: ["server validation text"] }, { status: 400 }); }
            assert.equal(pathname, method === "POST" ? base : base + "10/");
            assert.equal("wedding_id" in values, false);
            if ("full_name" in values) assert.deepEqual([values.party_size, values.adult_count, values.child_count, values.infant_count], [1, 1, 0, 0]);
            saved = { ...(saved ?? guest), ...values };
            return Response.json(saved);
        }
        assert.equal(pathname, base + "10/");
        saved.is_archived = true;
        return new Response(null, { status: 204 });
    });
    await render();
    await click("הוספת מוזמן");
    const form = container.querySelector("form");
    await click("שמירת מוזמן", form);
    assert.match(form.querySelector('[role="alert"]').textContent, /לתקן/);
    form.elements.namedItem("full_name").value = "אורח חדש";
    await click("שמירת מוזמן", form);
    assert.equal(form.elements.namedItem("full_name").value, "אורח חדש");
    assert.match(form.textContent, /הזינו שם מלא/);
    assert.doesNotMatch(form.textContent, /server validation text/);
    await click("שמירת מוזמן", form);
    await settle();
    await click("עריכה");
    container.querySelector("form").elements.namedItem("full_name").value = "שם מעודכן";
    await click("שמירת מוזמן");
    await settle();
    assert.match(container.querySelector("tbody").textContent, /שם מעודכן/);
    await click("העברה לארכיון");
    await settle();
    await choose(".guest-filters label:nth-child(4) select", "archived");
    await settle();
    await click("שחזור");
    await settle();
    assert.equal(saved.is_archived, false);
});

test("downloads binary XLSX with safe filenames and applies the selected archive mode", async (t) => {
    const urls = [];
    const downloads = [];
    t.mock.method(URL, "createObjectURL", (data) => { assert.equal(data.size, 4); return "blob:guest-xlsx"; });
    t.mock.method(URL, "revokeObjectURL", () => {});
    t.mock.method(dom.window.HTMLAnchorElement.prototype, "click", function () { downloads.push(this.download); });
    mockApi(t, ({ pathname, search }) => {
        if (pathname === base) return Response.json(payload());
        urls.push(pathname + search);
        return new Response("xlsx", { headers: {
            "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            "Content-Disposition": pathname.endsWith("template/") ? 'attachment; filename="official.xlsx"'
                : 'attachment; filename="../../unsafe.xlsx"',
        } });
    });
    await render();
    await click("הורדת תבנית Excel");
    await choose(".guest-filters label:nth-child(4) select", "all");
    await click("ייצוא ל-Excel");
    assert.deepEqual(urls, [base + "template/", base + "export/?archive=all"]);
    assert.deepEqual(downloads, ["official.xlsx", "knotiqo-guests.xlsx"]);
});

test("defaults to adults, derives a mixed family and prevents counts above the total", async (t) => {
    let saved = guest;
    mockApi(t, ({ pathname }, method, options) => {
        if (method === "GET") return Response.json(payload([saved], { summary: {
            ...payload().summary, attendees: saved.party_size, unnamed_companions: saved.unnamed_companions,
            adult_count: saved.adult_count ?? 0, child_count: saved.child_count ?? 0,
            infant_count: saved.infant_count ?? 0, unclassified_count: saved.unclassified_count,
        } }));
        assert.equal(pathname, base + "10/");
        assert.equal(method, "PATCH");
        const values = JSON.parse(options.body);
        assert.deepEqual([values.adult_count, values.child_count, values.infant_count, values.party_size], [2, 1, 1, 4]);
        saved = { ...guest, ...values, unclassified_count: 0, unnamed_companions: 3 };
        return Response.json(saved);
    });
    await render();
    await click("עריכה");
    assert.equal(container.querySelector('input[name="adult_count"]').value, "3");
    const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value").set;
    for (const [name, value] of [["party_size", "4"], ["child_count", "5"], ["infant_count", "1"]]) {
        const field = container.querySelector(`input[name="${name}"]`);
        await act(() => { setter.call(field, value); field.dispatchEvent(new dom.window.Event("input", { bubbles: true })); });
    }
    await click("שמירת מוזמן");
    assert.match(container.querySelector(".guest-age-fields").textContent, /לא יכול לעלות/);
    const childCount = container.querySelector('input[name="child_count"]');
    await act(() => { setter.call(childCount, "1"); childCount.dispatchEvent(new dom.window.Event("input", { bubbles: true })); });
    assert.equal(container.querySelector('input[name="adult_count"]').value, "2");
    await click("שמירת מוזמן");
    await settle();
    assert.match(container.querySelector("tbody").textContent, /4 מקומות.*מבוגרים 2.*ילדים 1.*תינוקות 1/);
    assert.match(container.querySelector(".guest-summary").textContent, /מקומות למוזמנים4.*מבוגרים2/);
});

const session = {
    session_id: "session-7", expires_at: "2027-01-01T10:00:00Z",
    worksheets: [{ name: "הוראות", columns: [] }, { name: "Guests", columns: [
        { column: 1, heading: "Name", suggested_field: "full_name" },
        { column: 2, heading: "נייד", suggested_field: "phone" },
    ] }],
};
const preview = {
    preview_id: "preview-7", worksheet: "Guests", unmapped_columns: [],
    rows: [
        { row: 2, values: { full_name: guest.full_name }, errors: {}, warnings: [],
            duplicates: { rows: [{ row: 4, matched_on: ["name"] }], guests: [{ ...guest, is_archived: true, matched_on: ["phone"] }] } },
        { row: 3, values: { full_name: "" }, errors: { full_name: ["blank"] }, warnings: [] },
        { row: 4, values: { full_name: "אורח חדש" }, errors: {}, warnings: [], duplicates: { rows: [], guests: [] } },
        { row: 5, values: { full_name: "פריט לבדיקה" }, errors: {}, warnings: ["review_section_boundary"],
            duplicates: { rows: [], guests: [] } },
    ],
};

async function startWizard() {
    await click("ייבוא רשימה");
    const input = container.querySelector('input[type="file"]');
    Object.defineProperty(input, "files", { value: [new dom.window.File(["workbook"], "guests.xlsx")] });
    await act(() => input.dispatchEvent(new dom.window.Event("change", { bubbles: true })));
    await click("העלאת קובץ");
    await choose(".guest-panel select", "Guests");
    await click("המשך למיפוי");
}

test("inspects, maps, reviews errors and duplicates and confirms once with exact decisions", async (t) => {
    const confirmation = Promise.withResolvers();
    let confirmations = 0;
    let lists = 0;
    mockApi(t, ({ pathname }, method, options) => {
        if (pathname === base) { lists += 1; return Response.json(payload()); }
        assert.equal(method, "POST");
        if (pathname === importBase) {
            assert.equal(options.body.get("workbook").name, "guests.xlsx");
            assert.equal(options.headers["Content-Type"], undefined);
            return Response.json(session, { status: 201 });
        }
        if (pathname === importBase + "session-7/preview/") {
            assert.deepEqual(JSON.parse(options.body), { worksheet: "Guests", mapping: { full_name: 1, phone: 2 } });
            return Response.json(preview);
        }
        assert.equal(pathname, importBase + "session-7/confirm/");
        confirmations += 1;
        assert.deepEqual(JSON.parse(options.body), { preview_id: "preview-7", decisions: [
            { row: 2, action: "restore", guest_id: 10 }, { row: 3, action: "skip" }, { row: 4, action: "create" },
        ] });
        return confirmation.promise;
    });
    await render();
    await startWizard();
    assert.equal(container.querySelectorAll(".guest-panel select")[1].value, "phone");
    assert.equal(container.querySelectorAll(".guest-panel select")[1].querySelector('option[value="full_name"]').disabled, true);
    await choose(".guest-panel .guest-fields label:nth-child(2) select", "");
    await choose(".guest-panel .guest-fields label:nth-child(2) select", "phone");
    await click("הצגת תצוגה מקדימה");
    assert.match(container.textContent, /שם מלא · שדה חובה/);
    await click("סקירת כפילויות");
    assert.match(container.textContent, /שם דומה בלבד/);
    assert.match(container.textContent, /התאמה לפי טלפון/);
    await choose(".guest-row-list > li:nth-child(1) select", "10");
    await choose(".guest-row-list > li:nth-child(2) select", "skip");
    await click("בחירת הוספה לשורות תקינות ללא התאמות");
    assert.equal(container.querySelector(".guest-row-list > li:nth-child(4) select").value, "");
    await click("המשך לאישור");
    await click("אישור ושמירת הייבוא");
    await click("אישור ושמירת הייבוא");
    assert.equal(confirmations, 1);
    await act(() => confirmation.resolve(Response.json({ created: 1, skipped: 1, updated: 0, restored: 1 })));
    assert.match(container.textContent, /נוספו 1 · דולגו 1 · עודכנו 0 · שוחזרו 1/);
    await click("חזרה לרשימת המוזמנים");
    await settle();
    assert.equal(lists, 2);
});

test("supports expired-session restart and cancelling before any confirmation", async (t) => {
    mockApi(t, ({ pathname }) => {
        if (pathname === base) return Response.json(payload());
        if (pathname === importBase) return Response.json(session);
        assert.equal(pathname, importBase + "session-7/preview/");
        return Response.json({ error: { code: "session_expired" } }, { status: 410 });
    });
    await render();
    await startWizard();
    await click("הצגת תצוגה מקדימה");
    assert.match(container.querySelector('[role="alert"]').textContent, /תוקף הייבוא פג/);
    await click("העלאת קובץ מחדש");
    assert.ok(container.querySelector('input[type="file"]'));
    await click("ביטול ייבוא");
    assert.equal(container.querySelector('input[type="file"]'), null);
});

test("aborts stale guest data on wedding changes and blocks unauthorized guest routes", async (t) => {
    const pending = Promise.withResolvers();
    let signal;
    mockApi(t, ({ pathname }, _method, options) => {
        if (pathname === base) { signal = options.signal; return pending.promise; }
        if (pathname === "/api/weddings/8/guests/") return Response.json(payload([]));
        assert.equal(pathname, "/api/weddings/");
        return Response.json([{ id: 7, name: "Shared", wedding_date: null, memberships: [] }]);
    });
    await render(7);
    await render(8);
    assert.equal(signal.aborted, true);
    await act(() => pending.resolve(Response.json(payload())));
    assert.doesNotMatch(container.textContent, /נועה לוי/);
    window.history.replaceState(null, "", "/#/weddings/999/guests");
    await act(() => root.render(createElement(WeddingWorkspace)));
    assert.match(container.querySelector('[role="alert"]').textContent, /אינה זמינה/);
});
