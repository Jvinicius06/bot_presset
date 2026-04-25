require('dotenv').config();
const { REST, Routes, SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');

const commands = [
    new SlashCommandBuilder()
        .setName('painelpreset')
        .setDescription('Abre o painel com seus personagens e presets de aparência. (Admin)')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .setDMPermission(false)
        .toJSON(),
];

const token = process.env.DISCORD_TOKEN;
const clientId = process.env.DISCORD_CLIENT_ID;
const guildId = process.env.DISCORD_GUILD_ID;

if (!token || !clientId) {
    console.error('Faltam DISCORD_TOKEN ou DISCORD_CLIENT_ID no .env');
    process.exit(1);
}

const rest = new REST({ version: '10' }).setToken(token);

console.log('[deploy] iniciando…');
console.log(`[deploy] clientId=${clientId}`);
console.log(`[deploy] guildId=${guildId || '(global)'}`);
console.log(`[deploy] comandos a registrar: ${commands.map(c => '/' + c.name).join(', ')}`);

(async () => {
    try {
        let data;
        if (guildId) {
            console.log(`[deploy] PUT applicationGuildCommands (${clientId}, ${guildId})`);
            data = await rest.put(
                Routes.applicationGuildCommands(clientId, guildId),
                { body: commands }
            );
            console.log(`[deploy] OK — ${data.length} comando(s) registrado(s) no guild ${guildId}.`);
        } else {
            console.log(`[deploy] PUT applicationCommands (${clientId}) — global (pode levar até 1h para propagar)`);
            data = await rest.put(
                Routes.applicationCommands(clientId),
                { body: commands }
            );
            console.log(`[deploy] OK — ${data.length} comando(s) registrado(s) globalmente.`);
        }
        for (const c of data) {
            console.log(`[deploy]  • /${c.name}  id=${c.id}  default_member_permissions=${c.default_member_permissions ?? 'null'}`);
        }
        console.log('[deploy] fim.');
    } catch (err) {
        console.error('[deploy] FALHA ao registrar comandos:');
        console.error(`[deploy]  status=${err.status} code=${err.code}`);
        console.error(`[deploy]  message=${err.message}`);
        if (err.rawError) console.error('[deploy]  rawError=', JSON.stringify(err.rawError, null, 2));
        process.exit(1);
    }
})();
