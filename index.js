import ProgressBar from "progress";
import { Client } from "@theuntraceable/discord-rpc";
import { QuickDB, SqliteDriver } from "quick.db";
import chalk from "chalk";
import { createSpinner } from "nanospinner";
import fs from "fs/promises";

try {
    await fs.readFile("./config.js", "utf8");
} catch {
    console.log(chalk.red.bold("No config.js found, creating one."));
    fs.writeFile("./config.js", `export default {}`);
    console.log(
        chalk.red.bold(
            "Created config.js. Please fill it out and restart the script."
        )
    );
    process.exit(1);
}

import config from "./config.js";

const client = new Client({
    transport: "ipc",
});

const db = new QuickDB({
    driver: new SqliteDriver("./antighostpinger.sqlite"),
    filePath: "./antighostpinger.sqlite",
});

const token = db.table("token");
const messages = db.table("messages");

const channels = [];
const CHANNEL_TYPES = [0, 2, 5, 10, 11, 12, 15];

client.on("ready", async (payload) => {
    console.log(
        chalk.green.bold(
            `Logged on account ${client.user.username}#${client.user.discriminator} (${client.user.id})!`
        )
    );

    if (client.accessToken && payload.expires) {
        token.set("token", {
            accessToken: client.accessToken,
            expiresAt: new Date(payload.expires),
        });
    }

    const _guilds = await client.getGuilds();
    const guilds = _guilds.guilds;

    const spinner = createSpinner(chalk.green.bold("Fetching channels..."));
    spinner.start();
    for (const guild of guilds) {
        for (const channel of await client.getChannels(guild.id)) {
            if (CHANNEL_TYPES.includes(channel.type)) {
                channels.push(channel);
            }
        }
    }
    spinner.success(chalk.green.bold("Successfully fetched channels!"));

    const bar = new ProgressBar(
        `[:bar] ${chalk.green.bold(
            "Subscribing to events..."
        )} :etas :percent (:current/:total)`,
        {
            complete: chalk.green("="),
            incomplete: chalk.red("-"),
            width: 50,
            total: channels.length,
        }
    );

    for (const channel of channels) {
        if (CHANNEL_TYPES.includes(channel.type)) {
            await client.subscribe("MESSAGE_CREATE", {
                channel_id: channel.id,
            });
            await client.subscribe("MESSAGE_UPDATE", {
                channel_id: channel.id,
            });
            await client.subscribe("MESSAGE_DELETE", {
                channel_id: channel.id,
            });
            bar.tick();
        }
    }
    console.log(chalk.green.bold("Successfully subscribed to events!"));
});

client.on("MESSAGE_CREATE", async (payload) => {
    const { message, channel_id } = payload;
    const { author, author_color } = message;
    if (author.id === client.user.id) return;

    if (
        !message.mention_everyone &&
        !message.mentions.find((mention) => mention.id === client.user.id)
    ) {
        return;
    }

    const data = {
        message,
        author: {
            ...author,
            author_color,
        },
        channel_id,
    };

    await messages.set(message.id, data);
});

client.on("MESSAGE_UPDATE", async (payload) => {
    const before = await messages.get(payload.message.id);

    if (!before) return;
    const { message, channel_id } = before;
    const { author, author_color } = message;

    if (author.id === client.user.id) return;
    if (
        payload.message.mention_everyone ||
        payload.message.mentions?.find(
            (mention) => mention.id === client.user.id
        )
    ) {
        return;
    }
    const channel = channels.find((c) => c.id === channel_id);

    await messages.delete(payload.message.id);
    console.log(
        chalk
            .hex(author_color)
            .bold(
                `[${channel.name}] (${channel.id}) ${author.username}#${
                    author.discriminator
                } (${author.id}): ${message.content.replace(
                    `<@${client.user.id}>`,
                    `@${client.user.username}#${client.user.discriminator}`
                )} ${chalk.red.bold("===>")} ${chalk.hex(payload.message.author_color)(payload.message.content)}`
            )
    );
});

client.on("MESSAGE_DELETE", async (payload) => {
    if (await messages.has(payload.message.id)) {
        const message = await messages.get(payload.message.id);
        const channel = channels.find(
            (channel) => channel.id === payload.channel_id
        );
        await messages.delete(payload.message.id);
        console.log(
            chalk.hex(message.author.author_color)(
                `[${channel.name}] (${channel.id}) ${message.author.username}#${
                    message.author.discriminator
                } (${message.author.id}): ${message.message.content.replace(
                    `<@${client.user.id}>`,
                    `@${client.user.username}#${client.user.discriminator}`
                )}`
            )
        );
    }
});

const login = {
    clientId: config.clientId,
    clientSecret: config.clientSecret,
    scopes: ["identify", "rpc", "messages.read", "rpc.notifications.read"],
    redirectUri: "https://discord.com",
};

const data = await token.get("token");

if (data) {
    const { accessToken, expiresAt } = data;
    if (new Date(expiresAt) > new Date()) {
        login.accessToken = accessToken;
    }
}

client.login(login);
