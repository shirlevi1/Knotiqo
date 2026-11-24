
import { useEffect, useState } from "react";
import CreateWedding from "./CreateWedding";
import BudgetPage from "./BudgetPage";
import VendorsPage from "./VendorsPage";
import WorkspaceSidebar from "./components/WorkspaceSidebar";
import { ProfileSettings, SecuritySettings, WeddingSettings } from "./components/WorkspaceSettings";
import WeddingCoverEditor from "./components/WeddingCoverEditor";
import VenuesPage from "./VenuesPage";
import GuestsPage from "./GuestsPage";
import { getWeddings, WeddingApiError, type CoupleNames, type WeddingDetails } from "./api/weddings";
import "./WeddingWorkspace.css";
import "./WorkspaceShell.css";

type State =
    | { status: "loading" }
    | { status: "error"; message: string }
    | { status: "ready"; weddings: WeddingDetails[] };

const weddingDate = new Intl.DateTimeFormat("he-IL", { dateStyle: "long", timeZone: "UTC" });
const defaultHeroImageUrl = `${import.meta.env.BASE_URL}images/default-wedding-hero.jpg`;

function WeddingDate({ date }: { date: string | null }) {
    return date ? <time dateTime={date}>{weddingDate.format(new Date(`${date}T00:00:00Z`))}</time> : "התאריך טרם נקבע";
}

function AtelierIllustration({ kind }: { kind: "planning" | "comparison" | "budget" | "guests" }) {
    return (
        <svg className="atelier-illustration" viewBox="0 0 40 40" fill="none" stroke="currentColor"
            strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            {kind === "planning" && <path d="M6 35h28M9 35V17a11 11 0 0 1 22 0v18M14 35V17a6 6 0 0 1 12 0v18M9 23h5m12 0h5" />}
            {kind === "comparison" && <path d="M20 6v27m-7 1h14M8 11h24M9 11 4 24h10L9 11Zm22 0-5 13h10l-5-13ZM4 24a5 5 0 0 0 10 0m12 0a5 5 0 0 0 10 0" />}
            {kind === "budget" && <path d="M10 5h20a3 3 0 0 1 3 3v24a3 3 0 0 1-3 3H10a3 3 0 0 1-3-3V8a3 3 0 0 1 3-3Zm2 6h16v6H12zm1 12h2m4 0h2m4 0h2m-14 6h2m4 0h2m4 0h2" />}
            {kind === "guests" && <>
                <circle cx="15" cy="12" r="5" /><circle cx="28" cy="14" r="4" />
                <path d="M5 32v-3a8 8 0 0 1 8-8h4a8 8 0 0 1 8 8v3H5zm24 0h6v-3a7 7 0 0 0-7-7h-2" />
            </>}
        </svg>
    );
}

function WorkspaceHero({ wedding, onSaveCover }: {
    wedding: WeddingDetails; onSaveCover: (url: string | null) => void;
}) {
    const [failedUrl, setFailedUrl] = useState<string | null>(null);
    const coverImageUrl = wedding.cover_image_url;
    const heroImageUrl = coverImageUrl && coverImageUrl !== failedUrl ? coverImageUrl : defaultHeroImageUrl;
    const creator = wedding?.creator_display_name.trim();
    const partner = wedding?.partner_display_name.trim();
    const hebrew = /\p{Script=Hebrew}/u;
    const latin = /\p{Script=Latin}/u;
    const bothHebrew = creator && partner && [creator, partner].every((name) => hebrew.test(name) && !latin.test(name));
    const bothLatin = creator && partner && [creator, partner].every((name) => latin.test(name) && !hebrew.test(name));
    const joiner = bothHebrew ? " ו" : bothLatin ? " and " : " & ";

    return (
        <section className="workspace-hero" aria-labelledby="workspace-welcome">
            <div className="workspace-hero-copy">
                <p className="workspace-edition" lang="en">Wedding Atelier</p>
                <h1 id="workspace-welcome" className="workspace-names" dir={bothLatin ? "ltr" : "rtl"}>
                    <bdi>{creator || partner || wedding.name}</bdi>{creator && partner && <>{joiner}<bdi>{partner}</bdi></>}
                </h1>
                <p className="workspace-date">
                    <WeddingDate date={wedding.wedding_date} />
                </p>
                <p className="workspace-hero-line">הסיפור שלכם מתחיל כאן</p>
                <p className="workspace-hero-caption">כל מה שצריך כדי לתכנן את החתונה שלכם, במקום אחד.</p>
                <a className="ui-button" href="#workspace-planning">המשך לתכנון החתונה <span aria-hidden="true">←</span></a>
            </div>
            <div className="workspace-hero-art">
                {heroImageUrl !== failedUrl && <img className="workspace-hero-image" key={heroImageUrl}
                    src={heroImageUrl} alt="" fetchPriority="high" onError={() => setFailedUrl(heroImageUrl)} />}
                <WeddingCoverEditor weddingId={wedding.id} hasCover={!!coverImageUrl} onSaved={onSaveCover} />
            </div>
        </section>
    );
}

