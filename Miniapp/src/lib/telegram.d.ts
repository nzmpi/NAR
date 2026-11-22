interface TelegramWebApp {
    initData: string;
    colorScheme?: "light" | "dark";
    onEvent?(event: "themeChanged", cb: () => void): void;
    offEvent?(event: "themeChanged", cb: () => void): void;
    ready(): void;
    expand(): void;
    close(): void;
    HapticFeedback?: {
        notificationOccurred(t: "success" | "error" | "warning"): void;
    };
}
interface Window {
    Telegram?: { WebApp: TelegramWebApp };
}
