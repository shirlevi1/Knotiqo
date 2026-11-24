import { useEffect, useRef, useState } from "react";
import type { WeddingDetails } from "../api/weddings";

type Props = {
    hash: string;
    weddings: WeddingDetails[];
    weddingId?: number;
    onSelect: (id: number) => void;
};

const items = [
    ["#workspace", "מרחב החתונה", "M3 11l9-8 9 8v9H3z M9 20v-6h6v6"],
    ["venues", "אולמות", "M4 21V11a8 8 0 0 1 16 0v10 M8 21V11a4 4 0 0 1 8 0v10 M2 21h20"],
    ["guests", "מוזמנים", "M14 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0 M2 21v-2a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v2z M19 4a4 4 0 0 1 0 7m1 3a5 5 0 0 1 2 4v3"],
    ["budget", "תקציב החתונה", "M5 3h14v18H5z M8 6h8v4H8z M8 14h1m3 0h1m3 0h1m-9 3h1m3 0h1m3 0h1"],
    ["settings", "הגדרות החתונה", "M3 6h18v15H3z M7 3v6m10-6v6M3 11h18m-14 5h4"],
    ["#/account/profile", "הפרופיל שלי", "M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0 M4 21v-2a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v2z"],
    ["#/account/security", "אבטחת החשבון", "M12 22c6-3 9-7 9-15l-9-4-9 4c0 8 3 12 9 15z M8 12l3 3 5-6"],
] as const;

function Links({ hash, weddings, weddingId, onSelect, onNavigate }: Props & { onNavigate?: () => void }) {
    return <nav aria-label="ניווט ראשי">
        {weddings.length > 1 && <label className="ui-field atelier-wedding-picker">בחירת חתונה
            <select className="ui-input" value={weddingId} onChange={(event) => onSelect(Number(event.target.value))}>
                {weddings.map(({ id, name }) => <option key={id} value={id}>{name}</option>)}
            </select>
        </label>}
        <ul>{items.map(([route, label, path]) => {
            if (!route.startsWith("#") && !weddingId) return null;
            const href = route.startsWith("#") ? route : `#/weddings/${weddingId}/${route}`;
            const active = hash === href || (route === "venues" && hash === href + "/compare")
                || (route === "#workspace" && !hash.startsWith("#/"));
            return <li key={route} className={route.startsWith("#/account/") ? "atelier-account-link" : undefined}><a href={href} aria-current={active ? "page" : undefined} onClick={onNavigate} title={label}>
                <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                    strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"><path d={path} /></svg>
                <span>{label}</span>
            </a></li>;
        })}</ul>
    </nav>;
}

export default function WorkspaceSidebar(props: Props) {
    const [collapsed, setCollapsed] = useState(false);
    const [open, setOpen] = useState(false);
    const drawer = useRef<HTMLDialogElement>(null);
    const opener = useRef<HTMLButtonElement>(null);

    useEffect(() => {
        const desktop = window.matchMedia?.("(min-width: 961px)");
        const closeOnDesktop = () => { if (desktop?.matches && drawer.current?.open) drawer.current.close(); };
        desktop?.addEventListener("change", closeOnDesktop);
        return () => desktop?.removeEventListener("change", closeOnDesktop);
    }, []);

    return <>
        <aside className="atelier-sidebar" data-collapsed={collapsed}>
            <button className="ui-button ui-button--text atelier-collapse" type="button" aria-expanded={!collapsed}
                aria-controls="atelier-desktop-nav" onClick={() => setCollapsed(!collapsed)}
                aria-label={collapsed ? "הרחבת תפריט" : "צמצום תפריט"}>
                <span aria-hidden="true">{collapsed ? "←" : "→"}</span>
            </button>
            <div id="atelier-desktop-nav"><Links {...props} /></div>
        </aside>
        <button className="ui-button ui-button--secondary atelier-mobile-menu" type="button" ref={opener}
            aria-expanded={open} aria-controls="atelier-mobile-nav" onClick={() => { drawer.current?.showModal(); setOpen(true); }}>
            <svg aria-hidden="true" viewBox="0 0 24 24" width="18" fill="none" stroke="currentColor"><path d="M3 6h18M3 12h18M3 18h18" /></svg>
            תפריט
        </button>
        <dialog className="atelier-drawer" id="atelier-mobile-nav" ref={drawer} aria-labelledby="atelier-mobile-title"
            onClose={() => { setOpen(false); opener.current?.focus(); }}>
            <header><h2 id="atelier-mobile-title">מרחב החתונה</h2>
                <button type="button" className="ui-button ui-button--text" onClick={() => drawer.current?.close()}>סגירה</button>
            </header>
            <Links {...props} onNavigate={() => drawer.current?.close()} />
        </dialog>
    </>;
}
