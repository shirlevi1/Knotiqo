import assert from "node:assert/strict";
import { after, afterEach, before, beforeEach, test } from "node:test";
import { JSDOM } from "jsdom";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { createServer } from "vite";

const dom = new JSDOM("<div id='app'></div>", { url: "http://localhost:5173/" });
const { window } = dom;
const originalFormData = globalThis.FormData;
const container = window.document.querySelector("#app");
let server;
let Workspace;
let root;

before(async () => {
    Object.assign(globalThis, { window, document: window.document, FormData: window.FormData,
        HTMLElement: window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true });
    server = await createServer({ configFile: false, server: { middlewareMode: true, ws: false, watch: null } });
    ({ default: Workspace } = await server.ssrLoadModule("/src/WeddingWorkspace.tsx"));
});
after(async () => {
    await server?.close();
    window.close();
    globalThis.FormData = originalFormData;
    for (const key of ["window", "document", "HTMLElement", "IS_REACT_ACT_ENVIRONMENT"]) delete globalThis[key];
});
beforeEach(() => { root = createRoot(container); });
afterEach(async () => {
    await act(() => root.unmount());
    window.history.replaceState(null, "", "/");
});

const base = "/api/weddings/1/budget/";
const weddings = [1, 2].map((id) => ({ id, name: `Wedding ${id}`, memberships: [], wedding_date: null }));
const snapshot = {
    currency: "ILS", total_budget: "0.00", allocated_budget: "0.00", estimated_spending: "0.00",
    unallocated_budget: "0.00", estimated_remaining_budget: "0.00", missing_estimate_count: 0, categories: [],
    attendee_summary: { attendees: 7, adult_count: 2, child_count: 1, infant_count: 1, unclassified_count: 3 },
};

function common(url) {
    if (url === "/api/weddings/?include=memberships") return Response.json(weddings);
    if (url === "/api/auth/csrf/") {
        document.cookie = "csrftoken=budget-test";
        return Response.json({});
    }
}

async function navigate(hash) {
    await act(() => {
        window.history.replaceState(null, "", "/" + hash);
        window.dispatchEvent(new window.Event("hashchange"));
    });
}

const click = async (text) => {
    const button = [...container.querySelectorAll(".budget-page button")].find((element) => element.textContent === text);
    assert.ok(button, text);
    await act(async () => button.click());
};

test("opens from the workspace, keeps Gemini available, and saves/edits/reorders/deletes categories", async (t) => {
    let current = { ...snapshot };
    const writes = [];
    t.mock.method(globalThis, "fetch", async (url, options) => {
        const response = common(url);
        if (response) return response;
        if (url === "/api/weddings/1/venues/") return Response.json([]);
        const { method, headers, body } = options;
        if (method === "GET") return Response.json(current);
        assert.equal(options.credentials, "same-origin");
        assert.equal(headers["X-CSRFToken"], "budget-test");
        const payload = body ? JSON.parse(body) : null;
        writes.push({ method, url, payload });
        if ("total_budget" in (payload ?? {})) current = { ...current, total_budget: "12.40", unallocated_budget: "12.40" };
        if (method === "POST") {
            current = { ...current, unallocated_budget: "-0.05", missing_estimate_count: 1,
                categories: [...current.categories, { id: writes.length, position: current.categories.length, ...payload }] };
        }
        if (method === "PATCH" && payload.name) {
            current = { ...current, categories: current.categories.map((item) =>
                url.endsWith(`/${item.id}/`) ? { ...item, ...payload } : item) };
        }
        if (payload?.category_ids) current = { ...current, categories: [...current.categories].reverse() };
        if (method === "DELETE") current = { ...current, categories: current.categories.filter((item) => !url.endsWith(`/${item.id}/`)) };
        return Response.json(current);
    });

    await act(() => root.render(createElement(Workspace)));
    assert.ok(container.querySelector('.workspace-tools a[href="#/weddings/1/budget"]'));
    await navigate("#/weddings/1/budget");
    assert.equal(container.querySelector(".atelier-sidebar [aria-current]").hash, "#/weddings/1/budget");
    assert.ok(container.querySelector(".budget-assistant").open);
    assert.match(container.querySelector("#budget-guests + dl").textContent, /ללא סיווג גיל3/);
    assert.match(container.querySelector(".budget-page").textContent, /עדיין אין קטגוריות/);
    const input = container.querySelector('[name="total_budget"]');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    await act(() => {
        setter.call(input, "bad");
        input.dispatchEvent(new window.Event("input", { bubbles: true }));
    });
    assert.equal(input.checkValidity(), false);
    assert.equal(writes.length, 0);
    await act(() => { input.value = "12,40"; input.form.requestSubmit(); });
    assert.deepEqual(writes[0].payload, { total_budget: "12.40" });

    for (const name of ["צילום", "מוזיקה"]) {
        await click("הוספת קטגוריה");
        const form = container.querySelector('[aria-label="הוספת קטגוריה"]');
        form.elements.name.value = name;
        form.elements.planned_amount.value = "12.45";
        await act(() => form.requestSubmit());
    }
    assert.equal(writes[1].payload.estimated_cost, null);
    assert.match(container.querySelector(".budget-metrics").textContent, /−.*0\.05/);
    await act(() => container.querySelector('[aria-label="עריכת צילום"]').click());
    const edit = container.querySelector('[aria-label="עריכת קטגוריה"]');
    edit.elements.estimated_cost.value = "8.20";
    await act(() => edit.requestSubmit());
    assert.equal(writes[3].payload.estimated_cost, "8.20");
    await act(() => container.querySelector('[aria-label="העברת מוזיקה למעלה"]').click());
    assert.deepEqual(writes[4].payload.category_ids, [3, 2]);
    await act(() => container.querySelector('[aria-label="מחיקת צילום"]').click());
    assert.equal(writes.length, 5);
    await click("אישור מחיקה");
    assert.equal(writes[5].method, "DELETE");
});

