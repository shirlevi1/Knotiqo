import { useEffect, useState } from "react";
import CreateWedding from "./CreateWedding";
import { getWeddings, WeddingApiError, type Wedding } from "./api/weddings";
import "./WeddingWorkspace.css";

type State = { status: "loading" } | { status: "error"; message: string }
    | { status: "ready"; weddings: Wedding[] };

export default function WeddingWorkspace() {
    const [state, setState] = useState<State>({ status: "loading" });
    const [attempt, setAttempt] = useState(0);

    useEffect(() => {
        const controller = new AbortController();
        async function load() {
            setState({ status: "loading" });
            try {
                const weddings = await getWeddings(controller.signal);
                if (!controller.signal.aborted) setState({ status: "ready", weddings });
            } catch (err) {
                if (!controller.signal.aborted) setState({ status: "error", message:
                    err instanceof WeddingApiError ? err.message : "לא ניתן לטעון את החתונות. בדקו את החיבור ונסו שוב." });
            }
        }
        void load();
        return () => controller.abort();
    }, [attempt]);

    if (state.status === "loading") return <p role="status">טוענים את המרחב המשותף שלכם...</p>;
    if (state.status === "error") return (
        <div className="wedding-workspace">
            <p className="wedding-error" role="alert">{state.message}</p>
            <button className="wedding-button" type="button" onClick={() => setAttempt((value) => value + 1)}>טעינה מחדש</button>
        </div>
    );
    if (state.weddings.length === 0) return (
        <CreateWedding onCreated={(wedding) => setState({ status: "ready", weddings: [wedding] })} />
    );
    return (
        <section className="wedding-workspace" aria-labelledby="my-weddings-title">
            <h2 id="my-weddings-title">{state.weddings.length === 1 ? "החתונה שלכם" : "החתונות שלכם"}</h2>
            {state.weddings.length > 1 && <p>אתם שותפים בכמה חתונות. כל המרחבים שלכם מופיעים כאן.</p>}
            <ul className="wedding-list">
                {state.weddings.map((wedding) => (
                    <li className="wedding-summary" key={wedding.id}>
                        <h3>{wedding.name}</h3>
                        <p>{wedding.wedding_date
                            ? <time dateTime={wedding.wedding_date}>{new Intl.DateTimeFormat("he-IL", {
                                dateStyle: "long", timeZone: "UTC",
                            }).format(new Date(`${wedding.wedding_date}T00:00:00Z`))}</time>
                            : "את התאריך נבחר בהמשך"}</p>
                    </li>
                ))}
            </ul>
        </section>
    );
}
