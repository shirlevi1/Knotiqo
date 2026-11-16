import assert from "node:assert/strict";
import { after, afterEach, before, beforeEach, test } from "node:test";
import { JSDOM } from "jsdom";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { createServer } from "vite";

const dom = new JSDOM("<div id='app'></div>", { url: "http://localhost:5173/" });
const container = dom.window.document.querySelector("#app");
const originalFormData = globalThis.FormData;
const input = {
    total_budget: "120000.00",
    guests: 300,
    price_per_guest: "350.00",
    other_expenses: "25000.00",
};
const result = {
    budget_analysis: {
        venue_cost: "105000.00",
        total_expenses: "130000.00",
        remaining_budget: "-10000.00",
        over_budget: true,
    },
    ai_recommendation: "בדקו אם אפשר לצמצם הוצאות נוספות.",
};

let server;
let BudgetAssistant;
let root;

before(async () => {
    globalThis.window = dom.window;
    globalThis.document = dom.window.document;
    globalThis.FormData = dom.window.FormData;
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    document.cookie = "csrftoken=test%2Dcsrf";

    server = await createServer({
        configFile: false,
        server: { middlewareMode: true, ws: false, watch: null },
    });
    ({ default: BudgetAssistant } = await server.ssrLoadModule("/src/components/BudgetAssistant.tsx"));
});

after(async () => {
    await server?.close();
    dom.window.close();
    globalThis.FormData = originalFormData;
    delete globalThis.IS_REACT_ACT_ENVIRONMENT;
    delete globalThis.document;
    delete globalThis.window;
});

beforeEach(() => {
    root = createRoot(container);
});

afterEach(async () => {
    await act(() => root.unmount());
});

async function render(weddingId = 7) {
    await act(() => root.render(createElement(BudgetAssistant, { key: weddingId, weddingId })));
    container.querySelector("details").open = true;
}

function fillForm(values = input) {
    for (const [name, value] of Object.entries(values)) {
        container.querySelector(`input[name="${name}"]`).value = String(value);
    }
}

function submit() {
    container.querySelector("form").dispatchEvent(new dom.window.Event("submit", {
        bubbles: true, cancelable: true,
    }));
}

function mockHttp(t, post) {
    return t.mock.method(globalThis, "fetch", (url, options) => {
        if (url === "/api/auth/csrf/") return Promise.resolve(Response.json({}));
        return post(url, options);
    });
}

test("submits exact amounts with session and CSRF, and shows the verified result separately", async (t) => {
    mockHttp(t, async (url, options) => {
        assert.equal(url, "/api/ai/weddings/7/budget-analysis/");
        assert.equal(options.method, "POST");
        assert.equal(options.credentials, "same-origin");
        assert.equal(options.cache, "no-store");
        assert.equal(options.headers["X-CSRFToken"], "test-csrf");
        assert.deepEqual(JSON.parse(options.body), input);
        return Response.json(result);
    });
    await render();
    fillForm();
    await act(submit);

    const sections = container.querySelectorAll(".budget-results section");
    assert.equal(sections.length, 2);
    assert.match(sections[0].textContent, /105,000\.00/);
    assert.match(sections[0].textContent, /130,000\.00/);
    assert.match(sections[0].textContent, /-10,000\.00/);
    assert.match(sections[0].textContent, /₪/);
    assert.match(sections[0].textContent, /חריגה מהתקציב/);
    assert.equal(sections[1].querySelector("p").textContent, result.ai_recommendation);
});

test("rejects fractional guests, negative amounts and too many decimal places before HTTP", async (t) => {
    const http = mockHttp(t, () => assert.fail("Invalid input must not reach the API"));
    await render();
    fillForm({ ...input, guests: "1.5", price_per_guest: "-1", other_expenses: "0.123" });
    await act(submit);

    assert.equal(http.mock.callCount(), 0);
    assert.equal(container.querySelectorAll('[aria-invalid="true"]').length, 3);
    assert.ok(container.querySelector('[role="alert"]'));
});

for (const [status, message] of [
    [400, /בדקו את נתוני התקציב/],
    [401, /לאמת את הבקשה/],
    [403, /לאמת את הבקשה/],
    [404, /החתונה אינה זמינה/],
    [503, /שירות ההמלצות אינו זמין/],
]) {
    test(`shows an actionable error for HTTP ${status}`, async (t) => {
        mockHttp(t, async () => Response.json({ price_per_guest: ["raw server message"] }, { status }));
        await render();
        fillForm();
        await act(submit);

        assert.match(container.querySelector('[role="alert"]').textContent, message);
        assert.doesNotMatch(container.textContent, /raw server message/);
        if (status === 400) {
            const field = container.querySelector('input[name="price_per_guest"]');
            assert.equal(field.getAttribute("aria-invalid"), "true");
            assert.ok(document.getElementById(field.getAttribute("aria-describedby")));
        }
        assert.equal(container.querySelector("button").disabled, false);
        assert.equal(container.querySelector(".budget-results"), null);
    });
}

test("shows loading and ignores duplicate submissions until the response arrives", async (t) => {
    const pending = Promise.withResolvers();
    const http = mockHttp(t, () => pending.promise);
    await render();
    fillForm();
    await act(() => {
        submit();
        submit();
    });

    assert.equal(http.mock.callCount(), 2); // CSRF GET and one POST
    assert.equal(container.querySelector("button").disabled, true);
    assert.match(container.querySelector('[role="status"]').textContent, /מנתחים את התקציב/);
    await act(() => pending.resolve(Response.json(result)));
    assert.equal(container.querySelector("button").disabled, false);
    assert.equal(container.querySelector('[role="status"]'), null);
    assert.ok(container.querySelector(".budget-results"));
});

test("aborts an old wedding request and ignores a late response after switching weddings", async (t) => {
    const pending = Promise.withResolvers();
    const http = mockHttp(t, () => pending.promise);
    await render(7);
    fillForm();
    await act(submit);
    const [, options] = http.mock.calls[1].arguments;

    await render(8);
    assert.equal(options.signal.aborted, true);
    await act(() => pending.resolve(Response.json(result)));
    assert.equal(container.querySelector(".budget-results"), null);
    assert.equal(container.querySelector('input[name="total_budget"]').value, "");
});