test("simulates with saved quote data, displays backend amounts, and ignores a stale wedding load", async (t) => {
    const stale = Promise.withResolvers();
    let firstSignal;
    const venue = { id: 4, name: "אולם", status: "booked", description: "", location: "", contact_name: "", phone: "",
        website: "", notes: "", capacity: null, images: [], is_favorite: false, created_at: "", updated_at: "" };
    const quote = { id: 8, event_date: "2027-05-03", price_per_guest: "12.34", minimum_guests: 5, additional_costs: "0.99",
        notes: "", created_at: "", updated_at: "" };
    t.mock.method(globalThis, "fetch", async (url, options) => {
        const response = common(url);
        if (response) return response;
        if (url === "/api/weddings/2/budget/") { firstSignal = options.signal; return stale.promise; }
        if (url === base) return Response.json(snapshot);
        if (url.endsWith("/venues/")) return Response.json([venue]);
        if (url.endsWith("/venues/4/quotes/")) return Response.json([quote]);
        assert.equal(url, base + "venue-simulation/");
        assert.deepEqual(JSON.parse(options.body), { quote_id: 8, expected_guests: 7 });
        return Response.json({ ...quote, venue_id: 4, venue_name: venue.name, quote_id: 8, expected_guests: 7,
            billable_guests: 7, meals_cost: "86.38", total_cost: "87.37" });
    });
    window.history.replaceState(null, "", "/#/weddings/2/budget");
    await act(() => root.render(createElement(Workspace)));
    await navigate("#/weddings/1/budget");
    assert.equal(firstSignal.aborted, true);
    await act(() => stale.resolve(Response.json({ ...snapshot, total_budget: "999.00" })));
    const [venueSelect, quoteSelect] = container.querySelectorAll(".budget-page select");
    for (const [select, value] of [[venueSelect, "4"], [quoteSelect, "8"]]) {
        await act(() => { select.value = value; select.dispatchEvent(new window.Event("change", { bubbles: true })); });
    }
    await click("חישוב עלות");
    assert.match(container.querySelector(".budget-page").textContent, /87\.37/);
    assert.doesNotMatch(container.querySelector(".budget-page").textContent, /999\.00/);
    assert.equal(container.querySelector(".budget-categories"), null);
});