function WeddingHomepage({ wedding, onSaveCover }: {
    wedding: WeddingDetails; onSaveCover: (url: string | null) => void;
}) {
    const hasNames = wedding.creator_display_name.trim() || wedding.partner_display_name.trim();
    const base = `#/weddings/${wedding.id}/venues`;

    return (
        <div className="wedding-workspace" dir="rtl">
            <WorkspaceHero key={wedding.id} wedding={wedding} onSaveCover={onSaveCover} />
            <section id="workspace-planning" className="workspace-planning" aria-labelledby="workspace-planning-title">
                <header className="workspace-section-heading">
                    <h2 id="workspace-planning-title">מסלול התכנון שלכם</h2>
                    <a className="workspace-inline-link" href="#workspace-settings">פרטי החתונה והזוג <span aria-hidden="true">↓</span></a>
                </header>
                <ul className="workspace-tools">
                    <li>
                        <AtelierIllustration kind="planning" />
                        <h3>תכנון החתונה</h3>
                        <p>רכזו את המקומות שאהבתם, התמונות והצעות המחיר.</p>
                        <a className="workspace-tool-link" href={base}>ניהול אולמות <span aria-hidden="true">←</span></a>
                    </li>
                    <li>
                        <AtelierIllustration kind="comparison" />
                        <h3>השוואת אולמות</h3>
                        <p>השוו עלויות לפי מספר האורחים וההצעות ששמרתם.</p>
                        <a className="workspace-tool-link" href={`${base}/compare`}>השוואת הצעות <span aria-hidden="true">←</span></a>
                    </li>
                    <li>
                        <AtelierIllustration kind="budget" />
                        <h3>עוזר התקציב</h3>
                        <p>בדקו את העלויות וקבלו המלצה מעוזר התקציב החכם.</p>
                        <a className="workspace-tool-link" href={`#/weddings/${wedding.id}/budget`}>
                            ניהול התקציב <span aria-hidden="true">←</span>
                        </a>
                    </li>
                    <li>
                        <AtelierIllustration kind="guests" />
                        <h3>רשימת המוזמנים</h3>
                        <p>נהלו מוזמנים ומשפחות, עקבו אחר הכמויות וייבאו רשימות מ-Excel.</p>
                        <a className="workspace-tool-link" href={`#/weddings/${wedding.id}/guests`}>
                            ניהול מוזמנים <span aria-hidden="true">←</span>
                        </a>
                    </li>
                </ul>
            </section>
            <section id="workspace-settings" className="workspace-settings" aria-labelledby="workspace-settings-title">
                <header className="workspace-section-heading">
                    <h2 id="workspace-settings-title">פרטי החתונה והזוג</h2>
                </header>
                <div className="workspace-settings-grid">
                    <div><h3>שם החתונה</h3><bdi>{wedding.name}</bdi></div>
                    <div className="workspace-date-summary">
                        <h3>תאריך החתונה</h3>
                        <WeddingDate date={wedding.wedding_date} />
                    </div>
                    <div>
                        <h3>שמות הזוג</h3>
                        {hasNames ? <span>
                            {[wedding.creator_display_name, wedding.partner_display_name].filter((name) => name.trim())
                                .map((name, index) => <span key={index}>{index > 0 && " · "}<bdi>{name}</bdi></span>)}
                        </span> : <span>טרם הוזנו</span>}
                    </div>
                    <div className="wedding-members">
                        <h3>שותפים למרחב</h3>
                        <ul>
                            {wedding.memberships.map(({ display_name, first_name }, index) => (
                                <li key={index}><bdi>{display_name?.trim() || first_name?.trim() || "חבר/ה במרחב"}</bdi></li>
                            ))}
                        </ul>
                    </div>
                </div>
            </section>
        </div>
    );
}

const weddingRoute = /^#\/weddings\/(\d+)\/(venues(?:\/compare)?|guests|vendors|settings|budget(?:\/(new-expense|expenses\/\d+))?)$/;

