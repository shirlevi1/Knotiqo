
import { useEffect, useState } from "react";
import CreateWedding from "./CreateWedding";
import BudgetAssistant from "./components/BudgetAssistant";
import PartnerInvitation from "./components/PartnerInvitation";
import { getWeddings, WeddingApiError, type WeddingDetails } from "./api/weddings";
import "./WeddingWorkspace.css";

type State =
    | { status: "loading" }
    | { status: "error"; message: string }
    | { status: "ready"; weddings: WeddingDetails[] };

export default function WeddingWorkspace({ preferredWeddingId }: { preferredWeddingId?: number }) {
    const [state, setState] = useState<State>({ status: "loading" });
    const [attempt, setAttempt] = useState(0);

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

    if (state.status === "loading") {
        return <p role="status">טוענים את המרחב המשותף שלכם...</p>;
    }

    if (state.status === "error") {
        return (
            <div className="wedding-workspace">
                <p className="wedding-error" role="alert">
                    {state.message}
                </p>
                <button
                    className="wedding-button"
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
            <h2 id="my-weddings-title">
                {state.weddings.length === 1
                    ? "החתונה שלכם"
                    : "החתונות שלכם"}
            </h2>

            {state.weddings.length > 1 && (
                <p>
                    אתם שותפים בכמה חתונות. כל המרחבים שלכם מופיעים כאן.
                </p>
            )}

            <button className="wedding-refresh" type="button"
                onClick={() => setAttempt((value) => value + 1)}>
                רענון פרטי החתונה
            </button>

            <ul className="wedding-list">
                {state.weddings.map((wedding) => (
                    <li className="wedding-summary" key={wedding.id}>
                        <h3>{wedding.name}</h3>
                        <p>מספר חתונה {wedding.id}</p>

                        <p>
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
                                "את התאריך נבחר בהמשך"
                            )}
                        </p>

                        <div className="wedding-members">
                            <h4>חברים במרחב החתונה</h4>
                            <ul>
                                {wedding.memberships.map(({ display_name }, index) => (
                                    <li key={index}>{display_name ?? "חבר/ה במרחב"}</li>
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
                    </li>
                ))}
            </ul>
        </section>
    );
}