test("records and corrects a shared payment, shows schedule gaps and overdue balances, and filters the timeline", async (t) => {
    const expensesUrl = base + "expenses/";
    const planUrl = expensesUrl + "1/payments/";
    const totals = { committed_cost: "1000.00", scheduled_amount: "500.00", paid_amount: "0.00",
        remaining_amount: "1000.00", upcoming_amount: "200.00", overdue_amount: "300.00" };
    const upcoming = { id: 9, phase: "on_day", due_date: "2027-06-16", amount: "200.00", notes: "",
        status: "unpaid", paid_amount: "0.00", paid_date: null, outstanding_amount: "200.00", timing: "upcoming" };
    const deposit = { id: 8, phase: "deposit", due_date: "2027-06-01", amount: "300.00", notes: "אישור ספק",
        status: "unpaid", paid_amount: "0.00", paid_date: null, outstanding_amount: "300.00", timing: "overdue" };
    const expense = { id: 1, category_id: 2, venue_id: null, venue_name: null, name: "צילום", supplier_name: "סטודיו",
        committed_cost: "1000.00", scheduled_amount: "500.00", paid_amount: "0.00", remaining_amount: "1000.00",
        schedule_difference: "500.00", schedule_status: "incomplete", payments: [deposit, upcoming] };
    const tracking = { currency: "ILS", as_of: "2027-06-15", wedding_date: "2027-06-16", expenses: [], totals };
    const writes = [];
    t.mock.method(globalThis, "fetch", async (url, options) => {
        const response = common(url);
        if (response) return response;
        if (url === base) return Response.json({ ...snapshot,
            categories: [{ id: 2, name: "צילום", planned_amount: "900.00", estimated_cost: null, position: 0 }] });
        if (url.endsWith("/venues/")) return Response.json([]);
        if (options.method === "GET") { assert.equal(url, expensesUrl); return Response.json(tracking); }
        assert.equal(options.headers["X-CSRFToken"], "budget-test");
        assert.equal(options.credentials, "same-origin");
        const body = JSON.parse(options.body);
        writes.push({ url, method: options.method, body });
        if (url === expensesUrl) tracking.expenses = [{ ...expense, ...body, committed_cost: "1000.00", payments: [deposit] }];
        if (url === planUrl) tracking.expenses[0].payments = [deposit, { ...upcoming, ...body, amount: "200.00", paid_amount: "0.00" }];
        if (url === planUrl + "8/") {
            tracking.totals = { ...totals, paid_amount: "120.00", remaining_amount: "880.00", overdue_amount: "180.00" };
            tracking.expenses[0] = { ...tracking.expenses[0], paid_amount: "120.00", remaining_amount: "880.00",
                payments: [{ ...deposit, ...body, amount: "300.00", paid_amount: "120.00", status: "partial", outstanding_amount: "180.00" }, upcoming] };
        }
        return Response.json(tracking);
    });

    window.history.replaceState(null, "", "/#/weddings/1/budget");
    await act(() => root.render(createElement(Workspace)));
    await click("הוספת התחייבות");
    let form = container.querySelector('[aria-label="הוספת התחייבות"]');
    form.elements.name.value = "צילום";
    form.elements.category_id.value = "2";
    form.elements.committed_cost.value = "1000";
    form.elements.supplier_name.value = "סטודיו";
    await act(() => form.requestSubmit());
    assert.equal(writes[0].body.committed_cost, "1000");
    assert.match(container.querySelector(".budget-commitments").textContent, /חסר בלוח התשלומים/);
    assert.match(container.querySelector(".budget-timeline-group").textContent, /מקדמה.*באיחור/);
    await click("הוספת תשלום");
    form = container.querySelector('[aria-label="הוספת תשלום"]');
    form.elements.phase.value = "on_day";
    form.elements.amount.value = "200";
    form.elements.due_date.value = "2027-06-16";
    await act(() => form.requestSubmit());
    assert.deepEqual(writes[1].body, { phase: "on_day", due_date: "2027-06-16", amount: "200",
        paid_amount: "0", paid_date: null, notes: "" });
    assert.equal(container.querySelectorAll(".budget-timeline-group").length, 2);

    await click("עריכת תשלום");
    form = container.querySelector('[aria-label="עריכת תשלום"]');
    form.elements.paid_amount.value = "120";
    await act(() => form.requestSubmit());
    assert.equal(writes.length, 2);
    assert.match(form.querySelector("[role=alert]").textContent, /יש להזין תאריך/);
    form.elements.paid_date.value = "2027-06-15";
    await act(() => form.requestSubmit());
    assert.equal(writes[2].method, "PATCH");
    assert.equal(writes[2].url, planUrl + "8/");
    assert.match(container.querySelector(".budget-timeline-group").textContent, /שולם חלקית/);
    assert.match(container.querySelector(".budget-commitments .budget-metrics").textContent, /880\.00/);

    const filter = container.querySelector(".budget-commitments select");
    await act(() => { filter.value = "partial"; filter.dispatchEvent(new window.Event("change", { bubbles: true })); });
    assert.equal(container.querySelectorAll(".budget-timeline-group").length, 1);
    assert.match(container.querySelector(".budget-timeline-group").textContent, /מקדמה/);
});

