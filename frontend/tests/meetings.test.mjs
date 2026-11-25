import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { JSDOM } from "jsdom";
import { act, createElement } from "react";
import { createServer } from "vite";

const dom = new JSDOM("<div id='app'></div>", { url: "http://localhost:5173/" });
const { window } = dom;
const container = window.document.querySelector("#app");
const nativeFormData = globalThis.FormData;
const prefix = "/api/weddings/7/meetings/";
const options = [{ kind: "venue", name: "אולם לבדיקה", id: 4 }, { kind: "vendor", name: "ספק לבדיקה", id: 8 }];
let vite, Workspace, createRoot, meetingToday;

before(async () => {
    Object.assign(globalThis, { window, document: window.document, FormData: window.FormData, IS_REACT_ACT_ENVIRONMENT: true });
    ({ createRoot } = await import("react-dom/client"));
    vite = await createServer({ configFile: false, server: { middlewareMode: true, ws: false, watch: null } });
    ({ default: Workspace } = await vite.ssrLoadModule("/src/WeddingWorkspace.tsx"));
    ({ meetingToday } = await vite.ssrLoadModule("/src/api/meetings.ts"));
});
after(async () => {
    await vite?.close();
    window.close();
    globalThis.FormData = nativeFormData;
    for (const key of ["window", "document", "IS_REACT_ACT_ENVIRONMENT"]) delete globalThis[key];
});

const button = (text, region = container) => [...region.querySelectorAll("button")].find((node) => node.textContent === text);
const click = async (text, region) => {
    const target = button(text, region);
    assert.ok(target, text);
    await act(() => target.click());
};

function fixture(date) {
    return { id: 12, title: "סיור לתיאום", meeting_type: "venue_tour", status: "scheduled", date,
        start_time: "10:30", end_time: "11:00", starts_at: date + "T08:30:00Z", ends_at: date + "T09:00:00Z",
        venue_id: 4, venue_name: options[0].name, vendor_id: null, vendor_name: null,
        contact_person: "", phone: "", location: "", video_url: "", notes: "",
        venue_details: { location: "כתובת האולם", contact_person: "איש קשר", phone: "0501234567",
            image_url: "https://example.com/primary.jpg", image_alt: "תמונת אולם" } };
}

function common(url) {
    if (url === "/api/weddings/?include=memberships") return Response.json([{ id: 7, name: "Shared", wedding_date: null, memberships: [] }]);
    if (url === "/api/auth/csrf/") {
        document.cookie = "csrftoken=meeting-fixture";
        return Response.json({});
    }
    if (url === prefix + "options/") return Response.json(options);
    if (url.startsWith(prefix + "upcoming/")) return Response.json([]);
}

test("navigates the RTL calendar, selects a date, validates times and renders saved meetings in the agenda", async (t) => {
    const date = meetingToday();
    let record = null;
    const writes = [];
    const queries = [];
    t.mock.method(globalThis, "fetch", async (url, init = {}) => {
        const response = common(url);
        if (response) return response;
        if (url.startsWith(prefix + "dates/")) return Response.json(record ? [record.date] : []);
        if (url.startsWith(prefix + "?summary=1")) return Response.json({ count: record ? 1 : 0, first: record });
        if (url.startsWith(prefix + "?")) {
            queries.push(new URL(url, "http://localhost").searchParams);
            return Response.json({ count: record ? 1 : 0, next: null, previous: null, results: record ? [record] : [] });
        }
        assert.equal(init.headers["X-CSRFToken"], "meeting-fixture");
        const body = JSON.parse(init.body);
        writes.push({ method: init.method, body });
        record = { ...fixture(body.date ?? date), ...record, ...body };
        return Response.json(record, { status: init.method === "POST" ? 201 : 200 });
    });
    window.history.replaceState(null, "", "/#/weddings/7/meetings");
    const root = createRoot(container);
    try {
        await act(() => root.render(createElement(Workspace)));
        assert.equal(container.querySelector(".atelier-sidebar [aria-current]").hash, "#/weddings/7/meetings");
        assert.equal(container.querySelectorAll(".meeting-day").length, 42);
        const today = container.querySelector(`[data-day="${date}"]`);
        await act(() => today.click());
        assert.equal(today.getAttribute("aria-pressed"), "true");
        assert.equal(queries.at(-1).get("date_to"), date);
        await act(() => today.click());
        assert.match(container.querySelector("#agenda-title").parentElement.parentElement.textContent, /אין פגישות/);
        await click("הוספת פגישה חדשה");
        const form = container.querySelector(".meeting-form");
        assert.equal(form.elements.date.value, date);
        form.elements.title.value = "סיור לתיאום";
        form.elements.start_time.value = "10:30";
        form.elements.end_time.value = "10:00";
        await act(() => form.requestSubmit());
        assert.match(form.querySelector("[role=alert]").textContent, /מאוחרת משעת ההתחלה/);
        assert.equal(writes.length, 0);
        form.elements.end_time.value = "11:00";
        form.elements.location.value = "מיקום הפגישה שנשמר";
        form.elements.resource.value = "venue:4";
        await act(() => form.requestSubmit());
        assert.equal(writes[0].body.venue_id, 4);
        assert.equal(writes[0].body.vendor_id, null);
        assert.match(container.querySelector(".meeting-agenda").textContent, /סיור לתיאום.*10:30/);
        assert.equal(today.dataset.occupied, "true");
        const card = container.querySelector(".meeting-rich-card");
        assert.equal(card.querySelector("img").src, "https://example.com/primary.jpg");
        assert.match(card.querySelector(".meeting-facts").textContent, /מיקום הפגישה שנשמר/);
        assert.match(card.querySelector(".meeting-facts").textContent, /0501234567/);
        await click("צפייה בפרטים", card);
        assert.ok(card.querySelector('a[href="#/weddings/7/venues/4"]'));
        const association = [...container.querySelectorAll(".meeting-filters select")].find((control) => control.querySelector('option[value="vendor"]'));
        await act(() => { association.value = "vendor"; association.dispatchEvent(new window.Event("change", { bubbles: true })); });
        assert.equal(queries.at(-1).get("association"), "vendor");
        await act(() => { association.value = ""; association.dispatchEvent(new window.Event("change", { bubbles: true })); });
        await click("סדר יום");
        assert.equal(container.querySelector(".meeting-calendar"), null);
        assert.match(container.querySelector(".meeting-agenda").textContent, /סיור לתיאום/);
        await click("עריכת פגישה");
        await click("ביטול פגישה", container.querySelector(".meeting-form"));
        await click("אישור", container.querySelector(".meeting-form"));
        assert.deepEqual(writes[1], { method: "PATCH", body: { status: "cancelled" } });
        assert.match(container.querySelector(".meeting-agenda").textContent, /בוטלה/);
    } finally { await act(() => root.unmount()); }
});

