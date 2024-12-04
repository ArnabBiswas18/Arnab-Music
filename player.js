const { Riffy } = require("riffy");
const { EmbedBuilder } = require("discord.js");
const { Dynamic } = require("musicard");
const config = require("./config.js");
const fs = require("fs");
const path = require("path");

// Map to store autoplay state for each guild
const autoplayState = new Map();

function initializePlayer(client) {
    const nodes = config.nodes.map(node => ({
        name: node.name,
        host: node.host,
        port: node.port,
        password: node.password,
        secure: node.secure,
        reconnectTimeout: 5000,
        reconnectTries: Infinity
    }));

    client.riffy = new Riffy(client, nodes, {
        send: (payload) => {
            const guildId = payload.d.guild_id;
            if (!guildId) return;

            const guild = client.guilds.cache.get(guildId);
            if (guild) guild.shard.send(payload);
        },
        defaultSearchPlatform: "ytmsearch",
        restVersion: "v4",
    });

    client.riffy.on("trackStart", async (player, track) => {
        const channel = client.channels.cache.get(player.textChannel);
        const trackUri = track.info.uri;

        try {
            const musicard = await Dynamic({
                thumbnailImage: track.info.thumbnail || 'https://example.com/default_thumbnail.png',
                backgroundColor: '#070707',
                progress: 10,
                progressColor: '#FF7A00',
                progressBarColor: '#5F2D00',
                name: track.info.title,
                nameColor: '#FF7A00',
                author: track.info.author || 'Unknown Artist',
                authorColor: '#696969',
            });

            const cardPath = path.join(__dirname, 'musicard.png');
            fs.writeFileSync(cardPath, musicard);

            const attachment = new AttachmentBuilder(cardPath, { name: 'musicard.png' });
            const embed = new EmbedBuilder()
                .setAuthor({ name: 'Now Playing', iconURL: 'https://example.com/icon.png' })
                .setDescription('🎶 **Controls:**\n 🔁 `Loop`, ❌ `Disable`, ⏭️ `Skip`, 📜 `Queue`, 🗑️ `Clear`\n ⏹️ `Stop`, ⏸️ `Pause`, ▶️ `Resume`, 🔊 `Vol +`, 🔉 `Vol -`')
                .setImage('attachment://musicard.png')
                .setColor('#FF7A00');

            const message = await channel.send({
                embeds: [embed],
                files: [attachment]
            });

        } catch (error) {
            console.error("Error creating or sending music card:", error.message);
        }
    });

    client.riffy.on("queueEnd", async (player) => {
        const channel = client.channels.cache.get(player.textChannel);

        if (!channel) return;

        const guildId = player.guild.id;

        // Check if autoplay is enabled for the guild
        if (autoplayState.get(guildId)) {
            const nextTrack = await getNextTrack(player);

            if (nextTrack) {
                player.play(nextTrack);
                sendEmbed(channel, `⏭️ **Autoplay is ON! Playing the next song automatically.**`);
            } else {
                sendEmbed(channel, `⚠️ **Autoplay is ON, but no more songs are in the queue.**`);
            }
        } else {
            sendEmbed(channel, `**Queue ended!** The bot will stop playing as autoplay is OFF.`);
            player.destroy();
        }
    });

    // Command to toggle autoplay
    client.on('messageCreate', async (message) => {
        if (message.content.toLowerCase() === '/autoplay') {
            const guildId = message.guild.id;
            const currentState = autoplayState.get(guildId) || false;
            autoplayState.set(guildId, !currentState);

            const status = autoplayState.get(guildId) ? 'enabled' : 'disabled';
            await message.channel.send(`Autoplay is now ${status}!`);
        }
    });
}

async function getNextTrack(player) {
    return player.queue.length > 0 ? player.queue[0] : null;
}

async function sendEmbed(channel, message) {
    const embed = new EmbedBuilder().setColor("#FF7A00").setDescription(message);
    await channel.send({ embeds: [embed] });
}

module.exports = { initializePlayer };