import { useEffect, useRef, useState } from "react";
import { budgetApi, commitmentsApi, type BudgetCategory, type Commitments } from "./api/budget";
import { formatVenueMoney } from "./api/venues";
import { quoteStatuses, serviceCategories, vendorStatuses, vendorsForWedding, type Quote, type Vendor } from "./api/vendors";
import { QuoteForm, VendorForm } from "./components/VendorForms";
import "./VendorsPage.css";

const overview = [
    ["committed_cost", "סה״כ התחייבויות"], ["paid_amount", "כבר שולם"], ["remaining_amount", "נותר לתשלום"],
    ["overdue_amount", "תשלומים באיחור"], ["upcoming_amount", "תשלומים קרובים"],
] as const;

type Panel = { type: "vendor"; vendor?: Vendor } | { type: "quote"; vendor: Vendor; quote?: Quote }
    | { type: "link"; vendor: Vendor; quote?: Quote };

function Money({ value }: { value: string }) {
    return <bdi>{formatVenueMoney(value)}</bdi>;
}

function Progress({ amounts }: { amounts: NonNullable<Commitments["vendor_totals"]>[string] }) {
    const committed = BigInt(amounts.committed_cost.replace(".", ""));
    if (committed === 0n) return <>—</>;
    const percent = Number(BigInt(amounts.paid_amount.replace(".", "")) * 100n / committed);
    return <span className="vendors-progress"><progress max={100} value={percent} aria-label="אחוז ששולם" /> <bdi>{percent}%</bdi></span>;
}

