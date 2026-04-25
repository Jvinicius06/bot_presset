require('dotenv').config();
const {
    Client,
    GatewayIntentBits,
    AttachmentBuilder,
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    StringSelectMenuBuilder,
    MessageFlags,
    PermissionFlagsBits,
    Events,
} = require('discord.js');
const { listCharacters, getPreset, getAllPresets } = require('./db');

function log(...a) {
    console.log(`[${new Date().toISOString()}]`, ...a);
}

log('[boot] iniciando bot…');
log(`[boot] node=${process.version} platform=${process.platform}`);
log(`[boot] DISCORD_TOKEN presente? ${!!process.env.DISCORD_TOKEN}`);
log(`[boot] DISCORD_CLIENT_ID=${process.env.DISCORD_CLIENT_ID || '(não definido)'}`);
log(`[boot] DISCORD_GUILD_ID=${process.env.DISCORD_GUILD_ID || '(global)'}`);
log(`[boot] DB_HOST=${process.env.DB_HOST}:${process.env.DB_PORT} db=${process.env.DB_NAME} user=${process.env.DB_USER}`);

if (!process.env.DISCORD_TOKEN) {
    console.error('[boot] DISCORD_TOKEN ausente no .env — abortando.');
    process.exit(1);
}

const RATE_LIMIT_PER_MIN = Number(process.env.RATE_LIMIT_PER_MIN || 5);
const rateBuckets = new Map();

function checkRate(discordId) {
    const now = Date.now();
    const windowStart = now - 60_000;
    const arr = (rateBuckets.get(discordId) || []).filter(t => t > windowStart);
    if (arr.length >= RATE_LIMIT_PER_MIN) {
        rateBuckets.set(discordId, arr);
        return false;
    }
    arr.push(now);
    rateBuckets.set(discordId, arr);
    return true;
}

function audit(action, discordId, extra = {}) {
    console.log(JSON.stringify({
        ts: new Date().toISOString(),
        action,
        discordId,
        ...extra,
    }));
}

function genderLabel(g) {
    if (g === 'm' || g === 'M' || g === 'male' || g === 0 || g === '0') return 'Masculino';
    if (g === 'f' || g === 'F' || g === 'female' || g === 1 || g === '1') return 'Feminino';
    return g ? String(g) : '—';
}

function buildPublicPanel() {
    const embed = new EmbedBuilder()
        .setTitle('Pegue seu preset de aparência')
        .setDescription(
            'Aperte o botão abaixo para receber o JSON do preset salvo do seu personagem.\n\n' +
            'Apenas você verá a resposta — ninguém mais no canal consegue ver o seu preset.'
        )
        .setColor(0x5865F2);

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('preset:start')
            .setLabel('Pegar meu preset')
            .setStyle(ButtonStyle.Primary)
    );

    return { embeds: [embed], components: [row] };
}

function buildCharacterSelect(chars) {
    const options = chars.slice(0, 25).map((c, idx) => {
        const nome = `${c.firstname ?? '?'} ${c.lastname ?? '?'}`.trim();
        return {
            label: nome.slice(0, 100) || `Personagem #${idx + 1}`,
            description: `${c.citizenid}${c.has_preset ? '' : ' • sem preset salvo'}`.slice(0, 100),
            value: c.citizenid,
        };
    });

    const select = new StringSelectMenuBuilder()
        .setCustomId('preset:pick')
        .setPlaceholder('Escolha o personagem')
        .addOptions(options);

    return new ActionRowBuilder().addComponents(select);
}

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once(Events.ClientReady, async (c) => {
    log(`[ready] Bot online como ${c.user.tag} (id=${c.user.id})`);
    log(`[ready] Em ${c.guilds.cache.size} guild(s):`);
    for (const g of c.guilds.cache.values()) {
        log(`[ready]  • ${g.name} (id=${g.id})`);
    }
    try {
        const guildId = process.env.DISCORD_GUILD_ID;
        if (guildId) {
            const guild = await c.guilds.fetch(guildId).catch(() => null);
            if (!guild) {
                log(`[ready] AVISO: bot NÃO está no guild ${guildId} configurado no .env`);
            } else {
                const cmds = await guild.commands.fetch();
                log(`[ready] Comandos no guild ${guild.name}: ${cmds.size}`);
                for (const cmd of cmds.values()) {
                    log(`[ready]  • /${cmd.name} (id=${cmd.id})`);
                }
            }
        } else {
            const cmds = await c.application.commands.fetch();
            log(`[ready] Comandos globais: ${cmds.size}`);
            for (const cmd of cmds.values()) {
                log(`[ready]  • /${cmd.name} (id=${cmd.id})`);
            }
        }
    } catch (err) {
        console.error('[ready] erro ao listar comandos:', err.message);
    }
});

