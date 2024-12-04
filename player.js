const { Riffy } = require("riffy");
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, AttachmentBuilder } = require("discord.js");
const { Dynamic } = require("musicard");
const config = require("./config.js");
const fs = require("fs");
const path = require("path");

let autoplayEnabled = new Map(); // Map to track autoplay status for each guild

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

            if (collector) collector.stop(); // Stop any existing collectors
            collector = setupCollector(client, player, channel, message);

        } catch (error) {
            console.error("Error generating music card:", error);
            const errorEmbed = new EmbedBuilder()
                .setColor('#FF0000')
                .setDescription("⚠️ **Unable to load track card. Continuing playback...**");
            await channel.send({ embeds: [errorEmbed] });
        }
    });

    client.riffy.on("queueEnd", async (player) => {
        if (autoplayEnabled.get(player.guildId)) {
            const channel = client.channels.cache.get(player.textChannel);
            await sendEmbed(channel, "🔄 **Autoplay is enabled! Playing next track...**");

            // Get the next track (autoplay logic)
            const nextTrack = await getNextTrack(player.guildId); // You can define getNextTrack logic
            if (nextTrack) {
                player.play(nextTrack);
            } else {
                await sendEmbed(channel, "❌ **No more tracks available for autoplay.**");
                player.stop();
            }
        } else {
            const channel = client.channels.cache.get(player.textChannel);
            await sendEmbed(channel, "**Queue ended! Disconnecting...**");
            player.destroy();
        }
    });

    client.riffy.on("trackEnd", async (player) => {
        await disableTrackMessage(client, player);
        currentTrackMessageId = null;
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
        const filter = i => [
            'loopToggle', 'skipTrack', 'disableLoop', 'showQueue', 'clearQueue',
            'stopTrack', 'pauseTrack', 'resumeTrack', 'volumeUp', 'volumeDown', 'toggleAutoplay'
        ].includes(i.customId);

        const collector = message.createMessageComponentCollector({ filter, time: 600000 });

        collector.on('collect', async i => {
            await i.deferUpdate();
            handleInteraction(i, player, channel);
        });

        collector.on('end', () => {
            console.log("Collector stopped.");
        });

        return collector;
    }

    async function handleInteraction(i, player, channel) {
        switch (i.customId) {
            case 'loopToggle':
                toggleLoop(player, channel);
                break;
            case 'skipTrack':
                player.stop();
                await sendEmbed(channel, "⏭️ **Skipping to the next track!**");
                break;
            case 'disableLoop':
                disableLoop(player, channel);
                break;
            case 'showQueue':
                showQueue(channel);
                break;
            case 'clearQueue':
                player.queue.clear();
                await sendEmbed(channel, "🗑️ **Queue has been cleared!**");
                break;
            case 'stopTrack':
                player.stop();
                player.destroy();
                await sendEmbed(channel, '⏹️ **Stopped and destroyed player!**');
                break;
            case 'pauseTrack':
                player.pause(true);
                await sendEmbed(channel, '⏸️ **Paused playback!**');
                break;
            case 'resumeTrack':
                player.pause(false);
                await sendEmbed(channel, '▶️ **Resumed playback!**');
                break;
            case 'volumeUp':
                adjustVolume(player, channel, 10);
                break;
            case 'volumeDown':
                adjustVolume(player, channel, -10);
                break;
            case 'toggleAutoplay':
                toggleAutoplay(player.guildId);
                break;
        }
    }

    function toggleAutoplay(guildId) {
        autoplayEnabled.set(guildId, !autoplayEnabled.get(guildId));
        console.log(`Autoplay for guild ${guildId} is now ${autoplayEnabled.get(guildId) ? "enabled" : "disabled"}`);
    }

    async function sendEmbed(channel, message) {
        const embed = new EmbedBuilder().setColor(config.embedColor).setDescription(message);
        const sentMessage = await channel.send({ embeds: [embed] });
        setTimeout(() => sentMessage.delete().catch(console.error), config.embedTimeout * 1000);
    }

    function adjustVolume(player, channel, amount) {
        const newVolume = Math.min(100, Math.max(10, player.volume + amount));
        if (newVolume === player.volume) {
            sendEmbed(channel, amount > 0 ? '🔊 **Volume is already at maximum!**' : '🔉 **Volume is already at minimum!**');
        } else {
            player.setVolume(newVolume);
            sendEmbed(channel, `🔊 **Volume changed to ${newVolume}%!**`);
        }
    }

    function toggleLoop(player, channel) {
        player.setLoop(player.loop === "track" ? "queue" : "track");
        sendEmbed(channel, player.loop === "track" ? "🔁 **Track loop is activated!**" : "🔁 **Queue loop is activated!**");
    }

    function disableLoop(player, channel) {
        player.setLoop("none");
        sendEmbed(channel, "❌ **Loop is disabled!**");
    }

    function showQueue(channel) {
        if (queueNames.length === 0) {
            sendEmbed(channel, "The queue is empty.");
            return;
        }

        const nowPlaying = `🎵 **Now Playing:**\n${formatTrack(queueNames[0])}`;
        const queueChunks = [];

        for (let i = 1; i < queueNames.length; i +=