
import { useEffect, useState } from "react";
import CreateWedding from "./CreateWedding";
import BudgetAssistant from "./components/BudgetAssistant";
import CoupleNamesEditor from "./components/CoupleNamesEditor";
import PartnerInvitation from "./components/PartnerInvitation";
import VenueSection from "./components/VenueSection";
import VenuesPage from "./VenuesPage";
import { getWeddings, WeddingApiError, type CoupleNames, type WeddingDetails } from "./api/weddings";
import "./WeddingWorkspace.css";

type State =
    | { status: "loading" }
    | { status: "error"; message: string }
    | { status: "ready"; weddings: WeddingDetails[] };

function WorkspaceHero({ wedding }: { wedding?: WeddingDetails }) {
    const creator = wedding?.creator_display_name.trim();
    const partner = wedding?.partner_display_name.trim();
    const hebrew = /\p{Script=Hebrew}/u;
    const latin = /\p{Script=Latin}/u;
    const bothHebrew = creator && partner && [creator, partner].every((name) => hebrew.test(name) && !latin.test(name));
    const bothLatin = creator && partner && [creator, partner].every((name) => latin.test(name) && !hebrew.test(name));
    const joiner = bothHebrew ? " ו" : bothLatin ? " and " : " & ";

    return (
        <section className="workspace-hero ui-card" dir="rtl" aria-labelledby="workspace-welcome">
            <p className="eyebrow"><bdi lang="en">KNOTIQO</bdi> · המרחב שלנו</p>
            <h1 id="workspace-welcome">הסיפור שלכם מתחיל כאן.</h1>
            {(creator || partner) && (
                <h2 className="workspace-names" dir={bothLatin ? "ltr" : "rtl"}>
                    <bdi>{creator || partner}</bdi>{creator && partner && <>{joiner}<bdi>{partner}</bdi></>}
                </h2>
            )}
            <p className="workspace-subtitle">כל הפרטים הקטנים בדרך ליום הגדול שלכם.</p>
        </section>
    );
}

export default function WeddingWorkspace({ preferredWeddingId }: { preferredWeddingId?: number }) {
    const [state, setState] = useState<State>({ status: "loading" });
    const [attempt, setAttempt] = useState(0);
    const [hash, setHash] = useState(window.location.hash);

    useEffect(() => {
        const navigate = () => setHash(window.location.hash);
        window.addEventListener("hashchange", navigate);
        return () => window.removeEventListener("hashchange", navigate);
    }, []);

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
    const activeWedding = weddings.find(({ id }) => id === preferredWeddingId) ?? weddings[0];
    const venueRoute = /^#\/weddings\/(\d+)\/venues$/.exec(hash);
    const venueWedding = venueRoute ? weddings.find(({ id }) => id === Number(venueRoute[1])) : undefined;

    function applyNames(weddingId: number, names: CoupleNames) {
        setState((current) => current.status === "ready" ? {
            ...current,
            weddings: current.weddings.map((wedding) => wedding.id === weddingId ? { ...wedding, ...names } : wedding),
        } : current);
        setAttempt((value) => value + 1);
    }

    if (venueRoute && state.status === "ready") {
        return venueWedding
            ? <VenuesPage weddingId={venueWedding.id} weddingName={venueWedding.name} />
            : <div className="ui-panel ui-state" dir="rtl">
                <p className="ui-error" role="alert">החתונה אינה זמינה לחשבון הזה.</p>
                <a className="ui-button ui-button--secondary" href="#workspace">חזרה למרחב החתונה</a>
            </div>;
    }

    return (
        <>
            <WorkspaceHero wedding={activeWedding} />
            {renderWorkspace()}
        </>
    );

    function renderWorkspace() {
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

        if (state.weddings.length === 0) {
            return (
                <CreateWedding
                    onCreated={() => {
                        setState({ status: "loading" });
                        setAttempt((value) => value + 1);
                    }}
                />
            );
        }

        return (
            <section
                className="wedding-workspace"
                dir="rtl"
                aria-labelledby="my-weddings-title"
            >
                <header className="wedding-workspace-header">
                    <h2 id="my-weddings-title">
                        {state.weddings.length === 1 ? "החתונה שלכם" : "החתונות שלכם"}
                    </h2>
                    <button className="ui-button ui-button--secondary" type="button"
                        onClick={() => setAttempt((value) => value + 1)}>
                        רענון פרטי החתונה
                    </button>
                </header>

                <ul className="wedding-list">
                    {state.weddings.map((wedding) => (
                        <li className="wedding-summary ui-card" key={wedding.id}>
                            <header className="wedding-summary-header">
                                <h3><bdi>{wedding.name}</bdi></h3>
                                <p className="wedding-meta">
                                    {wedding.wedding_date ? (
                                        <time dateTime={wedding.wedding_date}>
                                            {new Intl.DateTimeFormat("he-IL", {
                                                dateStyle: "long",
                                                timeZone: "UTC",
                                            }).format(
                                                new Date(`${wedding.wedding_date}T00:00:00Z`)
                                            )}
                                        </time>
                                    ) : (
                                        <span>התאריך טרם נקבע</span>
                                    )}
                                </p>
                            </header>

                            <CoupleNamesEditor weddingId={wedding.id} names={wedding}
                                onSaved={(names) => applyNames(wedding.id, names)} />

                            <div className="wedding-tools">
                                <div className="wedding-members ui-panel">
                                    <h4>חברים במרחב החתונה</h4>
                                    <ul>
                                        {wedding.memberships.map(({ display_name, first_name }, index) => (
                                            <li key={index}><bdi>{first_name?.trim() ? display_name ?? first_name : "חבר/ה במרחב"}</bdi></li>
                                        ))}
                                    </ul>
                                    {wedding.memberships.length >= 2 ? (
                                        <p>שני בני הזוג מחוברים למרחב המשותף.</p>
                                    ) : (
                                        <>
                                            <p>ממתינים להצטרפות של בן או בת הזוג.</p>
                                            <PartnerInvitation weddingId={wedding.id} />
                                        </>
                                    )}
                                </div>
                                <BudgetAssistant weddingId={wedding.id} />
                            </div>
                            <VenueSection weddingId={wedding.id} />
                        </li>
                    ))}
                </ul>
            </section>
        );
    }
}