export default function WeddingWorkspace({ preferredWeddingId }: { preferredWeddingId?: number }) {
    const [state, setState] = useState<State>({ status: "loading" });
    const [attempt, setAttempt] = useState(0);
    const [hash, setHash] = useState(window.location.hash);
    const [selection, setSelection] = useState<{ id: number; preferred?: number } | null>(null);

    useEffect(() => {
        const navigate = () => {
            const next = window.location.hash;
            const route = weddingRoute.exec(next);
            if (route) setSelection({ id: Number(route[1]), preferred: preferredWeddingId });
            setHash(next);
        };
        navigate();
        window.addEventListener("hashchange", navigate);
        return () => window.removeEventListener("hashchange", navigate);
    }, [preferredWeddingId]);

    useEffect(() => {
        const refresh = () => setAttempt((value) => value + 1);
        window.addEventListener("focus", refresh);
        return () => window.removeEventListener("focus", refresh);
    }, []);

    useEffect(() => {
        const controller = new AbortController();

        async function load() {
            try {
                const weddings = await getWeddings(controller.signal);
                const preferredIndex = weddings.findIndex(({ id }) => id === preferredWeddingId);
                if (preferredIndex > 0) {
                    weddings.unshift(...weddings.splice(preferredIndex, 1));
                }

                if (!controller.signal.aborted) {
                    setState({ status: "ready", weddings });
                }
            } catch (err) {
                if (!controller.signal.aborted) {
                    setState({
                        status: "error",
                        message: err instanceof WeddingApiError
                            ? err.message
                            : "לא ניתן לטעון את החתונות. בדקו את החיבור ונסו שוב.",
                    });
                }
            }
        }

        void load();

        return () => controller.abort();
    }, [attempt, preferredWeddingId]);

    const weddings = state.status === "ready" ? state.weddings : [];
    const selectedId = selection?.preferred === preferredWeddingId ? selection?.id : undefined;
    const activeWedding = weddings.find(({ id }) => id === (selectedId ?? preferredWeddingId)) ?? weddings[0];
    const workspaceRoute = weddingRoute.exec(hash);
    const routeWedding = workspaceRoute ? weddings.find(({ id }) => id === Number(workspaceRoute[1])) : undefined;

    function applyDetails(weddingId: number, updates: Partial<Pick<WeddingDetails, keyof CoupleNames | "wedding_date" | "cover_image_url">>) {
        setState((current) => current.status === "ready" ? {
            ...current,
            weddings: current.weddings.map((wedding) => wedding.id === weddingId ? { ...wedding, ...updates } : wedding),
        } : current);
        setAttempt((value) => value + 1);
    }

    function selectWedding(id: number) {
        setSelection({ id, preferred: preferredWeddingId });
        if (workspaceRoute) window.location.hash = `#/weddings/${id}/${workspaceRoute[3] ? "budget" : workspaceRoute[2]}`;
    }

    function renderPage() {
        if (hash === "#/account/profile") return <ProfileSettings />;
        if (hash === "#/account/security") return <SecuritySettings />;

        if (workspaceRoute && state.status === "ready") {
            if (!routeWedding) return <div className="ui-panel ui-state">
                <p className="ui-error" role="alert">החתונה אינה זמינה לחשבון הזה.</p>
                <a className="ui-button ui-button--secondary" href="#workspace">חזרה למרחב החתונה</a>
            </div>;
            switch (workspaceRoute[3] ? "budget" : workspaceRoute[2]) {
                case "settings":
                    return <WeddingSettings key={routeWedding.id} wedding={routeWedding}
                        onSaveNames={(names) => applyDetails(routeWedding.id, names)}
                        onSaveDate={(date) => applyDetails(routeWedding.id, { wedding_date: date })} />;
                case "budget":
                    return <BudgetPage key={hash} weddingId={routeWedding.id}
                        newExpense={workspaceRoute[3] === "new-expense"}
                        expenseId={workspaceRoute[3]?.startsWith("expenses/") ? Number(workspaceRoute[3].slice(9)) : undefined} />;
                case "vendors":
                    return <VendorsPage key={routeWedding.id} weddingId={routeWedding.id} />;
                case "guests":
                    return <GuestsPage key={routeWedding.id} weddingId={routeWedding.id} weddingName={routeWedding.name} />;
                default:
                    return <VenuesPage key={hash} weddingId={routeWedding.id} weddingName={routeWedding.name}
                        initialComparison={workspaceRoute[2] === "venues/compare"} />;
            }
        }

        if (!activeWedding) {
            if (state.status === "loading") {
                return <p className="ui-panel ui-state ui-status ui-status--loading" role="status">טוענים את המרחב המשותף שלכם...</p>;
            }

            if (state.status === "error") {
                return (
                    <div className="ui-panel ui-state">
                        <p className="ui-error" role="alert">
                            {state.message}
                        </p>
                        <button
                            className="ui-button"
                            type="button"
                            onClick={() => {
                                setState({ status: "loading" });
                                setAttempt((value) => value + 1);
                            }}
                        >
                            טעינה מחדש
                        </button>
                    </div>
                );
            }

            return <CreateWedding onCreated={() => {
                setState({ status: "loading" });
                setAttempt((value) => value + 1);
            }} />;
        }

        return <WeddingHomepage wedding={activeWedding}
            onSaveCover={(url) => applyDetails(activeWedding.id, { cover_image_url: url })} />;
    }

    return <div className="workspace-shell" dir="rtl">
        <WorkspaceSidebar hash={hash} weddings={weddings} weddingId={(routeWedding ?? activeWedding)?.id}
            onSelect={selectWedding} />
        <div className="workspace-content">{renderPage()}</div>
    </div>;
}
