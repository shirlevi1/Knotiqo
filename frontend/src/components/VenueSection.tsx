export default function VenueSection({ weddingId }: { weddingId: number }) {
    return (
        <section className="ui-panel ui-state venue-entry" dir="rtl">
            <h4>האולמות שלכם</h4>
            <p>שמרו את פרטי האולמות והצעות המחיר במרחב המשותף שלכם.</p>
            <a className="ui-button ui-button--secondary" href={`#/weddings/${weddingId}/venues`}>ניהול אולמות</a>
        </section>
    );
}
