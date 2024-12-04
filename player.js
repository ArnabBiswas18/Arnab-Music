const { Riffy } = require("riffy");
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, AttachmentBuilder } = require("discord.js");
const { queueNames, requesters } = require("./commands/play");
const { Dynamic } = require("musicard");
const config = require("./config.js");
const fs = require("fs");
const path = require("path");

let autoplayEnabled = new Map(); // To store autoplay state for each guild

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

    let currentTrackMessageId = null;
    let collector = null;

    client.riffy.on("nodeConnect", node => {
        console.log(`Node "${node.name}" connected.`);
    });

    client.riffy.on("nodeError", (node, error) => {
        console.error(`Node "${node.name}" encountered an error: ${error.message}.`);
    });

    client.riffy.on("trackStart", async (player, track) => {
        const channel = client.channels.cache.get(player.textChannel);
        const trackUri = track.info.uri;
        const requester = requesters.get(trackUri);

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
                .setAuthor({
                    name: 'Now Playing',
                    iconURL: 'https://cdn.discordapp.com/emojis/838704777436200981.gif'
                })
                .setDescription('🎶 **Controls:**\n 🔁 `Loop`, ❌ `Disable`, ⏭️ `Skip`, 📜 `Queue`, 🗑️ `Clear`\n ⏹️ `Stop`, ⏸️ `Pause`, ▶️ `Resume`, 🔊 `Vol +`, 🔉 `Vol -`\n 🔄 `Autoplay: ' + (autoplayEnabled.get(player.guildId) ? "Enabled" : "Disabled") + '`')
                .setImage('attachment://musicard.png')
                .setColor('#FF7A00');

            const actionRow1 = createActionRow1(false);
            const actionRow2 = createActionRow2(false);

            const message = await channel.send({
                embeds: [embed],
                files: [attachment],
                components: [actionRow1, actionRow2]
            });
            currentTrackMessageId = message.id;

            if (collector) collector.stop();
            collector = setupCollector(client, player, channel, message);

        } catch (error) {
            console.error("Error creating or sending music card:", error.message);
            const errorEmbed = new EmbedBuilder()
                .setColor('#FF0000')
                .setDescription("⚠️ **Unable to load track card. Continuing playback...**");
            await channel.send({ embeds: [errorEmbed] });
        }
    });

    client.riffy.on("queueEnd", async (player) => {
        const channel = client.channels.cache.get(player.textChannel);
        if (!channel) {
            player.destroy();
            return;
        }

        const lastTrack = player.queue.previous;
        if (lastTrack && autoplayEnabled.get(player.guildId)) {  // Check if autoplay is enabled
            try {
                const searchResults = await client.riffy.search(
                    `https://www.youtube.com/watch?v=${lastTrack.info.identifier}`,
                    player.requester
                );

                if (searchResults.tracks.length > 0) {
                    const relatedTrack = searchResults.tracks[0];
                    player.queue.add(relatedTrack);
                    player.play();
                    channel.send(`🎵 **Autoplaying next track:** ${relatedTrack.info.title}`);
                } else {
                    console.log("No related tracks found for autoplay.");
                    player.destroy();
                    channel.send("🚫 **No related tracks found. Bot is disconnecting.**");
                }
            } catch (error) {
                console.error("Autoplay failed:", error);
                player.destroy();
                channel.send("⚠️ **Autoplay encountered an error. Bot is disconnecting.**");
            }
        } else {
            player.destroy();
            channel.send("🚫 **Queue ended and no previous track found. Disconnecting bot.**");
        }
    });

    async function disableTrackMessage(client, player) {
        const channel = client.channels.cache.get(player.textChannel);
        if (!channel || !currentTrackMessageId) return;

        try {
            const message = await channel.messages.fetch(currentTrackMessageId);
            if (message) {
                const disabledRow1 = createActionRow1(true);
                const disabledRow2 = createActionRow2(true);
                await message.edit({ components: [disabledRow1, disabledRow2] });
            }
        } catch (error) {
            console.error("Failed to disable message components:", error);
        }
    }

    function setupCollector(client, player, channel, message) {
        const filter = (interaction) => interaction.user.id === player.requester;
        const collector = message.createMessageComponentCollector({
            filter,
            time: 60000
        });

        collector.on("collect", async (interaction) => {
            if (interaction.customId === "autoplayToggle") {
                autoplayEnabled.set(player.guildId, !autoplayEnabled.get(player.guildId));
                await interaction.update({
                    embeds: [embed.setDescription('Autoplay: ' + (autoplayEnabled.get(player.guildId) ? "Enabled" : "Disabled"))],
                });
            }
        });

        return collector;
    }

    function createActionRow1(disabled) {
        return new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder().setCustomId("loopToggle").setEmoji('🔁').setStyle(ButtonStyle.Secondary).setDisabled(disabled),
                new ButtonBuilder().setCustomId("disableLoop").setEmoji('❌').setStyle(ButtonStyle.Secondary).setDisabled(disabled),
                new ButtonBuilder().setCustomId("skipTrack").setEmoji('⏭️').setStyle(ButtonStyle.Secondary).setDisabled(disabled),
                new ButtonBuilder().setCustomId("showQueue").setEmoji('📜').setStyle(ButtonStyle.Secondary).setDisabled(disabled),
                new ButtonBuilder().setCustomId("clearQueue").setEmoji('🗑️').setStyle(ButtonStyle.Secondary).setDisabled(disabled),
                new ButtonBuilder().setCustomId("autoplayToggle").setLabel("Autoplay").setStyle(ButtonStyle.Primary).setDisabled(disabled) // Added toggle button
            );
    }

    function createActionRow2(disabled) {
        return new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder().setCustomId("stopTrack").setEmoji('⏹️').setStyle(ButtonStyle.Danger).setDisabled(disabled),
                new ButtonBuilder().setCustomId("pauseTrack").setEmoji('⏸️').setStyle(ButtonStyle.Secondary).setDisabled(disabled),
                new ButtonBuilder().setCustomId("resumeTrack").setEmoji('▶️').setStyle(ButtonStyle.Secondary).setDisabled(disabled),
                new ButtonBuilder().setCustomId("volumeUp").setEmoji('🔊').setStyle(ButtonStyle.Secondary).setDisabled(disabled),
                new ButtonBuilder().setCustomId("volumeDown").setEmoji('🔉').setStyle(ButtonStyle.Secondary).setDisabled(disabled)
            );
    }
}

module.exports = { initializePlayer };