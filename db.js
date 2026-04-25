const mysql = require('mysql2/promise');

const pool = mysql.createPool({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT),
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 5,
    queueLimit: 0,
});

async function listCharacters(discordId) {
    const [rows] = await pool.execute(
        `SELECT p.citizenid, p.cid,
                JSON_UNQUOTE(JSON_EXTRACT(p.charinfo, '$.firstname')) AS firstname,
                JSON_UNQUOTE(JSON_EXTRACT(p.charinfo, '$.lastname'))  AS lastname,
                EXISTS(SELECT 1 FROM playerskins ps
                       WHERE ps.citizenid = p.citizenid AND ps.active = 1) AS has_preset
         FROM users u
         INNER JOIN players p
                ON p.license = u.license2 OR p.license = u.license
         WHERE u.discord = ?
         ORDER BY p.cid ASC`,
        [`discord:${discordId}`]
    );
    return rows;
}

async function getPreset(discordId, citizenid) {
    const [rows] = await pool.execute(
        `SELECT ps.skin AS skin_json, ps.model
         FROM users u
         INNER JOIN players p
                ON p.license = u.license2 OR p.license = u.license
         INNER JOIN playerskins ps
                ON ps.citizenid = p.citizenid AND ps.active = 1
         WHERE u.discord = ? AND p.citizenid = ?
         LIMIT 1`,
        [`discord:${discordId}`, citizenid]
    );
    if (rows.length === 0) return null;
    return { model: rows[0].model, skin: JSON.parse(rows[0].skin_json) };
}

async function getAllPresets(discordId) {
    const [rows] = await pool.execute(
        `SELECT p.citizenid,
                p.name AS char_name,
                JSON_UNQUOTE(JSON_EXTRACT(p.charinfo, '$.firstname')) AS firstname,
                JSON_UNQUOTE(JSON_EXTRACT(p.charinfo, '$.lastname'))  AS lastname,
                JSON_UNQUOTE(JSON_EXTRACT(p.charinfo, '$.gender'))    AS gender,
                ps.model,
                ps.skin AS skin_json,
                p.last_updated
         FROM users u
         INNER JOIN players p
                ON p.license = u.license2 OR p.license = u.license
         INNER JOIN playerskins ps
                ON ps.citizenid = p.citizenid AND ps.active = 1
         WHERE u.discord = ?
         ORDER BY p.cid ASC`,
        [`discord:${discordId}`]
    );
    return rows.map(r => ({
        citizenid: r.citizenid,
        name: r.char_name,
        firstname: r.firstname,
        lastname: r.lastname,
        gender: r.gender,
        model: r.model,
        skin: JSON.parse(r.skin_json),
        last_updated: r.last_updated,
    }));
}

module.exports = { listCharacters, getPreset, getAllPresets, pool };
