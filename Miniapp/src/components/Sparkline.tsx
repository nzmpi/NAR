export function Sparkline({ values }: { values: number[] }) {
    if (values.length < 2)
        return (
            <p className="text-sm text-[var(--hint)]">
                Not enough history yet.
            </p>
        );
    const min = Math.min(...values),
        max = Math.max(...values);
    const span = max - min || 1;
    const W = 300,
        H = 70;
    const pts = values
        .map(
            (v, i) =>
                `${(i / (values.length - 1)) * W},${H - 4 - ((v - min) / span) * (H - 8)}`,
        )
        .join(" ");
    const up = values[values.length - 1] >= values[0];
    return (
        <svg
            viewBox={`0 0 ${W} ${H}`}
            className="w-full h-16"
            preserveAspectRatio="none"
            role="img"
            aria-label="Performance chart"
        >
            <polyline
                points={pts}
                fill="none"
                stroke={up ? "var(--good)" : "var(--bad)"}
                strokeWidth="2"
                vectorEffect="non-scaling-stroke"
            />
        </svg>
    );
}
