import { Bot, InlineKeyboard, webhookCallback } from "grammy";
import type { FastifyInstance } from "fastify";
import { config } from "../config.js";
import { db } from "../db/index.js";
import { hasAccess } from "../services/allowlist.js";

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

    const restricted = async (id: number | undefined) =>
        id === undefined ||
        !(await hasAccess(
            db,
            {
                appEnv: config.APP_ENV,
                ownerTelegramId: config.OWNER_TELEGRAM_ID,
            },
            String(id),
        ));

    priv.command("start", async (ctx) => {
        if (await restricted(ctx.from?.id))
            return ctx.reply("This bot is invite-only.");
        return ctx.reply(
            "Welcome to NAR.\n\nOpen the app to deposit, track your balance and request withdrawals.",
            open(),
        );
    });

    priv.command("help", async (ctx) => {
        if (await restricted(ctx.from?.id))
            return ctx.reply("This bot is invite-only.");
        return ctx.reply(
            "Everything happens in the app: deposits, balance, history and withdrawals.\n" +
                "You will get a message here when a deposit is confirmed or a withdrawal is paid.",
            open(),
        );
    });

    // Anything else: point to the app.
    priv.on("message", async (ctx) => {
        if (await restricted(ctx.from?.id)) return;
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
            allowed_updates: ["message"],
        });
        log.info(`bot webhook set: ${config.WEBHOOK_URL}`);
    } else {
        // start() removes any webhook first. Not awaited: it runs until stopped.
        void b.start({
            allowed_updates: ["message"],
            onStart: (me) => log.info(`bot polling as @${me.username}`),
        });
    }
}
