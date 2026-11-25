import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { JSDOM } from "jsdom";
import { act, createElement } from "react";
import { createServer } from "vite";

const token = "a".repeat(43);
const dom = new JSDOM("<div id='app'></div>", { url: "https://fixture.example/#/rsvp/" + token });
const { window } = dom;
const container = window.document.querySelector("#app");
const nativeFormData = globalThis.FormData;
let vite, App, Share, createRoot, invitationMessage, whatsappUrl;

before(async () => {
    Object.assign(globalThis, { window, document: window.document, FormData: window.FormData, IS_REACT_ACT_ENVIRONMENT: true });
    ({ createRoot } = await import("react-dom/client"));
    vite = await createServer({ configFile: false, server: { middlewareMode: true, ws: false, watch: null } });
    ({ default: App } = await vite.ssrLoadModule("/src/App.tsx"));
    ({ default: Share } = await vite.ssrLoadModule("/src/components/GuestRSVPShare.tsx"));
    ({ invitationMessage, whatsappUrl } = await vite.ssrLoadModule("/src/api/rsvp.ts"));
});
after(async () => {
    await vite?.close();
    window.close();
    globalThis.FormData = nativeFormData;
    for (const name of ["window", "document", "IS_REACT_ACT_ENVIRONMENT"]) delete globalThis[name];
});

test("opens a signed-out invitation, validates and saves a partial family response", async (t) => {
    const calls = [];
    t.mock.method(globalThis, "fetch", async (url, options) => {
        if (url === "/api/auth/csrf/") {
            document.cookie = "csrftoken=rsvp-fixture";
            return Response.json({});
        }
        assert.equal(url, "/api/rsvp/");
        assert.equal(options.headers["X-CSRFToken"], "rsvp-fixture");
        const body = JSON.parse(options.body);
        assert.equal(body.token, token);
        calls.push(body);
        if (body.action === "respond") return Response.json({ saved: true });
        return Response.json({ creator_display_name: "דנה", partner_display_name: "גל", wedding_date: "2027-04-08",
            invited_count: 3, age_limits: { adult_count: 2, child_count: 1, infant_count: 0 }, options: ["attending", "declining", "maybe"] });
    });
    const root = createRoot(container);
    try {
        await act(() => root.render(createElement(App)));
        assert.equal(container.querySelector("main").dir, "rtl");
        assert.equal(container.querySelector(".rsvp-heading time").dateTime, "2027-04-08");
        await act(() => container.querySelector('[value="attending"]').click());
        const form = container.querySelector("form");
        form.elements.adult_count.value = "1";
        form.elements.child_count.value = "0";
        await act(() => form.requestSubmit());
        assert.deepEqual(calls[1], { token, action: "respond", status: "attending", adult_count: 1, child_count: 0, infant_count: 0 });
        assert.match(container.textContent, /תודה, התשובה נשמרה/);
    } finally {
        await act(() => root.unmount());
    }
});

test("disables external sharing without a configured public host", async (t) => {
    t.mock.method(globalThis, "fetch", async (url) => {
        assert.equal(url, "/api/weddings/2/guests/5/rsvp-link/");
        return Response.json({ sharing_enabled: false, link_active: false, response: null, expires_at: null });
    });
    const root = createRoot(container);
    try {
        await act(() => root.render(createElement(Share, { weddingId: 2, guest: { id: 5, full_name: "Fixture", phone: "" }, close: () => {} })));
        assert.match(container.textContent, /אורחים אינם יכולים לפתוח קישור מהמחשב המקומי/);
        assert.equal(container.querySelector("a"), null);
        assert.doesNotMatch(container.textContent, /יצירת קישור אישי/);
    } finally {
        await act(() => root.unmount());
    }
});

test("encodes customized Hebrew and the entire fragment for manual WhatsApp sharing", () => {
    const link = "https://fixture.example/#/rsvp/" + token;
    const message = invitationMessage("אישור הגעה & שאלות?\n{link}", link);
    const targeted = new URL(whatsappUrl(message, "+972 (50) 123-4567"));
    assert.equal(targeted.origin, "https://wa.me");
    assert.equal(targeted.pathname, "/972501234567");
    assert.equal(targeted.hash, "");
    assert.equal(targeted.searchParams.get("text"), message);
    assert.equal(new URL(whatsappUrl(message, "0501234567")).pathname, "/");
    assert.equal(invitationMessage("שלום", link), "שלום\n" + link);
});