export default function VendorsPage({ weddingId }: { weddingId: number }) {
    const [vendors, setVendors] = useState<Vendor[] | null>(null);
    const [finance, setFinance] = useState<Commitments | null>(null);
    const [categories, setCategories] = useState<BudgetCategory[]>([]);
    const [search, setSearch] = useState("");
    const [category, setCategory] = useState("");
    const [status, setStatus] = useState("");
    const [detail, setDetail] = useState<number | null>(null);
    const [panel, setPanel] = useState<Panel | null>(null);
    const [error, setError] = useState("");
    const [financeError, setFinanceError] = useState(false);
    const [notice, setNotice] = useState("");
    const [busy, setBusy] = useState(false);
    const [attempt, setAttempt] = useState(0);
    const pending = useRef<AbortController | null>(null);
    const panelRegion = useRef<HTMLDivElement>(null);
    const detailRegion = useRef<HTMLElement>(null);
    const api = vendorsForWedding(weddingId);
    const budgetRoute = `#/weddings/${weddingId}/budget`;

    useEffect(() => {
        const controller = new AbortController();
        void vendorsForWedding(weddingId).list(controller.signal).then((data) => {
            if (!controller.signal.aborted) setVendors(data);
        }).catch(() => {
            if (!controller.signal.aborted) setError("לא הצלחנו לטעון את הספקים.");
        });
        void Promise.all([budgetApi(weddingId).load(controller.signal), commitmentsApi(weddingId).load(controller.signal)])
            .then(([budget, commitments]) => {
                if (!controller.signal.aborted) {
                    setFinance(commitments);
                    setCategories(budget.categories);
                }
            }).catch(() => {
                if (!controller.signal.aborted) setFinanceError(true);
            });
        return () => controller.abort();
    }, [weddingId, attempt]);
    useEffect(() => () => pending.current?.abort(), []);
    useEffect(() => {
        if (panel) {
            panelRegion.current?.focus();
            panelRegion.current?.scrollIntoView?.({ block: "nearest" });
        }
    }, [panel]);

    useEffect(() => {
        if (detail !== null) {
            detailRegion.current?.focus();
            detailRegion.current?.scrollIntoView?.({ block: "nearest" });
        }
    }, [detail]);

    async function save<T>(change: (signal: AbortSignal) => Promise<T>, update: (data: T) => void) {
        if (pending.current) return;
        const controller = new AbortController();
        pending.current = controller;
        setBusy(true);
        setError("");
        setNotice("");
        try {
            const data = await change(controller.signal);
            if (!controller.signal.aborted) {
                update(data);
                setPanel(null);
                setNotice("השינויים נשמרו.");
            }
        } catch (cause) {
            if (!controller.signal.aborted) setError(cause instanceof Error && !(cause instanceof TypeError)
                ? cause.message : "לא הצלחנו להתחבר לשרת.");
        } finally {
            if (!controller.signal.aborted) {
                pending.current = null;
                setBusy(false);
            }
        }
    }

    function retry() {
        setError("");
        setFinanceError(false);
        setAttempt((value) => value + 1);
    }

    const searchTerm = search.trim().toLocaleLowerCase();
    const visible = vendors?.filter((vendor) => (!category || vendor.service_category === category)
        && (!status || vendor.status === status) && [vendor.name, vendor.service_category]
            .some((value) => value.toLocaleLowerCase().includes(searchTerm)));
    const options = [...new Set([...serviceCategories, ...(vendors ?? []).map((vendor) => vendor.service_category)])];
    const selected = vendors?.find(({ id }) => id === detail);
    const selectable = finance?.expenses.filter((item) => !item.vendor_id
        && (!item.source_quote_id || selected?.quotes.some(({ id }) => id === item.source_quote_id)));
    const links = finance?.expenses.filter((expense) => expense.vendor_id === detail);
    const formatted = (vendor: Vendor, key: "committed_cost" | "paid_amount" | "remaining_amount") => {
        const totals = finance?.vendor_totals?.[vendor.id];
        return totals ? <Money value={totals[key]} /> : <>—</>;
    };

    return <div className="vendors-page" dir="rtl">
        <header className="vendors-header">
            <div><h1>ספקים והוצאות</h1><p>כל הספקים, השירותים וההוצאות של החתונה במקום אחד</p></div>
            <div className="vendors-actions">
                <button className="ui-button" disabled={busy || !!panel || !vendors} onClick={() => setPanel({ type: "vendor" })}>הוספת ספק</button>
                <a className="ui-button ui-button--secondary" href={budgetRoute + "/new-expense"}>הוספת הוצאה</a>
            </div>
        </header>
        {error && <p className="ui-error" role="alert">{error} {!vendors &&
            <button className="ui-button ui-button--text" onClick={retry}>טעינה מחדש</button>}</p>}
        {notice && <p role="status">{notice}</p>}
        <section className="vendors-panel ui-panel" aria-labelledby="vendor-overview">
            <h2 id="vendor-overview">תמונת ההוצאות</h2>
            <dl className="budget-metrics">{overview.map(([key, label]) => <div key={key}><dt>{label}</dt>
                <dd>{finance ? <Money value={finance.totals[key]} /> : "—"}</dd></div>)}</dl>
            {financeError ? <p role="alert">נתוני התשלומים אינם זמינים. <button className="ui-button ui-button--text"
                onClick={retry} disabled={busy || !!panel}>טעינה מחדש</button></p> : !finance && <p role="status">טוענים נתוני תשלומים…</p>}
        </section>
        {panel && <div className="vendors-editor" tabIndex={-1} ref={panelRegion}>
            {panel.type === "vendor" && <VendorForm vendor={panel.vendor} categories={categories} busy={busy}
                onCancel={() => setPanel(null)} onSave={(input) => void save((signal) => api.save(input, signal, panel.vendor?.id), setVendors)} />}
            {panel.type === "quote" && <QuoteForm quote={panel.quote} busy={busy} onCancel={() => setPanel(null)}
                onSave={(input) => void save((signal) => api.quote(panel.vendor.id, input, signal, panel.quote?.id), setVendors)} />}
            {panel.type === "link" && <form className="vendors-panel ui-panel" onSubmit={(event) => {
                event.preventDefault();
                const form = new FormData(event.currentTarget);
                if (panel.quote && !form.has("confirmed")) return;
                const input = panel.quote
                    ? { quote_id: panel.quote.id, category_id: Number(form.get("category_id")), confirmed: true as const }
                    : { expense_id: Number(form.get("expense_id")) };
                void save((signal) => api.link(panel.vendor.id, input, signal), setFinance);
            }}>
                <h2>{panel.quote ? "יצירת התחייבות מהצעה" : "קישור הוצאה קיימת"}</h2>
                {panel.quote ? <>
                    <p>{panel.quote.title} · <Money value={panel.quote.amount} /></p>
                    <label className="ui-field">קטגוריית תקציב<select className="ui-input" name="category_id" required
                        defaultValue={panel.vendor.budget_category_id ?? ""}>
                        <option value="">בחירה</option>{categories.map(({ id, name }) => <option key={id} value={id}>{name}</option>)}
                    </select></label>
                    <label><input type="checkbox" name="confirmed" required /> אישור יצירת התחייבות לפי סכום ההצעה</label>
                </> : <label className="ui-field">הוצאה לקישור<select className="ui-input" name="expense_id" required defaultValue="">
                    <option value="">בחירה</option>{selectable?.map(({ id, name }) => <option key={id} value={id}>{name}</option>)}
                </select></label>}
                <div className="vendors-actions"><button className="ui-button" disabled={busy}>אישור</button>
                    <button type="button" className="ui-button ui-button--text" disabled={busy} onClick={() => setPanel(null)}>ביטול</button></div>
            </form>}
        </div>}
        <section className="vendors-panel ui-panel" aria-labelledby="vendors-directory">
            <h2 id="vendors-directory">רשימת ספקים</h2>
            <div className="vendors-filters">
                <label className="ui-field">חיפוש ספק או שירות<input type="search" className="ui-input" value={search}
                    onChange={(event) => setSearch(event.target.value)} /></label>
                <label className="ui-field">קטגוריה<select className="ui-input" value={category} onChange={(event) => setCategory(event.target.value)}>
                    <option value="">כל הקטגוריות</option>{options.map((name) => <option key={name}>{name}</option>)}
                </select></label>
                <label className="ui-field">מצב ספק<select className="ui-input" value={status} onChange={(event) => setStatus(event.target.value)}>
                    <option value="">כל המצבים</option>{Object.entries(vendorStatuses).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
                </select></label>
                <button className="ui-button ui-button--text" onClick={() => { setSearch(""); setCategory(""); setStatus(""); }}>ניקוי מסננים</button>
            </div>
            {!vendors && !error && <p role="status">טוענים ספקים…</p>}
            {vendors?.length === 0 ? <p>עוד אין ספקים שמורים. הוסיפו את הספק הראשון כדי להתחיל.</p>
                : visible?.length === 0 ? <p>לא נמצאו ספקים שמתאימים למסננים.</p> : visible && <>
                    <table className="vendors-table">
                        <thead><tr>{["ספק", "קטגוריה", "מצב", "סכום מוסכם", "שולם", "נותר", "התקדמות", "פעולות"]
                            .map((value) => <th scope="col" key={value}>{value}</th>)}</tr></thead>
                        <tbody>{visible.map((vendor) => <tr key={vendor.id}>
                            <th scope="row">{vendor.name}</th><td>{vendor.service_category}</td><td>{vendorStatuses[vendor.status]}</td>
                            <td>{formatted(vendor, "committed_cost")}</td><td>{formatted(vendor, "paid_amount")}</td>
                            <td>{formatted(vendor, "remaining_amount")}</td>
                            <td>{finance?.vendor_totals?.[vendor.id] ? <Progress amounts={finance.vendor_totals[vendor.id]} /> : "—"}</td>
                            <td><button className="ui-button ui-button--text" disabled={busy || !!panel} onClick={() => setDetail(vendor.id)}>פרטים</button></td>
                        </tr>)}</tbody>
                    </table>
                    <ul className="vendors-mobile">{visible.map((vendor) => <li key={vendor.id}>
                        <h3>{vendor.name}</h3><p>{vendor.service_category} · {vendorStatuses[vendor.status]}</p>
                        <dl><div><dt>סכום מוסכם</dt><dd>{formatted(vendor, "committed_cost")}</dd></div>
                            <div><dt>שולם</dt><dd>{formatted(vendor, "paid_amount")}</dd></div>
                            <div><dt>נותר</dt><dd>{formatted(vendor, "remaining_amount")}</dd></div></dl>
                        {finance?.vendor_totals?.[vendor.id] && <Progress amounts={finance.vendor_totals[vendor.id]} />}
                        <button className="ui-button ui-button--text" disabled={busy || !!panel} onClick={() => setDetail(vendor.id)}>פרטים</button>
                    </li>)}</ul>
                </>}
        </section>
        {selected && <section className="vendors-panel ui-panel vendors-detail" aria-labelledby="vendor-detail" tabIndex={-1} ref={detailRegion}>
            <header className="vendors-header"><div><h2 id="vendor-detail">{selected.name}</h2>
                <p>{selected.service_category} · {vendorStatuses[selected.status]}</p></div>
                <div className="vendors-actions">
                    <button className="ui-button ui-button--secondary" disabled={busy || !!panel} onClick={() => setPanel({ type: "vendor", vendor: selected })}>עריכה</button>
                    <button className="ui-button ui-button--text" disabled={busy || !!panel} onClick={() => setDetail(null)}>סגירה</button>
                </div></header>
            <div className="vendors-contact">
                {selected.contact_person && <span>{selected.contact_person}</span>}
                {selected.phone && <bdi>{selected.phone}</bdi>}
                {selected.email && <bdi>{selected.email}</bdi>}
                {selected.website && <a href={selected.website} target="_blank" rel="noopener noreferrer">אתר הספק</a>}
            </div>
            {selected.notes && <p className="vendors-copy">{selected.notes}</p>}
            <header className="vendors-header"><h3>{selected.quotes.length > 1 ? "השוואת הצעות מחיר" : "הצעות מחיר"}</h3><button className="ui-button ui-button--secondary" disabled={busy || !!panel}
                onClick={() => setPanel({ type: "quote", vendor: selected })}>הוספת הצעה</button></header>
            {selected.quotes.length ? <ul className="vendors-quotes">{selected.quotes.map((quote) => <li key={quote.id}>
                <h4>{quote.title}</h4><p><Money value={quote.amount} /> · {quoteStatuses[quote.status]}
                    {quote.received_date && <> · <time dir="ltr" dateTime={quote.received_date}>{quote.received_date}</time></>}</p>
                {quote.included_services && <p className="vendors-copy"><strong>כלול</strong> {quote.included_services}</p>}
                {quote.excluded_services && <p className="vendors-copy"><strong>לא כלול</strong> {quote.excluded_services}</p>}
                {quote.notes && <p className="vendors-copy">{quote.notes}</p>}
                <div className="vendors-actions">
                    <button className="ui-button ui-button--text" disabled={busy || !!panel}
                        onClick={() => setPanel({ type: "quote", vendor: selected, quote })}>עריכה</button>
                    {quote.status !== "selected" && <button className="ui-button ui-button--text" disabled={busy || !!panel}
                        onClick={() => void save((signal) => api.quote(selected.id, { status: "selected" }, signal, quote.id), setVendors)}>בחירת הצעה</button>}
                    {quote.status !== "rejected" && <button className="ui-button ui-button--text" disabled={busy || !!panel}
                        onClick={() => void save((signal) => api.quote(selected.id, { status: "rejected" }, signal, quote.id), setVendors)}>דחייה</button>}
                    <button className="ui-button ui-button--text" disabled={busy || !!panel} onClick={() => {
                        if (window.confirm("למחוק את ההצעה?")) void save((signal) => api.removeQuote(selected.id, quote.id, signal), setVendors);
                    }}>מחיקה</button>
                    {quote.status === "selected" && categories.length > 0 && !finance?.expenses.some((expense) => expense.source_quote_id === quote.id) &&
                        <button className="ui-button ui-button--secondary" disabled={busy || !!panel}
                            onClick={() => setPanel({ type: "link", vendor: selected, quote })}>יצירת התחייבות</button>}
                </div>
            </li>)}</ul> : <p>אין הצעות מחיר לספק הזה.</p>}
            <h3>התחייבויות מקושרות</h3>
            {finance && !links?.length && <p>אין התחייבויות מקושרות לספק הזה.</p>}
            {!!links?.length && <ul className="vendors-linked">{links.map((expense) => <li key={expense.id}>
                <strong>{expense.name}</strong> · <Money value={expense.committed_cost} /> · נותר <Money value={expense.remaining_amount} />
                <div className="vendors-actions">
                    <a className="ui-button ui-button--text" href={budgetRoute + "/expenses/" + expense.id}>ללוח התשלומים</a>
                    <button className="ui-button ui-button--text" disabled={busy || !!panel} onClick={() => {
                        if (window.confirm("לנתק את ההוצאה מהספק? ההוצאה והתשלומים יישארו בתקציב.")) {
                            void save((signal) => api.unlink(selected.id, expense.id, signal), setFinance);
                        }
                    }}>ניתוק מהספק</button>
                </div></li>)}</ul>}
            <div className="vendors-actions">
                {selectable?.length ? <button className="ui-button ui-button--secondary" disabled={busy || !!panel}
                    onClick={() => setPanel({ type: "link", vendor: selected })}>קישור הוצאה קיימת</button> : null}
                {finance && !links?.length && <button className="ui-button ui-button--text" disabled={busy || !!panel} onClick={() => {
                    if (window.confirm("למחוק את הספק ואת ההצעות שלו?")) {
                        void save((signal) => api.remove(selected.id, signal), (rows) => { setVendors(rows); setDetail(null); });
                    }
                }}>מחיקת ספק</button>}
            </div>
        </section>}
    </div>;
}
