import { Bot, InlineKeyboard, webhookCallback } from "grammy";
import type { FastifyInstance } from "fastify";
import { config } from "../config.js";
import { db } from "../db/index.js";
import {
    accessStatus,
    requestAccess,
    type AccessStatus,
} from "../services/accessRequests.js";
import { AppError } from "../errors.js";

type Log = {
    error: (...a: unknown[]) => void;
    info: (...a: unknown[]) => void;
};

let bot: Bot | undefined;

export function getBot(): Bot {
    if (bot) return bot;
    const b = new Bot(config.BOT_TOKEN);

    // Private chats only: the bot is a launcher, not a group tool.
    const priv = b.chatType("private");

    const open = () =>
        config.MINI_APP_URL
            ? {
                  reply_markup: new InlineKeyboard().webApp(
                      "Open NAR",
                      config.MINI_APP_URL,
                  ),
              }
            : {};

    const env = {
        appEnv: config.APP_ENV,
        ownerTelegramId: config.OWNER_TELEGRAM_ID,
    };
    const status = (id: number) => accessStatus(db, env, String(id));
    const REQUEST = "access:request";

    // People without access see their request status, a button to ask for
    // approval when they may, and the app (which shows a demo until approved).
    const accessReply = (st: AccessStatus) => {
        const kb = new InlineKeyboard();
        if ("canRequest" in st && st.canRequest)
            kb.text("Request access", REQUEST).row();
        if (config.MINI_APP_URL) kb.webApp("Open NAR", config.MINI_APP_URL);
        const text =
            st.status === "pending"
                ? "Your request to join NAR is waiting for approval. You will get a message here when it is decided."
                : st.status === "rejected" && !st.canRequest
                  ? `Your request was declined. You can ask again after ${st.retryAt.toISOString().slice(0, 10)}.`
                  : "NAR is invite-only. Ask for access and an admin will review it.";
        return { text, extra: { reply_markup: kb } };
    };

    // undefined = full access; otherwise what to send instead.
    const gate = async (id: number | undefined) => {
        if (id === undefined) return "";
        const st = await status(id);
        if (st.status === "approved") return undefined;
        if (st.status === "blocked") return "Your account is blocked.";
        return accessReply(st);
    };
    const replyGate = (
        ctx: { reply: (t: string, x?: object) => unknown },
        g: string | ReturnType<typeof accessReply>,
    ) =>
        typeof g === "string" ? g && ctx.reply(g) : ctx.reply(g.text, g.extra);

    priv.callbackQuery(REQUEST, async (ctx) => {
        let st: AccessStatus;
        try {
            st = await requestAccess(db, env, {
                telegramId: String(ctx.from.id),
                username: ctx.from.username ?? null,
                firstName: ctx.from.first_name ?? null,
            });
        } catch (e) {
            if (!(e instanceof AppError)) throw e;
            await ctx.answerCallbackQuery({ text: e.message });
            return;
        }
        await ctx.answerCallbackQuery(
            st.status === "pending" ? { text: "Request sent" } : {},
        );
        const g = await gate(ctx.from.id);
        if (g === undefined)
            return ctx.reply("You already have access.", open());
        if (typeof g === "string") return g && ctx.reply(g);
        return ctx.editMessageText(g.text, g.extra);
    });

    priv.command("start", async (ctx) => {
        const g = await gate(ctx.from?.id);
        if (g !== undefined) return replyGate(ctx, g);
        return ctx.reply(
            "Welcome to NAR.\n\nOpen the app to deposit, track your balance and request withdrawals.",
            open(),
        );
    });

    priv.command("help", async (ctx) => {
        const g = await gate(ctx.from?.id);
        if (g !== undefined) return replyGate(ctx, g);
        return ctx.reply(
            "Everything happens in the app: deposits, balance, history and withdrawals.\n" +
                "You will get a message here when a deposit is confirmed or a withdrawal is paid.",
            open(),
        );
    });

    // Anything else: point to the app.
    priv.on("message", async (ctx) => {
        if ((await gate(ctx.from?.id)) !== undefined) return;
        return ctx.reply("Use the button below to open the app.", open());
    });

    bot = b;
    return b;
}

// Webhook route. Must be registered before app.listen.
export function registerBotWebhook(app: FastifyInstance) {
    if (config.BOT_MODE !== "webhook") return;
    // Telegram's servers are not end users: skip the per-IP limiter.
    app.post(
        "/telegram/webhook",
        { config: { rateLimit: false } },
        webhookCallback(getBot(), "fastify", {
            secretToken: config.WEBHOOK_SECRET,
        }),
    );
}

export async function startBot(log: Log) {
    if (config.BOT_MODE === "off") return;
    const b = getBot();
    b.catch((e) => log.error(e));
    await b.init();

    await b.api.setMyCommands([
        { command: "start", description: "Open the app" },
        { command: "help", description: "How it works" },
    ]);
    if (config.MINI_APP_URL) {
        await b.api.setChatMenuButton({
            menu_button: {
                type: "web_app",
                text: "Open",
                web_app: { url: config.MINI_APP_URL },
            },
        });
    }

    if (config.BOT_MODE === "webhook") {
        await b.api.setWebhook(config.WEBHOOK_URL!, {
            secret_token: config.WEBHOOK_SECRET,
            allowed_updates: ["message", "callback_query"],
        });
        log.info(`bot webhook set: ${config.WEBHOOK_URL}`);
    } else {
        // start() removes any webhook first. Not awaited: it runs until stopped.
        void b.start({
            allowed_updates: ["message", "callback_query"],
            onStart: (me) => log.info(`bot polling as @${me.username}`),
        });
    }
}
