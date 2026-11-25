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

async function navigate(hash) {
    await act(() => {
        window.history.replaceState(null, "", "/" + hash);
        window.dispatchEvent(new dom.window.Event("hashchange"));
    });
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
    const input = container.querySelector('.workspace-cover-dialog input[type="file"]');
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
    assert.match(container.querySelector(".workspace-cover-dialog [role=alert]").textContent, /בחרו תמונה/);
    await selectCover("image/png");
    assert.equal(container.querySelector(".workspace-cover-dialog img").getAttribute("src"), "blob:preview");
    await coverClick("ביטול");
    assert.equal(container.querySelector(".workspace-cover-dialog"), null);
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
    assert.equal(container.querySelector(".workspace-cover-dialog"), null);
});

test("uses only the selected wedding's cover and recovers from image load failure", async (t) => {
    mockWeddings(t, [wedding(1, [], { cover_image_url: personalCover }), wedding(2, [])]);
    await render();
    assert.equal(coverSrc(), personalCover);
    const select = container.querySelector(".atelier-sidebar select");
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
    assert.equal(container.querySelector(".workspace-settings .partner-invitation"), null);
    await navigate("#/weddings/1/settings");
    assert.ok(container.querySelector(".atelier-settings .partner-invitation"));
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
    assert.equal(settings.querySelector(".couple-name-editor"), null);
    assert.equal(container.querySelectorAll(".budget-assistant summary").length, 0);
    const select = container.querySelector(".atelier-sidebar select");
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
    assert.ok(cards[2].querySelector('a[href="#/weddings/2/budget"]'));
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
    await navigate("#/weddings/1/settings");
    await act(() => container.querySelector(".couple-name-editor button").click());
    const form = container.querySelector(".couple-name-form");
    form.elements.namedItem("creator_display_name").value = "  דנה  ";
    form.elements.namedItem("partner_display_name").value = "  יובל  ";
    await act(() => form.requestSubmit());

    assert.equal(container.querySelector(".couple-name-form"), null);
    assert.ok(container.querySelector(".partner-invitation"));
    await navigate("#workspace");
    assert.equal(container.querySelector(".workspace-hero h1").textContent, "דנה ויובל");
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
    await act(() => container.querySelector(".workspace-content button").click());
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

test("sidebar preserves the wedding across account and settings routes and saves the shared date", async (t) => {
    let date = null;
    t.mock.method(globalThis, "fetch", async (url, options) => {
        if (url === "/api/auth/csrf/") {
            document.cookie = "csrftoken=settings-test";
            return Response.json({});
        }
        if (url === "/api/weddings/2/") {
            assert.equal(options.method, "PATCH");
            assert.equal(options.headers["X-CSRFToken"], "settings-test");
            date = JSON.parse(options.body).wedding_date;
            return Response.json({ wedding_date: date });
        }
        if (url === "/api/weddings/2/budget/") return Response.json({}, { status: 503 });
        assert.equal(url, "/api/weddings/?include=memberships");
        return Response.json([wedding(1, []), wedding(2, [], { wedding_date: date })]);
    });
    await render();
    await navigate("#/weddings/2/budget");
    assert.equal(container.querySelector(".atelier-sidebar [aria-current]").getAttribute("href"), "#/weddings/2/budget");
    assert.equal(container.querySelector(".budget-assistant").open, true);
    await navigate("#/weddings/2/settings");
    const form = container.querySelector(".atelier-settings form");
    form.elements.namedItem("date").value = "2027-06-15";
    await act(() => form.requestSubmit());
    assert.match(form.textContent, /השינויים נשמרו/);
    await navigate("#workspace");
    assert.equal(container.querySelector(".workspace-hero time").dateTime, "2027-06-15");
    const collapse = container.querySelector(".atelier-collapse");
    await act(() => collapse.click());
    assert.equal(collapse.getAttribute("aria-expanded"), "false");
});

test("profile and password forms use the account API and validate password confirmation", async (t) => {
    const profile = { first_name: "Dana", last_name: "", email: "old@example.com" };
    let passwordWrites = 0;
    t.mock.method(globalThis, "fetch", async (url, options) => {
        if (url === "/api/weddings/?include=memberships") return Response.json([]);
        if (url === "/api/auth/csrf/") {
            document.cookie = "csrftoken=account-test";
            return Response.json({});
        }
        if (url === "/api/auth/profile/" && !options.method) return Response.json(profile);
        assert.equal(options.headers["X-CSRFToken"], "account-test");
        assert.equal(options.credentials, "same-origin");
        const payload = JSON.parse(options.body);
        if (url === "/api/auth/profile/") {
            assert.deepEqual(payload, { ...profile, email: "new@example.com" });
            return Response.json(payload);
        }
        assert.equal(url, "/api/auth/change-password/");
        assert.equal(payload.new_password, payload.confirm_password);
        passwordWrites += 1;
        return Response.json({});
    });
    await render();
    await navigate("#/account/profile");
    let form = container.querySelector(".atelier-settings form");
    form.elements.namedItem("email").value = "new@example.com";
    await act(() => form.requestSubmit());
    assert.match(form.textContent, /השינויים נשמרו/);
    await navigate("#/account/security");
    form = container.querySelector(".atelier-settings form");
    form.elements.namedItem("old_password").value = "Current!";
    form.elements.namedItem("new_password").value = "Replacement!42";
    form.elements.namedItem("confirm_password").value = "different";
    await act(async () => form.requestSubmit());
    assert.match(form.querySelector("[role=alert]").textContent, /אינן תואמות/);
    assert.equal(passwordWrites, 0);
    form.elements.namedItem("confirm_password").value = "Replacement!42";
    await act(() => form.requestSubmit());
    assert.equal(passwordWrites, 1);
    assert.equal(form.elements.namedItem("new_password").value, "");
});

test("opens the journey from the homepage and persists completion and a custom task", async (t) => {
    const base = "/api/weddings/1/journey/";
    const stages = Array.from({ length: 6 }, (_, index) => ({
        id: index + 1, title: `שלב ${index + 1}`, tasks: [],
    }));
    stages[0].tasks.push({ key: "budget-initial", stage: 1, title: "קביעת תקציב ראשוני", custom: false,
        status: "open", priority: "normal", description: "", due_date: null, module: "budget", has_evidence: true });
    const writes = [];
    function progress(tasks) {
        const completed = tasks.filter(({ status }) => status === "done").length;
        return { completed, total: tasks.length, skipped: 0, percentage: tasks.length ? 100 * completed / tasks.length : null };
    }
    function response(summary) {
        const tasks = stages.flatMap((stage) => stage.tasks);
        return Response.json({ wedding_date: null, recommended_stage: null, recommended_stage_title: null,
            next_actions: tasks.filter(({ status }) => status === "open"), progress: progress(tasks),
            ...(!summary ? { stages: stages.map((stage) => ({ ...stage, progress: progress(stage.tasks) })) } : {}) });
    }
    t.mock.method(globalThis, "fetch", async (url, options = {}) => {
        if (url === "/api/weddings/?include=memberships") return Response.json([wedding(1, [])]);
        if (url === "/api/auth/csrf/") {
            document.cookie = "csrftoken=journey-fixture";
            return Response.json({});
        }
        if (url.includes("/meetings/upcoming/")) return Response.json([]);
        if (url === base + "?summary=1") return response(true);
        if (options.method === "GET") return response(false);
        assert.equal(options.headers["X-CSRFToken"], "journey-fixture");
        const input = JSON.parse(options.body);
        writes.push(input);
        if (options.method === "PATCH") Object.assign(stages[0].tasks[0], input);
        else stages[1].tasks.push({ ...input, key: "custom-1", status: "open", custom: true, module: "" });
        return response(false);
    });
    await render();
    const shortcut = container.querySelector('.journey-dashboard a[href="#/weddings/1/journey"]');
    assert.ok(shortcut);
    await navigate(shortcut.hash);
    assert.equal(container.querySelector(".atelier-sidebar [aria-current=page]").hash, shortcut.hash);
    const panels = container.querySelectorAll(".journey-stage");
    assert.equal(panels.length, 6);
    assert.equal(panels[0].open, true);
    assert.equal(panels[1].open, false);
    await act(() => panels[1].querySelector("summary").click());
    assert.equal(panels[1].open, true);
    await act(() => panels[0].querySelector('input[type="checkbox"]').click());
    assert.deepEqual(writes[0], { status: "done" });
    assert.equal(container.querySelector(".journey-progress progress").value, 100);
    await act(() => panels[1].querySelector(".journey-stage-body > button").click());
    const form = panels[1].querySelector("form");
    form.elements.title.value = "משימה חדשה";
    assert.equal(form.elements.stage.value, "2");
    await act(() => form.requestSubmit());
    assert.equal(writes[1].title, "משימה חדשה");
    assert.match(panels[1].textContent, /משימה חדשה/);
    assert.equal(container.querySelector(".journey-progress progress").value, 50);
    await navigate("#workspace");
    assert.equal(container.querySelector(".journey-dashboard progress").value, 50);
});

test("a journey loading failure has a retry and does not invent progress", async (t) => {
    t.mock.method(globalThis, "fetch", async (url) => url === "/api/weddings/?include=memberships"
        ? Response.json([wedding(1, [])]) : Response.json({}, { status: 503 }));
    await navigate("#/weddings/1/journey");
    await render();
    assert.match(container.querySelector(".journey-page [role=alert]").textContent, /טעינה מחדש/);
    assert.equal(container.querySelector(".journey-page progress"), null);
});

test("stages the sidebar and homepage, activates a tool and restores visibility after a reload", async (t) => {
    const weddingUrl = "/api/weddings/1/";
    const writes = [];
    let activated = false;
    const flags = (visible = false) => ({ visible, activated: visible, has_data: false, recommended: false });
    const summary = () => ({ wedding_date: null, recommended_stage: null, recommended_stage_title: null,
        progress: { completed: 0, total: 40, percentage: 0, skipped: 0 }, next_actions: [],
        features: { vendors: flags(activated), payments: flags(), rsvp: flags() } });
    t.mock.method(globalThis, "fetch", async (url, options = {}) => {
        if (url === "/api/weddings/?include=memberships") return Response.json([wedding(1, [])]);
        if (url === "/api/auth/csrf/") {
            document.cookie = "csrftoken=planning-fixture";
            return Response.json({});
        }
        if (url === weddingUrl + "journey/?summary=1") return Response.json(summary());
        if (url === weddingUrl + "journey/features/vendors/") {
            assert.equal(options.method, "POST");
            assert.equal(options.headers["X-CSRFToken"], "planning-fixture");
            writes.push(url);
            activated = true;
            return Response.json(summary());
        }
        return Response.json(url.includes("upcoming") || url.endsWith("/vendors/") ? [] : {}, { status: 200 });
    });
    await render();
    const primary = ".atelier-sidebar";
    assert.equal(container.querySelectorAll(primary + " .atelier-nav-group").length, 3);
    assert.equal(container.querySelector(primary + ' a[href$="/vendors"]'), null);
    assert.ok(container.querySelector(".workspace-tools a[href$='/venues/compare']"));
    await navigate("#/weddings/1/vendors");
    assert.equal(container.querySelector(primary + " [aria-current]").hash, "#/weddings/1/vendors");
    await navigate("#/weddings/1/tools");
    const action = [...container.querySelectorAll(".planning-directory button")].find((node) => node.textContent.includes("ספקים והוצאות"));
    assert.ok(action);
    await act(async () => action.click());
    assert.equal(writes.length, 1);
    assert.equal(window.location.hash, "#/weddings/1/vendors");
    await navigate("#workspace");
    assert.ok(container.querySelector(primary + ' a[href$="/vendors"]'));
    assert.ok(container.querySelector(".workspace-tools a[href$='/vendors']"));
    await act(() => root.unmount());
    root = createRoot(container);
    await render();
    assert.ok(container.querySelector(primary + ' a[href$="/vendors"]'));
    assert.equal(writes.length, 1);
});