client.on(Events.GuildCreate, (g) => log(`[guild] entrei em ${g.name} (${g.id})`));
client.on(Events.Error, (err) => console.error('[client error]', err));
client.on(Events.Warn, (m) => console.warn('[client warn]', m));
client.on(Events.ShardError, (err) => console.error('[shard error]', err));
client.rest.on('rateLimited', (info) => console.warn('[rate limited]', info));
process.on('unhandledRejection', (err) => console.error('[unhandledRejection]', err));
process.on('uncaughtException', (err) => console.error('[uncaughtException]', err));

function isAdmin(i) {
    if (!i.inGuild()) return false;
    const perms = i.memberPermissions;
    return !!perms && perms.has(PermissionFlagsBits.Administrator);
}

async function deliverPreset(i, citizenid) {
    const preset = await getPreset(i.user.id, citizenid);
    audit('download_preset', i.user.id, { citizenid, found: !!preset });
    if (!preset) {
        return i.editReply('Preset não encontrado ou esse personagem não pertence a você.');
    }
    const file = new AttachmentBuilder(
        Buffer.from(JSON.stringify(preset)),
        { name: `${citizenid}.json` }
    );
    return i.editReply({
        content: `Seu preset de \`${citizenid}\` (model: \`${preset.model}\`).`,
        files: [file],
    });
}

client.on(Events.InteractionCreate, async (i) => {
    log(`[interaction] type=${i.type} user=${i.user?.id} guild=${i.guildId || 'DM'} cmd=${i.commandName || i.customId || '-'}`);
    try {
        if (i.isChatInputCommand() && i.commandName === 'painelpreset') {
            if (!isAdmin(i)) {
                audit('forbidden', i.user.id, { command: 'painelpreset' });
                return i.reply({
                    content: 'Apenas administradores podem publicar o painel.',
                    flags: MessageFlags.Ephemeral,
                });
            }
            audit('publish_panel', i.user.id, { guild: i.guildId });
            return i.reply(buildPublicPanel());
        }

        if (i.isButton() && i.customId === 'preset:start') {
            if (!checkRate(i.user.id)) {
                audit('rate_limited', i.user.id, { button: i.customId });
                return i.reply({
                    content: `Limite de ${RATE_LIMIT_PER_MIN} chamadas por minuto atingido.`,
                    flags: MessageFlags.Ephemeral,
                });
            }
            await i.deferReply({ flags: MessageFlags.Ephemeral });
            const chars = await listCharacters(i.user.id);
            audit('open_picker', i.user.id, { count: chars.length });

            if (chars.length === 0) {
                return i.editReply('Nenhum personagem vinculado ao seu Discord.');
            }

            const withPreset = chars.filter(c => c.has_preset);
            if (withPreset.length === 0) {
                return i.editReply('Você tem personagens, mas nenhum deles tem preset de aparência salvo.');
            }

            if (withPreset.length === 1) {
                return deliverPreset(i, withPreset[0].citizenid);
            }

            return i.editReply({
                content: 'Você tem mais de um personagem. Escolha qual preset baixar:',
                components: [buildCharacterSelect(withPreset)],
            });
        }

        if (i.isStringSelectMenu() && i.customId === 'preset:pick') {
            if (!checkRate(i.user.id)) {
                audit('rate_limited', i.user.id, { select: i.customId });
                return i.reply({
                    content: `Limite de ${RATE_LIMIT_PER_MIN} chamadas por minuto atingido.`,
                    flags: MessageFlags.Ephemeral,
                });
            }
            await i.deferUpdate();
            const citizenid = i.values[0];
            await i.editReply({ content: 'Buscando seu preset…', components: [] });
            return deliverPreset(i, citizenid);
        }
    } catch (err) {
        console.error('Erro ao processar interação:', err);
        audit('error', i.user?.id, { message: err.message });
        const msg = 'Erro interno ao processar a ação.';
        if (i.deferred || i.replied) {
            await i.editReply(msg).catch(() => {});
        } else {
            await i.reply({ content: msg, flags: MessageFlags.Ephemeral }).catch(() => {});
        }
    }
});

log('[boot] chamando client.login…');
client.login(process.env.DISCORD_TOKEN)
    .then(() => log('[boot] login OK'))
    .catch((err) => {
        console.error('[boot] FALHA no login:', err.message);
        process.exit(1);
    });
