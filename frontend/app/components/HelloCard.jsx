export default function HelloCard({ title, children }) {
    return (
        <div
            style={{ border: "1px solid #ddd", padding: 16, borderRadius: 12 }}
        >
            <h2 style={{ marginTop: 0 }}>{title}</h2>
            <div>{children}</div>
        </div>
    );
}