test("preselects the saved vendor on a booking shortcut and blocks inaccessible weddings", async (t) => {
    t.mock.method(globalThis, "fetch", async (url) => {
        const response = common(url);
        if (response) return response;
        assert.ok(url.startsWith(prefix));
        if (url.startsWith(prefix + "dates/")) return Response.json([]);
        return Response.json({ count: 0, next: null, previous: null, results: [] });
    });
    const root = createRoot(container);
    try {
        window.history.replaceState(null, "", "/#/weddings/7/meetings/new/vendor/8");
        await act(() => root.render(createElement(Workspace)));
        assert.equal(container.querySelector(".meeting-form select[name=resource]").value, "vendor:8");
        await act(() => {
            window.history.replaceState(null, "", "/#/weddings/999/meetings");
            window.dispatchEvent(new window.Event("hashchange"));
        });
        assert.equal(container.querySelector(".meetings-page"), null);
        assert.match(container.querySelector("[role=alert]").textContent, /החתונה אינה זמינה/);
    } finally { await act(() => root.unmount()); }
});

test("the homepage shows only the nearest three active meetings with Jerusalem times and saved venue context", async (t) => {
    const date = "2027-01-01";
    const first = { ...fixture(date), id: 3, title: "סיור קרוב", starts_at: "2026-12-31T22:30:00Z",
        start_time: "00:30", end_time: "01:15", location: "כתובת הפגישה" };
    const later = (id, hour, status = "scheduled") =>
        ({ ...fixture(date), id, title: "פגישה " + id, starts_at: date + "T" + hour + ":00:00Z", status });
    let requests = 0;
    t.mock.method(globalThis, "fetch", async (url) => {
        if (url === prefix + "upcoming/?scope=dashboard") {
            requests++;
            return Response.json([later(5, "10"), later(9, "01", "cancelled"), later(6, "12"),
                later(4, "08"), first, later(8, "02", "completed")]);
        }
        return common(url) ?? Response.json([], { status: 404 });
    });
    window.history.replaceState(null, "", "/");
    const root = createRoot(container);
    try {
        await act(() => root.render(createElement(Workspace)));
        const section = container.querySelector(".home-meetings");
        assert.match(section.textContent, /הפגישות הבאות שלנו/);
        assert.equal(requests, 1);
        const links = [...section.querySelectorAll(".home-meeting")];
        assert.deepEqual(links.map((link) => Number(link.hash.split("/").at(-1))), [3, 4, 5]);
        assert.equal(links[0].querySelector("time strong").textContent, "1");
        assert.equal(links[0].querySelector("time").dateTime, "2026-12-31T22:30:00Z");
        assert.match(links[0].textContent, /00:30–01:15/);
        assert.match(links[0].textContent, /כתובת הפגישה/);
        assert.equal(links[0].querySelector("img").src, "https://example.com/primary.jpg");
    } finally { await act(() => root.unmount()); }
});

test("the homepage empty-state link opens the existing general appointment form", async (t) => {
    t.mock.method(globalThis, "fetch", async (url) => common(url) ??
        Response.json(url.startsWith(prefix + "dates/") ? [] : { count: 0, first: null, results: [], next: null, previous: null }));
    window.history.replaceState(null, "", "/");
    const root = createRoot(container);
    try {
        await act(() => root.render(createElement(Workspace)));
        const link = container.querySelector('.home-meetings a[href$="/meetings/new"]');
        assert.ok(link);
        await act(() => {
            window.history.replaceState(null, "", "/" + link.hash);
            window.dispatchEvent(new window.Event("hashchange"));
        });
        const form = container.querySelector('.meeting-form[aria-label="קביעת פגישה"]');
        assert.ok(form);
        assert.equal(form.elements.resource.value, "");
    } finally { await act(() => root.unmount()); }
});