test("manages wedding vendors, selects quotes, and confirms financial linking separately", async (t) => {
    const vendorUrl = "/api/weddings/1/vendors/";
    const quotesUrl = vendorUrl + "5/quotes/";
    const finance = { currency: "ILS", as_of: "2027-06-15", wedding_date: null, expenses: [], vendor_totals: {},
        totals: { committed_cost: "0.00", scheduled_amount: "0.00", paid_amount: "0.00", remaining_amount: "0.00",
            upcoming_amount: "0.00", overdue_amount: "0.00" } };
    const categories = [{ id: 2, name: "צילום", planned_amount: "900.00", estimated_cost: null, position: 0 }];
    let vendors = [];
    const mutations = [];
    t.mock.method(globalThis, "fetch", async (url, options) => {
        const response = common(url);
        if (response) return response;
        if (url === base) return Response.json({ ...snapshot, categories });
        if (url.endsWith("/venues/")) return Response.json([]);
        if (url === base + "expenses/") return Response.json(finance);
        if (options.method === "GET") { assert.equal(url, vendorUrl); return Response.json(vendors); }
        assert.equal(options.credentials, "same-origin");
        assert.equal(options.headers["X-CSRFToken"], "budget-test");
        const body = JSON.parse(options.body);
        mutations.push({ url, body });
        if (url === vendorUrl) vendors = [{ id: 5, ...body, quotes: [] }];
        else if (url === vendorUrl + "5/") vendors[0] = { ...vendors[0], ...body };
        else if (url === quotesUrl) vendors[0].quotes.push({ id: 6, ...body, amount: "100.25" });
        else if (url === quotesUrl + "6/") Object.assign(vendors[0].quotes[0], body);
        else {
            assert.equal(url, vendorUrl + "5/commitments/");
            assert.deepEqual(body, { quote_id: 6, category_id: 2, confirmed: true });
            finance.expenses = [{ id: 7, category_id: 2, vendor_id: 5, source_quote_id: 6, venue_id: null, venue_name: null,
                name: "צילום", supplier_name: "", committed_cost: "100.25", scheduled_amount: "0.00", paid_amount: "0.00",
                remaining_amount: "100.25", schedule_difference: "100.25", schedule_status: "incomplete", payments: [] }];
            finance.vendor_totals[5] = { committed_cost: "100.25", paid_amount: "0.00", remaining_amount: "100.25" };
            Object.assign(finance.totals, finance.vendor_totals[5]);
            return Response.json(finance, { status: 201 });
        }
        return Response.json(vendors);
    });
    window.history.replaceState(null, "", "/#/weddings/1/vendors");
    await act(() => root.render(createElement(Workspace)));
    assert.equal(container.querySelector(".atelier-sidebar [aria-current]").hash, "#/weddings/1/vendors");
    assert.match(container.querySelector(".vendors-page").textContent, /עוד אין ספקים/);
    const choose = async (text, selector = ".vendors-page") => {
        const button = [...container.querySelectorAll(selector + " button")].find((node) => node.textContent === text);
        assert.ok(button, text);
        await act(() => button.click());
    };
    await choose("הוספת ספק");
    let form = container.querySelector('[aria-label="הוספת ספק"]');
    form.elements.name.value = "סטודיו";
    form.elements.service_category.value = "צילום מותאם";
    await act(() => form.requestSubmit());
    assert.equal(mutations[0].body.service_category, "צילום מותאם");
    assert.equal(container.querySelectorAll(".vendors-table tbody tr").length, 1);
    assert.equal(container.querySelectorAll(".vendors-mobile > li").length, 1);
    const picker = container.querySelector(".vendors-filters select");
    await act(() => { picker.value = "מגנטים"; picker.dispatchEvent(new window.Event("change", { bubbles: true })); });
    assert.match(container.querySelector(".vendors-page").textContent, /לא נמצאו ספקים/);
    await choose("ניקוי מסננים");
    await choose("פרטים", ".vendors-table");
    await choose("עריכה");
    form = container.querySelector('[aria-label="עריכת ספק"]');
    form.elements.status.value = "shortlisted";
    await act(() => form.requestSubmit());
    await choose("הוספת הצעה");
    form = container.querySelector('[aria-label="הוספת הצעה"]');
    form.elements.title.value = "צילום";
    form.elements.amount.value = "100.25";
    await act(() => form.requestSubmit());
    await choose("בחירת הצעה");
    assert.deepEqual(mutations[3].body, { status: "selected" });
    assert.equal(finance.expenses.length, 0);
    await choose("יצירת התחייבות");
    form = container.querySelector(".vendors-editor form");
    form.elements.category_id.value = "2";
    await act(() => form.requestSubmit());
    assert.equal(mutations.length, 4);
    form.querySelector('input[type="checkbox"]').checked = true;
    await act(() => form.requestSubmit());
    assert.match(container.querySelector(".vendors-table").textContent, /100\.25/);
    assert.ok(container.querySelector('a[href="#/weddings/1/budget/expenses/7"]'));
    await navigate("#/weddings/1/budget/new-expense");
    assert.ok(container.querySelector('[aria-label="הוספת התחייבות"]'));
    await navigate("#/weddings/1/budget/expenses/7");
    assert.match(container.querySelector(".budget-commitments .budget-categories").textContent, /צילום/);
});
