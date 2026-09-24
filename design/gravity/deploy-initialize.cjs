// Explicit one-time deployment action. The application never calls this at startup.
const requireApp = require('node:module').createRequire('/app/package.json');
requireApp('reflect-metadata');
const { drizzle } = requireApp('drizzle-orm/postgres-js');
const { createPgClient } = require('/app/dist/db/db.module');
const schema = require('/app/dist/db/schema');
const { HomepageService } = require('/app/dist/modules/homepage/homepage.service');
const { AuditService } = require('/app/dist/modules/audit/audit.service');
(async () => {
    const client = createPgClient(process.env.DATABASE_URL, 1);
    try {
        const db = drizzle(client, { schema });
        const home = new HomepageService(db, null);
        const existing = await home.admin();
        if (existing.initialized || existing.config || existing.works.length) {
            console.log('Existing homepage preserved; initialization skipped.');
            return;
        }
        const result = await home.initialize();
        await new AuditService(db).record({
            action: 'homepage.initialize', targetType: 'homepage', actorName: 'deployment:gravity',
            ip: '127.0.0.1', ...result.audit,
        });
        const published = await home.publicHome();
        console.log(JSON.stringify({ initialized: true, publishedWorks: published.works.length }));
    } finally { await client.end(); }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
