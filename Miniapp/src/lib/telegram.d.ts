interface TelegramWebApp {
    initData: string;
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
